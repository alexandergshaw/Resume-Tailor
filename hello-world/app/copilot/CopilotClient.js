"use client";

import { useCallback, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { captureTabAudio, PcmPipeline } from "@/lib/copilot/capture";
import { DeepgramStream } from "@/lib/copilot/deepgram";

// Phase 0 spike: share a browser tab, stream its audio to Deepgram, and print
// the live transcript. No question detection or answers yet — this proves the
// two riskiest pieces (tab-audio capture + streaming STT) end to end.
export default function CopilotClient() {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]);
  const [interim, setInterim] = useState("");

  const streamRef = useRef(null);
  const pipelineRef = useRef(null);
  const dgRef = useRef(null);

  const stop = useCallback(async () => {
    if (dgRef.current) {
      dgRef.current.close();
      dgRef.current = null;
    }
    if (pipelineRef.current) {
      await pipelineRef.current.stop();
      pipelineRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setInterim("");
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    setError("");
    setFinals([]);
    setInterim("");
    setStatus("connecting");
    try {
      const stream = await captureTabAudio();
      streamRef.current = stream;
      // If the user hits the browser's native "Stop sharing", tear down cleanly.
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        stop();
      });

      const dg = new DeepgramStream({
        speaker: "them",
        onStatus: (s) => {
          if (s === "open") setStatus("live");
        },
        onError: (err) => {
          setError(err.message);
          setStatus("error");
        },
        onTranscript: ({ transcript, isFinal }) => {
          if (isFinal) {
            setFinals((prev) => [...prev, transcript]);
            setInterim("");
          } else {
            setInterim(transcript);
          }
        },
      });
      dgRef.current = dg;
      await dg.connect();

      const pipeline = new PcmPipeline();
      pipelineRef.current = pipeline;
      await pipeline.start(stream, (chunk) => dg.send(chunk));
    } catch (err) {
      setError(err?.message || "Could not start capture.");
      setStatus("error");
      await stop();
    }
  }, [stop]);

  const live = status === "live" || status === "connecting";

  return (
    <Box sx={{ maxWidth: 820, mx: "auto", p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>
        Interview Copilot
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        Phase 0 spike — share a browser tab with &quot;Share tab audio&quot; enabled
        and watch it transcribe live. Chrome or Edge only.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1.5} sx={{ mb: 2, alignItems: "center" }}>
        {live ? (
          <Button variant="outlined" color="error" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="contained" onClick={start}>
            Share a tab &amp; transcribe
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
        {finals.length === 0 && !interim ? (
          <Typography sx={{ color: "var(--text-muted)" }}>
            Transcript will appear here…
          </Typography>
        ) : (
          <>
            {finals.map((line, i) => (
              <Typography key={i} sx={{ mb: 1, color: "var(--text-primary)" }}>
                {line}
              </Typography>
            ))}
            {interim ? (
              <Typography
                sx={{ color: "var(--text-muted)", fontStyle: "italic" }}
              >
                {interim}
              </Typography>
            ) : null}
          </>
        )}
      </Box>
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
