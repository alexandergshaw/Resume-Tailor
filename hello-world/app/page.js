"use client";

import { useState } from "react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import styles from "./page.module.css";

export default function Home() {
  const [jobPosting, setJobPosting] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCompletedCall, setHasCompletedCall] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  function getDownloadFileName() {
    const fallback = "tailored-resume.docx";

    if (!resumeFile?.name) {
      return fallback;
    }

    const withoutExtension = resumeFile.name.replace(/\.[^/.]+$/, "");
    return `${withoutExtension}-tailored.docx`;
  }

  async function handleDownloadDocx() {
    if (!result.trim()) {
      setError("Nothing to download yet. Generate a resume first.");
      return;
    }

    setIsDownloading(true);

    try {
      const paragraphs = result.split("\n").map((line) => {
        if (!line.trim()) {
          return new Paragraph({ children: [new TextRun("")] });
        }

        return new Paragraph({ children: [new TextRun(line)] });
      });

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: paragraphs,
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getDownloadFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError.message || "Unable to download DOCX file.");
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setResult("");
    setHasCompletedCall(false);

    if (!jobPosting.trim()) {
      setError("Please provide a job posting.");
      return;
    }

    if (!resumeFile) {
      setError("Please upload a resume file.");
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

      setResult(payload.result?.trim() || "No output returned from Gemini.");
      setHasCompletedCall(true);
    } catch (submitError) {
      setError(submitError.message || "Unexpected error.");
      setHasCompletedCall(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Resume Tailor</h1>
        <p className={styles.subtitle}>
          Upload a resume (.txt, .md, or .docx) and a job posting, then Gemini
          will generate a tailored version that mirrors the original layout and
          formatting.
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
              accept=".txt,.md,.markdown,.docx"
              onChange={(event) => {
                setResumeFile(event.target.files?.[0] || null);
              }}
            />
          </div>

          <button className={styles.button} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Generating..." : "Generate"}
          </button>
        </form>

        {error ? <p className={styles.error}>{error}</p> : null}

        {hasCompletedCall && result ? (
          <section className={styles.resultSection}>
            <h2 className={styles.resultTitle}>Gemini Output</h2>
            <pre className={styles.result}>{result}</pre>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleDownloadDocx}
              disabled={isDownloading}
            >
              {isDownloading ? "Preparing DOCX..." : "Download Resume"}
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
