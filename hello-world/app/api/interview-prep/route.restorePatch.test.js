// ---------------------------------------------------------------------------
// N46's restore surface -- PATCH /api/interview-prep. Plan step S9.
// AC-N46.1, AC-N46.1b, AC-CONC.3, AC-O15.6, AC-UX.4, AC-UX.5.
//
// RED BECAUSE THE HANDLER DOES NOT EXIST. `PATCH` imports as `undefined`
// today, so every test below fails with "PATCH is not a function" -- the
// clearest possible statement of what is missing.
//
// ---------------------------------------------------------------------------
// A CONTRACT THIS FILE FIXES, because the plan left it open.
// ---------------------------------------------------------------------------
// Plan §S9 names the handler, its gates and its concurrency guard, but not the
// request body. These tests bind it to:
//
//     PATCH { applicationId, section, revision }
//
// and NOTHING else. In particular the `updated_at` precondition is NOT a body
// field: plan risk R13 requires it be read IN THE SAME REQUEST, because a
// client-supplied value is a precondition the client can simply get wrong (or
// replay), which turns an optimistic guard into a decoration. If a later seat
// changes this shape, it changes here first.
//
// ---------------------------------------------------------------------------
// A CONTRADICTION IN THE PLAN, recorded rather than silently resolved.
// ---------------------------------------------------------------------------
// Plan §S9 describes the restore issuing its own predicated UPDATE, while
// ledger line P12 / AC-CLAIM.6 require interview_prep_packs to have exactly
// ONE writer in the tree (prepClaims.sweep.test.js enforces that count). Both
// cannot hold if the restore writes the packs row directly. This file does not
// pick the mechanism -- it asserts the observable behaviour either way -- but
// the single-writer census is the binding constraint, so the restore must
// reach the table through writePrepPackResult with the lease-token predicate
// swapped for the optimistic one, not through a second `.update(` site.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({ listDigests: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import * as route from "./route.js";

const APP_ID = "app-patch-1";
const REVISIONS_TABLE = "interview_prep_section_revisions";
const SECTION = "aboutYou";

const CANDIDATE_NAME = "Alex Shaw";
/** Uncited and name-shaped: K1-SHAPE drops it unless a stored name exempts it. */
const NAME_LINE = "Alex Shaw rebuilt the settlement pipeline.";

function answer(...texts) {
  return { answer: { lines: texts.map((text) => ({ text, support: null })) } };
}

function questions(...texts) {
  return { questions: texts.map((text) => ({ text, support: null })) };
}

function stages() {
  return { stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }] };
}

const OLD_TEXT = "The version I want back.";
const LIVE_TEXT = "The version that is live right now.";

let userCounter = 0;

function seedTree({ withStoredName = false, packsStatus = "ready", errors = {} } = {}) {
  userCounter += 1;
  const userId = `user-patch-${userCounter}`;
  const livePack = {
    version: 1,
    sections: {
      aboutYou: answer(LIVE_TEXT),
      whyRole: answer("The fleet problem is the one I want next."),
      askThem: questions("How is this team's work measured?"),
      stages: stages(),
    },
    claims: [],
  };

  const sb = makeStatefulSupabase(
    {
      applications: [{ id: APP_ID, user_id: userId, position_id: "pos-patch-1" }],
      positions: [{ id: "pos-patch-1", title: "Engineer", company: "Acme", description: "Build things." }],
      candidate_identity: withStoredName ? [{ user_id: userId, candidate_name: CANDIDATE_NAME }] : [],
      application_trusted_names: [],
      interview_prep_packs: [
        {
          id: "pack-patch-1",
          application_id: APP_ID,
          user_id: userId,
          status: packsStatus,
          pack: livePack,
          live_revisions: { aboutYou: 2, whyRole: 1, askThem: 1, stages: 1 },
          lease_token: null,
          lease_until: null,
          updated_at: "2026-09-10T00:00:00.000Z",
        },
      ],
      [REVISIONS_TABLE]: [
        {
          id: "rev-a1",
          application_id: APP_ID,
          user_id: userId,
          section: SECTION,
          revision: 1,
          // The line that only survives if the CURRENT stored names are
          // applied at restore time (AC-O15.6). It was generated before any
          // name was on file.
          content: answer(OLD_TEXT, NAME_LINE),
          claims: [],
          engine: "gemini",
          content_version: 1,
          restored_from: null,
          created_at: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "rev-a2",
          application_id: APP_ID,
          user_id: userId,
          section: SECTION,
          revision: 2,
          content: answer(LIVE_TEXT),
          claims: [],
          engine: "gemini",
          content_version: 1,
          restored_from: null,
          created_at: "2026-09-02T00:00:00.000Z",
        },
        ...["whyRole", "askThem", "stages"].map((section, i) => ({
          id: `rev-${section}-1`,
          application_id: APP_ID,
          user_id: userId,
          section,
          revision: 1,
          content: section === "askThem" ? questions("How is this team's work measured?") : section === "stages" ? stages() : answer("The fleet problem is the one I want next."),
          claims: [],
          engine: "gemini",
          content_version: 1,
          restored_from: null,
          created_at: `2026-09-0${i + 1}T00:00:00.000Z`,
        })),
      ],
    },
    {
      user: { id: userId },
      relationships: {
        "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" },
      },
      errors,
    },
  );

  return { sb, userId, livePack };
}

function patchRequest(body) {
  return new Request("http://localhost/api/interview-prep", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: APP_ID, section: SECTION, revision: 1, ...body }),
  });
}

function getRequest() {
  return new Request(`http://localhost/api/interview-prep?applicationId=${APP_ID}`, { method: "GET" });
}

async function restore(sb, body) {
  createClient.mockResolvedValue(sb);
  const res = await route.PATCH(patchRequest(body));
  return { res, body: await res.json() };
}

async function readBack(sb) {
  createClient.mockResolvedValue(sb);
  return await (await route.GET(getRequest())).json();
}

function aboutYouLines(pack) {
  return (pack?.sections?.aboutYou?.answer?.lines || []).map((line) => line.text);
}

/**
 * Holds the FIRST UPDATE against `table` open until the test releases it, so
 * two requests are genuinely in flight at once. supabaseFake resolves every
 * statement immediately; a same-tick test of a lost-update guard tests
 * sequencing, not concurrency, and stays green for the very build that loses
 * the write.
 */
function holdFirstUpdate(sb, table) {
  const realFrom = sb.from;
  const gate = [];
  let armed = true;
  sb.from = vi.fn((requested) => {
    const builder = realFrom(requested);
    if (requested !== table) return builder;
    let isUpdate = false;
    const realUpdate = builder.update;
    builder.update = vi.fn((payload) => {
      isUpdate = true;
      return realUpdate(payload);
    });
    const realThen = builder.then;
    builder.then = (onOk, onErr) => {
      if (!isUpdate || !armed) return realThen(onOk, onErr);
      armed = false;
      return new Promise((release) => gate.push(release))
        .then(() => new Promise((res, rej) => realThen(res, rej)))
        .then(onOk, onErr);
    };
    return builder;
  });
  return gate;
}

/** Yields real macrotasks until `predicate` holds, or gives up. Used to wait
 *  for the first request to actually REACH its held UPDATE -- a fixed number
 *  of microtask ticks is not enough (the handler awaits ~10 statements first),
 *  and guessing one is how a concurrency test silently degrades into a
 *  sequential one. */
async function waitUntil(predicate, label) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`[instrument] gave up waiting for: ${label}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AC-N46.1 / AC-N46.1b -- restoring one section", () => {
  it("[RED: PATCH does not exist] a restore makes that section's content match the named historical revision", async () => {
    const { sb } = seedTree();
    const before = await readBack(sb);
    expect(aboutYouLines(before.pack)).toContain(LIVE_TEXT);

    const { body } = await restore(sb);
    expect(body.status).toBe("restored");

    const after = await readBack(sb);
    expect(aboutYouLines(after.pack)).toContain(OLD_TEXT);
    expect(aboutYouLines(after.pack)).not.toContain(LIVE_TEXT);
  });

  it("[RED: PATCH does not exist -- AC-N46.1b] the other three sections are byte-identical afterwards", async () => {
    const { sb } = seedTree();
    const before = await readBack(sb);

    await restore(sb);

    const after = await readBack(sb);
    for (const section of ["whyRole", "askThem", "stages"]) {
      expect(JSON.stringify(after.pack.sections[section]), `section ${section} changed`).toBe(
        JSON.stringify(before.pack.sections[section]),
      );
    }
  });

  it("[RED: PATCH does not exist] a restore APPENDS a new revision carrying restoredFrom, and never rewinds the counter", async () => {
    // Restore-appends is what makes restore itself reversible (AC-UX.3's own
    // reasoning for not demanding a confirmation dialog). A rewind would
    // destroy the version the candidate is restoring away from.
    const { sb } = seedTree();
    await restore(sb);

    const rows = sb.rows(REVISIONS_TABLE).filter((r) => r.section === SECTION);
    expect(rows.map((r) => r.revision).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    const appended = rows.find((r) => r.revision === 3);
    expect(appended.restored_from).toBe(1);
    // The original is untouched -- the table takes no UPDATE grant at all.
    expect(rows.find((r) => r.revision === 1).content.answer.lines[0].text).toBe(OLD_TEXT);
  });

  it("[RED: PATCH does not exist] a revision that does not exist is a 404, not a silent no-op", async () => {
    const { sb } = seedTree();
    const { res } = await restore(sb, { revision: 99 });
    expect(res.status).toBe(404);
  });

  it("[RED: PATCH does not exist] an unrecognized section is a 400", async () => {
    const { sb } = seedTree();
    const { res } = await restore(sb, { section: "aboutyou" });
    expect(res.status).toBe(400);
  });
});

describe("AC-O15.6 (H2) -- a restored section is re-screened against the CURRENT stored names", () => {
  it("[RED: PATCH does not exist] a name added AFTER that revision was generated exempts it on restore", async () => {
    // The design forbids snapshotting names into a revision row. This is the
    // PASS half: the exemption must follow today's trusted names, not the
    // ones in force when the content was written.
    const { sb } = seedTree({ withStoredName: true });
    await restore(sb);
    const after = await readBack(sb);
    expect(aboutYouLines(after.pack)).toContain(NAME_LINE);
  });

  it("[negative control -- proves the assertion above is not vacuous] with NO stored name, the identical line is refused on restore", async () => {
    const { sb } = seedTree({ withStoredName: false });
    await restore(sb);
    const after = await readBack(sb);
    expect(aboutYouLines(after.pack)).not.toContain(NAME_LINE);
    // ...while the rest of the restored revision still lands, so this is a
    // refusal of one line, not a failed restore.
    expect(aboutYouLines(after.pack)).toContain(OLD_TEXT);
  });
});

describe("AC-CONC.3 -- two concurrent restores of the same section", () => {
  it("[RED: PATCH does not exist] exactly one wins; the loser reports conflict and writes nothing to the packs row", async () => {
    // The delayed promise is load-bearing. With both requests resolving
    // instantly, whichever runs second simply re-reads the row the first
    // already committed and there is no race to lose -- the test would be
    // green for an implementation with no optimistic guard at all.
    const { sb } = seedTree();
    const gate = holdFirstUpdate(sb, "interview_prep_packs");

    // The first request is deliberately NOT awaited yet -- it has to still be
    // running when the second starts. Its rejection is captured here rather
    // than left floating: an unhandled rejection is reported by the runner as
    // an error OUTSIDE any test, which is exactly the shape that gets read as
    // noise and ignored.
    let firstError = null;
    const first = restore(sb).catch((err) => {
      firstError = err;
      return { body: { status: `threw: ${err?.message}` } };
    });
    await waitUntil(
      () => gate.length === 1 || firstError !== null,
      "the first restore to reach its packs UPDATE",
    );
    const second = await restore(sb, { revision: 2 }).catch((err) => ({ body: { status: `threw: ${err?.message}` } }));

    expect(firstError, `the first restore threw instead of running: ${firstError?.message}`).toBeNull();
    expect(gate, "the first UPDATE was never held open -- this test is not concurrent").toHaveLength(1);
    gate[0]();
    const firstResult = await first;

    const outcomes = [firstResult.body.status, second.body.status].sort();
    expect(outcomes, `expected one restored and one conflict, got ${JSON.stringify(outcomes)}`).toEqual([
      "conflict",
      "restored",
    ]);

    // The losing request contributed no packs-row write at all: the pointer
    // names exactly one target, never a blend of the two.
    const row = sb.row("interview_prep_packs", (r) => r.application_id === APP_ID);
    expect([3, 4]).toContain(row.live_revisions.aboutYou);
  });

  it("[no-op control] a SINGLE restore, with nothing racing it, is not refused as a conflict", async () => {
    // Without this, an optimistic guard that always refuses satisfies the
    // test above.
    const { sb } = seedTree();
    const { body } = await restore(sb);
    expect(body.status).toBe("restored");
  });

  it("F-m15: the loser's own PATCH leaves no phantom revision row behind -- the table grows by exactly one, not two", async () => {
    const { sb } = seedTree();
    const gate = holdFirstUpdate(sb, "interview_prep_packs");
    const before = sb.rows(REVISIONS_TABLE).filter((r) => r.section === SECTION).map((r) => r.revision);

    let firstError = null;
    const first = restore(sb).catch((err) => {
      firstError = err;
      return { body: { status: `threw: ${err?.message}` } };
    });
    await waitUntil(
      () => gate.length === 1 || firstError !== null,
      "the first restore to reach its packs UPDATE",
    );
    const second = await restore(sb, { revision: 2 }).catch((err) => ({ body: { status: `threw: ${err?.message}` } }));

    expect(firstError, `the first restore threw instead of running: ${firstError?.message}`).toBeNull();
    expect(gate, "the first UPDATE was never held open -- this test is not concurrent").toHaveLength(1);
    gate[0]();
    const firstResult = await first;

    const outcomes = [firstResult.body.status, second.body.status].sort();
    expect(outcomes, `expected one restored and one conflict, got ${JSON.stringify(outcomes)}`).toEqual([
      "conflict",
      "restored",
    ]);

    // Only the WINNER's own append may survive: a lost race must not leave
    // the loser's own revision row behind as a phantom "restored" version
    // nothing ever points to.
    const after = sb.rows(REVISIONS_TABLE).filter((r) => r.section === SECTION);
    expect(after.length, "a lost restore race left a phantom revision row behind").toBe(before.length + 1);

    // F-A1 (fix round): identity, not merely count. route.js's cleanup call
    // (`deleteSectionRevision(..., { revision: newRevision })`) has both
    // `revision` (the restore SOURCE, from the request body) and
    // `newRevision` (this restore's own freshly appended row) in scope one
    // line apart -- a mutant that deletes `revision` instead removes exactly
    // one row too, same as the real fix, so the count assertion above cannot
    // tell them apart. Every ORIGINAL row (both restores' own source
    // revisions, 1 and 2, included) must survive: only a row NEITHER restore
    // was ever asked to restore FROM -- the loser's own freshly appended one
    // -- may be gone.
    for (const revision of before) {
      expect(
        after.some((r) => r.revision === revision),
        `original revision ${revision} was removed by the cleanup -- the cleanup deleted a SOURCE row, not the phantom`,
      ).toBe(true);
    }
  });

  it("[no-op control] a SINGLE successful restore still appends exactly one revision row, not zero", async () => {
    // Without this, a "fix" that deletes the appended row unconditionally --
    // not only on a lost race -- would satisfy the assertion above for the
    // wrong reason.
    const { sb } = seedTree();
    const countBefore = sb.rows(REVISIONS_TABLE).length;
    await restore(sb);
    expect(sb.rows(REVISIONS_TABLE).length).toBe(countBefore + 1);
  });
});

describe("F-A2 (fix round) -- the race the delete cleanup actually exists for", () => {
  // The SAME-section race above (AC-CONC.3) never lets two inserts collide on
  // one (section, revision): appendSectionRevisions' own PK makes that
  // impossible in production, and this harness's `.insert()` resolves each
  // restore's own append to completion before the next one is even issued --
  // by the time a second same-section restore reads `newestBySection`, the
  // first restore (already past its own held packs UPDATE) has already
  // landed its append, so the second always allocates the NEXT number, never
  // a colliding one. What genuinely races in production, and what this suite
  // was missing, is two DIFFERENT writers -- here, two DIFFERENT sections'
  // restores -- both racing the SAME packs row's optimistic `updated_at`.
  it("a restore of one section can lose the packs-row race to a concurrent restore of a DIFFERENT section -- only the loser's OWN section's appended row is cleaned up", async () => {
    const { sb } = seedTree();
    const gate = holdFirstUpdate(sb, "interview_prep_packs");
    const beforeAboutYou = sb.rows(REVISIONS_TABLE).filter((r) => r.section === SECTION).map((r) => r.revision);
    const beforeWhyRole = sb.rows(REVISIONS_TABLE).filter((r) => r.section === "whyRole").map((r) => r.revision);

    let firstError = null;
    const first = restore(sb).catch((err) => {
      firstError = err;
      return { body: { status: `threw: ${err?.message}` } };
    });
    await waitUntil(
      () => gate.length === 1 || firstError !== null,
      "the first restore (aboutYou) to reach its packs UPDATE",
    );
    const second = await restore(sb, { section: "whyRole", revision: 1 }).catch((err) => ({
      body: { status: `threw: ${err?.message}` },
    }));

    expect(firstError, `the first restore threw instead of running: ${firstError?.message}`).toBeNull();
    expect(gate, "the first UPDATE was never held open -- this test is not concurrent").toHaveLength(1);
    gate[0]();
    const firstResult = await first;

    const outcomes = [firstResult.body.status, second.body.status].sort();
    expect(outcomes, `expected one restored and one conflict, got ${JSON.stringify(outcomes)}`).toEqual([
      "conflict",
      "restored",
    ]);

    // Every ORIGINAL row of BOTH sections survives the cleanup, whichever
    // section actually lost.
    const afterAboutYou = sb.rows(REVISIONS_TABLE).filter((r) => r.section === SECTION);
    const afterWhyRole = sb.rows(REVISIONS_TABLE).filter((r) => r.section === "whyRole");
    for (const revision of beforeAboutYou) {
      expect(afterAboutYou.some((r) => r.revision === revision), `aboutYou revision ${revision} was removed by the cleanup`).toBe(true);
    }
    for (const revision of beforeWhyRole) {
      expect(afterWhyRole.some((r) => r.revision === revision), `whyRole revision ${revision} was removed by the cleanup`).toBe(true);
    }

    // aboutYou is the request `holdFirstUpdate` intercepts (the first
    // `.update(` call against the packs table), so it is deterministically
    // the loser here: its own freshly appended row is the phantom, and only
    // ITS section's row count stays unchanged while whyRole's grows by one.
    expect(afterAboutYou.length, "aboutYou's own appended (losing) row was not cleaned up").toBe(beforeAboutYou.length);
    expect(afterWhyRole.length, "whyRole's own appended (winning) row did not survive").toBe(beforeWhyRole.length + 1);
  });

  it("the append's own PK conflict (23505) reaches PATCH as a 500, not the packs-race's 409 -- the two concurrency guards answer differently (F-m4, minor, recorded rather than aligned this round)", async () => {
    // AC-CONC.2 (prepSectionRevisions.test.js) already pins that
    // appendSectionRevisions itself reports reason:"conflict" on a 23505 and
    // never retries or throws. What was untested is PATCH's OWN handling of
    // that reason -- route.js:958's `if (appended.reason)` branch, reached
    // only when the insert conflicts BEFORE the packs write is ever
    // attempted, so there is no row for the F-m15 cleanup to remove.
    const { sb } = seedTree({ errors: { [REVISIONS_TABLE]: { insert: { code: "23505", message: 'duplicate key value violates unique constraint "interview_prep_section_revisions_pkey"' } } } });
    const countBefore = sb.rows(REVISIONS_TABLE).length;
    const { res, body } = await restore(sb);
    expect(res.status).toBe(500);
    expect(body.error).toBe("Could not save this restore.");
    // No row was ever inserted -- the conflict is at the database, before
    // this restore's own append could be recorded at all.
    expect(sb.rows(REVISIONS_TABLE).length).toBe(countBefore);
  });
});

describe("F-M4 (fix round) -- the PATCH ownership gate is a real, tested defence", () => {
  // Every downstream query PATCH issues (readLiveSectionRevisions,
  // readSectionRevision, writePrepPackResult's own `.update(`) ALSO scopes
  // by the session's own user_id, so an ordinary cross-tenant PATCH 404s
  // even with `loadOwnedApplication` deleted -- that redundancy is exactly
  // why the mutant survived 407 tests with no instrument catching it
  // (verify.r2.md F-M4). To exercise the gate ITSELF -- the thing its own
  // header claims defends against "even if RLS is ever misconfigured" -- this
  // drops every OTHER query's own user_id scoping, simulating exactly that
  // misconfiguration, so `loadOwnedApplication` is the ONLY thing left
  // standing between an authenticated stranger and someone else's pack.
  function dropUserScoping(sb, tables) {
    const realFrom = sb.from;
    sb.from = vi.fn((table) => {
      const builder = realFrom(table);
      if (!tables.includes(table)) return builder;
      const realEq = builder.eq;
      builder.eq = vi.fn((column, value) => (column === "user_id" ? builder : realEq(column, value)));
      return builder;
    });
  }

  it("refuses a cross-tenant restore even when every OTHER query's own user_id scoping is gone (simulated RLS gap)", async () => {
    const { sb } = seedTree();
    dropUserScoping(sb, ["interview_prep_packs", REVISIONS_TABLE]);
    // Re-authenticate as a stranger to the row seedTree built -- `applications`
    // keeps its own real user_id scoping (untouched above), so the gate is
    // the only thing that can still catch this.
    sb.auth.getUser = vi.fn(async () => ({ data: { user: { id: "attacker-user" } }, error: null }));

    const before = sb.rows(REVISIONS_TABLE).filter((r) => r.section === SECTION).map((r) => r.revision).sort();
    const { res } = await restore(sb);
    expect(res.status, "a cross-tenant restore was not refused with a 404").toBe(404);

    const after = sb.rows(REVISIONS_TABLE).filter((r) => r.section === SECTION).map((r) => r.revision).sort();
    expect(after, "a cross-tenant restore appended a revision row").toEqual(before);
    const row = sb.row("interview_prep_packs", (r) => r.application_id === APP_ID);
    expect(row.live_revisions.aboutYou, "a cross-tenant restore moved the live pointer").toBe(2);
  });

  it("[no-op control] the SAME simulated RLS gap, with the real owner's own session, still restores normally", async () => {
    // Without this, a gate-removal that ALSO broke ordinary same-tenant
    // restores would pass the test above for the wrong reason.
    const { sb } = seedTree();
    dropUserScoping(sb, ["interview_prep_packs", REVISIONS_TABLE]);
    const { body } = await restore(sb);
    expect(body.status).toBe("restored");
  });
});

describe("AC-UX.4 / AC-UX.5 -- restore spends nothing and survives a spend outage", () => {
  it("[RED: PATCH does not exist -- AC-UX.4] restore works with PREP_DISABLED=1", async () => {
    // Mirrors GET/DELETE's existing O-16 exemption: a read or a removal
    // spends no model call and must survive the kill switch. Restore spends
    // none either, and a candidate locked out of their own stored history
    // during an outage is the outcome that exemption exists to prevent.
    vi.stubEnv("PREP_DISABLED", "1");
    const { sb } = seedTree();
    const { res, body } = await restore(sb);
    expect(res.status).not.toBe(503);
    expect(body.status).toBe("restored");
  });

  it("[RED: PATCH does not exist -- AC-UX.5] restore issues no claim RPC and no model-call record", async () => {
    const { sb } = seedTree();
    await restore(sb);
    const rpcs = sb.calls.filter((c) => c.verb === "rpc").map((c) => c.fn);
    expect(rpcs).not.toContain("claim_prep_pack_slot");
    expect(rpcs).not.toContain("record_prep_model_call");
  });

  it("[RED: PATCH does not exist] a restore is refused while the row is genuinely running", async () => {
    const { sb } = seedTree({ packsStatus: "running" });
    const { res } = await restore(sb);
    expect(res.status).toBe(409);
  });
});

describe("F-R12-3 (fix round r12, MAJOR, verify.r12.md) -- PATCH's own base-read refusal never carries the database's own error text", () => {
  // The PATCH twin of route.section.fixRound3.test.js's own F-R11-2 test
  // (probe Q3's shape, verify.r12.md): that file drives POST only, so
  // reverting PATCH's own sanitisation at route.js:926 (mutant
  // PATCHSAN-rawErrorBack, <scratch>/r12/mutants.json) survived 785/785 --
  // nothing exercised the PATCH half of the fix at all.
  it("a packs-table read failure refuses the PATCH (500) with the generic sentence, never the raw database text", async () => {
    const injected = "PGRST301 relation interview_prep_section_revisions does not exist at char 42";
    const { sb } = seedTree({ errors: { interview_prep_packs: { select: { message: injected } } } });

    const { res, body } = await restore(sb);

    expect(res.status).toBe(500);
    expect(body.error).toBe("Could not load this application's prep pack.");
    expect(JSON.stringify(body), "the database's own error text reached the response body").not.toContain(injected);
  });

  it("[no-op control] the SAME tree with no injected failure restores normally, on the SAME code path", async () => {
    const { sb } = seedTree();
    const { res, body } = await restore(sb);
    expect(res.status).toBe(200);
    expect(body.status).toBe("restored");
  });
});

describe("F-m1 (fix round r10, minor) -- PATCH's own base read never pulls round-two bodies it does not use", () => {
  it("issues no targeted (revision-eq) select against the revisions table besides the restore target's own read", async () => {
    // seedTree's own pointer names FOUR sections (aboutYou/whyRole/askThem/
    // stages). Before this fix, readLiveSectionRevisions' round two read all
    // four full bodies for a base PATCH never inspects (route.js reads only
    // status/pack/liveRevisions/newestBySection/updatedAt off it) -- on top
    // of readSectionRevision's own explicit read of the restore TARGET a few
    // lines later. `withBodies:false` should leave exactly that one.
    const { sb } = seedTree();
    await restore(sb);
    const targeted = sb.calls.filter(
      (c) => c.table === REVISIONS_TABLE && c.verb === "select" && c.filters.some((f) => f.operator === "eq" && f.column === "revision"),
    );
    expect(targeted.length, `PATCH pulled ${targeted.length} full-body revision reads -- round two's own discarded bodies are back`).toBe(1);
  });
});

describe("F-m4 (fix round r10, minor) -- a failed restore cleanup is recorded, not only logged", () => {
  it("a lost race whose own cleanup delete ALSO fails records a ('delete','error') event for that section", async () => {
    const { sb } = seedTree({ errors: { [REVISIONS_TABLE]: { delete: { message: "delete blew up" } } } });
    const gate = holdFirstUpdate(sb, "interview_prep_packs");

    let firstError = null;
    const first = restore(sb).catch((err) => {
      firstError = err;
      return { body: { status: `threw: ${err?.message}` } };
    });
    await waitUntil(() => gate.length === 1 || firstError !== null, "the first restore to reach its packs UPDATE");
    const second = await restore(sb, { revision: 2 }).catch((err) => ({ body: { status: `threw: ${err?.message}` } }));

    expect(firstError, `the first restore threw instead of running: ${firstError?.message}`).toBeNull();
    gate[0]();
    const firstResult = await first;
    const outcomes = [firstResult.body.status, second.body.status].sort();
    expect(outcomes).toEqual(["conflict", "restored"]);

    const cleanupEvents = sb.rows("interview_prep_events").filter((e) => e.event_type === "delete" && e.outcome === "error");
    expect(cleanupEvents, "a failed restore cleanup left no record at all -- console.warn only, unchanged from before this fix").toHaveLength(1);
    expect(cleanupEvents[0].section).toBe(SECTION);
  });

  it("[no-op control] a lost race whose cleanup delete SUCCEEDS records no such event", async () => {
    const { sb } = seedTree();
    const gate = holdFirstUpdate(sb, "interview_prep_packs");

    let firstError = null;
    const first = restore(sb).catch((err) => {
      firstError = err;
      return { body: { status: `threw: ${err?.message}` } };
    });
    await waitUntil(() => gate.length === 1 || firstError !== null, "the first restore to reach its packs UPDATE");
    await restore(sb, { revision: 2 });
    gate[0]();
    await first;

    const cleanupEvents = sb.rows("interview_prep_events").filter((e) => e.event_type === "delete" && e.outcome === "error");
    expect(cleanupEvents, "a SUCCESSFUL cleanup still recorded a failure event").toHaveLength(0);
  });
});
