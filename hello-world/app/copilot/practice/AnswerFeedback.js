"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { videoWasReviewed } from "@/lib/copilot/answerProvenance";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "../mobileSx";

const STAR_LABELS = [
  ["situation", "Situation"],
  ["task", "Task"],
  ["action", "Action"],
  ["result", "Result"],
];

const SOURCE_LABEL = { gemini: "Gemini", embedded: "Embedded engine" };

// D3: body-language content rides inside the SAME `delivery` string array
// pace/filler/camera notes already use, tagged with this prefix by
// critiqueLocal.js's bodyLanguageDeliveryNote (embedded) and route.js's
// sanitizeCritique (Gemini) — the AC-C4-1 response contract stays locked to
// its existing eight keys, so there is no separate field to read here.
// Splitting on the tag is what lets this panel give body-language feedback
// its own clearly labelled section instead of burying it in "Delivery
// notes", distinct from the raw measurements AnswerReview shows. Kept
// tolerant of punctuation/casing variants ("Body-language —", "BODYLANGUAGE")
// rather than only the one exact phrase (BUG-12) — matches
// route.js's own BODY_LANGUAGE_PREFIX_RE so both sides recognise the same
// items the same way.
const BODY_LANGUAGE_PREFIX_RE = /^body[\s-]*language\b/i;

function splitDelivery(delivery) {
  const items = Array.isArray(delivery) ? delivery : [];
  return {
    bodyLanguage: items.filter((s) => typeof s === "string" && BODY_LANGUAGE_PREFIX_RE.test(s.trim())),
    rest: items.filter((s) => !(typeof s === "string" && BODY_LANGUAGE_PREFIX_RE.test(s.trim()))),
  };
}

// D2's machine-readable `reason` codes (see BodyLanguageSampler.stop() in
// lib/copilot/bodyLandmarks.js), resolved to plain language — a local copy
// of the SAME map AnswerReview.js already keeps for its own (unexported)
// use, rather than importing across a file this AC's modify list doesn't
// include. Falls back to the raw code for any reason this map doesn't know
// about, rather than hiding it.
const BODY_LANGUAGE_UNAVAILABLE_REASONS = {
  "no-camera": "no camera was available for this answer",
  "camera-off": "the camera was off for this entire answer",
  "runtime-assets-missing": "the on-device model files were not staged for this build",
  "model-load-failed": "the on-device body-language models failed to load",
  "no-frames": "the camera never produced a usable video frame",
  "not-ready": "the on-device models were still loading when the answer ended",
  "inference-failed": "on-device measurement failed while running",
  "no-samples": "no measurements were collected during this answer",
};

function scoreColor(score) {
  if (score >= 75) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}

function BulletList({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <Box sx={{ mb: 1.5 }}>
      {/* F10: nested one level under "Answer feedback" below, same as
          "Body language feedback" further down this panel. */}
      <Typography variant="subtitle2" component="h4" sx={{ color: "var(--text-secondary)", mb: 0.5 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.map((item, i) => (
          <Typography
            key={i}
            component="li"
            variant="body2"
            sx={{ mb: 0.5, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
          >
            {item}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

// Judgement of what was actually SAID in a completed practice answer — C4's
// half of the review panel, sitting alongside C3's AnswerReview (which
// covers only the measurable delivery facts). Renders the AC-C4-1 contract
// exactly as the server returns it, whichever engine produced it, and owns
// the repeat loop: "Next question" advances to a fresh question; "Try
// again" re-answers this same one. Both stay available through every
// status (loading/error included) so a slow or failed critique never
// blocks moving on. The running session total lives in PracticeClient, not
// here — it needs to stay visible even when this panel isn't mounted (e.g.
// right after "Next question" clears the just-reviewed answer).
export default function AnswerFeedback({
  status = "idle", // idle | loading | done | error
  feedback = null,
  error = "",
  // D3/BUG-3/K1: whether frames were actually sent for THIS critique
  // request, as a retrospective fact. PracticeClient passes its
  // `critiqueFramesSent` (usePracticeAnswer) here — the value recorded at
  // the moment THIS critique settled from the frames array it actually
  // sent — NOT `framesWillUpload`, its live re-derivation of the "Include
  // camera frames" switch, which sits on the same screen as this panel and
  // would silently change what this panel claims every time it's toggled
  // (K1). It also must not be re-derived from `feedback.source` alone,
  // since the frames-opt-in switch defaults off and Gemini is the default
  // engine, so "source is gemini" does not by itself mean a frame was ever
  // attached.
  framesSent = false,
  // D3/BUG-5: D2's raw `metrics.bodyLanguage.reason` code for the answer
  // currently under review, passed straight through by PracticeClient
  // (which already holds `answerMetrics`) — lets the "not available" state
  // below say WHY rather than a bare generic sentence, without the response
  // contract needing to carry it.
  bodyLanguageReason = null,
  // G2/AC-G2-C-6: the resolved interview-type label ("System design",
  // "Recruiter phone screen", ...) this critique was actually judged
  // against. The eight-key critique response contract carries no
  // interview-type field (AC-G2-B-3 locks it), so PracticeClient resolves
  // it from the CURRENT interview type via interviewTypeLabel() and passes
  // the string straight through — this component never re-derives a label
  // from a raw value itself.
  interviewTypeLabel = "",
  onRetry,
  onNext,
  onTryAgain,
}) {
  const { bodyLanguage: bodyLanguageNotes, rest: deliveryNotes } = splitDelivery(feedback?.delivery);
  // BUG-3/K1: someone only actually reviewed the video when Gemini both ran
  // AND had a frame to look at — never true for the embedded engine (which
  // never constructs a Gemini client or parses frames), and never true on
  // the Gemini-failed-and-fell-back-to-embedded path either, since
  // `feedback.source` there is correctly "embedded" even though frames may
  // already have been sent for the (failed) attempt. Moved into
  // lib/copilot/answerProvenance.js (K1) so this decision is testable at
  // all — this repo's vitest runs `environment: "node"` with no jsdom, so
  // nothing inside a component module like this one can be exercised by a
  // test.
  const bodyLanguageLooked = videoWasReviewed(feedback?.source, framesSent);
  const bodyLanguageReasonText = bodyLanguageReason
    ? BODY_LANGUAGE_UNAVAILABLE_REASONS[bodyLanguageReason] || bodyLanguageReason
    : "";

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
          tab's other top-level panel titles. The BulletList section titles
          and "Body language feedback" below nest another level under this
          one. `component=` changes only the rendered element, never the
          `variant` that governs how this looks. */}
      <Typography variant="h6" component="h3" sx={{ fontWeight: 600, color: "var(--text-primary)", mb: 1.5 }}>
        Answer feedback
      </Typography>

      {status === "loading" ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", py: 1, mb: 1 }}>
          <CircularProgress size={20} />
          <Typography sx={{ color: "var(--text-muted)" }}>Analyzing your answer…</Typography>
        </Stack>
      ) : null}

      {status === "error" ? (
        <Alert
          severity="error"
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={onRetry} sx={TOUCH_TARGET_SX}>
              Retry
            </Button>
          }
        >
          {error || "Could not analyze this answer."}
        </Alert>
      ) : null}

      {status === "done" && feedback ? (
        <>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "baseline", mb: 1, flexWrap: "wrap", rowGap: 0.5 }}
          >
            {/* F10: this was the second half of the "h6 then h4 inside it"
                defect — a numeric score is a data value, not a section
                title, and was never meant to be a heading at all (a
                Typography variant governs its CSS styling only, not
                whether MUI's defaultVariantMapping also makes it a
                heading element). `component="span"` keeps the exact same
                large, bold, colored look `variant="h4"` gives it while
                taking it out of the document's heading outline entirely. */}
            <Typography variant="h4" component="span" sx={{ fontWeight: 700, color: scoreColor(feedback.score) }}>
              {feedback.score}
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
              / 100
            </Typography>
            <Chip
              size="small"
              label={SOURCE_LABEL[feedback.source] || feedback.source || "unknown"}
              sx={{
                height: { xs: 24, sm: 22 },
                fontSize: { xs: 12, sm: 11 },
                color: "var(--text-secondary)",
                background: "var(--bg-soft)",
                border: "1px solid var(--border)",
              }}
            />
          </Stack>
          <Typography variant="body1" sx={{ color: "var(--text-primary)", mb: 2 }}>
            {feedback.verdict}
          </Typography>

          {/* AC-G2-C-6: states the standard this answer was judged against
              — a system-design answer and a phone-screen answer are not
              held to the same bar, and this is the user's only on-screen
              confirmation of which one applied. */}
          {interviewTypeLabel ? (
            <Typography variant="body2" sx={{ color: "var(--text-muted)", mb: 2 }}>
              Judged as a {interviewTypeLabel} interview.
            </Typography>
          ) : null}

          {feedback.star ? (
            <Stack direction="row" useFlexGap sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
              {STAR_LABELS.map(([key, label]) => {
                const present = !!feedback.star[key];
                return (
                  <Chip
                    key={key}
                    size="small"
                    label={label}
                    sx={{
                      fontWeight: 600,
                      color: present ? "var(--success)" : "var(--text-muted)",
                      background: present ? "var(--success-soft)" : "var(--bg-soft)",
                      border: `1px solid ${present ? "var(--success)" : "var(--border)"}`,
                    }}
                  />
                );
              })}
            </Stack>
          ) : null}

          <Divider sx={{ mb: 2, borderColor: "var(--border)" }} />

          <BulletList title="Strengths" items={feedback.strengths} />
          <BulletList title="Improvements" items={feedback.improvements} />
          <BulletList title="What was missing" items={feedback.missing} />
          <BulletList title="Delivery notes" items={deliveryNotes} />

          {/* D3: its own clearly labelled section, separate from "Delivery
              notes" above — AnswerReview (rendered above this whole panel)
              already shows the raw measurements; this is what to do about
              them, or an honest word that there was nothing to measure. */}
          <Box sx={{ mb: 1.5 }}>
            {/* F10: nested one level under "Answer feedback" above, same as
                the BulletList section titles. */}
            <Typography variant="subtitle2" component="h4" sx={{ color: "var(--text-secondary)", mb: 0.5 }}>
              Body language feedback
            </Typography>
            {bodyLanguageNotes.length ? (
              <>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {bodyLanguageNotes.map((item, i) => (
                    <Typography
                      key={i}
                      component="li"
                      variant="body2"
                      sx={{ mb: 0.5, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
                    >
                      {item}
                    </Typography>
                  ))}
                </Box>
                <Typography variant="caption" sx={{ color: "var(--text-muted)" }}>
                  {bodyLanguageLooked
                    ? `May include what was actually visible in your camera, in addition to the measured numbers (${SOURCE_LABEL[feedback.source] || feedback.source}).`
                    : `Based on the measured numbers only — no one reviewed your video for this (${SOURCE_LABEL[feedback.source] || feedback.source}).`}
                </Typography>
              </>
            ) : (
              <Alert severity="info" sx={{ py: 0 }}>
                Body-language feedback is not available for this answer
                {bodyLanguageReasonText ? ` — ${bodyLanguageReasonText}.` : "."}
              </Alert>
            )}
          </Box>
        </>
      ) : null}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
        <Button
          variant="contained"
          onClick={onNext}
          sx={{ ...TOUCH_TARGET_SX, width: { xs: "100%", sm: "auto" } }}
        >
          Next question
        </Button>
        <Button
          variant="outlined"
          onClick={onTryAgain}
          sx={{ ...TOUCH_TARGET_SX, width: { xs: "100%", sm: "auto" } }}
        >
          Try again
        </Button>
      </Stack>
    </Box>
  );
}
