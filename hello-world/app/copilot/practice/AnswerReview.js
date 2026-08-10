"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MIN_LUMA_SAMPLES } from "@/lib/copilot/videoStats";
import { BREAK_LONG_WORDS_SX } from "../mobileSx";

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

// D2: plain-language reasons for BodyLanguageSampler's machine-readable
// `reason` codes (see lib/copilot/bodyLandmarks.js's stop()/_buildSummary)
// — falls back to the raw code itself for any reason this map doesn't know
// about, rather than hiding it.
const BODY_LANGUAGE_UNAVAILABLE_REASONS = {
  "no-camera": "no camera was available for this answer",
  "camera-off": "the camera was off for this entire answer",
  "runtime-assets-missing": "the on-device model files were not staged for this build (run npm run copy-mediapipe)",
  "model-load-failed": "the on-device body-language models failed to load",
  "no-frames": "the camera never produced a usable video frame",
  "not-ready": "the on-device models were still loading when the answer ended",
  "inference-failed": "on-device measurement failed while running",
  "no-samples": "no measurements were collected during this answer",
};

// Each combines the sub-signals in one D2 category into a single sentence,
// using only whichever of them actually measured a value — the same
// "join whatever fired" shape the existing Camera row already uses for
// tooDark/tooBright/veryStill/fidgety. Returns null (not a sentence) when
// NONE of the category's signals measured anything, so the caller can show
// an honest "unavailable" instead of an empty sentence.
function posturePartsText(bl) {
  const parts = [];
  if (Number.isFinite(bl.shoulderTilt)) parts.push(`shoulders ${Math.abs(bl.shoulderTilt).toFixed(0)} deg off level`);
  if (Number.isFinite(bl.lean)) {
    parts.push(`${Math.abs(Math.round(bl.lean * 100))}% ${bl.lean >= 0 ? "right" : "left"} of frame centre`);
  }
  if (Number.isFinite(bl.slouch)) parts.push(`shoulder-to-nose distance ${bl.slouch.toFixed(2)}x shoulder width`);
  return parts.length ? parts.join("; ") : null;
}

function gesturePartsText(bl) {
  const parts = [];
  if (bl.handsVisibleRatio !== null && bl.handsVisibleRatio !== undefined) {
    parts.push(`hands visible ${Math.round(bl.handsVisibleRatio * 100)}% of the time`);
  }
  if (Number.isFinite(bl.gestureRate)) {
    parts.push(`movement magnitude ${bl.gestureRate.toFixed(2)} (normalized wrist movement per sample)`);
  }
  return parts.length ? parts.join("; ") : null;
}

function expressivenessPartsText(bl) {
  const expr = bl.expressiveness || {};
  const parts = [];
  if (Number.isFinite(expr.smile)) parts.push(`smile ${Math.round(expr.smile * 100)}/100`);
  if (Number.isFinite(expr.browMovement)) parts.push(`brow movement ${Math.round(expr.browMovement * 100)}/100`);
  return parts.length ? `${parts.join(", ")} (raw model scores, not emotion readings)` : null;
}

function framingPartsText(bl) {
  const fr = bl.framing || {};
  const parts = [];
  if (fr.centeredRatio !== null && fr.centeredRatio !== undefined) {
    parts.push(`centred ${Math.round(fr.centeredRatio * 100)}% of the time`);
  }
  if (Number.isFinite(fr.fill)) parts.push(`face filled ~${Math.round(fr.fill * 100)}% of the frame`);
  if (fr.tooCloseRatio) parts.push("sat close to the camera for part of the answer");
  if (fr.tooFarRatio) parts.push("sat far from the camera for part of the answer");
  return parts.length ? parts.join("; ") : null;
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

  // D2: metrics.bodyLanguage is BodyLanguageSampler.stop()'s summary,
  // riding alongside metrics.video (see usePracticeAnswer's doneAnswer).
  // Unlike video's summarizeVideoStats, summarizeBodyLanguage already
  // returns null (never false/0) for any per-signal value below its own
  // named sample minimum, so this component only needs to check for null
  // per field/category — no separate "hasEnoughSamples" re-derivation like
  // the Camera row above needs for videoStats' looser guarantee.
  const bodyLanguage = metrics?.bodyLanguage || null;
  const bodyLanguageAvailable = !!bodyLanguage?.available;
  const bodyLanguageReasonText = bodyLanguage?.reason
    ? BODY_LANGUAGE_UNAVAILABLE_REASONS[bodyLanguage.reason] || bodyLanguage.reason
    : "";

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
      {/* F10: one level under the tab's h2 (TabHeader.js), same as this
          tab's other top-level panel titles. The three subtitle2 section
          titles below ("Body language", "Replay", "What was heard") nest
          another level under this one. `component=` changes only the
          rendered element, never the `variant` that governs how this
          looks. */}
      <Typography variant="h6" component="h3" sx={{ fontWeight: 600, color: "var(--text-primary)", mb: 1.5 }}>
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

      {/* D2: posture, motion, and framing measured on-device from the
          camera feed — never emotion labels, personality inferences, or
          claims about confidence/honesty (AC-D2-5). Head-orientation-based
          "facing the camera" is worded as head orientation, explicitly not
          as verified eye contact — see isLookingAtCamera's own comment in
          lib/copilot/bodyLanguage.js for why that distinction matters. */}
      {/* F10: nested one level under "Answer review" above. */}
      <Typography variant="subtitle2" component="h4" sx={{ color: "var(--text-secondary)", mb: 1 }}>
        Body language
      </Typography>
      {!bodyLanguage ? (
        <Typography variant="body2" sx={{ color: "var(--text-muted)", mb: 2 }}>
          No body-language data is available for this answer.
        </Typography>
      ) : !bodyLanguageAvailable ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Body-language measurement was not available for this answer
          {bodyLanguageReasonText ? ` — ${bodyLanguageReasonText}.` : "."}
        </Alert>
      ) : (
        <Stack spacing={0.75} sx={{ mb: 2 }}>
          {/* BUG-2: every ratio below is already gated (in
              summarizeBodyLanguage) on covering a real share of the whole
              answer, not just a raw sample count — this line makes that
              coverage visible too, rather than leaving "X% of the time"
              looking like it always means the full answer. */}
          <Typography variant="caption" sx={{ color: "var(--text-muted)" }}>
            Face detected in {Math.round((bodyLanguage.faceFrames / bodyLanguage.frames) * 100)}% and pose detected
            in {Math.round((bodyLanguage.poseFrames / bodyLanguage.frames) * 100)}% of {bodyLanguage.frames} sampled
            moments in this answer.
          </Typography>
          {/* BUG-7: the sampler already computes this (partiallyOff); it was
              silently never rendered, so an answer where the camera was off
              for MOST of its length showed confident-looking measurements
              from only the handful of frames that remained. */}
          {bodyLanguage.partiallyOff ? (
            <Alert severity="warning" sx={{ py: 0 }}>
              The camera was off for part of this answer — the numbers below reflect only the portion it was on.
            </Alert>
          ) : null}
          {/* BUG-8: a MATERIAL share of inference attempts throwing (as
              opposed to simply not finding a face/pose) is disclosed even
              though enough real measurements still came through to keep
              `available: true` — otherwise this looked identical to a
              clean run. */}
          {bodyLanguage.reason === "inference-partially-failed" ? (
            <Alert severity="warning" sx={{ py: 0 }}>
              On-device measurement failed partway through this answer ({bodyLanguage.detail}) — the numbers below
              reflect only the attempts that succeeded.
            </Alert>
          ) : null}
          <MetricRow
            label="Head orientation"
            value={
              Number.isFinite(bodyLanguage.eyeContactRatio)
                ? `facing the camera ${Math.round(bodyLanguage.eyeContactRatio * 100)}% of the time (head orientation, not verified eye contact)`
                : "unavailable — not enough face data"
            }
          />
          <MetricRow
            label="Head steadiness"
            value={
              Number.isFinite(bodyLanguage.headSteadiness)
                ? `${bodyLanguage.headSteadiness.toFixed(1)} deg of head movement between samples, on average`
                : "unavailable — not enough face data"
            }
          />
          <MetricRow label="Posture" value={posturePartsText(bodyLanguage) || "unavailable — not enough pose data"} />
          <MetricRow label="Gestures" value={gesturePartsText(bodyLanguage) || "unavailable — not enough pose data"} />
          <MetricRow
            label="Expressiveness"
            value={expressivenessPartsText(bodyLanguage) || "unavailable — not enough face data"}
          />
          <MetricRow label="Framing" value={framingPartsText(bodyLanguage) || "unavailable — not enough face data"} />
        </Stack>
      )}

      <Divider sx={{ mb: 2, borderColor: "var(--border)" }} />

      {/* F10: nested one level under "Answer review" above. */}
      <Typography variant="subtitle2" component="h4" sx={{ color: "var(--text-secondary)", mb: 1 }}>
        Replay
      </Typography>
      {replayUrl ? (
        // Intentionally NOT mirrored, unlike the live self-view in
        // CameraPreview — a mirrored replay would misrepresent which way
        // the candidate actually looked during the answer.
        // Bug fix (audit round): `vh` is the large-viewport height on iOS
        // Safari (URL bar collapsed), so a plain `50vh` cap is taller than
        // the visible area whenever the bar is expanded. `dvh` tracks the
        // actual visible viewport; nested under `xs` as a two-element array
        // it emits both `max-height:50vh;` then `max-height:50dvh;` for that
        // breakpoint (verified against this repo's @mui/system +
        // @emotion/serialize output), so the `dvh` value wins wherever it's
        // supported and the plain `vh` value is the fallback everywhere else
        // — no JS measurement needed for a static value like this one.
        <Box
          component="video"
          controls
          src={replayUrl}
          sx={{
            display: "block",
            width: "100%",
            maxHeight: { xs: ["50vh", "50dvh"], md: 320 },
            borderRadius: "8px",
            mb: 2,
          }}
        />
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)", mb: 2 }}>
          {replaySupported
            ? "No recording was captured for this answer."
            : "Recording is not available in this browser."}
        </Typography>
      )}

      {/* F10: nested one level under "Answer review" above. */}
      <Typography variant="subtitle2" component="h4" sx={{ color: "var(--text-secondary)", mb: 1 }}>
        What was heard
      </Typography>
      {transcript && transcript.length ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {transcript.map((line, i) => (
            <Typography
              key={i}
              component="li"
              variant="body2"
              sx={{ mb: 0.5, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
            >
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
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0, sm: 1 }}
      sx={{ alignItems: { xs: "flex-start", sm: "baseline" } }}
    >
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", minWidth: { xs: 0, sm: 140 } }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-primary)", fontWeight: 500 }}>
        {value}
      </Typography>
    </Stack>
  );
}
