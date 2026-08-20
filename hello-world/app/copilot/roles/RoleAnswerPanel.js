"use client";

import { useEffect, useRef } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import AnswerFeedback from "../practice/AnswerFeedback";
import AnswerReview from "../practice/AnswerReview";

// AC-R1.3/AC-R1.6/AC-R1.7: renders exactly what practice mode renders for a
// completed answer — AnswerReview and AnswerFeedback reused unmodified, not
// reimplemented (see WAVE2-BRIEF.md's reuse survey), with the three save
// alerts copied verbatim from PracticeClient.js's own block so this mode's
// save reporting reads identically to practice mode's. The only differences
// from that block: no `interviewTypeLabel` (a role drill has no interview
// type to judge against — AC-R1.4), and `nextLabel="New situation"` so the
// drill's own loop replaces practice mode's "Next question" wording
// (AC-R1.7). RoleDrillClient owns the `!answering && !settling &&
// answerMetrics` gate that decides whether this mounts at all — same split
// PracticeClient.js draws around its own identical block.
export default function RoleAnswerPanel({
  answerTranscript,
  answerMetrics,
  replayUrl,
  replaySupported,
  saveStatus,
  saveError,
  critiqueStatus,
  critique,
  critiqueError,
  critiqueFramesSent,
  onRetryCritique,
  onNewSituation,
  onTryAgain,
}) {
  // Focus management (rough edge, adversarial review): this panel replaces
  // "Done" with a bare spinner and then, once the critique settles, this
  // whole review — a keyboard user pressing the advertised one-press action
  // has their focus stranded on `<body>` with no indication anything
  // happened. AnswerReview's own "Answer review" <h3> (the FIRST heading
  // this panel renders — see AnswerReview.js) is given `tabIndex={-1}` and
  // focused imperatively, once, right after this panel mounts. Imperative
  // rather than a `tabIndex` prop passed into AnswerReview: that component
  // is not on this wave's allowed-files list, so its own JSX cannot carry
  // the attribute — this reads it back out of the DOM instead, the same way
  // a ref-based focus effect would target any third-party heading. Never
  // `autoFocus`: that fires on every mount unconditionally and fights a
  // screen reader's own navigation instead of being an announced focus
  // change.
  const panelRef = useRef(null);
  useEffect(() => {
    const heading = panelRef.current?.querySelector("h3");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }, []);

  return (
    <Box ref={panelRef}>
      <AnswerReview
        transcript={answerTranscript}
        metrics={answerMetrics}
        replayUrl={replayUrl}
        replaySupported={replaySupported}
      />
      {saveStatus === "saving" ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Saving this answer to your practice history…
        </Alert>
      ) : null}
      {saveStatus === "saved" ? (
        <Alert severity={saveError ? "warning" : "success"} sx={{ mb: 2 }}>
          {saveError ? `Saved to your practice history. ${saveError}` : "Saved to your practice history."}
        </Alert>
      ) : null}
      {saveStatus === "failed" ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This answer was not saved to your practice history: {saveError || "an unknown error occurred."}
        </Alert>
      ) : null}
      <AnswerFeedback
        status={critiqueStatus}
        feedback={critique}
        error={critiqueError}
        framesSent={critiqueFramesSent}
        bodyLanguageReason={answerMetrics?.bodyLanguage?.reason || null}
        onRetry={onRetryCritique}
        onNext={onNewSituation}
        onTryAgain={onTryAgain}
        nextLabel="New situation"
      />
    </Box>
  );
}
