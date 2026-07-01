"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { CopilotSession } from "@/lib/copilot/session";
import { detectQuestion, normalizeQuestion } from "@/lib/copilot/questions";
import { draftAnswer } from "@/lib/copilot/answerClient";
import TranscriptView from "./TranscriptView";
import QuestionFeed from "./QuestionFeed";

const CONTEXT_TURNS = 12;

function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Phase 3: detect questions in the interviewer's speech (heuristic) and let the
// candidate draft talking-point answers on demand.
export default function CopilotClient() {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker, text, at }
  const [interims, setInterims] = useState({ them: "", you: "" });
  const [questions, setQuestions] = useState([]); // { id, question, at, reason, status, points, type, error }
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(0);
  const [showConsent, setShowConsent] = useState(true);

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  const qIdRef = useRef(0);
  const recentRef = useRef([]); // rolling [{ speaker, text }] for answer context
  const lastQNormRef = useRef(""); // dedupe back-to-back identical detections
  const questionsRef = useRef([]);

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

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

  const handleFinal = useCallback((speaker, text) => {
    // Keep a rolling window of turns for answer context.
    recentRef.current = [...recentRef.current, { speaker, text }].slice(-CONTEXT_TURNS * 2);

    setFinals((prev) => [
      ...prev,
      { id: (idRef.current += 1), speaker, text, at: Date.now() },
    ]);

    // Only the interviewer asks questions we care about.
    if (speaker !== "them") return;
    const hit = detectQuestion(text);
    if (!hit.isQuestion) return;
    const norm = normalizeQuestion(hit.question);
    if (norm === lastQNormRef.current) return; // overlapping finals -> one question
    lastQNormRef.current = norm;
    setQuestions((prev) => [
      ...prev,
      {
        id: (qIdRef.current += 1),
        question: hit.question,
        at: Date.now(),
        reason: hit.reason,
        status: "idle",
        points: null,
        type: null,
        error: "",
      },
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
    lastQNormRef.current = "";
    setStatus("connecting");
    try {
      const session = new CopilotSession({
        withMic: true,
        onStatus: (s) => {
          setStatus(s);
          if (s === "live") setStartedAt((prev) => prev || Date.now());
        },
        onError: (err) => setWarning(err.message),
        onTranscript: ({ speaker, transcript, isFinal }) => {
          if (isFinal) {
            handleFinal(speaker, transcript);
            setInterims((prev) => ({ ...prev, [speaker]: "" }));
          } else {
            setInterims((prev) => ({ ...prev, [speaker]: transcript }));
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
  }, [stop, handleFinal]);

  const buildContext = useCallback(
    () =>
      recentRef.current
        .slice(-CONTEXT_TURNS)
        .map((t) => `${t.speaker === "them" ? "Them" : "You"}: ${t.text}`)
        .join("\n"),
    [],
  );

  const onDraft = useCallback(
    async (id) => {
      const q = questionsRef.current.find((item) => item.id === id);
      if (!q) return;
      setQuestions((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "loading", error: "" } : item,
        ),
      );
      try {
        const { points, type } = await draftAnswer({
          question: q.question,
          context: buildContext(),
        });
        setQuestions((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: "done", points, type } : item,
          ),
        );
      } catch (err) {
        setQuestions((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: "error", error: err?.message || "Failed to draft." }
              : item,
          ),
        );
      }
    },
    [buildContext],
  );

  const clearTranscript = useCallback(() => {
    setFinals([]);
    setInterims({ them: "", you: "" });
    setQuestions([]);
    recentRef.current = [];
    lastQNormRef.current = "";
  }, []);

  const copyTranscript = useCallback(() => {
    const text = finals
      .map((l) => `${l.speaker === "them" ? "Them" : "You"}: ${l.text}`)
      .join("\n");
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  }, [finals]);

  const elapsed = startedAt ? now - startedAt : 0;

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto", p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>
        Interview Copilot
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        Share the meeting tab (with &quot;Share tab audio&quot; enabled) and allow
        your mic. Both sides of the call are transcribed live; the interviewer&apos;s
        questions are detected on the right, where you can draft talking points.
        Chrome or Edge only.
      </Typography>

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
          onClick={clearTranscript}
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
    </Box>
  );
}

function StatusPill({ status }) {
  const map = {
    idle: { label: "Idle", color: "var(--text-muted)" },
    connecting: { label: "Connecting…", color: "var(--warning)" },
    live: { label: "● Live", color: "var(--success)" },
    error: { label: "Error", color: "var(--danger)" },
  };
  const { label, color } = map[status] || map.idle;
  return (
    <Typography variant="body2" sx={{ color, fontWeight: 600 }}>
      {label}
    </Typography>
  );
}
