// lib/duplicateApply/postingIdentity.js
//
// Answers "are these two job postings the same posting?" from a URL or an
// external id, conservatively. AC-duplicate-apply-r4.md C-1 .. C-4a;
// 3-plan-dupapply.md §2.1 / §3.1.
//
// Standing bias: a false alarm is the expensive failure. A URL keys a
// posting only when it carries POSITIVE, STRUCTURAL evidence of a posting
// id -- no evidence means no claim, which routes the caller to
// `indeterminate` rather than a false "no previous application" (C-4a).
// There is deliberately no listing deny-list: a deny-list can only reject
// shapes someone thought of, and a prior version of this rule that tried one
// admitted 17 of 25 held-out listing pages.
//
// This module does NOT import `canonicalPostingUrl` from lib/feed/canonicalUrl.js
// (plan §8 C-6 / AC R4-17, overriding 1b's own module table in favor of 1b's
// own F2 finding). Composing on top of that function's OUTPUT STRING means
// re-parsing it, and that round trip is measurably lossy on 3 of 6 rows
// carrying query params [qf-urlroundtrip.mjs] -- e.g. a `%23` inside a param
// value grows a fragment that was never in the input and silently drops a
// sibling param. Two postings differing only after a `%23` would collapse to
// one key under that approach -- a false Signal 1 match, which is exactly
// the failure this module exists to avoid. So every function below does its
// own SINGLE fresh `new URL(raw)` parse of the ORIGINAL input, and the final
// key is re-encoded on rebuild rather than ever being re-parsed.

// Tracking/campaign params that vary per link-share but never identify the
// posting itself. lib/feed/canonicalUrl.js's TRACKING_PARAM_NAMES is not
// exported, so the set is restated here (byte-identical) plus utm_*, plus
// seven more named in AC-duplicate-apply-r4.md C-3 step 5. None of the seven
// identifies a posting; each is a per-share or per-search-session token.
const TRACKING_PARAM_NAMES = new Set([
  // inherited from lib/feed/canonicalUrl.js
  "gh_src",
  "ref",
  "source",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  // added by this module (AC C-3 step 5)
  "trid",
  "refid",
  "trackingid",
  "eburl",
  "lipi",
  "originaltoken",
  "savedsearchid",
]);

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAM_NAMES.has(lower);
}

// E1 (AC C-3 step 6 / C-3c) -- an opaque numeric token: a run of >= 6 digits
// delimited on both sides by a non-alphanumeric character or a segment
// boundary. Applied to the whole PATH rather than per-segment: "/" is itself
// a non-alphanumeric delimiter, so a segment boundary already IS either "/"
// or the string's own start/end -- the two are equivalent.
//
// The threshold is 6, not 5: 5 digits is exactly the US ZIP band, and a
// City-State-ZIP slug is hyphen-delimited on both sides. The delimiter
// requirement is load-bearing, not decorative: undelimited, this clause
// silently re-implements the rejected "UUID evidence anywhere" rule, because
// a UUID's hex contains long digit runs welded to hex letters. Both
// constants are the plan's C-3d exchange-rate ruling (>=0.25 false admits
// per posting recovered rejects both loosenings) -- not re-derived here.
const DIGIT_RUN_RE = /(?:^|[^0-9A-Za-z])[0-9]{6,}(?:[^0-9A-Za-z]|$)/;

// E2 -- a UUID as the LAST path segment ONLY, never "anywhere" in the path.
// AC R4-3 / C-3d measured UUID-anywhere at +7 postings for +3 false admits
// (0.43, rejected); UUID-as-last-segment at +5 for +1 (0.20, admitted) --
// five times cheaper, because UUID-anywhere re-admits the exact board-root
// false-admit class this narrower rule exists to keep out.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// E3 (AC C-3a) -- an id-shaped query param: SHAPE plus two anchored names,
// plus a value guard. Two names are anchored to a specific real URL shape
// each (Indeed's `jk`, a Greenhouse-embedded careers page's `gh_jid`); any
// other param must satisfy all three of contains/ends-with/none-vetoed on
// its (lowercased) NAME, plus a minimum-length alnum shape on its value.
// E3 measured ZERO false admits on the union corpus -- a per-posting param
// is itself a discriminator, so admitting it can only FORK keys (a miss),
// never merge two different postings into one (a false alarm).
const ANCHORED_ID_PARAM_NAMES = new Set(["jk", "gh_jid"]);
const ID_PARAM_CONTAINS = ["job", "req", "posting", "vacancy", "jid", "opening", "position"];
const ID_PARAM_ENDS_WITH = ["id", "jid", "no", "nr", "num", "code", "key", "ref"];
const ID_PARAM_VETO = [
  "search",
  "query",
  "keyword",
  "type",
  "categor",
  "count",
  "page",
  "sort",
  "loc",
  "title",
  "name",
  "desc",
  "company",
  "dept",
  "department",
  "team",
  "level",
  "remote",
  "filter",
  "city",
  "state",
  "country",
  "region",
  "lang",
  "source",
  "src",
];
const ID_PARAM_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,}$/;

function isIdShapedParamName(lowerName) {
  const containsOne = ID_PARAM_CONTAINS.some((token) => lowerName.includes(token));
  if (!containsOne) return false;
  const endsRight = ID_PARAM_ENDS_WITH.some((suffix) => lowerName.endsWith(suffix));
  if (!endsRight) return false;
  return !ID_PARAM_VETO.some((token) => lowerName.includes(token));
}

// `survivors` is the [name, value] list AFTER step-5 tracking removal.
function hasIdShapedParamEvidence(survivors) {
  for (const [name, value] of survivors) {
    const lowerName = name.toLowerCase();
    if (ANCHORED_ID_PARAM_NAMES.has(lowerName)) {
      if (value !== "") return true;
      continue;
    }
    if (isIdShapedParamName(lowerName) && ID_PARAM_VALUE_RE.test(value)) return true;
  }
  return false;
}

// C-2a -- an id minted fresh on every run cannot identify a posting ACROSS
// runs; it can only ever equal itself. The `i` flag is required: round
// three's version of this regex was case-sensitive, the same defect class as
// `?JK=` going unrecognised and `Results` != `results` elsewhere in this
// document. Enumerated by symbol against the tree: `shot-` (useScreenshots.js)
// and `manual-` (useApplicationDialogs.js / useManualTailor.js /
// useManualPostings.js) are the only ephemeral mints; `url-`, `feed-` and
// `gh-`/vendor ids are all stable across runs and must NOT match this.
const EPHEMERAL_EXTERNAL_ID_RE = /^(shot|manual)-/i;

// C-2 -- String(undefined) === "undefined" and String(null) === "null"; a
// future caller that skips the id-minting guard could write these literal
// strings, and every such row would merge into one fabricated "position".
const DEGENERATE_EXTERNAL_ID_LITERALS = new Set(["undefined", "null", "NaN"]);

/**
 * postingUrlKey(url) -> "u:…" | null
 *
 * A URL keys a posting only on positive, structural evidence of a posting
 * id (E1 | E2 | E3 below). No evidence -> null -> no claim.
 */
export function postingUrlKey(url) {
  if (typeof url !== "string" || url === "") return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Step 1 -- fragment guard, FIRST, on the raw input. On a fragment-
  // addressed board the fragment IS the posting id, so discarding it and
  // keying on what remains would claim identity from a string that no
  // longer contains it. A bare trailing "#" parses to hash === "" and is
  // NOT a fragment for this purpose; anything else non-empty refuses the
  // WHOLE url, even when the path independently carries evidence.
  if (parsed.hash !== "") return null;

  // Step 2 -- scheme gate.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  // Step 3 -- host, lowercased, leading www. stripped. The port is dropped
  // for free because `hostname` (unlike `host`) never includes it -- an
  // inherited, accepted merge (C-4): two ports on one host are one key.
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  // Step 4 -- path, trailing slash stripped when longer than "/". Case is
  // preserved: this module never lowercases the path (C-4 pin).
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  // Step 5 -- delete tracking/campaign params, case-insensitively, BEFORE
  // admission is decided.
  const survivors = [];
  for (const [name, value] of parsed.searchParams) {
    if (isTrackingParam(name)) continue;
    survivors.push([name, value]);
  }

  // Step 6 -- admission: at least one of E1 / E2 / E3 must hold.
  const segments = path.split("/").filter((segment) => segment !== "");
  const hasDigitRunEvidence = DIGIT_RUN_RE.test(path);
  const hasUuidEvidence =
    segments.length > 0 && UUID_RE.test(segments[segments.length - 1]);
  const hasIdParamEvidence = hasIdShapedParamEvidence(survivors);
  if (!hasDigitRunEvidence && !hasUuidEvidence && !hasIdParamEvidence) return null;

  // Step 7 -- rebuild: sort surviving params by (original-case) name, values
  // RE-ENCODED from the single parse above. Never re-parsed. Scheme is
  // folded to https: unconditionally -- canonicalPostingUrl keeps
  // parsed.protocol, so the two spellings fork there; this module must not
  // let scheme alone fork one posting's key.
  survivors.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = survivors.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
  return `u:https://${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * externalIdKey(value) -> "x:…" | null
 */
export function externalIdKey(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  if (DEGENERATE_EXTERNAL_ID_LITERALS.has(trimmed)) return null;
  if (EPHEMERAL_EXTERNAL_ID_RE.test(trimmed)) return null;
  return `x:${trimmed}`;
}

/**
 * postingKeyOfPosition(positionRow) -> "u:…" | "x:…" | null
 *
 * A POSITIONS row (or embed). URL wins over external id when both are
 * present and admit (C-1d): one Greenhouse posting was measured forking
 * into 7 external ids across this app's own entry points while collapsing
 * to 1 URL key.
 */
export function postingKeyOfPosition(positionRow) {
  return postingUrlKey(positionRow?.url) ?? externalIdKey(positionRow?.external_id) ?? null;
}

/**
 * canonicalPositionKey(applicationRow) -> string | null
 *
 * An APPLICATIONS row. Every embed read is optional-chained (C-1c): a row
 * with no `positions` embed yields null and is silently excluded, never a
 * throw -- an accepted miss, because such a row has no company either and
 * could never have joined a company group in any case.
 */
export function canonicalPositionKey(applicationRow) {
  return (
    postingKeyOfPosition(applicationRow?.positions) ??
    (applicationRow?.positions?.id ? `pos:${applicationRow.positions.id}` : null)
  );
}

/**
 * samePostingRows(a, b) -> boolean
 *
 * Two APPLICATIONS rows. Never matches on title+company (C-3, "what
 * deliberately does NOT count as a match") -- this function reads only the
 * `positions` embed's url/external_id, by construction.
 */
export function samePostingRows(a, b) {
  const key = postingKeyOfPosition(a?.positions);
  return key !== null && key === postingKeyOfPosition(b?.positions);
}

/**
 * matchesCandidate(row, candidate) -> boolean
 *
 * `row` is an APPLICATIONS row; `candidate` is the bare job-being-tailored
 * object ({id, title, company, url, description}, no `positions.id`). Two
 * relations sharing one key function on purpose, over different domains
 * (C-1a): `canonicalPositionKey(candidate)` is not well-formed, so this
 * function is the one that closes the gap (C-15 routes a null candidate key
 * to `indeterminate` upstream, before any comparison).
 */
export function matchesCandidate(row, candidate) {
  const key = postingKeyOfPosition(candidate);
  return key !== null && key === postingKeyOfPosition(row?.positions);
}

// C-3d -- the decision rule applied to every E1/E2/E3 constant above: a
// clause is admitted only if its marginal cost is below this many false
// admits per posting recovered, measured on the union of three corpora
// (153 failable rows: 68 listing, 85 posting) [r4-admission2.mjs]. This is
// the plan's one named judgement, not a measurement -- Q17 lets the product
// owner move it with a one-line edit; it is NOT re-derived in this module.
export const C_3D_MAX_FALSE_ADMITS_PER_POSTING = 0.25;
