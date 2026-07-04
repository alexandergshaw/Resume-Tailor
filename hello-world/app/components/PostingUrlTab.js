"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import styles from "../page.module.css";

export default function PostingUrlTab({
  urlPosting,
  setUrlPosting,
  urlIsSubmitting,
  urlError,
  handleUrlSubmit,
  askAiAbout,
}) {
  return (
    <section className={styles.tabPanel}>
      <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
        Paste a job posting URL &mdash; it&apos;s fetched and tailored automatically.
      </Typography>

      <form
        className={styles.form}
        onSubmit={handleUrlSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <TextField
          id="job-posting-url"
          type="url"
          label="Job Posting URL"
          fullWidth
          placeholder="https://..."
          value={urlPosting}
          onChange={(e) => setUrlPosting(e.target.value)}
        />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button type="submit" variant="contained" disabled={urlIsSubmitting}>
            {urlIsSubmitting ? "Generating..." : "Generate"}
          </Button>
          <Button
            variant="outlined"
            disabled={!urlPosting.trim()}
            onClick={() =>
              askAiAbout({
                label: `Job Posting URL: ${urlPosting.trim()}`,
                content: `Job Posting URL: ${urlPosting.trim()}`,
              })
            }
          >
            Ask AI
          </Button>
        </Box>
      </form>

      {urlError ? <Alert severity="error">{urlError}</Alert> : null}
    </section>
  );
}
