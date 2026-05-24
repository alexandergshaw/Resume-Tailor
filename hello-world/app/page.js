"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

export default function Home() {
  const [jobPosting, setJobPosting] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const buttonLabel = useMemo(() => {
    return isSubmitting ? "Generating..." : "Generate Tailored Draft";
  }, [isSubmitting]);

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setResult("");

    if (!jobPosting.trim()) {
      setError("Please provide a job posting.");
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("jobPosting", jobPosting);

      if (resumeFile) {
        formData.append("resume", resumeFile);
      }

      const response = await fetch("/api/tailor", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate a response.");
      }

      setResult(payload.result || "");
    } catch (submitError) {
      setError(submitError.message || "Unexpected error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Resume Tailor</h1>
        <p className={styles.subtitle}>
          Submit a job posting and your resume, then the backend calls Gemini to
          produce a tailored resume draft.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.fieldGroup}>
            <label htmlFor="job-posting" className={styles.label}>
              Job Posting
            </label>
            <textarea
              id="job-posting"
              name="jobPosting"
              className={styles.textarea}
              placeholder="Paste the full job posting here..."
              value={jobPosting}
              onChange={(event) => setJobPosting(event.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="resume" className={styles.label}>
              Resume
            </label>
            <input
              id="resume"
              name="resume"
              type="file"
              className={styles.fileInput}
              accept=".txt,.md,.pdf,.doc,.docx"
              onChange={(event) => {
                setResumeFile(event.target.files?.[0] || null);
              }}
            />
          </div>

          <button className={styles.button} type="submit" disabled={isSubmitting}>
            {buttonLabel}
          </button>
        </form>

        {error ? <p className={styles.error}>{error}</p> : null}

        {result ? (
          <section className={styles.resultSection}>
            <h2 className={styles.resultTitle}>Gemini Output</h2>
            <pre className={styles.result}>{result}</pre>
          </section>
        ) : null}
      </main>
    </div>
  );
}
