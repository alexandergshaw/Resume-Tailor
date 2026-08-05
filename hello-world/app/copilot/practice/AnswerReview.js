"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MIN_LUMA_SAMPLES } from "@/lib/copilot/videoStats";

// Top offending phrases worth naming individually — capped so a rambly
// answer doesn't turn a row into a wall of text. Shared by the Fillers and
// Other possible fillers rows.
const MAX_TOP_PHRASES = 3;

function fmtSeconds(sec) {
  const total = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function topPhrases(list) {
  return (list || [])
    .slice(0, MAX_TOP_PHRASES)
    .map((f) => `"${f.phrase}" x${f.count}`)
    .join(", ");
}

// Presentational review of one completed practice answer: the plain,
// measurable facts about how it was delivered. This is C3's whole job —
// judging what was actually SAID is feature C4 (see AnswerFeedback, which
// sits right below this and also owns the repeat loop — "Next question" /
// "Try again" live there, not here). Every prop may be absent (metrics
// still loading, no replay clip, an answer with no speech in it) and the
// card renders something honest either way; no claim is displayed that the
// metrics don't support — an unavailable number is labeled "unavailable" or
// omitted rather than shown as a zero that could read like a real result.
export default function AnswerReview({
  transcript = [],
  metrics = null,
  replayUrl = "",
  replaySupported = true,
}) {
  const hasMetrics = !!metrics;
  const video = metrics?.video || null;
  const hasVideo = !!video?.hadVideo;
  // Below this many samples, tooDark/tooBright/veryStill/fidgety are already
  // forced false by summarizeVideoStats itself (not enough data to assert
  // anything) — this local check exists so the DEFAULT "looked well lit and
  // steady" text (below) isn't shown for that same "no real data" case,
  // which would otherwise read as a real, positive result instead of an
  // absence of measurement.
  const hasEnoughSamples = hasVideo && video.frames >= MIN_LUMA_SAMPLES;
  // Pace is measured over the audio span the words actually cover, not the
  // Start-to-Done wall clock — see "Speaking time" below and BUG-1c.
  const canMeasurePace = hasMetrics && metrics.wordCount > 0 && metrics.speechDurationSec > 0;

  const cameraNotes = [];
  if (hasEnoughSamples) {
    if (video.tooDark) cameraNotes.push("lighting looked dark");
    if (video.tooBright) cameraNotes.push("lighting looked overexposed");
    if (video.veryStill) cameraNotes.push("very little movement in frame");
    if (video.fidgety) cameraNotes.push("a lot of movement in frame");
  }
  if (hasVideo && video.partiallyOff) {
    cameraNotes.push("camera was off for part of this answer");
  }

  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
        mb: 2,
      }}
    >
      <Typography variant="h6" sx={{ fontWeight: 600, color: "var(--text-primary)", mb: 1.5 }}>
        Answer review
      </Typography>

      {hasMetrics && metrics.micMuted ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The microphone was muted for part of this answer — word count, filler counts, and pace
          below may be incomplete: anything said while muted was never transcribed.
        </Alert>
      ) : null}

      {hasMetrics ? (
        <Stack spacing={0.75} sx={{ mb: 2 }}>
          <MetricRow label="Duration" value={fmtSeconds(metrics.durationSec)} />
          <MetricRow
            label="Speaking time"
            value={canMeasurePace ? fmtSeconds(metrics.speechDurationSec) : "unavailable"}
          />
          <MetricRow label="Word count" value={String(metrics.wordCount)} />
          <MetricRow
            label="Pace"
            value={
              canMeasurePace
                ? `${Math.round(metrics.wordsPerMinute)} words/min (${metrics.paceLabel})`
                : "unavailable — not enough speech to measure"
            }
          />
          <MetricRow
            label="Fillers"
            value={
              metrics.fillerCount > 0
                ? `${metrics.fillerCount} — ${topPhrases(metrics.fillers)}`
                : "none heard"
            }
          />
          <MetricRow
            label="Other possible fillers"
            value={
              metrics.discourseMarkerCount > 0
                ? `${metrics.discourseMarkerCount} — ${topPhrases(metrics.discourseMarkers)} (these are also ordinary words — may be legitimate usage)`
                : "none heard"
            }
          />
          <MetricRow
            label="Quantified result"
            value={metrics.hasMetric ? "yes — a number was mentioned" : "not mentioned"}
          />
          <MetricRow
            label="Camera"
            value={
              !hasVideo
                ? "camera was off — no lighting or steadiness notes"
                : !hasEnoughSamples
                  ? video.partiallyOff
                    ? "camera was off for part of this answer — not enough on-camera data for lighting or steadiness notes"
                    : "unavailable — not enough camera data"
                  : cameraNotes.length
                    ? cameraNotes.join("; ")
                    : "looked well lit and steady"
            }
          />
        </Stack>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          No metrics are available for this answer.
        </Alert>
      )}

      <Divider sx={{ mb: 2, borderColor: "var(--border)" }} />

      <Typography variant="subtitle2" sx={{ color: "var(--text-secondary)", mb: 1 }}>
        Replay
      </Typography>
      {replayUrl ? (
        // Intentionally NOT mirrored, unlike the live self-view in
        // CameraPreview — a mirrored replay would misrepresent which way
        // the candidate actually looked during the answer.
        <Box sx={{ mb: 2 }}>
          <video
            controls
            src={replayUrl}
            style={{ width: "100%", maxHeight: 320, borderRadius: 8, display: "block" }}
          />
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)", mb: 2 }}>
          {replaySupported
            ? "No recording was captured for this answer."
            : "Recording is not available in this browser."}
        </Typography>
      )}

      <Typography variant="subtitle2" sx={{ color: "var(--text-secondary)", mb: 1 }}>
        What was heard
      </Typography>
      {transcript && transcript.length ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {transcript.map((line, i) => (
            <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5, color: "var(--text-primary)" }}>
              {line}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          No speech was heard during this answer.
        </Typography>
      )}
    </Box>
  );
}

function MetricRow({ label, value }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", minWidth: 140 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-primary)", fontWeight: 500 }}>
        {value}
      </Typography>
    </Stack>
  );
}
