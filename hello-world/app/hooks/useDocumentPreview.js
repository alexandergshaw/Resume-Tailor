"use client";

import { useState } from "react";
import {
  base64ToDocxBlob,
  isDocxResume,
  buildDocxFromUploadedTemplate,
  buildTemplateLinesForUpload,
} from "../../lib/document/docx";
import { parseDocxToModel, linesToModel } from "../../lib/document/docxPreview";

// Resume/cover-letter preview + edit modal (opened from the status-bar chips and
// at the end of a Generate flow). Renders the faithful .docx (or a plain-text
// fallback), lets the user edit/save/download, and can re-run Gemini with
// free-text steering instructions.
//
// Depends on the parent's tailoring map (+ setters), the uploaded files and
// tailoring inputs, the docx downloader, the company-research warm-up, and the
// preview reload key (kept in the parent so research can also bump it).
export function useDocumentPreview({
  tailoringMap,
  setTailoringMap,
  updateTailoringJob,
  resumeFile,
  coverLetterFile,
  additionalContext,
  aggressiveness,
  contextFiles,
  downloadDocxFiles,
  startBackgroundResearch,
  setPreviewReloadKey,
}) {
  const [resumePreview, setResumePreview] = useState({
    open: false,
    jobId: null,
    title: "",
    company: "",
    tab: "resume",
    posting: "",
    url: "",
    busy: false,
    notice: "",
    error: "",
  });

  // Does the tailoring entry have content for a given scope?
  function previewScopeAvailable(entry, scope) {
    if (!entry) return false;
    if (scope === "cover") {
      return Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
    }
    return typeof entry.result === "string" && entry.result.trim().length > 0;
  }

  function openResumePreview(job, opts = {}) {
    if (!job) return;
    const t = tailoringMap[job.id] || {};
    const wantsCover = opts.tab === "cover" && previewScopeAvailable(t, "cover");
    setResumePreview({
      open: true,
      jobId: job.id,
      title: t.generatedJobTitle || job.title || "",
      company: job.company || "",
      tab: wantsCover ? "cover" : "resume",
      posting: t.jobDescription || job.description || "",
      url: job.url || "",
      busy: false,
      notice: "",
      error: "",
    });
    // Warm company research as soon as the preview opens (only when a cover
    // letter exists — that's where the references are used).
    if (previewScopeAvailable(t, "cover")) {
      startBackgroundResearch({
        jobId: job.id,
        company: job.company || "",
        jobTitle: t.generatedJobTitle || job.title || "",
        posting: t.jobDescription || job.description || "",
      });
    }
  }

  function closeResumePreview() {
    setResumePreview((prev) => ({ ...prev, open: false }));
  }

  // The faithful .docx blob for a scope: serve the engine's finished doc when
  // unedited, otherwise rebuild from the (edited) text through the user's
  // template so formatting is preserved.
  async function buildPreviewBlob(scope) {
    const entry = tailoringMap[resumePreview.jobId] || {};
    if (scope === "cover") {
      const lines = Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [];
      if (!entry.edited && typeof entry.coverLetterDocxB64 === "string" && entry.coverLetterDocxB64) {
        return base64ToDocxBlob(entry.coverLetterDocxB64);
      }
      if (isDocxResume(coverLetterFile)) {
        return buildDocxFromUploadedTemplate(coverLetterFile, lines.join("\n"), lines);
      }
      return null; // plain-text fallback handled by the loader
    }
    const lines = Array.isArray(entry.resultLines) ? entry.resultLines : [];
    if (!entry.edited && typeof entry.docxB64 === "string" && entry.docxB64) {
      return base64ToDocxBlob(entry.docxB64);
    }
    if (isDocxResume(resumeFile)) {
      return buildDocxFromUploadedTemplate(resumeFile, entry.result || "", lines);
    }
    return null;
  }

  // Parse the active document into a render model for the preview dialog. Falls
  // back to a plain-text model when there is no .docx template to mirror.
  async function loadPreviewModel(scope) {
    const entry = tailoringMap[resumePreview.jobId] || {};
    const blob = await buildPreviewBlob(scope);
    if (blob) return parseDocxToModel(await blob.arrayBuffer());
    const lines =
      scope === "cover"
        ? entry.coverLetterResultLines || []
        : entry.resultLines || String(entry.result || "").split("\n");
    return linesToModel(lines);
  }

  // The text + line payload currently stored for a scope (seed for the editor).
  function previewScopeText(entry, scope) {
    if (scope === "cover") {
      const lines = Array.isArray(entry?.coverLetterResultLines) ? entry.coverLetterResultLines : [];
      return lines.join("\n");
    }
    return entry?.result || "";
  }

  // Save edits back to the tailoring entry so this becomes the document the
  // posting's chip uses for download / drag this session. Called continuously by
  // the preview's auto-save, so it stays quiet — the dialog shows its own inline
  // "saved" indicator rather than a notice banner here.
  function saveDocumentPreview(scope, payload) {
    const jobId = resumePreview.jobId;
    if (!jobId) return;
    const text = typeof payload === "string" ? payload : payload?.text || "";
    const html = typeof payload === "object" ? payload?.html : undefined;
    const lines = text.split("\n");
    setTailoringMap((current) => {
      const entry = current[jobId] || {};
      const next =
        scope === "cover"
          ? { ...entry, coverLetterResultLines: lines, coverLetterPreviewHtml: html, edited: true }
          : { ...entry, result: text, resultLines: lines, resumePreviewHtml: html, edited: true };
      return { ...current, [jobId]: { ...next, status: entry.status || "done" } };
    });
  }

  // Persist a user-typed download file name (base, no extension) for a scope so
  // downloads use it in place of the derived "<Company> - <Position> - …" name.
  function renameDocument(scope, name) {
    const jobId = resumePreview.jobId;
    if (!jobId) return;
    const clean = String(name || "").trim();
    setTailoringMap((current) => {
      const entry = current[jobId] || {};
      const key = scope === "cover" ? "coverLetterFileName" : "resumeFileName";
      return { ...current, [jobId]: { ...entry, [key]: clean } };
    });
  }

  async function downloadDocumentPreview(scope, payload) {
    const text = typeof payload === "string" ? payload : payload?.text || "";
    const lines = text.split("\n");
    setResumePreview((prev) => ({ ...prev, busy: true, error: "", notice: "" }));
    const entry = tailoringMap[resumePreview.jobId] || {};
    const unchanged = text === previewScopeText(entry, scope);
    const serveFinished = !entry.edited && unchanged;
    const args = {
      jobTitle: resumePreview.title,
      company: resumePreview.company,
      result: "",
      resultLines: [],
      coverLetterResultLines: [],
      docxB64: "",
      coverLetterDocxB64: "",
    };
    if (scope === "cover") {
      args.coverLetterResultLines = lines;
      args.coverLetterFileName = entry.coverLetterFileName || "";
      if (serveFinished && typeof entry.coverLetterDocxB64 === "string") args.coverLetterDocxB64 = entry.coverLetterDocxB64;
    } else {
      args.result = text;
      args.resultLines = lines;
      args.resumeFileName = entry.resumeFileName || "";
      if (serveFinished && typeof entry.docxB64 === "string") args.docxB64 = entry.docxB64;
      // Restored chips have no in-session docx blob but do carry the saved
      // storage path — serve that faithful copy when the text is unedited.
      if (serveFinished && !entry.docxB64 && typeof entry.docxPath === "string" && entry.docxPath) {
        args.docxPath = entry.docxPath;
      }
    }
    const err = await downloadDocxFiles(args);
    setResumePreview((prev) => ({ ...prev, busy: false, error: err || "" }));
  }

  // Re-run the Gemini tailor for the previewed document using the free-text
  // steering instructions the user typed in the preview. Updates only the
  // active scope (resume or cover letter), drops any cached/edited preview HTML
  // so the fresh draft renders, and refreshes the open preview. Returns true on
  // success so the dialog can clear its input. Gemini-only by design — the
  // offline engines don't read steering instructions.
  async function resubmitDocumentPreview(scope, instructions) {
    const jobId = resumePreview.jobId;
    const text = String(instructions || "").trim();
    if (!jobId || !text) return false;
    if (!resumeFile) {
      setResumePreview((prev) => ({ ...prev, error: "Upload a resume first to revise it.", notice: "" }));
      return false;
    }
    const entry = tailoringMap[jobId] || {};
    const posting = (resumePreview.posting || entry.jobDescription || "").trim();
    const url = (resumePreview.url || "").trim();
    if (!posting && !url) {
      setResumePreview((prev) => ({ ...prev, error: "Couldn't find the job posting to revise against.", notice: "" }));
      return false;
    }
    const applyCover = scope === "cover";

    setResumePreview((prev) => ({ ...prev, busy: true, notice: "", error: "" }));
    try {
      const formData = new FormData();
      if (posting) formData.append("jobPosting", posting);
      else formData.append("jobPostingUrl", url);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
      formData.append("engine", "gemini");
      formData.append("steeringInstructions", text);
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));
      contextFiles.forEach((file) => formData.append("contextFiles", file));
      formData.append("resume", resumeFile);
      // Only regenerate the cover letter when that's the document being revised.
      if (applyCover && coverLetterFile) {
        const coverLetterTemplateLines = await buildTemplateLinesForUpload(coverLetterFile);
        formData.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
        formData.append("coverLetter", coverLetterFile);
      }

      const response = await fetch("/api/tailor", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to revise the document.");

      if (applyCover) {
        const lines = Array.isArray(payload.coverLetterResultLines) ? payload.coverLetterResultLines : [];
        const coverErr = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
        if (coverErr) throw new Error(coverErr);
        if (lines.length === 0) throw new Error("Gemini returned an empty cover letter.");
        updateTailoringJob(jobId, {
          coverLetterResultLines: lines,
          coverLetterDocxB64: typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "",
          coverLetterPreviewHtml: undefined,
          edited: false,
          status: "done",
        });
      } else {
        const result = payload.result?.trim() || "";
        const lines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
        if (!result) throw new Error("Gemini returned an empty resume.");
        const nextTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
        updateTailoringJob(jobId, {
          result,
          resultLines: lines,
          docxB64: typeof payload.docxB64 === "string" ? payload.docxB64 : "",
          resumePreviewHtml: undefined,
          ...(nextTitle ? { generatedJobTitle: nextTitle } : {}),
          edited: false,
          status: "done",
        });
      }

      setPreviewReloadKey((k) => k + 1);
      setResumePreview((prev) => ({
        ...prev,
        busy: false,
        error: "",
        notice: `Revised the ${applyCover ? "cover letter" : "resume"} with your instructions.`,
      }));
      return true;
    } catch (err) {
      setResumePreview((prev) => ({ ...prev, busy: false, error: err?.message || "Couldn't revise the document.", notice: "" }));
      return false;
    }
  }

  // Called by the Generate flows once the resume + cover letter exist: open the
  // preview modal (cover tab when there's a cover letter) and warm company
  // research in the background so it's ready behind the "Research company" button.
  // The user reviews and downloads from the preview.
  function finishByOpeningPreview(ctx) {
    const { jobId, jobTitle, company, posting, url, applyCover, coverLetterResultLines } = ctx;
    const hasCover =
      applyCover && Array.isArray(coverLetterResultLines) && coverLetterResultLines.length > 0;
    setResumePreview({
      open: true,
      jobId,
      title: jobTitle || "",
      company: company || "",
      tab: hasCover ? "cover" : "resume",
      posting: posting || "",
      url: url || "",
      busy: false,
      notice: "",
      error: "",
    });
    if (hasCover) startBackgroundResearch({ jobId, company, jobTitle, posting });
  }

  return {
    resumePreview,
    previewScopeAvailable,
    openResumePreview,
    closeResumePreview,
    loadPreviewModel,
    saveDocumentPreview,
    renameDocument,
    downloadDocumentPreview,
    resubmitDocumentPreview,
    finishByOpeningPreview,
  };
}
