import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Resume Tailor</h1>

        <div className={styles.fieldGroup}>
          <label htmlFor="job-posting" className={styles.label}>
            Job Posting
          </label>
          <textarea
            id="job-posting"
            name="jobPosting"
            className={styles.textarea}
            placeholder="Paste the full job posting here..."
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
            accept=".pdf,.doc,.docx,.txt"
          />
        </div>
      </main>
    </div>
  );
}
