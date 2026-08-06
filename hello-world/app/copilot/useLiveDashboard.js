"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchNextQuestion } from "@/lib/copilot/questionClient";
import { draftAnswer } from "@/lib/copilot/answerClient";
import { appendSpeechSample, computeLivePace } from "@/lib/copilot/livePace";

// AC-I2/AC-I3/AC-I4: live mode's dashboard hook — talking pace, the
// predicted next question, and a pre-drafted answer for it. Every DECISION
// (what signature identifies "the current thing to predict for", whether a
// stored result still applies, whether a pre-draft should even be
// attempted) is a plain exported function below, reachable from vitest
// without React — the same split lib/copilot/sampleAnswerState.js and
// app/copilot/useApplicationDocs.js's resolveDocs already established. This
// file itself owns only what those can't: the state slots, the monotonic
// generation ref, and the two network calls.
//
// This is a SPECULATIVE convenience feature bolted onto a live interview —
// transcription, question detection, and answer drafting are the session's
// real job (AC-I3.19). Both async operations below (runPrediction,
// runPredraft) catch their own failures into state and never throw back out
// to a caller, and neither one ever touches anything the capture session
// itself depends on.

// The detected-question list, reduced to the plain question strings the
// prediction route's `asked` param wants — newest last, same order
// `questions` already is. Defensive against non-array/malformed input the
// same way sampleAnswerState.js's helpers are, since a caller passing a
// still-initializing state slot must never throw.
export function askedQuestionsFor(questions) {
  return (Array.isArray(questions) ? questions : [])
    .map((q) => (q && typeof q.question === "string" ? q.question.trim() : ""))
    .filter(Boolean);
}

// The `posting` shape /api/copilot/question and /api/copilot/answer both
// want — mirrors PracticeClient's requestQuestion and CopilotClient's own
// runDraft, which build this exact `{ title, company, description }` (or
// `null`) object rather than forwarding the picker's full option.
export function postingPayloadFor(posting) {
  if (!posting) return null;
  return { title: posting.title, company: posting.company, description: posting.description };
}

// What "the current thing to predict for" IS, as a single comparable
// string — AC-I3.18's trigger. Built from BOTH the asked-question text and
// the selected posting's identifying fields, so either one changing (a new
// question detected, or the posting picker changing while questions are
// already in flight) is treated as a real change; two conversations that
// happen to share the same asked list but a different posting must never
// be treated as the same thing to predict for.
//
// Empty string means "nothing to predict from yet" — no question detected
// AND no posting selected — which is also the sentinel resolvePrediction
// below reads as "idle" rather than "loading": this is what keeps the
// dashboard from firing a prediction request the moment the page mounts,
// before the user has given it anything to go on (AC-I4.26's cost concern).
//
// Exported separately so it can be unit-tested without React, the same
// reason useApplicationDocs.js's resolveDocs is. The delimiter between the
// asked-question text and the posting key is deliberately the `\u0000`
// escape rather than a printable character such as "|" or "-": a question
// or posting field can legitimately contain either of those, and a
// delimiter drawn from the same character set as the payload can make two
// DIFFERENT (questions, posting) pairs collide into the same signature,
// which reads as "nothing changed" and silently misses a re-prediction.
// The test file's own source-scan assertion pins that this SOURCE file
// never contains a literal NUL byte — only the escape above.
export function predictionSignatureFor(questions, posting) {
  const asked = askedQuestionsFor(questions);
  if (asked.length === 0 && !posting) return "";
  const postingKey = posting
    ? `${posting.title || ""}|${posting.company || ""}|${posting.description || ""}`
    : "";
  return `${asked.join("\n")}\u0000${postingKey}`;
}

// The state slot runPrediction writes to, and what a signature with no
// matching stored result derives to: nothing shown, nothing cached.
const EMPTY_PREDICTION_RESULT = { forSignature: "", outcome: null, question: "", type: "general", error: "" };

// The prediction to actually report for the CURRENT signature — the same
// "does the stored value even belong to what's being asked about right
// now" trick useApplicationDocs.js's resolveDocs uses for an application
// id, applied here to a signature instead.
//
//   no signature yet         -> idle, nothing to show (nothing selected).
//   stored result is for a
//   DIFFERENT signature      -> loading (a request for the current one is
//                                either in flight or about to be kicked off
//                                by the effect below).
//   stored result errored    -> error, no question shown — AC-I3.19/20: a
//                                failed prediction degrades to an EMPTY
//                                panel with a retry action, never a stale
//                                question left over from a signature that
//                                no longer applies.
//   stored result succeeded  -> done, with the predicted question.
//
// Because this compares against the CURRENT signature rather than trusting
// whatever was last written, a late response for an OLD signature that
// happens to land after a NEWER request already started simply fails this
// comparison and is silently ignored — self-healing on top of (not instead
// of) the generation-ref guard runPrediction itself applies before writing.
export function resolvePrediction(result, signature) {
  if (!signature) return { status: "idle", question: "", type: "general", error: "" };
  if (!result || result.forSignature !== signature) {
    return { status: "loading", question: "", type: "general", error: "" };
  }
  if (result.outcome === "error") return { status: "error", question: "", type: "general", error: result.error };
  return { status: "done", question: result.question, type: result.type, error: "" };
}

// Whether a pre-draft should be attempted right now, and for which
// question. AC-I4.24: only when Auto-draft is on AND a prediction has
// actually landed (never while it's loading/errored/idle) — returns "" (no
// pre-draft) otherwise. Deliberately keyed on the predicted QUESTION TEXT
// alone, not on any request id: this is what makes it react to BOTH of the
// pre-draft's two real triggers with one derivation — a fresh prediction
// landing while Auto-draft is already on, and Auto-draft being switched on
// for a prediction that was already sitting there (AC-I4.24 does not say
// "only at the moment a prediction lands", and a user flipping the switch
// on a moment later must not have to wait for the NEXT detected question
// before this hook honors it).
export function predraftKeyFor(predictionStatus, predictedQuestion, autoDraft) {
  return autoDraft && predictionStatus === "done" && predictedQuestion ? predictedQuestion : "";
}

const EMPTY_PREDRAFT_RESULT = { forQuestion: "", outcome: null, points: [], type: "general", error: "" };

// Same "does the stored value belong to what's current" comparison as
// resolvePrediction, keyed on `predraftKey` (which already folds in
// whether Auto-draft is even on) instead of a raw question, so this
// collapses to idle for free whenever predraftKeyFor decided there's
// nothing to draft.
export function resolvePredraft(result, predraftKey) {
  if (!predraftKey) return { status: "idle", points: [], type: "general", error: "" };
  if (!result || result.forQuestion !== predraftKey) {
    return { status: "loading", points: [], type: "general", error: "" };
  }
  if (result.outcome === "error") return { status: "error", points: [], type: "general", error: result.error };
  return { status: "done", points: result.points, type: result.type, error: "" };
}

// The idle shapes predictionState/predraftState fall back to below whenever
// `active` is false — identical to resolvePrediction's/resolvePredraft's own
// `!signature`/`!predraftKey` branches above, kept as named constants only
// so the two calls into resolveDashboardState below don't restate them.
const IDLE_PREDICTION_STATE = { status: "idle", question: "", type: "general", error: "" };
const IDLE_PREDRAFT_STATE = { status: "idle", points: [], type: "general", error: "" };

// The active gate layered on top of a resolve* function's own self-healing
// comparison above: forces `idleState` whenever `active` is false,
// regardless of what `result` still holds, rather than merely leaving new
// requests unfired — the guarantee that a session which just ended cannot
// keep a stale prediction (or pre-draft) on screen. `resolveFn` is
// resolvePrediction or resolvePredraft, and `idleState` is that same
// function's own idle shape, so the two can never drift apart; `key` is
// whichever of `signature`/`predraftKey` `resolveFn` expects as its second
// argument.
//
// Exported separately so it can be unit-tested without React, the same
// reason useApplicationDocs.js's resolveDocs is.
export function resolveDashboardState(result, key, active, resolveFn, idleState) {
  return active ? resolveFn(result, key) : idleState;
}

// AC-I2/AC-I3/AC-I4: live mode's dashboard hook.
//
//   questions           CopilotClient's detected-question array, newest
//                        last — `{ id, question, at, status, points, type,
//                        error }` per entry. Read-only here: this hook
//                        never writes back into it (AC-I5.28 — the current-
//                        question/current-answer panels are the caller's
//                        job to re-present directly from this same array,
//                        not something this hook derives).
//   posting              the selected posting object, or null.
//   applicationId        posting?.id || null — same grounding fact
//                        CopilotClient's own runDraft already sends.
//   autoDraft            the existing Auto-draft switch's current value.
//   profile              the prep-context string.
//   onPrefetchedAnswer   (question, { points, type }) => void — called once
//                        a pre-draft succeeds, so the caller can write it
//                        into its OWN answer cache (AC-I4.23). Read via a
//                        ref (see onPrefetchedAnswerRef below), so an
//                        unstable identity across renders never changes
//                        when this hook actually fires it.
//   active                whether a capture session is actually running
//                        (CopilotClient's own `live`, i.e.
//                        `status === "live" || status === "connecting"`).
//                        Selecting a posting or a question being detected
//                        while merely looking at the page — before the user
//                        has pressed Start — must not spend a model call.
//                        Both the prediction effect and the pre-draft
//                        effect below check this before firing, and both
//                        derived states (predictionState/predraftState)
//                        report "idle" whenever this is false, regardless
//                        of whatever a PRIOR session already stored in
//                        predictionResult/predraftResult — a session that
//                        just ended must not keep showing its last
//                        prediction as if it still applied. Defaults to
//                        `false` (no requests) so an omitted value can never
//                        accidentally re-enable firing.
export function useLiveDashboard({
  questions,
  posting,
  applicationId,
  autoDraft,
  profile,
  onPrefetchedAnswer,
  active = false,
}) {
  const [speechSamples, setSpeechSamples] = useState([]);
  const [predictionResult, setPredictionResult] = useState(EMPTY_PREDICTION_RESULT);
  const [predraftResult, setPredraftResult] = useState(EMPTY_PREDRAFT_RESULT);

  // Mirrors for the async work below, which must see the LATEST prop
  // values across an `await` rather than whatever was in scope when their
  // stable ([] deps) identity was created — same pattern as
  // postingRef/askedRef/interviewTypeRef in PracticeClient.js and
  // postingRef/profileRef/autoDraftRef in CopilotClient.js.
  const questionsRef = useRef(questions);
  const postingRef = useRef(posting);
  const applicationIdRef = useRef(applicationId);
  const profileRef = useRef(profile);
  const onPrefetchedAnswerRef = useRef(onPrefetchedAnswer);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  useEffect(() => {
    postingRef.current = posting;
  }, [posting]);
  useEffect(() => {
    applicationIdRef.current = applicationId;
  }, [applicationId]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    onPrefetchedAnswerRef.current = onPrefetchedAnswer;
  }, [onPrefetchedAnswer]);

  // Monotonic generation, SHARED by the prediction fetch and the pre-draft
  // chained after it: bumping it once invalidates whichever of the two (or
  // both) a superseded request left in flight. A slow response belonging to
  // an earlier conversation state — or an older attempt at the very same
  // signature/question, e.g. a request still in flight when Retry fires a
  // second one — can therefore never repaint over a newer result: every
  // write below happens only after an `await`, and only after checking
  // `genRef.current` still matches what was captured at kickoff. Neither
  // async function below sets any state BEFORE its first `await` — both
  // are called directly from plain effects (see below), and a setState
  // reachable synchronously from an effect body would trip this project's
  // set-state-in-effect rule; putting every write on the far side of a
  // network call is what keeps them clear of it, the same reason
  // useApplicationDocs.js's `load` never sets state outside its
  // `.then`/`.catch`.
  const genRef = useRef(0);

  const runPrediction = useCallback(async (askedList, signature) => {
    const gen = (genRef.current += 1);
    let outcome = "error";
    let question = "";
    let type = "general";
    let error = "";
    try {
      const result = await fetchNextQuestion({
        posting: postingPayloadFor(postingRef.current),
        asked: askedList,
        // AC-I3.21: `interviewType` is deliberately omitted — live mode has
        // no interview-type picker, and silently inheriting practice
        // mode's stored setting would make live output depend on a control
        // the user can't see here. The route defaults to "general".
      });
      question = typeof result?.question === "string" ? result.question.trim() : "";
      type = result?.type || "general";
      outcome = "done";
    } catch (err) {
      error = err?.message || "Could not predict the next question.";
    }
    if (genRef.current !== gen) return;
    setPredictionResult({ forSignature: signature, outcome, question, type, error });
  }, []);

  const runPredraft = useCallback(async (question) => {
    const gen = (genRef.current += 1);
    let outcome = "error";
    let points = [];
    let type = "general";
    let error = "";
    try {
      // AC-I4.25: same draftAnswer client and same applicationId grounding
      // a real drafted answer uses. No `mode` — live mode's default
      // ("points") glanceable bullets, exactly what CopilotClient's own
      // runDraft requests. `context` is intentionally empty: this hook is
      // never given the live transcript (see the module doc above), the
      // same way useSampleAnswer's practice-mode pre-draft also drafts
      // with no context.
      const draft = await draftAnswer({
        question,
        context: "",
        profile: profileRef.current,
        applicationId: applicationIdRef.current,
      });
      points = Array.isArray(draft.points) ? draft.points : [];
      type = draft.type || "general";
      outcome = "done";
    } catch (err) {
      error = err?.message || "Could not draft the predicted answer.";
    }
    if (genRef.current !== gen) return;
    setPredraftResult({ forQuestion: question, outcome, points, type, error });
    // AC-I4.23: the load-bearing write. CopilotClient writes this into the
    // SAME answerCacheRef it already keys by normalized question, so
    // runDraft's existing cache lookup serves it instantly if the
    // interviewer actually asks the predicted question — turning a correct
    // prediction free rather than merely fast, and the extra call this
    // costs (AC-I4.26) into a hit rather than waste.
    //
    // The setPredraftResult call above already ran, so the drafted answer is
    // surfaced to the panel no matter what happens next — wrapping just this
    // call is what keeps a failure in the CALLER's cache write from losing
    // that already-successful draft. onPrefetchedAnswer is caller-supplied
    // (a plain function prop, not something this module defines), so this
    // hook cannot assume it never throws the way it can assume its own two
    // network calls' failure modes. The module doc promises nothing here
    // ever throws back out to a caller; without this try/catch a throwing
    // callback would turn into an unhandled promise rejection instead,
    // which breaks that promise just as surely as a rethrow would.
    if (outcome === "done") {
      try {
        onPrefetchedAnswerRef.current?.(question, { points, type });
      } catch {
        // Deliberately swallowed — see comment above. Nothing to recover:
        // the draft itself already reached predraftResult/predraftState;
        // only the caller's own cache write failed, and that failure is the
        // caller's concern, not something this hook has a state slot for.
      }
    }
  }, []);

  // Cheap to compute on every render (a handful of string ops over a small
  // array) — deliberately NOT memoized, so its VALUE (not a wrapping
  // useMemo call) is what the effect below keys off. `questions`'s array
  // reference changes on every status update elsewhere in it (a question's
  // draft flipping loading -> done, see CopilotClient's runDraft), but the
  // signature STRING only changes when the asked text or the posting
  // actually changes — which is the effect's actual trigger (AC-I3.18).
  const signature = predictionSignatureFor(questions, posting);

  // Gated on `active`: a posting selected (or questions detected, though
  // that can't happen before a session starts) while `active` is false must
  // never fire a request — that's the whole point of this input. Once a
  // session actually starts, `active` flips to true and this effect fires
  // for whatever signature is already current, exactly as it would have
  // fired immediately before this gate existed.
  useEffect(() => {
    if (!active || !signature) return;
    runPrediction(askedQuestionsFor(questionsRef.current), signature);
  }, [active, signature, runPrediction]);

  // Forced to "idle" whenever `active` is false, regardless of what
  // predictionResult still holds from a session that just ended — a stored
  // "done" result for a signature that happens to still match must not be
  // reported as a live prediction once the session backing it is gone.
  const predictionState = resolveDashboardState(
    predictionResult,
    signature,
    active,
    resolvePrediction,
    IDLE_PREDICTION_STATE
  );

  const predraftKey = predraftKeyFor(predictionState.status, predictionState.question, autoDraft);

  useEffect(() => {
    if (!active || !predraftKey) return;
    runPredraft(predraftKey);
  }, [active, predraftKey, runPredraft]);

  // Same forced-idle treatment as predictionState above, and for the same
  // reason — predraftKey already collapses to "" once predictionState is
  // idle, but forcing this too keeps the guarantee explicit rather than
  // relying on that derivation alone.
  const predraftState = resolveDashboardState(
    predraftResult,
    predraftKey,
    active,
    resolvePredraft,
    IDLE_PREDRAFT_STATE
  );

  // Retry (AC-I3.19's degrade-with-retry action): fired from a button
  // click, never from an effect, so setting state directly inside
  // runPrediction's post-await continuation is exactly as safe as it is on
  // the effect-driven path above — this just calls the SAME function
  // in-line rather than waiting for `signature` to change again. Gated on
  // `active` for the same reason the effect above is: the Retry action only
  // ever renders while predictionState.status is "error", which is itself
  // impossible while `active` is false (forced to "idle" above), but the
  // guard is kept here too rather than relied on transitively.
  const retryPrediction = useCallback(() => {
    if (!active || !signature) return;
    runPrediction(askedQuestionsFor(questionsRef.current), signature);
  }, [active, runPrediction, signature]);

  // Retry for the PRE-DRAFTED ANSWER specifically — the failed-pre-draft
  // dead end this was added to fix. The pre-draft effect above only re-fires
  // when `predraftKey` (the predicted question text) changes, but the
  // prediction panel's own Retry usually lands on the SAME predicted
  // question — the inputs it predicts from have not changed — so
  // `predraftKey` stays put and that effect never re-fires, leaving a failed
  // pre-draft stuck failed with no reachable recovery. Calling runPredraft
  // directly here, exactly the way retryPrediction above calls runPrediction
  // directly rather than waiting for `signature` to change again, is what
  // forces a fresh request despite the unchanged key: this is a click
  // handler, not an effect, so it is never gated by a dependency array.
  //
  // Staleness is still gated the same way every other write into
  // predraftResult is: runPredraft bumps the shared `genRef` before its
  // first `await` and only writes state once it observes that generation is
  // still the newest one, so a slower response from a request already in
  // flight when Retry is pressed (or a session reset that happens while
  // this one is pending) can never land after and overwrite a newer result.
  //
  // Guarded by the same `!active || !predraftKey` check the pre-draft effect
  // itself uses. `predraftKey` already collapses to "" whenever Auto-draft
  // is off or no prediction has landed (see predraftKeyFor above), so this
  // one check alone covers all three required no-op conditions: nothing to
  // draft, Auto-draft off, and (via `active`) no session running. The
  // button that calls this is only ever rendered in the pre-draft's error
  // state, which cannot occur under any of those conditions either, but the
  // guard is kept here too rather than relied on transitively — same
  // reasoning as retryPrediction's own guard above.
  const retryPredraft = useCallback(() => {
    if (!active || !predraftKey) return;
    runPredraft(predraftKey);
  }, [active, predraftKey, runPredraft]);

  // Called by the caller when a new session starts. Bumps the generation
  // (so a request still in flight for the session just left behind can
  // never write its result into the new one) and clears every state slot
  // back to its empty value — including the two request results, even
  // though `signature` transitioning away from whatever session A last
  // requested would eventually re-derive "loading" on its own: a session
  // restarted against the SAME posting with zero questions asked yet would
  // otherwise reproduce session A's exact signature and, without this,
  // could briefly keep showing session A's stale prediction as if it were
  // already valid for session B.
  const resetForSession = useCallback(() => {
    genRef.current += 1;
    setSpeechSamples([]);
    setPredictionResult(EMPTY_PREDICTION_RESULT);
    setPredraftResult(EMPTY_PREDRAFT_RESULT);
  }, []);

  // Called by the caller from onTranscript, for the user's own FINAL
  // frames only — appendSpeechSample already drops frames with unusable
  // (missing/non-numeric) timing, so a caller does not need to pre-filter
  // before calling this.
  const recordSpeechSample = useCallback(({ text, start, duration } = {}) => {
    setSpeechSamples((prev) => appendSpeechSample(prev, { text, start, duration }));
  }, []);

  // AC-I2.10-14: the rolling window and its measured/label derivation are
  // entirely lib/copilot/livePace.js's job — this is a straight pass-
  // through, memoized only because `speechSamples` (unlike the cheap string
  // derivations above) grows an array this recomputes a window scan over.
  const pace = useMemo(() => computeLivePace(speechSamples), [speechSamples]);

  return {
    pace,
    predictedQuestion: predictionState.question,
    predictionStatus: predictionState.status,
    predictionError: predictionState.error,
    retryPrediction,
    predictedPoints: predraftState.points,
    predictedAnswerStatus: predraftState.status,
    predictedAnswerError: predraftState.error,
    retryPredraft,
    recordSpeechSample,
    resetForSession,
  };
}
