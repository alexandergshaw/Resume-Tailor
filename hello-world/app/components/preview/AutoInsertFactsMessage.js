"use client";

import Box from "@mui/material/Box";

// N77: tells the candidate the outcome of an AUTOMATIC insert attempt that
// happened without any click of theirs -- something InsertedFactsStrip's own
// `error` prop cannot do, since that strip renders nothing at all when no
// fact has ever been inserted (exactly the shape a refusal produces:
// `insertedFacts` stays empty, so InsertedFactsStrip returns null and the
// candidate sees nothing). Modeled on that same strip's own visible
// `role="alert"` error box (DocumentPreviewMount.js's "N61" comment, the
// removal path's shipped precedent) -- NOT on the dialog's separate
// visuallyHidden live regions in DriveResultRegion.js/CopyFeedback.js, which
// exist to ANNOUNCE a distinct in-dialog action and are never shown as
// on-screen text. A candidate reviewing this exact letter needs to SEE why
// nothing changed, not just have it read aloud.
//
// `severity` distinguishes the two outcomes this component ever renders:
//   - "failure": something is actually broken and has a remedy (regenerate
//     the letter, try again) -- role="alert", the assistive-tech default of
//     assertive.
//   - "info": a normal, unsurprising outcome (nothing new to add) -- role=
//     "status" + aria-live="polite", so a screen reader never treats an
//     ordinary state as an error.
// A THIRD outcome the caller may hold, "silent" (the letter was hand-edited;
// see useCompanyResearch.js's autoInsertFactsForJob), renders NOTHING here on
// purpose (owner ruling: never alarm the candidate over their own deliberate
// edit) -- the caller still records it to the activity log, just never
// passes it here as something to show.
export default function AutoInsertFactsMessage({ severity, text }) {
  if (!text || (severity !== "failure" && severity !== "info")) return null;
  const isFailure = severity === "failure";
  return (
    <Box
      role={isFailure ? "alert" : "status"}
      aria-live={isFailure ? undefined : "polite"}
      sx={{
        px: { xs: 1.25, sm: 2 },
        py: 1,
        fontSize: "0.8rem",
        color: isFailure ? "var(--danger)" : "var(--text-secondary)",
        borderBottom: "1px solid var(--border)",
        bgcolor: "var(--accent-soft)",
      }}
    >
      {text}
    </Box>
  );
}
