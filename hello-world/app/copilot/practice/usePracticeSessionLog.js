"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSessionLog } from "@/lib/copilot/sessionLog";
import { downloadSessionLogArchive } from "@/lib/copilot/sessionLogArchive";

// AC-Q7: practice mode's half of "download a log of this session" — the
// wiring, not the recorder (lib/copilot/sessionLog.js) or the archive
// builder (lib/copilot/sessionLogArchive.js), both reused exactly and
// unmodified. See useLiveSession.log.test.js / (a concurrent wave's)
// useLiveSession.js for live mode's counterpart; this is the practice-mode
// equivalent, shaped differently because practice mode's own pipeline is
// already split across several hooks (usePracticeCaptureSession for
// capture/transcript, usePracticeQuestions for the drill question,
// usePracticeAnswer for recording/metrics/critique) rather than one, and
// none of those three are in this feature's file list. Rather than thread a
// logger callback through all three (touching files this feature does not
// own), this hook OBSERVES the same reactive values PracticeClient.js
// already destructures from them and turns each meaningful transition into
// exactly one event — the log is built from the composing component's own
// view of the session, the same vantage point the download button lives at.
//
// Every write goes through `event()` below, which is a thin, always-present
// call into sessionLog.js's own `event()` — already documented there to
// never throw (AC-Q1.5) — so nothing in this hook can interrupt a drill in
// progress (AC-Q7.6): the worst a bad input can do is fail to appear in the
// log, never break Start answering, Done, or the question flow.
export function usePracticeSessionLog({
  start,
  posting,
  interviewType,
  currentQuestionText,
  questionError,
  finals,
  // AC-Q7.9: usePracticeCaptureSession's own per-session identity (bumped
  // synchronously as the first thing ITS start() does, before any awaited
  // teardown). See the finals effect below for why this hook compares
  // against it instead of trusting `finals`' length alone.
  activeSessionId,
  captureError,
  captureWarning,
  answering,
  answerMetrics,
  critique,
  critiqueStatus,
  critiqueError,
}) {
  const logRef = useRef(null);
  // AC-Q7.5: reactive twin of "does logRef hold anything" — the log itself
  // lives on a ref (event() below writes through it without forcing a
  // re-render on every single entry), but the download button's disabled
  // state has to be real React state to update the screen at all. Flips
  // true once, at the first startSession, and never back to false — once a
  // session has ever run this tab, there is something to download for the
  // rest of the page's life (AC-Q7.4's "works after stopped" too).
  const [hasLog, setHasLog] = useState(false);

  // Mirrors currentQuestionText for the recording-start/stop event below,
  // which must not itself become a reason those effects re-run (only
  // `answering` flipping should trigger them) — same ref-mirror idiom
  // postingRef/currentQuestionRef already use elsewhere in this feature.
  const questionTextRef = useRef("");
  useEffect(() => {
    questionTextRef.current = currentQuestionText || "";
  }, [currentQuestionText]);

  // Per-session dedupe/position trackers — see onStart's own reset of all of
  // these for why a plain "log the delta since last render" isn't enough by
  // itself. AC-Q7.9: `loggedFinalsCountRef` is a walked-position cursor
  // ONLY — it advances past every entry it has looked at, logged or not —
  // never the sole judge of whether an entry belongs to THIS session; the
  // finals effect below pairs it with each entry's own stamped `sessionId`
  // for that judgment, precisely because this counter's own reset (here in
  // onStart) is not guaranteed to land in the same render as `finals`
  // itself resetting (usePracticeCaptureSession.js's start(), across an
  // await — see that effect's own comment).
  const loggedFinalsCountRef = useRef(0);
  const lastQuestionRef = useRef("");
  const lastQuestionErrorRef = useRef("");
  const lastCaptureErrorRef = useRef("");
  const lastCaptureWarningRef = useRef("");
  const prevAnsweringRef = useRef(false);
  const loggedMetricsRef = useRef(null);
  const loggedCritiqueRef = useRef(null);
  const lastCritiqueErrorRef = useRef("");

  // The one place every event actually reaches the log. Never throws (see
  // sessionLog.js's own `event()` contract) and is a silent no-op before
  // any session has started (logRef.current is null) — callers below never
  // have to guard on "is there a session" themselves.
  const event = useCallback((type, data) => {
    logRef.current?.event(type, data);
  }, []);

  // AC-Q7.1/AC-Q7.3/AC-Q7.6: `onStart` wraps the real `start` (passed in)
  // rather than exposing a bare "open the log" function PracticeClient
  // would have to wrap itself with its own useCallback. Opens a FRESH log
  // (AC-Q7.1: a second session's events must not follow the first into its
  // download — every per-session tracker below resets in the same breath as
  // the log itself), records the posting/interview type this press is
  // starting against by id and name ONLY — never the posting's own
  // `description`, never a résumé or cover letter (this hook is never
  // handed either; PracticeClient fetches those server-side precisely so
  // they never reach the browser at all) — and only then calls `start`,
  // inside the same try/catch, so a logging failure can never be the reason
  // Start practice itself doesn't run.
  const onStart = useCallback(() => {
    try {
      const log = createSessionLog({ mode: "practice", source: "practice", provider: "practice", startedAt: Date.now() });
      logRef.current = log;
      loggedFinalsCountRef.current = 0;
      lastQuestionRef.current = "";
      lastQuestionErrorRef.current = "";
      lastCaptureErrorRef.current = "";
      lastCaptureWarningRef.current = "";
      prevAnsweringRef.current = false;
      loggedMetricsRef.current = null;
      loggedCritiqueRef.current = null;
      lastCritiqueErrorRef.current = "";
      log.event("session.start", {
        posting: posting
          ? { id: posting.id ?? null, name: posting.title || posting.company || null }
          : null,
        interviewType: interviewType || null,
      });
      setHasLog(true);
    } catch {
      // Fall through to start() regardless.
    }
    if (typeof start === "function") start();
  }, [start, posting, interviewType]);

  const sessionLogSnapshot = useCallback(() => (logRef.current ? logRef.current.snapshot() : null), []);

  // AC-Q7.4: hands the CURRENT snapshot to sessionLogArchive.js's own
  // downloader exactly once. `logRef` is never cleared by stopping the
  // capture session (nothing in this hook's effects is wired to `status`),
  // so this works identically mid-session and after Stop. Declining to
  // download before any session ever ran (rather than throwing) is the same
  // choice useLiveSession.log.test.js documents as the implementer's call.
  const downloadLog = useCallback(async () => {
    const snap = sessionLogSnapshot();
    if (!snap) return;
    await downloadSessionLogArchive(snap);
  }, [sessionLogSnapshot]);

  // AC-Q7.2: each question served — every path that lands a new value in
  // `currentQuestionText` (the initial fetch inside start(), "Next
  // question", "Retry", and typing one's own question) funnels through the
  // same state usePracticeQuestions already exposes, so watching it here
  // covers all of them without this hook needing to know which path fired.
  useEffect(() => {
    if (!currentQuestionText || currentQuestionText === lastQuestionRef.current) return;
    lastQuestionRef.current = currentQuestionText;
    event("question.served", { question: currentQuestionText });
  }, [currentQuestionText, event]);

  useEffect(() => {
    if (!questionError) {
      lastQuestionErrorRef.current = "";
      return;
    }
    if (questionError === lastQuestionErrorRef.current) return;
    lastQuestionErrorRef.current = questionError;
    event("question.error", { message: questionError });
  }, [questionError, event]);

  // AC-Q7.2/AC-Q7.8/AC-Q7.9: each finalized transcript frame — `finals`
  // only ever grows (usePracticeCaptureSession appends one entry per
  // finalized turn) until the NEXT session resets it to `[]`. `finals`
  // itself and `loggedFinalsCountRef` are reset by two DIFFERENT code paths
  // (this hook's onStart above; usePracticeCaptureSession's start(), across
  // an `await` when a previous session is still being torn down — the
  // "press Start again without pressing Stop" path start()'s own comment
  // documents as supported) that are not guaranteed to land in the same
  // render. A stray final the OLD session's socket still delivers during
  // that window would otherwise land at an index this effect believes is
  // "new" (the counter having already been zeroed by onStart) while
  // `logRef.current` already points at the NEW log — silently attributing
  // the previous session's transcript to this one's download.
  //
  // The guard is `f.sessionId === activeSessionId`, not the loop index:
  // usePracticeCaptureSession stamps every entry with the identity of the
  // session that actually produced it (fixed at that session's own start(),
  // never re-read later), and exposes which identity is CURRENT. A frame
  // whose stamp doesn't match the current identity is walked past — the
  // counter still advances, so it is never reconsidered — but never
  // reaches `event()`, so it can never end up in ANY log, whichever
  // session's array it happens to still be sitting in when this runs.
  useEffect(() => {
    const list = Array.isArray(finals) ? finals : [];
    for (let i = loggedFinalsCountRef.current; i < list.length; i += 1) {
      const f = list[i];
      if (f?.sessionId !== activeSessionId) continue;
      event("transcript", { speaker: f?.speaker || "you", text: f?.text, isFinal: true });
    }
    loggedFinalsCountRef.current = list.length;
  }, [finals, activeSessionId, event]);

  // AC-Q7.2: "any error or warning the user was shown" — the capture
  // session's own hard error (PracticeSetup's error Alert) and soft warning
  // (its dismissible warning Alert).
  useEffect(() => {
    if (!captureError) {
      lastCaptureErrorRef.current = "";
      return;
    }
    if (captureError === lastCaptureErrorRef.current) return;
    lastCaptureErrorRef.current = captureError;
    event("session.error", { message: captureError });
  }, [captureError, event]);

  useEffect(() => {
    if (!captureWarning) {
      lastCaptureWarningRef.current = "";
      return;
    }
    if (captureWarning === lastCaptureWarningRef.current) return;
    lastCaptureWarningRef.current = captureWarning;
    event("session.warning", { message: captureWarning });
  }, [captureWarning, event]);

  // AC-Q7.2: when an answer recording starts and stops. `answering` is
  // true from "Start answering" through "Done" (usePracticeAnswer) —
  // exactly the recording window; the transition edges, not the level, are
  // what get logged, via prevAnsweringRef.
  useEffect(() => {
    if (answering && !prevAnsweringRef.current) {
      event("answer.recording.start", { question: questionTextRef.current });
    } else if (!answering && prevAnsweringRef.current) {
      event("answer.recording.stop", { question: questionTextRef.current });
    }
    prevAnsweringRef.current = answering;
  }, [answering, event]);

  // AC-Q7.2: the delivery metrics derived for an answer. `answerMetrics` is
  // a fresh object each time doneAnswer computes one (usePracticeAnswer.js)
  // and null between answers — comparing by reference (not just truthiness)
  // is what stops this from re-logging the SAME metrics object on an
  // unrelated re-render.
  useEffect(() => {
    if (!answerMetrics) {
      loggedMetricsRef.current = null;
      return;
    }
    if (answerMetrics === loggedMetricsRef.current) return;
    loggedMetricsRef.current = answerMetrics;
    event("answer.metrics", { metrics: answerMetrics });
  }, [answerMetrics, event]);

  // AC-Q7.2: the critique returned for an answer, and its failure.
  useEffect(() => {
    if (critiqueStatus !== "done" || !critique) {
      loggedCritiqueRef.current = null;
      return;
    }
    if (critique === loggedCritiqueRef.current) return;
    loggedCritiqueRef.current = critique;
    event("answer.critique", { critique });
  }, [critique, critiqueStatus, event]);

  useEffect(() => {
    if (critiqueStatus !== "error" || !critiqueError) {
      lastCritiqueErrorRef.current = "";
      return;
    }
    if (critiqueError === lastCritiqueErrorRef.current) return;
    lastCritiqueErrorRef.current = critiqueError;
    event("answer.critique.error", { message: critiqueError });
  }, [critiqueError, critiqueStatus, event]);

  return {
    hasLog,
    onStart,
    sessionLogSnapshot,
    downloadLog,
  };
}
