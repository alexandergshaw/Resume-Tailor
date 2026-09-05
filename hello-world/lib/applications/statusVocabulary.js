// The CLOSED vocabulary for `applications.status`, and the guards derived
// from it. Every allow-list, deny-check and UI subset in the applied-status
// data-loss fix reads from THIS module rather than re-typing its own copy —
// that is the whole point of it existing. A status added to the live
// `applications_status_check` constraint that is not added here classifies
// as "unknown" everywhere (see `classifyStatus`), which is refused by every
// write guard rather than silently treated as either pre-apply or protected.
//
// Source of truth for the eleven values, in order of authority:
//   - the LIVE `applications_status_check` constraint (read by the owner);
//   - supabase/migrations/20260610020000_applications_status_auto_queued.sql
//     lines 20-30, which match it value-for-value and in the same order.
//
// Every exported collection is frozen so a caller cannot widen a guard by
// mutating the array it is built from, and `APPLICATION_STATUSES` is the
// single hand-typed list — everything else here is derived from it so a
// twelfth status added in one place is either classified nowhere (caught by
// the closure test) or has to be added to every derived set explicitly.

export const APPLICATION_STATUSES = Object.freeze([
  "accepted",
  "applied",
  "auto_queued",
  "auto_tailored",
  "interviewing",
  "offer",
  "phone_screen",
  "rejected",
  "tailored",
  "tracking",
  "withdrawn",
]);

// The four statuses the write guard's allow-list lets an UPDATE pass
// through (PART 3 / C1). Hand-typed because it is the primary partition;
// `APPLIED_OR_LATER_STATUSES` is everything else, derived below so the two
// can never drift into overlapping or incomplete coverage independently.
export const PRE_APPLY_STATUSES = Object.freeze([
  "auto_queued",
  "auto_tailored",
  "tailored",
  "tracking",
]);

// Everything NOT pre-apply. Deriving this from `APPLICATION_STATUSES` minus
// `PRE_APPLY_STATUSES` — rather than hand-typing a second list — is what
// makes the partition's two halves cover the whole vocabulary and never
// overlap BY CONSTRUCTION, instead of by two lists happening to agree today.
export const APPLIED_OR_LATER_STATUSES = Object.freeze(
  APPLICATION_STATUSES.filter((status) => !PRE_APPLY_STATUSES.includes(status)),
);

// The two statuses both application loaders (`app/page.js`'s Tracking tab
// query and `lib/copilot/postings.js`) exclude today. Order here is
// alphabetical (asserted by the vocabulary's own closure test); the two
// `.neq()` calls `excludeTrackingTabHiddenStatuses` emits are in a DIFFERENT
// order — the order the two loaders already used before this module existed
// — so that helper does not simply iterate this array.
export const TRACKING_TAB_HIDDEN_STATUSES = Object.freeze(["auto_tailored", "tracking"]);

// The subset a human can pick from `EditAppDialog` / `AddAppDialog`'s
// `Select`. `auto_queued` is excluded because a user cannot hand-invent queue
// membership (it is a machine-only status), and the two tracking-tab-hidden
// statuses are excluded because offering them would be a one-way door: the
// row would vanish from the only screen that can correct it.
const NOT_HAND_SETTABLE = new Set([...TRACKING_TAB_HIDDEN_STATUSES, "auto_queued"]);
export const USER_SELECTABLE_STATUSES = Object.freeze(
  APPLICATION_STATUSES.filter((status) => !NOT_HAND_SETTABLE.has(status)),
);

// The SAME eight values as `USER_SELECTABLE_STATUSES`, in pipeline order
// instead of alphabetical order, for the two dialogs' `Select` to render
// from. `USER_SELECTABLE_STATUSES` is derived from `APPLICATION_STATUSES`,
// which is alphabetically sorted (and pinned sorted by this module's own
// closure test) — sourcing the dropdown from it directly put "accepted"
// first in a list whose most common choice is "applied". Membership stays on
// `USER_SELECTABLE_STATUSES` (it is what every closure/subset test above
// pins, and what `EditAppDialog`'s out-of-range check tests against); this
// export only reorders it for rendering.
//
// Derived from a rank lookup rather than hand-sorted, so the SET can never
// drift from `USER_SELECTABLE_STATUSES`: whatever `PIPELINE_ORDER` contains,
// this array's membership is exactly `USER_SELECTABLE_STATUSES`'s, because it
// is built by sorting a copy of that array. A status added to
// `USER_SELECTABLE_STATUSES` with no matching entry in `PIPELINE_ORDER`
// throws here, at module load, instead of silently landing wherever
// `Array.prototype.sort` leaves an unranked element.
const PIPELINE_ORDER = [
  "tailored",
  "applied",
  "phone_screen",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
];
const PIPELINE_RANK = new Map(PIPELINE_ORDER.map((status, index) => [status, index]));

export const USER_SELECTABLE_STATUSES_ORDERED = Object.freeze(
  [...USER_SELECTABLE_STATUSES].sort((a, b) => {
    if (!PIPELINE_RANK.has(a) || !PIPELINE_RANK.has(b)) {
      const unranked = PIPELINE_RANK.has(a) ? b : a;
      throw new Error(
        `statusVocabulary: "${unranked}" is USER_SELECTABLE but has no entry in PIPELINE_ORDER.`,
      );
    }
    return PIPELINE_RANK.get(a) - PIPELINE_RANK.get(b);
  }),
);

// The status the "return to pre-apply" action (formerly "un-apply") sets. It
// must round-trip through all three subsets above: back into PRE_APPLY (so
// the writer will promote it again later), still USER_SELECTABLE (so the
// dialog can offer it), and NOT tracking-tab-hidden (so the row stays
// visible where the remedy lives) — the "two-way door" AC-11 requires.
export const RETURN_TO_PRE_APPLY_STATUS = "tailored";

// Upper-snake constants, one per status, so a call site can write
// `STATUS.APPLIED` instead of the bare literal `"applied"`. Derived from
// `APPLICATION_STATUSES` rather than hand-typed, so "STATUS's values are
// exactly APPLICATION_STATUSES" holds by construction, not by agreement.
export const STATUS = Object.freeze(
  Object.fromEntries(APPLICATION_STATUSES.map((status) => [status.toUpperCase(), status])),
);

// Rendered labels. Every dialog and status-facing surface reads from here so
// there is one place that can be wrong. The eight the two dialogs already
// render, and `auto_queued`'s, are pinned byte-identical to what F-5 freezes
// as the current rendered output; `tracking` and `auto_tailored` need labels
// too even though no `Select` offers them, because every status must render
// somewhere (the Edit dialog's "current status" fallback item, a future
// admin view) without ever showing a blank menu item.
export const STATUS_LABELS = Object.freeze({
  accepted: "Accepted",
  applied: "Applied",
  auto_queued: "In auto-apply queue",
  auto_tailored: "Auto-tailored",
  interviewing: "Interviewing",
  offer: "Offer",
  phone_screen: "Phone Screen",
  rejected: "Rejected",
  tailored: "Tailored",
  tracking: "Tracking",
  withdrawn: "Withdrawn",
});

/**
 * Three-valued, deliberately. Under a two-valued classifier (pre-apply vs.
 * applied-or-later) a status outside the eleven would have to fall on one
 * side or the other, and either choice is wrong: classifying it pre-apply
 * lets an allow-list guard match it (this module's whole reason for
 * existing is to stop exactly that kind of silent widening), and
 * classifying it applied-or-later would refuse a legitimate future status
 * before anyone decided it should be protected. "unknown" is the class every
 * write guard in this chunk refuses outright, with no retry — a retry could
 * never match it anyway, since the allow-list it retries against excludes it
 * by definition.
 *
 * Case- and whitespace-sensitive on purpose: the column stores the exact
 * strings the CHECK constraint allows, and a classifier that normalises
 * would accept a value Postgres would reject.
 *
 * @param {unknown} status
 * @returns {"applied-or-later"|"pre-apply"|"unknown"}
 */
export function classifyStatus(status) {
  if (APPLIED_OR_LATER_STATUSES.includes(status)) return "applied-or-later";
  if (PRE_APPLY_STATUSES.includes(status)) return "pre-apply";
  return "unknown";
}

/**
 * Boolean convenience over `classifyStatus`, for call sites that only need
 * "is this one of the seven protected statuses" — never throws, never true
 * for an absent or off-vocabulary value.
 *
 * @param {unknown} status
 * @returns {boolean}
 */
export function isAppliedOrLater(status) {
  return classifyStatus(status) === "applied-or-later";
}

/**
 * Applies both application loaders' hidden-status filter to a PostgREST
 * query builder, in the exact two-call, two-argument shape they already use.
 * Duck-typed over `.neq()` alone — it must not reach for `.in()`, `.not()`
 * or `.is()`, because `lib/copilot/postings.js`'s own test fake exposes only
 * `select/eq/neq/order/then`, and any other method call there is a
 * TypeError that takes the whole file down, not a style disagreement.
 *
 * @template Q
 * @param {Q} query  a builder exposing `.neq(column, value)` that returns
 *                    itself
 * @returns {Q} the same query, for chaining
 */
export function excludeTrackingTabHiddenStatuses(query) {
  return query.neq("status", STATUS.TRACKING).neq("status", STATUS.AUTO_TAILORED);
}
