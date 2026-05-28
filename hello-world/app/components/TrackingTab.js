"use client";

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
import DescriptionIcon from "@mui/icons-material/Description";
import styles from "../page.module.css";
import StageDialog from "./StageDialog";
import CommunicationsDialog from "./CommunicationsDialog";
import AddCommunicationDialog from "./AddCommunicationDialog";
import EditAppDialog from "./EditAppDialog";
import AddAppDialog from "./AddAppDialog";
import AppViewDialog from "./AppViewDialog";

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
  buildDocxFromUploadedTemplate,
  getDownloadFileNameForTitle,
  formatDateTimeLocalInputValue,
  createStageDialogState,
  STAGE_TYPE_LABELS,
  // Dialog props
  stageDialog,
  stageError,
  stageSaving,
  handleSaveStage,
  STAGE_TYPE_OPTIONS,
  STAGE_OUTCOME_OPTIONS,
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
  FormattedContent,
  highlightedAppId,
  emailClassificationsByAppId = {},
}) {
  return (
    <section className={styles.tabPanel}>
      {!currentUser ? (
        <p style={{ color: "var(--text-secondary)" }}>Sign in to see your applications.</p>
      ) : applicationLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : applicationError ? (
        <p style={{ color: "var(--error, #d32f2f)" }}>Error loading applications: {applicationError}</p>
      ) : applicationData.length === 0 ? (
        <>
          <Box sx={{ mb: 2 }}>
            <Button variant="outlined" size="small" onClick={openAddApplicationDialog}>
              + Add Row
            </Button>
          </Box>
          <p style={{ color: "var(--text-secondary)" }}>No applications yet. Apply to jobs in the Applying tab, or add your own row.</p>
        </>
      ) : (
        <>
          <Box sx={{ mb: 2.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
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
                      backgroundColor: "var(--bg-surface, #fff)",
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
                          "&:hover": { backgroundColor: "var(--accent, #1976d2)", opacity: 0.4 },
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
                      backgroundColor: "var(--bg-surface, #fff)",
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
                          "&:hover": { backgroundColor: "var(--accent, #1976d2)", opacity: 0.4 },
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
                  const resume = app.generated_resumes;
                  const stages = applicationStages[app.id] || [];
                  const emailClassification = emailClassificationsByAppId[app.id] ?? null;
                  const EMAIL_CHIP_STYLES = {
                    confirmation: { label: "Applied", color: "#1565c0", bg: "#e3f2fd" },
                    interview:    { label: "Interview", color: "#2e7d32", bg: "#e8f5e9" },
                    rejection:    { label: "Rejected", color: "#b71c1c", bg: "#ffebee" },
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
                          outline: "2px solid #1976d2",
                          outlineOffset: "-2px",
                          backgroundColor: "#e3f2fd !important",
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
                          backgroundColor: "var(--bg-surface, #fff)",
                          boxShadow: "1px 0 0 var(--border)",
                        }}
                      >
                        {pos?.company || "\u2014"}
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
                          backgroundColor: "var(--bg-surface, #fff)",
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
                            <Button
                              size="small"
                              sx={{ minWidth: 0, p: 0, fontSize: 11 }}
                              onClick={() => {
                                setStageError("");
                                setStageDialog(createStageDialogState({
                                  open: true,
                                  applicationId: app.id,
                                }));
                              }}
                            >
                              + Stage
                            </Button>
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
                                    deleteIcon={<span style={{ fontSize: 11, padding: "0 4px", color: "var(--accent, #1976d2)" }} title="Ask AI">AI</span>}
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
                                      result: resume.content,
                                      resultLines: lines,
                                      coverLetterResultLines: [],
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
                                      const blob = await buildDocxFromUploadedTemplate(resumeFile, resume.content, lines);
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
                        {(app.application_url || pos?.url) && (
                          <Button size="small" href={app.application_url || pos.url} target="_blank" rel="noopener noreferrer" sx={{ whiteSpace: "nowrap" }}>
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
        createStageDialogState={createStageDialogState}
        STAGE_TYPE_OPTIONS={STAGE_TYPE_OPTIONS}
        STAGE_OUTCOME_OPTIONS={STAGE_OUTCOME_OPTIONS}
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
        FormattedContent={FormattedContent}
      />
    </section>
  );
}
