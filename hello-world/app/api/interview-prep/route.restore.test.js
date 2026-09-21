// ---------------------------------------------------------------------------
// N47 / AC-N45.2 -- a FAILED regeneration must leave the previous document
// intact and reachable. This file is the 4b seat's first deliverable and it
// is RED on HEAD today, with no N45/N46 code anywhere in the tree.
//
// WHY IT IS RED, traced on today's source rather than asserted:
//   1. claim_prep_pack_slot's re-claim branch sets `pack = '{}'::jsonb`
//      unconditionally, BEFORE the prompt is ever built
//      (supabase/migrations/20260922000000_interview_prep_remove_spend_caps.sql:92).
//   2. Every failure/unavailable branch in route.js calls finishAttempt with a
//      payload carrying no `pack` key (route.js:299, 386, 457, 471, 535).
//   3. writePrepPackResult destructures `pack` with NO default
//      (prepStore.js:371) and only adds it to the UPDATE's SET list when it is
//      defined (prepStore.js:429).
//   So the UPDATE never names `pack`, the column keeps `'{}'`, and the
//   candidate's document is gone. Three sections of prose and a status change
//   are all the candidate gets back.
//
// HOW THIS FILE DRIVES IT: the REAL POST and GET handlers (never a mock of
// them) against test/helpers/supabaseFake.js's stateful in-memory PostgREST,
// mocking only the network-facing edges -- the Supabase client, the Gemini
// client, server env, and the digest lookup. This is the same instrument
// shape route.trustedNamesWiring.test.js already uses, and it is deliberate:
// a test that called writePrepPackResult directly with a hand-built payload
// would pass for a build in which no route branch ever supplies that payload.
// A candidate reaches this defect by clicking "regenerate"; this file reaches
// it by POSTing.
//
// ---------------------------------------------------------------------------
// THE LOAD-BEARING PIECE OF THIS HARNESS: the claim RPC's own side effect.
// ---------------------------------------------------------------------------
// supabaseFake models tables, not stored procedures -- its `rpc` option
// returns a canned value and performs NO side effect. A claim that does not
// blank `pack` would make every test below pass on HEAD, which is precisely
// the "tested the easier mutant" trap. applyClaimSlot() therefore replays
// claim_prep_pack_slot's ON CONFLICT branch statement for statement from the
// migration's own text (cited line by line beside it). If that replay is
// wrong, these tests measure nothing -- so it carries its own canary test
// ([harness canary] below), which asserts the blanking actually happened on a
// run that does not depend on any N45 code at all.
// ---------------------------------------------------------------------------
//
// WHAT THIS FILE CANNOT CATCH, stated plainly:
//   - A real Postgres refusing the restore write on a CHECK this replay does
//     not model. No Postgres is reachable from this checkout (plan §9.1).
//     interview_prep_packs_ready_is_complete / _claims_is_array are both
//     conditioned on `status in ('ready','partial')` and
//     _running_has_no_content on `status = 'running'`, so a terminal 'failed'
//     row holding a full document violates none of them -- read, not executed.
//   - Whether `researched_at` comes back. It cannot: _researched_at_terminal
//     forbids a non-null value on a 'failed' row (plan §2.6.1). Nothing below
//     asserts it does.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({ listDigests: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { listDigests } from "@/lib/supabase/applicationDigests";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { normalizePack } from "@/lib/interviewPrep/prepParse.js";
import { POST, GET } from "./route.js";

const APP_ID = "app-restore-1";
const POSITION = {
  id: "pos-restore-1",
  title: "Engineer",
  company: "Acme Robotics",
  description: "Build things for the fleet.",
};
const LEASE_TOKEN = "lease-restore-fixed";

// ---------------------------------------------------------------------------
// INSTRUMENT I5 -- a STORED-NAME-BEARING pack fixture (plan §6.3, risk R1).
//
// This is the single highest-value line in the file. `EXEMPT_LINE` is a
// Title-Case, name-shaped, UNCITED span: K1-SHAPE drops it outright unless a
// trusted name exempts it (prepParse.js's refusesLine / isUserSuppliedName).
// So a pack containing it is only byte-stable across a restore if the restore
// path resolves the candidate's real stored names.
//
// WHY IT MATTERS (plan gap G2): writePrepPackResult re-normalizes every pack
// it is handed (prepStore.js:382) with `storedNames = []` by default, and
// readTrustedNames resolves at route.js:507 -- AFTER five of the seven
// finishAttempt call sites (:299, :386, :401, :457, :471). A restore built on
// any of those paths is therefore re-screened against NO trusted names and
// silently drops every line the exemption preserved. The document comes back
// THINNER than it went in and nothing anywhere says so.
//
// Without this fixture the whole file passes on a name-free pack and G2 ships
// behind a green suite. [fixture power] below is the guard on that.
// ---------------------------------------------------------------------------
const CANDIDATE_NAME = "Alex Shaw";
const INTERVIEWER_NAME = "Priya Nair";
const STORED_NAMES = [CANDIDATE_NAME, INTERVIEWER_NAME];
const EXEMPT_LINE = "Alex Shaw led the migration to the new platform.";

function packWithExemptLine() {
  return {
    version: 1,
    sections: {
      aboutYou: {
        answer: {
          lines: [
            { text: EXEMPT_LINE, support: null },
            { text: "I have shipped payment rails end to end.", support: null },
          ],
        },
      },
      whyRole: { answer: { lines: [{ text: "This role matches my background in payments.", support: null }] } },
      askThem: { questions: [{ text: "How is this team's work measured?", support: null }] },
      stages: {
        stages: [
          { name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null },
        ],
      },
    },
    claims: [],
  };
}

/** A DIFFERENT, valid pack -- what a SUCCESSFUL regeneration returns. Used by
 *  the no-op control: a build that restores unconditionally would put the old
 *  document back over this one, and that control is the only thing below that
 *  can tell "restores on failure" from "never replaces anything". */
function freshGeneratedPack() {
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: [{ text: "I build reliable systems for busy teams.", support: null }] } },
      whyRole: { answer: { lines: [{ text: "The fleet problem is the one I want next.", support: null }] } },
      askThem: { questions: [{ text: "What does the first quarter look like?", support: null }] },
      stages: {
        stages: [{ name: "Screen", questions: ["Walk me through a project."], recommendedAnswer: null, support: null }],
      },
    },
    claims: [],
  };
}

/** The pack as it sits in the column: normalized once, with the real names in
 *  force, exactly as writePrepPackResult would have stored it. */
function storedReadyPack() {
  return normalizePack(packWithExemptLine(), STORED_NAMES);
}

function aboutYouLines(pack) {
  return (pack?.sections?.aboutYou?.answer?.lines || []).map((line) => line.text);
}

// ---------------------------------------------------------------------------
// claim_prep_pack_slot, replayed. Cited statement by statement against
// supabase/migrations/20260922000000_interview_prep_remove_spend_caps.sql:86-102.
// ---------------------------------------------------------------------------
function applyClaimSlot(sb, { applicationId, userId, leaseToken, leaseUntil }) {
  const rows = sb.rows("interview_prep_packs");
  const row = rows.find((r) => r.application_id === applicationId && r.user_id === userId);
  const nowIso = new Date().toISOString();

  if (!row) {
    // `insert into ... values (..., 'running', ...)` -- the no-conflict branch (:86-87).
    rows.push({
      id: `pack-${applicationId}`,
      application_id: applicationId,
      user_id: userId,
      status: "running",
      lease_until: leaseUntil,
      lease_token: leaseToken,
      pack: {},
      researched_at: null,
      reason: null,
      updated_at: nowIso,
    });
    sb.seed("interview_prep_packs", rows);
    return true;
  }

  // `where interview_prep_packs.status <> 'running' or ... lease_until < now()` (:97).
  const reclaimable = row.status !== "running" || (row.lease_until != null && row.lease_until < nowIso);
  // `get diagnostics v_rows = row_count; if v_rows = 0 then return false` (:99-102).
  if (!reclaimable) return false;

  row.status = "running"; // :89
  row.lease_until = leaseUntil; // :90
  row.lease_token = leaseToken; // :91
  row.pack = {}; // :92 -- THE DEFECT N47 NAMES. Before the prompt is built.
  row.researched_at = null; // :93
  row.reason = null; // :94
  row.updated_at = nowIso; // :95
  sb.seed("interview_prep_packs", rows);
  return true;
}

let userCounter = 0;

/**
 * Every test gets its OWN userId. The route's rate limiter is built at module
 * scope and keyed on the caller's id (route.js:133, identify()), so a shared
 * id would let the 12th POST in this file be answered 429 instead of running
 * the branch under test -- a failure that looks exactly like a real red.
 */
function seedTree({
  storedPack = storedReadyPack(),
  storedStatus = "ready",
  withTrustedNames = true,
  description = POSITION.description,
  leaseUntil = null,
  recordModelCall = true,
} = {}) {
  userCounter += 1;
  const userId = `user-restore-${userCounter}`;
  const packRows =
    storedPack === null
      ? []
      : [
          {
            id: `pack-${APP_ID}`,
            application_id: APP_ID,
            user_id: userId,
            status: storedStatus,
            lease_token: null,
            lease_until: leaseUntil,
            pack: storedPack,
            researched_at: "2026-09-01T00:00:00.000Z",
            reason: null,
            updated_at: "2026-09-01T00:00:00.000Z",
          },
        ];

  const sb = makeStatefulSupabase(
    {
      applications: [{ id: APP_ID, user_id: userId, position_id: POSITION.id }],
      positions: [{ ...POSITION, description }],
      candidate_identity: withTrustedNames ? [{ user_id: userId, candidate_name: CANDIDATE_NAME }] : [],
      application_trusted_names: withTrustedNames
        ? [{ application_id: APP_ID, user_id: userId, interviewer_names: [INTERVIEWER_NAME] }]
        : [],
      interview_prep_packs: packRows,
    },
    {
      user: { id: userId },
      relationships: {
        "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" },
      },
    },
  );

  // Replace the canned rpc with one that performs the REAL side effect and
  // still records itself in `sb.calls`, so call ORDER stays observable (the
  // G1 ordering test below reads exactly that).
  sb.rpc = vi.fn(async (fn, args) => {
    sb.calls.push({ table: null, verb: "rpc", fn, args });
    if (fn === "claim_prep_pack_slot") {
      const claimed = applyClaimSlot(sb, {
        applicationId: args.p_application_id,
        userId,
        leaseToken: args.p_lease_token,
        leaseUntil: args.p_lease_until,
      });
      return { data: claimed, error: null };
    }
    if (fn === "record_prep_model_call") return { data: recordModelCall, error: null };
    throw new Error(`[route.restore] unmodelled rpc "${fn}"`);
  });

  return { sb, userId };
}

function postRequest() {
  return new Request("http://localhost/api/interview-prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: APP_ID }),
  });
}

function getRequest() {
  return new Request(`http://localhost/api/interview-prep?applicationId=${APP_ID}`, { method: "GET" });
}

async function readPack(sb) {
  createClient.mockResolvedValue(sb);
  const res = await GET(getRequest());
  return await res.json();
}

async function regenerate(sb) {
  createClient.mockResolvedValue(sb);
  const res = await POST(postRequest());
  return { res, body: await res.json() };
}

function packUpdatePayloads(sb) {
  return sb.calls.filter((c) => c.table === "interview_prep_packs" && c.verb === "update").map((c) => c.payload);
}

function rejectingGemini() {
  getGeminiClient.mockReturnValue({
    models: { generateContent: vi.fn().mockRejectedValue(new Error("upstream exploded")) },
  });
}

function replyingGemini(text) {
  getGeminiClient.mockReturnValue({
    models: { generateContent: vi.fn().mockResolvedValue({ text }) },
  });
}

let cryptoSpy;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  listDigests.mockResolvedValue({
    digests: { [APP_ID]: { application_id: APP_ID, status: "ready" } },
    error: null,
  });
  rejectingGemini();
  cryptoSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(LEASE_TOKEN);
});

afterEach(() => {
  cryptoSpy.mockRestore();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("[harness + fixture canaries] -- these must hold or nothing below measures anything", () => {
  it("[fixture power, I5] the stored fixture's exempt line survives ONLY because a trusted name exempts it", () => {
    // If a later edit "simplifies" the fixture to name-free prose, this test
    // goes red and the whole G2 half of this file stops being an instrument.
    // HEAD-GREEN BY DESIGN: it is a property of today's normalizePack, not of
    // any N45 code. It is a guard on the fixture, not coverage of the fix.
    const withNames = normalizePack(packWithExemptLine(), STORED_NAMES);
    const withoutNames = normalizePack(packWithExemptLine(), []);
    expect(aboutYouLines(withNames)).toContain(EXEMPT_LINE);
    expect(aboutYouLines(withoutNames)).not.toContain(EXEMPT_LINE);
  });

  it("[harness canary] the replayed claim RPC really does blank `pack` to {} before the prompt is built", async () => {
    // HEAD-GREEN BY DESIGN and deliberately so: it proves applyClaimSlot is a
    // faithful replay of migration :92 rather than a no-op. A no-op replay
    // would make every RED test below pass for the wrong reason.
    const { sb, userId } = seedTree();
    applyClaimSlot(sb, {
      applicationId: APP_ID,
      userId,
      leaseToken: LEASE_TOKEN,
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    const row = sb.row("interview_prep_packs", (r) => r.application_id === APP_ID);
    expect(row.status).toBe("running");
    expect(row.pack).toEqual({});
    expect(row.researched_at).toBeNull();
  });

  it("[harness canary] a row already running on a LIVE lease is refused, exactly as the ON CONFLICT predicate refuses it", () => {
    const { sb, userId } = seedTree({
      storedStatus: "running",
      storedPack: {},
      leaseUntil: new Date(Date.now() + 120_000).toISOString(),
    });
    const claimed = applyClaimSlot(sb, {
      applicationId: APP_ID,
      userId,
      leaseToken: "another-token",
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(claimed).toBe(false);
  });
});

describe("AC-N45.2 / N47 -- a failed WHOLE-PACK regeneration leaves the previous document byte-identical", () => {
  it("[RED on HEAD: the claim blanks `pack` and no failure branch puts it back] a provider error leaves a subsequent GET byte-identical to the pre-attempt GET, while `status` reflects the failure", async () => {
    const { sb } = seedTree();

    const before = await readPack(sb);
    expect(before.status, "fixture did not establish a ready pack").toBe("ready");
    expect(aboutYouLines(before.pack)).toContain(EXEMPT_LINE);

    const { body } = await regenerate(sb);
    expect(body.status).toBe("failed");

    const after = await readPack(sb);
    // Byte-identical, not merely "non-empty" -- AC-N45.2's own wording.
    expect(JSON.stringify(after.pack)).toBe(JSON.stringify(before.pack));
    // ...and the candidate is still told the attempt failed.
    expect(after.status).toBe("failed");
  });

  it("[RED on HEAD -- THE G2 INSTRUMENT] the UPDATE that lands the failed attempt carries a `pack` whose stored-name-exempt line is still present", async () => {
    // WHAT THIS CATCHES THAT THE TEST ABOVE DOES NOT NAME: gap G2. A restore
    // assembled correctly but handed to writePrepPackResult WITHOUT
    // storedNames is re-normalized against [] (prepStore.js:382) and comes
    // back thinner than it went in. This assertion reads the payload the
    // database itself would receive, so it fires on the write, not on a
    // later read that might re-normalize and mask the difference.
    const { sb } = seedTree();
    await regenerate(sb);

    const payloads = packUpdatePayloads(sb);
    expect(payloads, "expected exactly one terminal UPDATE against interview_prep_packs").toHaveLength(1);
    const written = payloads[0];
    expect(Object.hasOwn(written, "pack"), "the failure write named no `pack` column at all").toBe(true);
    expect(aboutYouLines(written.pack)).toContain(EXEMPT_LINE);
    expect(written.status).toBe("failed");
  });

  it("[RED on HEAD -- risk R2, the unparseable-reply branch (route.js:471)] a reply that is not JSON also leaves the document intact", async () => {
    const { sb } = seedTree();
    replyingGemini("I am afraid I cannot do that.");
    const before = await readPack(sb);

    const { body } = await regenerate(sb);
    expect(body.status).toBe("failed");

    const after = await readPack(sb);
    expect(JSON.stringify(after.pack)).toBe(JSON.stringify(before.pack));
  });

  it("[RED on HEAD -- risk R2, the zero-usable-sections branch (route.js:535)] a parseable reply with nothing usable also leaves the document intact", async () => {
    const { sb } = seedTree();
    replyingGemini(JSON.stringify({ version: 1, sections: {}, claims: [] }));
    const before = await readPack(sb);

    const { body } = await regenerate(sb);
    expect(body.status).toBe("failed");

    const after = await readPack(sb);
    expect(JSON.stringify(after.pack)).toBe(JSON.stringify(before.pack));
  });

  it("[RED on HEAD -- risk R2, the spend-record-failure branch (route.js:299)] a refused spend record also leaves the document intact", async () => {
    const { sb } = seedTree({ recordModelCall: false });
    const before = await readPack(sb);

    await regenerate(sb);

    const after = await readPack(sb);
    expect(JSON.stringify(after.pack)).toBe(JSON.stringify(before.pack));
  });

  it("[RED on HEAD -- risk R2, the GATE 10 'unavailable' branch (route.js:386)] a posting whose description was cleared still leaves the document intact, exempt line included", async () => {
    // This branch is the sharpest G2 case in the file: it returns long before
    // route.js:507 ever resolves trusted names today, so a restore written
    // here with no threading would silently drop EXEMPT_LINE. It is also a
    // real, reachable data-loss path on HEAD right now -- a candidate whose
    // position description is emptied upstream loses their pack on the next
    // regenerate, with no model call involved at all.
    const { sb } = seedTree({ description: "   " });
    const before = await readPack(sb);
    expect(aboutYouLines(before.pack)).toContain(EXEMPT_LINE);

    const { body } = await regenerate(sb);
    expect(body.status).toBe("unavailable");

    const after = await readPack(sb);
    expect(JSON.stringify(after.pack)).toBe(JSON.stringify(before.pack));
    expect(aboutYouLines(after.pack)).toContain(EXEMPT_LINE);
  });

  it("[no-op control -- proves the tests above cannot pass by never writing] a SUCCESSFUL regeneration replaces the document with the new one", async () => {
    // HEAD-GREEN BY DESIGN. Its job is to fail on a build that restores
    // unconditionally (an over-firing restore), which would put the old
    // document back over a perfectly good new one. Without it, "always
    // restore" would satisfy every RED test above.
    const { sb } = seedTree();
    replyingGemini(JSON.stringify(freshGeneratedPack()));
    const before = await readPack(sb);

    const { body } = await regenerate(sb);
    expect(body.status).toBe("ready");

    const after = await readPack(sb);
    expect(JSON.stringify(after.pack)).not.toBe(JSON.stringify(before.pack));
    expect(aboutYouLines(after.pack)).toContain("I build reliable systems for busy teams.");
    expect(aboutYouLines(after.pack)).not.toContain(EXEMPT_LINE);
  });
});

describe("Gap G1 -- the merge base must be read BEFORE the claim, or the restore restores nothing", () => {
  it("[RED on HEAD -- the ordering property itself] the packs-table read that supplies the merge base is issued BEFORE claim_prep_pack_slot", async () => {
    // WHAT THIS CATCHES: an implementation that reads the base AFTER GATE 9.
    // By then claim_prep_pack_slot has already forced `pack = '{}'`, so the
    // "restore" writes an empty document that looks, to a status assertion
    // and to a `toHaveProperty("pack")` assertion alike, exactly like a
    // successful restore. For a pre-N45 row -- which is every row in
    // production today, since no revision rows exist -- that is total,
    // silent data loss dressed as a fix.
    //
    // This is observed CALL ORDER on a real run, not a source-text scan: a
    // reordering that moved the read back after the claim would go red here
    // even if every identifier and call shape stayed byte-identical.
    const { sb } = seedTree();
    await regenerate(sb);

    const claimIndex = sb.calls.findIndex((c) => c.verb === "rpc" && c.fn === "claim_prep_pack_slot");
    expect(claimIndex, "the claim RPC was never issued").toBeGreaterThanOrEqual(0);
    const baseReadIndex = sb.calls.findIndex(
      (c) => c.table === "interview_prep_packs" && c.verb === "select",
    );
    expect(baseReadIndex, "no read of interview_prep_packs was issued at all").toBeGreaterThanOrEqual(0);
    expect(baseReadIndex).toBeLessThan(claimIndex);
  });

  it("[RED on HEAD] a LEGACY row -- stored pack, no revision pointer -- gets its own stored document back after a failed attempt", async () => {
    // Every row in production is this row: the revisions table does not
    // exist yet, so `live_revisions` is empty and the stored `pack` column is
    // the only merge base there is. Design §8.3's "use the stored pack as the
    // base" is only true if the read happened pre-claim, which is G1.
    const { sb } = seedTree();
    const before = await readPack(sb);

    await regenerate(sb);

    const after = await readPack(sb);
    expect(JSON.stringify(after.pack)).toBe(JSON.stringify(before.pack));
    expect(aboutYouLines(after.pack)).toContain(EXEMPT_LINE);
  });

  it("[over-fire control -- HEAD-GREEN, disclosed] a base read while the row was RUNNING is refused: the failure write names no `pack` column at all", async () => {
    // restorePayload's rule 1 (plan §2.4). A row that was mid-attempt when
    // the base was read has `pack = '{}'` ALREADY -- that value is evidence
    // of nothing, and writing it back is a fix-shaped no-op that every other
    // instrument in this file would score as a successful restore.
    //
    // DISCLOSED VACUOUS PASS: today's failure write also names no `pack`
    // column, so this assertion is green on HEAD for an unrelated reason. It
    // is counted as a CONTROL on the S7b build, never as coverage of the fix.
    // What it cannot catch: a build that writes `pack: {}` here having
    // correctly refused for a DIFFERENT reason.
    const { sb } = seedTree({
      storedStatus: "running",
      storedPack: {},
      leaseUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const { body } = await regenerate(sb);
    expect(body.status).toBe("failed");

    const payloads = packUpdatePayloads(sb);
    expect(payloads).toHaveLength(1);
    expect(Object.hasOwn(payloads[0], "pack")).toBe(false);
  });

  it("[the discriminating half of the control above -- RED on HEAD] a terminal FAILED row holding real content is NOT refused: its document comes back", async () => {
    const { sb } = seedTree({ storedStatus: "failed" });
    const before = await readPack(sb);
    expect(aboutYouLines(before.pack)).toContain(EXEMPT_LINE);

    await regenerate(sb);

    const payloads = packUpdatePayloads(sb);
    expect(payloads).toHaveLength(1);
    expect(Object.hasOwn(payloads[0], "pack")).toBe(true);
    expect(aboutYouLines(payloads[0].pack)).toContain(EXEMPT_LINE);
  });
});

describe("the first-ever generation is unchanged -- a restore must not invent content that never existed", () => {
  it("[control, HEAD-GREEN] a failed FIRST attempt on a row with no prior document leaves the pack empty, byte for byte as today", async () => {
    // restorePayload's rule 2. Without this, "restore" could be implemented
    // as "always write something", and a first-ever failure would start
    // reporting a document the candidate never had.
    const { sb } = seedTree({ storedPack: null });

    const { body } = await regenerate(sb);
    expect(body.status).toBe("failed");

    const after = await readPack(sb);
    expect(after.completeSections).toEqual([]);
  });
});
