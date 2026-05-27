"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

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
        <Box>
          <Button type="submit" variant="contained" disabled={urlIsSubmitting}>
            {urlIsSubmitting ? "Generating..." : "Generate"}
          </Button>
          <Button
            variant="outlined"
            sx={{ ml: 1 }}
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

      {urlError ? <p className={styles.error}>{urlError}</p> : null}
    </section>
  );
}
