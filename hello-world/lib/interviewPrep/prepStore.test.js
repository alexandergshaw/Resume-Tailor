// prepStore.js -- the ONLY module that names any of the three prep tables or
// issues a query against them (design-structure.r1.md §3). Tested against
// test/helpers/supabaseMock.js, this repo's shared call-recording fake.
//
// FIRST OBLIGATION OF THIS SEAT, per rulings.md R-IP3-61: 1-0-contract.r8.md's
// own Functions table still shows claim_prep_pack_slot's STALE, pre-fix
// 4-parameter signature (p_application_id, p_user_id, p_lease_token,
// p_lease_until). The 3-parameter form -- (p_application_id, p_lease_token,
// p_lease_until), NO p_user_id -- is AUTHORITATIVE (design-structure.r1.md
// §4.1's actual, adopted function body; R-IP3-53 removed p_user_id as a
// tenant-isolation hole). Every assertion below against claimPrepPack's `rpc`
// call asserts the 3-parameter form; the 4-parameter row is treated as
// superseded, not restated.
import { describe, it, expect, vi } from "vitest";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";
import {
  readPrepPack,
  listPrepPacks,
  claimPrepPack,
  writePrepPackResult,
  deletePrepPackContent,
  recordModelCallIssued,
  recordPrepEvent,
  listPrepEvents,
  checkPackByteBudget,
  isCheckViolation,
  dbFailureResponse,
  logDbFailure,
} from "@/lib/interviewPrep/prepStore.js";
import { PREP_PACK_MAX_BYTES } from "@/lib/interviewPrep/prepConstants.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const LEASE_TOKEN = "33333333-3333-3333-3333-333333333333";

// The three tables prepStore.js itself owns (design-structure.r1.md §3).
// `applications` is NOT in this set: design-operate.r1.md §3a's four-table
// K2-FROM allow-list widens to include `applications` at the ROUTE level
// (a tenant-ownership read this seat did not build a route harness for --
// see this file's own "What I could not verify"); prepStore.js's own module
// boundary is these three tables only, and that narrower, fully-buildable
// claim is what this file actually asserts.
const PREP_TABLES = ["interview_prep_packs", "interview_prep_spend", "interview_prep_events"];

function touchedTables(sb) {
  return Object.keys(sb.calls).filter((k) => k !== "rpc");
}

describe("claimPrepPack — the RPC call carries the AUTHORITATIVE 3-parameter signature", () => {
  it("[first obligation] calls claim_prep_pack_slot with exactly p_application_id, p_lease_token, p_lease_until -- never p_user_id", async () => {
    const sb = makeSupabase({}, { rpc: { claim_prep_pack_slot: { data: true, error: null } } });
    await claimPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(sb.calls.rpc).toHaveLength(1);
    const [fn, args] = sb.calls.rpc[0];
    expect(fn).toBe("claim_prep_pack_slot");
    expect(Object.keys(args).sort()).toEqual(["p_application_id", "p_lease_token", "p_lease_until"].sort());
    expect(args).not.toHaveProperty("p_user_id");
    expect(args.p_application_id).toBe(APP_ID);
  });

  it("[mutant this kills] a 4-parameter call (the stale, superseded shape) is rejected", () => {
    // Not a runtime assertion against the real implementation -- a canary
    // proving the assertion above is capable of failing at all, since an
    // args object that DID carry p_user_id would fail
    // `not.toHaveProperty("p_user_id")` above. Demonstrated here on a literal
    // fixture so the mutant is named rather than merely implied.
    const staleShapeArgs = {
      p_application_id: APP_ID,
      p_user_id: USER_ID,
      p_lease_token: LEASE_TOKEN,
      p_lease_until: new Date().toISOString(),
    };
    expect(() => expect(staleShapeArgs).not.toHaveProperty("p_user_id")).toThrow();
  });

  it("issues no `.from()` call at all -- the claim path is exclusively the RPC (K2-FROM's correctly-absent case)", async () => {
    const sb = makeSupabase({}, { rpc: { claim_prep_pack_slot: { data: true, error: null } } });
    await claimPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(touchedTables(sb)).toEqual([]);
  });
});

// N41 (owner decision, 2026-09-20): both interview-prep spend caps are
// removed. The DB guard `claim_prep_pack_slot`'s own top-of-function
// `if v_attempts >= 6 or v_model_calls >= 12` (migration :496-498) is what
// this module's own header (:259-262, unedited above) attributes the
// non-in-flight refusal branch to -- once that guard is gone, a refusal
// that is NOT a genuinely live lease can only be the residual lease-expiry
// race described there, so the label must change from "attempts-spent" (a
// state N41's own backlog text says must become PERMANENTLY UNREACHABLE)
// to the strictly more honest "in-flight" (the lease WAS held moments
// earlier). RED ON HEAD: prepStore.js:303 still returns "attempts-spent"
// for this exact fixture.
describe("claimPrepPack -- N41's reason relabeling (a refused claim can no longer report \"attempts-spent\")", () => {
  it('[RED until N41 lands] a refused claim whose lease_until has ALREADY EXPIRED reports reason "in-flight", never "attempts-spent"', async () => {
    const pastLease = new Date(Date.now() - 60_000).toISOString();
    const sb = makeSupabase(
      { interview_prep_packs: { data: { lease_until: pastLease }, error: null } },
      { rpc: { claim_prep_pack_slot: { data: false, error: null } } },
    );
    const result = await claimPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.claimed).toBe(false);
    expect(result.reason).toBe("in-flight");
    expect(result.reason).not.toBe("attempts-spent");
  });

  it('[unchanged, regression control] a refused claim whose lease is genuinely still live also reports "in-flight" -- this branch already worked and must keep working', async () => {
    const futureLease = new Date(Date.now() + 60_000).toISOString();
    const sb = makeSupabase(
      { interview_prep_packs: { data: { lease_until: futureLease }, error: null } },
      { rpc: { claim_prep_pack_slot: { data: false, error: null } } },
    );
    const result = await claimPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.reason).toBe("in-flight");
  });

  it('[unaffected control, risk-table row for step 2] a genuine RPC error still reports reason "error", never merged into the in-flight relabeling', async () => {
    const sb = makeSupabase({}, { rpc: { claim_prep_pack_slot: new Error("connection reset") } });
    const result = await claimPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.claimed).toBe(false);
    expect(result.reason).toBe("error");
  });

  // F-R14-2 (fix round r14, MINOR, verify.r14.md): route.js's own 409 refusal
  // has never actually surfaced `claim.error` (it returns only
  // `{status, reason}`), but nothing stopped a future edit from adding it --
  // and had it, this field would have carried the RPC's own raw text
  // straight through. Sanitised at the source now, the same discipline
  // dbFailureResponse/logDbFailure already give every other write path here.
  it("[RED before this fix round] a genuine RPC error's `error` field is a GENERIC sentence, never the raw database text -- the raw detail is logged server-side instead", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeSupabase(
      {},
      { rpc: { claim_prep_pack_slot: { data: null, error: { message: "PGRST301 relation interview_prep_packs does not exist at char 42" } } } },
    );
    const result = await claimPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.claimed).toBe(false);
    expect(result.error).toBe("Could not start this attempt.");
    expect(result.error).not.toContain("PGRST301");
    expect(spy).toHaveBeenCalledTimes(1);
    const [, loggedMeta] = spy.mock.calls[0];
    expect(loggedMeta.error.message).toContain("PGRST301");
    spy.mockRestore();
  });
});

describe("K4 (corrected) -- deletePrepPackContent's write guard (design-operate.r1.md §2, OP-2)", () => {
  it("[no-op control] a real delete: exactly one .delete() against interview_prep_packs, tenant-scoped, non-zero row count -> deleted:true", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
    });
    const result = await deletePrepPackContent(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(sb.calls.interview_prep_packs.delete).toHaveLength(1);
    expect(sb.calls.interview_prep_packs.eq).toContainEqual(["application_id", APP_ID]);
    expect(sb.calls.interview_prep_packs.eq).toContainEqual(["user_id", USER_ID]);
    expect(result.deleted).toBe(true);
  });

  it("[mutant] zero .update() calls against interview_prep_packs -- a tombstone-shaped UPDATE is the exact regression O-17 retired", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
    });
    await deletePrepPackContent(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(sb.calls.interview_prep_packs.update).toHaveLength(0);
  });

  it("[positive control] zero calls of any kind against interview_prep_spend or interview_prep_events from this function", async () => {
    // Kills: a delete that also zeroes or removes the spend ledger, which
    // would silently reset the very bound O-17 exists to make survive a
    // delete.
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
      interview_prep_spend: { data: null, error: null },
      interview_prep_events: { data: null, error: null },
    });
    await deletePrepPackContent(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(sb.calls.interview_prep_spend).toBeUndefined();
    expect(sb.calls.interview_prep_events).toBeUndefined();
  });

  it('a zero-row delete against a row that still exists (refused because it is "running") returns reason "in-flight", never "deleted"', async () => {
    // design-structure.r1.md §8.3: the DELETE carries
    // `AND (status <> 'running' OR lease_until < now())`, so a genuinely
    // in-flight row survives the statement with zero rows affected. The
    // wrapper disambiguates via a follow-up read -- modelled here with a
    // minimal, LOCAL two-call fake (not test/helpers/supabaseMock.js) because
    // that shared mock's per-table config is STATIC and cannot express two
    // DIFFERENT results for two calls to the SAME table in one test (the
    // DELETE resolves to zero rows, the follow-up SELECT to one) -- a
    // limitation independent of, and not closed by, extending it with
    // `.or()` (round 2: it now has `.or()`, used by the three tests above).
    // This local fake carries `.delete()` too (round 2: check-4b.r1.md found
    // it absent, which crashed every spec-conformant `deletePrepPackContent`
    // that calls `.from(table).delete()` before `.eq()/.or()/.select()`).
    let call = 0;
    const chain = {
      delete: () => chain,
      eq: () => chain,
      or: () => chain,
      select: () => chain,
      then: (resolve) => {
        call += 1;
        return Promise.resolve(
          call === 1 ? { data: [], error: null } : { data: { application_id: APP_ID }, error: null },
        ).then(resolve);
      },
    };
    const sb = { from: () => chain };
    const result = await deletePrepPackContent(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe("in-flight");
  });

  it('a zero-row delete against a row that genuinely does not exist returns reason "not-found"', async () => {
    const chain = {
      delete: () => chain,
      eq: () => chain,
      or: () => chain,
      select: () => chain,
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    const sb = { from: () => chain };
    const result = await deletePrepPackContent(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe("not-found");
  });
});

describe("K2-FROM (widened) -- prepStore.js's own from-spy allow-list is the 3 prep tables, per function", () => {
  it("readPrepPack touches only the allow-listed tables", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: null, error: null },
    });
    await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    for (const t of touchedTables(sb)) expect(PREP_TABLES).toContain(t);
    expect(touchedTables(sb).length).toBeGreaterThan(0);
  });

  it("listPrepPacks touches only the allow-listed tables", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [], error: null },
      interview_prep_spend: { data: [], error: null },
    });
    await listPrepPacks(sb, { applicationIds: [APP_ID], userId: USER_ID });
    for (const t of touchedTables(sb)) expect(PREP_TABLES).toContain(t);
  });

  it("writePrepPackResult touches only the allow-listed tables", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
    });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      engine: "gemini",
      pack: { sections: {}, claims: {} },
    });
    for (const t of touchedTables(sb)) expect(PREP_TABLES).toContain(t);
  });

  it("recordModelCallIssued touches only the allow-listed tables", async () => {
    const sb = makeSupabase({ interview_prep_spend: { data: { application_id: APP_ID }, error: null } });
    await recordModelCallIssued(sb, { applicationId: APP_ID, userId: USER_ID });
    for (const t of touchedTables(sb)) expect(PREP_TABLES).toContain(t);
  });

  it("recordPrepEvent touches only the allow-listed tables", async () => {
    const sb = makeSupabase({ interview_prep_events: { data: { id: 1 }, error: null } });
    await recordPrepEvent(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      eventType: "attempt",
      triggerClass: "B1",
      engine: "gemini",
      outcome: "ready",
      reason: null,
    });
    for (const t of touchedTables(sb)) expect(PREP_TABLES).toContain(t);
  });

  it("listPrepEvents touches only the allow-listed tables", async () => {
    const sb = makeSupabase({ interview_prep_events: { data: [], error: null } });
    await listPrepEvents(sb, { applicationId: APP_ID, userId: USER_ID });
    for (const t of touchedTables(sb)) expect(PREP_TABLES).toContain(t);
  });

  it("[mutant, one planted instance] a reused fetcher touching interview_stages fails the allow-list", () => {
    // Demonstrates the assertion shape is capable of failing -- the real
    // instrument is the `for (const t of touchedTables(sb)) expect(...)`
    // loop above, run against real prepStore.js code; this is its canary.
    const contaminated = ["interview_prep_packs", "interview_stages"];
    expect(() => {
      for (const t of contaminated) expect(PREP_TABLES).toContain(t);
    }).toThrow();
  });
});

// UPDATED FOR N41 (owner decision, 2026-09-20): both interview-prep spend
// caps are removed, so `attemptsExhausted` becomes permanently `false` --
// per standing rule 4, this is expected maintenance of a test pinning a
// behaviour an owner ruling explicitly changed (backlog N41(c): "the
// 'attempts-exhausted' state disappears from the prep surface"), not a
// silent edit of a test believed wrong. The counters (`attempts`/
// `model_calls`) themselves REMAIN, per N41(d) -- only the two cases that
// used to report `true` change, and a new case proves the removal is
// unconditional (far past both former ceilings), not merely a widened
// bound.
describe("the post-delete read derivation, post-N41 (design-structure.r1.md §5.2, R-IP3-44; N41 supersedes the exhausted branch)", () => {
  it('case 1 -- no spend row at all -> "never attempted", offer Prepare', async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: null, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(false);
    expect(result.pack).toBeNull();
    expect(result.status).toBeNull();
  });

  it('case 2 -- spend row present, both counters low, no pack row -> "never attempted", offer Prepare', async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 2, model_calls: 3 }, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(false);
    expect(result.pack).toBeNull();
  });

  it('[N41, RED until the cap-removal migration lands] a spend row AT the FORMER attempts ceiling (6) no longer reports exhausted -- the ceiling is gone, the counter remains', async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 6, model_calls: 3 }, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(false);
    // design-experience.r1.md §0's own rule survives the ruling: the control
    // is never blocked by this value now that it is always false.
    expect(!result.attemptsExhausted).toBe(true);
  });

  it('[N41, RED until the cap-removal migration lands] a spend row AT the FORMER model_calls ceiling (12) no longer reports exhausted either', async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 1, model_calls: 12 }, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(false);
  });

  it("[N41, proves the removal is UNCONDITIONAL, not a widened bound] attemptsExhausted is false even far past both former ceilings", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 999, model_calls: 999 }, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(false);
  });

  it("[mutant this kills] every case above -- including the former-ceiling and far-past-ceiling ones -- must now be INDISTINGUISHABLE from case 1/2's already-false result", async () => {
    const sbCase1 = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: null, error: null },
    });
    const sbFormerCeiling = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 6, model_calls: 12 }, error: null },
    });
    const [r1, r2] = await Promise.all([
      readPrepPack(sbCase1, { applicationId: APP_ID, userId: USER_ID }),
      readPrepPack(sbFormerCeiling, { applicationId: APP_ID, userId: USER_ID }),
    ]);
    // Under the PRE-N41 contract these two would have DIFFERED (false vs
    // true) -- this equality is exactly what a correct N41 implementation
    // makes true and an unimplemented one makes false, RED on HEAD.
    expect(r1.attemptsExhausted).toBe(r2.attemptsExhausted);
    expect(r2.attemptsExhausted).toBe(false);
  });
});

describe("recordModelCallIssued -- never throws, gates the paid call (design-operate.r1.md §6)", () => {
  // These two rows were rewritten this round: recordModelCallIssued no
  // longer issues a `.from("interview_prep_spend")` select-then-update --
  // it calls the `record_prep_model_call` RPC (supabase/migrations/
  // 20260914000000_interview_prep.sql), atomically, closing the
  // read-then-write race the prior implementation carried. Their fixtures
  // moved from a `{ interview_prep_spend: {...} }` table mock to an
  // `{ rpc: { record_prep_model_call: {...} } }` one; what each row
  // asserts (a successful record returns recorded:true; a database error
  // returns recorded:false and never throws) is unchanged.
  it("[no-op control] a successful record returns recorded:true", async () => {
    const sb = makeSupabase({}, { rpc: { record_prep_model_call: { data: true, error: null } } });
    const result = await recordModelCallIssued(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.recorded).toBe(true);
    expect(result.error).toBeNull();
  });

  it("[mutant] a Supabase error on the recording write returns recorded:false and NEVER throws", async () => {
    const sb = makeSupabase({}, { rpc: { record_prep_model_call: new Error("db exploded") } });
    await expect(recordModelCallIssued(sb, { applicationId: APP_ID, userId: USER_ID })).resolves.toMatchObject({
      recorded: false,
    });
  });

  it("the ownership check refusing (RPC returns false, not an error) also reads as recorded:false", async () => {
    // record_prep_model_call returns boolean false, rather than an error,
    // when the application does not belong to the caller -- a distinct
    // branch from the one above.
    const sb = makeSupabase({}, { rpc: { record_prep_model_call: { data: false, error: null } } });
    const result = await recordModelCallIssued(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.recorded).toBe(false);
    expect(result.error).toBeNull();
  });

  it("[mutant this kills: a reintroduced read-then-write] issues the record_prep_model_call RPC -- never a table call against interview_prep_spend", async () => {
    const sb = makeSupabase({}, { rpc: { record_prep_model_call: { data: true, error: null } } });
    const result = await recordModelCallIssued(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(sb.calls.rpc).toHaveLength(1);
    const [fn, args] = sb.calls.rpc[0];
    expect(fn).toBe("record_prep_model_call");
    expect(args).toEqual({ p_application_id: APP_ID });
    expect(args).not.toHaveProperty("p_user_id");
    expect(sb.calls.interview_prep_spend).toBeUndefined();
    expect(result.recorded).toBe(true);
  });
});

describe("checkPackByteBudget -- the pack byte bound moved out of the database CHECK (schema-migration-drift ruling)", () => {
  // interview_prep_packs_pack_size_check (pg_column_size(pack) <= 262144)
  // was removed from the migration -- pg_column_size is not IMMUTABLE, and a
  // CHECK built on it is a dump/restore hazard (see the migration's own "NOT
  // ADDED, deliberately" note). This function is now the ONLY thing that
  // enforces PREP_PACK_MAX_BYTES. `padTo` measures with the SAME primitive
  // the source uses (TextEncoder, never Buffer -- prepStore.js's own header
  // says it must stay browser-safe), so "exactly N bytes" here means exactly
  // what checkPackByteBudget itself measures.
  function padTo(bytes) {
    const overhead = new TextEncoder().encode(JSON.stringify({ a: "" })).length;
    return { a: "x".repeat(Math.max(0, bytes - overhead)) };
  }

  it("[at-limit] a pack whose JSON is exactly PREP_PACK_MAX_BYTES bytes is NOT refused", () => {
    const atLimit = padTo(PREP_PACK_MAX_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(atLimit)).length).toBe(PREP_PACK_MAX_BYTES);
    const result = checkPackByteBudget(atLimit);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(PREP_PACK_MAX_BYTES);
    expect(result.message).toBeNull();
  });

  it("[mutant this kills: an off-by-one bytes > limit turned into bytes >= limit] a pack ONE BYTE OVER PREP_PACK_MAX_BYTES IS refused, reporting the overage", () => {
    const overLimit = padTo(PREP_PACK_MAX_BYTES + 1);
    expect(new TextEncoder().encode(JSON.stringify(overLimit)).length).toBe(PREP_PACK_MAX_BYTES + 1);
    const result = checkPackByteBudget(overLimit);
    expect(result.ok).toBe(false);
    expect(result.bytes).toBe(PREP_PACK_MAX_BYTES + 1);
    // TRUE wording only -- no "violates check constraint" and no invented
    // constraint name: that CHECK does not exist (interview_prep.sql's own
    // "NOT ADDED, deliberately" note), so the message must never claim it.
    expect(result.message).toMatch(/over the \d+-byte limit/i);
    expect(result.message).toContain("1 over");
  });

  it("[wiring] writePrepPackResult refuses an over-budget pack BEFORE issuing any database call", async () => {
    const sb = makeSupabase({});
    const oversized = { sections: {}, claims: {}, filler: "x".repeat(PREP_PACK_MAX_BYTES) };
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      engine: "gemini",
      pack: oversized,
    });
    expect(result.written).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.error).toMatch(/over the \d+-byte limit/i);
    // No .from() call at all was made against the packs table -- the
    // refusal happened before any statement was issued, never as a
    // reaction to a database error.
    expect(sb.calls.interview_prep_packs).toBeUndefined();
  });

  it("[no-op control] writePrepPackResult still writes a normal, well-under-budget pack", async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      engine: "gemini",
      pack: { sections: {}, claims: {} },
    });
    expect(result.written).toBe(true);
    expect(sb.calls.interview_prep_packs.update).toHaveLength(1);
  });
});

describe("isCheckViolation / PG_CHECK_VIOLATION -- SQLSTATE-based, never message-text (N9)", () => {
  // 3b.r1.md item 3 confirmed at primary source that SQLSTATE 23514 passes
  // through supabase-js clean and unmodified on error.code. This is the
  // fix for the defect N9 exists to remove: a message-text regex
  // (`/violates check constraint/i`) breaks on any Postgres wording change;
  // a `code === PG_CHECK_VIOLATION` comparison does not.
  it("[mutant this kills: code dropped or coerced] writePrepPackResult surfaces a database error's code verbatim", async () => {
    const sb = makeSupabase({
      interview_prep_packs: {
        data: null,
        error: { code: "23514", message: "new row violates check constraint \"interview_prep_packs_status_check\"" },
      },
    });
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
      reason: "check-violation",
    });
    expect(result.written).toBe(false);
    expect(result.code).toBe("23514");
    expect(isCheckViolation(result)).toBe(true);
  });

  it('[negative control] a NON-check database error (code "23505", message containing "violates") reads as isCheckViolation:false', async () => {
    const sb = makeSupabase({
      interview_prep_packs: {
        data: null,
        error: { code: "23505", message: 'duplicate key value violates unique constraint "interview_prep_packs_pkey"' },
      },
    });
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
    });
    expect(result.code).toBe("23505");
    expect(isCheckViolation(result)).toBe(false);
  });

  it("[mutant this kills: message-text-only, code never read] a CHECK error whose message does NOT contain \"violates check constraint\" is still recognised via its code alone", async () => {
    // A reworded/localised Postgres message -- the exact case a message-text
    // matcher cannot survive. This fixture's `code` (23514) is what marks it
    // as a CHECK violation; a build that read ONLY `error.message` (the old,
    // pre-N9 regex, with no `.code` comparison at all) would find no phrase
    // to match here and report false, disagreeing with the `true` expected
    // below. NOTE: this fixture does NOT discriminate an OR-fallback build
    // (`code === "23514" || /violates check constraint/i.test(message)`) --
    // its first term alone already agrees with the correct answer, so both
    // implementations return true here. See the dedicated OR-fallback
    // fixture and canary below for the one that actually tells them apart.
    const sb = makeSupabase({
      interview_prep_packs: {
        data: null,
        error: { code: "23514", message: 'new row for relation "interview_prep_packs" fails a check condition on "status"' },
      },
    });
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
    });
    expect(result.code).toBe("23514");
    expect(isCheckViolation(result)).toBe(true);
  });

  it("[regression guard] the pre-flight over-budget refusal (THE TRAP: a JS-side refusal with no driver error) still sets code: PG_CHECK_VIOLATION as a deliberate stand-in", async () => {
    const sb = makeSupabase({});
    const oversized = { sections: {}, claims: {}, filler: "x".repeat(PREP_PACK_MAX_BYTES) };
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      engine: "gemini",
      pack: oversized,
    });
    expect(result.written).toBe(false);
    expect(result.code).toBe("23514");
    expect(isCheckViolation(result)).toBe(true);
    // Still never reaches the database -- unchanged from the pre-existing
    // [wiring] test above.
    expect(sb.calls.interview_prep_packs).toBeUndefined();
  });

  it('[mutant this kills: an OR-fallback build (code === "23514" || /violates check constraint/i.test(message))] a database error carrying NO code but a message that DOES contain the phrase reads as isCheckViolation:false', async () => {
    // The one fixture shape that actually tells the correct, code-only
    // predicate apart from an OR-fallback: no `code` at all (so the correct
    // predicate's `result.code === "23514"` is false), paired with a
    // message that DOES carry "violates check constraint" (so the
    // OR-fallback's second term would be true). The correct predicate must
    // read false here; an OR-fallback would read true, disagreeing with the
    // assertion below -- deliberately, not incidentally.
    const sb = makeSupabase({
      interview_prep_packs: {
        data: null,
        // No `code` key at all -- error.code is undefined on this object,
        // exactly the shape a non-Postgres failure (a network error, say)
        // could carry.
        error: { message: "violates check constraint interview_prep_packs_status_check" },
      },
    });
    const result = await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
    });
    expect(result.code).toBeNull();
    expect(isCheckViolation(result)).toBe(false);
  });

  it("[canary] proves the fixture above genuinely discriminates an OR-fallback build from the real, code-only predicate", () => {
    // Not a runtime assertion against prepStore.js -- a literal simulation
    // of the OR-fallback build, run against the SAME fixture as the test
    // above, so the claim that it "reads as true there" is demonstrated
    // rather than merely asserted. Same idiom as this file's other
    // synthetic canaries (e.g. the claim_prep_pack_slot 4-parameter one,
    // above).
    const orFallbackIsCheckViolation = (result) =>
      result?.code === "23514" || /violates check constraint/i.test(result?.error || "");
    const fixture = { code: null, error: "violates check constraint interview_prep_packs_status_check" };
    expect(orFallbackIsCheckViolation(fixture)).toBe(true);
    expect(isCheckViolation(fixture)).toBe(false);
  });
});

describe("N14 -- writePrepPackResult omits pack/posting_fingerprint from its UPDATE SET when the caller does not supply them", () => {
  // interview_prep_packs.pack and .posting_fingerprint are both `not null`
  // with their own DEFAULT (supabase/migrations/20260914000000_interview_prep.sql
  // :155/:159) -- a DEFAULT never applies to an explicit `SET col = NULL`, so
  // this function's former unconditional payload put NULL into a NOT NULL
  // column for any caller that omitted either argument, raising SQLSTATE
  // 23502. finishAttempt.js's own CHECK-safe fallback retry (§8.4) is exactly
  // such a caller: it never supplies `pack` or `postingFingerprint`.
  function updatePayload(sb) {
    expect(sb.calls.interview_prep_packs.update).toHaveLength(1);
    return sb.calls.interview_prep_packs.update[0][0];
  }

  it('[mutant this kills: pack defaulted to null and written unconditionally] a terminal write that supplies no `pack` sends an UPDATE payload with NO "pack" key at all', async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
      reason: "check-violation",
      error: "pack is 300000 bytes, 37856 over the 262144-byte limit",
    });
    expect(updatePayload(sb)).not.toHaveProperty("pack");
  });

  it('[mutant this kills: posting_fingerprint defaulted to null and written unconditionally] the same write sends NO "posting_fingerprint" key either', async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
      reason: "check-violation",
      error: "pack is 300000 bytes, 37856 over the 262144-byte limit",
    });
    expect(updatePayload(sb)).not.toHaveProperty("posting_fingerprint");
  });

  it("[lease-release control, capable of failing against a blanket drop-every-null-or-undefined-key rewrite] the same write still sets lease_until: null and lease_token: null", async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
      reason: "check-violation",
      error: "pack is 300000 bytes, 37856 over the 262144-byte limit",
    });
    const payload = updatePayload(sb);
    expect(payload).toHaveProperty("lease_until", null);
    expect(payload).toHaveProperty("lease_token", null);
  });

  it('[writer-discipline control, §8.5] a status:"ready" write still force-nulls reason -- present-and-null, never omitted', async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      reason: "some-caller-supplied-value-that-must-be-cleared",
      engine: "gemini",
      pack: { sections: {}, claims: {} },
    });
    expect(updatePayload(sb)).toHaveProperty("reason", null);
  });

  it('[writer-discipline control, §8.5] a status:"partial" write also force-nulls reason', async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "partial",
      reason: "some-caller-supplied-value-that-must-be-cleared",
      pack: { sections: {}, claims: {} },
    });
    expect(updatePayload(sb)).toHaveProperty("reason", null);
  });

  it("a write that DOES supply a pack still sends it, keyed and normalized", async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "ready",
      engine: "gemini",
      pack: { sections: {}, claims: {} },
    });
    const payload = updatePayload(sb);
    expect(payload).toHaveProperty("pack");
    expect(payload.pack).not.toBeNull();
  });

  it("a write that DOES supply postingFingerprint still sends posting_fingerprint, keyed", async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "unavailable",
      reason: "refused-posting",
      postingFingerprint: "abc123",
    });
    expect(updatePayload(sb)).toHaveProperty("posting_fingerprint", "abc123");
  });

  it("[not-supplied vs explicitly-null] a write that explicitly supplies pack: null still sends the key, as null -- only an un-supplied argument is omitted", async () => {
    const sb = makeSupabase({ interview_prep_packs: { data: [{ application_id: APP_ID }], error: null } });
    await writePrepPackResult(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "unavailable",
      reason: "refused-posting",
      pack: null,
    });
    expect(updatePayload(sb)).toHaveProperty("pack", null);
  });
});

// ---------------------------------------------------------------------------
// F-R12-1 (fix round r12, MAJOR, verify.r12.md) -- dbFailureResponse is the
// single choke point route.js now routes every raw-database-text response
// path through. This is the unit-level guarantee the route-level sweep
// (app/api/interview-prep/route.dbFailureSweep.test.js) relies on: the
// helper ITSELF must never fold its own `meta.error` into the body it
// returns, regardless of what shape that error takes.
// ---------------------------------------------------------------------------

describe("dbFailureResponse -- the shared no-raw-database-text response builder", () => {
  it("returns the given message, never the raw error, in the response body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = dbFailureResponse(
      "some failed read",
      { applicationId: APP_ID, error: "PGRST301 relation interview_prep_section_revisions does not exist at char 42" },
      "Could not load this application's prep pack.",
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Could not load this application's prep pack." });
    expect(JSON.stringify(body)).not.toContain("PGRST301");
    spy.mockRestore();
  });

  it("[no-op control] the message IS what the body carries -- this is not a helper that swallows everything into a blank body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = dbFailureResponse("x", { error: "boom" }, "A real generic sentence.");
    const body = await res.json();
    expect(body.error).toBe("A real generic sentence.");
    spy.mockRestore();
  });

  it("logs `where` and the full `meta` (including the raw error) server-side, exactly once", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const meta = { applicationId: APP_ID, error: "raw db text" };
    dbFailureResponse("PATCH target revision read failed", meta, "generic");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("interview-prep: PATCH target revision read failed", meta);
    spy.mockRestore();
  });

  // F-R14-5 (fix round r14, MINOR, verify.r14.md): this test's own title
  // used to claim `extra` merges BEFORE `error`, so `error` always wins on a
  // collision -- backwards. The body literal is `{ error: message }` FIRST,
  // then only the keys named in DB_FAILURE_EXTRA_KEYS are copied ON TOP of
  // it (prepStore.js's own `dbFailureResponse`); `extra.error` would
  // overwrite the generic message, not the other way around. What protects
  // the body today is the allow-list itself -- `DB_FAILURE_EXTRA_KEYS` is
  // `["written"]`, so nothing extra carries can collide with `error` -- not
  // any ordering guarantee this function makes.
  it("copies only allow-listed `extra` keys ON TOP of `error` (today just `written`) -- what keeps `error` intact is the allow-list, never an ordering guarantee", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = dbFailureResponse("PUT candidate name save failed", { error: "raw" }, "Could not save your name.", { written: false });
    const body = await res.json();
    expect(body).toEqual({ written: false, error: "Could not save your name." });
    spy.mockRestore();
  });

  it("[no-op control] with no `extra` argument, the body carries only `error`", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = dbFailureResponse("x", { error: "raw" }, "generic");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["error"]);
    spy.mockRestore();
  });

  // F-R13-2 (fix round r13, MAJOR, verify.r13.md) -- EVADE-extraFourthArg: a
  // caller passing raw database text through the FOURTH argument used to
  // walk it straight into the response body (`{ ...extra, error: message }`
  // copied every key `extra` carried, not just `written`), surviving the
  // whole 814-test suite because nothing checked that argument's own shape.
  it("[RED before this fix round] a fourth-argument key outside the declared allow-list is dropped, never merged into the body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = dbFailureResponse(
      "GET pack read failed",
      { applicationId: APP_ID, error: "raw db text" },
      "Could not load this application's prep pack.",
      { detail: "PGRST301 relation interview_prep_packs does not exist at char 42", written: false },
    );
    const body = await res.json();
    expect(body).toEqual({ error: "Could not load this application's prep pack.", written: false });
    expect(body).not.toHaveProperty("detail");
    expect(JSON.stringify(body)).not.toContain("PGRST301");
    spy.mockRestore();
  });
});

describe("logDbFailure -- the server-side-only logging discipline dbFailureResponse and readTrustedNames both share", () => {
  it("logs `where` and the full `meta`, exactly once, and returns nothing to the caller", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const meta = { applicationId: APP_ID, error: "raw db text" };
    const result = logDbFailure("some label", meta);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("interview-prep: some label", meta);
    expect(result).toBeUndefined();
    spy.mockRestore();
  });
});
