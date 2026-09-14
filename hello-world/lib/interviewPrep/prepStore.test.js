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
import { describe, it, expect } from "vitest";
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

describe("the three-case post-delete read derivation (design-structure.r1.md §5.2, R-IP3-44)", () => {
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

  it('case 2 -- spend row present, BOTH caps clear, no pack row -> deliberate collapse to "never attempted", offer Prepare', async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 2, model_calls: 3 }, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(false);
    expect(result.pack).toBeNull();
  });

  it('case 3 -- spend row present, attempts cap hit, no pack row -> "exhausted", no control offered', async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 6, model_calls: 3 }, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(true);
    // design-experience.r2.md §2's own rule: regenerateOffered = !attemptsExhausted.
    expect(!result.attemptsExhausted).toBe(false);
  });

  it('case 3, other cap -- spend row present, model_calls cap hit, no pack row -> "exhausted" too', async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 1, model_calls: 12 }, error: null },
    });
    const result = await readPrepPack(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(result.attemptsExhausted).toBe(true);
  });

  it("[mutant] cases 1 and 2 must be indistinguishable in attemptsExhausted (the contract's own deliberate collapse) -- and distinct from case 3", async () => {
    const sbCase1 = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: null, error: null },
    });
    const sbCase2 = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 5, model_calls: 11 }, error: null },
    });
    const sbCase3 = makeSupabase({
      interview_prep_packs: { data: null, error: null },
      interview_prep_spend: { data: { application_id: APP_ID, user_id: USER_ID, attempts: 6, model_calls: 11 }, error: null },
    });
    const [r1, r2, r3] = await Promise.all([
      readPrepPack(sbCase1, { applicationId: APP_ID, userId: USER_ID }),
      readPrepPack(sbCase2, { applicationId: APP_ID, userId: USER_ID }),
      readPrepPack(sbCase3, { applicationId: APP_ID, userId: USER_ID }),
    ]);
    expect(r1.attemptsExhausted).toBe(r2.attemptsExhausted);
    expect(r3.attemptsExhausted).not.toBe(r1.attemptsExhausted);
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
    expect(result.message).toMatch(/violates check constraint/i);
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
    expect(result.error).toMatch(/violates check constraint/i);
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
