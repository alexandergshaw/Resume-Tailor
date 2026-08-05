"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { CopilotSession } from "@/lib/copilot/session";
import { detectQuestion, normalizeQuestion } from "@/lib/copilot/questions";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";
import { fmtClock } from "@/lib/copilot/clock";
import TabHeader from "@/app/components/TabHeader";
import TranscriptView from "./TranscriptView";
import QuestionFeed from "./QuestionFeed";
import PrepContext from "./PrepContext";
import StatusPill from "./StatusPill";
import PracticeClient from "./practice/PracticeClient";
import { usePrepContext } from "./usePrepContext";

const CONTEXT_TURNS = 12;
const MIN_WORDS_FOR_LLM = 4;
const SOURCE_STORAGE_KEY = "copilot-audio-source";

// Phase 4: assemble the interviewer's speech into complete utterances (on
// Deepgram's speech_final endpoint), confirm/normalize questions with an LLM
// (heuristic pre-filter avoids calling it on trivial fragments), and auto-draft
// talking points as soon as a question is detected.
export default function CopilotClient() {
  const [mode, setMode] = useState("live"); // "live" | "practice"
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker, text, at }
  const [interims, setInterims] = useState({ them: "", you: "" });
  const [questions, setQuestions] = useState([]);
  const [autoDraft, setAutoDraft] = useState(true);
  const [profile, setProfileRaw] = usePrepContext();
  const [source, setSource] = useState("tab"); // "tab" | "system" — the interviewer's audio source
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(0);
  const [showConsent, setShowConsent] = useState(true);

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  const qIdRef = useRef(0);
  const recentRef = useRef([]); // rolling [{ speaker, text }] for answer context
  const pendingRef = useRef([]); // interviewer segments awaiting speech_final
  const lastQNormRef = useRef(""); // dedupe back-to-back identical questions
  const questionsRef = useRef([]);
  const autoDraftRef = useRef(true);
  const profileRef = useRef("");
  const answerCacheRef = useRef(new Map()); // normalized question -> { points, type }

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  useEffect(() => {
    autoDraftRef.current = autoDraft;
  }, [autoDraft]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Prep context (seed-from-storage/fallback/persist) lives in
  // usePrepContext — this wraps its setter to also drop the answer cache:
  // prior answers were grounded in the old background, so they must not
  // survive an edit to it (that cache-clearing logic is specific to the
  // live session's auto-draft flow, not something the shared hook should
  // know about).
  const onProfileChange = useCallback(
    (val) => {
      answerCacheRef.current.clear();
      setProfileRaw(val);
    },
    [setProfileRaw],
  );

  // Seed the interviewer-audio-source choice from localStorage, wrapped in
  // try/catch like the prep-context read above. A missing or unrecognized
  // value just leaves the "tab" default from useState in place.
  useEffect(() => {
    let stored = null;
    try {
      stored = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === "tab" || stored === "system") setSource(stored);
  }, []);

  const onSourceChange = useCallback((val) => {
    if (val !== "tab" && val !== "system") return;
    setSource(val);
    try {
      window.localStorage.setItem(SOURCE_STORAGE_KEY, val);
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

  const live = status === "live" || status === "connecting";

  useEffect(() => {
    if (!live || !startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live, startedAt]);

  const stop = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }
    setInterims({ them: "", you: "" });
    setStatus("idle");
  }, []);

  // Unmounting (e.g. switching main tabs) must not leave the screen-share or
  // mic running — stop whatever session is active on the way out.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, []);

  // MUI's exclusive ToggleButtonGroup reports `null` when the currently
  // selected button is clicked again — ignore that so the mode can never end
  // up unset. Leaving live mode must not strand a running session: `live`
  // (derived from `status`) is false once the session has errored, but an
  // errored CopilotSession can still be holding the screen-share and mic
  // tracks, so key the teardown off `sessionRef.current` existing, not off
  // `status`.
  const onModeChange = useCallback(
    (val) => {
      if (val !== "live" && val !== "practice") return;
      if (val === "practice" && sessionRef.current) stop();
      setMode(val);
    },
    [stop],
  );

  const buildContext = useCallback(
    () =>
      recentRef.current
        .slice(-CONTEXT_TURNS)
        .map((t) => `${t.speaker === "them" ? "Them" : "You"}: ${t.text}`)
        .join("\n"),
    [],
  );

  const runDraft = useCallback(
    async (id, question, { force = false } = {}) => {
      const norm = normalizeQuestion(question);
      // Reuse a prior answer for the same (normalized) question — interviewers
      // often circle back or rephrase — unless the user explicitly redrafts.
      if (!force) {
        const cached = answerCacheRef.current.get(norm);
        if (cached) {
          setQuestions((prev) =>
            prev.map((it) =>
              it.id === id
                ? {
                    ...it,
                    status: "done",
                    points: cached.points,
                    type: it.type || cached.type,
                    cached: true,
                  }
                : it,
            ),
          );
          return;
        }
      }
      setQuestions((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, status: "loading", error: "", cached: false } : it,
        ),
      );
      try {
        const { points, type } = await draftAnswer({
          question,
          context: buildContext(),
          profile: profileRef.current,
        });
        answerCacheRef.current.set(norm, { points, type });
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id ? { ...it, status: "done", points, type: it.type || type } : it,
          ),
        );
      } catch (err) {
        setQuestions((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: "error", error: err?.message || "Failed to draft." }
              : it,
          ),
        );
      }
    },
    [buildContext],
  );

  const addQuestion = useCallback(
    (question, type, auto) => {
      const id = (qIdRef.current += 1);
      setQuestions((prev) => [
        ...prev,
        {
          id,
          question,
          at: Date.now(),
          status: auto ? "loading" : "idle",
          points: null,
          type: type || null,
          error: "",
        },
      ]);
      if (auto) runDraft(id, question);
    },
    [runDraft],
  );

  // Confirm a completed interviewer utterance is a question, then queue it.
  const evaluateUtterance = useCallback(
    async (utterance) => {
      if (!utterance) return;
      const quick = detectQuestion(utterance);
      const words = utterance.split(/\s+/).filter(Boolean).length;
      // Pre-filter: skip short fragments that aren't obviously questions.
      if (!quick.isQuestion && words < MIN_WORDS_FOR_LLM) return;

      let result;
      try {
        result = await confirmQuestion({ utterance, context: buildContext() });
      } catch {
        // LLM unavailable — fall back to the heuristic (only if it fired).
        if (!quick.isQuestion) return;
        result = { isQuestion: true, question: quick.question, type: "general" };
      }
      if (!result.isQuestion) return;

      const question = (result.question || utterance).trim();
      const norm = normalizeQuestion(question);
      if (norm === lastQNormRef.current) return;
      lastQNormRef.current = norm;
      addQuestion(question, result.type, autoDraftRef.current);
    },
    [buildContext, addQuestion],
  );

  const appendFinal = useCallback((speaker, text) => {
    recentRef.current = [...recentRef.current, { speaker, text }].slice(-CONTEXT_TURNS * 2);
    setFinals((prev) => [
      ...prev,
      { id: (idRef.current += 1), speaker, text, at: Date.now() },
    ]);
  }, []);

  const start = useCallback(async () => {
    setError("");
    setWarning("");
    setFinals([]);
    setInterims({ them: "", you: "" });
    setQuestions([]);
    setStartedAt(null);
    recentRef.current = [];
    pendingRef.current = [];
    lastQNormRef.current = "";
    answerCacheRef.current.clear();
    setStatus("connecting");
    try {
      const session = new CopilotSession({
        withMic: true,
        source,
        onStatus: (s) => {
          setStatus(s);
          if (s === "live") setStartedAt((prev) => prev || Date.now());
        },
        onError: (err) => setWarning(err.message),
        onTranscript: ({ speaker, transcript, isFinal, speechFinal }) => {
          if (!isFinal) {
            setInterims((prev) => ({ ...prev, [speaker]: transcript }));
            return;
          }
          setInterims((prev) => ({ ...prev, [speaker]: "" }));
          appendFinal(speaker, transcript);

          // Assemble the interviewer's segments into one utterance and evaluate
          // it when Deepgram signals the end of speech (~300ms of silence).
          if (speaker === "them") {
            pendingRef.current.push(transcript);
            if (speechFinal) {
              const utterance = pendingRef.current
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
              pendingRef.current = [];
              evaluateUtterance(utterance);
            }
          }
        },
      });
      sessionRef.current = session;
      await session.start();
    } catch (err) {
      setError(err?.message || "Could not start capture.");
      setStatus("error");
      await stop();
    }
  }, [stop, appendFinal, evaluateUtterance, source]);

  const onDraft = useCallback(
    (id) => {
      const q = questionsRef.current.find((it) => it.id === id);
      // "Redraft" (already answered) forces a fresh generation; the first draft
      // may reuse a cached answer.
      if (q) runDraft(id, q.question, { force: q.status === "done" });
    },
    [runDraft],
  );

  const clearAll = useCallback(() => {
    setFinals([]);
    setInterims({ them: "", you: "" });
    setQuestions([]);
    recentRef.current = [];
    pendingRef.current = [];
    lastQNormRef.current = "";
  }, []);

  const copyTranscript = useCallback(() => {
    const text = finals
      .map((l) => `${l.speaker === "them" ? "Them" : "You"}: ${l.text}`)
      .join("\n");
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  }, [finals]);

  const elapsed = startedAt ? now - startedAt : 0;

  // The tab option keeps today's wording verbatim; the system option needs
  // different share-dialog instructions plus a note on when to reach for it.
  const shareInstructions =
    source === "system"
      ? 'Share your Entire Screen (with "Share system audio" enabled) and allow your mic — use this when the interview is running in a desktop app (Zoom, Teams, etc.) rather than a browser tab.'
      : 'Share the meeting tab (with "Share tab audio" enabled) and allow your mic.';

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto", p: 3 }}>
      <TabHeader
        title="Interview copilot"
        description={
          mode === "practice"
            ? // "nothing else is recorded or shared" was false: on the Gemini
              // engine, the answer transcript, posting details, and prep
              // context all go to Google for the critique. The detailed
              // notice below (PracticeClient) states exactly what leaves on
              // the current engine — this one-liner defers to it rather
              // than making its own (previously false) blanket claim.
              "Practice speaking out loud with your camera and mic — see the notice below for what's sent to Deepgram or Gemini."
            : "Live transcription, question detection, and suggested answers during interviews."
        }
      />

      <Stack
        direction="row"
        spacing={1.25}
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          Mode:
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          disabled={live}
          onChange={(_e, val) => onModeChange(val)}
        >
          <ToggleButton value="live" sx={{ textTransform: "none", px: 1.5 }}>
            Live interview
          </ToggleButton>
          <ToggleButton value="practice" sx={{ textTransform: "none", px: 1.5 }}>
            Practice
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {mode === "practice" ? (
        <PracticeClient />
      ) : (
        <>
          <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
            {shareInstructions} Both sides of the call are transcribed live; the
            interviewer&apos;s questions are detected on the right and answered
            automatically. Chrome or Edge only.
          </Typography>

          <Stack
            direction="row"
            spacing={1.25}
            sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
          >
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Interviewer audio:
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={source}
              disabled={live}
              onChange={(_e, val) => onSourceChange(val)}
            >
              <ToggleButton value="tab" sx={{ textTransform: "none", px: 1.5 }}>
                Browser tab
              </ToggleButton>
              <ToggleButton value="system" sx={{ textTransform: "none", px: 1.5 }}>
                System audio (speakers)
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {showConsent ? (
            <Alert severity="info" sx={{ mb: 2 }} onClose={() => setShowConsent(false)}>
              Recording notice: audio is streamed to Deepgram for transcription. Make
              sure everyone on the call consents before you start — some regions
              require all-party consent.
            </Alert>
          ) : null}

          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          {warning ? (
            <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setWarning("")}>
              {warning}
            </Alert>
          ) : null}

          <PrepContext value={profile} onChange={onProfileChange} />

          <Stack
            direction="row"
            spacing={1.5}
            sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
          >
            {live ? (
              <Button variant="outlined" color="error" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button variant="contained" onClick={start}>
                Start session
              </Button>
            )}
            <StatusPill status={status} />
            {startedAt ? (
              <Typography
                variant="body2"
                sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtClock(elapsed)}
              </Typography>
            ) : null}
            <Box sx={{ flex: 1 }} />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={autoDraft}
                  onChange={(e) => setAutoDraft(e.target.checked)}
                />
              }
              label={
                <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
                  Auto-draft
                </Typography>
              }
              sx={{ mr: 0.5 }}
            />
            <Button
              size="small"
              variant="text"
              onClick={copyTranscript}
              disabled={finals.length === 0}
            >
              Copy
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={clearAll}
              disabled={finals.length === 0 && questions.length === 0}
            >
              Clear
            </Button>
          </Stack>

          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{ alignItems: "stretch" }}
          >
            <TranscriptView finals={finals} interims={interims} startedAt={startedAt} />
            <QuestionFeed questions={questions} onDraft={onDraft} />
          </Stack>
        </>
      )}
    </Box>
  );
}
