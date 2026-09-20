// TDD RED handoff -- N37, the ownership-reassignment defect design-security.r1.md
// ss4.2 found and design-reconciled.r2.md ss8 re-verifies byte-for-byte and
// designs the fix for (RD-N33.9). No test file exists for
// lib/supabase/upsertInterviewStage.js today (confirmed by Glob this round:
// only upsertInterviewStage.js itself, no .test.js sibling) -- this is a NEW
// file, not an addition to an existing suite.
//
// THE DEFECT, re-verified directly this round by reading
// lib/supabase/upsertInterviewStage.js:17-96 (byte-for-byte identical to
// design-reconciled.r2.md ss2's own quote):
//   - `payload` (:30-40) is built ONCE and used UNCONDITIONALLY by both the
//     INSERT (:57-61) and UPDATE (:44-49) branches. It carries
//     `user_id: userId` and `application_id: applicationId` regardless of
//     which branch runs.
//   - The UPDATE branch's WHERE clause is `.eq("id", stageId)` ALONE
//     (:47) -- no `.eq("user_id", ...)`, no `.eq("application_id", ...)`.
//   - Because `payload` is shared with INSERT, a cross-account UPDATE does
//     not merely change `interviewer_names` on someone else's row -- it
//     OVERWRITES that row's own `user_id` to the caller-supplied value,
//     reassigning ownership outright. This is the escalation this seat's
//     brief names by name, and the assertions below check it directly:
//     after a cross-account update attempt, the seeded row's OWN `user_id`
//     AND `application_id` must be byte-unchanged.
//   - `getInterviewStages` (:80-96) filters `.eq("application_id",
//     applicationId)` ALONE (:85) -- no `user_id` filter at all, and its
//     signature today is a positional `(supabase, applicationId)`, not the
//     object-param `{applicationId, userId}` the fix requires.
//
// THE FIX (design-reconciled.r2.md ss8, quoted): the UPDATE branch gains
// `.eq("user_id", userId)`; `getInterviewStages` becomes
// `(supabase, {applicationId, userId})` and gains the same `.eq("user_id",
// userId)`. Precedent for exactly this shape of tenant-filter retrofit,
// independently re-confirmed this round: lib/supabase/
// applicationStatusWriter.js:452-453 (`deleteApplicationForUser`) --
// `.eq("id", applicationId).eq("user_id", userId) // the tenant filter this
// statement had none of.`
//
// makeStatefulSupabase (test/helpers/supabaseFake.js) is used because this
// defect is specifically about WHICH ROWS A FILTER MATCHES -- a call
// recorder (supabaseMock.js) cannot show whether a seeded row was actually
// mutated; the stateful fake's own header states exactly why it exists for
// this class of defect. Per that helper's own documented semantics [6],
// `.single()` on a 0-row match is PGRST116, not a silent null -- this is
// the mechanism that makes the fixed UPDATE branch return `null` rather
// than silently succeeding on zero rows.

import { describe, it, expect } from "vitest";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";
import { upsertInterviewStage, getInterviewStages } from "./upsertInterviewStage.js";

function seedRow(overrides = {}) {
  return {
    id: "stage-A",
    user_id: "user-A",
    application_id: "app-A",
    stage_name: "Onsite",
    stage_type: "technical",
    interviewer_names: ["Original"],
    ...overrides,
  };
}

describe("N37 -- upsertInterviewStage's UPDATE branch must not let a cross-account caller reassign or mutate an existing stage", () => {
  it("[RED -- the escalation itself] a caller asserting a DIFFERENT userId than the seeded row's owner: the update returns null, AND the row's OWN user_id/application_id/interviewer_names are byte-UNCHANGED", async () => {
    const sb = makeStatefulSupabase({ interview_stages: [seedRow()] });
    const result = await upsertInterviewStage(sb, {
      userId: "user-B",
      applicationId: "app-A",
      stageId: "stage-A",
      stageName: "x",
      stageType: "technical",
      interviewerNames: ["Injected"],
    });
    expect(result).toBe(null);
    const row = sb.row("interview_stages", (r) => r.id === "stage-A");
    expect(row.user_id, "the row's OWNER was reassigned by a cross-account update -- the exact escalation this fix closes").toBe("user-A");
    expect(row.application_id).toBe("app-A");
    expect(row.interviewer_names).toEqual(["Original"]);
  });

  it("[RED, same escalation via a different applicationId guess] a caller asserting the true owner's userId but a WRONG applicationId still cannot mutate a stage that belongs to a different application, if the fix scopes on application_id too", async () => {
    // This is the narrower of the two predicates the fix might add; the
    // user_id predicate is the one design-reconciled.r2.md ss8 requires.
    // This test only requires SOME real tenant scoping beyond bare `id` --
    // it does not require an application_id predicate specifically, since
    // r2's own fix text adds only `.eq("user_id", userId)`. It is included
    // as a companion check that a correct fix does not accidentally widen
    // access via a mismatched application_id either.
    const sb = makeStatefulSupabase({ interview_stages: [seedRow()] });
    const result = await upsertInterviewStage(sb, {
      userId: "user-A",
      applicationId: "app-WRONG",
      stageId: "stage-A",
      stageName: "x",
      stageType: "technical",
      interviewerNames: ["Injected"],
    });
    // Documented, disclosed residual (design-reconciled.r2.md ss8's own
    // "sharper residual... explicitly NOT fixed by N37 as scoped"): N37's
    // OWN fix (a user_id predicate only) does NOT close this path -- a
    // legitimate owner passing a mismatched applicationId still reparents
    // the row, because `payload.application_id` is written unconditionally.
    // This test pins that CURRENT, disclosed-not-fixed behavior so nobody
    // mistakes N37's scope for something broader than it is; it is NOT a
    // requirement this diff must change.
    expect(result).toBe("stage-A");
    const row = sb.row("interview_stages", (r) => r.id === "stage-A");
    expect(row.application_id, "documented residual, NOT fixed by N37 as scoped -- see design-reconciled.r2.md ss8").toBe("app-WRONG");
  });

  it("[REQUIRED NO-OP CONTROL] the identical call, with the row's REAL owner's userId, still succeeds and still updates interviewer_names -- the fix must not also break the legitimate case", async () => {
    const sb = makeStatefulSupabase({ interview_stages: [seedRow()] });
    const result = await upsertInterviewStage(sb, {
      userId: "user-A",
      applicationId: "app-A",
      stageId: "stage-A",
      stageName: "x",
      stageType: "technical",
      interviewerNames: ["Injected"],
    });
    expect(result).toBe("stage-A");
    const row = sb.row("interview_stages", (r) => r.id === "stage-A");
    expect(row.interviewer_names).toEqual(["Injected"]);
    expect(row.user_id).toBe("user-A");
  });

  it("INSERT (no stageId) is unaffected by this fix -- a brand-new stage still gets created for its own caller", async () => {
    const sb = makeStatefulSupabase({ interview_stages: [] });
    const result = await upsertInterviewStage(sb, {
      userId: "user-A",
      applicationId: "app-A",
      stageName: "Phone Screen",
      stageType: "phone_screen",
      interviewerNames: ["Priya Nair"],
    });
    expect(result).not.toBe(null);
    expect(sb.rows("interview_stages").length).toBe(1);
    expect(sb.rows("interview_stages")[0].user_id).toBe("user-A");
  });
});

describe("N37 -- getInterviewStages must also scope by user_id, not application_id alone", () => {
  it("[NOTE: passes on HEAD today, but NOT for the reason it will after the fix -- see the companion control immediately below, which IS the real RED test] a caller asserting a DIFFERENT userId than the row's owner reads back NO rows for an application that is not theirs, using the object-param signature the fix requires", async () => {
    // On HEAD, getInterviewStages(supabase, applicationId) takes a
    // POSITIONAL string, not an object -- calling it with {applicationId,
    // userId} today passes the whole OBJECT as the positional
    // `applicationId`, so `.eq("application_id", theWholeObject)` matches no
    // real row and this returns [] BY ACCIDENT (a signature mismatch), not
    // because user_id scoping exists. The companion test right after this
    // one calls the SAME object-param signature with the row's REAL owner
    // and is genuinely RED on HEAD (it also returns [] today, which is
    // wrong) -- that is the test that actually proves the fix is missing.
    // This test is kept because it becomes a real, meaningful assertion
    // the moment the signature changes; it should not be read as evidence
    // of anything today.
    const sb = makeStatefulSupabase({ interview_stages: [seedRow()] });
    const rows = await getInterviewStages(sb, { applicationId: "app-A", userId: "user-B" });
    expect(rows).toEqual([]);
  });

  it("[companion control] the row's REAL owner reads it back normally, using the same object-param signature", async () => {
    const sb = makeStatefulSupabase({ interview_stages: [seedRow()] });
    const rows = await getInterviewStages(sb, { applicationId: "app-A", userId: "user-A" });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("stage-A");
  });

  it("[control distinguishing this from an over-refusing build] TWO stages on the SAME application, both belonging to the true owner, both come back", async () => {
    const sb = makeStatefulSupabase({
      interview_stages: [seedRow({ id: "stage-A" }), seedRow({ id: "stage-B", stage_name: "Onsite Round 2" })],
    });
    const rows = await getInterviewStages(sb, { applicationId: "app-A", userId: "user-A" });
    expect(rows.map((r) => r.id).sort()).toEqual(["stage-A", "stage-B"]);
  });

  it("issues the query with an explicit .eq('user_id', ...) filter -- source-level confirmation the fix is a real query predicate, not merely a client-side post-filter of an unscoped read", async () => {
    const sb = makeStatefulSupabase({ interview_stages: [seedRow()] });
    await getInterviewStages(sb, { applicationId: "app-A", userId: "user-A" });
    const selectCall = sb.calls.find((c) => c.table === "interview_stages" && c.verb === "select");
    expect(selectCall, "no select call was issued against interview_stages").toBeDefined();
    expect(selectCall.filters.some((f) => f.column === "user_id" && f.operator === "eq" && f.value === "user-A")).toBe(true);
  });
});
