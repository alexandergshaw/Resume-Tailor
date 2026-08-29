// Pure state derivation for practice mode's toggleable sample answer (G1,
// extended by G2 for interview type and the submitted application's
// documents): which draft (if any) applies to the question currently on
// screen, and whether revealing/regenerating one needs a fresh network
// request. No React import, no DOM access — every function here is a
// straight function of its arguments, reachable from the repo's node-only
// vitest setup the same way lib/copilot/answerWindow.js is (a later stage
// adds the tests; this pass only builds the module).
//
// The hook (app/copilot/practice/useSampleAnswer.js) keeps a SINGLE state
// slot, not a per-question map — activeSampleAnswer below is what makes
// that safe: a stored draft only ever applies when its stored `question` is
// identical to the question passed in, so changing questions (Next
// question, a posting change, a fresh Start) resolves straight back to
// emptySampleAnswer() with no explicit reset call needed at any of those
// call sites (AC-G1-5).

// The shape held in the hook's state, and what a mismatched question
// derives to: nothing shown, nothing cached, never fetched. G2 always
// requests mode "answer" (AC-G2-C-9); AC-H9 changed that mode's response
// shape from a single prose `answer` string to `points` (an array of
// complete, speakable, STAR-labeled-when-applicable sentences) — this state
// slot carries `points` through the same way it carried `answer` before,
// with the same caching/gating rules (AC-H9.37). `answer` (the
// server-derived prose join of `points`) is not carried here at all — this
// UI renders bullets, not prose, so there is nothing here that needs it.
// AC-N1.1: the shared grounding comparison — see answerGrounding.js's own
// header for why this is now the ONE place "same grounding" is decided.
// Only `cachedSampleAnswerFor` below is refactored to use it; `needsRedraft`
// keeps its own inline three-field comparison deliberately (see its own
// comment), so the two stay independent implementations of the same rule
// rather than one function calling into the other under two names.
import { cachedAnswerFor, groundingFor } from "./answerGrounding.js";
import { AUTO } from "./codeLanguages.js";

export function emptySampleAnswer() {
  return {
    question: "",
    visible: false,
    status: "idle", // idle | loading | done | error
    points: [],
    // AC-K1: the three reading aids that arrive with the draft. `cues` is
    // rendered alongside `points`, never in place of them — answerLines
    // in lib/copilot/answerPoints.js; `buzzwords` and `anchor` are the two
    // subsections under it. Carried through this slot exactly the way
    // `points` is, with the same caching and staleness rules, because they
    // are built from the same request and are just as wrong to show against
    // a different question.
    cues: [],
    buzzwords: [],
    // { title, company, matched, project } once a draft lands, or null when
    // there was no resume to read a role out of.
    anchor: null,
    // { shape, metrics } once a draft lands and a posting was selected, or
    // null otherwise — lib/copilot/idealProject.js's benchmark, carried
    // through this slot exactly like `buzzwords`/`anchor` (same caching and
    // staleness rules; just as wrong to show against a different question).
    idealProject: null,
    // ARCH §3.5/§4f: which knowledge-base page (if any) each point in
    // `points` came from — Array<{id, title} | null>, positionally paired,
    // straight from the response's `pageSources` field. `[]` rather than
    // `undefined` for the same reason every sibling field above starts at
    // its empty shape: `[]` reaching answerLines as a third argument pairs
    // against a length it cannot have (an all-nulls result), which is a
    // quiet "no citations" rather than a length-mismatch a reviewer could
    // mistake for a real bug.
    pageSources: [],
    // { resume: boolean, coverLetter: boolean, pages: boolean } once a draft
    // lands — what the draft was actually grounded in. Null until then.
    //
    // `pages` is NOT a third submitted document: it reports whether the
    // user's own "Professional Experience" project pages contributed to this
    // draft, which is a different category of source from a résumé or cover
    // letter submitted for an application. The route derives it per engine —
    // from the pages it actually put in the prompt on the Gemini path, and
    // from whether any drafted point actually carries page text (its own
    // `pageSources`) on the embedded one (app/api/copilot/answer/route.js) —
    // because those are two different mechanisms for "a page reached this
    // answer". NOT from the embedded engine's selection gate (`matched`),
    // which says a page was CHOSEN, not that a word of it was spoken: a
    // prose-only page clears that gate and contributes no bullets at all.
    grounding: null,
    error: "",
    // The prep-context profile string, the interview type, and the
    // application id the draft (or in-flight request) was built from —
    // each compared against the CURRENT value by needsRedraft below
    // (AC-G1-6, AC-G2-C-5, AC-G2-C-9). Never used to invalidate anything by
    // themselves; only needsRedraft reads them, and only at reveal time.
    profile: "",
    interviewType: "",
    applicationId: null,
    // AC-C27: the code-language control's value the draft (or in-flight
    // request) was built from — the fourth field needsRedraft/
    // cachedSampleAnswerFor compare alongside profile/interviewType/
    // applicationId. Seeded to AUTO, never "", so an entry cached before this
    // field existed still compares as an explicit "no preference stated"
    // rather than the distinct "field omitted" spelling `normalizeField`
    // reserves for that (answerGrounding.js's own header).
    codeLanguage: AUTO,
  };
}

// The state to actually render for the question currently on screen.
// `state` is whatever the hook last wrote (for whichever question that
// was); `question` is the exact text on screen right now. Anything stored
// for a DIFFERENT question is not this question's draft, so it's discarded
// here rather than requiring every caller (Next question, posting change, a
// fresh Start) to remember to reset it themselves.
export function activeSampleAnswer(state, question) {
  if (!state || state.question !== question) return emptySampleAnswer();
  return state;
}

// Whether revealing (or regenerating) the sample answer for the question
// `active` was derived for needs a fresh request rather than reusing
// whatever is already there.
//
//   force — true for Retry and Regenerate: always redrafts, bypassing
//           whatever is cached, regardless of status or the comparisons
//           below.
//
// Otherwise, decided from `active.status`:
//   "idle"    — never fetched for this question yet. Always redraft.
//   "error"   — nothing usable is cached (no answer). Always redraft.
//   "loading" — a request for this exact question is already in flight.
//               Never start a second one underneath it.
//   "done"    — a real draft is cached. Only redrafts when the CURRENT
//               `profile`, `interviewType`, `applicationId`, or
//               `codeLanguage` differs from what this draft was built from —
//               AC-G1-6/AC-G2-C-5: editing the prep context, switching
//               interview type, or switching posting never disturbs a draft
//               already on screen, but the NEXT reveal after a hide redrafts
//               against whatever changed instead of serving the stale cached
//               answer. AC-G2-C-9 adds `applicationId` to this same
//               comparison — a posting change invalidates a drafted sample
//               answer exactly like a profile or interview-type change does.
//               AC-C27 adds `codeLanguage` the same way, one field later.
//
// AC-N1.1: deliberately NOT routed through answerGrounding.js's
// sameGrounding, unlike cachedSampleAnswerFor above. This function's "done"
// branch is the exact same four-field comparison, and the two are already
// cross-checked against each other for every combination of matching/
// mismatching fields (see sampleAnswerState.test.js's "agrees with
// needsRedraft" block, which drives both functions off one table of entries
// and asserts they agree). If both delegated to the same shared comparison,
// that cross-check would silently stop being able to catch the two
// disagreeing — it would just be asserting the shared function equals
// itself. Kept as an independent inline comparison so that test keeps its
// teeth; the values it compares never include the undefined/null/""
// call-sites that answerGrounding.js's normalisation exists for (this
// function is only ever called with the interview-type/profile/applicationId/
// codeLanguage values a real practice session already resolved), so there's
// no drift risk in practice — see this module's own tests.
//
// AC-C27c: `codeLanguage` is the FIFTH parameter, before the trailing
// `force = false` — never appended after it. Appending after `force` would
// silently shift the positional argument useSampleAnswer.js's own call
// already passes at that slot, turning `force` into a truthy string and
// making every reveal pay for a fresh model call forever.
export function needsRedraft(active, profile, interviewType, applicationId, codeLanguage, force = false) {
  if (force) return true;
  if (!active || active.status === "idle" || active.status === "error") return true;
  if (active.status === "loading") return false;
  return (
    active.profile !== profile ||
    active.interviewType !== interviewType ||
    active.applicationId !== applicationId ||
    active.codeLanguage !== codeLanguage
  );
}

// AC-J2.9: the state to adopt for a draft read back from useSampleAnswer's
// own cache (see useSampleAnswer.queue) — a drafted answer is cached under
// normalizeQuestion(question) so revealing, hiding, and re-revealing the
// same question costs one request rather than a fresh one every time. This
// is the practice-mode counterpart of live mode's `answerCacheRef` hit. If
// it never hits, nothing errors — the reveal just quietly pays full price
// again.
//
// Returns `null` — meaning "cache miss, draft it properly" — whenever the
// entry cannot be trusted for the CURRENT inputs:
//
//   - nothing cached for this question at all;
//   - the cached entry holds no usable points (an empty or malformed array
//     would render as a blank answer that looks like a finished one);
//   - the entry was built from a different prep profile, interview type, or
//     application than the reveal is asking about. That is exactly
//     needsRedraft's "done" comparison above, applied to a cache entry
//     instead of the on-screen draft — the two must agree, or an entry
//     cached before the user edited their prep context would be served as
//     if it reflected the edit.
//
// On a hit it returns a complete state slot with `visible: true`, because
// the only caller is a reveal. Priming the cache itself never touches
// visibility — a draft queued by useSampleAnswer.queue for a question the
// user has not asked to see must not put itself on screen.
//
// AC-N1.1: the emptiness check and the profile/interviewType/applicationId/
// codeLanguage comparison are delegated to answerGrounding.js's
// cachedAnswerFor, so this function and live mode's own cache read can never
// disagree about what counts as the same grounding — this is a straight
// refactor, not a behaviour change: cachedAnswerFor's checks are byte-for-byte
// the same checks this function used to run inline (down to returning the
// entry's RAW `points` reference on a hit, never a filtered copy — see
// BUG-J6's tests below), just reachable from one place instead of two.
//
// AC-C27/A-15: `codeLanguage` is a SIXTH positional parameter and
// deliberately NOT defaulted. An omitted sixth argument folds to `""` through
// groundingFor's normalizeField and is a MISS, never a false hit — the
// fail-safe direction. Defaulting it to AUTO "to be safe" would invert that:
// a caller that forgot the argument would then HIT a genuine `auto` entry,
// serving an answer drafted under an explicit language as the Auto answer.
export function cachedSampleAnswerFor(entry, question, profile, interviewType, applicationId, codeLanguage) {
  const hit = cachedAnswerFor(entry, groundingFor({ profile, interviewType, applicationId, codeLanguage }));
  if (!hit) return null;
  return {
    question,
    visible: true,
    status: "done",
    points: hit.points,
    // AC-K1: an entry cached before these existed (queued by
    // useSampleAnswer.queue earlier in the same open session) has none of
    // them, which resolves to the empty shapes here — SampleAnswer.js then
    // falls back to rendering the full points and simply omits the two
    // subsections, rather than showing a header with nothing under it.
    cues: Array.isArray(hit.cues) ? hit.cues : [],
    buzzwords: Array.isArray(hit.buzzwords) ? hit.buzzwords : [],
    anchor: hit.anchor || null,
    idealProject: hit.idealProject || null,
    // ARCH §4f/§6.8: the cache round-trip `cues`/`buzzwords`/`anchor`/
    // `idealProject` already have, extended to `pageSources`. Without this,
    // a question answered twice shows its knowledge-base citations on the
    // first ask and silently loses them on the second (the reveal -> hide ->
    // reveal path, or a Next-question-back-again) — the same failure this
    // module's header names for `cues`, and the same defensive
    // Array.isArray check every sibling field here already applies to guard
    // against an entry cached before the field existed, or a malformed
    // value on the entry.
    pageSources: Array.isArray(hit.pageSources) ? hit.pageSources : [],
    grounding: hit.grounding || null,
    error: "",
    profile,
    interviewType,
    applicationId,
    codeLanguage,
  };
}
