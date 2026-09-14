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

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const LEASE_TOKEN = "33333333-3333-3333-3333-333333333333";

const FINISH_ATTEMPT_PATH = path.join(process.cwd(), "lib", "interviewPrep", "finishAttempt.js");

/** Same comment-stripping discipline as route.test.js's own codeOf. */
function codeOf(filePath) {
  return readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

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
