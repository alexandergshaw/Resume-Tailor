import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeStatefulSupabase } from "../helpers/supabaseFake.js";

// ---------------------------------------------------------------------------
// REPRODUCTIONS — these tests FAIL against the current tree. That is by design.
//
// They exist for two reasons.
//
//   1. They are the coverage the application-status data-loss defect has never
//      had. Every assertion here reads the row back and checks its `status` and
//      `applied_at` — never a call shape. `lib/feed/tailorAndQueue.test.js:86`
//      (`expect(upsertApplication).toHaveBeenCalledWith(...)`) passes against
//      the broken code; it pins the call, and the damage is in the row after
//      the call returns.
//
//   2. They are the correctness oracle for `test/helpers/supabaseFake.js`.
//      A fake that reimplements PostgREST's filter and merge semantics is at
//      risk of proving only its own opinions. The bar that resolves that: the
//      fake must reproduce four defects independently verified in production
//      against pre-fix source. If its `onConflict` merge or its
//      `.not(col,"in",…)` filter were wrong, these tests would not reproduce a
//      bug we know is there — they would go green for the wrong reason.
//
// Every assertion below is `applied_at` compared for IDENTITY against a seeded
// value, never `not.toBeNull()` / `toBeTruthy()` / `expect.any(String)`: the
// re-stamp defect writes a fresh, non-null, WRONG timestamp, and every
// truthiness assertion passes against it.
// ---------------------------------------------------------------------------

vi.mock("@/lib/llm/tailorForUserHeadless", () => ({
  tailorResumeHeadless: vi.fn(),
  tailorCoverLetterHeadless: vi.fn(),
}));
vi.mock("@/lib/supabase/saveGeneratedResume", () => ({ saveGeneratedResume: vi.fn() }));
vi.mock("@/lib/supabase/saveGeneratedCoverLetter", () => ({ saveGeneratedCoverLetter: vi.fn() }));
vi.mock("@/lib/feed/selectQueueCandidates", () => ({ postingToJob: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

// NOTE: `@/lib/supabase/upsertApplication` is deliberately NOT mocked. It is
// the code under test.
import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { tailorAndQueueOne } from "@/lib/feed/tailorAndQueue";
import { DELETE as deleteQueueItem } from "@/app/api/auto-apply-queue/[id]/route.js";
import { tailorResumeHeadless, tailorCoverLetterHeadless } from "@/lib/llm/tailorForUserHeadless";
import { saveGeneratedResume } from "@/lib/supabase/saveGeneratedResume";
import { saveGeneratedCoverLetter } from "@/lib/supabase/saveGeneratedCoverLetter";
import { postingToJob } from "@/lib/feed/selectQueueCandidates";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const USER_ID = "user-1";
const POSITION_ID = "pos-1";

// The user applied on 4 July. This exact string is what every assertion below
// demands back, unchanged.
const APPLIED_AT = "2026-07-04T15:32:11.000Z";
const TRACKED_AT = "2026-06-28T08:00:00.000Z";

// supabase/migrations/20260610020000_applications_status_auto_queued.sql:19-31
const APPLIED_OR_LATER = [
  "applied",
  "phone_screen",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
];

// Imported from the vocabulary module (lib/applications/statusVocabulary.js)
// rather than hand-copied — all SEVEN of the seven above, not five. The old
// five-element literal this line replaced could never satisfy the two
// "phone_screen" / "accepted" expansions below; importing the real,
// seven-element APPLIED_OR_LATER_STATUSES is what makes them satisfiable.
import { APPLIED_OR_LATER_STATUSES as PROTECTED_STATUSES } from "@/lib/applications/statusVocabulary.js";

function seedApplied(status = "applied") {
  return makeStatefulSupabase(
    {
      applications: [
        {
          id: "app-1",
          user_id: USER_ID,
          position_id: POSITION_ID,
          status,
          applied_at: APPLIED_AT,
          tracked_at: TRACKED_AT,
          application_url: "https://acme.example/careers/1",
          notes: "recruiter said Thursday",
        },
      ],
      positions: [{ id: POSITION_ID, external_id: "gh-1", title: "Senior Engineer", company: "Acme" }],
    },
    { user: { id: USER_ID } },
  );
}

function appRow(sb) {
  return sb.row("applications", (r) => r.position_id === POSITION_ID);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. DEMOTION
// ---------------------------------------------------------------------------

describe("REPRO D1 — demotion: a non-applied upsert overwrites status AND nulls applied_at", () => {
  // lib/supabase/upsertApplication.js:22-30 upserts a full row keyed
  // (user_id, position_id) with `applied_at: status === "applied" ? now() : null`.
  // PostgREST's merge-duplicates overwrites every column the payload names, so
  // ANY non-"applied" write — tracking a job, tailoring one, batch-tailoring,
  // auto-queueing — destroys both fields on a row that was already applied.
  // The JSDoc at :4-5 documents the nulling as intended, so the contract is
  // wrong, not only the code.
  //
  // Real source under test: upsertApplication, unmocked.

  it("keeps status and applied_at when a tailor run upserts the row as 'tracking'", async () => {
    const sb = seedApplied("offer");

    const id = await upsertApplication(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });
    expect(id).toBe("app-1");

    const row = appRow(sb);
    // FAILS TODAY: row.status === "tracking".
    expect(row.status).toBe("offer");
    // FAILS TODAY: row.applied_at === null.
    expect(row.applied_at).toBe(APPLIED_AT);
  });

  it("[pin] the merge itself is column-scoped — tracked_at and notes survive", () => {
    // Green today, and green after the fix for a DIFFERENT reason — recorded
    // here so nobody reads this as "the merge is still exercised". Before the
    // fix, this pins the fake's own control: if it replaced rows instead of
    // merging them, the test above would go red for a reason that has nothing
    // to do with the defect. After the fix, `upsertApplication` routes through
    // `writeApplicationStatus`, whose C1 allow-list misses this row ("offer"
    // is not pre-apply) and whose C2 read-back classifies it "protected" — so
    // the writer refuses before any statement ever reaches the fake, and
    // `tracked_at`/`notes`/`application_url` survive because nothing was
    // written, not because the merge is column-scoped. The merge itself is
    // still covered — by the writer's own C3-branch test in
    // lib/supabase/applicationStatusWriter.test.js, which does issue an
    // upsert.
    const sb = seedApplied("offer");
    return upsertApplication(sb, { userId: USER_ID, positionId: POSITION_ID, status: "tracking" }).then(() => {
      const row = appRow(sb);
      expect(row.tracked_at).toBe(TRACKED_AT);
      expect(row.notes).toBe("recruiter said Thursday");
      expect(row.application_url).toBe("https://acme.example/careers/1");
    });
  });
});

// ---------------------------------------------------------------------------
// 2. DELETION
// ---------------------------------------------------------------------------

describe("REPRO D2/D5 — deletion: an applied row is destroyed by a control that promised not to touch it", () => {
  it("survives apply → tailor → untrack (the delete's 'leave applied rows intact' filter matches a demoted row)", async () => {
    // app/page.js:2022-2034, handleUntrackJob:
    //
    //     // Only delete if still in tracking state — leave applied rows intact
    //     await supabase.from("applications").delete()
    //       .eq("user_id", currentUser.id)
    //       .eq("position_id", positionId)
    //       .eq("status", "tracking");
    //
    // handleUntrackJob lives inside a 3200-line "use client" component and
    // cannot be imported, so the delete chain is transcribed verbatim below.
    // That transcription is the ENVIRONMENT, not the code under test: the code
    // under test is the real upsertApplication above it, which is what makes
    // the row read "tracking" by the time the delete runs. Once D1 is fixed the
    // row still reads "offer", the filter misses, and this goes green without
    // the transcription changing at all.
    const sb = seedApplied("offer");

    // Step 1 — the user tailors the posting. app/page.js:2312 upserts "tracking".
    await upsertApplication(sb, { userId: USER_ID, positionId: POSITION_ID, status: "tracking" });

    // Step 2 — the user untracks the job.
    await sb
      .from("applications")
      .delete()
      .eq("user_id", USER_ID)
      .eq("position_id", POSITION_ID)
      .eq("status", "tracking");

    // FAILS TODAY: the row is gone. The user's application at "offer", with the
    // date they applied, has been hard-deleted by a handler whose own comment
    // says it leaves applied rows intact.
    const row = appRow(sb);
    expect(row).not.toBeNull();
    expect(row?.status).toBe("offer");
    expect(row?.applied_at).toBe(APPLIED_AT);
  });

  it("[pin] a genuinely-tracking row is still deleted by untrack — do not over-correct", async () => {
    const sb = seedApplied("tracking");
    sb.seed("applications", [
      { id: "app-1", user_id: USER_ID, position_id: POSITION_ID, status: "tracking", applied_at: null },
    ]);
    await sb
      .from("applications")
      .delete()
      .eq("user_id", USER_ID)
      .eq("position_id", POSITION_ID)
      .eq("status", "tracking");
    expect(appRow(sb)).toBeNull();
  });

  it("survives offer → Live Feed rocket → queue → 'Remove this posting from the queue?'", async () => {
    // 100% real source through the fake: lib/feed/tailorAndQueue.js
    // (unmocked upsertApplication at :222, then the unguarded UPDATE at :231)
    // followed by the real DELETE handler at
    // app/api/auto-apply-queue/[id]/route.js:51 — a hard delete by id with no
    // status filter at all, running as service-role.
    //
    // AutoApplyQueueTab.js:179 asks "Remove this posting from the queue?".
    // What the user actually authorises is the destruction of an application
    // they had an OFFER on.
    const sb = seedApplied("offer");
    postingToJob.mockReturnValue({
      id: "gh-1",
      title: "Senior Engineer",
      company: "Acme",
      description: "Build things",
      url: "https://acme.example/careers/1",
    });
    tailorResumeHeadless.mockResolvedValue({ result: "RESUME", resultLines: ["a"], jobTitle: "Senior Engineer" });
    tailorCoverLetterHeadless.mockResolvedValue({ result: "COVER", resultLines: ["c"] });
    saveGeneratedResume.mockResolvedValue("gen-resume-1");
    saveGeneratedCoverLetter.mockResolvedValue("gen-cover-1");
    createClient.mockResolvedValue(sb);
    createAdminClient.mockReturnValue(sb);

    const queued = await tailorAndQueueOne({
      admin: sb,
      userId: USER_ID,
      posting: { id: "feed-1" },
      resumeBuffer: Buffer.from("resume"),
    });
    expect(queued.applicationId).toBe("app-1");

    const res = await deleteQueueItem(null, { params: Promise.resolve({ id: "app-1" }) });
    expect(res.status).toBe(200);

    // FAILS TODAY: the row is gone.
    const row = appRow(sb);
    expect(row).not.toBeNull();
    expect(row?.applied_at).toBe(APPLIED_AT);
  });
});

// ---------------------------------------------------------------------------
// 3. THE GUARD THAT CHECKS A VALUE ALREADY DESTROYED
// ---------------------------------------------------------------------------

// app/page.js:2336-2342, transcribed verbatim. It is a SEPARATE UPDATE that
// runs AFTER the upsert at :2312 has already rewritten the very column it
// filters on.
async function runStatusGuard(sb, targetStatus = "tailored") {
  return sb
    .from("applications")
    .update({ status: targetStatus })
    .eq("user_id", USER_ID)
    .eq("position_id", POSITION_ID)
    .not("status", "in", `(${PROTECTED_STATUSES.join(",")})`)
    .select("id, status");
}

describe("REPRO D3 — dead guard: protectedStatuses filters on a value the upsert has already overwritten", () => {
  it("protects an applied row across the real tailor sequence (upsert 'tracking' then the guarded UPDATE)", async () => {
    const sb = seedApplied("applied");

    // app/page.js:2312 — the real helper, unmocked.
    await upsertApplication(sb, { userId: USER_ID, positionId: POSITION_ID, status: "tracking" });
    // app/page.js:2336 — the guard, which now sees "tracking", not "applied".
    await runStatusGuard(sb);

    const row = appRow(sb);
    // FAILS TODAY: row.status === "tailored". The guard is dead as shipped —
    // not because its filter is wrong, but because the value it filters on was
    // destroyed one statement earlier. All SEVEN applied-or-later statuses are
    // lost today; the 5-of-7 shortfall below is the residual defect that
    // remains once this ordering is fixed.
    expect(row.status).toBe("applied");
    expect(row.applied_at).toBe(APPLIED_AT);
  });

  it.each(APPLIED_OR_LATER)(
    "refuses to demote a row at '%s' when the guard runs on its own",
    async (status) => {
      // No upsert first — this isolates the guard's own list. Five statuses
      // survive; "phone_screen" and "accepted" are absent from
      // app/page.js:2331 and are demoted to "tailored".
      const sb = seedApplied(status);
      await runStatusGuard(sb);
      expect(appRow(sb).status).toBe(status);
    },
  );

  it("[pin] a genuinely pre-apply row is still promoted — AC-9, do not over-correct", async () => {
    const sb = seedApplied("tracking");
    sb.seed("applications", [
      { id: "app-1", user_id: USER_ID, position_id: POSITION_ID, status: "tracking", applied_at: null },
    ]);
    await runStatusGuard(sb);
    expect(appRow(sb).status).toBe("tailored");
  });

  it("[pin] a NULL-status row is NOT promoted by a NOT-IN guard, whatever its rationale claimed", async () => {
    // The source comment says the NOT-IN filter was chosen "so that any
    // unexpected/stale value — including NULL ... still gets promoted."
    // It does not. PostgreSQL, "Row and Array Comparisons": "if the left-hand
    // expression yields null ... the result of the NOT IN construct will be
    // null, not true as one might naively expect."
    // https://www.postgresql.org/docs/current/functions-comparisons.html
    // A NULL predicate is not TRUE, so the row is not matched by the UPDATE.
    //
    // Green today and after a fix that keeps NULL pre-apply (AC-9 / §7): this
    // records that the stated rationale for the NOT-IN filter is false, so
    // nobody preserves the filter on the strength of it.
    const sb = seedApplied("applied");
    sb.seed("applications", [
      { id: "app-1", user_id: USER_ID, position_id: POSITION_ID, status: null, applied_at: null },
    ]);
    const { data } = await runStatusGuard(sb);
    expect(data).toEqual([]);
    expect(appRow(sb).status).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. FABRICATION / RE-STAMP
// ---------------------------------------------------------------------------

describe("REPRO D4 — fabrication: an unconditional 'applied' write re-stamps a genuine applied_at with now()", () => {
  // app/page.js:1955, :2570, :2775 and app/hooks/useManualTailor.js:204 all
  // write status "applied" unconditionally. At :2570 (regenerate a URL-pasted
  // posting) and :2775 (tailor a Live Feed posting) the synthetic position id
  // is deterministic across sessions — `url-${trimmedUrl}` (app/page.js:2475)
  // and the feed external id — so these hit the SAME row the user really
  // applied from, and upsertApplication:27 replaces its applied_at with now().
  //
  // Nothing looks wrong on any screen afterwards: the row still says "applied".
  // Only the one field that says WHEN has been destroyed.

  it("keeps the date the user actually applied when the posting is merely re-tailored", async () => {
    const sb = seedApplied("applied");

    await upsertApplication(sb, { userId: USER_ID, positionId: POSITION_ID, status: "applied" });

    // FAILS TODAY: applied_at is a fresh ISO string for "now".
    expect(appRow(sb).applied_at).toBe(APPLIED_AT);
  });

  it("[pin] shows why a truthiness assertion is not coverage here", async () => {
    // Green before AND after the fix — that is the point. The re-stamped value
    // is a well-formed, non-null, non-empty ISO timestamp, so every assertion
    // of the shape `not.toBeNull()` / `toBeTruthy()` / `expect.any(String)`
    // passes against the defect. Only identity against a seeded value catches
    // it, which is what the test above does.
    const sb = seedApplied("applied");
    await upsertApplication(sb, { userId: USER_ID, positionId: POSITION_ID, status: "applied" });
    const row = appRow(sb);
    expect(row.applied_at).not.toBeNull();
    expect(row.applied_at).toEqual(expect.any(String));
    expect(row.status).toBe("applied");
  });
});
