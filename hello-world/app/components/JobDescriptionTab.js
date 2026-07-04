"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

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
      <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
        Paste a full job description to generate a tailored resume and cover letter.
      </Typography>

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
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button type="submit" variant="contained" disabled={manualIsSubmitting}>
            {manualIsSubmitting ? "Generating..." : "Generate"}
          </Button>
          <Button
            variant="outlined"
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
          {tailorEngine === "external" && onReviewFields ? (
            <Button
              variant="outlined"
              disabled={!jobPosting.trim() || manualIsSubmitting}
              onClick={onReviewFields}
            >
              Review &amp; edit fields
            </Button>
          ) : null}
        </Box>
      </form>

      {manualError ? <Alert severity="error">{manualError}</Alert> : null}
    </section>
  );
}
