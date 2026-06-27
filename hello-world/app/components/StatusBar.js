"use client";

import { useState } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import DescriptionIcon from "@mui/icons-material/Description";
import styles from "../page.module.css";
import { useIsMobile } from "../hooks/useResponsive";

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
  handleToggleApplied,
  handleIgnoreJob,
  handleUntrackJob,
  openResumePreview,
  openCompanyResearch,
  onRegenerate,
}) {
  const isMobile = useIsMobile();
  // On phones the bar defaults to the roomier vertical list.
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState({ anchorEl: null, jobId: null });

  if (trackedJobs.length === 0) return null;

  const vertical = expanded || isMobile;

  function jobFlags(job) {
    const tailoring = tailoringMap[job.id] || {};
    const status = tailoring.status;
    const fullJob = jobResults.find((j) => j.id === job.id);
    const isTailoringChip = status === "tailoring";
    const isSynthetic =
      typeof job.id === "string" && (job.id.startsWith("url-") || job.id.startsWith("manual-"));
    const canRegenerateSynthetic =
      isSynthetic &&
      !!resumeFile &&
      !isTailoringChip &&
      ((job.id.startsWith("url-") && !!job.url) ||
        (job.id.startsWith("manual-") && !!job.description));
    const canRegenerate = isSynthetic
      ? canRegenerateSynthetic
      : !!resumeFile && !!fullJob && !isTailoringChip;
    return { tailoring, status, fullJob, isSynthetic, canRegenerate };
  }

  const openMenu = (e, jobId) => setMenu({ anchorEl: e.currentTarget, jobId });
  const closeMenu = () => setMenu({ anchorEl: null, jobId: null });
  const runAndClose = (fn) => {
    closeMenu();
    fn?.();
  };

  function goToCard(job) {
    const isUrlJob = typeof job.id === "string" && job.id.startsWith("url-");
    const isManualJob = typeof job.id === "string" && job.id.startsWith("manual-");
    const targetSection = isUrlJob ? "url" : isManualJob ? "manual" : "search";
    setMainTab("applying");
    setActiveSection(targetSection);
    if (targetSection === "search") {
      setHighlightedJobId(job.id);
      setTimeout(() => setHighlightedJobId(null), 3000);
      setTimeout(() => {
        const card = document.getElementById(`job-card-${job.id}`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  }

  function regenerate(job, scope) {
    const { fullJob, isSynthetic } = jobFlags(job);
    if (isSynthetic) onRegenerate?.(job, scope);
    else if (fullJob) onRegenerate?.(fullJob, scope);
  }

  // The currently-open menu's job and its flags.
  const menuJob = menu.jobId ? trackedJobs.find((j) => j.id === menu.jobId) : null;
  const menuFlags = menuJob ? jobFlags(menuJob) : null;

  // Whether a tailoring entry has resume / cover-letter content to preview.
  function previewable(tailoring) {
    const hasResume = typeof tailoring?.result === "string" && tailoring.result.trim().length > 0;
    const hasCover =
      Array.isArray(tailoring?.coverLetterResultLines) && tailoring.coverLetterResultLines.length > 0;
    return { hasResume, hasCover, hasAny: hasResume || hasCover };
  }

  function renderChip(job) {
    const { tailoring, status } = jobFlags(job);
    const { hasResume, hasAny } = previewable(tailoring);
    const stateClass =
      status === "done"
        ? ` ${styles.toolbarChipDone}`
        : status === "tailoring"
          ? ` ${styles.toolbarChipGenerating}`
          : status === "error"
            ? ` ${styles.toolbarChipError}`
            : "";
    return (
      <div
        key={job.id}
        className={`${styles.toolbarChip}${stateClass}`}
        style={vertical ? { width: "100%", flexShrink: 0 } : undefined}
      >
        <span className={styles.toolbarChipTitle} style={vertical ? { maxWidth: "none", flex: 1 } : undefined}>
          {job.title}
        </span>
        {job.company ? <span className={styles.toolbarChipCompany}>{job.company}</span> : null}
        {status === "done" ? (
          <span className={styles.toolbarChipBadge}>✓ Ready</span>
        ) : status === "tailoring" ? (
          <span className={styles.toolbarChipBadge}>Generating…</span>
        ) : null}
        <div className={styles.toolbarChipActions}>
          {status === "done" && hasAny ? (
            <span
              role="button"
              tabIndex={0}
              draggable={hasResume && isDocxResume(resumeFile)}
              className={styles.toolbarChipBtn}
              title={
                hasResume && isDocxResume(resumeFile)
                  ? "Preview / edit resume & cover letter · drag to upload"
                  : "Preview / edit resume & cover letter"
              }
              style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }}
              onClick={() => openResumePreview?.(job)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openResumePreview?.(job);
                }
              }}
              onDragStart={async (e) => {
                if (!isDocxResume(resumeFile)) return;
                try {
                  const t = tailoringMap[job.id] || {};
                  const text = typeof t.result === "string" ? t.result : "";
                  const lines = Array.isArray(t.resultLines) ? t.resultLines : [];
                  if (!text) return;
                  const blob = await buildDocxFromUploadedTemplate(resumeFile, text, lines);
                  const fileName = getDownloadFileNameForTitle(t.generatedJobTitle || job.title, job.company);
                  const file = new File([blob], fileName, {
                    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  });
                  e.dataTransfer.clearData();
                  e.dataTransfer.effectAllowed = "copy";
                  if (e.dataTransfer.items) e.dataTransfer.items.add(file);
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
            title="More actions"
            aria-label="More actions"
            onClick={(e) => openMenu(e, job.id)}
          >
            ⋯
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.floatingToolbar}
      onWheel={vertical ? undefined : handleToolbarWheel}
      style={vertical ? { flexDirection: "column", alignItems: "stretch", gap: 8 } : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: vertical ? "100%" : "auto" }}>
        <span className={styles.toolbarLabel}>Generated ({trackedJobs.length})</span>
        <button
          type="button"
          className={styles.toolbarClear}
          onClick={() => setExpanded((v) => !v)}
          aria-label={vertical ? "Collapse list" : "Expand list"}
          title={vertical ? "Collapse" : "Expand"}
          style={isMobile ? { display: "none" } : undefined}
        >
          {expanded ? "▾ Collapse" : "▸ Expand"}
        </button>
        {!vertical ? (
          <button
            type="button"
            className={`${styles.toolbarArrow} ${!toolbarCanScrollLeft ? styles.toolbarArrowHidden : ""}`}
            onClick={() => scrollToolbar(-1)}
            aria-label="Scroll left"
          >
            ‹
          </button>
        ) : null}
        {vertical ? <div style={{ flex: 1 }} /> : null}
        {vertical ? (
          <button type="button" className={styles.toolbarClear} onClick={() => setTrackedJobs([])}>
            Clear all
          </button>
        ) : null}
      </div>

      {vertical ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: "50vh",
            overflowY: "auto",
            width: "100%",
          }}
        >
          {trackedJobs.map((job) => renderChip(job))}
        </div>
      ) : (
        <>
          <div className={styles.toolbarItems} ref={toolbarScrollRef} onScroll={handleToolbarScroll}>
            {trackedJobs.map((job) => renderChip(job))}
          </div>
          <button
            type="button"
            className={`${styles.toolbarArrow} ${!toolbarCanScrollRight ? styles.toolbarArrowHidden : ""}`}
            onClick={() => scrollToolbar(1)}
            aria-label="Scroll right"
          >
            ›
          </button>
          <button type="button" className={styles.toolbarClear} onClick={() => setTrackedJobs([])}>
            Clear all
          </button>
        </>
      )}

      <Menu anchorEl={menu.anchorEl} open={Boolean(menu.anchorEl)} onClose={closeMenu}>
        {menuJob && menuFlags
          ? [
              menuFlags.status === "done" && previewable(menuFlags.tailoring).hasAny ? (
                <MenuItem key="preview" onClick={() => runAndClose(() => openResumePreview?.(menuJob))}>
                  Preview / edit documents
                </MenuItem>
              ) : null,
              menuFlags.status === "done" && previewable(menuFlags.tailoring).hasCover ? (
                <MenuItem key="preview-cover" onClick={() => runAndClose(() => openResumePreview?.(menuJob, { tab: "cover" }))}>
                  Preview cover letter
                </MenuItem>
              ) : null,
              <MenuItem key="download" onClick={() => runAndClose(() => downloadResumeForChipJob(menuJob))}>
                Download résumé + cover letter
              </MenuItem>,
              <Divider key="d1" />,
              <MenuItem
                key="regen-resume"
                disabled={!menuFlags.canRegenerate}
                onClick={() => runAndClose(() => regenerate(menuJob, "resume"))}
              >
                Regenerate résumé
              </MenuItem>,
              <MenuItem
                key="regen-cover"
                disabled={!menuFlags.canRegenerate}
                onClick={() => runAndClose(() => regenerate(menuJob, "cover"))}
              >
                Regenerate cover letter
              </MenuItem>,
              <MenuItem
                key="regen-both"
                disabled={!menuFlags.canRegenerate}
                onClick={() => runAndClose(() => regenerate(menuJob, "both"))}
              >
                Regenerate both
              </MenuItem>,
              <Divider key="d2" />,
              <MenuItem
                key="ai"
                onClick={() =>
                  runAndClose(() => {
                    const jobForContext = menuFlags.fullJob || menuJob;
                    const tailoredContent = menuFlags.tailoring?.result
                      ? `\n\nTailored Resume:\n${menuFlags.tailoring.result}`
                      : "";
                    askAiAbout({
                      label: `${menuJob.title || "Job"}${menuJob.company ? ` · ${menuJob.company}` : ""}`,
                      content: `${buildJobContextString(jobForContext)}${tailoredContent}`,
                      prompt: `Help me with the ${menuJob.title || "this"} role${menuJob.company ? ` at ${menuJob.company}` : ""}: `,
                      sourceJobId: menuJob.id,
                    });
                  })
                }
              >
                Ask AI
              </MenuItem>,
              <MenuItem
                key="research"
                disabled={!menuJob.company}
                onClick={() => runAndClose(() => openCompanyResearch?.(menuJob))}
              >
                Research company
              </MenuItem>,
              <MenuItem key="card" onClick={() => runAndClose(() => goToCard(menuJob))}>
                Go to card
              </MenuItem>,
              menuJob.url ? (
                <MenuItem
                  key="posting"
                  onClick={() =>
                    runAndClose(() => {
                      downloadResumeForChipJob(menuJob).catch(() => {});
                      window.open(menuJob.url, "_blank", "noopener,noreferrer");
                    })
                  }
                >
                  Open posting
                </MenuItem>
              ) : null,
              <Divider key="d3" />,
              <MenuItem
                key="applied"
                disabled={menuFlags.isSynthetic}
                onClick={() => runAndClose(() => handleToggleApplied(menuJob))}
              >
                Mark as applied
              </MenuItem>,
              <MenuItem
                key="ignore"
                disabled={menuFlags.isSynthetic}
                onClick={() =>
                  runAndClose(() => {
                    handleIgnoreJob(menuJob.id);
                    handleUntrackJob(menuJob.id);
                  })
                }
              >
                Ignore
              </MenuItem>,
              <MenuItem key="remove" onClick={() => runAndClose(() => handleUntrackJob(menuJob.id))}>
                Remove
              </MenuItem>,
            ].filter(Boolean)
          : null}
      </Menu>
    </div>
  );
}
