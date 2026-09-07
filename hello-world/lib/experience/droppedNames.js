// The one sentence fragment every budgeted context builder in this repo needs
// and none of them owned: the NAMES of what a budget left out, rendered so a
// human can act on them.
//
// WHY A NAME AND NOT A COUNT. lib/experience/tailorContext.js's header records
// the owner's own words on the count-only version of this — "there is that note
// that Some of your project pages were too large to fit in the AI's context
// budget and were left out. i need to know exactly which ones were left out".
// A count tells someone their document, their answer or their meeting copilot
// is working from material with a hole in it and gives them no way to find the
// hole. Every builder that reports one already HAS the identity in hand at the
// moment it discards it; the identity simply died at a `continue`, a `break` or
// a `.slice()`.
//
// WHY THIS IS A SHARED MODULE rather than a fourth hand-written sentence. Four
// surfaces render this fragment — app/api/tailor/route.js, this module's two
// current callers (lib/experience/pageContext.js and lib/meeting/
// meetingContext.js) and app/api/meeting/insights/route.js — and a
// hand-copied list format is exactly how the same fix ships correct on one
// surface and subtly wrong on the next. app/api/tailor/route.js's
// formatDroppedProjectPagesWarning is the ORIGINAL and is not yet migrated
// (it is owned by another pass), so this function is written to reproduce its
// output byte for byte, and droppedNames.test.js pins that equivalence against
// a copied oracle rather than an import. The day that route adopts this
// helper, the migration is a deletion.
//
// THE BUDGET, which is the part that is easy to get wrong. A notice that names
// N items is ITSELF TEXT, and it competes for the very budget it is describing.
// Every builder here reserves a fixed NOTICE_RESERVE_CHARS out of its context
// budget for its notice, sized against a count-only sentence, and every one of
// them ends with a defensive clamp that cuts from the TAIL — which is precisely
// where the notice sits. So a name list that is free to grow would push the
// notice past its reserve and get the notice itself truncated, mid-name,
// mid-quote: a truncation notice destroyed by the truncation it exists to
// report.
//
// The rule, therefore: THE RESERVE NEVER MOVES, THE NAMES DO. `budget` is the
// most characters this fragment may occupy; names are handed back to the "and
// N more" tally until it fits, and when not even one name fits the fragment is
// EMPTY — so the caller keeps its bare count, which is honest, instead of
// printing half a title. Growing the reserve instead was considered and
// rejected: it is carved out of the page budget, so it would be paid for in
// the user's own content on every call, including the ones that drop nothing.
//
// NO IMPORTS OF ITS OWN, and that constraint is load-bearing rather than
// incidental: lib/experience/pageContext.js imports this module, and
// app/components/experience/ExperienceTab.js — a CLIENT component — imports
// that one, so whatever lands here lands in the browser bundle. Same rule
// lib/copilot/projectStories.js's header states for the same reason. This file
// is pure string assembly over its arguments; keep it that way.

// How many names get spelled out before the rest become "and N more". An owner
// who dropped five pages should see all five; one who dropped fifty needs a
// sentence they can actually read. The number is app/api/tailor/route.js's own
// MAX_NAMED_DROPPED_PAGES, which in turn mirrors lib/chat/localAssistant.js's
// summarizeApplications — kept identical rather than re-chosen so the two
// surfaces a user meets cannot disagree about how long a list is too long.
export const MAX_NAMED_DROPPED_ITEMS = 10;

// The quotation marks are load-bearing, not decoration: unquoted, a page
// called "Payments, phase two" and two pages called "Payments" and "phase two"
// render to the same string, and the reader cannot tell three items from two.
// Curly, matching app/api/tailor/route.js's existing warning exactly.
const OPEN_QUOTE = "“";
const CLOSE_QUOTE = "”";

// formatDroppedNames(names, { max, budget }) -> string
//
// `“A”, “B”, and 3 more`, or `“A”, “B”` when everything fits, or "" when there
// is nothing to say (no names, or no room for even one).
//
// Blank and non-string entries are removed BEFORE anything else, including
// before the "and N more" arithmetic — so a junk row can never become `“”`,
// which would tell a reader that a page they own is called nothing at all.
// Every caller is expected to have applied its own "Untitled …" display-name
// fallback first (each pins that in its own tests); this is the backstop, not
// the mechanism.
//
// Never throws: callers include a live meeting read that runs every ~20
// seconds and an interview draft loop, neither of which may turn a malformed
// row into a failed request.
export function formatDroppedNames(namesInput, { max = MAX_NAMED_DROPPED_ITEMS, budget } = {}) {
  const names = (Array.isArray(namesInput) ? namesInput : [])
    .map((name) => (typeof name === "string" ? name.trim() : ""))
    .filter(Boolean);
  if (names.length === 0) return "";

  const cap = typeof max === "number" && max >= 0 ? Math.floor(max) : MAX_NAMED_DROPPED_ITEMS;
  // A missing, non-numeric or NaN budget means unlimited — the ordinary case
  // for a caller (like app/api/meeting/insights/route.js) whose sentence is a
  // JSON field rather than something spliced into a prompt block.
  const limit = typeof budget === "number" && Number.isFinite(budget) ? budget : Infinity;

  const render = (shownCount) => {
    const shown = names.slice(0, shownCount).map((name) => `${OPEN_QUOTE}${name}${CLOSE_QUOTE}`);
    const remaining = names.length - shown.length;
    // `names.length - shown.length`, never `names.length`: "…and 25 more"
    // after naming ten of twenty-five is a lie the reader cannot check.
    return remaining > 0 ? `${shown.join(", ")}, and ${remaining} more` : shown.join(", ");
  };

  // Give names back one at a time until the fragment fits. Dropping a name
  // does not always shorten the string — going from "all of them" to "all but
  // one" ADDS the ", and 1 more" suffix — so this is a search for the first
  // count that fits, not a monotonic shrink; it can therefore settle on fewer
  // names than were theoretically affordable. That is the safe direction: the
  // guarantee this function owes its callers is that the result NEVER exceeds
  // `budget`, so that the notice can never be the thing a clamp eats.
  for (let shownCount = Math.min(names.length, cap); shownCount > 0; shownCount -= 1) {
    const candidate = render(shownCount);
    if (candidate.length <= limit) return candidate;
  }
  // Not one name fits. Return nothing rather than a `.slice()` of a name: a
  // dangling `“Payments mig` is worse than the bare count the caller already
  // had, because it looks like a whole answer.
  return "";
}
