"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// Bounded so a long submitted résumé or cover letter can never push the
// rest of the copilot screen down indefinitely (AC-H3.13) — it scrolls
// inside its own container instead.
const SCROLL_MAX_HEIGHT = 260;

// AC-H3.12: the label must always state what was ACTUALLY found for the
// CURRENT request — never a generic claim that could be misread as always
// meaning both documents. Same discipline as practice/SampleAnswer.js's
// sourceCaption: derive the wording from the props that just arrived, not
// a static string. Folded into the same button label PrepContext.js uses
// for its own char-count suffix, rather than a separate caption line, so
// there is only one place this fact is ever stated.
function statusSuffix(status, resume, coverLetter) {
  if (status === "error") return " — load failed";
  if (status === "loading" || status === "idle") return " — loading…";
  const hasResume = !!resume;
  const hasCoverLetter = !!coverLetter;
  if (hasResume && hasCoverLetter) return " — resume and cover letter found";
  if (hasResume) return " — resume found, no cover letter on file";
  if (hasCoverLetter) return " — cover letter found, no resume on file";
  return " — no resume or cover letter found";
}

// AC-H3.13: a document that was not found is stated as not found, never
// rendered as an empty scroll container that could be mistaken for one
// that's just short.
function DocumentSection({ title, text, notFoundText }) {
  return (
    <Box>
      {/* F10: the disclosure this sits under is a Button ("Submitted for
          this application" above), not a heading, so this title has no
          heading ancestor besides the tab's own h2 (TabHeader.js) — one
          level under it, same as this tab's other top-level panel titles.
          `component=` only changes the rendered element, never the
          `variant` that governs how this looks. */}
      <Typography variant="subtitle2" component="h3" sx={{ color: "var(--text-primary)", mb: 0.5 }}>
        {title}
      </Typography>
      {text ? (
        <Box
          sx={{
            maxHeight: SCROLL_MAX_HEIGHT,
            overflowY: "auto",
            p: 1.5,
            borderRadius: 1.5,
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <Typography variant="body2" sx={{ color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
            {text}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          {notFoundText}
        </Typography>
      )}
    </Box>
  );
}

// AC-H3: the read-only "Submitted for this application" panel — the résumé
// and cover letter actually submitted for the currently selected
// application, shown in both live mode and practice mode. Purely
// presentational: every value (load status, the two document strings, an
// error message, the retry callback) arrives as a prop from
// useApplicationDocs, the same contract practice/SampleAnswer.js and
// practice/QuestionCard.js already follow.
//
// Whether a posting is even selected is deliberately NOT a prop here — the
// caller (CopilotClient / PracticeClient) decides that, and must render
// nothing at all, not this component in some disabled/empty state, when no
// posting is selected (AC-H3.11).
//
// Follows PrepContext.js's Button+Collapse shape, including folding the
// dynamic detail into the same label line PrepContext uses for its char
// count. Unlike PrepContext there is no onChange and nothing persisted:
// this panel never writes to the prep context or its localStorage key
// (AC-H3.14) — it has no prop through which it even could.
export default function SubmittedDocs({ status, resume, coverLetter, error, onRetry }) {
  const [open, setOpen] = useState(false);

  return (
    <Box sx={{ mb: 2 }}>
      <Button
        size="small"
        variant="text"
        onClick={() => setOpen((o) => !o)}
        sx={{ color: "var(--text-secondary)" }}
      >
        {open ? "▾" : "▸"} Submitted for this application
        {statusSuffix(status, resume, coverLetter)}
      </Button>
      <Collapse in={open}>
        <Box sx={{ mt: 1 }}>
          {status === "loading" || status === "idle" ? (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <CircularProgress size={18} />
              <Typography sx={{ color: "var(--text-muted)" }}>
                Loading the resume and cover letter you submitted for this application…
              </Typography>
            </Stack>
          ) : null}

          {status === "error" ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={onRetry}>
                  Retry
                </Button>
              }
            >
              {error || "Could not load the submitted resume and cover letter."}
            </Alert>
          ) : null}

          {status === "done" ? (
            <Stack spacing={2}>
              <DocumentSection
                title="Submitted resume"
                text={resume}
                notFoundText="No resume was found for this application."
              />
              <DocumentSection
                title="Submitted cover letter"
                text={coverLetter}
                notFoundText="No cover letter was found for this application."
              />
            </Stack>
          ) : null}
        </Box>
      </Collapse>
    </Box>
  );
}
