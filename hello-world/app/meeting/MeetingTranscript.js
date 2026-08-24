"use client";

// Presentational only, per this feature's split: no fetching, no session
// state, no capture. Everything this component knows arrives as props —
// the finished list of final turns, whatever partial text is still being
// transcribed, and which capture source produced them. Wiring those props
// up to a live socket/session is someone else's file (app/meeting/use*.js),
// deliberately kept out of reach here.
//
// Modeled on app/copilot/TranscriptView.js, the interview copilot's own
// scrolling transcript, but simplified: this meeting has no diarization
// correction UI (that component's `onAssignUser` machinery exists only for
// the in-person interview flow's speaker-reassignment feature, which this
// surface has no equivalent of), and no page-scroll-vs-pane-scroll split
// (that split exists there to serve app/copilot/mobileSx.js's PHONE_PANE_SX,
// which is a copilot-specific layout contract this file has no reason to
// import). What carries over is the one property that actually matters for
// a live, fast-moving transcript: auto-follow the newest line while the
// reader hasn't scrolled away to re-read something earlier.

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { meetingSpeakerLabel } from "@/lib/meeting/insightContract";
import { speakerAttributionNotice } from "@/lib/meeting/meetingNotices";

// Inlined rather than imported from lib/copilot/answerStatus.js's own
// `visuallyHidden` export: that export is one small, stable object literal,
// and pulling it in would make this meeting-feature file depend on a
// copilot-feature module for a single style constant. Small and
// self-contained beats a cross-feature import here.
const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// The three routing values a turn's `speaker` field can carry, matching
// lib/meeting/insightContract.js's MEETING_LABELS keys exactly. Used only to
// know which interim slots to look for below — never as a substitute for
// `meetingSpeakerLabel`, which stays the ONE place a routing value becomes
// display text.
const SPEAKER_KEYS = ["you", "them", "room"];

function formatClockTime(at) {
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// One final turn's row. `speaker` is translated to display text via
// `meetingSpeakerLabel` right here — the render boundary the brief calls
// for — and a "room" turn's empty label means literally no chip renders,
// not an empty one: a shared microphone cannot say who was talking, and a
// blank chip would still visually claim it knew there WAS an attributable
// turn boundary worth marking.
function FinalTurnRow({ turn, rowRef }) {
  const label = meetingSpeakerLabel(turn.speaker);
  const clock = formatClockTime(turn.at);
  return (
    <Box ref={rowRef} sx={{ pt: 0.75 }}>
      {label || clock ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.25 }}>
          {label ? (
            <Chip
              size="small"
              label={label}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 700,
                color: turn.speaker === "them" ? "var(--accent-contrast)" : "var(--text-secondary)",
                background: turn.speaker === "them" ? "var(--accent)" : "var(--bg-soft)",
                border: turn.speaker === "them" ? "none" : "1px solid var(--border)",
              }}
            />
          ) : null}
          {clock ? (
            <Typography variant="caption" sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {clock}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
      <Typography sx={{ pl: 0.25, color: "var(--text-primary)", wordBreak: "break-word" }}>
        {turn.text}
      </Typography>
    </Box>
  );
}

// One in-progress (not-yet-final) line. Distinguished from a final turn two
// ways at once, per the brief: visually (muted + italic, same cue TranscriptView
// uses for its own interims) AND programmatically — a leading visually-hidden
// "Still speaking:" prefix is part of this row's actual text content, so a
// screen-reader user who tabs or reads onto this row hears the distinction
// too, not just sees it. Deliberately NOT inside any aria-live/role="status"
// region: an interim updates many times a second as speech resolves, and a
// live region would announce every one of those partial re-renders. Leaving
// it a plain, non-live node means it is only ever read when the user
// actually navigates to it — which is what "not announced repeatedly" means
// in practice, since nothing here proactively interrupts.
function InterimRow({ speaker, text, rowRef }) {
  const label = meetingSpeakerLabel(speaker);
  return (
    <Box ref={rowRef} sx={{ pt: 0.75 }}>
      {label ? (
        <Chip
          size="small"
          label={label}
          sx={{
            height: 20,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-secondary)",
            background: "var(--bg-soft)",
            border: "1px solid var(--border)",
            mb: 0.25,
          }}
        />
      ) : null}
      <Typography
        data-interim="true"
        sx={{ pl: 0.25, color: "var(--text-muted)", fontStyle: "italic", wordBreak: "break-word" }}
      >
        <Box component="span" sx={visuallyHidden}>
          Still speaking:{" "}
        </Box>
        {text}
      </Typography>
    </Box>
  );
}

export default function MeetingTranscript({ turns, interims, source }) {
  const finalTurns = Array.isArray(turns) ? turns : [];
  const interimMap = interims && typeof interims === "object" ? interims : {};
  const activeInterims = SPEAKER_KEYS.filter((key) => typeof interimMap[key] === "string" && interimMap[key]);

  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const newestRef = useRef(null);

  const hasContent = finalTurns.length > 0 || activeInterims.length > 0;

  // Extracted to its own variable (rather than inlining `.join("|")` in the
  // dependency array below) purely so the array is statically checkable —
  // react-hooks/exhaustive-deps cannot verify a dependency it can't see is
  // stable across renders when it's a fresh expression written inline.
  const activeInterimsKey = activeInterims.join("|");

  // Auto-follow the newest line, the same "stick unless the reader has
  // scrolled away" contract TranscriptView.js uses — new turns in a live
  // meeting must not require the reader to keep manually scrolling down,
  // but a reader who scrolled UP to re-read something earlier must not be
  // yanked back to the bottom by the next arriving line either.
  useEffect(() => {
    if (!stickRef.current) return;
    newestRef.current?.scrollIntoView({ block: "nearest" });
  }, [finalTurns.length, activeInterimsKey]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // "Newest turns must be reachable without hunting" — the AC this button
  // exists to satisfy directly and testably, independent of whatever a
  // jsdom test environment's zeroed-out layout metrics let the auto-follow
  // effect above actually prove. Always enabled and always in the tab
  // order whenever there is any content at all (never conditionally
  // disabled while explanatory text about it is on screen — the
  // accessibility rule this brief calls out by name).
  const jumpToLatest = () => {
    stickRef.current = true;
    newestRef.current?.scrollIntoView({ block: "nearest" });
  };

  const attributionNotice = speakerAttributionNotice(source);

  const rows = [];
  finalTurns.forEach((turn, i) => {
    rows.push(
      <FinalTurnRow
        key={turn.id}
        turn={turn}
        rowRef={i === finalTurns.length - 1 && activeInterims.length === 0 ? newestRef : undefined}
      />,
    );
  });
  activeInterims.forEach((speaker, i) => {
    rows.push(
      <InterimRow
        key={`interim-${speaker}`}
        speaker={speaker}
        text={interimMap[speaker]}
        rowRef={i === activeInterims.length - 1 ? newestRef : undefined}
      />,
    );
  });

  return (
    <Box>
      {attributionNotice ? (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 1 }}>
          {attributionNotice}
        </Typography>
      ) : null}

      {hasContent ? (
        <Box sx={{ mb: 1, textAlign: "right" }}>
          <Button size="small" onClick={jumpToLatest} aria-label="Jump to the latest turn">
            Jump to latest
          </Button>
        </Box>
      ) : null}

      <Box
        ref={scrollRef}
        onScroll={onScroll}
        sx={{
          maxHeight: 420,
          overflowY: "auto",
          p: 2,
          borderRadius: 2,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        {!hasContent ? (
          <Typography sx={{ color: "var(--text-muted)" }}>
            The transcript will appear here once the meeting starts…
          </Typography>
        ) : (
          <Stack spacing={0.25}>{rows}</Stack>
        )}
      </Box>
    </Box>
  );
}
