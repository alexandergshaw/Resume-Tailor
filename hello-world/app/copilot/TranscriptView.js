"use client";

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// Formats ms-since-start as m:ss for the per-turn timestamp.
function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Scrolling transcript. Consecutive lines from the same speaker are grouped
// under one label + timestamp, interim (not-yet-final) text renders muted +
// italic, and the view auto-scrolls to the bottom — but only while the user is
// already near the bottom, so scrolling up to re-read isn't yanked back down.
export default function TranscriptView({ finals, interims, startedAt }) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [finals, interims]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const hasContent = finals.length > 0 || interims.them || interims.you;

  // Build a render list where each item knows whether it starts a new speaker
  // group (chip + timestamp shown) or continues the previous one.
  const rows = [];
  let prevSpeaker = null;
  for (const line of finals) {
    rows.push({
      ...line,
      groupStart: line.speaker !== prevSpeaker,
      interim: false,
    });
    prevSpeaker = line.speaker;
  }
  for (const speaker of ["them", "you"]) {
    if (interims[speaker]) {
      rows.push({
        id: `interim-${speaker}`,
        speaker,
        text: interims[speaker],
        at: null, // interim: timestamp appears once the turn is finalized
        groupStart: speaker !== prevSpeaker,
        interim: true,
      });
      prevSpeaker = speaker;
    }
  }

  return (
    <Box
      ref={scrollRef}
      onScroll={onScroll}
      sx={{
        flex: 1,
        minHeight: 340,
        maxHeight: "62vh",
        overflowY: "auto",
        p: 2,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      {!hasContent ? (
        <Typography sx={{ color: "var(--text-muted)" }}>
          Transcript will appear here once the session starts…
        </Typography>
      ) : (
        <Stack spacing={0.25}>
          {rows.map((row) => (
            <TranscriptRow key={row.id} row={row} startedAt={startedAt} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function TranscriptRow({ row, startedAt }) {
  const isThem = row.speaker === "them";
  return (
    <Box sx={{ pt: row.groupStart ? 1 : 0 }}>
      {row.groupStart ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", mb: 0.25 }}
        >
          <Chip
            size="small"
            label={isThem ? "Them" : "You"}
            sx={{
              height: 20,
              fontSize: 11,
              fontWeight: 700,
              color: isThem
                ? "var(--accent-contrast)"
                : "var(--text-secondary)",
              background: isThem ? "var(--accent)" : "var(--bg-soft)",
              border: isThem ? "none" : "1px solid var(--border)",
            }}
          />
          {startedAt && row.at ? (
            <Typography
              variant="caption"
              sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
            >
              {fmtElapsed(row.at - startedAt)}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
      <Typography
        sx={{
          pl: 0.25,
          color: row.interim ? "var(--text-muted)" : "var(--text-primary)",
          fontStyle: row.interim ? "italic" : "normal",
        }}
      >
        {row.text}
      </Typography>
    </Box>
  );
}
