"use client";

import Box from "@mui/material/Box";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { DRAFT_KIND } from "@/lib/review/flagPresentation";
import ReviewFlagsPanel from "./ReviewFlagsPanel";

// N103 Step 5 -- the thin result shell, the ONE place a review result is drawn
// for both surfaces (the preview modal and the Ask-AI chat).
//
//   outcome       a ReviewOutcome from runDocumentReview ("reviewed" | "empty" |
//                 "failed" | absent when another surface already covers the text)
//   presentation  reviewPresentationState's output for that outcome
//
// It owns no label table, no tier logic and no flag renderer: the findings are
// ReviewFlagsPanel's, and every sentence of chrome (headline, what was and was not
// checked, the footer) arrives already worded by reviewPresentationState, which is
// the only place that decides whether a result may read as reassuring. This shell
// draws what it is handed. It adds no live region: the announcement is the caller's.

const TONE_SX = {
  warning: { borderLeft: "4px solid var(--warning)", bgcolor: "var(--warning-soft)" },
  info: { borderLeft: "4px solid var(--accent)", bgcolor: "var(--accent-soft)" },
};
const SUBJECT_SX = { m: 0, mb: 0.75, fontSize: "0.82rem", color: "var(--text-secondary)", overflowWrap: "anywhere" };
const NOTE_SX = { m: 0, mt: 0.75, fontSize: "0.82rem", color: "var(--text-primary)" };
const FOOT_SX = { m: 0, mt: 1, fontSize: "0.75rem", color: "var(--text-secondary)" };

export default function DocumentReviewResult({ outcome, presentation }) {
  const reviewed = outcome?.status === "reviewed";
  const { headline, tone, summary, notice, footer, hideUnresolved } = presentation;
  const lineCount = Number(outcome?.lineCount) || 0;

  return (
    <Box>
      {reviewed ? (
        // The subject is named in every reviewed result, so a verdict is never
        // separate from the document it describes. The title is somebody else's
        // text (a company or job name), so it is marked as quoted.
        <Box component="p" sx={SUBJECT_SX}>
          Reviewed{" "}
          <Box component="span" data-quoted="true">
            {outcome.title || "this document"}
          </Box>{" "}
          - {lineCount} {lineCount === 1 ? "line" : "lines"}
        </Box>
      ) : null}

      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", p: 1, ...(TONE_SX[tone] ?? TONE_SX.info) }}>
        {tone === "warning" ? <WarningAmberIcon fontSize="small" sx={{ color: "var(--warning)", flexShrink: 0 }} /> : null}
        <Box>
          <Box sx={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>{headline}</Box>
          {notice.checked.length > 0 ? <Box sx={NOTE_SX}>Checked: {notice.checked.join(", ")}.</Box> : null}
          {notice.notChecked.length > 0 ? <Box sx={NOTE_SX}>Not fully checked: {notice.notChecked.join(", ")}.</Box> : null}
          {notice.sentences.map((sentence) => (
            <Box key={sentence} component="p" sx={NOTE_SX}>
              {sentence}
            </Box>
          ))}
        </Box>
      </Box>

      {summary ? (
        <Box component="p" sx={NOTE_SX}>
          {summary}
        </Box>
      ) : null}

      {reviewed ? (
        <ReviewFlagsPanel
          flags={outcome.flags}
          unresolvedQualifications={hideUnresolved ? [] : outcome.unresolvedQualifications}
          draftKind={outcome.draftKind === DRAFT_KIND.HYPOTHETICAL ? DRAFT_KIND.HYPOTHETICAL : DRAFT_KIND.APPLICATION_READY}
        />
      ) : null}

      {footer ? (
        <Box component="p" sx={FOOT_SX}>
          {footer}
        </Box>
      ) : null}
    </Box>
  );
}
