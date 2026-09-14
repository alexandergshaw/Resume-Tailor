// Pure, no-IO contract module for interview-prep research (IP3): the shared
// vocabulary and column projections every other module in this feature
// imports rather than re-typing. `lib/interviewPrep/prepStore.js` is the
// ONLY module that names any of the three prep tables or issues a query
// against them (design-structure.r1.md §3); this file is where its
// projection literals and the shared `reason` vocabulary live, so no caller
// reaches for a raw string or an un-pinned `.select()` argument.
//
// SCOPE, STATED HONESTLY. design-structure.r1.md §3 also names this file as
// the home for `packRenderState(row, now)`, `packIsStale(row, basis)`,
// `shouldStartPrep(listItemOrPack, digestReadOutcome, {embeddedNow, now})`
// and the `Pack`/`PrepPackListItem`/`PrepEvent` type shapes. NONE of those
// are implemented in this wave. No test in this round's landed suite
// exercises them, and their field-level contract -- the exact shape of the
// merged row each one expects, the 9-state classification's full branching,
// packIsStale's three-axis comparison -- is specified in documents outside
// this wave's reading list (1d.r1.md/1d.r2.md, frozen as rationale once
// design-structure.r1.md consolidated them; see that document's own
// repeated "unchanged from 1d.r1/1d.r2" citations, which never restate the
// literal field names). Building them now, against a guessed row shape,
// would be inventing untested behaviour ahead of its own failing test --
// exactly what this loop's TDD discipline exists to prevent. They land in
// the wave that carries their own 4b tests.

/**
 * The shared `reason` vocabulary, enforced identically by
 * `interview_prep_packs_reason_check` and `interview_prep_events_reason_check`
 * (1-0-contract.r8.md §1.3bis; design-structure.r1.md §8.5). One JS-side
 * source of truth -- the migration's own SQL literal duplicates these exact
 * eight strings because SQL cannot import a JS constant. `writePrepPackResult`
 * forces this column to `null` on a `'ready'`/`'partial'` terminal write
 * regardless of what its caller passes, so a value from this list is only
 * ever stored alongside `'failed'`/`'unavailable'`.
 */
export const PREP_REASON_VALUES = Object.freeze([
  "provider-timeout",
  "provider-error",
  "refused-posting",
  "check-violation",
  "stale-claim",
  "not-found",
  "unknown",
  "spend-record-failed",
]);

/**
 * `listPrepPacks`'s pack-table projection (design-structure.r1.md §8.2 /
 * check-structure's M4). Named so the function's own body never carries a
 * literal `.select()` argument, and so the list projection cannot silently
 * grow to expose `pack` or `error` -- neither belongs in a list view.
 */
export const PREP_LIST_COLUMNS = Object.freeze([
  "application_id",
  "status",
  "reason",
  "engine",
  "researched_at",
  "resume_id",
  "cover_letter_id",
  "posting_fingerprint",
  "digest_researched_at",
]);

/**
 * `listPrepPacks`'s ledger-table projection (design-structure.r1.md §8.2).
 * Pinned to exactly these three columns so a fourth added later without
 * updating this constant is a visible, intentional change, not a silent one.
 */
export const PREP_SPEND_COLUMNS = Object.freeze(["application_id", "attempts", "model_calls"]);

/** Joined form of PREP_LIST_COLUMNS, for the `.select()` call itself. */
export const PREP_LIST_PROJECTION = PREP_LIST_COLUMNS.join(", ");

/** Joined form of PREP_SPEND_COLUMNS, for the `.select()` call itself. */
export const PREP_SPEND_PROJECTION = PREP_SPEND_COLUMNS.join(", ");
