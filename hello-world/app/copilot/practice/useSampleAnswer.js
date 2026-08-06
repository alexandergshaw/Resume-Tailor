"use client";

import { useCallback, useRef, useState } from "react";
import { draftAnswer } from "@/lib/copilot/answerClient";
import { emptySampleAnswer, activeSampleAnswer, needsRedraft } from "@/lib/copilot/sampleAnswerState";

// G1: thin React wrapper around lib/copilot/sampleAnswerState.js's pure
// derivation. This hook owns exactly the three things React-specific
// enough that the pure module can't: the state slot itself, the monotonic
// generation ref that gates stale writes (AC-G1-7 — same pattern as
// requestQuestion in PracticeClient.js and runCritique in
// usePracticeAnswer.js), and the draftAnswer network call. Every DECISION —
// which draft (if any) applies to the question on screen, whether a reveal
// needs a fresh request — lives in sampleAnswerState.js as plain functions,
// so it's reachable from vitest without React (AC-G1-12).
//
// Deliberately independent of usePracticeAnswer: nothing here starts or
// stops the recorder or samplers, reads or writes answering/settling, or
// touches the critique — see AC-G1-10.
//
// G2: takes `interviewType` (shapes the drafted answer the same way it
// shapes questions and critique) and `applicationId` (the selected
// posting's own id — see PracticeClient's onDoneAnswer for the same
// normalizePostingRows fact) so the draft can be grounded in the resume and
// cover letter actually submitted for that posting. Always requests
// `mode: "answer"`, which AC-H9 changed to return `points` — an array of
// complete, speakable, STAR-labeled-when-applicable sentences — in place of
// a single prose string; this hook carries `points` through exactly where
// it carried `answer` before, with the same caching/gating rules (AC-H9.37).
export function useSampleAnswer({ question, profile, interviewType, applicationId }) {
  const [state, setState] = useState(emptySampleAnswer);
  // Bumped on every new request; a response is only ever written to state
  // while it's still the newest one requested — a slow draft for a question
  // the user has since moved past must repaint nothing (AC-G1-7).
  const genRef = useRef(0);

  // Only a stored draft built for the EXACT question on screen right now
  // ever applies (AC-G1-5) — no effect resets this on question change, the
  // comparison below just naturally stops matching.
  const active = activeSampleAnswer(state, question);

  // Fires (or re-fires) the network request for `q`/`p`/`it`/`appId`,
  // unconditionally — callers decide via needsRedraft whether this should
  // run at all. Marks the panel visible and loading immediately. The
  // resolution/rejection handlers merge into whatever `visible` is true AT
  // THAT MOMENT (a functional update) rather than forcing it back to true —
  // hiding the panel while this request is still in flight must not be
  // silently undone the instant it lands; the draft still gets cached
  // either way. Errors are handled entirely inside this promise chain
  // (AC-G1-4): nothing here ever throws back out to a caller.
  const request = useCallback((q, p, it, appId) => {
    const gen = (genRef.current += 1);
    setState({
      question: q,
      visible: true,
      status: "loading",
      points: [],
      grounding: null,
      error: "",
      profile: p,
      interviewType: it,
      applicationId: appId,
    });
    // AC-H9: the route's `mode: "answer"` response is now
    // { points, answer, type, grounding } — `points` is what this hook (and
    // SampleAnswer.js) render; the derived prose `answer` field exists for a
    // later speech-synthesis feature and is deliberately not read here.
    draftAnswer({ question: q, context: "", profile: p, interviewType: it, applicationId: appId, mode: "answer" })
      .then(({ points, grounding }) => {
        if (genRef.current !== gen) return;
        setState((prev) => ({
          ...prev,
          question: q,
          status: "done",
          points: Array.isArray(points) ? points : [],
          grounding: grounding || null,
          error: "",
          profile: p,
          interviewType: it,
          applicationId: appId,
        }));
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setState((prev) => ({
          ...prev,
          question: q,
          status: "error",
          points: [],
          grounding: null,
          error: err?.message || "Could not draft a sample answer.",
          profile: p,
          interviewType: it,
          applicationId: appId,
        }));
      });
  }, []);

  // Shared by the toggle's "show" branch (force=false — serve the cache
  // when it's still valid per needsRedraft) and by Retry/Regenerate
  // (force=true — always redraft). The pure module makes the call; this
  // just acts on it.
  const reveal = useCallback(
    (force) => {
      if (needsRedraft(active, profile, interviewType, applicationId, force)) {
        request(question, profile, interviewType, applicationId);
        return;
      }
      setState((prev) => (prev.question === question ? { ...prev, visible: true } : prev));
    },
    [active, profile, interviewType, applicationId, question, request],
  );

  // "Show sample answer" / "Hide sample answer". Hiding never fetches — it
  // only flips visibility, leaving whatever is cached (points, status,
  // profile) exactly as it was for the next reveal (AC-G1-3).
  const toggle = useCallback(() => {
    if (active.visible) {
      setState((prev) => (prev.question === question ? { ...prev, visible: false } : prev));
      return;
    }
    reveal(false);
  }, [active.visible, question, reveal]);

  const retry = useCallback(() => reveal(true), [reveal]);
  const regenerate = useCallback(() => reveal(true), [reveal]);

  return {
    visible: active.visible,
    status: active.status,
    points: active.points,
    grounding: active.grounding,
    error: active.error,
    toggle,
    retry,
    regenerate,
  };
}
