// The ephemeral, per-tab activity ledger design-experience.r2.md §4.2 designs
// the OBSERVABLE contract for: a candidate-visible "N events recorded"
// caption and its own reset control (D6(v)), separate from Delete, that
// never reads or writes `interview_prep_packs`/`interview_prep_spend`/
// `interview_prep_events`. The durable disclosure record IS
// `interview_prep_events` (`prepStore.js`); "Download prep log" is served
// from `listPrepEvents`, never from this module (design-experience.r2.md
// §4.2 item 6). This ledger backs only the on-screen count and its reset --
// it dies with the tab, by design, and that is the point: resetting it must
// never look like, or act like, clearing the permanent record.
//
// SCOPE, STATED HONESTLY. No binding IP3 document names this module's own
// export shape: design-experience.r2.md §4.2's own "what this subsection
// does not decide" leaves "whether prepLog.js's exact internal shape is a
// plain array-of-objects, whether it carries a FIFO cap... and the precise
// React-state wiring" to whichever round implements it, and
// design-structure.r1.md's module-boundaries table (§3) -- the document that
// was supposed to pick this up -- has no entry for this file at all. No 4b
// test in this checkout exercises it. What follows is the smallest faithful
// reading of what every document DOES agree on, modeled on this repo's own
// established feature-log idiom (`lib/copilot/sessionLog.js`'s
// `createSessionLog`: a pure, no-React, no-IO factory that records and can
// be reset) rather than on `useDuplicateApplyCheck.js`'s `dupeLogRef`/
// `dupeLogCount` idiom directly -- that idiom's ref/state SPLIT is a REACT
// concern belonging to whichever hook or component wraps this module
// (`PrepPackPanel.js`, a later wave), not to this lib-level module.

// AC-shaped headroom, matching `sessionLog.js`'s own FIFO-cap reasoning: a
// long-lived tab must not grow this array without bound, but the entries a
// candidate just produced (the ones the on-screen caption is actually about)
// must survive. Oldest evicted first.
const MAX_PREP_LOG_ENTRIES = 200;

/**
 * Create a fresh, empty prep-activity ledger. Pure: no Supabase, no DOM, no
 * React. `now` is injected so a timestamp is a value under test, never the
 * ambient wall clock.
 *
 * @param {{ now?: () => number }} [opts]
 */
export function createPrepLog({ now = Date.now } = {}) {
  let entries = [];

  /**
   * Record one activity entry. `kind` is `"attempt"` or `"delete"` --
   * matching `interview_prep_events.event_type`, the two things this ledger
   * exists to echo on-screen -- and `outcome` is whatever short label the
   * caller already has for it. This module does not validate either against
   * any CHECK vocabulary; that enforcement lives in the database, via
   * `prepStore.js`. Never throws: a logging failure must not break the
   * caller's own attempt/delete flow.
   *
   * @param {"attempt" | "delete"} kind
   * @param {string | null} [outcome]
   */
  function record(kind, outcome = null) {
    try {
      entries.push({ kind: String(kind ?? "unknown"), outcome, at: now() });
      if (entries.length > MAX_PREP_LOG_ENTRIES) entries.shift();
    } catch {
      // Never let logging break the caller's own attempt/delete flow.
    }
  }

  /**
   * Clears the ledger back to empty. This is the ONLY thing D6(v)'s reset
   * control does -- it never touches Supabase, matching design-experience.r2.md
   * §4.2 item 3 ("nothing about this touches interview_prep_packs,
   * interview_prep_spend, or interview_prep_events").
   */
  function reset() {
    entries = [];
  }

  /** A snapshot copy -- callers must not be able to mutate the live ledger
   *  merely by holding onto this array. */
  function list() {
    return entries.slice();
  }

  function count() {
    return entries.length;
  }

  return { record, reset, list, count };
}
