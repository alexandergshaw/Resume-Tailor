// AC-N1: the ONE definition of "what was this drafted answer actually built
// from" and "is that still what's selected" — shared by live mode
// (useLiveSession.js's runDraft, via useDraftAnswer.js) and practice mode
// (sampleAnswerState.js's cachedSampleAnswerFor). Before this module existed,
// practice mode had its own inline three-field comparison and live mode had
// none at all — a cached draft built from a job posting or prep context the
// user had since changed could be served as if it still applied. Two
// independent copies of "same grounding" is exactly how BUG-J6 happened;
// this module exists so live and practice can never drift apart on the
// question again.
//
// KNOWN LIMITATION, recorded rather than "fixed" (ARCH §4f, knowledge-base
// grounding work): this deliberately does NOT grow a fourth field for the
// interview copilot's knowledge-base pages. `groundingFor` runs on the
// CLIENT, at cache-READ time (useDraftAnswer.js's own call site,
// sampleAnswerState.js), and the client has no view of the knowledge base at
// all — it was never sent one, by design, the same way it is never sent the
// résumé or cover letter text. A route-returned "knowledge base fingerprint"
// stashed on the cache entry would be compared, on a hit, against a freshly
// recomputed value the client also has no way to produce independently — in
// practice that comparison degenerates to the entry matching itself, which
// looks like a guard and is not one. That is worse than having no such field
// at all, because it would read as "this was checked" when nothing was.
// Leaving grounding behaviourally unchanged here is deliberate. If this is
// ever fixed for real, the fix is a cheap server-side endpoint that reports
// the knowledge base's own max `updated_at`, not a fourth client-side field.
//
// The bug that IS in scope for that work is different, and lives in the
// cache entries themselves, not here: a cached entry that does not
// round-trip `pageSources` renders on a cache hit as an answer that has lost
// its citations, the same failure useDraftAnswer.js already names for
// `cues`. `pageSources` must be written to and read from both caches
// alongside `cues`/`buzzwords`/`anchor`/`idealProject`, defaulting to `[]`
// for any entry cached before that field existed — this file has no cache of
// its own, so that work belongs to sampleAnswerState.js and
// useDraftAnswer.js, not here.
//
// Pure, no React, no DOM — reachable from this repo's node-only vitest setup
// (vitest.config.js has no jsdom) the same way sampleAnswerState.js is.
//
// AC-N1.2.3: a caller may have no posting selected, and now every caller
// sends an interview type (live mode reads it from the shared store too) —
// but `undefined`, `null`, and `""` still all mean "not applicable" and
// must compare equal, on EVERY one of the four fields, or a write from one
// mode/call-site spelling "nothing selected" one way can never be read back
// by another spelling it a different way. Getting this wrong doesn't throw
// and doesn't fail loudly — it just makes the cache miss forever, silently
// doubling the cost of every repeated question (see this file's own test
// header comment).
//
// `codeLanguage` (the code-language control's resolved/selected value) joins
// the other three fields the same way and through the SAME `normalizeField`
// — no special-cased "missing means auto" here. An omitted field and an
// explicit `"auto"` are different facts and must stay distinguishable, or a
// cache write from before the control existed would silently start matching
// a request that explicitly asked for `auto`.
const NOT_APPLICABLE = "";

function normalizeField(value) {
  return value === undefined || value === null ? NOT_APPLICABLE : value;
}

// The grounding a draft was (or would be) built from, as a plain comparable
// shape. Takes the same four fields both call sites already have lying
// around — `profile` (the prep-context string), `interviewType` (the shared
// selection both modes now read), `applicationId` (the selected posting's id,
// or nothing), `codeLanguage` (the code-language control's value, or nothing)
// — and folds each one's "not applicable" spellings together.
export function groundingFor({ profile, interviewType, applicationId, codeLanguage } = {}) {
  return {
    profile: normalizeField(profile),
    interviewType: normalizeField(interviewType),
    applicationId: normalizeField(applicationId),
    codeLanguage: normalizeField(codeLanguage),
  };
}

// Field-by-field equality — deliberately NOT a concatenation of the fields,
// which would let two genuinely different groundings collide (e.g.
// profile "ab" + applicationId "c" vs profile "a" + applicationId "bc"; see
// this file's own test for the case).
export function sameGrounding(a, b) {
  if (!a || !b) return false;
  return (
    a.profile === b.profile &&
    a.interviewType === b.interviewType &&
    a.applicationId === b.applicationId &&
    a.codeLanguage === b.codeLanguage
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
