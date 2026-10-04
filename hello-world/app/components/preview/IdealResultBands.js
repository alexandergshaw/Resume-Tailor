"use client";

import { useId, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useIsMobile } from "@/app/hooks/useResponsive";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx";
import { BAND_COPY, FRESHNESS, idealBandState } from "@/lib/tailor/idealBandState";
import { REVIEW_KIND } from "@/lib/review/reviewVerdict";
import {
  DRAFT_KIND,
  PANEL_COPY,
  TIER,
  bandSummary,
  checkLabel,
  groupFlagsBySpan,
  textRows,
} from "@/lib/review/flagPresentation";
import ReviewFlagsPanel from "./ReviewFlagsPanel";
import { LeftOutGroup, RemovedGroup } from "./RemovedClaimsList";

// N105 Step 8-UI -- the Application-ready review band: the one place the review of
// an Ideal result is read. It composes the pure state machine (idealBandState)
// with the group leaves (RemovedGroup, ReviewFlagsPanel, LeftOutGroup).
//
//   ideal        the response's `ideal` block ({ applicationReady, review, ... })
//   currentText  the application-ready text now on screen
//   handEdited   the user edited this scope
//   onOutcome    the preview's announce seam, passed to the Copy line action
//
// K3, the property this component exists to protect: a partial or absent review
// must NEVER read as clean. Every word of chrome comes from idealBandState (its
// copy contains no clean-verdict phrase outside the single licensed state) or from
// lib/review/flagPresentation.js, and the clean verdict renders only when
// `state.verdictClean` is true. Nothing here decides "clean" for itself.
//
// Group order, what the user must do first to last: Removed, Confirm,
// Requirements, Could be stronger, Left out. A group with nothing in it is not
// rendered, in every state; in the one clean state only "Left out" can show (it
// records what the gate already refused, it is not a finding). The notice is
// static text present at open, so it needs no live region of its own.

const TONE_SX = {
  warning: { borderLeft: "4px solid var(--warning)", bgcolor: "var(--warning-soft)" },
  info: { borderLeft: "4px solid var(--accent)", bgcolor: "var(--accent-soft)" },
};

const ROOT_SX = { px: { xs: 1.25, sm: 2 }, py: 1, borderBottom: "1px solid var(--border)" };
// The expanded band has its own capped height at md and up; below md it is not a
// scroll container, so it never steals the page-scroll swipe on a phone.
const BODY_SX = {
  maxHeight: { xs: "none", md: ["45vh", "45dvh"] },
  overflowY: { xs: "visible", md: "auto" },
};
const NOTE_SX = { m: 0, mt: 0.75, fontSize: "0.82rem", color: "var(--text-primary)" };
const FOOT_SX = { m: 0, mt: 1, fontSize: "0.75rem", color: "var(--text-secondary)" };

// What ran and what did not, from `coverage`. When coverage is unusable, or says
// everything ran while the review is still partial (a contradiction), the honest
// line is "unknown": listing "everything" as checked would read as a clean bill.
function coverageLine(coverage) {
  const missing = coverage.missing.map(checkLabel);
  if (!coverage.usable || missing.length === 0) return BAND_COPY.partialUnknownCoverage;
  const ran = coverage.ran.map(checkLabel);
  const checked = ran.length > 0 ? `Checked: ${ran.join(", ")}. ` : "";
  return `${checked}Not fully checked: ${missing.join(", ")}. ${BAND_COPY.partialClosing}`;
}

export default function IdealResultBands({ ideal, currentText, handEdited, onOutcome }) {
  const bodyId = useId();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const state = idealBandState({ ideal, currentText, handEdited });
  const review = ideal?.review ?? null;

  // The band describes the application-ready file. Flags raised on the other
  // draft belong on that draft's own tab.
  const flags = (Array.isArray(review?.flags) ? review.flags : []).filter(
    (flag) => flag?.draftKind !== DRAFT_KIND.HYPOTHETICAL,
  );
  const rows = groupFlagsBySpan(flags, DRAFT_KIND.APPLICATION_READY);
  const confirmCount = rows.filter((row) => row.tier === TIER.CONFIRM).length;
  const removedCount = textRows(review?.removed).length;
  const requirementCount = textRows(review?.unresolvedQualifications).length;

  const showFindings = state.groups === "all";
  const summary = showFindings
    ? bandSummary({
        removed: removedCount,
        confirm: confirmCount,
        requirements: requirementCount,
        suggestions: rows.length - confirmCount,
      })
    : "";
  const bodyVisible = !isMobile || open;

  return (
    <Box component="section" aria-label="Application-ready resume review" sx={ROOT_SX}>
      {isMobile ? (
        <Button
          type="button"
          fullWidth
          aria-expanded={open}
          aria-controls={bodyId}
          endIcon={<ExpandMoreIcon sx={{ transform: open ? "rotate(180deg)" : "none" }} />}
          onClick={() => setOpen((value) => !value)}
          sx={{ minHeight: MOBILE_TAP_MIN, justifyContent: "space-between", textAlign: "left", textTransform: "none" }}
        >
          {state.mobileSummary}
        </Button>
      ) : null}

      <Box id={bodyId} hidden={!bodyVisible} sx={BODY_SX}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", p: 1, ...TONE_SX[state.tone] }}>
          {state.tone === "warning" ? (
            <WarningAmberIcon fontSize="small" sx={{ color: "var(--warning)", flexShrink: 0 }} />
          ) : null}
          <Box>
            <Box sx={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>{state.headline}</Box>
            {state.review === REVIEW_KIND.PARTIAL ? (
              <Box sx={NOTE_SX}>{coverageLine(state.coverage)}</Box>
            ) : null}
          </Box>
        </Box>

        {state.notes.map((note) => (
          <Box key={note} component="p" sx={NOTE_SX}>
            {note}
          </Box>
        ))}
        {summary ? (
          <Box component="p" sx={NOTE_SX}>
            {summary}
          </Box>
        ) : null}

        {showFindings ? (
          <>
            <RemovedGroup removed={review?.removed} onOutcome={onOutcome} />
            <ReviewFlagsPanel
              flags={flags}
              unresolvedQualifications={review?.unresolvedQualifications}
              draftKind={DRAFT_KIND.APPLICATION_READY}
            />
          </>
        ) : null}
        {state.groups !== "none" ? <LeftOutGroup leftOut={review?.leftOut} /> : null}

        {state.freshness !== FRESHNESS.OTHER_VERSION ? (
          <Box component="p" sx={FOOT_SX}>
            {PANEL_COPY.reviseOff}
          </Box>
        ) : null}
        {state.groups !== "none" ? (
          <Box component="p" sx={FOOT_SX}>
            {PANEL_COPY.sessionFooter}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
