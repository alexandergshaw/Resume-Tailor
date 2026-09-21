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
// N45/N46 UPDATE: the paragraph above described a defect that no longer
// exists. `writePrepPackResult` (prepStore.js:~490) now guards the column
// with `if (pack !== undefined) updateSet.pack = normalizedPack;` -- a
// payload carrying no `pack` OMITS the column from the UPDATE rather than
// nulling it, so this retry has always been reachable and safe since that
// guard landed. What the retry could not do until now is carry content BACK:
// it always ran with no `pack` at all, so a CHECK-safe recovery from a
// too-large/malformed write left the row's `pack` exactly as
// `claim_prep_pack_slot` had already blanked it to `'{}'`. `restore` below
// (plan §2.2, the F2 resolution) closes that: when the caller supplies one,
// this retry restores the candidate's prior document instead of leaving it
// empty.
//
// FIX ROUND UPDATE (B2): the paragraph above was itself incomplete. `restore`
// landed, but `storedNames` did not travel with it -- the retry rebuilt its
// payload from scratch and never named `storedNames`, so
// `writePrepPackResult` applied its own `storedNames = []` default and
// re-normalized the restored pack with NO trusted names, silently dropping
// every line the O-15 name exemption had preserved. `storedNames` is now
// destructured out of ctx explicitly, the same way `restore` is, and
// forwarded to BOTH writes below.
import {
  writePrepPackResult as defaultWritePrepPackResult,
  recordPrepEvent as defaultRecordPrepEvent,
  isCheckViolation as defaultIsCheckViolation,
} from "./prepStore.js";

// interview_prep_events_outcome_check (supabase/migrations/
// 20260914000000_interview_prep.sql:413-418) states the 'attempt' outcome
// vocabulary this function maps into -- 7 members: 'ready', 'partial',
// 'failed', 'unavailable', 'check-violation', 'stale-token', 'error'. N10
// found the mapping this function used to implement (an unconditional
// 'failed' -> 'error' rewrite) was written as a guess, before that CHECK was
// read -- it contradicted the stated vocabulary in two ways (collapsing a
// permitted 'failed' outcome, and never reaching a permitted
// 'check-violation' one). Reachability of all 7, one by one:
//
//  - 'ready' / 'partial' / 'unavailable': plain pass-through below, for
//    whatever `status` the caller's payload carries (route.js only ever
//    passes 'ready'/'unavailable' today; 'partial' is exercised directly by
//    finishAttempt.test.js -- no current route.js call site produces it,
//    but nothing here excludes it either).
//  - 'failed': ALSO plain pass-through now (the fix below) -- a `status`
//    of 'failed' whose `reason` is anything other than 'check-violation'
//    (e.g. 'provider-error', 'provider-timeout', 'spend-record-failed')
//    records outcome 'failed', matching the pack's own terminal `status`
//    exactly like every other value in this list, rather than being
//    silently renamed.
//  - 'error': the one deliberate exception to the pass-through above.
//    `reason === "check-violation"` only ever arrives here from THIS
//    function's own CHECK-safe fallback retry, a few lines down -- the
//    ordinary write itself hit a genuine database-level error (a CHECK
//    violation), and recovering via a second, minimal-payload write does
//    not undo the fact that the operation errored. Recording that as
//    outcome 'failed' would make it indistinguishable from an ordinary
//    domain failure (a provider timeout, a refused posting); 'error' -- the
//    same value the 'delete' vocabulary uses for "the operation itself
//    errored" (interview_prep_events_outcome_check's other branch) -- keeps
//    it distinguishable, while `reason` still carries the finer-grained
//    'check-violation' detail.
//  - 'check-violation': permitted by the CHECK, never emitted as an
//    OUTCOME by this file. The one path that sets `reason:
//    "check-violation"` (the fallback below) records outcome 'error', per
//    the point above -- the detail this value would add is already
//    present in `reason`, and finishAttempt.test.js's own landed assertion
//    (the CHECK-safe fallback's first test) pins outcome to 'error' for
//    this exact call shape. Documented here as an overshoot in the stated
//    vocabulary, not a missing case.
//  - 'stale-token': permitted by the CHECK, and reachable -- but not
//    through this function's `status`/`reason` pass-through at all.
//    `writePrepPackResult` (prepStore.js) returns `reason: "stale-token"`
//    when its own UPDATE matches zero rows (another invocation's write
//    already rotated `lease_token` first); finishAttempt's own code below
//    now records that as its own attempt event, with outcome "stale-token"
//    directly (never routed through this function, since there is no
//    pack `status` to mirror -- the write never touched the row).
function outcomeForStatus(status, reason) {
  if (status === "failed" && reason === "check-violation") return "error";
  return status;
}

/**
 * @param {*} supabase
 * @param {{ applicationId: string, userId: string, leaseToken: string, triggerClass?: string, engine?: string,
 *           restore?: {}|{pack: object, liveRevisions: Record<string, number>}, storedNames?: string[],
 *           [key: string]: * }} ctx
 *   `triggerClass`/`engine` are consumed only by the event write below;
 *   every other field is forwarded to `writePrepPackResult` as-is.
 *
 *   `restore` (plan §2.2) is destructured out of ctx beside
 *   triggerClass/engine and is consumed ONLY by the CHECK-safe fallback
 *   retry below. It is NEVER spread into the first write: route.js's own
 *   failure call sites spread it into their own payloads, explicitly, so
 *   that `pack` is never written by a value this function injected on its
 *   caller's behalf. A `finishAttempt` that silently added content to a
 *   write its caller did not ask for would be a second, hidden writer of
 *   `interview_prep_packs.pack` and would falsify R-N45-CLAIMS. DEFAULT
 *   undefined -> the retry payload is byte-identical to today's, apart from
 *   `storedNames` immediately below, which the retry now always carries.
 *
 *   `storedNames` (fix round, B2) is ALSO destructured out of ctx, unlike
 *   every other field. The FIRST write's behaviour is unchanged by this --
 *   it is forwarded there exactly as it always was, just explicitly now
 *   instead of riding through `...payload`. What changes is the RETRY: it
 *   used to omit `storedNames` entirely, so `writePrepPackResult` applied
 *   its own `storedNames = []` default and re-normalized a restored pack
 *   against no trusted names at all, silently dropping every line the O-15
 *   name exemption had preserved. Forwarded unconditionally -- whether or
 *   not `restore` is also present -- so there is no state in which a
 *   restore carries content but no names to screen it against.
 * @param {{ writePrepPackResult?: Function, recordPrepEvent?: Function, isCheckViolation?: Function }} [deps]
 *   The three prepStore.js functions this orchestration calls, injectable so
 *   a test can substitute them without a real Supabase client -- default to
 *   the real prepStore.js implementations for every production call site.
 */
export async function finishAttempt(
  supabase,
  { applicationId, userId, leaseToken, triggerClass, engine, restore, storedNames, ...payload },
  {
    writePrepPackResult = defaultWritePrepPackResult,
    recordPrepEvent = defaultRecordPrepEvent,
    isCheckViolation = defaultIsCheckViolation,
  } = {},
) {
  let write = await writePrepPackResult(supabase, { applicationId, userId, leaseToken, storedNames, ...payload });
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
      storedNames,
      ...(restore || {}),
    });
  }

  if (write.written) {
    await recordPrepEvent(supabase, {
      applicationId,
      userId,
      eventType: "attempt",
      triggerClass,
      engine,
      outcome: outcomeForStatus(status, reason),
      reason,
    });
  } else if (write.reason === "stale-token") {
    // The write matched zero rows -- see outcomeForStatus's own header on
    // why 'stale-token' is not routed through that function. Still a real,
    // durable attempt event (not silently dropped): route.js's own
    // writeFailureResponse treats a stale-token write as an expected
    // outcome ({ status: "stale" }, never a 500), and the CHECK's
    // 'stale-token' member exists for exactly this case. `reason` is
    // forced to null -- 'stale-token' is not one of the 8
    // PREP_REASON_VALUES this column's own CHECK permits
    // (interview_prep_events_reason_check), so null is the only legal
    // value left to store.
    await recordPrepEvent(supabase, {
      applicationId,
      userId,
      eventType: "attempt",
      triggerClass,
      engine,
      outcome: "stale-token",
      reason: null,
    });
  }

  return { write, status };
}
