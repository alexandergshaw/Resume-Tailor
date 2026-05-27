"use client";

import DescriptionIcon from "@mui/icons-material/Description";
import styles from "../page.module.css";

export default function StatusBar({
  trackedJobs,
  setTrackedJobs,
  tailoringMap,
  jobResults,
  resumeFile,
  toolbarScrollRef,
  toolbarCanScrollLeft,
  toolbarCanScrollRight,
  handleToolbarWheel,
  handleToolbarScroll,
  scrollToolbar,
  isDocxResume,
  buildDocxFromUploadedTemplate,
  getDownloadFileNameForTitle,
  askAiAbout,
  buildJobContextString,
  setMainTab,
  setActiveSection,
  setHighlightedJobId,
  downloadResumeForChipJob,
  handleRegenerateSyntheticJob,
  handleTailorJob,
  handleToggleApplied,
  handleIgnoreJob,
  handleUntrackJob,
}) {
  if (trackedJobs.length === 0) return null;

  return (
    <div className={styles.floatingToolbar} onWheel={handleToolbarWheel}>
      <span className={styles.toolbarLabel}>Generated ({trackedJobs.length})</span>
      <button
        type="button"
        className={`${styles.toolbarArrow} ${!toolbarCanScrollLeft ? styles.toolbarArrowHidden : ""}`}
        onClick={() => scrollToolbar(-1)}
        aria-label="Scroll left"
      >
        ‹
      </button>
      <div
        className={styles.toolbarItems}
        ref={toolbarScrollRef}
        onScroll={handleToolbarScroll}
      >
        {trackedJobs.map((job) => {
          const tailoring = tailoringMap[job.id] || {};
          const status = tailoring.status;
          const fullJob = jobResults.find((j) => j.id === job.id);
          const isTailoringChip = status === "tailoring";
          const isSynthetic =
            typeof job.id === "string" &&
            (job.id.startsWith("url-") || job.id.startsWith("manual-"));
          const canRegenerateSynthetic =
            isSynthetic &&
            !!resumeFile &&
            !isTailoringChip &&
            ((job.id.startsWith("url-") && !!job.url) ||
              (job.id.startsWith("manual-") && !!job.description));
          const canRegenerate = isSynthetic
            ? canRegenerateSynthetic
            : !!resumeFile && !!fullJob && !isTailoringChip;
          return (
            <div
              key={job.id}
              className={`${styles.toolbarChip}${
                status === "done" ? ` ${styles.toolbarChipDone}` :
                status === "tailoring" ? ` ${styles.toolbarChipGenerating}` :
                status === "error" ? ` ${styles.toolbarChipError}` : ""
              }`}
            >
              <span className={styles.toolbarChipTitle}>{job.title}</span>
              {job.company ? <span className={styles.toolbarChipCompany}>{job.company}</span> : null}
              {status === "done" ? (
                <span className={styles.toolbarChipBadge}>✓ Ready</span>
              ) : status === "tailoring" ? (
                <span className={styles.toolbarChipBadge}>Generating…</span>
              ) : null}
              <div className={styles.toolbarChipActions}>
                {status === "done" && isDocxResume(resumeFile) ? (
                  <span
                    draggable
                    className={styles.toolbarChipBtn}
                    title="Drag tailored resume to upload"
                    style={{ cursor: "grab", display: "inline-flex", alignItems: "center" }}
                    onDragStart={async (e) => {
                      try {
                        const t = tailoringMap[job.id] || {};
                        const text = typeof t.result === "string" ? t.result : "";
                        const lines = Array.isArray(t.resultLines) ? t.resultLines : [];
                        if (!text) return;
                        const blob = await buildDocxFromUploadedTemplate(resumeFile, text, lines);
                        const fileName = getDownloadFileNameForTitle(
                          t.generatedJobTitle || job.title,
                          job.company,
                        );
                        const file = new File([blob], fileName, {
                          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        });
                        e.dataTransfer.clearData();
                        e.dataTransfer.effectAllowed = "copy";
                        if (e.dataTransfer.items) {
                          e.dataTransfer.items.add(file);
                        }
                      } catch (err) {
                        console.warn("[chip drag] failed:", err);
                      }
                    }}
                  >
                    <DescriptionIcon fontSize="small" />
                  </span>
                ) : null}
                <button
                  type="button"
                  className={styles.toolbarChipBtn}
                  title="Ask AI about this job"
                  onClick={() => {
                    const jobForContext = fullJob || job;
                    const tailoredContent = tailoring?.result ? `\n\nTailored Resume:\n${tailoring.result}` : "";
                    askAiAbout({
                      label: `${job.title || "Job"}${job.company ? ` · ${job.company}` : ""}`,
                      content: `${buildJobContextString(jobForContext)}${tailoredContent}`,
                      prompt: `Help me with the ${job.title || "this"} role${job.company ? ` at ${job.company}` : ""}: `,
                      sourceJobId: job.id,
                    });
                  }}
                >
                  AI
                </button>
                <button
                  type="button"
                  className={styles.toolbarChipBtn}
                  title="Go to card"
                  onClick={() => {
                    const isUrlJob =
                      typeof job.id === "string" && job.id.startsWith("url-");
                    const isManualJob =
                      typeof job.id === "string" && job.id.startsWith("manual-");
                    const targetSection = isUrlJob
                      ? "url"
                      : isManualJob
                        ? "manual"
                        : "search";
                    setMainTab("applying");
                    setActiveSection(targetSection);
                    if (targetSection === "search") {
                      setHighlightedJobId(job.id);
                      setTimeout(() => setHighlightedJobId(null), 3000);
                      setTimeout(() => {
                        const card = document.getElementById(`job-card-${job.id}`);
                        if (card) {
                          card.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                      }, 50);
                    }
                  }}
                >
                  ↩
                </button>
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.toolbarChipBtn}
                  title="View posting (also downloads tailored resume)"
                  onClick={() => {
                    // Fire-and-forget download so the new tab still opens
                    // immediately. Re-downloads every time the chip link
                    // is clicked, even if already downloaded earlier.
                    downloadResumeForChipJob(job).then((err) => {
                      if (err) {
                        console.warn("[chip posting link] download skipped:", err);
                      }
                    });
                  }}
                >
                  ↗
                </a>
                <button
                  type="button"
                  className={styles.toolbarChipBtn}
                  title={
                    canRegenerate
                      ? "Regenerate"
                      : !resumeFile
                        ? "Upload a resume first"
                        : "Regenerate"
                  }
                  disabled={!canRegenerate}
                  onClick={() => {
                    if (isSynthetic) {
                      handleRegenerateSyntheticJob(job);
                    } else if (fullJob) {
                      handleTailorJob(fullJob);
                    }
                  }}
                >
                  ↺
                </button>
                <button
                  type="button"
                  className={styles.toolbarChipBtn}
                  title={isSynthetic ? "Not available for generated postings" : "Mark as applied"}
                  disabled={isSynthetic}
                  onClick={() => handleToggleApplied(job)}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className={styles.toolbarChipBtn}
                  title={isSynthetic ? "Not available for generated postings" : "Ignore"}
                  disabled={isSynthetic}
                  onClick={() => { handleIgnoreJob(job.id); handleUntrackJob(job.id); }}
                >
                  ⊗
                </button>
                <button
                  type="button"
                  className={styles.toolbarChipRemove}
                  title="Remove"
                  onClick={() => handleUntrackJob(job.id)}
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={`${styles.toolbarArrow} ${!toolbarCanScrollRight ? styles.toolbarArrowHidden : ""}`}
        onClick={() => scrollToolbar(1)}
        aria-label="Scroll right"
      >
        ›
      </button>
      <button
        type="button"
        className={styles.toolbarClear}
        onClick={() => setTrackedJobs([])}
      >
        Clear all
      </button>
    </div>
  );
}
