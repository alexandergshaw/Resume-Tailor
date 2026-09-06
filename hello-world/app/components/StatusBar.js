"use client";

import { useState } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import DescriptionIcon from "@mui/icons-material/Description";
import styles from "../page.module.css";
import { useIsMobile } from "../hooks/useResponsive";
import { resolveDocumentBlob } from "../../lib/document/docx";
import { selectAppliedToggleAction } from "../../lib/applications/applicationDecisions";
import { openPostingBeside } from "../../lib/window/openPostingBeside";

// edited/*: a tailoring entry's hand-edit flag, per scope ({ resume, cover }),
// mirroring the helper in app/hooks/useDocumentPreview.js. An object is
// ALWAYS truthy, so every read must go through this — never `!!entry.edited`.
// Tolerates a missing field (treated as not edited) and a legacy plain
// boolean from before this migration — a legacy `true` reads as edited on
// BOTH scopes (the safe direction: it still forces a rebuild instead of
// risking a stale verbatim-serve).
function editedForScope(entry, scope) {
  const e = entry?.edited;
  if (e && typeof e === "object") return !!e[scope];
  return !!e;
}

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
  getDownloadFileNameForTitle,
  askAiAbout,
  buildJobContextString,
  setMainTab,
  setActiveSection,
  downloadResumeForChipJob,
  handleToggleApplied,
  handleIgnoreJob,
  handleUntrackJob,
  openResumePreview,
  openCompanyResearch,
  onRegenerate,
  appliedByExternalId,
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

  // The url/manual/screenshots section tabs (app/page.js's NavTabs at
  // ~line 2781) live under `mainTab === "manualApplying"`, not "applying"
  // (that now renders the unrelated Materials tab) -- and that section set
  // has no "search" entry at all; the "search" section was JobSearchTab.js,
  // deleted in e8c6427, along with the only DOM elements a `job-card-${id}`
  // lookup could ever find. A url-/manual- job is the only tracked-job shape
  // with a real, reachable owning section today, so this only ever routes
  // those two; the caller (the "Go to card" MenuItem below) is hidden
  // entirely for every other job shape rather than silently sending it to a
  // section that no longer exists.
  function goToCard(job) {
    const isUrlJob = typeof job.id === "string" && job.id.startsWith("url-");
    const isManualJob = typeof job.id === "string" && job.id.startsWith("manual-");
    if (!isUrlJob && !isManualJob) return;
    setMainTab("manualApplying");
    setActiveSection(isUrlJob ? "url" : "manual");
  }

  function regenerate(job, scope) {
    const { fullJob, isSynthetic } = jobFlags(job);
    if (isSynthetic) onRegenerate?.(job, scope);
    else if (fullJob) onRegenerate?.(fullJob, scope);
  }

  // The currently-open menu's job and its flags.
  const menuJob = menu.jobId ? trackedJobs.find((j) => j.id === menu.jobId) : null;
  const menuFlags = menuJob ? jobFlags(menuJob) : null;

  // "Mark as applied" no longer toggles (R1: this control only ever
  // promotes, never demotes — see test/repro/appliedStatusDataLoss.test.js
  // REPRO D1 for what an un-apply used to do to a real applied_at). Its
  // label and enabled state come from the SAME classification
  // `handleToggleApplied` acts on, never re-derived here — a row already
  // applied-or-later gets "Open in Tracking" instead of a second "apply".
  // `appliedByExternalId` is null until it has loaded (or for a signed-out
  // session, which has no `applications` row to classify at all); default to
  // the promote-only action so the item degrades to today's behaviour rather
  // than disabling itself on an absent map.
  const appliedAction = menuJob && appliedByExternalId
    ? selectAppliedToggleAction(appliedByExternalId, menuJob.id)
    : "apply";
  const appliedMenuItem = {
    label: appliedAction === "open-tracking" ? "Open in Tracking" : "Mark as applied",
    disabled:
      appliedAction === "open-tracking"
        ? false
        : !!menuFlags?.isSynthetic || appliedAction === "refuse-unknown",
  };

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
                  const blob = await resolveDocumentBlob({
                    engineDocxB64: typeof t.docxB64 === "string" ? t.docxB64 : "",
                    docxPath: typeof t.docxPath === "string" ? t.docxPath : "",
                    edited: editedForScope(t, "resume"),
                    text,
                    lines,
                    uploadedTemplate: resumeFile,
                  });
                  if (!blob) return;
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
              <MenuItem
                key="preview"
                disabled={!previewable(menuFlags.tailoring).hasAny}
                onClick={() => runAndClose(() => openResumePreview?.(menuJob))}
              >
                Preview / edit résumé & cover letter
              </MenuItem>,
              previewable(menuFlags.tailoring).hasCover ? (
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
              // Only a url-/manual- job has a section left to go to (see
              // goToCard above) -- offering this for a feed-/search-sourced
              // job would silently select a dead section (fixed defect: it
              // used to send those to a "search" section NavTabs has not
              // rendered since e8c6427 deleted JobSearchTab.js).
              menuFlags.isSynthetic ? (
                <MenuItem key="card" onClick={() => runAndClose(() => goToCard(menuJob))}>
                  Go to card
                </MenuItem>
              ) : null,
              menuJob.url ? (
                <MenuItem
                  key="posting"
                  onClick={() =>
                    runAndClose(() => {
                      downloadResumeForChipJob(menuJob).catch(() => {});
                      // No "if (!opened) window.open(...)" fallback here:
                      // openPostingBeside refuses an unsafe url with a
                      // TRUTHY sentinel specifically so callers don't add
                      // one (see the module's REFUSED banner comment) --
                      // a falsy-checked fallback would re-open the exact
                      // url openPostingBeside just refused.
                      openPostingBeside(menuJob.url);
                    })
                  }
                >
                  Open posting
                </MenuItem>
              ) : null,
              <Divider key="d3" />,
              <MenuItem
                key="applied"
                disabled={appliedMenuItem.disabled}
                onClick={() => runAndClose(() => handleToggleApplied(menuJob))}
              >
                {appliedMenuItem.label}
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
