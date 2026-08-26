"use client";

import { useCallback } from "react";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { normalizeManualQuestion } from "@/lib/copilot/manualQuestion";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { localDetection, remoteConfirmNeeded } from "@/lib/copilot/localDetection";

// AC-M1.3.5/AC-M1.6.3/AC-O2/AC-P4.1: the question pipeline — split out of
// useLiveSession.js purely to keep that file under this project's 1000-line
// verification cap, the same reason useSessionLogRecorder.js,
// useDraftAnswer.js, useQuestionPin.js, useVoiceCues.js and useCueActions.js
// each record in their own headers for leaving the very same file. It is the
// fifth such split and, like the other four, is NOT a new architectural
// boundary anybody argued for on cohesion grounds: this was one job while it
// was still inline, and useLiveSession.js had reached 999 of 1000 lines, so
// the next feature to touch it would have failed verification before writing
// a line.
//
// OWNS everything between a finished utterance and a card on screen: whether
// an utterance is a question at all (localDetection first, zero network, then
// confirmQuestion only when the heuristic genuinely missed), the back-to-back
// dedupe guard, the in-person `evaluate`/provisional gate, the shape of a
// question entry itself (addQuestion is the ONLY place a card is constructed,
// for every source and for a typed question alike), and the typed-question
// path that deliberately skips the detection half.
//
// DELIBERATELY DOES NOT OWN, and takes as arguments instead:
//   - the questions array. `setQuestions` is passed in; CopilotClient.js holds
//     the `useState` because its own render reads it (see useLiveSession.js's
//     module doc). Every state TRANSITION for a question still happens here or
//     in useDraftAnswer.js, exactly as before this split.
//   - the answer. `runDraft` (useDraftAnswer.js) is asked for one and nothing
//     more; the cache, the streaming client and the generation guard are all
//     that hook's, and useLiveSession.js's `onDraft` calls it directly too.
//   - the conversation context (`buildContext`), the session log (`logEvent`,
//     useSessionLogRecorder.js) and the live session object (`sessionRef`).
//   - all four refs it reads. `qIdRef`, `questionsRef`, `lastQNormRef` and
//     `autoDraftRef` stay declared in useLiveSession.js: that hook mirrors
//     `questions`/`autoDraft` into two of them from effects, resets the other
//     two in `start`/`clearAll`, and shares `questionsRef` with the pin
//     surface (useQuestionPin.js). Re-creating any of them here would produce
//     a second copy that `start()` never clears — and the mirrors exist in the
//     first place because this project's react-hooks rules forbid reading a
//     ref's `.current` during render, so the ref must stay with the hook that
//     owns the state it mirrors. Nothing on either side of this seam reads a
//     `.current` outside a callback body.
//   - `defaultSpeakerSnapshot`, for the same single-source reason:
//     useLiveSession.js's DEFAULT_SPEAKER_SNAPSHOT is the idle shape its own
//     `speakerSnapshot` state, session.js's `speakerSnapshot()` and
//     handleUtterance's fallback below all have to agree on, and a second
//     literal here is a second thing to keep in step with session.js.
export function useQuestionPipeline({
  qIdRef,
  questionsRef,
  lastQNormRef,
  autoDraftRef,
  sessionRef,
  defaultSpeakerSnapshot,
  buildContext,
  runDraft,
  setQuestions,
  logEvent,
}) {
  // AC-M1.3.5: `meta` is populated ONLY by the in-person path
  // (handleUtterance below) — `{ speakerTag, provisional }`. The tab/system
  // pendingRef path (useLiveSession.js's own `start`, in its onTranscript
  // callback) still calls this with no third argument at all, so `speakerTag`
  // stays `null` and `provisional` stays `false` for every entry it ever
  // creates, exactly today's shape plus two inert fields.
  const addQuestion = useCallback(
    (question, type, auto, meta = {}) => {
      const id = (qIdRef.current += 1);
      setQuestions((prev) => [
        ...prev,
        {
          id,
          question,
          at: Date.now(),
          status: auto ? "loading" : "idle",
          points: null,
          // AC-K1: seeded empty alongside `points` so an entry is a complete
          // shape from the moment it exists, whichever status it is in.
          cues: [],
          buzzwords: [],
          anchor: null,
          idealProject: null,
          // ARCH §3.5/§4e: seeded empty alongside the other reading aids —
          // an entry is a complete shape from the moment it exists, whether
          // loading or idle. useDraftAnswer.js's runDraft is the sole
          // writer of a real value, on the terminal `done` frame only.
          pageSources: [],
          type: type || null,
          error: "",
          // AC-M1.3.5: which voice this was detected from (in-person only),
          // and whether it was provisional AT DETECTION TIME — see
          // onSpeakerIdentity in useLiveSession.js's `start` for how this is
          // kept correct retroactively as identity settles.
          speakerTag: typeof meta.speakerTag === "number" ? meta.speakerTag : null,
          provisional: !!meta.provisional,
        },
      ]);
      // AC-Q6.2: every card the user sees, detected or typed alike.
      logEvent("question.added", { id, question, type: type || null, auto: !!auto });
      if (auto) runDraft(id, question);
    },
    [runDraft, setQuestions, logEvent, qIdRef],
  );

  // AC-O2: live mode's half of "typing a question is the same as detecting
  // one" — the manual counterpart to evaluateUtterance below, skipping
  // straight to addQuestion instead of running its confirmQuestion pipeline.
  //
  // Does NOT call confirmQuestion: that client exists to decide IS THIS A
  // QUESTION for a fragment of speech. Typing it is that decision, already
  // made by the person who knows it. A round trip to have the model
  // second-guess it is both slower and capable of throwing the entry away
  // outright — and MIN_WORDS_FOR_LLM, the pre-filter that exists purely to
  // avoid paying for that round trip, is skipped for the same reason.
  //
  // Passes `null` as the type, not a locally-classified one: runDraft
  // resolves `type: it.type || type` — a pre-set type would WIN over the
  // drafted answer's own classification, so leaving it null here is what
  // makes a typed question's card end up identical to a detected one's.
  //
  // Writes lastQNormRef, but — unlike evaluateUtterance below — never reads
  // it, and that asymmetry is deliberate. The common case is typing what
  // you just heard while the interviewer is still speaking, with the
  // transcript producing the same question a second later; writing the
  // guard here is what suppresses that follow-on detection. But an
  // explicit typed submit must never itself vanish with no feedback, so
  // this never checks lastQNormRef before adding — a deliberate repeat (the
  // user submits the same question twice on purpose) always lands as a
  // second card. That second card costs no second model call: runDraft
  // serves it straight out of answerCacheRef.
  //
  // No `meta` argument: a manual entry has no speaker to attribute, so
  // addQuestion runs with its default `{}` — the entry gets
  // `speakerTag: null, provisional: false`, exactly like a tab/system
  // detection.
  const addManualQuestion = useCallback(
    (text) => {
      const { ok, question } = normalizeManualQuestion(text);
      if (!ok) return false;
      lastQNormRef.current = normalizeQuestion(question);
      addQuestion(question, null, autoDraftRef.current);
      return true;
    },
    [addQuestion, lastQNormRef, autoDraftRef],
  );

  // AC-P4.1: decide locally first — zero network — and only fall back to a
  // remote confirm when the heuristic genuinely missed (AC-P1.3). Replaces
  // the old inline detectQuestion + MIN_WORDS_FOR_LLM pre-filter, which is
  // now localDetection.js's own job (the SAME primitives, reused, not a
  // second heuristic — see that module's own comment).
  //
  // `norm === lastQNormRef.current` alone used to be enough to dedupe a
  // back-to-back repeat (AC-M1.6.3's original guard). It still is, UNLESS
  // the entry it would be deduping against is itself still "loading": two
  // genuinely separate utterances that happen to clean to the same question
  // (an interviewer re-asking mid-draft, "So, tell me about...") must each
  // get their own draft rather than the second silently vanishing while the
  // first is still being answered — AC-P4.4 pins this on the streaming
  // client directly. A prior entry already "done" (or "error") still gets
  // suppressed exactly as before.
  const acceptQuestion = useCallback(
    (question, type, meta) => {
      const norm = normalizeQuestion(question);
      if (norm === lastQNormRef.current) {
        const prior = [...questionsRef.current]
          .reverse()
          .find((q) => normalizeQuestion(q.question) === norm);
        if (prior && prior.status === "loading") {
          // Still being answered — a repeat right now is a fresh ask, not
          // noise; fall through and give it its own card/draft.
        } else {
          // D8: a real, detected question that ends here with NO card and,
          // before this, no event either — indistinguishable in the log
          // from a question the pipeline never heard at all. This is the
          // back-to-back dedupe guard firing, not localDetection or
          // confirmQuestion rejecting it, so it gets its own reason.
          logEvent("question.rejected", { utterance: question, reason: "duplicate" });
          return;
        }
      }
      lastQNormRef.current = norm;
      addQuestion(question, type, autoDraftRef.current, meta);
    },
    [addQuestion, logEvent, lastQNormRef, questionsRef, autoDraftRef],
  );

  // Confirm a completed interviewer utterance is a question, then queue it.
  // AC-M1.6.3/AC-P4.1: the ONE path either source funnels through —
  // evaluateUtterance -> localDetection (or confirmQuestion when it misses)
  // -> addQuestion -> runDraft -> draftAnswerStreaming — unchanged by `meta`,
  // which merely rides along to addQuestion for the in-person case
  // (AC-M1.3.5). The tab/system call site (useLiveSession.js's `start`, in
  // its onTranscript callback) still calls this with a bare string, so `meta`
  // defaults to `{}` there exactly as before this parameter existed.
  const evaluateUtterance = useCallback(
    async (utterance, meta = {}) => {
      if (!utterance) return;

      const local = localDetection(utterance);
      if (local.decided) {
        acceptQuestion(local.question, local.type, meta);
        return;
      }

      // AC-P1.2/AC-P1.3: the heuristic missed it — worth a remote confirm
      // only when the utterance is long enough that the LLM has a real
      // chance of catching an indirect ask (today's exact pre-filter).
      if (!remoteConfirmNeeded({ decided: local.decided, utterance })) {
        // AC-Q6.11: exactly one event for an utterance that never becomes a
        // card — "too short to bother the LLM with" is itself the answer to
        // "why didn't it hear that question".
        logEvent("question.rejected", { utterance, reason: "too short" });
        return;
      }

      let result;
      try {
        result = await confirmQuestion({ utterance, context: buildContext() });
      } catch {
        // LLM unavailable and the heuristic already missed this one —
        // nothing left to fall back to.
        logEvent("question.rejected", { utterance, reason: "confirm unavailable" });
        return;
      }
      if (!result.isQuestion) {
        logEvent("question.rejected", { utterance, reason: "not a question" });
        return;
      }

      const question = (result.question || utterance).trim();
      acceptQuestion(question, result.type, meta);
    },
    [buildContext, acceptQuestion, logEvent],
  );

  // AC-M1.4.9/10: the in-person source's OWN question-evaluation trigger —
  // CopilotSession's `onUtterance` callback and its `evaluate` flag, never
  // `speaker === "them"` and never the display label. Gating on either of
  // those would reintroduce v1's exact silent-deafness bug (see
  // speakerIdentity.js's header comment): a voice provisionally labelled
  // "You" while identity is still unsettled must still be evaluated.
  //
  // `evaluate` already reflects THIS utterance's own evidence — session.js
  // folds it into the identity instance (observe()) and fires
  // onSpeakerIdentity BEFORE onUtterance for the same utterance (see
  // _emitUtterance in session.js) — so `sessionRef.current.speakerSnapshot()`
  // read synchronously here is exactly the state the AC means by
  // "CURRENTLY the argmax" (AC-M1.3.5), not a stale snapshot from before
  // this utterance existed.
  const handleUtterance = useCallback(
    ({ speakerTag, text, evaluate }) => {
      if (!evaluate) {
        // D8: this is the silent-deafness scenario itself — an utterance
        // that never even reaches localDetection/confirmQuestion because
        // speaker identity currently attributes this voice to the
        // candidate, not the interviewer (AC-M1.4.9's `evaluate` gate,
        // above). Before this, NOTHING was recorded here: no card, no log
        // entry — a session that suppressed every real question this way
        // looked, in its own downloaded log, identical to one that
        // correctly heard no questions at all. That is exactly the "why
        // didn't it act" question this log exists to answer.
        logEvent("question.rejected", { utterance: text, speakerTag, reason: "speaker identity suppressed" });
        return;
      }
      const snap = sessionRef.current?.speakerSnapshot() || defaultSpeakerSnapshot;
      // AC-M1.3.5: provisional exactly when this utterance came from the
      // tag identity currently presumes IS the user, but confidence has not
      // (yet, or ever, if never confirmed) reached "high" and no manual
      // override is in force. Once either of those becomes true,
      // `shouldEvaluateAsQuestion` would have returned `evaluate: false` for
      // this same tag — so provisional and evaluated-at-all are mutually
      // exclusive for the resolved user's own tag, by construction.
      const provisional =
        snap.userTag !== null &&
        speakerTag === snap.userTag &&
        snap.confidence !== "high" &&
        !snap.overridden;
      evaluateUtterance(text, { speakerTag, provisional });
    },
    [evaluateUtterance, logEvent, sessionRef, defaultSpeakerSnapshot],
  );

  // Only the three the outside world actually drives: `addManualQuestion`
  // (CopilotClient's ManualQuestion submit, via useLiveSession.js's return)
  // and the two triggers `start()`'s CopilotSession callbacks hold —
  // `handleUtterance` for in-person, `evaluateUtterance` for the tab/system
  // pendingRef assembly. `addQuestion` and `acceptQuestion` stay internal for
  // the reason useLiveSession.js's own return comment gives about its
  // remaining locals: a public surface nothing uses just invites a future
  // caller to reach past the detection half of this pipeline and construct
  // cards directly, which is precisely the dedupe/logging behaviour that
  // lives in `acceptQuestion`.
  return { addManualQuestion, evaluateUtterance, handleUtterance };
}
