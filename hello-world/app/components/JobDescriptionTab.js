"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

import styles from "../page.module.css";

export default function JobDescriptionTab({
  jobPosting,
  setJobPosting,
  manualIsSubmitting,
  manualError,
  handleManualSubmit,
  askAiAbout,
  tailorEngine,
  onReviewFields,
}) {
  return (
    <section className={styles.tabPanel}>
      <form
        className={styles.form}
        onSubmit={handleManualSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <TextField
          id="job-posting"
          name="jobPosting"
          label="Job Posting"
          multiline
          rows={10}
          fullWidth
          placeholder="Paste the full job posting here..."
          value={jobPosting}
          onChange={(e) => setJobPosting(e.target.value)}
        />
        <Box>
          <Button type="submit" variant="contained" disabled={manualIsSubmitting}>
            {manualIsSubmitting ? "Generating..." : "Generate"}
          </Button>
          <Button
            variant="outlined"
            sx={{ ml: 1 }}
            disabled={!jobPosting.trim()}
            onClick={() =>
              askAiAbout({
                label: "Pasted Job Description",
                content: `Pasted Job Description:\n${jobPosting}`,
              })
            }
          >
            Ask AI
          </Button>
          {(tailorEngine === "external" || tailorEngine === "embedded") && onReviewFields ? (
            <Button
              variant="outlined"
              sx={{ ml: 1 }}
              disabled={!jobPosting.trim() || manualIsSubmitting}
              onClick={onReviewFields}
            >
              Review &amp; edit fields
            </Button>
          ) : null}
        </Box>
      </form>

      {manualError ? <p className={styles.error}>{manualError}</p> : null}
    </section>
  );
}
