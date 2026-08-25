"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shouldTreatAsRoomQuestion } from "@/lib/copilot/roomQuestions";
import { detectQuestion, normalizeQuestion } from "@/lib/copilot/questions";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";
import { normalizeManualQuestion } from "@/lib/copilot/manualQuestion";

// Final wave (AC-M2): practice mode's counterpart of live mode's own
// detected-question pipeline (app/copilot/useLiveSession.js's
// evaluateUtterance/addQuestion/runDraft), but fed by
// PracticeSession.onUtterance (lib/copilot/practiceSession.js) instead of
// CopilotSession's tab/system transcript assembly. Everything about WHETHER
// a turn is worth reacting to is decided in two places outside this file,
// on purpose, so this hook never re-derives either:
//
//   - shouldTreatAsRoomQuestion (lib/copilot/roomQuestions.js) decides
//     whether the turn belongs to someone OTHER than the candidate at all.
//   - detectQuestion (lib/copilot/questions.js), the SAME zero-cost
//     heuristic pre-filter live mode uses, decides whether it's worth the
//     network round trip before ever spending one.
//
// Once both agree, this hook runs the exact same two-step confirm/draft
// pipeline live mode's evaluateUtterance/runDraft run — confirmQuestion,
// then draftAnswer — via the SAME clients those files import. There is
// deliberately no second network-calling path here.
//
// `onUtterance` is the value a caller wires directly onto a running
// PracticeSession instance (see PracticeClient.js's own comment on why that
// wiring has to happen there, not in this hook: PracticeSession is
// constructed by usePracticeCaptureSession.js, a file this feature does not
// touch, so nothing here ever sees the session object itself).
//
// MIN_WORDS_FOR_LLM mirrors useLiveSession.js's own module-level constant of
// the same name and value — that file doesn't export it, so this is a
// second copy of the SAME NUMBER, not a second opinion about what it should
// be; change one, change both.
const MIN_WORDS_FOR_LLM = 4;

// `applicationId`/`profile` are the SAME two grounding facts live mode's
// runDraft captures before its own draftAnswer call (useLiveSession.js) —
// read fresh off refs at the moment a draft is actually sent, never off
// whatever was in scope when a stable callback's identity was created (the
// same postingRef/profileRef pattern that file, useCopilotDashboard.js, and
// PracticeClient.js itself all already use for exactly this reason).
//
// `myTag`/`collecting` are the two signals shouldTreatAsRoomQuestion needs
// (lib/copilot/roomQuestions.js) — `myTag` from usePracticeAnswer's own
// learned dominant-speaker tag, `collecting` from whether the candidate's
// own answer is currently being recorded (PracticeClient derives this as
// `answering || settling`, mirroring usePracticeAnswer's internal
// collectingRef). Both are mirrored into refs the same way applicationId/
// profile are, because `onUtterance` below has to be a STABLE callback
// (assigned once onto the PracticeSession instance, not reassigned on every
// render — see PracticeClient.js) whose body must still see the LATEST
// values across the async confirm/draft chain, not whatever was current
// when that instance was wired up.
export function useRoomQuestions({ applicationId, profile, myTag, collecting }) {
  const [questions, setQuestions] = useState([]);

  const applicationIdRef = useRef(applicationId ?? null);
  const profileRef = useRef(profile ?? "");
  const myTagRef = useRef(myTag ?? null);
  const collectingRef = useRef(!!collecting);
  // Mirrors `questions` for onDraft below — the same reason
  // useLiveSession.js's own `questionsRef` exists: a redraft click needs the
  // CURRENT list to look the clicked id up in, not whatever list was
  // captured when onDraft's own (stable, [] + runDraft-only deps) identity
  // was created.
  const questionsRef = useRef([]);
  const qIdRef = useRef(0);
  // Dedupe back-to-back identical questions, exactly like useLiveSession.js's
  // own lastQNormRef — someone in the room repeating themselves (or a
  // confirmQuestion normalization landing on the same wording twice) must
  // not draft the same answer a second time.
  const lastQNormRef = useRef("");

  useEffect(() => {
    applicationIdRef.current = applicationId ?? null;
  }, [applicationId]);
  useEffect(() => {
    profileRef.current = profile ?? "";
  }, [profile]);
  useEffect(() => {
    myTagRef.current = myTag ?? null;
  }, [myTag]);
  useEffect(() => {
    collectingRef.current = !!collecting;
  }, [collecting]);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  // AC-M2/AC-K1: the SAME draftAnswer client and the SAME "points" request
  // shape live mode's runDraft sends (useLiveSession.js) — `mode` is left
  // undefined, which is what makes the route apply its default "points"
  // branch (app/api/copilot/answer/route.js) rather than practice mode's
  // OWN "answer" mode (the same shape useSampleAnswer.js's own queue/reveal
  // requests use). That response carries every field live mode's card
  // renders — points, type, cues, buzzwords, resumeAnchor, idealProject —
  // which is what lets this reuse QuestionFeed/AnswerLines/AnswerAids
  // unmodified (PracticeClient.js).
  //
  // `context` is deliberately "" — this hook is never handed the practice
  // session's own transcript (unlike live mode's buildContext, which reads
  // a rolling window of recent turns), the same "no transcript to draw on"
  // choice useSampleAnswer.js's own queue/reveal requests already make for
  // the question actually on screen. Threading the transcript in was out of
  // scope for this wave; confirmQuestion/draftAnswer both already treat a
  // missing context as "confirm/draft from the utterance alone", exactly as
  // they do for that existing caller.
  //
  // `interviewType` is left out of the request entirely, for the same
  // reason live mode's own runDraft never sends one: this hook exists to
  // run the SAME pipeline live mode runs, byte for byte, not a practice-
  // flavored variant of it.
  const runDraft = useCallback(async (id, question) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: "loading", error: "" } : q)),
    );
    try {
      const { points, type, cues, buzzwords, resumeAnchor, idealProject, pageSources } = await draftAnswer({
        question,
        context: "",
        profile: profileRef.current,
        applicationId: applicationIdRef.current,
      });
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === id
            ? {
                ...q,
                status: "done",
                points,
                // AC-K1: same defensive normalization useLiveSession.js's own
                // runDraft applies — a missing/malformed field becomes the
                // empty shape here, once, so AnswerAids never has to re-guard
                // its type.
                cues: Array.isArray(cues) ? cues : [],
                buzzwords: Array.isArray(buzzwords) ? buzzwords : [],
                anchor: resumeAnchor || null,
                idealProject: idealProject || null,
                // ARCH §3.5/§4e: same defensive normalization as its
                // siblings above — which knowledge-base page (if any) each
                // point came from, rendered by AnswerLines via QuestionFeed.
                pageSources: Array.isArray(pageSources) ? pageSources : [],
                // Prefer the type confirmQuestion already classified this
                // question as (set when the entry was first added, below)
                // over draftAnswer's own guess — same precedence
                // useLiveSession.js's runDraft uses for the identical reason.
                type: q.type || type,
              }
            : q,
        ),
      );
    } catch (err) {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === id ? { ...q, status: "error", error: err?.message || "Failed to draft." } : q,
        ),
      );
    }
  }, []);

  // Queues a newly confirmed room question and immediately starts drafting
  // it — there is no Auto-draft switch here the way live mode's has one
  // (CopilotClient.js): a question asked live, by someone else, while the
  // candidate is mid-drill is exactly the case worth spending the extra
  // model call on unconditionally, the same reasoning that made
  // shouldTreatAsRoomQuestion itself unconditional once a tag is known (see
  // that module's own header). The shape mirrors useLiveSession.js's
  // addQuestion/QuestionFeed's expected entry contract exactly, including
  // `cached: false` (this hook never serves a cached draft — see runDraft's
  // own doc for why re-fetching on Redraft is fine here) — so QuestionFeed
  // renders a room question exactly like any other detected question.
  const addQuestion = useCallback(
    (question, type) => {
      const id = (qIdRef.current += 1);
      setQuestions((prev) => [
        ...prev,
        {
          id,
          question,
          at: Date.now(),
          status: "loading",
          points: null,
          cues: [],
          buzzwords: [],
          anchor: null,
          idealProject: null,
          // ARCH §3.5/§4e: seeded empty alongside the other reading aids —
          // runDraft above is the sole writer of a real value.
          pageSources: [],
          type: type || null,
          error: "",
          cached: false,
        },
      ]);
      runDraft(id, question);
    },
    [runDraft],
  );

  // The confirm half of the pipeline — detectQuestion's heuristic
  // pre-filter, then confirmQuestion, byte for byte the same two steps
  // useLiveSession.js's own evaluateUtterance runs, including its exact
  // fallback: if confirmQuestion itself fails (network/LLM unavailable),
  // only fall back to treating it as a question when the heuristic ALSO
  // already agreed, rather than trusting the heuristic alone to originate a
  // detection it never would have on its own.
  const evaluateUtterance = useCallback(
    async (utterance) => {
      if (!utterance) return;
      const quick = detectQuestion(utterance);
      const words = utterance.split(/\s+/).filter(Boolean).length;
      // Pre-filter: skip short fragments that aren't obviously questions —
      // the same cost-avoidance MIN_WORDS_FOR_LLM exists for in live mode.
      if (!quick.isQuestion && words < MIN_WORDS_FOR_LLM) return;

      let result;
      try {
        result = await confirmQuestion({ utterance, context: "" });
      } catch {
        if (!quick.isQuestion) return;
        result = { isQuestion: true, question: quick.question, type: "general" };
      }
      if (!result.isQuestion) return;

      const question = (result.question || utterance).trim();
      const norm = normalizeQuestion(question);
      if (norm === lastQNormRef.current) return;
      lastQNormRef.current = norm;
      addQuestion(question, result.type);
    },
    [addQuestion],
  );

  // The ONE entry point this hook exposes for a raw PracticeSession turn —
  // see this file's own header for why the caller (PracticeClient.js) is
  // what actually wires this onto a running session's `onUtterance`
  // property, not this hook itself. Every DECISION about whether the turn
  // is even worth evaluating happens here, before evaluateUtterance (an
  // async network round trip) ever starts: shouldTreatAsRoomQuestion reads
  // BOTH mirrored refs fresh, so a turn that completes just as the
  // candidate presses "Start answering" (or just after their own answer
  // finishes) is judged against whatever is true AT THE MOMENT the turn
  // arrives, not whatever was true when this callback's identity was
  // created.
  const onUtterance = useCallback(
    ({ speakerTag, text } = {}) => {
      const isRoomQuestion = shouldTreatAsRoomQuestion({
        speakerTag,
        myTag: myTagRef.current,
        collecting: collectingRef.current,
      });
      if (!isRoomQuestion) return;
      evaluateUtterance(text);
    },
    [evaluateUtterance],
  );

  // QuestionFeed's own "Draft answer"/"Redraft" button (app/copilot/
  // QuestionFeed.js) calls this with an id — this hook has no cross-session
  // cache to check the way useLiveSession.js's runDraft does (AC-N1's
  // answerCacheRef exists to serve a REPEATED question instantly, written by
  // useDraftAnswer.js's runDraft; there is no equivalent cache here), so a
  // redraft always re-runs the network call, which is exactly what "Redraft"
  // means anyway.
  const onDraft = useCallback(
    (id) => {
      const q = questionsRef.current.find((it) => it.id === id);
      if (q) runDraft(id, q.question);
    },
    [runDraft],
  );

  // AC-O3: the manual-entry counterpart of onUtterance/evaluateUtterance
  // above, but deliberately stops short of the gates those two run through:
  //
  //   - It does not call confirmQuestion, and it deliberately skips the
  //     detectQuestion/MIN_WORDS_FOR_LLM pre-filter evaluateUtterance runs.
  //     Those exist to decide IS-THIS-A-QUESTION for a fragment of speech;
  //     typing it is that decision, already made by the person who knows.
  //   - It does not go through shouldTreatAsRoomQuestion (onUtterance's own
  //     gate). That gate guesses, from speaker tags, whether a turn belonged
  //     to someone other than the candidate — and while the candidate's own
  //     answer is recording it attributes every turn to them and reacts to
  //     none. Typing is an explicit statement about someone else's question;
  //     running it through a voice-attribution guess would silently swallow
  //     it in exactly the state manual entry exists to route around (see
  //     this file's own manual test pinning this).
  //   - It passes `null` as the type, not a guess of its own: runDraft
  //     resolves `type: q.type || type`, so a pre-set type here would win
  //     over the drafted answer's own classification — `null` is what makes
  //     a typed entry's card end up identical to a detected one's.
  //
  // It still WRITES lastQNormRef, the same dedupe guard evaluateUtterance
  // reads above — a room question repeating a moment later (someone
  // rephrasing, or confirmQuestion normalizing onto the same wording) is
  // suppressed by it exactly as if the repeat had come from the room first.
  // But it never READS the guard before adding, and that asymmetry is
  // deliberate, the same as useLiveSession.js's own addManualQuestion: an
  // explicit typed submit must never vanish with no feedback, so typing the
  // same question twice on purpose always lands as a second card. Unlike
  // live mode, this hook has no answer cache — there is no equivalent to
  // answerCacheRef here — so that second card is a second full draftAnswer
  // round trip, not a free one.
  const addManualQuestion = useCallback(
    (text) => {
      const { ok, question } = normalizeManualQuestion(text);
      if (!ok) return false;
      lastQNormRef.current = normalizeQuestion(question);
      addQuestion(question, null);
      return true;
    },
    [addQuestion],
  );

  // Called by PracticeClient at the start of every fresh capture session
  // (folded into the same resetForSession usePracticeAnswer already exposes
  // — see PracticeClient.js) — a room question detected during a PREVIOUS
  // session must not linger on screen once a new one starts, and the dedupe
  // guard must not remember a question that session will never repeat.
  const resetForSession = useCallback(() => {
    setQuestions([]);
    lastQNormRef.current = "";
  }, []);

  return { questions, onUtterance, onDraft, addManualQuestion, resetForSession };
}
