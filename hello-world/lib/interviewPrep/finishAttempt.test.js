// lib/interviewPrep/finishAttempt.js -- extracted out of
// app/api/interview-prep/route.js precisely so the CHECK-safe fallback
// retry (design-structure.r1.md §8.4, N9's fix) can get REAL runtime
// coverage: route.test.js is a deliberate source-text-only instrument (see
// its own header) and Next.js route files should not grow extra exports, so
// neither could ever drive this branch by actually calling it. This file
// does, via finishAttempt's injectable `writePrepPackResult`/
// `recordPrepEvent`/`isCheckViolation` deps -- no real Supabase client
// needed, since every store call is substituted directly.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { finishAttempt } from "@/lib/interviewPrep/finishAttempt.js";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";
import { codeOf } from "../../test/helpers/stripComments.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const LEASE_TOKEN = "33333333-3333-3333-3333-333333333333";

const FINISH_ATTEMPT_PATH = path.join(process.cwd(), "lib", "interviewPrep", "finishAttempt.js");

describe("finishAttempt -- the CHECK-safe fallback retry (design-structure.r1.md §8.4, N9)", () => {
  it('[mutant this kills: isCheckViolation(write.error) / "if (false && ...)" / the fallback block deleted] a first write refused as a CHECK violation triggers a SECOND write carrying status:"failed", reason:"check-violation"', async () => {
    const firstWrite = { written: false, reason: "error", code: "23514", error: "pack is 300000 bytes, 37856 over the 262144-byte limit" };
    const secondWrite = { written: true, reason: null, error: null, code: null };
    const writePrepPackResult = vi.fn().mockResolvedValueOnce(firstWrite).mockResolvedValueOnce(secondWrite);
    const recordPrepEvent = vi.fn().mockResolvedValue({ recorded: true, error: null });

    const result = await finishAttempt(
      {},
      {
        applicationId: APP_ID,
        userId: USER_ID,
        leaseToken: LEASE_TOKEN,
        triggerClass: "B1",
        engine: "gemini",
        status: "ready",
        pack: { sections: {}, claims: {} },
      },
      { writePrepPackResult, recordPrepEvent },
    );

    expect(writePrepPackResult).toHaveBeenCalledTimes(2);
    const [, secondCallArgs] = writePrepPackResult.mock.calls[1];
    expect(secondCallArgs).toMatchObject({
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "failed",
      reason: "check-violation",
      error: firstWrite.error,
    });
    // The fallback payload carries no `pack` -- the same CHECK that could
    // reject a real pack can never reject this retry.
    expect(secondCallArgs).not.toHaveProperty("pack");
    expect(result.write).toBe(secondWrite);
    expect(result.status).toBe("failed");
    expect(recordPrepEvent).toHaveBeenCalledTimes(1);
    expect(recordPrepEvent.mock.calls[0][1]).toMatchObject({ outcome: "error", reason: "check-violation" });
  });

  it('[control] a non-CHECK database error (code "23505") does NOT trigger a second write', async () => {
    const firstWrite = { written: false, reason: "error", code: "23505", error: "duplicate key value violates unique constraint" };
    const writePrepPackResult = vi.fn().mockResolvedValueOnce(firstWrite);
    const recordPrepEvent = vi.fn().mockResolvedValue({ recorded: true, error: null });

    const result = await finishAttempt(
      {},
      { applicationId: APP_ID, userId: USER_ID, leaseToken: LEASE_TOKEN, status: "failed", reason: "provider-error" },
      { writePrepPackResult, recordPrepEvent },
    );

    expect(writePrepPackResult).toHaveBeenCalledTimes(1);
    expect(recordPrepEvent).not.toHaveBeenCalled();
    expect(result.write).toBe(firstWrite);
    expect(result.status).toBe("failed");
  });

  it("[no-op control] a successful first write never triggers a second write, and the event row is recorded exactly once", async () => {
    const successfulWrite = { written: true, reason: null, error: null, code: null };
    const writePrepPackResult = vi.fn().mockResolvedValueOnce(successfulWrite);
    const recordPrepEvent = vi.fn().mockResolvedValue({ recorded: true, error: null });

    const result = await finishAttempt(
      {},
      {
        applicationId: APP_ID,
        userId: USER_ID,
        leaseToken: LEASE_TOKEN,
        triggerClass: "B1",
        engine: "embedded",
        status: "ready",
        pack: { sections: {}, claims: {} },
      },
      { writePrepPackResult, recordPrepEvent },
    );

    expect(writePrepPackResult).toHaveBeenCalledTimes(1);
    expect(recordPrepEvent).toHaveBeenCalledTimes(1);
    expect(result.write).toBe(successfulWrite);
    expect(result.status).toBe("ready");
  });
});

describe("isCheckViolation is applied to the write result by call shape, not merely imported (N9, evasion-hardened)", () => {
  // check-4b.r1.md's finding against the pre-extraction route.test.js: an
  // import-line regex matches an ALIASED import
  // (`isCheckViolation as sharedCheckPredicate`) sitting beside a route-local
  // `const isCheckViolation = () => false` -- the broken predicate is never
  // called, but the import-line check alone cannot tell. Fixed by asserting
  // the CALL SHAPE (the literal name applied to `write`) and the absence of
  // any local definition of that same name, together.
  const PREDICATE_APPLIED_TO_WRITE = /isCheckViolation\s*\(\s*write\s*\)/;
  const NO_LOCAL_DEFINITION = /(function|const|let)\s+isCheckViolation\b/;
  const CHECK_PHRASE = /check\s+constraint/i;

  it("imports isCheckViolation from prepStore.js", () => {
    const code = codeOf(FINISH_ATTEMPT_PATH);
    // The relative import here carries its own ".js" extension (this
    // module's own convention, matching prepStore.js's own
    // "./prepParse.js"), unlike route.js's bare "@/lib/interviewPrep/prepStore"
    // alias -- the optional (?:\.js)? tolerates either.
    expect(code).toMatch(/import\s*\{[^}]*\bisCheckViolation\b[^}]*\}\s*from\s*["'][^"']*prepStore(?:\.js)?["']/);
  });

  it("[mutant this kills: an aliased import beside a dead local reimplementation] the predicate is applied directly to the write result, and has no local definition of its own", () => {
    const code = codeOf(FINISH_ATTEMPT_PATH);
    expect(code).toMatch(PREDICATE_APPLIED_TO_WRITE);
    expect(code).not.toMatch(NO_LOCAL_DEFINITION);
  });

  it('[mutant this kills: the message-text regex reintroduced, with or without "violates"] finishAttempt.js carries no CHECK-constraint phrasing of its own', () => {
    const code = codeOf(FINISH_ATTEMPT_PATH);
    expect(code).not.toMatch(CHECK_PHRASE);
  });

  it("[control] the call-shape + no-local-definition pair can actually fail -- proven on the exact aliasing evasion described above", () => {
    const aliasedEvasion = `
      import { isCheckViolation as sharedCheckPredicate } from "./prepStore.js";
      const isCheckViolation = () => false;
      if (!write.written && write.reason === "error" && sharedCheckPredicate(write)) {
        // ...
      }
    `;
    // The real predicate is called under a different local name, so the
    // call-shape check finds nothing to match...
    expect(aliasedEvasion).not.toMatch(PREDICATE_APPLIED_TO_WRITE);
    // ...and the always-false local definition IS caught by the ban, which
    // is what makes this fixture an evasion of the OLD (import-line-only)
    // check rather than a legitimate build.
    expect(aliasedEvasion).toMatch(NO_LOCAL_DEFINITION);
  });

  it('[control] the broadened CHECK-phrase ban can actually fail -- proven on a fixture missing "violates"', () => {
    const rewordedFallback = `if (result.code === "23514" || /check constraint/i.test(result.message)) { }`;
    expect(rewordedFallback).toMatch(CHECK_PHRASE);
  });
});

describe("finishAttempt's DEFAULT deps -- real prepStore.js functions, driven with no third argument (N14 remediation review)", () => {
  // Every test above injects writePrepPackResult/recordPrepEvent, so none of
  // them ever executes the real default bindings imported at the top of
  // finishAttempt.js -- the source-text block above only ever scans
  // isCheckViolation. Measured: swapping
  //   writePrepPackResult = defaultRecordPrepEvent,
  //   recordPrepEvent = defaultWritePrepPackResult,
  // leaves every test in this file (and route.test.js's source-text checks)
  // green, because nothing calls finishAttempt without its third argument.
  // This is the companyFactsSource.wire.test.js hazard: an injected fake
  // cannot see the layer that drops your argument. This test calls
  // finishAttempt with NO third argument at all, against
  // test/helpers/supabaseMock.js's makeSupabase, so the REAL
  // writePrepPackResult and recordPrepEvent run -- proving both which
  // default is bound to which name, and that writePrepPackResult accepts
  // the exact payload shape finishAttempt builds.
  it("[mutant this kills: defaultWritePrepPackResult/defaultRecordPrepEvent swapped with each other] a successful attempt updates interview_prep_packs exactly once and inserts one interview_prep_events row carrying the route's trigger_class/engine/outcome/reason", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
    });

    const result = await finishAttempt(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      triggerClass: "B1",
      engine: "gemini",
      status: "ready",
      pack: { sections: {}, claims: {} },
    });

    // Swapped defaults call the events-table function where the packs-table
    // one belongs (and vice versa): the packs UPDATE never happens, because
    // finishAttempt only reaches its recordPrepEvent call when
    // `write.written` is true, and the wrong function returns
    // `{ recorded: true }` instead -- `written` stays undefined/falsy.
    expect(sb.calls.interview_prep_packs.update).toHaveLength(1);
    expect(sb.calls.interview_prep_events.insert).toHaveLength(1);

    const eventPayload = sb.calls.interview_prep_events.insert[0][0];
    expect(eventPayload).toMatchObject({
      trigger_class: "B1",
      engine: "gemini",
      outcome: "ready",
      reason: null,
    });
    expect(result.write.written).toBe(true);
    expect(result.status).toBe("ready");
  });
});

describe("outcomeForStatus's mapping (N10) -- every reachable 'attempt' outcome, driven through a real finishAttempt call", () => {
  // N10 found the header comment's claimed mapping ('failed' -> 'error',
  // else mirrors `status`) written as a guess, absent any stated CHECK
  // vocabulary -- but interview_prep_events_outcome_check
  // (supabase/migrations/20260914000000_interview_prep.sql:413-418) DOES
  // state one, and it contradicts that guess: 'failed' is itself a
  // permitted 'attempt' outcome, so collapsing every 'failed' status into
  // 'error' erases a real distinction the schema keeps. These tests drive
  // finishAttempt for real (via makeSupabase's REAL writePrepPackResult/
  // recordPrepEvent, the same style as the "DEFAULT deps" block above) for
  // every status route.js can pass that is NOT already covered by an
  // existing test in this file.

  it("[mutant this kills: outcomeForStatus's unconditional 'failed' -> 'error' rewrite] a plain 'failed' status (no CHECK-safe fallback involved) is recorded as outcome 'failed', carrying its own reason unchanged", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
    });

    const result = await finishAttempt(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      triggerClass: "B1",
      engine: "gemini",
      status: "failed",
      reason: "provider-error",
      error: "The model call did not complete.",
    });

    const eventPayload = sb.calls.interview_prep_events.insert[0][0];
    expect(eventPayload).toMatchObject({ outcome: "failed", reason: "provider-error" });
    expect(result.status).toBe("failed");
  });

  it("a 'partial' status passes straight through as outcome 'partial'", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
    });

    await finishAttempt(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "partial",
      pack: { sections: {}, claims: {} },
    });

    expect(sb.calls.interview_prep_events.insert[0][0]).toMatchObject({ outcome: "partial", reason: null });
  });

  it("an 'unavailable' status passes straight through as outcome 'unavailable', carrying its reason", async () => {
    const sb = makeSupabase({
      interview_prep_packs: { data: [{ application_id: APP_ID }], error: null },
    });

    await finishAttempt(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      status: "unavailable",
      reason: "refused-posting",
    });

    expect(sb.calls.interview_prep_events.insert[0][0]).toMatchObject({
      outcome: "unavailable",
      reason: "refused-posting",
    });
  });

  it('[mutant this kills: the stale-token branch deleted, or its outcome/reason hardcoded wrong] a write that matches zero rows (write.reason "stale-token") still records ONE attempt event, with outcome "stale-token" and reason forced to null', async () => {
    // data: [] reproduces writePrepPackResult's own stale-token path
    // (prepStore.js:412-413): the UPDATE's .eq("lease_token", ...) predicate
    // matched no row because some other invocation's write already rotated
    // it first. No local mock of writePrepPackResult here -- the real
    // prepStore.js function runs, exactly like the "DEFAULT deps" block above.
    const sb = makeSupabase({
      interview_prep_packs: { data: [], error: null },
    });

    const result = await finishAttempt(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      triggerClass: "B1",
      engine: "gemini",
      status: "ready",
      pack: { sections: {}, claims: {} },
    });

    expect(result.write.written).toBe(false);
    expect(result.write.reason).toBe("stale-token");
    expect(sb.calls.interview_prep_packs.update).toHaveLength(1);
    expect(sb.calls.interview_prep_events.insert).toHaveLength(1);
    // 'stale-token' is not a member of the 8-value PREP_REASON_VALUES
    // vocabulary (prepContract.js) that this same `reason` column is
    // CHECK-bounded to, so nothing but null is legal to store here.
    expect(sb.calls.interview_prep_events.insert[0][0]).toMatchObject({
      outcome: "stale-token",
      reason: null,
    });
  });
});

describe("interview_prep_events_outcome_check's 'attempt' vocabulary, parsed from the migration itself (N10 vocabulary-drift guard)", () => {
  const MIGRATION_PATH = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260914000000_interview_prep.sql",
  );

  // Reads the vocabulary out of the migration's own SQL text -- never a JS
  // constant copied from it. This repo has exactly one JS-side vocabulary
  // constant near this feature, PREP_REASON_VALUES (prepContract.js), and it
  // is the unrelated 8-member `reason` vocabulary shared by both tables, not
  // this 7-member `outcome` vocabulary -- there is no JS constant this guard
  // could shortcut through even if it wanted to (the C4B-7/N3 canary trap
  // this guard exists to avoid).
  function attemptOutcomeVocabulary() {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const match = sql.match(/event_type\s*=\s*'attempt'\s*and\s*outcome\s*in\s*\(([^)]*)\)/);
    if (!match) {
      throw new Error("interview_prep_events_outcome_check's 'attempt' branch was not found in the migration");
    }
    return match[1]
      .split(",")
      .map((entry) => entry.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
  }

  it("has exactly the 7 members outcomeForStatus is documented against", () => {
    expect(attemptOutcomeVocabulary().sort()).toEqual(
      ["check-violation", "error", "failed", "partial", "ready", "stale-token", "unavailable"].sort(),
    );
  });

  it("[control] the membership check below is capable of failing -- a value the migration does not list is correctly rejected", () => {
    const vocabulary = attemptOutcomeVocabulary();
    expect(vocabulary).not.toContain("bogus-outcome-a-mutant-might-emit");
  });

  it("every outcome a real finishAttempt call can emit stays inside the migration's own vocabulary", async () => {
    const vocabulary = attemptOutcomeVocabulary();
    const emitted = [];
    const recordPrepEvent = vi.fn(async (_sb, payload) => {
      emitted.push(payload.outcome);
      return { recorded: true, error: null };
    });
    const writtenOk = { written: true, reason: null, error: null, code: null };

    // Every branch finishAttempt.js's own code can reach: plain status
    // pass-through (ready/partial/unavailable/failed), the CHECK-safe
    // fallback (-> "error"), and the stale-token branch (-> "stale-token").
    for (const status of ["ready", "partial", "unavailable", "failed"]) {
      await finishAttempt(
        {},
        { applicationId: APP_ID, userId: USER_ID, leaseToken: LEASE_TOKEN, status, reason: null },
        { writePrepPackResult: vi.fn().mockResolvedValue(writtenOk), recordPrepEvent },
      );
    }

    const checkViolationFirstWrite = { written: false, reason: "error", code: "23514", error: "too big" };
    await finishAttempt(
      {},
      { applicationId: APP_ID, userId: USER_ID, leaseToken: LEASE_TOKEN, status: "ready", pack: {} },
      {
        writePrepPackResult: vi.fn().mockResolvedValueOnce(checkViolationFirstWrite).mockResolvedValueOnce(writtenOk),
        recordPrepEvent,
      },
    );

    await finishAttempt(
      {},
      { applicationId: APP_ID, userId: USER_ID, leaseToken: LEASE_TOKEN, status: "ready", pack: {} },
      {
        writePrepPackResult: vi.fn().mockResolvedValue({ written: false, reason: "stale-token", error: null, code: null }),
        recordPrepEvent,
      },
    );

    expect(emitted.length).toBe(6);
    for (const outcome of emitted) {
      expect(vocabulary).toContain(outcome);
    }
  });
});
