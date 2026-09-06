// "Is this the same company?" -- AC-duplicate-apply-r4.md §1.2 / C-5 … C-8,
// with 1g SEC-1 applied and the pipeline reordered (3-plan-dupapply.md §2.2).
//
// STANDING BIAS: a false alarm is the expensive failure. This key must merge
// LESS rather than more -- an under-count is a silent miss, an over-count
// fabricates a burst of applications the user never made. Every accepted
// miss below is deliberate and pinned in companyIdentity.test.js; do not
// widen the rule without re-reading AC C-5/C-6/C-22 first.
//
// Two keys are "the same company" iff they are EQUAL AND NON-EMPTY. `""` is
// the honest answer for anything that isn't usable as an identity -- it
// must route callers to "couldn't check" (indeterminate), never to
// "0 applications at this company". This module does not implement that
// equality/grouping rule itself (that is duplicateApplyVerdict.js's job);
// it only guarantees "" is never a placeholder that can accidentally match
// another "".
//
// Pipeline (NOTE: reordered from the AC's own §1.2 listing -- see below):
//   0. HARD CAP     reject (never truncate) anything over 512 chars, before
//                    any regex runs.
//   1. NFKD-normalise; strip combining marks; lowercase; trim.
//   2. "&" -> " and ".
//   3. COLLAPSE every run of whitespace-or-comma to one space; trim.
//        <- MOVED here from the AC's step 6. 1g measured the AC-ordered
//           pipeline's suffix regex at 31.7s on a 200KB run of spaces and
//           2,767ms on 60,000 commas (its `[\s,]+` quantifier retries from
//           every offset when the run never resolves into a legal suffix).
//           Collapsing the SAME separator class the regex quantifies over
//           -- not just whitespace, which 1g measured insufficient because
//           the comma vector survives a whitespace-only collapse -- before
//           the regex ever sees the string makes every run length 1, so the
//           backtracking blowup is unreachable regardless of input size.
//   4. Strip AT MOST ONE trailing legal suffix, anchored at the very end.
//   5. Collapse every remaining non-[a-z0-9] run to a single space; trim.
//   6. Non-empty -> "a:" + result.
//      Else, if the ORIGINAL raw input contains any Unicode letter or digit
//      (any script) -> "r:" + NFKC-normalised, case-folded, whitespace-
//      collapsed raw input. This fallback is STRICTLY NARROWER than the
//      "a:" path (no suffix strip, no punctuation collapse), so it can
//      never merge anything the ASCII path would not, and it is
//      namespaced ("r:" vs "a:") so the two paths can never collide with
//      each other by construction.
//      Else -> "" (an empty/punctuation-only name; never groups).
//
// Reordering steps 3 and 4 was checked for equivalence against the
// AC-ordered pipeline over the 351-name M1 corpus this checkout ships
// (lib/greenhouse/companies.js + lib/lever/companies.js +
// lib/ashby/companies.js) and the C-5 constructed multi-suffix rows: 0
// mismatches (see companyIdentity.test.js). It is NOT a universal
// equivalence -- a trailing comma immediately after the suffix token (e.g.
// "Acme Ltd,") reduces differently under the two orderings, because
// collapsing the comma first lets the anchored regex see the suffix it
// previously could not. That is a beneficial side effect (both spellings
// really are the same company), not a new merge hazard, and it is pinned
// as its own test rather than folded into the equivalence claim.
//
// C-8 -- `normalizeCompanyKey` (lib/scrape/atsLookup.js) is never imported,
// reused, or copied here. Its suffix strip is UNANCHORED
// (`/\b(inc|llc|ltd|corp|co|company|technologies|labs|the)\b/g`), so it
// deletes those tokens anywhere in a name (turning "Grafana Labs" into
// "grafana"), can produce an empty key from a real name ("Labs" -> ""),
// and carries no non-empty guard at all. The cross-directory sweep with a
// planted positive control lives in duplicateApplyPurity.test.js
// (Wave 1B); this module's own test file additionally self-checks that
// its own source contains neither the import specifier nor the literal
// regex.

const SUFFIX_TOKENS =
  "inc|llc|ltd|corp|corporation|incorporated|limited|plc|gmbh|sa|nv|bv|ab|oy|pty|pte";

// Anchored at the end ($), and matched against an already-collapsed string
// where every separator run is exactly one space -- so `[\s,]+` here can
// never retry across a long unresolved run; by the time this regex runs,
// no run is longer than one character.
const TRAILING_SUFFIX_RE = new RegExp(`[\\s,]+(?:${SUFFIX_TOKENS})\\.?$`);

// Unicode combining diacritical marks (U+0300-U+036F) -- what NFKD
// decomposition splits a folded character like "é" into ("e" + this
// block). Stripping this range after NFKD-normalising is what makes
// "Café" -> "a:cafe". It is a partial fold BY DESIGN: a character with no
// canonical decomposition (ø, æ, ł, ß, đ, …) is untouched by NFKD and is
// instead destroyed by step 5's non-[a-z0-9] collapse -- see the pinned
// "accepted miss" cases in companyIdentity.test.js. That failure is always
// in the under-merge (safe) direction and must not be "fixed" with a
// transliteration table, which would be a widening rule needing its own
// attack.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

const HAS_LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

/** SEC-1's cap. Exported so the test file can name it rather than repeat 512. */
export const COMPANY_NAME_MAX_LENGTH = 512;

/**
 * The identity key for "this company" (AC §1.2). `name` is normally
 * `positions.company` -- free text written by a hostile posting page or by
 * any user holding an application on the row (RM-3), so this function must
 * never throw and must never take more than a bounded amount of time
 * regardless of what it is handed.
 *
 * @param {unknown} name
 * @returns {"a:"+string | "r:"+string | ""} `""` means "no usable company
 *   identity" -- callers must treat two `""` keys as NOT the same company
 *   (equal AND non-empty is the match rule; see the module docblock).
 */
export function companyIdentityKey(name) {
  // Step 0 -- HARD CAP, before any regex runs. Rejecting (not truncating)
  // is the point: two different long names sharing a prefix must never
  // collapse into one fabricated key.
  if (typeof name !== "string" || name.length > COMPANY_NAME_MAX_LENGTH) {
    return "";
  }

  const raw = name;

  // Step 1 -- NFKD-normalise; strip combining marks; lowercase; trim.
  let working = raw.normalize("NFKD").replace(COMBINING_MARKS_RE, "").toLowerCase().trim();

  // Step 2 -- "&" -> " and ".
  working = working.replace(/&/g, " and ");

  // Step 3 -- COLLAPSE every run of whitespace-or-comma to one space; trim.
  // (Moved ahead of the suffix strip -- see the module docblock's ReDoS note.)
  working = working.replace(/[\s,]+/g, " ").trim();

  // Step 4 -- strip AT MOST ONE trailing legal suffix, anchored at the end.
  // A non-global regex naturally applies once; the end-anchor means there
  // is only ever one place in the string it could match anyway.
  working = working.replace(TRAILING_SUFFIX_RE, "");

  // Step 5 -- collapse every remaining non-[a-z0-9] run to a single space; trim.
  working = working.replace(/[^a-z0-9]+/g, " ").trim();

  if (working) {
    return "a:" + working;
  }

  // Step 6, fallback -- the ASCII path produced nothing. If the ORIGINAL
  // input contains a letter or digit in ANY script, it is a real name in a
  // non-Latin (or otherwise non-ASCII-reducible) script, not junk -- key it
  // on its own narrower normalisation so Signal 2 does not go permanently
  // dark for a whole class of employers (C-6).
  if (HAS_LETTER_OR_DIGIT_RE.test(raw)) {
    const collapsed = raw.trim().replace(/\s+/g, " ");
    return "r:" + collapsed.normalize("NFKC").toLowerCase();
  }

  // Step 6, else -- empty, whitespace-only, or punctuation-only. Never a
  // key; never groups with another such input (C-6a).
  return "";
}
