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
export function emptySampleAnswer() {
  return {
    question: "",
    visible: false,
    status: "idle", // idle | loading | done | error
    points: [],
    // { resume: boolean, coverLetter: boolean } once a draft lands — which
    // submitted documents it was actually grounded in. Null until then.
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
//               `profile`, `interviewType`, or `applicationId` differs from
//               what this draft was built from — AC-G1-6/AC-G2-C-5: editing
//               the prep context, switching interview type, or switching
//               posting never disturbs a draft already on screen, but the
//               NEXT reveal after a hide redrafts against whatever changed
//               instead of serving the stale cached answer. AC-G2-C-9 adds
//               `applicationId` to this same comparison — a posting change
//               invalidates a drafted sample answer exactly like a profile
//               or interview-type change does.
export function needsRedraft(active, profile, interviewType, applicationId, force = false) {
  if (force) return true;
  if (!active || active.status === "idle" || active.status === "error") return true;
  if (active.status === "loading") return false;
  return (
    active.profile !== profile ||
    active.interviewType !== interviewType ||
    active.applicationId !== applicationId
  );
}
