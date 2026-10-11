// N157 SC-B-persist, Step 1b -- the DB read/write wrappers studyPlanStore.js:
// readStudyPlan, writeStudyPlan, writeStudyPlanProgress (the last via the
// merge_study_plan_progress RPC). Tested against this repo's shared
// call-recording supabase fake (test/helpers/supabaseMock.js), which already
// records `.rpc(name, args)` into `sb.calls.rpc` and accepts a per-function
// canned result through its second argument (`{ rpc: { fn: {data,error} } }`);
// no mock extension was needed (prepStore.test.js exercises the same recorder).
//
// RED ON HEAD: ./studyPlanStore.js does not exist yet. This is an honest
// greenfield red -- the import fails to resolve, so every case in this file is
// red for the single, correct reason "the module under test is absent". The
// implementer (Step 1a) writes studyPlanStore.js to green them.
//
// ENTRY POINT NOTE (brief rule 2/6): these functions are the production data
// layer; arch r2 §0/§7 states the store is called DIRECTLY from client code
// (the browser supabase client) and from the generation route -- there is no
// user-facing control in THIS sub-chunk. So a direct function call IS the
// faithful way this code is reached; no mounted component, no reachability
// shim, and nothing added to the production surface to let a test reach in.
//
// Each load-bearing property is paired with a control that distinguishes a
// correct build from one that over-fires or under-fires, and each named mutant
// below was built, run and watched fail against a scratchpad reference copy
// (see tests.r1.md); the counts live in the 4b notes.

import { describe, it, expect } from "vitest";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";
import {
  STUDY_PLANS_TABLE,
  STUDY_PLAN_PROJECTION,
  MERGE_STUDY_PLAN_PROGRESS_FN,
} from "@/lib/studyPlan/studyPlanContract.js";
import { readStudyPlan, writeStudyPlan, writeStudyPlanProgress } from "./studyPlanStore.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_USER = "99999999-9999-9999-9999-999999999999";

// Which tables the call went to (every recorded key except the rpc log).
function touchedTables(sb) {
  return Object.keys(sb.calls).filter((k) => k !== "rpc");
}

// A single valid one-item seen delta, exactly what buildProgressDelta emits.
function oneItemDelta(itemId = "i_abc") {
  return { [itemId]: { revealedAt: "2026-10-11T00:00:00.000Z", grade: "good" } };
}

// A fully-populated row as the table would hand it back on a read.
function fullRow(overrides = {}) {
  return {
    application_id: APP_ID,
    user_id: USER_ID,
    status: "ready",
    plan: { v: 1, engine: "embedded", provenance: { research: "complete" }, modules: [] },
    knobs: { newReviewRatio: 0.25 },
    progress: { cursor: { itemId: "i_abc" }, seen: { i_abc: { revealedAt: "2026-10-11T00:00:00.000Z" } } },
    cached_research: { complete: true, items: [], anArbitraryExtraField: "SURVIVES" },
    posting_fingerprint: "fp-1",
    researched_at: "2026-10-01T00:00:00.000Z",
    engine: "embedded",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-10T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readStudyPlan -- defence-in-depth tenant scoping (AC-N157-S8), named
// projection (never select("*")), schema normalization, cached_research
// pass-through, and never-throw.
// ---------------------------------------------------------------------------
describe("readStudyPlan", () => {
  it("selects the NAMED projection (never select(\"*\")) with BOTH .eq(application_id) AND .eq(user_id), then .maybeSingle()", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: fullRow(), error: null } });
    await readStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID });

    // The named projection, spelled from the contract -- a widening to "*"
    // would both fail this and quietly expand every read. (mutant M-READ-STAR)
    expect(sb.calls[STUDY_PLANS_TABLE].select[0][0]).toBe(STUDY_PLAN_PROJECTION);
    expect(sb.calls[STUDY_PLANS_TABLE].select[0][0]).not.toBe("*");
    expect(sb.calls[STUDY_PLANS_TABLE].select[0][0]).not.toContain("*");

    // BOTH filters. Dropping the user filter is the exact defence-in-depth hole
    // AC-N157-S8 forbids. (mutant M-READ-NOUSER)
    expect(sb.calls[STUDY_PLANS_TABLE].eq).toContainEqual(["application_id", APP_ID]);
    expect(sb.calls[STUDY_PLANS_TABLE].eq).toContainEqual(["user_id", USER_ID]);
    expect(sb.calls[STUDY_PLANS_TABLE].maybeSingle).toBe(1);
  });

  it("[canary] the both-.eq assertion can actually fail -- a user filter the code never issued is not in the recorded list", () => {
    // Proves the toContainEqual instrument above discriminates: a call log that
    // carries only the application filter does NOT satisfy the user-filter
    // assertion, so M-READ-NOUSER cannot pass it silently.
    const eqLogWithoutUser = [["application_id", APP_ID]];
    expect(() => expect(eqLogWithoutUser).toContainEqual(["user_id", USER_ID])).toThrow();
  });

  it("normalizes plan/knobs/progress through the schema and returns a per-application record", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: fullRow(), error: null } });
    const res = await readStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(res.error).toBeNull();
    expect(res.status).toBe("ready");
    // normalizeProgress stamps v and keeps the itemId-keyed seen map.
    expect(res.progress.v).toBe(1);
    expect(res.progress.cursor.itemId).toBe("i_abc");
    expect(res.progress.seen).toHaveProperty("i_abc");
    // normalizeKnobs fills defaults around the supplied field.
    expect(res.knobs.newReviewRatio).toBe(0.25);
  });

  it("passes cached_research through UNCHANGED (SC-A owns its element shape -- the store must not normalize it)", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: fullRow(), error: null } });
    const res = await readStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID });
    // An arbitrary field the store knows nothing about must survive verbatim --
    // a store that re-shaped cached_research would drop it. (mutant M-READ-RESHAPE)
    expect(res.cachedResearch).toEqual({ complete: true, items: [], anArbitraryExtraField: "SURVIVES" });
  });

  it("a wrong/absent row (no data -- a mismatched-user read, or no plan yet) returns an all-null record, error null, WITHOUT crashing", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: null, error: null } });
    const res = await readStudyPlan(sb, { applicationId: APP_ID, userId: OTHER_USER });
    expect(res.error).toBeNull();
    expect(res.status).toBeNull();
    expect(res.plan).toBeNull();
    expect(res.progress).toBeNull();
    expect(res.cachedResearch).toBeNull();
  });

  it("[control, over-/under-fire] a POPULATED read is distinguishable from the all-null record -- the two paths differ", async () => {
    const present = await readStudyPlan(
      makeSupabase({ [STUDY_PLANS_TABLE]: { data: fullRow(), error: null } }),
      { applicationId: APP_ID, userId: USER_ID },
    );
    const absent = await readStudyPlan(
      makeSupabase({ [STUDY_PLANS_TABLE]: { data: null, error: null } }),
      { applicationId: APP_ID, userId: USER_ID },
    );
    // If a build returned the all-null record unconditionally (under-fire) this
    // equality would hold; it must not.
    expect(present.status).not.toBe(absent.status);
  });

  it("a DB error becomes a result object with a message, never a throw", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: null, error: { message: "boom" } } });
    const res = await readStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(res.plan).toBeNull();
    expect(typeof res.error).toBe("string");
    expect(res.error.length).toBeGreaterThan(0);
  });

  it("K2-FROM: a read touches exactly {study_plans} and nothing else", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: fullRow(), error: null } });
    await readStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(touchedTables(sb)).toEqual([STUDY_PLANS_TABLE]);
  });
});

// ---------------------------------------------------------------------------
// writeStudyPlan -- column-wise upsert on the PK, user_id in the payload, and
// the LOAD-BEARING R2 guard: `progress` is NEVER in the written columns, so a
// create or knob-rebuild cannot wipe accumulated drill history.
// ---------------------------------------------------------------------------
describe("writeStudyPlan", () => {
  it("upserts with { onConflict: \"application_id\" } and carries user_id in the row payload (AC-N157-S8)", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: { application_id: APP_ID }, error: null } });
    const res = await writeStudyPlan(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      status: "ready",
      plan: { modules: [{ id: "m1" }] },
      knobs: { newReviewRatio: 0.5 },
      engine: "embedded",
      postingFingerprint: "fp-1",
      researchedAt: "2026-10-01T00:00:00.000Z",
      cachedResearch: { complete: true },
    });
    expect(res.written).toBe(true);
    const [row, options] = sb.calls[STUDY_PLANS_TABLE].upsert[0];
    expect(options).toEqual({ onConflict: "application_id" });
    expect(row.application_id).toBe(APP_ID);
    expect(row.user_id).toBe(USER_ID);
  });

  it("R2 (LOAD-BEARING, SILENT): the written row NEVER contains a `progress` column -- progress is RPC-write-only", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: { application_id: APP_ID }, error: null } });
    // Adversarially pass a `progress` alongside everything else: even so, it
    // must not reach the upsert payload. A mutant that adds `progress` to the
    // whitelist (the naive copy of a full-row upsert) would wipe the JSONB the
    // merge RPC maintains. (mutant M-WRITE-PROGRESS)
    await writeStudyPlan(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      status: "ready",
      plan: { modules: [{ id: "m1" }] },
      knobs: { newReviewRatio: 0.5 },
      progress: { seen: { i_abc: { revealedAt: "x" } }, cursor: { itemId: "i_abc" } },
    });
    const [row] = sb.calls[STUDY_PLANS_TABLE].upsert[0];
    expect(Object.keys(row)).not.toContain("progress");
    expect(row).not.toHaveProperty("progress");
  });

  it("[control] the whitelist is not vacuously empty -- the columns that ARE supplied do appear", async () => {
    // Guards against the test passing merely because the row was empty: if the
    // payload carried no columns at all, `progress`-absence would be trivially
    // true and tell us nothing.
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: { application_id: APP_ID }, error: null } });
    await writeStudyPlan(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      status: "ready",
      plan: { modules: [{ id: "m1" }] },
      knobs: { newReviewRatio: 0.5 },
      engine: "embedded",
    });
    const [row] = sb.calls[STUDY_PLANS_TABLE].upsert[0];
    expect(Object.keys(row)).toEqual(expect.arrayContaining(["status", "plan", "knobs", "engine"]));
  });

  it("[canary] the progress-exclusion assertion can actually fail -- a payload that DID carry progress is caught", () => {
    const rowWithProgress = { application_id: APP_ID, user_id: USER_ID, plan: {}, progress: {} };
    expect(() => expect(Object.keys(rowWithProgress)).not.toContain("progress")).toThrow();
  });

  it("R2 consequence (knob-rebuild): a rebuild that omits progress leaves the stored progress untouched -- the column-wise upsert sends no progress key", async () => {
    // The in-repo guarantee is the key-set exclusion above; the live read-back
    // of a pre-seeded `seen` surviving a rebuild is a column-wise-upsert / DB
    // property, owner-verified post-merge (tests.r1.md "could not verify").
    // Here we pin the behaviour the store CAN enforce: a knob-only rebuild
    // (new knobs, no progress argument) still sends zero progress columns.
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: { application_id: APP_ID }, error: null } });
    await writeStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID, knobs: { newReviewRatio: 0.9 } });
    const [row] = sb.calls[STUDY_PLANS_TABLE].upsert[0];
    expect(row).not.toHaveProperty("progress");
    expect(row.knobs).toEqual({ newReviewRatio: 0.9 });
  });

  it("AC-N157-S9: an empty applicationId is REFUSED with no `=\"\"` default and no .from() call at all", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: null, error: null } });
    const res = await writeStudyPlan(sb, { applicationId: "", userId: USER_ID, status: "ready" });
    expect(res.written).toBe(false);
    expect(typeof res.error).toBe("string");
    // "nobody passed an id" must never become a well-formed write for the
    // wrong row. (mutant M-WRITE-EMPTYID)
    expect(touchedTables(sb)).toEqual([]);
  });

  it("a DB error becomes { written:false, error } -- never a throw", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: null, error: { message: "constraint violated" } } });
    const res = await writeStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID, status: "ready", plan: { modules: [{ id: "m1" }] } });
    expect(res.written).toBe(false);
    expect(typeof res.error).toBe("string");
  });

  it("K2-FROM: a write touches exactly {study_plans} and issues no .rpc()", async () => {
    const sb = makeSupabase({ [STUDY_PLANS_TABLE]: { data: { application_id: APP_ID }, error: null } });
    await writeStudyPlan(sb, { applicationId: APP_ID, userId: USER_ID, status: "ready", plan: { modules: [{ id: "m1" }] } });
    expect(touchedTables(sb)).toEqual([STUDY_PLANS_TABLE]);
    expect(sb.calls.rpc || []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// writeStudyPlanProgress -- the ONLY progress write path, via the RPC. The M3
// property is load-bearing: EXACTLY ONE seen entry per write, never the whole
// map; no user id on the wire (identity is auth.uid() server-side, R4).
// ---------------------------------------------------------------------------
describe("writeStudyPlanProgress", () => {
  it("R1/M3 (LOAD-BEARING): calls the RPC with EXACTLY { p_application_id, p_cursor, p_seen_delta } -- one seen key, no user id", async () => {
    const sb = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: true, error: null } } });
    const seenDelta = oneItemDelta("i_abc");
    const cursor = { moduleId: "m1", topicId: "t1", itemId: "i_abc" };
    const res = await writeStudyPlanProgress(sb, { applicationId: APP_ID, cursor, seenDelta });

    expect(res.written).toBe(true);
    expect(sb.calls.rpc).toHaveLength(1);
    const [fn, args] = sb.calls.rpc[0];
    expect(fn).toBe(MERGE_STUDY_PLAN_PROGRESS_FN);
    // Exact key set -- no 4th key, no p_user_id (R4: a user id on the wire
    // reintroduces the tenant-hole shape). (mutant M-RPC-USERID)
    expect(Object.keys(args).sort()).toEqual(["p_application_id", "p_cursor", "p_seen_delta"].sort());
    expect(args).not.toHaveProperty("p_user_id");
    expect(args.p_application_id).toBe(APP_ID);
    expect(args.p_cursor).toEqual(cursor);
    // The delta carries exactly one itemId key -- never the whole seen map.
    expect(Object.keys(args.p_seen_delta)).toEqual(["i_abc"]);
  });

  it("R1/M3 over-fire guard: a WHOLE-seen-MAP (2 keys) is refused and the RPC is NEVER issued", async () => {
    const sb = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: true, error: null } } });
    const wholeMap = { i_abc: { revealedAt: "2026-10-11T00:00:00.000Z" }, i_def: { revealedAt: "2026-10-11T00:01:00.000Z" } };
    const res = await writeStudyPlanProgress(sb, { applicationId: APP_ID, cursor: { itemId: "i_abc" }, seenDelta: wholeMap });

    expect(res.written).toBe(false);
    // The exact two-device clobber defect: removing the isSingleItemSeenDelta
    // guard lets the full map reach merge_study_plan_progress. (mutant M-RPC-NOGUARD)
    expect(sb.calls.rpc || []).toHaveLength(0);
  });

  it("R1/M3 over-fire guard: an EMPTY delta is refused and the RPC is NEVER issued", async () => {
    const sb = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: true, error: null } } });
    const res = await writeStudyPlanProgress(sb, { applicationId: APP_ID, cursor: { itemId: null }, seenDelta: {} });
    expect(res.written).toBe(false);
    expect(sb.calls.rpc || []).toHaveLength(0);
  });

  it("[control, over-/under-fire] a VALID single-item delta DOES issue the RPC -- the guard is not hardwired to reject everything", async () => {
    // Distinguishes the correct guard from one that refuses all writes
    // (under-fire): with a valid delta the rpc must fire exactly once.
    const sb = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: true, error: null } } });
    await writeStudyPlanProgress(sb, { applicationId: APP_ID, cursor: { itemId: "i_abc" }, seenDelta: oneItemDelta("i_abc") });
    expect(sb.calls.rpc).toHaveLength(1);
  });

  it("[canary] the never-issued assertion can actually fail -- an rpc log with one entry is caught", () => {
    const rpcLog = [[MERGE_STUDY_PLAN_PROGRESS_FN, { p_application_id: APP_ID }]];
    expect(() => expect(rpcLog || []).toHaveLength(0)).toThrow();
  });

  it("AC-N157-S9: an empty applicationId is refused before any network, RPC never issued", async () => {
    const sb = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: true, error: null } } });
    const res = await writeStudyPlanProgress(sb, { applicationId: "", cursor: { itemId: "i_abc" }, seenDelta: oneItemDelta("i_abc") });
    expect(res.written).toBe(false);
    expect(sb.calls.rpc || []).toHaveLength(0);
  });

  it("the RPC's boolean result maps straight through: true -> written, non-true -> not written", async () => {
    const ok = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: true, error: null } } });
    expect((await writeStudyPlanProgress(ok, { applicationId: APP_ID, cursor: { itemId: "i_abc" }, seenDelta: oneItemDelta() })).written).toBe(true);

    // data === false (the RPC matched zero rows: not this owner's application)
    // must NOT be reported as a successful write.
    const no = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: false, error: null } } });
    expect((await writeStudyPlanProgress(no, { applicationId: APP_ID, cursor: { itemId: "i_abc" }, seenDelta: oneItemDelta() })).written).toBe(false);
  });

  it("an injected RPC error becomes a result object, never a throw", async () => {
    const sb = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: new Error("connection reset") } });
    const res = await writeStudyPlanProgress(sb, { applicationId: APP_ID, cursor: { itemId: "i_abc" }, seenDelta: oneItemDelta() });
    expect(res.written).toBe(false);
    expect(typeof res.error).toBe("string");
  });

  it("K2 census: the progress write issues the merge RPC and touches NO table directly", async () => {
    const sb = makeSupabase({}, { rpc: { [MERGE_STUDY_PLAN_PROGRESS_FN]: { data: true, error: null } } });
    await writeStudyPlanProgress(sb, { applicationId: APP_ID, cursor: { itemId: "i_abc" }, seenDelta: oneItemDelta() });
    expect(touchedTables(sb)).toEqual([]);
    expect(sb.calls.rpc.map(([fn]) => fn)).toEqual([MERGE_STUDY_PLAN_PROGRESS_FN]);
  });
});
