"use client";

import { useCallback, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { CopilotSession } from "@/lib/copilot/session";

// Phase 1: capture BOTH sides of the call — the interviewer (shared tab audio)
// and you (microphone) — as two independent Deepgram streams, so every line is
// labeled with who said it without any diarization.
export default function CopilotClient() {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker, text }
  const [interims, setInterims] = useState({ them: "", you: "" });

  const sessionRef = useRef(null);
  const idRef = useRef(0);

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
    setStatus("connecting");
    try {
      const session = new CopilotSession({
        withMic: true,
        onStatus: (s) => setStatus(s),
        onError: (err) => {
          // Session surfaces mic-optional problems as warnings; a hard capture
          // failure rejects start() below and lands in the catch instead.
          setWarning(err.message);
        },
        onTranscript: ({ speaker, transcript, isFinal }) => {
          if (isFinal) {
            setFinals((prev) => [
              ...prev,
              { id: (idRef.current += 1), speaker, text: transcript },
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

  const live = status === "live" || status === "connecting";
  const hasContent =
    finals.length > 0 || interims.them || interims.you;

  return (
    <Box sx={{ maxWidth: 820, mx: "auto", p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>
        Interview Copilot
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        Share the meeting tab (with &quot;Share tab audio&quot; enabled) and allow
        your mic. Both sides of the call are transcribed live and labeled.
        Chrome or Edge only.
      </Typography>

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

      <Stack direction="row" spacing={1.5} sx={{ mb: 2, alignItems: "center" }}>
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
      </Stack>

      <Box
        sx={{
          minHeight: 320,
          p: 2,
          borderRadius: 2,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        {!hasContent ? (
          <Typography sx={{ color: "var(--text-muted)" }}>
            Transcript will appear here…
          </Typography>
        ) : (
          <Stack spacing={1}>
            {finals.map((line) => (
              <TranscriptLine
                key={line.id}
                speaker={line.speaker}
                text={line.text}
              />
            ))}
            {interims.them ? (
              <TranscriptLine speaker="them" text={interims.them} interim />
            ) : null}
            {interims.you ? (
              <TranscriptLine speaker="you" text={interims.you} interim />
            ) : null}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

function TranscriptLine({ speaker, text, interim = false }) {
  const isThem = speaker === "them";
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
      <Chip
        size="small"
        label={isThem ? "Them" : "You"}
        sx={{
          height: 20,
          fontSize: 11,
          fontWeight: 700,
          color: isThem ? "var(--accent-contrast)" : "var(--text-secondary)",
          background: isThem ? "var(--accent)" : "var(--bg-soft)",
          border: isThem ? "none" : "1px solid var(--border)",
        }}
      />
      <Typography
        sx={{
          color: interim ? "var(--text-muted)" : "var(--text-primary)",
          fontStyle: interim ? "italic" : "normal",
        }}
      >
        {text}
      </Typography>
    </Stack>
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
