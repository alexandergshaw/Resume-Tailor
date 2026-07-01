"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { CopilotSession } from "@/lib/copilot/session";
import TranscriptView from "./TranscriptView";

function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Phase 2: a polished live transcript — auto-scrolling, speaker-grouped, with
// per-turn timestamps, an elapsed clock, copy/clear controls, and a recording
// consent notice.
export default function CopilotClient() {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker, text, at }
  const [interims, setInterims] = useState({ them: "", you: "" });
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(0);
  const [showConsent, setShowConsent] = useState(true);

  const sessionRef = useRef(null);
  const idRef = useRef(0);

  const live = status === "live" || status === "connecting";

  // Tick the elapsed clock once a second while a session is running.
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

  const start = useCallback(async () => {
    setError("");
    setWarning("");
    setFinals([]);
    setInterims({ them: "", you: "" });
    setStartedAt(null);
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
            setFinals((prev) => [
              ...prev,
              { id: (idRef.current += 1), speaker, text: transcript, at: Date.now() },
            ]);
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
  }, [stop]);

  const clearTranscript = useCallback(() => {
    setFinals([]);
    setInterims({ them: "", you: "" });
  }, []);

  const copyTranscript = useCallback(() => {
    const text = finals
      .map((l) => `${l.speaker === "them" ? "Them" : "You"}: ${l.text}`)
      .join("\n");
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  }, [finals]);

  const elapsed = startedAt ? now - startedAt : 0;

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>
        Interview Copilot
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        Share the meeting tab (with &quot;Share tab audio&quot; enabled) and allow
        your mic. Both sides of the call are transcribed live and labeled. Chrome
        or Edge only.
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
          disabled={finals.length === 0}
        >
          Clear
        </Button>
      </Stack>

      <TranscriptView finals={finals} interims={interims} startedAt={startedAt} />
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
