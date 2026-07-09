"use client";

import { useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { upsertPosition } from "../../lib/supabase/upsertPosition";
import { saveGeneratedResume } from "../../lib/supabase/saveGeneratedResume";
import { getInterviewStages, upsertInterviewStage } from "../../lib/supabase/upsertInterviewStage";
import { createRecruiterCommunication, listRecruiterCommunications } from "../../lib/supabase/recruiterCommunications";
import { isDocxResume, isTextResume, buildTemplateLinesForUpload } from "../../lib/document/docx";
import { STAGE_TYPE_LABELS, createStageDialogState } from "../../lib/tracking/stages";

// Add/edit/stage/communications dialogs for the Tracking tab, plus their save
// handlers (Supabase mutations). The application data itself (applicationData /
// applicationStages / refresh key) stays in the parent — this hook receives the
// setters so a save can optimistically update or trigger a reload.
export function useApplicationDialogs({
  currentUser,
  setApplicationData,
  setApplicationStages,
  setApplicationsRefreshKey,
}) {
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
    status: "applied",
    appliedAt: "",
    applicationUrl: "",
    description: "",
  });
  const [editAppSaving, setEditAppSaving] = useState(false);
  const [editAppError, setEditAppError] = useState("");
  const [addAppDialog, setAddAppDialog] = useState({
    open: false,
    company: "",
    role: "",
    status: "applied",
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
      status: app.status || "applied",
      appliedAt: app.applied_at ? new Date(app.applied_at).toISOString().slice(0, 10) : "",
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
    if (!editAppDialog.applicationId) return;
    setEditAppSaving(true);
    setEditAppError("");

    const supabase = createClient();

    const appUpdates = {
      status: editAppDialog.status,
      application_url: editAppDialog.applicationUrl.trim() || null,
      applied_at: editAppDialog.appliedAt ? new Date(editAppDialog.appliedAt).toISOString() : null,
    };

    const { error: appErr } = await supabase
      .from("applications")
      .update(appUpdates)
      .eq("id", editAppDialog.applicationId);

    if (appErr) {
      setEditAppError(appErr.message || "Failed to save changes.");
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
              status: appUpdates.status,
              application_url: appUpdates.application_url,
              applied_at: appUpdates.applied_at,
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
      status: "applied",
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
        applied_at: addAppDialog.appliedAt
          ? new Date(addAppDialog.appliedAt).toISOString()
          : new Date().toISOString(),
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
