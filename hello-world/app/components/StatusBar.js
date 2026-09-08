"use client";

import { useCallback, useRef, useState } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import DescriptionIcon from "@mui/icons-material/Description";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
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

// The dock is `position: fixed; bottom: 0` (page.module.css `.floatingToolbar`)
// so it is permanently on screen, but app/page.js mounts it LAST in the DOM,
// after `</main>`. Its per-job controls therefore sit behind every focusable in
// the active tab — roughly 230 Tab presses with 20 tracked applications. These
// three attributes are the target half of the fix; the link half is the second
// entry in app/components/SkipLink.js, which is gated on this `id` actually
// being in the document so it can never outlive the dock.
//
// A `<section>` with an accessible name is natively a `region` landmark (no
// explicit `role` needed), which also makes the dock reachable by landmark
// navigation without using the skip link at all. `tabIndex: -1` lets the
// fragment target take the caret — Safari and Firefox will not focus a
// non-focusable target — while staying out of sequential traversal, so the
// dock still costs no extra tab stop.
//
// Spread onto BOTH returns below: the empty-dock early return is a second,
// separate element, and giving the landmark only to the main return would
// leave the link dangling in exactly the state "Clear all" produces.
const DOCK_LANDMARK = { id: "job-dock", "aria-label": "Generated jobs", tabIndex: -1 };

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
  // Wave 3A (3-plan-dupapply.md §2.7): the duplicate-application banner.
  // `dupeNotice` is `lib/duplicateApply/verdictPresentation.js`'s
  // `presentVerdict(...)` output, verbatim, or `null` -- this component
  // renders that shape and decides NOTHING about copy, severity or
  // partitioning itself. `onDupeDismiss(jobId)` and
  // `onOpenApplications(searchSeed)` are callbacks closed over page.js's own
  // state (the dismissal set, `setMainTab` + `setInterviewSearch`); neither
  // callback's argument is recomputed here.
  dupeNotice = null,
  onDupeDismiss,
  onOpenApplications,
  // Wave 4: the duplicate-check log's download control (the standing
  // feature-logs rule -- every feature that can carry a log gets one, plus a
  // clearly visible download button, one shared primitive, a single .md,
  // surviving Clear). `null` until the hook has actually recorded something,
  // which is the ONLY thing that decides whether this control renders.
  //
  // WHY IT IS NOT IN THE BANNER, which is the obvious place for it. The banner
  // renders only when `dupeNotice` is non-null, and `presentVerdict` returns
  // null for every verdict that raises nothing -- including a genuine `clear`,
  // a load that never finished and a check that threw. Those three are exactly
  // the states duplicateApplyLog.js says the log exists to make legible ("a log
  // that records only successes cannot explain a failure"), so a control that
  // appears only alongside a banner could never report the case it is for. It
  // is also outside the banner so dismissing the banner cannot take it away.
  onDupeDownloadLog = null,
  // The chip-untrack notice. `lib/applications/untrackChip.js`'s
  // `presentUntrackOutcome(...)` output, verbatim, or `null` -- this
  // component renders that shape and decides NOTHING about copy or tone
  // itself, exactly as it does for `dupeNotice` above.
  //
  // It exists because "Remove" used to be a control that looked like it
  // worked and did nothing: `deleteUntrackedApplication` refuses every row
  // that is not a dateless `tracking` row, and app/page.js turned that
  // refusal into an early return, so a tailored or applied chip stayed put
  // and no one was told why. The chip now always goes; this is where the
  // other half of the truth -- what happened to the saved application --
  // gets said. `null` for a real delete, which needs no notice at all.
  untrackNotice = null,
  onUntrackNoticeDismiss,
}) {
  const isMobile = useIsMobile();
  // On phones the bar defaults to the roomier vertical list.
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState({ anchorEl: null, jobId: null });

  // AC-1 (B-1): `.floatingToolbar` is `position: fixed`, so it reserves NO
  // space in flow -- every tab's last screenful sits permanently underneath
  // it. The fix is a flow spacer, rendered as this component's OWN sibling
  // to the fixed dock (never a child of it -- a child of `position: fixed`
  // is out of flow too and reserves nothing), sized from a REAL measurement
  // rather than a hardcoded guess: one chip is ~84px, a duplicate banner
  // plus a full list is ~672px, and only `ResizeObserver` re-measures as
  // that changes. A callback ref (not a plain `useRef`) is what re-attaches
  // the observer across the two DOM shapes this component can return -- the
  // trackedJobs===0 early-return dock below and the full dock further down
  // share this same ref, state and spacer.
  //
  // Rejected: a `--dock-h` custom property on `.page`. It would trip
  // app/theme/themeSystem.test.js's "every var(--token) is a defined theme
  // token" sweep, it touches the whole app's layout class instead of just
  // this component, and it would cost app/page.js lines it does not have to
  // spare (3206/1000).
  const [dockHeight, setDockHeight] = useState(0);
  const dockObserverRef = useRef(null);
  const dockRef = useCallback((node) => {
    dockObserverRef.current?.disconnect();
    dockObserverRef.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setDockHeight(entry.contentRect.height);
    });
    ro.observe(node);
    dockObserverRef.current = ro;
  }, []);
  const dockSpacer = <div data-dock-spacer aria-hidden="true" style={{ height: dockHeight }} />;

  // A plain button in the dock, never a MenuItem under "More actions" (that
  // menu is per-job, and this log is per-session) and never an icon-only
  // control: "clearly visible" and "one click with good defaults" are both
  // standing rules here. No MUI Tooltip either -- a Tooltip supplies an
  // aria-label that REPLACES the visible text as the accessible name, so the
  // name a screen reader announces would stop matching the name on screen.
  const dupeLogButton = onDupeDownloadLog ? (
    <button
      type="button"
      className={styles.toolbarClear}
      data-dupe-action="download-log"
      onClick={() => onDupeDownloadLog()}
    >
      Download duplicate-check log
    </button>
  ) : null;

  // A plain `<div>`, never an MUI `<Alert>`, for the same reason the
  // duplicate banner below is one (1e's C-2 ruling) -- see its comment.
  //
  // DEFINED ABOVE THE EMPTY-DOCK EARLY RETURN, deliberately. Removing the
  // LAST chip is exactly when this notice matters most, and that is also the
  // moment `trackedJobs` becomes empty; a banner computed below the return
  // (as `dupeBanner` is -- harmless there, since a duplicate verdict implies
  // a tracked job) would be destroyed by the very action that raises it.
  const untrackBanner = untrackNotice ? (
    <div
      className={styles.dupFlag}
      data-untrack-flag="banner"
      data-untrack-tone={untrackNotice.tone}
      data-untrack-job={untrackNotice.jobId || undefined}
    >
      <div className={styles.dupFlagSignal}>
        {untrackNotice.tone === "warning" ? (
          <ReportProblemOutlinedIcon className={styles.dupFlagGlyph} fontSize="small" />
        ) : (
          <InfoOutlinedIcon className={styles.dupFlagGlyph} fontSize="small" />
        )}
        <span className={styles.dupFlagKicker}>{untrackNotice.kicker}</span>
        <span className={styles.dupFlagSentence}>{untrackNotice.sentence}</span>
      </div>
      <div className={styles.dupFlagActions}>
        {/* Offered only when the row is one the Tracking tab will actually
            list. `searchSeed` is the presentation module's own value,
            forwarded verbatim and never recomputed here; an empty string is
            its way of saying "do not send them there". */}
        {untrackNotice.searchSeed ? (
          <button
            type="button"
            className={styles.dupFlagAction}
            data-untrack-action="open-applications"
            onClick={() => onOpenApplications?.(untrackNotice.searchSeed)}
          >
            Open in Tracking
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles.dupFlagAction} ${styles.dupFlagActionQuiet}`}
          data-untrack-action="dismiss"
          onClick={() => onUntrackNoticeDismiss?.()}
        >
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  // THIS EARLY RETURN IS WHAT "SURVIVES CLEAR" ACTUALLY MEANS ON THIS SURFACE.
  // "Clear all" below is `setTrackedJobs([])` and nothing else -- it resets no
  // duplicate-apply state anywhere -- but it empties `trackedJobs`, and this
  // return then unmounts the whole dock. So a log control nested in here would
  // be destroyed by exactly the action the standing rule says the log must
  // survive, even though the log's own data was never touched. The dock now
  // outlives the job chips whenever there is a log to reach, and shows only the
  // one control, rather than an otherwise-empty toolbar of dead affordances.
  //
  // The untrack notice rides the same exemption, for the same reason: it is
  // raised BY a removal, and removing the last chip empties this list.
  if (trackedJobs.length === 0) {
    if (!untrackBanner && !dupeLogButton) return null;
    // This dock is `position: fixed` too (same class), so it needs the same
    // B-1 spacer as the main return below -- AC-1 pins this explicitly.
    // With no banner the dock itself is otherwise byte-identical to what the
    // log-only dock rendered before the notice existed (no `style` at all).
    return (
      <>
        <section
          {...DOCK_LANDMARK}
          className={styles.floatingToolbar}
          ref={dockRef}
          style={untrackBanner ? { flexWrap: "wrap" } : undefined}
        >
          {untrackBanner}
          {dupeLogButton}
        </section>
        {dockSpacer}
      </>
    );
  }

  const vertical = expanded || isMobile;
  // AC-3 (B-3): `vertical` still means "lay the dock out as a column" (mobile
  // always, or desktop's own "Expand list"). Separately, on a phone the dock
  // now STARTS COLLAPSED -- the chip list itself is withheld until the user
  // opens it, so the dock does not cover 23-82% of a 375x812 screen before
  // anyone has done anything. Desktop is unaffected: its horizontal strip
  // already always showed its chips, and "Expand list" there always has.
  const chipListOpen = isMobile ? expanded : true;

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

  // Duplicate-application banner (Wave 3A). One glyph per severity --
  // `ReportProblemOutlined` (triangle) for `hit`, `InfoOutlined` (circle)
  // for anything else -- so the shape channel survives a monochrome render
  // even when colour does not (1e V-2.2). MUI's own `createSvgIcon` adds
  // `data-testid={displayName}Icon` outside production builds, which is
  // this component's own instrument-independent hook for that shape.
  function dupeGlyph(severity) {
    return severity === "hit" ? (
      <ReportProblemOutlinedIcon className={styles.dupFlagGlyph} fontSize="small" />
    ) : (
      <InfoOutlinedIcon className={styles.dupFlagGlyph} fontSize="small" />
    );
  }

  // A plain `<div>`, never an MUI `<Alert>` (1e's C-2 ruling): `<Alert
  // severity="warning">` defaults to `role="alert"`, which would both
  // double-announce what the separate live region (app/page.js, S-11) just
  // said and interrupt the user mid-task, and its `lighten/darken(main,0.9)`
  // fill measures unreadably loud in light mode and near-invisible in dark
  // against this theme-independent dock. A plain element satisfies the
  // "carries no role" requirement structurally, with nothing to un-set.
  const dupeBanner = dupeNotice ? (
    <div className={styles.dupFlag} data-dupe-flag="banner" data-dupe-job={dupeNotice.jobId}>
      {dupeNotice.signals.map((signal) => (
        <div
          key={signal.signal}
          className={styles.dupFlagSignal}
          data-dupe-signal={signal.signal}
          data-dupe-severity={signal.severity}
          data-dupe-reason={signal.reason || undefined}
        >
          {dupeGlyph(signal.severity)}
          <span className={styles.dupFlagKicker}>{signal.kicker}</span>
          <span className={styles.dupFlagSentence}>{signal.sentence}</span>
        </div>
      ))}
      {dupeNotice.evidence.length > 0 ? (
        <ul className={styles.dupFlagEvidence} data-dupe-evidence>
          {dupeNotice.evidence.map((row) => (
            <li key={row.key} className={styles.dupFlagRow} data-dupe-row data-dupe-row-dated={row.dated}>
              <span className={styles.dupFlagRowMain}>{row.main}</span>
              <span className={styles.dupFlagRowMeta}>{row.meta}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.dupFlagActions}>
        {/* One navigation control, not a per-row link (S-14a/N-9): the
            search seed is `presentVerdict`'s own S-14-guarded value,
            forwarded verbatim -- never recomputed here. */}
        <button
          type="button"
          className={styles.dupFlagAction}
          data-dupe-action="open-applications"
          onClick={() => onOpenApplications?.(dupeNotice.interviewSearchSeed)}
        >
          Open your applications
        </button>
        <button
          type="button"
          className={`${styles.dupFlagAction} ${styles.dupFlagActionQuiet}`}
          data-dupe-action="dismiss"
          onClick={() => onDupeDismiss?.(dupeNotice.jobId)}
        >
          Dismiss
        </button>
        {dupeNotice.queueLabel ? (
          <span className={styles.dupFlagQueue} data-dupe-queue>
            {dupeNotice.queueLabel}
          </span>
        ) : null}
      </div>
    </div>
  ) : null;

  // S-15.5's checkable form: with no banner, `dockStyle` is byte-identical
  // to what this dock rendered before this feature existed (`undefined`
  // when horizontal, the same three-key object when vertical). `flexWrap`
  // is added ONLY while a banner is present -- one conditional, never
  // touching the no-notice render.
  const dockBaseStyle = vertical ? { flexDirection: "column", alignItems: "stretch", gap: 8 } : undefined;
  const dockStyle =
    dupeNotice || untrackNotice ? { ...(dockBaseStyle || {}), flexWrap: "wrap" } : dockBaseStyle;

  return (
    <>
    <section {...DOCK_LANDMARK} className={styles.floatingToolbar} ref={dockRef} onWheel={vertical ? undefined : handleToolbarWheel} style={dockStyle}>
      {untrackBanner}
      {dupeBanner}
      {/* AC-6/M-4: `flexWrap` + a PIXEL `rowGap` -- this is a plain `<div>`
          with an inline `style`, not `WRAP_ROW_SX` (whose `rowGap: 1` is
          MUI's spacing transform, i.e. 8px through `sx`; serialised straight
          onto a raw style object it would be the literal 1px). Without
          wrap, "Download duplicate-check log" alone (~205px of uppercase
          0.75rem text) plus the label plus two flex-shrink:0 buttons
          overflow, and `html { overflow-x: hidden }` clips the row. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: "8px", width: vertical ? "100%" : "auto" }}>
        <span className={styles.toolbarLabel}>Generated ({trackedJobs.length})</span>
        {/* In the header row, which renders in BOTH the horizontal and the
            vertical dock and never scrolls -- the job chips sit in their own
            overflow container, so a control placed among them would be one
            arrow-click away from invisible. */}
        {dupeLogButton}
        {/* AC-3/B-3: visible on mobile too -- it is the ONLY way to shrink
            the dock back down that isn't the destructive "Clear all". Kept a
            native <button type="button">: the app-wide focus ring ships as
            a MuiButtonBase `.Mui-focusVisible` theme rule plus native-
            element styling, so a `<div role="button">` would silently have
            no focus indicator. */}
        <button
          type="button"
          className={styles.toolbarClear}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse list" : "Expand list"}
          title={expanded ? "Collapse" : "Expand"}
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
        chipListOpen ? (
          // AC-2/AC-7 corollary: no `maxHeight`/`overflowY` here any more --
          // `.floatingToolbar` is now the ONE scroll container (a `dvh`-
          // capped `max-height` plus `overflow-y: auto`, in page.module.css).
          // Two nested scrollers would also let this inner one steal the
          // page-scroll swipe on a phone, which is the exact reason already
          // written down in app/theme/mobileSx.js's `PHONE_PANE_SX` comment.
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            {trackedJobs.map((job) => renderChip(job))}
          </div>
        ) : null
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
    </section>
    {dockSpacer}
    </>
  );
}
