"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import TableContainer from "@mui/material/TableContainer";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";
import { resolveDocumentBlob } from "../../lib/document/docx";
import { digestSummaryLine } from "../../lib/tracking/applicationDigest";
import DescriptionIcon from "@mui/icons-material/Description";
import TabHeader from "./TabHeader";
import EmptyState from "./EmptyState";
import styles from "../page.module.css";
import { useIsTablet } from "../hooks/useResponsive";
import {
  STAGE_TYPE_LABELS,
  createStageDialogState,
  formatDateTimeLocalInputValue,
} from "../../lib/tracking/stages";
import StageDialog from "./StageDialog";
import CommunicationsDialog from "./CommunicationsDialog";
import AddCommunicationDialog from "./AddCommunicationDialog";
import EditAppDialog from "./EditAppDialog";
import AddAppDialog from "./AddAppDialog";
import AppViewDialog from "./AppViewDialog";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

export default function TrackingTab({
  currentUser,
  applicationLoading,
  applicationError,
  applicationData,
  visibleApplicationData,
  applicationStages,
  interviewSearch,
  setInterviewSearch,
  interviewSort,
  companyColWidth,
  roleColWidth,
  resumeFile,
  openAddApplicationDialog,
  toggleInterviewSort,
  sortLabelSx,
  startColResize,
  askAiAbout,
  buildApplicationContextString,
  buildStageContextString,
  openCommsInAppDialog,
  openAddCommunicationDialog,
  openEditApplicationDialog,
  handleDeleteApplication,
  setAppDialog,
  setStageError,
  setStageDialog,
  isDocxResume,
  downloadDocxFiles,
  getDownloadFileNameForTitle,
  // Dialog props
  stageDialog,
  stageError,
  stageSaving,
  handleSaveStage,
  communicationsDialog,
  setCommunicationsDialog,
  addCommunicationDialog,
  setAddCommunicationDialog,
  communicationError,
  setCommunicationError,
  communicationSaving,
  handleSaveCommunication,
  editAppDialog,
  setEditAppDialog,
  editAppSaving,
  editAppError,
  editAppResumeFile,
  setEditAppResumeFile,
  handleSaveEditApplication,
  addAppDialog,
  setAddAppDialog,
  addAppSaving,
  addAppError,
  addAppResumeFile,
  setAddAppResumeFile,
  handleSaveAddApplication,
  appDialog,
  loadCommunicationsForApp,
  highlightedAppId,
  emailClassificationsByAppId = {},
  // Company & role research column - see app/hooks/useApplicationDigests.js.
  digestsById = {},
  researchingIds,
  researchOne,
}) {
  // Below the `md` breakpoint the dense data table is unusable, so the rows are
  // rendered as stacked cards instead (set in Phase 3 of the responsive work).
  const isCompact = useIsTablet();

  // The single decision tree for the digest cell, shared by the desktop
  // table cell and the phone card block below - two render call sites for
  // one column (see the AC's own survey: a column added only to the table is
  // invisible on a phone). A real MUI <Button> in every branch, never a Box
  // with an onClick: the row itself has an onClick that opens the edit
  // dialog, guarded on `e.target.closest("a, button, ...")`, so anything
  // that renders as something else gets swallowed by the row click.
  function renderDigestCell(app, idx) {
    const digest = digestsById[app.id];
    const researching = !!researchingIds?.has?.(app.id);
    const captionId = `digest-caption-${app.id}`;

    if (researching) {
      return (
        <Box>
          <Button
            size="small"
            aria-disabled="true"
            aria-describedby={captionId}
            onClick={() => {}}
            sx={{ p: 0, minWidth: 0, fontSize: 11, opacity: 0.6, cursor: "default" }}
          >
            Researching…
          </Button>
          <Box id={captionId} role="status" sx={{ fontSize: 10.5, color: "var(--text-muted)" }}>
            Researching {app.positions?.company || "this company"} and this role…
          </Box>
        </Box>
      );
    }

    if (digest && digest.status === "failed") {
      const stale = digestSummaryLine(digest.markdown);
      return (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.25 }}>
          <Box sx={{ fontSize: 11, color: "var(--danger)" }}>Research failed</Box>
          {/* When the last attempt failed but earlier research survived, this
              branch used to return before the summary button - so the panel
              that discloses "the latest research failed, and this is from
              <when>" was reachable only by opening a different page of the
              dialog and pressing an undocumented arrow key. The stale prose is
              the only copy there is; it gets a way in. */}
          {stale ? (
            <Button
              size="small"
              onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "digest" })}
              sx={{
                p: 0,
                minWidth: 0,
                fontSize: 12,
                textAlign: "left",
                textTransform: "none",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {stale}
            </Button>
          ) : null}
          {/* digest.error is written on both route paths and was read by
              nothing at all, so a schema failure and a model timeout looked
              identical from here. */}
          {digest.error ? (
            <Box sx={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{String(digest.error)}</Box>
          ) : null}
          {/* researchOne is always passed by app/page.js (see useApplicationDigests) —
              call it directly so a future wiring regression throws instead of
              silently no-opping the button. */}
          <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }} onClick={() => researchOne(app.id)}>
            Retry
          </Button>
        </Box>
      );
    }

    if (digest) {
      const summary = digestSummaryLine(digest.markdown) || "View research";
      return (
        <Button
          size="small"
          onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "digest" })}
          sx={{
            p: 0,
            minWidth: 0,
            fontSize: 12,
            textAlign: "left",
            textTransform: "none",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {summary}
        </Button>
      );
    }

    return (
      // researchOne is always passed by app/page.js (see useApplicationDigests) —
      // call it directly so a future wiring regression throws instead of
      // silently no-opping the button.
      <Button size="small" variant="outlined" sx={{ fontSize: 11 }} onClick={() => researchOne(app.id)}>
        Research
      </Button>
    );
  }
  return (
    <section className={styles.tabPanel}>
      <TabHeader
        title="Application tracking"
        description="Track applications, interview stages, and communications across your pipeline."
        actions={
          applicationData.length > 0 ? (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
              <TextField
                label="Search company or role"
                value={interviewSearch}
                onChange={(e) => setInterviewSearch(e.target.value)}
                size="small"
                placeholder="e.g. Stripe or frontend"
                sx={{ maxWidth: 380, flex: 1, minWidth: 220 }}
              />
              <Button variant="outlined" size="small" onClick={openAddApplicationDialog}>
                + Add Row
              </Button>
            </Box>
          ) : (
            <Button variant="outlined" size="small" onClick={openAddApplicationDialog}>
              + Add Row
            </Button>
          )
        }
      />

      {!currentUser ? (
        <EmptyState
          title="Sign in to get started"
          message="Sign in to see your applications and track your job search progress."
        />
      ) : applicationLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : applicationError ? (
        <Alert severity="error">Error loading applications: {applicationError}</Alert>
      ) : applicationData.length === 0 ? (
        <EmptyState
          title="No applications yet"
          message="Apply to jobs in the Applying tab, or add your own row to track manually."
        />
      ) : (
        <>
          {isCompact ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {visibleApplicationData.map((app) => {
                const idx = applicationData.findIndex((candidate) => candidate.id === app.id);
                const pos = app.positions;
                // `positions` is a SHARED catalogue - no user_id column, and
                // positions_update_authenticated lets any signed-in account
                // overwrite any row - so `pos.url` is a value another user
                // controls. Refused URLs render no anchor at all, not a dead
                // one; see lib/url/safeExternalHref.js.
                const postingHref = safeExternalHref(app.application_url || pos?.url);
                const resume = app.generated_resumes;
                const stages = applicationStages[app.id] || [];
                const emailClassification = emailClassificationsByAppId[app.id] ?? null;
                const EMAIL_CHIP_STYLES = {
                  confirmation: { label: "Applied", color: "var(--accent-hover)", bg: "var(--accent-soft)" },
                  interview:    { label: "Interview", color: "var(--success)", bg: "var(--success-soft)" },
                  rejection:    { label: "Rejected", color: "var(--danger-hover)", bg: "var(--danger-soft)" },
                };
                const emailChip = emailClassification ? EMAIL_CHIP_STYLES[emailClassification] : null;
                const canDownloadResume = !!resume?.content && !!resumeFile && isDocxResume(resumeFile);
                return (
                  <Box
                    key={app.id}
                    data-app-id={app.id}
                    sx={{
                      border: "1px solid var(--border)",
                      borderRadius: 2,
                      p: 1.75,
                      backgroundColor: "var(--bg-surface)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 1.25,
                      ...(highlightedAppId === app.id && {
                        outline: "2px solid var(--accent)",
                        outlineOffset: "-2px",
                        backgroundColor: "var(--accent-soft)",
                      }),
                    }}
                  >
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ fontWeight: 700, fontSize: "1rem", lineHeight: 1.25 }}>{pos?.company || "—"}</Box>
                        <Box sx={{ color: "var(--text-secondary)", fontSize: "0.9rem", mt: 0.25 }}>{pos?.title || "—"}</Box>
                        {pos?.posted_at && (
                          <Box sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 0.25 }}>
                            Posted {new Date(pos.posted_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </Box>
                        )}
                      </Box>
                      {emailChip && (
                        <Box sx={{ fontSize: "0.72rem", fontWeight: 700, color: emailChip.color, bgcolor: emailChip.bg, px: 0.75, py: 0.25, borderRadius: 1, flexShrink: 0, letterSpacing: "0.03em" }}>
                          {emailChip.label}
                        </Box>
                      )}
                    </Box>

                    <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      Applied: {app.applied_at ? new Date(app.applied_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </Box>

                    {/* Company & role research - card layout's version of the
                        desktop table's digest column; the table alone would
                        make this invisible on a phone. */}
                    <Box sx={{ fontSize: "0.8rem" }}>{renderDigestCell(app, idx)}</Box>

                    {stages.length > 0 && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                        {stages.map((stage) => {
                          const stageLabel = `${stage.stage_name || STAGE_TYPE_LABELS[stage.stage_type] || stage.stage_type}${stage.outcome && stage.outcome !== "pending" ? ` · ${stage.outcome}` : ""}`;
                          return (
                            <Chip
                              key={stage.id}
                              label={stageLabel}
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                setStageError("");
                                setStageDialog(createStageDialogState({
                                  open: true,
                                  applicationId: app.id,
                                  stageId: stage.id,
                                  stageName: stage.stage_name || "",
                                  stageType: stage.stage_type || "phone_screen",
                                  scheduledAt: formatDateTimeLocalInputValue(stage.scheduled_at),
                                  durationMinutes: stage.duration_minutes ? String(stage.duration_minutes) : "",
                                  outcome: stage.outcome || "pending",
                                  interviewerNames: (stage.interviewer_names || []).join(", "),
                                  notes: stage.notes || "",
                                }));
                              }}
                            />
                          );
                        })}
                      </Box>
                    )}

                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {pos?.description && (
                        <Button size="small" variant="outlined" onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "jd" })}>JD</Button>
                      )}
                      {resume?.content && (
                        <Button size="small" variant="outlined" onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "resume" })}>Resume</Button>
                      )}
                      {canDownloadResume && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<DescriptionIcon fontSize="small" />}
                          onClick={async () => {
                            const lines = Array.isArray(resume.content_lines) && resume.content_lines.length > 0
                              ? resume.content_lines
                              : (resume.content || "").split("\n");
                            const err = await downloadDocxFiles({ jobTitle: pos?.title || "resume", company: pos?.company, result: resume.content, resultLines: lines, coverLetterResultLines: [], docxPath: resume.docx_path || "" });
                            if (err) window.alert(err);
                          }}
                        >
                          Download
                        </Button>
                      )}
                      <Button size="small" variant="outlined" onClick={() => openCommsInAppDialog(app, idx)}>Comms</Button>
                      {postingHref && (
                        <Button size="small" variant="outlined" href={postingHref} target="_blank" rel="noopener noreferrer">Posting ↗</Button>
                      )}
                    </Box>

                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", borderTop: "1px solid var(--border)", pt: 1 }}>
                      <Button
                        size="small"
                        onClick={() => askAiAbout({
                          label: `${pos?.company || "Application"}${pos?.title ? ` — ${pos.title}` : ""}`,
                          content: buildApplicationContextString(app),
                        })}
                      >
                        Ask AI
                      </Button>
                      <Button size="small" onClick={() => openEditApplicationDialog(app)}>Edit</Button>
                      <Button size="small" color="error" onClick={() => handleDeleteApplication(app)}>Delete</Button>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : (
          <TableContainer sx={{ maxHeight: "calc(100vh - 280px)" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell
                    sortDirection={interviewSort.field === "company" ? interviewSort.dir : false}
                    sx={{
                      fontWeight: 700,
                      position: "sticky",
                      left: 0,
                      width: companyColWidth,
                      minWidth: companyColWidth,
                      maxWidth: companyColWidth,
                      zIndex: 4,
                      backgroundColor: "var(--bg-surface)",
                      boxShadow: "1px 0 0 var(--border)",
                    }}
                  >
                    <Box sx={{ position: "relative", pr: 1.5 }}>
                      <TableSortLabel
                        active
                        direction={interviewSort.field === "company" ? interviewSort.dir : "asc"}
                        onClick={() => toggleInterviewSort("company")}
                        sx={sortLabelSx("company")}
                      >
                        Company
                      </TableSortLabel>
                      <Box
                        onPointerDown={(e) => startColResize("company", e)}
                        sx={{
                          position: "absolute",
                          top: -8,
                          right: -12,
                          width: 10,
                          height: "calc(100% + 16px)",
                          cursor: "col-resize",
                          "&:hover": { backgroundColor: "var(--accent)", opacity: 0.4 },
                        }}
                        title="Drag to resize"
                      />
                    </Box>
                  </TableCell>
                  <TableCell
                    sortDirection={interviewSort.field === "title" ? interviewSort.dir : false}
                    sx={{
                      fontWeight: 700,
                      position: "sticky",
                      left: companyColWidth,
                      width: roleColWidth,
                      minWidth: roleColWidth,
                      maxWidth: roleColWidth,
                      zIndex: 4,
                      backgroundColor: "var(--bg-surface)",
                      boxShadow: "1px 0 0 var(--border)",
                    }}
                  >
                    <Box sx={{ position: "relative", pr: 1.5 }}>
                      <TableSortLabel
                        active
                        direction={interviewSort.field === "title" ? interviewSort.dir : "asc"}
                        onClick={() => toggleInterviewSort("title")}
                        sx={sortLabelSx("title")}
                      >
                        Role
                      </TableSortLabel>
                      <Box
                        onPointerDown={(e) => startColResize("role", e)}
                        sx={{
                          position: "absolute",
                          top: -8,
                          right: -12,
                          width: 10,
                          height: "calc(100% + 16px)",
                          cursor: "col-resize",
                          "&:hover": { backgroundColor: "var(--accent)", opacity: 0.4 },
                        }}
                        title="Drag to resize"
                      />
                    </Box>
                  </TableCell>
                  <TableCell
                    sortDirection={interviewSort.field === "status" ? interviewSort.dir : false}
                    sx={{ fontWeight: 700 }}
                  >
                    <TableSortLabel
                      active
                      direction={interviewSort.field === "status" ? interviewSort.dir : "asc"}
                      onClick={() => toggleInterviewSort("status")}
                      sx={sortLabelSx("status")}
                    >
                      Status
                    </TableSortLabel>
                  </TableCell>
                  <TableCell
                    sortDirection={interviewSort.field === "applied_at" ? interviewSort.dir : false}
                    sx={{ fontWeight: 700 }}
                  >
                    <TableSortLabel
                      active
                      direction={interviewSort.field === "applied_at" ? interviewSort.dir : "asc"}
                      onClick={() => toggleInterviewSort("applied_at")}
                      sx={sortLabelSx("applied_at")}
                    >
                      Applied
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Recruiter Communications</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Company &amp; role</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Job Description</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Your Resume</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Links</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleApplicationData.map((app) => {
                  const idx = applicationData.findIndex((candidate) => candidate.id === app.id);
                  const pos = app.positions;
                  // Same shared-catalogue hazard as the compact card layout
                  // above: gate before it can become an href.
                  const postingHref = safeExternalHref(app.application_url || pos?.url);
                  const resume = app.generated_resumes;
                  const stages = applicationStages[app.id] || [];
                  const emailClassification = emailClassificationsByAppId[app.id] ?? null;
                  const EMAIL_CHIP_STYLES = {
                    confirmation: { label: "Applied", color: "var(--accent-hover)", bg: "var(--accent-soft)" },
                    interview:    { label: "Interview", color: "var(--success)", bg: "var(--success-soft)" },
                    rejection:    { label: "Rejected", color: "var(--danger-hover)", bg: "var(--danger-soft)" },
                  };
                  const emailChip = emailClassification ? EMAIL_CHIP_STYLES[emailClassification] : null;

                  return (
                    <TableRow
                      key={app.id}
                      data-app-id={app.id}
                      hover
                      onClick={(e) => {
                        if (e.target.closest("a, button, input, textarea, select, [role='button']")) {
                          return;
                        }
                        openEditApplicationDialog(app);
                      }}
                      sx={{
                        cursor: "pointer",
                        ...(highlightedAppId === app.id && {
                          outline: "2px solid var(--accent)",
                          outlineOffset: "-2px",
                          backgroundColor: "var(--accent-soft) !important",
                        }),
                      }}
                    >
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          position: "sticky",
                          left: 0,
                          width: companyColWidth,
                          minWidth: companyColWidth,
                          maxWidth: companyColWidth,
                          zIndex: 2,
                          backgroundColor: "var(--bg-surface)",
                          boxShadow: "1px 0 0 var(--border)",
                        }}
                      >
                        {pos?.company || "\u2014"}
                        {pos?.posted_at && (
                          <Box sx={{ fontSize: "0.68rem", color: "var(--text-secondary)", fontWeight: 400, mt: 0.25 }}>
                            Posted {new Date(pos.posted_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell
                        sx={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          position: "sticky",
                          left: companyColWidth,
                          width: roleColWidth,
                          minWidth: roleColWidth,
                          maxWidth: roleColWidth,
                          zIndex: 2,
                          backgroundColor: "var(--bg-surface)",
                          boxShadow: "1px 0 0 var(--border)",
                        }}
                      >
                        {pos?.title || "\u2014"}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.75 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                            {emailChip && (
                              <Box sx={{ fontSize: "0.72rem", fontWeight: 700, color: emailChip.color, bgcolor: emailChip.bg, px: 0.75, py: 0.25, borderRadius: 1, flexShrink: 0, letterSpacing: "0.03em" }}>
                                {emailChip.label}
                              </Box>
                            )}
                          </Box>
                          {stages.length > 0 ? (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                              {stages.slice(0, 2).map((stage) => {
                                const stageLabel = `${stage.stage_name || STAGE_TYPE_LABELS[stage.stage_type] || stage.stage_type}${stage.outcome && stage.outcome !== "pending" ? ` · ${stage.outcome}` : ""}`;
                                return (
                                  <Chip
                                    key={stage.id}
                                    label={stageLabel}
                                    size="small"
                                    variant="outlined"
                                    onClick={() => {
                                      setStageError("");
                                      setStageDialog(createStageDialogState({
                                        open: true,
                                        applicationId: app.id,
                                        stageId: stage.id,
                                        stageName: stage.stage_name || "",
                                        stageType: stage.stage_type || "phone_screen",
                                        scheduledAt: formatDateTimeLocalInputValue(stage.scheduled_at),
                                        durationMinutes: stage.duration_minutes ? String(stage.duration_minutes) : "",
                                        outcome: stage.outcome || "pending",
                                        interviewerNames: (stage.interviewer_names || []).join(", "),
                                        notes: stage.notes || "",
                                      }));
                                    }}
                                    onDelete={() => askAiAbout({
                                      label: `${pos?.company || "Application"} · ${stageLabel}`,
                                      content: buildStageContextString(app, stage),
                                      prompt: `Help me prepare for my "${stage.stage_name || stage.stage_type || "interview"}" at ${pos?.company || "this company"}: `,
                                    })}
                                    deleteIcon={<span style={{ fontSize: 11, padding: "0 4px", color: "var(--accent)" }} title="Ask AI">AI</span>}
                                  />
                                );
                              })}
                              {stages.length > 2 ? (
                                <Box component="span" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                  +{stages.length - 2} more
                                </Box>
                              ) : null}
                            </Box>
                          ) : null}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {app.applied_at
                          ? new Date(app.applied_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                          : "—"}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.2 }}>
                          <Button
                            size="small"
                            sx={{ minWidth: 0, p: 0, fontSize: 11 }}
                            onClick={() => openCommsInAppDialog(app, idx)}
                          >
                            View
                          </Button>
                          <Button
                            size="small"
                            sx={{ minWidth: 0, p: 0, fontSize: 11 }}
                            onClick={() => openAddCommunicationDialog(app)}
                          >
                            Add
                          </Button>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>
                        {renderDigestCell(app, idx)}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>
                        {pos?.description ? (
                          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, flexDirection: "column" }}>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {pos.description}
                            </span>
                            <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "jd" })}>
                              View full
                            </Button>
                          </Box>
                        ) : "—"}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        {resume?.content ? (
                          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, flexDirection: "column" }}>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {resume.content}
                            </span>
                            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                              <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "resume" })}>
                                View full
                              </Button>
                              <Tooltip title="Download or drag to upload tailored DOCX">
                                <span
                                  style={{ display: "inline-flex", alignItems: "center", cursor: (!resumeFile || !isDocxResume(resumeFile)) ? "not-allowed" : "pointer", opacity: (!resumeFile || !isDocxResume(resumeFile)) ? 0.5 : 1 }}
                                  tabIndex={0}
                                  role="button"
                                  onClick={async (e) => {
                                    if (!resumeFile || !isDocxResume(resumeFile)) return;
                                    const lines = Array.isArray(resume.content_lines) && resume.content_lines.length > 0
                                      ? resume.content_lines
                                      : (resume.content || "").split("\n");
                                    const err = await downloadDocxFiles({
                                      jobTitle: pos?.title || "resume",
                                      company: pos?.company,
                                      result: resume.content,
                                      resultLines: lines,
                                      coverLetterResultLines: [],
                                      docxPath: resume.docx_path || "",
                                    });
                                    if (err) window.alert(err);
                                  }}
                                  draggable={!!resumeFile && isDocxResume(resumeFile)}
                                  onDragStart={async (e) => {
                                    if (!resumeFile || !isDocxResume(resumeFile)) return;
                                    try {
                                      const lines = Array.isArray(resume.content_lines) && resume.content_lines.length > 0
                                        ? resume.content_lines
                                        : (resume.content || "").split("\n");
                                      const blob = await resolveDocumentBlob({
                                        docxPath: resume.docx_path || "",
                                        edited: false,
                                        text: resume.content,
                                        lines,
                                        uploadedTemplate: resumeFile,
                                      });
                                      if (!blob) return;
                                      const file = new File([blob], getDownloadFileNameForTitle(pos?.title, pos?.company), { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
                                      e.dataTransfer.clearData();
                                      e.dataTransfer.effectAllowed = "copy";
                                      e.dataTransfer.setData("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "");
                                      e.dataTransfer.items.add(file);
                                    } catch {}
                                  }}
                                  title={
                                    !resumeFile
                                      ? "Upload your source resume (.docx) to enable downloads."
                                      : !isDocxResume(resumeFile)
                                      ? "Source resume must be a .docx file to download."
                                      : "Download or drag tailored .docx"
                                  }
                                >
                                  <DescriptionIcon fontSize="small" color="primary" />
                                </span>
                              </Tooltip>
                            </Box>
                          </Box>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        {postingHref && (
                          <Button size="small" href={postingHref} target="_blank" rel="noopener noreferrer" sx={{ whiteSpace: "nowrap" }}>
                            Posting ↗
                          </Button>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        <Box sx={{ display: "flex", gap: 0.5 }}>
                          <Button
                            size="small"
                            sx={{ minWidth: 0, p: 0.25, fontSize: 11 }}
                            onClick={() => askAiAbout({
                              label: `${pos?.company || "Application"}${pos?.title ? ` — ${pos.title}` : ""}`,
                              content: buildApplicationContextString(app),
                            })}
                          >
                            Ask AI
                          </Button>
                          <Button
                            size="small"
                            sx={{ minWidth: 0, p: 0.25, fontSize: 11 }}
                            onClick={() => openEditApplicationDialog(app)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            sx={{ minWidth: 0, p: 0.25, fontSize: 11 }}
                            onClick={() => handleDeleteApplication(app)}
                          >
                            Delete
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          )}
          {visibleApplicationData.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", marginTop: 12 }}>
              No applications match that company or role.
            </p>
          ) : null}
        </>
      )}

      <StageDialog
        stageDialog={stageDialog}
        setStageDialog={setStageDialog}
        stageError={stageError}
        setStageError={setStageError}
        stageSaving={stageSaving}
        handleSaveStage={handleSaveStage}
      />

      <CommunicationsDialog
        communicationsDialog={communicationsDialog}
        setCommunicationsDialog={setCommunicationsDialog}
      />

      <AddCommunicationDialog
        addCommunicationDialog={addCommunicationDialog}
        setAddCommunicationDialog={setAddCommunicationDialog}
        communicationError={communicationError}
        setCommunicationError={setCommunicationError}
        communicationSaving={communicationSaving}
        handleSaveCommunication={handleSaveCommunication}
      />

      <EditAppDialog
        editAppDialog={editAppDialog}
        setEditAppDialog={setEditAppDialog}
        editAppSaving={editAppSaving}
        editAppError={editAppError}
        editAppResumeFile={editAppResumeFile}
        setEditAppResumeFile={setEditAppResumeFile}
        handleSaveEditApplication={handleSaveEditApplication}
      />

      <AddAppDialog
        addAppDialog={addAppDialog}
        setAddAppDialog={setAddAppDialog}
        addAppSaving={addAppSaving}
        addAppError={addAppError}
        addAppResumeFile={addAppResumeFile}
        setAddAppResumeFile={setAddAppResumeFile}
        handleSaveAddApplication={handleSaveAddApplication}
      />

      <AppViewDialog
        appDialog={appDialog}
        setAppDialog={setAppDialog}
        applicationData={applicationData}
        communicationsDialog={communicationsDialog}
        loadCommunicationsForApp={loadCommunicationsForApp}
        openAddCommunicationDialog={openAddCommunicationDialog}
        digestsById={digestsById}
        researchingIds={researchingIds}
        researchOne={researchOne}
      />
    </section>
  );
}
