// The one place an attempt's terminal write AND its durable event row happen
// together, for every attempt app/api/interview-prep/route.js's POST handler
// makes (unavailable, embedded-ready, gemini-ready, or any failure).
//
// Extracted out of route.js into its own module (not left as a route-local
// helper) for exactly one reason: Next.js route files should not grow extra
// exports, and app/api/interview-prep/route.test.js is a deliberate
// source-text-only instrument (see its own header) -- neither can give this
// function's one behavioural branch (the CHECK-safe fallback below) real
// runtime coverage. finishAttempt.test.js, alongside this file, drives it
// with an injected `writePrepPackResult` instead.
//
// design-structure.r1.md §8.4's CHECK-safe fallback lives here: if the
// ordinary write itself violates a CHECK, retry once with a minimal payload
// rather than leaving the row stuck mid-attempt -- the fallback carries no
// `pack` content, so the size/shape CHECK that could reject a real pack
// cannot reject it.
//
// THAT IS NOT THE SAME AS "always satisfiable", and the original comment
// here claimed it was. Because `writePrepPackResult` writes `pack` into its
// UPDATE SET list unconditionally, a payload carrying no pack writes
// `pack = NULL` -- and the column is declared `not null` (supabase/
// migrations/20260914000000_interview_prep.sql:155). Against a real
// database this retry raises 23502, which this function's own predicate
// deliberately excludes, so the fallback cannot currently succeed. Recorded
// as backlog item N14, unfixed here and read off the declared DDL rather
// than executed -- no live Postgres is reachable from this checkout.
import {
  writePrepPackResult as defaultWritePrepPackResult,
  recordPrepEvent as defaultRecordPrepEvent,
  isCheckViolation as defaultIsCheckViolation,
} from "./prepStore.js";

// interview_prep_events' outcome mirrors the pack's own terminal `status`
// ('ready', 'partial', 'unavailable'), except a 'failed' status is recorded
// as 'error' -- see app/api/interview-prep/route.js's own header comment for
// the full rationale (the outcome vocabulary this maps into is shared with
// every other attempt this route records).
function outcomeForStatus(status) {
  return status === "failed" ? "error" : status;
}

/**
 * @param {*} supabase
 * @param {{ applicationId: string, userId: string, leaseToken: string, triggerClass?: string, engine?: string, [key: string]: * }} ctx
 *   `triggerClass`/`engine` are consumed only by the event write below;
 *   every other field is forwarded to `writePrepPackResult` as-is.
 * @param {{ writePrepPackResult?: Function, recordPrepEvent?: Function, isCheckViolation?: Function }} [deps]
 *   The three prepStore.js functions this orchestration calls, injectable so
 *   a test can substitute them without a real Supabase client -- default to
 *   the real prepStore.js implementations for every production call site.
 */
export async function finishAttempt(
  supabase,
  { applicationId, userId, leaseToken, triggerClass, engine, ...payload },
  {
    writePrepPackResult = defaultWritePrepPackResult,
    recordPrepEvent = defaultRecordPrepEvent,
    isCheckViolation = defaultIsCheckViolation,
  } = {},
) {
  let write = await writePrepPackResult(supabase, { applicationId, userId, leaseToken, ...payload });
  let status = payload.status;
  let reason = payload.reason ?? null;

  if (!write.written && write.reason === "error" && isCheckViolation(write)) {
    status = "failed";
    reason = "check-violation";
    write = await writePrepPackResult(supabase, {
      applicationId,
      userId,
      leaseToken,
      status: "failed",
      reason: "check-violation",
      error: write.error,
    });
  }

  if (write.written) {
    await recordPrepEvent(supabase, {
      applicationId,
      userId,
      eventType: "attempt",
      triggerClass,
      engine,
      outcome: outcomeForStatus(status),
      reason,
    });
  }

  return { write, status };
}
