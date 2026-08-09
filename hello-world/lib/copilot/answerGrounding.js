// AC-N1: the ONE definition of "what was this drafted answer actually built
// from" and "is that still what's selected" — shared by live mode
// (useLiveSession.js's runDraft, CopilotClient.js's onPrefetchedAnswer) and
// practice mode (sampleAnswerState.js's cachedSampleAnswerFor). Before this
// module existed, practice mode had its own inline three-field comparison
// and live mode had none at all — a cached draft built from a job posting or
// prep context the user had since changed could be served as if it still
// applied. Two independent copies of "same grounding" is exactly how
// BUG-J6 happened; this module exists so live and practice can never drift
// apart on the question again.
//
// Pure, no React, no DOM — reachable from this repo's node-only vitest setup
// (vitest.config.js has no jsdom) the same way sampleAnswerState.js is.
//
// AC-N1.2.3: live mode has no interview-type picker and often no posting
// selected — `undefined`, `null`, and `""` all mean "not applicable" and
// must compare equal, on EVERY field, or a write from one mode/call-site
// spelling "nothing selected" one way can never be read back by another
// spelling it a different way. Getting this wrong doesn't throw and doesn't
// fail loudly — it just makes the cache miss forever, silently doubling what
// every predicted question costs (see this file's own test header comment).
const NOT_APPLICABLE = "";

function normalizeField(value) {
  return value === undefined || value === null ? NOT_APPLICABLE : value;
}

// The grounding a draft was (or would be) built from, as a plain comparable
// shape. Takes the same three fields both call sites already have lying
// around — `profile` (the prep-context string), `interviewType` (practice
// only; absent in live mode), `applicationId` (the selected posting's id, or
// nothing) — and folds each one's "not applicable" spellings together.
export function groundingFor({ profile, interviewType, applicationId } = {}) {
  return {
    profile: normalizeField(profile),
    interviewType: normalizeField(interviewType),
    applicationId: normalizeField(applicationId),
  };
}

// Field-by-field equality — deliberately NOT a concatenation of the three
// values, which would let two genuinely different groundings collide (e.g.
// profile "ab" + applicationId "c" vs profile "a" + applicationId "bc"; see
// this file's own test for the case).
export function sameGrounding(a, b) {
  if (!a || !b) return false;
  return (
    a.profile === b.profile &&
    a.interviewType === b.interviewType &&
    a.applicationId === b.applicationId
  );
}

// The reveal-time cache lookup: `entry` is whatever is sitting in the
// cache (or nothing), `grounding` is the CURRENT grounding (already run
// through groundingFor by the caller) to check it against. Returns the
// entry unchanged on a hit, or `null` — "cache miss, draft it properly" —
// whenever the entry cannot be trusted for the current inputs:
//
//   - nothing cached for this key at all;
//   - the cached entry holds no usable points (an empty or malformed array
//     would render as a blank answer that looks like a finished one);
//   - the entry's OWN grounding (re-derived via groundingFor, so a raw
//     entry that never recorded any of these fields normalizes to "not
//     applicable" on every field rather than silently matching by
//     accident) does not match the grounding being asked about.
//
// A grounding-mismatch miss must be indistinguishable from any other miss to
// the user (AC-N1.2.4) — the caller drafts fresh; nothing here surfaces an
// error or a "reused" label, because this function has no opinion on either.
export function cachedAnswerFor(entry, grounding) {
  if (!entry) return null;
  const points = Array.isArray(entry.points)
    ? entry.points.filter((p) => typeof p === "string" && p.trim())
    : [];
  if (points.length === 0) return null;
  if (!sameGrounding(groundingFor(entry), grounding)) return null;
  return entry;
}
