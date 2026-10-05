"use client";

import { useEffect, useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { DRAFT_KIND } from "@/lib/review/flagPresentation";
import { runDocumentReview } from "@/lib/review/runDocumentReview.js";
import { REVIEW_FRESHNESS, REVIEW_STATE, reviewPresentationState } from "@/lib/review/reviewPresentation";
import DocumentReviewResult from "./DocumentReviewResult";

// N103 Step 6 -- the review control and its result, ONE component for both
// surfaces: the preview modal's band slot and the Ask-AI chat's composer area.
//
//   request   { kind, title, resultLines?|text?, posting?, realMaterial? } -- what
//             runDocumentReview takes -- or null when there is no document
//   surface   "modal" | "chat"
//   announce  the host's announcer ({ polite } | { alert, persist }); the modal
//             hands in its already-mounted live-region pair, the chat its progress
//             cue. This component mounts NO live region of its own.
//   busy      the host is mid-send (chat): a review does not interleave with it
//   covered   another surface already shows a live review of exactly this text, so
//             activating says so instead of showing a second verdict
//   loadRealMaterialLines  async () => string[]: the candidate's real resume, read
//             on activation (the modal holds the uploaded file). A failure leaves
//             the review to run without it, and the result says so.
//   onReviewed  ({ text, outcome }) after a review that really ran on `text`, so
//             the host can tell which text its latest review describes (N104)
//   regenerateReport / regenerateRow  nodes the host built (N104): the report of the
//             last regenerate, shown at the top of the result region, and the
//             Regenerate row, shown after it. This component decides nothing about
//             them; it only gives them their place.
//
// One action, no setup: a click runs the deterministic review (no key, no network,
// the same on every engine). The control never becomes `disabled` and never
// unmounts under focus; it is guarded in JS instead, with a synchronous ref so two
// clicks in one tick start ONE review. A result is kept against the document and
// text it was run on: it shows as stale once the text moves on, never over a
// different document, and a review that resolves after the document changed (or
// the section unmounted) is discarded. Nothing is persisted.

const NOUN = { resume: "resume", cover: "cover letter", hypothetical: "hypothetical resume" };

const NONE_CAPTION = "Nothing to review yet - open a tailored resume or cover letter and choose Ask AI, then review it here.";

const ROOT_SX = {
  modal: { px: { xs: 1.25, sm: 2 }, py: 1, borderBottom: "1px solid var(--border)" },
  chat: { px: 0.5, pb: 0.5 },
};
// The result scrolls inside itself, starting at its own header: in the modal two
// bands can share a short viewport (md and up only, so it never steals the page
// swipe on a phone); in the chat the card sits above the composer and must not
// push it off the panel.
const RESULT_SX = {
  modal: { mt: 1, maxHeight: { xs: "none", md: ["30vh", "30dvh"] }, overflowY: { xs: "visible", md: "auto" } },
  chat: { mt: 0.75, maxHeight: ["min(40vh, 280px)", "min(40dvh, 280px)"], overflowY: "auto" },
};

function textOf(request) {
  if (Array.isArray(request.resultLines) && request.resultLines.length > 0) return request.resultLines.join("\n");
  return typeof request.text === "string" ? request.text : "";
}

export default function DocumentReviewSection({
  request = null,
  surface = "modal",
  announce,
  busy = false,
  covered = false,
  loadRealMaterialLines,
  onReviewed,
  regenerateReport = null,
  regenerateRow = null,
}) {
  const helperId = useId();
  const [entry, setEntry] = useState(null);
  const [runningKey, setRunningKey] = useState(null);
  const inFlightRef = useRef(null);
  const currentKeyRef = useRef(null);

  const docKey = request ? JSON.stringify([request.kind, request.title]) : null;
  const textKey = request ? textOf(request) : null;
  const fullKey = request ? JSON.stringify([docKey, textKey]) : null;

  // The key of the document on screen right now, read by the async handler to
  // discard a review that outlived it. The cleanup nulls it, so a review that
  // resolves after this section unmounted is discarded too.
  useEffect(() => {
    currentKeyRef.current = fullKey;
    return () => {
      currentKeyRef.current = null;
    };
  }, [fullKey]);

  async function runWithInputs() {
    let req = request;
    if (typeof loadRealMaterialLines === "function" && request.kind !== DRAFT_KIND.HYPOTHETICAL && !request.realMaterial) {
      try {
        const lines = await loadRealMaterialLines();
        if (Array.isArray(lines)) req = { ...request, realMaterialLines: lines };
      } catch {
        // The review still runs; the missing input is named in the result.
      }
    }
    return runDocumentReview(req);
  }

  async function run() {
    if (!request || busy) return;
    const key = fullKey;
    if (inFlightRef.current === key) return;
    inFlightRef.current = key;
    setRunningKey(key);

    let result;
    if (covered) {
      result = { outcome: null, covered: true };
    } else {
      try {
        result = { outcome: await runWithInputs(), covered: false };
      } catch {
        result = { outcome: { status: "failed" }, covered: false };
      }
    }

    if (inFlightRef.current === key) inFlightRef.current = null;
    setRunningKey((current) => (current === key ? null : current));
    if (currentKeyRef.current !== key) return;

    setEntry({ docKey, textKey, ...result });
    if (result.outcome && !result.covered) onReviewed?.({ text: textKey, outcome: result.outcome });
    const spoken = reviewPresentationState(result);
    if (spoken.announce) {
      announce?.(spoken.state === REVIEW_STATE.FAILED ? { alert: spoken.announce, persist: true } : { polite: spoken.announce });
    }
  }

  if (!request) {
    return (
      <Box component="section" aria-label="Review" sx={ROOT_SX[surface] ?? ROOT_SX.modal}>
        <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{NONE_CAPTION}</Box>
      </Box>
    );
  }

  const noun = NOUN[request.scope] ?? "document";
  const running = runningKey === fullKey;
  // A covered result describes the text it covered; once the text moves on it
  // would claim coverage the other surface no longer gives.
  const shown = entry && entry.docKey === docKey && !(entry.covered && entry.textKey !== textKey) ? entry : null;
  const presentation = shown
    ? reviewPresentationState({
        outcome: shown.outcome,
        freshness: shown.textKey === textKey ? REVIEW_FRESHNESS.FRESH : REVIEW_FRESHNESS.STALE,
        covered: shown.covered,
      })
    : null;
  const unavailable = running || busy;
  const label = running ? "Reviewing..." : shown ? "Review again" : `Review ${noun}`;
  const caption = surface === "chat" ? request.title : `Checks this ${noun} for weak, unsupported and repeated lines.`;

  return (
    <Box component="section" aria-label={`Review of this ${noun}`} sx={ROOT_SX[surface] ?? ROOT_SX.modal}>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1.25, rowGap: 0.5 }}>
        <Button
          type="button"
          size="small"
          variant="outlined"
          onClick={run}
          aria-describedby={helperId}
          aria-disabled={unavailable ? "true" : undefined}
          aria-busy={running ? "true" : undefined}
          startIcon={running ? <CircularProgress size={14} aria-hidden="true" /> : <FactCheckOutlinedIcon fontSize="small" />}
          sx={{ textTransform: "none", ...TOUCH_TARGET_SX, ...(unavailable ? { opacity: 0.7 } : null) }}
        >
          {label}
        </Button>
        <Box id={helperId} sx={{ flex: 1, minWidth: 0, fontSize: "0.8rem", color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
          {caption || "Checks this document for weak, unsupported and repeated lines."}
        </Box>
      </Box>

      {presentation || regenerateReport ? (
        <Box sx={RESULT_SX[surface] ?? RESULT_SX.modal}>
          {regenerateReport}
          {presentation ? <DocumentReviewResult outcome={shown.outcome} presentation={presentation} /> : null}
        </Box>
      ) : null}
      {regenerateRow}
    </Box>
  );
}
