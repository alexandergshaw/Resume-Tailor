"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { CopilotSession } from "@/lib/copilot/session";
import { detectQuestion, normalizeQuestion } from "@/lib/copilot/questions";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";
import TabHeader from "@/app/components/TabHeader";
import TranscriptView from "./TranscriptView";
import QuestionFeed from "./QuestionFeed";
import PrepContext from "./PrepContext";

const CONTEXT_TURNS = 12;
const MIN_WORDS_FOR_LLM = 4;
const PREP_STORAGE_KEY = "copilot-prep-context";

function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Phase 4: assemble the interviewer's speech into complete utterances (on
// Deepgram's speech_final endpoint), confirm/normalize questions with an LLM
// (heuristic pre-filter avoids calling it on trivial fragments), and auto-draft
// talking points as soon as a question is detected.
export default function CopilotClient() {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker, text, at }
  const [interims, setInterims] = useState({ them: "", you: "" });
  const [questions, setQuestions] = useState([]);
  const [autoDraft, setAutoDraft] = useState(true);
  const [profile, setProfile] = useState("");
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

  // Seed prep context: prefer what's saved in this browser, otherwise fall back
  // to the user's saved "additional context" from the main app.
  useEffect(() => {
    let cancelled = false;
    let local = null;
    try {
      local = window.localStorage.getItem(PREP_STORAGE_KEY);
    } catch {
      local = null;
    }
    if (local) {
      setProfile(local);
      return undefined;
    }
    (async () => {
      try {
        const res = await fetch("/api/user-context");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.additionalContext) setProfile(json.additionalContext);
      } catch {
        // best effort — the field just stays empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onProfileChange = useCallback((val) => {
    setProfile(val);
    // Prior answers were grounded in the old background — drop them so future
    // drafts reflect the edit.
    answerCacheRef.current.clear();
    try {
      window.localStorage.setItem(PREP_STORAGE_KEY, val);
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
  }, [stop, appendFinal, evaluateUtterance]);

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

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto", p: 3 }}>
      <TabHeader
        title="Interview copilot"
        description="Live transcription, question detection, and suggested answers during interviews."
      />
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        Share the meeting tab (with &quot;Share tab audio&quot; enabled) and allow
        your mic. Both sides of the call are transcribed live; the interviewer&apos;s
        questions are detected on the right and answered automatically. Chrome or
        Edge only.
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
