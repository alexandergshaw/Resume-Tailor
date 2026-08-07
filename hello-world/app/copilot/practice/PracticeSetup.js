"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import InterviewTypePicker from "./InterviewTypePicker";
import PostingPicker from "../PostingPicker";
import SubmittedDocs from "../SubmittedDocs";
import PrepContext from "../PrepContext";

// Presentational block for practice mode's setup controls: the privacy
// notice, the prep-context editor, the error/warning alerts, the interview
// type picker, the posting picker, and the submitted-documents panel. All
// state (profile, error, warning, interviewType, posting, submittedDocs)
// lives in PracticeClient — this only renders what it's given and calls
// back on interview-type change, posting change, profile change, and
// warning dismissal.
export default function PracticeSetup({
  privacyNotice,
  profile,
  onProfileChange,
  error,
  warning,
  onDismissWarning,
  interviewType,
  onInterviewTypeChange,
  posting,
  onPostingChange,
  submittedDocs,
}) {
  return (
    <>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        {privacyNotice}
      </Typography>

      <PrepContext value={profile} onChange={onProfileChange} />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {warning ? (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={onDismissWarning}>
          {warning}
        </Alert>
      ) : null}

      <Box sx={{ mb: 2 }}>
        <InterviewTypePicker value={interviewType} onChange={onInterviewTypeChange} disabled={false} />
      </Box>

      <Box sx={{ mb: 2 }}>
        <PostingPicker value={posting} onChange={onPostingChange} disabled={false} />
      </Box>

      {/* AC-H3.11: rendered whenever a posting is selected, in BOTH modes,
          and absent entirely otherwise — never shown in some disabled/empty
          state for "no posting". */}
      {posting ? (
        <SubmittedDocs
          status={submittedDocs.status}
          resume={submittedDocs.resume}
          coverLetter={submittedDocs.coverLetter}
          error={submittedDocs.error}
          onRetry={submittedDocs.retry}
        />
      ) : null}
    </>
  );
}
