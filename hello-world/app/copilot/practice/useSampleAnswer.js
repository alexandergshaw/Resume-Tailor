"use client";

import { useCallback, useRef, useState } from "react";
import { draftAnswer } from "@/lib/copilot/answerClient";
import {
  emptySampleAnswer,
  activeSampleAnswer,
  needsRedraft,
  cachedSampleAnswerFor,
} from "@/lib/copilot/sampleAnswerState";
import { normalizeQuestion } from "@/lib/copilot/questions";

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
  // AC-J2.8: practice mode's counterpart to live mode's answerCacheRef
  // (CopilotClient.js) — the entire cost justification for the dashboard's
  // "Pre-draft predicted answer" switch. Keyed by normalizeQuestion, the
  // same normalization live mode's cache uses, so a predicted question that
  // actually gets asked (even with different case/whitespace) still hits.
  // A plain ref rather than state: writing to it must never itself trigger
  // a render or touch `state` — see `prime` below.
  const cacheRef = useRef(new Map());

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
      cues: [],
      buzzwords: [],
      anchor: null,
      idealProject: null,
      grounding: null,
      error: "",
      profile: p,
      interviewType: it,
      applicationId: appId,
    });
    // AC-H9/AC-K1: the route's `mode: "answer"` response is
    // { points, cues, answer, type, grounding, buzzwords, resumeAnchor,
    // idealProject }. `cues` is what SampleAnswer.js renders, with `points`
    // as its fallback (answerBullets); `buzzwords`/`resumeAnchor`/
    // `idealProject` are the subsections under it. The derived prose
    // `answer` field exists for a later speech-synthesis feature and is
    // deliberately not read here.
    draftAnswer({ question: q, context: "", profile: p, interviewType: it, applicationId: appId, mode: "answer" })
      .then(({ points, cues, buzzwords, resumeAnchor, idealProject, grounding }) => {
        if (genRef.current !== gen) return;
        const cleanPoints = Array.isArray(points) ? points : [];
        // AC-K1: same defensive normalization `points` already gets — a
        // missing or malformed field must land in state as the empty shape,
        // so the render layer's "is there anything to show" checks stay
        // simple truthiness rather than each one re-guarding the type.
        const cleanCues = Array.isArray(cues) ? cues : [];
        const cleanBuzzwords = Array.isArray(buzzwords) ? buzzwords : [];
        const cleanAnchor = resumeAnchor || null;
        const cleanIdealProject = idealProject || null;
        const cleanGrounding = grounding || null;
        setState((prev) => ({
          ...prev,
          question: q,
          status: "done",
          points: cleanPoints,
          cues: cleanCues,
          buzzwords: cleanBuzzwords,
          anchor: cleanAnchor,
          idealProject: cleanIdealProject,
          grounding: cleanGrounding,
          error: "",
          profile: p,
          interviewType: it,
          applicationId: appId,
        }));
        // AC-J2.8: a real (user-requested) draft is cached the exact same
        // way a dashboard pre-draft is (see `prime` below) — same key, same
        // entry shape — so a draft survives moving to a different question
        // and back without a second request, not just a prediction that
        // happened to land before the reveal.
        cacheRef.current.set(normalizeQuestion(q), {
          points: cleanPoints,
          cues: cleanCues,
          buzzwords: cleanBuzzwords,
          anchor: cleanAnchor,
          idealProject: cleanIdealProject,
          grounding: cleanGrounding,
          profile: p,
          interviewType: it,
          applicationId: appId,
        });
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setState((prev) => ({
          ...prev,
          question: q,
          status: "error",
          points: [],
          cues: [],
          buzzwords: [],
          anchor: null,
          idealProject: null,
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
        // AC-J2.8: `force` (Retry/Regenerate) always bypasses the cache and
        // redrafts — needsRedraft already returns true unconditionally for
        // force, so this branch only reaches the cache lookup when force is
        // false, which is exactly what "always bypass" requires. A correct
        // prediction must be FREE on reveal, not merely fast: before paying
        // for a fresh request, check whether the dashboard already
        // pre-drafted this exact question. cachedSampleAnswerFor applies the
        // same profile/interviewType/applicationId comparison needsRedraft's
        // own "done" branch does, just against a cache entry instead of the
        // draft already on screen, so a pre-draft made before the user
        // edited their prep context (or changed posting/interview type) is
        // never served as if it still applied.
        if (!force) {
          const cached = cachedSampleAnswerFor(
            cacheRef.current.get(normalizeQuestion(question)),
            question,
            profile,
            interviewType,
            applicationId,
          );
          if (cached) {
            setState(cached);
            return;
          }
        }
        request(question, profile, interviewType, applicationId);
        return;
      }
      setState((prev) => (prev.question === question ? { ...prev, visible: true } : prev));
    },
    [active, profile, interviewType, applicationId, question, request],
  );

  // AC-J2.8: primes the cache with a dashboard pre-draft for a question the
  // user has NOT asked to see yet — called from PracticeClient's
  // onPrefetchedAnswer. Deliberately never touches `state`: a pre-drafted
  // answer for a question that isn't on screen must not put itself on
  // screen, and must not disturb a draft already on screen for a DIFFERENT
  // question (the current `state` may belong to an earlier question the
  // user is still looking at while this question is only predicted).
  const prime = useCallback(
    (
      q,
      {
        points,
        cues,
        buzzwords,
        resumeAnchor,
        idealProject,
        grounding,
        profile: p,
        interviewType: it,
        applicationId: appId,
      } = {},
    ) => {
      cacheRef.current.set(normalizeQuestion(q), {
        points: Array.isArray(points) ? points : [],
        // AC-K1: a pre-draft carries the reading aids too, so a correct
        // prediction stays FREE on reveal rather than free-but-degraded — a
        // cache hit that dropped the aids would show a different, poorer
        // panel than the same question drafted on demand.
        cues: Array.isArray(cues) ? cues : [],
        buzzwords: Array.isArray(buzzwords) ? buzzwords : [],
        anchor: resumeAnchor || null,
        idealProject: idealProject || null,
        grounding: grounding || null,
        profile: p,
        interviewType: it,
        applicationId: appId,
      });
    },
    [],
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
    cues: active.cues,
    buzzwords: active.buzzwords,
    anchor: active.anchor,
    idealProject: active.idealProject,
    grounding: active.grounding,
    error: active.error,
    toggle,
    retry,
    regenerate,
    prime,
  };
}
