"use client";

import { useCallback, useMemo } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
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
import { indexApplicationsById } from "../../lib/tracking/trackingRows";
import DescriptionIcon from "@mui/icons-material/Description";
import TabHeader from "./TabHeader";
import EmptyState from "./EmptyState";
import styles from "../page.module.css";
import { useIsTablet } from "../hooks/useResponsive";
import { useStableHandlers } from "../hooks/useStableHandlers";
import { TOUCH_ICON_SX, TOUCH_FIELD_SX, TOUCH_NATIVE_SELECT_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { createStageDialogState, formatDateTimeLocalInputValue } from "../../lib/tracking/stages";
import StageDialog from "./StageDialog";
import CommunicationsDialog from "./CommunicationsDialog";
import AddCommunicationDialog from "./AddCommunicationDialog";
import EditAppDialog from "./EditAppDialog";
import AddAppDialog from "./AddAppDialog";
import AppViewDialog from "./AppViewDialog";
import ApplicationCard from "./tracking/ApplicationCard";
import ApplicationRow from "./tracking/ApplicationRow";
import GmailConnectionNotice from "./tracking/GmailConnectionNotice";

// AC-K4: options for the compact (<900px) card layout's sort control, which
// covers the same four fields as the desktop table's TableSortLabels plus
// both directions. Module scope: the list is fixed, so there's no reason to
// rebuild it on every render.
const SORT_FIELD_OPTIONS = [
  { value: "", label: "Default order" },
  { value: "company:asc", label: "Company (A to Z)" },
  { value: "company:desc", label: "Company (Z to A)" },
  { value: "title:asc", label: "Role (A to Z)" },
  { value: "title:desc", label: "Role (Z to A)" },
  { value: "status:asc", label: "Status (A to Z)" },
  { value: "status:desc", label: "Status (Z to A)" },
  { value: "applied_at:asc", label: "Applied (oldest first)" },
  { value: "applied_at:desc", label: "Applied (newest first)" },
];

// Fixed-identity defaults for the optional props. A `= {}` in the signature
// is a NEW object on every render the prop is omitted, which would change
// `renderDigestCell`'s identity (it depends on digestsById) and with it every
// memoized row and card's props.
const NO_DIGESTS = {};
const NO_CLASSIFICATIONS = {};

// The event handlers the memoized rows and cards call. app/page.js recreates
// most of these on every render (inline closures, and hooks that return fresh
// functions), so they are not passed down as-is: useStableHandlers hands the
// rows one fixed-identity forwarder per name, each calling the latest
// function. EVENT-TIME handlers only -- anything a row calls while RENDERING
// (isDocxResume) is passed straight through; see useStableHandlers.
const STABLE_HANDLER_NAMES = [
  "setAppDialog",
  "setStageError",
  "setStageDialog",
  "openCommsInAppDialog",
  "openAddCommunicationDialog",
  "askAiAbout",
  "buildApplicationContextString",
  "buildStageContextString",
  "openEditApplicationDialog",
  "openApplicationPreview",
  "handleDeleteApplication",
  "downloadDocxFiles",
  "getDownloadFileNameForTitle",
  "researchOne",
];

// The digest cell's button sx, fixed so a cell render does not rebuild them.
const RESEARCHING_BUTTON_SX = { ...TOUCH_TARGET_SX, p: 0, minWidth: 0, fontSize: 11, opacity: 0.6, cursor: "default" };
const RETRY_BUTTON_SX = { ...TOUCH_TARGET_SX, p: 0, minWidth: 0, fontSize: 11 };
const RESEARCH_BUTTON_SX = { ...TOUCH_TARGET_SX, fontSize: 11 };
const DIGEST_SUMMARY_SX = {
  ...TOUCH_TARGET_SX,
  p: 0,
  minWidth: 0,
  fontSize: 12,
  textAlign: "left",
  textTransform: "none",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

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
  setInterviewSort,
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
  // N132: opens the rich preview/edit modal on an application's stored docs.
  openApplicationPreview,
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
  emailClassificationsByAppId = NO_CLASSIFICATIONS,
  // Gmail connection state for the applications surface - see
  // app/hooks/useGmailMessages.js. null = connected/ok/not-yet-checked.
  gmailConnection = null,
  // Company & role research column - see app/hooks/useApplicationDigests.js.
  digestsById = NO_DIGESTS,
  researchingIds,
  researchOne,
}) {
  // Below the `md` breakpoint the dense data table is unusable, so the rows are
  // rendered as stacked cards instead (set in Phase 3 of the responsive work).
  const isCompact = useIsTablet();

  // Fixed-identity forwarders for the handlers the memoized rows and cards
  // call (see STABLE_HANDLER_NAMES): a page re-render that changes none of a
  // row's data no longer re-renders the row.
  const h = useStableHandlers(
    {
      setAppDialog,
      setStageError,
      setStageDialog,
      openCommsInAppDialog,
      openAddCommunicationDialog,
      askAiAbout,
      buildApplicationContextString,
      buildStageContextString,
      openEditApplicationDialog,
      openApplicationPreview,
      handleDeleteApplication,
      downloadDocxFiles,
      getDownloadFileNameForTitle,
      researchOne,
    },
    STABLE_HANDLER_NAMES,
  );
  // View/Edit exists only where the caller wired the opener (a caller that
  // does not gets no control rather than one that throws on click), so the
  // forwarder is passed down only when there is something to forward to.
  const previewOpener = typeof openApplicationPreview === "function" ? h.openApplicationPreview : undefined;

  // application id -> its index in applicationData, built once per data change
  // instead of a findIndex scan per visible row (that scan was O(n^2) a render).
  const indexById = useMemo(() => indexApplicationsById(applicationData), [applicationData]);

  // A desktop row's stage chip: open the stage dialog on that stage. Lives here
  // rather than in ApplicationRow.js so the row stays a pure view of its props
  // and this file keeps owning the dialog it feeds. A useCallback of fixed
  // identity (its only dependency is the stable bundle) so passing it to a
  // memoized row costs nothing.
  const openStageDialog = useCallback((app, stage) => {
    h.setStageError("");
    h.setStageDialog(createStageDialogState({
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
  }, [h]);

  // The single decision tree for the digest cell, shared by the desktop
  // table cell and the phone card block below - two render call sites for
  // one column (see the AC's own survey: a column added only to the table is
  // invisible on a phone). A real MUI <Button> in every branch, never a Box
  // with an onClick: the row itself has an onClick that opens the edit
  // dialog, guarded on `e.target.closest("a, button, ...")`, so anything
  // that renders as something else gets swallowed by the row click.
  //
  // A useCallback, not a per-render function: it is handed to every memoized
  // row and card, so a new identity each render would re-render them all. It
  // changes exactly when a digest or the researching set does, which is when
  // a cell's output can change.
  const renderDigestCell = useCallback((app, idx) => {
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
            sx={RESEARCHING_BUTTON_SX}
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
              onClick={() => h.setAppDialog({ open: true, rowIndex: idx, kind: "digest" })}
              sx={DIGEST_SUMMARY_SX}
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
          <Button size="small" sx={RETRY_BUTTON_SX} onClick={() => h.researchOne(app.id)}>
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
          onClick={() => h.setAppDialog({ open: true, rowIndex: idx, kind: "digest" })}
          sx={DIGEST_SUMMARY_SX}
        >
          {summary}
        </Button>
      );
    }

    return (
      // researchOne is always passed by app/page.js (see useApplicationDigests) —
      // call it directly so a future wiring regression throws instead of
      // silently no-opping the button.
      <Button size="small" variant="outlined" sx={RESEARCH_BUTTON_SX} onClick={() => h.researchOne(app.id)}>
        Research
      </Button>
    );
  }, [digestsById, researchingIds, h]);

  // AC-K2: the desktop-only (>=900px) download affordance for a row's
  // tailored resume. Used to be a hand-rolled `<span role="button" tabIndex
  // ={0}>` with no key handler at all -- Tab reached it, a screen reader
  // announced "button", and Enter/Space did nothing. A real IconButton gets
  // Enter/Space from the browser for free and carries `.MuiButtonBase-root`,
  // so it inherits the app-wide focus ring. The unavailable case is exposed
  // programmatically via `aria-disabled`, NOT the `disabled` attribute --
  // `app/components/ChatPanel.js`'s Send button states this repo's rule in
  // writing: `disabled` sets `tabindex="-1"`, which removes the control from
  // the tab order and takes the `aria-label`/tooltip explaining WHY it's
  // unavailable out of reach of the exact users who need it read aloud. The
  // `onClick`/`onDragStart` guards below already no-op when unavailable, so
  // `aria-disabled` costs nothing functionally and the `opacity` styling
  // below stands in for the `.Mui-disabled` look `disabled` would otherwise
  // have supplied. Dragging the resolved .docx straight into an ATS upload
  // field is why `onDragStart` and `draggable` stay -- MUI's button roots
  // carry both fine. The <900px card branch (renderDigestCell's caller
  // above) already renders a real `<Button>Download</Button>` and is
  // untouched by this.
  //
  // A useCallback for the same reason as renderDigestCell: the desktop rows
  // take it as a prop, so it changes identity only when the resume file does.
  const renderDownloadControl = useCallback((pos, resume) => {
    const downloadUnavailable = !resumeFile || !isDocxResume(resumeFile);
    const downloadTitle = !resumeFile
      ? "Upload your source resume (.docx) to enable downloads."
      : !isDocxResume(resumeFile)
      ? "Source resume must be a .docx file to download."
      : "Download or drag to upload tailored .docx";
    const lines = Array.isArray(resume.content_lines) && resume.content_lines.length > 0
      ? resume.content_lines
      : (resume.content || "").split("\n");
    return (
      <Tooltip title={downloadTitle}>
        <span>
          <IconButton
            size="small"
            aria-label={downloadTitle}
            aria-disabled={downloadUnavailable}
            draggable={!downloadUnavailable}
            onDragStart={async (e) => {
              if (downloadUnavailable) return;
              try {
                const blob = await resolveDocumentBlob({
                  docxPath: resume.docx_path || "",
                  edited: false,
                  text: resume.content,
                  lines,
                  uploadedTemplate: resumeFile,
                });
                if (!blob) return;
                const file = new File([blob], h.getDownloadFileNameForTitle(pos?.title, pos?.company), { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
                e.dataTransfer.clearData();
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "");
                e.dataTransfer.items.add(file);
              } catch {}
            }}
            onClick={async () => {
              if (downloadUnavailable) return;
              const err = await h.downloadDocxFiles({
                jobTitle: pos?.title || "resume",
                company: pos?.company,
                result: resume.content,
                resultLines: lines,
                coverLetterResultLines: [],
                docxPath: resume.docx_path || "",
              });
              if (err) window.alert(err);
            }}
            sx={{
              ...TOUCH_ICON_SX,
              // `disabled` is deliberately not used here (see the comment
              // above) -- this stands in for the `.Mui-disabled` dimming it
              // would otherwise have supplied, without taking the tab stop.
              ...(downloadUnavailable ? { opacity: 0.5, pointerEvents: "none" } : null),
            }}
          >
            <DescriptionIcon fontSize="small" color="primary" />
          </IconButton>
        </span>
      </Tooltip>
    );
  }, [resumeFile, isDocxResume, h]);

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

      <GmailConnectionNotice cause={gmailConnection?.cause} />

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
              {/* AC-K4: the desktop TableSortLabels above live only in the
                  <TableHead> this branch replaces wholesale below 900px -- a
                  laptop with devtools open included, not just a phone -- so
                  without an equivalent here sorting is unreachable at that
                  width. A native <select> (not MUI's own Select) is
                  deliberate: same reasoning as RolePicker.js -- the UA's own
                  control gets the focus ring and Enter/Space/arrow-key
                  activation for free, and its accessible name can never
                  drift from the option that's actually selected the way
                  MUI's non-native Select can (see that file's own comment).
                  "Default order" (value "") is a real option, not a
                  placeholder -- choosing it resets the sort, which is this
                  layout's only route back to fetch order once the user has
                  sorted (the desktop 3-state cycle has one: a third click on
                  the same TableSortLabel clears it via toggleInterviewSort).
                  `inputLabel: { shrink: true }` is required unconditionally
                  for the same reason MicPicker.js's comment gives: a native
                  select has no genuinely blank state for the floating label
                  to sit on top of -- "Default order" is always showing, even
                  at `value: ""` -- so without it the label renders on top of
                  that text instead of shrinking above the field. */}
              <TextField
                select
                size="small"
                label="Sort by"
                value={interviewSort.field ? `${interviewSort.field}:${interviewSort.dir}` : ""}
                onChange={(e) => {
                  if (typeof setInterviewSort !== "function") return;
                  const raw = e.target.value;
                  if (!raw) {
                    setInterviewSort({ field: null, dir: "asc" });
                    return;
                  }
                  const [field, dir] = raw.split(":");
                  setInterviewSort({ field, dir });
                }}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ alignSelf: "flex-start", minWidth: 200, ...TOUCH_FIELD_SX, ...TOUCH_NATIVE_SELECT_SX }}
              >
                {SORT_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </TextField>
              {visibleApplicationData.map((app) => (
                // The row body itself (touch targets, wrapping, stage chip,
                // eight actions) lives in ApplicationCard.js -- extracted so
                // this file stays under its 1000-line cap. See that
                // component's own header comment for why the extraction is
                // invisible to this file's tests. Every prop here is stable
                // across a re-render that changes nothing about THIS app (the
                // handlers are fixed-identity forwarders), which is what lets
                // the card's React.memo skip it.
                <ApplicationCard
                  key={app.id}
                  app={app}
                  idx={indexById.get(app.id) ?? -1}
                  applicationStages={applicationStages}
                  emailClassificationsByAppId={emailClassificationsByAppId}
                  resumeFile={resumeFile}
                  isDocxResume={isDocxResume}
                  highlightedAppId={highlightedAppId}
                  renderDigestCell={renderDigestCell}
                  setAppDialog={h.setAppDialog}
                  setStageError={h.setStageError}
                  setStageDialog={h.setStageDialog}
                  openCommsInAppDialog={h.openCommsInAppDialog}
                  askAiAbout={h.askAiAbout}
                  buildApplicationContextString={h.buildApplicationContextString}
                  openEditApplicationDialog={h.openEditApplicationDialog}
                  openApplicationPreview={previewOpener}
                  handleDeleteApplication={h.handleDeleteApplication}
                  downloadDocxFiles={h.downloadDocxFiles}
                />
              ))}
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
                  <TableCell sx={{ fontWeight: 700 }}>Interview Prep</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Job Description</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Your Resume</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Links</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {/* The row body lives in ApplicationRow.js (the desktop twin of
                    ApplicationCard) as a React.memo component. Its stages /
                    email-classification / highlight props are THIS row's own
                    slice of each map, so a change to another row does not
                    re-render it. */}
                {visibleApplicationData.map((app) => (
                  <ApplicationRow
                    key={app.id}
                    app={app}
                    idx={indexById.get(app.id) ?? -1}
                    stages={applicationStages[app.id]}
                    emailClassification={emailClassificationsByAppId[app.id] ?? null}
                    highlighted={highlightedAppId === app.id}
                    companyColWidth={companyColWidth}
                    roleColWidth={roleColWidth}
                    renderDigestCell={renderDigestCell}
                    renderDownloadControl={renderDownloadControl}
                    openStageDialog={openStageDialog}
                    openApplicationPreview={previewOpener}
                    handlers={h}
                  />
                ))}
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
