"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shouldTreatAsRoomQuestion } from "@/lib/copilot/roomQuestions";
import { detectQuestion, normalizeQuestion } from "@/lib/copilot/questions";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";
// Namespace import for Row 2 only, probed with `in` before use -- see
// liveFetchAvailable below for why a named import cannot be used here.
import * as answerClientModule from "@/lib/copilot/answerClient";
import { projectExampleFromResponse, startProjectExampleLive } from "@/lib/copilot/projectExampleLive";
import { startTechTerms } from "@/lib/copilot/techTermsLive";
import { readEngine } from "@/app/settings/engine";
import { normalizeManualQuestion } from "@/lib/copilot/manualQuestion";
import { getInterviewType } from "../useInterviewType";
import { getCodeLanguage } from "../useCodeLanguage";

// Row 2 of the example-projects group goes through a namespace probe because a
// test file that stubs answerClient with only the exports it uses (this hook's
// own suites stub just `draftAnswer`) omits this one, and Vitest treats touching
// an omitted export as an error. Absent, the feature simply does not run, which
// is what every suite that predates it expects. useDraftAnswer.js and
// useSampleAnswer.js carry the same probe for the same reason.
function liveFetchAvailable() {
  return "fetchProjectExampleLive" in answerClientModule && typeof answerClientModule.fetchProjectExampleLive === "function";
}

// The tech-buzzwords row's own probe: it checks fetchTechTerms, never
// fetchProjectExampleLive, because the two rows call different exports.
function techTermsFetchAvailable() {
  return "fetchTechTerms" in answerClientModule && typeof answerClientModule.fetchTechTerms === "function";
}

// The Row-1 core both rows gate on: an application is selected and the answer
// carried a Row 1 value in any status. One predicate, so the rows cannot drift.
function exampleRowEnabled(appId, example) {
  return !!appId && !!example;
}

// Row 2 for one detected-question card: an invented project written for the
// question, requested after the answer has landed and never awaited, so it can
// neither delay the answer nor fail it. `example` is the Row 1 value the ANSWER
// carried, in whatever status, and it is the gate -- the same one live mode and
// the sample answer use (the server omits Row 1 exactly when the feature does
// not apply). Every write is gated `q.id === id && q.draftToken === token`, like
// every other post-await write in runDraft; invalidateDrafts also clears the
// card's rows, so a format change leaves no placeholder waiting on a settle that
// the token gate will now drop.
function fireRoomExampleLive({ setQuestions, id, token, question, appId, example }) {
  if (!exampleRowEnabled(appId, example) || !liveFetchAvailable()) return;
  try {
    startProjectExampleLive({
      applicationId: appId,
      question,
      engine: readEngine(),
      fetchLive: answerClientModule.fetchProjectExampleLive,
      apply: (value) => {
        setQuestions((prev) =>
          prev.map((q) => (q.id === id && q.draftToken === token ? { ...q, projectExampleLive: value } : q)),
        );
      },
    });
  } catch {
    // Row 2 is a supplement; nothing here may interrupt the draft.
  }
}

// The tech-buzzwords row for one detected-question card, fired from the same
// place and under the same Row-1 core and token gate as Row 2 above. Never
// cached, and cleared with the example rows on a redraft or invalidation.
function fireRoomTechTerms({ setQuestions, id, token, question, appId, example }) {
  if (!exampleRowEnabled(appId, example) || !techTermsFetchAvailable()) return;
  try {
    startTechTerms({
      applicationId: appId,
      question,
      engine: readEngine(),
      fetchTerms: answerClientModule.fetchTechTerms,
      apply: (value) => {
        setQuestions((prev) =>
          prev.map((q) => (q.id === id && q.draftToken === token ? { ...q, techTerms: value } : q)),
        );
      },
    });
  } catch {
    // The row is a supplement; nothing here may interrupt the draft.
  }
}

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
export function useRoomQuestions({ applicationId, profile, myTag, collecting, onRowOneStatus }) {
  const [questions, setQuestions] = useState([]);

  // Optional. Told, for every drafted answer that carried a Row 1 value, which
  // application it was drafted for and that Row 1's status, so a cold example
  // pool can be warmed again within the session (useApplicationProjectPool's
  // noteRowOneStatus). A ref, so the stable runDraft below reads the latest
  // callback without depending on its identity.
  const onRowOneStatusRef = useRef(onRowOneStatus);
  useEffect(() => {
    onRowOneStatusRef.current = onRowOneStatus;
  }, [onRowOneStatus]);

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
  // AC-A21/AC-A21c: monotonic per-entry draft ownership counter, the same
  // shape useDraftAnswer.js's own draftTokenRef uses for the identical
  // reason. Real tokens start at 1 (the ref starts at 0 and is
  // pre-incremented), so 0 is a safe "no live draft owns this entry"
  // sentinel — invalidateDrafts (below) stamps it onto every entry it
  // resets, which is what stops a draft that was already in flight under
  // the OLD interview type from landing (on either the success path or the
  // rejection path — an unguarded catch is half the hazard) after the
  // format has changed out from under it.
  const roomDraftTokenRef = useRef(0);
  // The newest draft token stamped on each card, by card id. The card's own
  // `draftToken` is only readable inside a setQuestions updater, which must stay
  // pure, so this is how a draft that resolves AFTER a newer one (or an
  // invalidation) took its card finds that out before it spends a model call on
  // an example nobody will see (Row 2). invalidateDrafts empties it.
  const latestTokenByIdRef = useRef(new Map());

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
  // renders — points, type, cues, buzzwords, resumeAnchor —
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
  // `interviewType` IS sent, read synchronously off getInterviewType()
  // (../useInterviewType.js) at the top of this callback, below — never off
  // a ref mirrored during render. The store notifies its subscribers
  // synchronously inside the click that changed it, but useSyncExternalStore
  // only SCHEDULES a render for that and useEffect is passive and commits
  // after paint, so a ref kept in sync via a render-time effect would still
  // read the OLD value inside that synchronous listener (this project's
  // react-hooks/refs rule is error-level and transitive for exactly this
  // reason: handing a ref's `.current` out of render through a closure, or a
  // useCallback like this one, is the same hazard as reading it inline).
  // getInterviewType() has no such lag because it reads the store directly,
  // not a value React has queued a re-render to reflect.
  //
  // AC-C24/AC-C27b: `codeLanguage` is sent the same way, read synchronously
  // off getCodeLanguage() (../useCodeLanguage.js) at the exact same capture
  // point — a REQUEST FIELD ONLY. This hook holds no answer cache and does no
  // grounding comparison at all (no `cacheRef`, no `groundingFor`), so there
  // is no key for the language to join here and nothing to invalidate on a
  // switch beyond `invalidateDrafts` (below), which the practice subscriber
  // already calls.
  //
  // AC-A21c: the value captured at that same moment is stamped as `token`
  // (roomDraftTokenRef, above) onto the "loading" write below, and BOTH
  // post-await writes — the success path and the catch — only apply if the
  // entry's stamped token still matches. Without this a draft that crosses
  // an interview-type change (invalidateDrafts, below) would still land,
  // stale, once its network call finally resolves or rejects; today that
  // hazard is masked only by resetForSession emptying the list first, which
  // makes the stale `prev.map` a no-op — invalidateDrafts does NOT empty the
  // list (see its own comment), so nothing else prevents this once this hook
  // starts sending an interview type.
  const runDraft = useCallback(async (id, question) => {
    const token = (roomDraftTokenRef.current += 1);
    latestTokenByIdRef.current.set(id, token);
    // The application this draft is for, read once before the await: it is the
    // id the request sends AND the id Row 2 and the warm-up report are keyed to.
    const appId = applicationIdRef.current;
    setQuestions((prev) =>
      prev.map((q) =>
        // A redraft clears the previous answer's two example rows with its
        // status, for the reason useDraftAnswer.js clears them: a new answer must
        // not sit beside the last answer's example, and a previous Row 2 is
        // never carried across.
        q.id === id
          ? {
              ...q,
              status: "loading",
              error: "",
              draftToken: token,
              projectExample: undefined,
              projectExampleLive: undefined,
              techTerms: undefined,
            }
          : q,
      ),
    );
    try {
      const { points, type, cues, buzzwords, resumeAnchor, pageSources, projectExample } = await draftAnswer({
        question,
        context: "",
        profile: profileRef.current,
        applicationId: appId,
        interviewType: getInterviewType(),
        codeLanguage: getCodeLanguage(),
      });
      // Row 1 of the example-projects group, picked server-side from the
      // pre-warmed pool for THIS question. Absent stays absent (see
      // projectExampleFromResponse): the server omits it when the feature does
      // not apply, and absence is how a card renders no example group at all.
      // Dropping it here (as this destructure once did) rendered "nothing" on
      // every detected-question card while the server did the pool read.
      const example = projectExampleFromResponse(projectExample);
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === id && q.draftToken === token
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
                // ARCH §3.5/§4e: same defensive normalization as its
                // siblings above — which knowledge-base page (if any) each
                // point came from, rendered by AnswerLines via QuestionFeed.
                pageSources: Array.isArray(pageSources) ? pageSources : [],
                projectExample: example,
                // Row 2 starts below, after this write; never carried over.
                projectExampleLive: undefined,
                techTerms: undefined,
                // Prefer the type confirmQuestion already classified this
                // question as (set when the entry was first added, below)
                // over draftAnswer's own guess — same precedence
                // useLiveSession.js's runDraft uses for the identical reason.
                type: q.type || type,
              }
            : q,
        ),
      );
      if (latestTokenByIdRef.current.get(id) === token) {
        fireRoomExampleLive({ setQuestions, id, token, question, appId, example });
        fireRoomTechTerms({ setQuestions, id, token, question, appId, example });
      }
      // Guarded on its own: the answer above has landed, and a throw out of the
      // warm-up report must not reach the catch below and turn it into an error.
      try {
        onRowOneStatusRef.current?.(appId, example?.status);
      } catch {
        // The warm-up is a supplement; nothing here may interrupt the draft.
      }
    } catch (err) {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === id && q.draftToken === token
            ? { ...q, status: "error", error: err?.message || "Failed to draft." }
            : q,
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
          // ARCH §3.5/§4e: seeded empty alongside the other reading aids —
          // runDraft above is the sole writer of a real value.
          pageSources: [],
          type: type || null,
          error: "",
          cached: false,
          // AC-A21c: seeded null, never a number — runDraft (above) is the
          // sole writer of a real token, stamped on the very next
          // setQuestions call this same addQuestion triggers below, so no
          // live token can ever equal a freshly seeded entry's.
          draftToken: null,
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
    latestTokenByIdRef.current.clear();
  }, []);

  // AC-A21b: PracticeClient's interview-type-change subscriber calls this,
  // NOT resetForSession — a room question is something someone else in the
  // room actually asked, and a format change does not make it un-asked, so
  // it stays on screen with its id, its text, its `at`, and the type
  // confirmQuestion classified it as, all untouched. What the change DOES
  // invalidate is the DRAFT built under the old rubric: every entry is put
  // back into exactly the shape a fresh, undrafted entry is seeded with
  // (addQuestion, above) — `status: "idle"` (a status this hook otherwise
  // never produces, so a card can render "not yet drafted for this format"
  // distinctly from either "loading" or a genuine fetch "error"), and every
  // answer field reset to its seeded empty value.
  //
  // Each entry's `draftToken` is stamped back to `null` here too — the same
  // sentinel a freshly seeded entry carries, and one no live `token` inside
  // runDraft can ever equal (real tokens start at 1). That is what stops a
  // draft already in flight under the OLD interview type from writing its
  // answer onto this entry once it resolves (or rejects) after this call:
  // runDraft's own post-await guard checks the CURRENT stamped token, not
  // the one it captured, so a mismatch here makes that write a no-op on
  // both the success path and the catch.
  //
  // `lastQNormRef` is deliberately left alone — see this function's own
  // callers' tests: clearing it would let a question still sitting in the
  // feed (now mid-redraft) be re-added the instant someone in the room
  // repeats it, which is exactly the duplicate resetForSession's OWN clear
  // of that guard exists to prevent between sessions, not within one.
  const invalidateDrafts = useCallback(() => {
    latestTokenByIdRef.current.clear();
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        status: "idle",
        error: "",
        cached: false,
        points: null,
        cues: [],
        buzzwords: [],
        anchor: null,
        pageSources: [],
        // The two example rows go with the answer they sat beside: a Row 2 still
        // pending would otherwise wait on a settle the token gate now drops.
        projectExample: undefined,
        projectExampleLive: undefined,
        techTerms: undefined,
        draftToken: null,
      })),
    );
  }, []);

  return {
    questions,
    onUtterance,
    onDraft,
    addManualQuestion,
    resetForSession,
    invalidateDrafts,
  };
}
