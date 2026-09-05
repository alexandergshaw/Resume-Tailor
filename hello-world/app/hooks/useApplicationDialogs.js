"use client";

import { useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { upsertPosition } from "../../lib/supabase/upsertPosition";
import { saveGeneratedResume } from "../../lib/supabase/saveGeneratedResume";
import { getInterviewStages, upsertInterviewStage } from "../../lib/supabase/upsertInterviewStage";
import { createRecruiterCommunication, listRecruiterCommunications } from "../../lib/supabase/recruiterCommunications";
import { isDocxResume, isTextResume, buildTemplateLinesForUpload } from "../../lib/document/docx";
import { STAGE_TYPE_LABELS, createStageDialogState } from "../../lib/tracking/stages";
import { setApplicationStatusByUser } from "../../lib/supabase/applicationStatusWriter";
import { buildEditApplicationPayload } from "../../lib/applications/applicationDecisions";
import { STATUS, isAppliedOrLater } from "../../lib/applications/statusVocabulary";

// Add/edit/stage/communications dialogs for the Tracking tab, plus their save
// handlers (Supabase mutations). The application data itself (applicationData /
// applicationStages / refresh key) stays in the parent — this hook receives the
// setters so a save can optimistically update or trigger a reload.
//
// `confirm` is REQUIRED — it is the human door's one guard against silently
// destroying a real `applied_at` (AC-2a). It cannot arrive through either
// dialog (`FormDialog.js` invokes `onSubmit?.()` with zero arguments, and
// neither dialog's prop signature may change — 3-plan-dataloss.md PART 8 /
// X2, X3), so it comes in through this options object instead, supplied by
// `app/page.js`. Thrown here rather than left to fail lazily inside
// `setApplicationStatusByUser` so a wiring mistake surfaces at mount, not at
// the first save that would have needed it.
export function useApplicationDialogs({
  currentUser,
  setApplicationData,
  setApplicationStages,
  setApplicationsRefreshKey,
  confirm,
}) {
  if (typeof confirm !== "function") {
    throw new TypeError("useApplicationDialogs: confirm is required and must be a function");
  }
  const [appDialog, setAppDialog] = useState({ open: false, rowIndex: null, kind: "jd" });
  const [stageDialog, setStageDialog] = useState(createStageDialogState());
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState("");
  const [communicationsDialog, setCommunicationsDialog] = useState({
    open: false,
    applicationId: null,
    company: "",
    role: "",
    loading: false,
    error: "",
    items: [],
  });
  const [addCommunicationDialog, setAddCommunicationDialog] = useState({
    open: false,
    applicationId: null,
    company: "",
    role: "",
    body: "",
    files: [],
  });
  const [communicationSaving, setCommunicationSaving] = useState(false);
  const [communicationError, setCommunicationError] = useState("");
  const [editAppDialog, setEditAppDialog] = useState({
    open: false,
    applicationId: null,
    positionId: null,
    company: "",
    role: "",
    status: STATUS.APPLIED,
    appliedAt: "",
    // The exact `applied_at` PostgREST returned when the dialog was opened —
    // the CAS operand `setApplicationStatusByUser` compares against, not
    // merely a display value. See openEditApplicationDialog below.
    appliedAtStored: null,
    applicationUrl: "",
    description: "",
  });
  const [editAppSaving, setEditAppSaving] = useState(false);
  const [editAppError, setEditAppError] = useState("");
  const [addAppDialog, setAddAppDialog] = useState({
    open: false,
    company: "",
    role: "",
    status: STATUS.APPLIED,
    appliedAt: "",
    applicationUrl: "",
    description: "",
  });
  const [addAppSaving, setAddAppSaving] = useState(false);
  const [addAppError, setAddAppError] = useState("");
  const [addAppResumeFile, setAddAppResumeFile] = useState(null);
  const [editAppResumeFile, setEditAppResumeFile] = useState(null);

  async function loadStagesForApplication(applicationId) {
    if (!applicationId) return;
    const supabase = createClient();
    const stages = await getInterviewStages(supabase, applicationId);
    setApplicationStages((prev) => ({
      ...prev,
      [applicationId]: stages,
    }));
  }

  async function handleSaveStage() {
    if (!currentUser || !stageDialog.applicationId) return;

    setStageSaving(true);
    setStageError("");

    const supabase = createClient();
    const savedStageId = await upsertInterviewStage(supabase, {
      userId: currentUser.id,
      applicationId: stageDialog.applicationId,
      stageId: stageDialog.stageId || undefined,
      stageName: (stageDialog.stageName || STAGE_TYPE_LABELS[stageDialog.stageType] || "Interview Stage").trim(),
      stageType: stageDialog.stageType,
      scheduledAt: stageDialog.scheduledAt ? new Date(stageDialog.scheduledAt).toISOString() : undefined,
      durationMinutes: stageDialog.durationMinutes ? parseInt(stageDialog.durationMinutes, 10) : undefined,
      outcome: stageDialog.outcome,
      interviewerNames: stageDialog.interviewerNames
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      notes: stageDialog.notes.trim() || undefined,
    });

    if (!savedStageId) {
      setStageError("Unable to save interview stage.");
      setStageSaving(false);
      return;
    }

    await loadStagesForApplication(stageDialog.applicationId);
    setStageDialog(createStageDialogState());
    setStageSaving(false);
  }

  async function openCommunicationsDialog(app) {
    if (!currentUser) return;

    setCommunicationsDialog({
      open: true,
      applicationId: app.id,
      company: app.positions?.company || "",
      role: app.positions?.title || "",
      loading: true,
      error: "",
      items: [],
    });

    const supabase = createClient();
    const { data, error } = await listRecruiterCommunications(supabase, app.id);

    setCommunicationsDialog((prev) => {
      if (prev.applicationId !== app.id) return prev;
      return {
        ...prev,
        loading: false,
        error: error?.message || "",
        items: data || [],
      };
    });
  }

  async function loadCommunicationsForApp(app) {
    if (!currentUser || !app?.id) return;
    setCommunicationsDialog((prev) => ({
      ...prev,
      applicationId: app.id,
      company: app.positions?.company || "",
      role: app.positions?.title || "",
      loading: true,
      error: "",
      items: prev.applicationId === app.id ? prev.items : [],
    }));

    const supabase = createClient();
    const { data, error } = await listRecruiterCommunications(supabase, app.id);

    setCommunicationsDialog((prev) => {
      if (prev.applicationId !== app.id) return prev;
      return {
        ...prev,
        loading: false,
        error: error?.message || "",
        items: data || [],
      };
    });
  }

  function openCommsInAppDialog(app, rowIndex) {
    setAppDialog({ open: true, rowIndex, kind: "communications" });
    loadCommunicationsForApp(app);
  }

  function openAddCommunicationDialog(app) {
    setCommunicationError("");
    setAddCommunicationDialog({
      open: true,
      applicationId: app.id,
      company: app.positions?.company || "",
      role: app.positions?.title || "",
      body: "",
      files: [],
    });
  }

  async function handleSaveCommunication() {
    const body = addCommunicationDialog.body.trim();
    const files = addCommunicationDialog.files || [];
    if (!currentUser || !addCommunicationDialog.applicationId || (!body && files.length === 0)) return;

    setCommunicationSaving(true);
    setCommunicationError("");

    const supabase = createClient();
    const { attachments, error: uploadErr } = await uploadCommunicationAttachments(supabase, {
      files,
      userId: currentUser.id,
      applicationId: addCommunicationDialog.applicationId,
    });

    if (uploadErr) {
      setCommunicationError(uploadErr);
      setCommunicationSaving(false);
      return;
    }

    const { error } = await createRecruiterCommunication(supabase, {
      userId: currentUser.id,
      applicationId: addCommunicationDialog.applicationId,
      body,
      attachments,
    });

    if (error) {
      setCommunicationError(error.message || "Unable to save recruiter communication.");
      setCommunicationSaving(false);
      return;
    }

    const applicationId = addCommunicationDialog.applicationId;
    setAddCommunicationDialog({ open: false, applicationId: null, company: "", role: "", body: "", files: [] });
    setCommunicationSaving(false);

    if (communicationsDialog.applicationId === applicationId) {
      const { data, error: reloadError } = await listRecruiterCommunications(supabase, applicationId);
      setCommunicationsDialog((prev) => ({
        ...prev,
        error: reloadError?.message || "",
        items: data || [],
      }));
    }
  }

  function openEditApplicationDialog(app) {
    const pos = app.positions || {};
    setEditAppError("");
    setEditAppResumeFile(null);
    setEditAppDialog({
      open: true,
      applicationId: app.id,
      positionId: pos.id || null,
      company: pos.company || "",
      role: pos.title || "",
      status: app.status || STATUS.APPLIED,
      appliedAt: app.applied_at ? new Date(app.applied_at).toISOString().slice(0, 10) : "",
      appliedAtStored: app.applied_at ?? null,
      applicationUrl: app.application_url || pos.url || "",
      description: pos.description || "",
    });
  }

  async function uploadAndLinkResumeForApplication(supabase, {
    file,
    userId,
    applicationId,
    positionId,
  }) {
    if (!file || !userId || !applicationId) return { error: null };
    if (!isDocxResume(file) && !isTextResume(file)) {
      return { error: "Resume must be a .docx or .txt file." };
    }

    const ext = isDocxResume(file) ? "docx" : "txt";
    const storagePath = `${userId}/applications/${applicationId}.${ext}`;

    const { error: uploadErr } = await supabase
      .storage
      .from("resumes")
      .upload(storagePath, file, { upsert: true, contentType: file.type || undefined });
    if (uploadErr) {
      return { error: uploadErr.message || "Failed to upload resume." };
    }

    let contentLines = [];
    try {
      contentLines = await buildTemplateLinesForUpload(file);
    } catch {
      contentLines = [];
    }
    const content = (contentLines || []).join("\n").trim();
    if (!content) {
      return { error: "Could not extract text from the uploaded resume." };
    }

    const generatedResumeId = await saveGeneratedResume(supabase, {
      userId,
      positionId: positionId || null,
      content,
      contentLines,
      sourceResumePath: storagePath,
    });

    if (!generatedResumeId) {
      return { error: "Failed to save resume record." };
    }

    const { error: appErr } = await supabase
      .from("applications")
      .update({ resume_used_id: generatedResumeId })
      .eq("id", applicationId);
    if (appErr) {
      return { error: appErr.message || "Failed to link resume to application." };
    }

    return { error: null };
  }

  async function uploadCommunicationAttachments(supabase, { files, userId, applicationId }) {
    if (!files || files.length === 0) {
      return { attachments: [], error: null };
    }

    const attachments = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const sanitized = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
      const path = `${userId}/communications/${applicationId}/${Date.now()}-${i}-${sanitized}`;

      const { error: uploadErr } = await supabase
        .storage
        .from("resumes")
        .upload(path, file, { upsert: true, contentType: file.type || undefined });

      if (uploadErr) {
        return { attachments: [], error: uploadErr.message || "Failed to upload attachment." };
      }

      attachments.push({
        name: file.name,
        path,
        type: file.type || "",
        size: file.size || 0,
      });
    }

    return { attachments, error: null };
  }

  async function handleSaveEditApplication() {
    if (!editAppDialog.applicationId || !currentUser) return;
    setEditAppSaving(true);
    setEditAppError("");

    const supabase = createClient();

    // `applied_at` is present in `payload` ONLY when the date-only string
    // actually differs from the stored date (AC-8b) — today's inline literal
    // named it on EVERY save, which rewrote the column via a UTC round-trip
    // on a save that touched nothing but the URL. See
    // lib/applications/applicationDecisions.js's buildEditApplicationPayload.
    const { payload } = buildEditApplicationPayload({
      form: {
        status: editAppDialog.status,
        appliedAt: editAppDialog.appliedAt,
        applicationUrl: editAppDialog.applicationUrl,
      },
      storedAppliedAt: editAppDialog.appliedAtStored,
    });
    const dateSupplied = Object.prototype.hasOwnProperty.call(payload, "applied_at");

    // The guarded statement: status + (maybe) applied_at, through the ONE
    // door this repo trusts with them — tenant-filtered, compare-and-set on
    // applied_at, and gated by an explicit confirmation whenever the save
    // would clear or overwrite a real date (AC-2a). See
    // lib/supabase/applicationStatusWriter.js's setApplicationStatusByUser.
    const result = await setApplicationStatusByUser(supabase, {
      applicationId: editAppDialog.applicationId,
      userId: currentUser.id,
      status: payload.status,
      ...(dateSupplied ? { appliedAt: payload.applied_at } : {}),
      appliedAtStored: editAppDialog.appliedAtStored,
      confirm,
    });

    if (result.reason === "declined") {
      // The user backed out of the confirmation. Leave the dialog open with
      // nothing saved rather than silently discarding their edits.
      setEditAppSaving(false);
      return;
    }
    if (!result.changed) {
      setEditAppError(
        result.reason === "stale"
          ? "This application changed elsewhere since the dialog opened. Close it and reopen to try again."
          : "Failed to save changes.",
      );
      setEditAppSaving(false);
      return;
    }

    // `application_url` is not a status/date concern, so it is not part of
    // the guarded statement above — same reasoning as the position fields
    // below, on their own statement.
    const { error: urlErr } = await supabase
      .from("applications")
      .update({ application_url: payload.application_url })
      .eq("id", editAppDialog.applicationId)
      .eq("user_id", currentUser.id);

    if (urlErr) {
      setEditAppError(urlErr.message || "Failed to save changes.");
      setEditAppSaving(false);
      return;
    }

    if (editAppDialog.positionId) {
      const posUpdates = {
        title: editAppDialog.role.trim() || null,
        company: editAppDialog.company.trim() || null,
        description: editAppDialog.description || null,
      };
      const { error: posErr } = await supabase
        .from("positions")
        .update(posUpdates)
        .eq("id", editAppDialog.positionId);

      if (posErr) {
        setEditAppError(posErr.message || "Failed to save position changes.");
        setEditAppSaving(false);
        return;
      }
    }

    setApplicationData((prev) =>
      prev.map((a) =>
        a.id === editAppDialog.applicationId
          ? {
              ...a,
              status: payload.status,
              application_url: payload.application_url,
              // Untouched when the date-only string didn't change (AC-8b) —
              // the write above named nothing, so the prior value is still
              // exactly what's stored.
              applied_at: dateSupplied ? payload.applied_at : a.applied_at,
              positions: a.positions
                ? {
                    ...a.positions,
                    title: editAppDialog.role.trim() || a.positions.title,
                    company: editAppDialog.company.trim() || a.positions.company,
                    description: editAppDialog.description,
                  }
                : a.positions,
            }
          : a,
      ),
    );

    if (editAppResumeFile && currentUser?.id) {
      const { error: resumeErr } = await uploadAndLinkResumeForApplication(supabase, {
        file: editAppResumeFile,
        userId: currentUser.id,
        applicationId: editAppDialog.applicationId,
        positionId: editAppDialog.positionId,
      });
      if (resumeErr) {
        setEditAppError(resumeErr);
        setEditAppSaving(false);
        return;
      }
      setApplicationsRefreshKey((k) => k + 1);
    }

    setEditAppResumeFile(null);
    setEditAppSaving(false);
    setEditAppDialog((prev) => ({ ...prev, open: false }));
  }

  function openAddApplicationDialog() {
    setAddAppError("");
    setAddAppResumeFile(null);
    setAddAppDialog({
      open: true,
      company: "",
      role: "",
      status: STATUS.APPLIED,
      appliedAt: new Date().toISOString().slice(0, 10),
      applicationUrl: "",
      description: "",
    });
  }

  async function handleSaveAddApplication() {
    if (!currentUser) return;
    const company = addAppDialog.company.trim();
    const role = addAppDialog.role.trim();
    if (!company || !role) {
      setAddAppError("Company and Role are required.");
      return;
    }
    setAddAppSaving(true);
    setAddAppError("");
    const supabase = createClient();

    const externalId = `manual-${(typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

    const positionId = await upsertPosition(supabase, {
      id: externalId,
      title: role,
      company,
      description: addAppDialog.description || null,
      url: addAppDialog.applicationUrl.trim() || null,
    });

    if (!positionId) {
      setAddAppError("Failed to save position.");
      setAddAppSaving(false);
      return;
    }

    const { data: insertedApp, error: appErr } = await supabase
      .from("applications")
      .insert({
        user_id: currentUser.id,
        position_id: positionId,
        status: addAppDialog.status,
        application_url: addAppDialog.applicationUrl.trim() || null,
        // [R2-M4] `now()` is only a defensible guess for a BLANK date when
        // the chosen status is applied-or-later (today's behaviour,
        // unchanged). For a pre-apply status (e.g. "tracking") a blank date
        // must stay null — stamping `now()` here fabricated an application
        // date the user never gave, which then classified the row as
        // applied-or-later on the strength of that date alone (see
        // lib/supabase/applicationStatusWriter.js's loadAppliedOrLaterExternalIds
        // and 3-plan-dataloss.md PART 4 / F-4). A user who TYPES a date keeps
        // it regardless of status — this only changes the blank case, and
        // only for a pre-apply status.
        applied_at: isAppliedOrLater(addAppDialog.status)
          ? (addAppDialog.appliedAt ? new Date(addAppDialog.appliedAt).toISOString() : new Date().toISOString())
          : (addAppDialog.appliedAt ? new Date(addAppDialog.appliedAt).toISOString() : null),
      })
      .select("id")
      .single();

    if (appErr) {
      setAddAppError(appErr.message || "Failed to save application.");
      setAddAppSaving(false);
      return;
    }

    if (addAppResumeFile && insertedApp?.id) {
      const { error: resumeErr } = await uploadAndLinkResumeForApplication(supabase, {
        file: addAppResumeFile,
        userId: currentUser.id,
        applicationId: insertedApp.id,
        positionId,
      });
      if (resumeErr) {
        setAddAppError(resumeErr);
        setAddAppSaving(false);
        return;
      }
    }

    setAddAppResumeFile(null);
    setAddAppSaving(false);
    setAddAppDialog((prev) => ({ ...prev, open: false }));
    setApplicationsRefreshKey((k) => k + 1);
  }

  async function handleDeleteApplication(app) {
    if (!app?.id) return;
    const label = `${app.positions?.company || "this application"}${app.positions?.title ? ` — ${app.positions.title}` : ""}`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

    const supabase = createClient();
    const { error } = await supabase.from("applications").delete().eq("id", app.id);
    if (error) {
      window.alert(error.message || "Failed to delete application.");
      return;
    }

    setApplicationData((prev) => prev.filter((a) => a.id !== app.id));
    setApplicationStages((prev) => {
      if (!(app.id in prev)) return prev;
      const next = { ...prev };
      delete next[app.id];
      return next;
    });
  }

  return {
    appDialog, setAppDialog,
    stageDialog, setStageDialog,
    stageSaving, stageError, setStageError,
    communicationsDialog, setCommunicationsDialog,
    addCommunicationDialog, setAddCommunicationDialog,
    communicationSaving, communicationError, setCommunicationError,
    editAppDialog, setEditAppDialog,
    editAppSaving, editAppError,
    addAppDialog, setAddAppDialog,
    addAppSaving, addAppError,
    addAppResumeFile, setAddAppResumeFile,
    editAppResumeFile, setEditAppResumeFile,
    handleSaveStage,
    openCommunicationsDialog,
    loadCommunicationsForApp,
    openCommsInAppDialog,
    openAddCommunicationDialog,
    handleSaveCommunication,
    openEditApplicationDialog,
    handleSaveEditApplication,
    openAddApplicationDialog,
    handleSaveAddApplication,
    handleDeleteApplication,
  };
}
