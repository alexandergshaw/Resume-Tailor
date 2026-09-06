"use client";
import { useEffect, useRef, useState } from "react";
import { buildTemplateLinesForUpload } from "../../lib/document/docx";
import {
  editedForScope,
  withEditedScope,
  buildPreviewBlob,
  scopeText,
} from "../../lib/document/previewBlob";
import { parseDocxToModel, linesToModel, modelToLines } from "../../lib/document/docxPreview";
import { markVersionChanges } from "../../lib/document/versionDiff";
import { addedEditText, editFingerprint } from "../../lib/tailor/editMining";
import { deriveEditRules } from "../../lib/tailor/editRules";
import {
  recordSteering,
  steeringHabitHint,
  recordEditRules,
  promotedEditRules,
  persistedEditRules,
  newlyPromotableEditRules,
  recordFocusOverride,
  focusOverrideHint,
  recordBuzzwordEdits,
  buzzwordEditHints,
  recordVariantOverride,
  variantOverrideHint,
} from "../../lib/tailor/localSignals";
import { syncTemplateEdits } from "../../lib/tailor/templateEdits";
import { applyScopeFlags, lockScopesFor } from "../../lib/tailor/previewScopes";
import { emailPreviewLines } from "../../lib/tailor/documentScopes";
import { readEngine } from "../settings/engine";
import { createClient } from "../../lib/supabase/client";
import { persistGeneratedDocuments } from "../../lib/supabase/persistGeneration";
import { fetchDocumentVersions, pointApplicationAtVersion } from "../../lib/supabase/documentVersions";
import { fireDuplicateCheckSafely } from "../../lib/tailor/duplicateCheckFire";

// Resume/cover-letter preview + edit modal (opened from the status-bar chips and
// at the end of a Generate flow). Renders the faithful .docx (or a plain-text
// fallback), lets the user edit/save/download, and can re-run the selected
// engine with free-text steering instructions (Gemini rewrites freely; the
// embedded engine applies them as emphasize/avoid/aggressiveness directives).
//
// Depends on the parent's tailoring map (+ setters), the uploaded files and
// tailoring inputs, the docx downloader, the company-research warm-up, and the
// preview reload key (kept in the parent so research can also bump it).
//
// busy/notice/error live per-scope ({ resume, cover }) so an operation on one
// document (revise, download) never disables, or overwrites the notice/error
// of, the other document's controls.
const EMPTY_SCOPE_FLAGS = { resume: false, cover: false };
const EMPTY_SCOPE_TEXT = { resume: "", cover: "" };
const VERSION_SCOPES = ["resume", "cover"];

// edited/*: the tailoring entry's hand-edit flag, per scope ({ resume, cover }),
// just like busy/notice/error above. editedForScope/withEditedScope (imported
// above) hold the full contract — an object is ALWAYS truthy, never
// `if (entry.edited)` — and now live in lib/document/previewBlob.js, which
// buildPreviewBlob also needs and which has no reason to depend on React.

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
  onDocumentEdited,
  currentUser, onCheckDuplicate, // opaque prop -- see lib/tailor/duplicateCheckFire.js
}) {
  const [resumePreview, setResumePreview] = useState({
    open: false,
    jobId: null,
    title: "",
    company: "",
    tab: "resume",
    posting: "",
    url: "",
    busy: { ...EMPTY_SCOPE_FLAGS },
    notice: { ...EMPTY_SCOPE_TEXT },
    error: { ...EMPTY_SCOPE_TEXT },
  });

  // Mirrors the tailoringMap prop so async handlers can read the LATEST map
  // (not the one captured in their render closure) after an await — e.g. so a
  // cover-scoped revise that finishes reads the freshest résumé lines, and a
  // résumé revise finishing doesn't base its "previous value" hint tracking
  // on data a concurrent cover revise already moved past.
  const tailoringMapRef = useRef(tailoringMap);
  useEffect(() => {
    tailoringMapRef.current = tailoringMap;
  }, [tailoringMap]);

  // AC-5 re-entrancy guard: which scopes currently have a resubmit in flight.
  // The disabled button is not the only thing preventing double-submission —
  // this is the hook-level backstop. Different scopes run concurrently; the
  // same scope is rejected.
  const inFlightScopesRef = useRef(new Set());

  // Version history (AC-2/AC-7): per-scope generation trail for the
  // currently open job, newest first. Loaded in the background so opening
  // the preview never waits on it, and left empty when the user is signed
  // out, the job has no position row yet, or the fetch fails — the version
  // control (VersionControl.js) simply stays hidden in all of those cases.
  const [documentVersions, setDocumentVersions] = useState({ resume: [], cover: [] });
  // Which version id is "current" per scope, for the control's selection:
  // the newest fetched row right after a load or a regeneration, or
  // whichever version the user explicitly picked (AC-4).
  const [currentVersionId, setCurrentVersionId] = useState({ resume: null, cover: null });
  // The open job's position row id, resolved alongside the version fetch
  // and reused by the AC-6 pointer update so selecting a version doesn't
  // repeat the external_id lookup.
  const positionIdRef = useRef(null);
  // Bumped on every open (and job switch) so a slow fetch for a job the
  // user has since navigated away from is dropped instead of clobbering the
  // now-current job's version state.
  const versionsRequestIdRef = useRef(0);

  // Functional update to busy/notice/error for one or more scopes, so two
  // overlapping operations finishing out of order each touch only their own
  // scope's flags — the first to finish never re-enables or clears the
  // other's controls (AC-4).
  function setScopeFlags(scopes, patch) {
    setResumePreview((prev) => applyScopeFlags(prev, scopes, patch));
  }

  // Does the tailoring entry have content for a given scope?
  function previewScopeAvailable(entry, scope) {
    if (!entry) return false;
    if (scope === "cover") {
      return Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
    }
    // AC-2: absent for the external engine (and any failed run) — both
    // fields are simply empty in that case, per the generation pipeline.
    if (scope === "email") {
      return Array.isArray(entry.emailResultLines) && entry.emailResultLines.length > 0;
    }
    return typeof entry.result === "string" && entry.result.trim().length > 0;
  }

  // Resolve the position row backing a tracked job's external id. Returns
  // null (never throws) when signed out or the job has no position row yet
  // — both are normal, unremarkable states here (AC-7), not errors.
  async function resolvePositionId(jobId) {
    if (!currentUser?.id || !jobId) return null;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("positions")
        .select("id")
        .eq("external_id", String(jobId))
        .maybeSingle();
      return data?.id || null;
    } catch {
      return null;
    }
  }

  // (Re)load the version history for one or more scopes of `jobId` and
  // merge it into state, guarded by `requestId` so a response for a job the
  // user has since navigated away from is dropped rather than clobbering
  // the current job's history. Pass a resolved `knownPositionId` to skip
  // the external_id lookup when the caller already has it (e.g. right
  // after a revise persists a new generation).
  async function refreshDocumentVersions(jobId, scopesToLoad, requestId, knownPositionId = undefined) {
    const positionId = knownPositionId !== undefined ? knownPositionId : await resolvePositionId(jobId);
    if (versionsRequestIdRef.current !== requestId) return; // superseded by a newer open/switch
    positionIdRef.current = positionId;
    if (!positionId) {
      setDocumentVersions((prev) => {
        const next = { ...prev };
        scopesToLoad.forEach((s) => { next[s] = []; });
        return next;
      });
      setCurrentVersionId((prev) => {
        const next = { ...prev };
        scopesToLoad.forEach((s) => { next[s] = null; });
        return next;
      });
      return;
    }
    const supabase = createClient();
    const results = await Promise.all(
      scopesToLoad.map((s) => fetchDocumentVersions(supabase, s, positionId)),
    );
    if (versionsRequestIdRef.current !== requestId) return; // superseded while the fetch was in flight
    setDocumentVersions((prev) => {
      const next = { ...prev };
      scopesToLoad.forEach((s, i) => { next[s] = results[i]; });
      return next;
    });
    setCurrentVersionId((prev) => {
      const next = { ...prev };
      scopesToLoad.forEach((s, i) => { next[s] = results[i][0]?.id || null; });
      return next;
    });
  }

  // Reset and kick off a background load of both scopes' version history
  // for a newly opened job (AC-2). Fire-and-forget by every caller — this
  // never blocks the preview from opening.
  function loadVersionsForJob(jobId) {
    const requestId = ++versionsRequestIdRef.current;
    setDocumentVersions({ resume: [], cover: [] });
    setCurrentVersionId({ resume: null, cover: null });
    positionIdRef.current = null;
    void refreshDocumentVersions(jobId, VERSION_SCOPES, requestId);
  }

  // AC-3/AC-4: switch the ACTIVE scope's displayed content to a specific
  // saved generation. Writes its content/lines into the tailoring entry —
  // the same entry the preview, download, and drag-to-upload all read from
  // — marks the entry pristine (a stored generation isn't a hand-edit), and
  // bumps the reload key so the dialog's existing cache-invalidation diff
  // (changedScopes, keyed off each scope's own text) drops only this
  // scope's cached render; the other document's signature is untouched, so
  // its cache, draft, and edit mode survive (AC-4's "do not touch the other
  // scope").
  //
  // AC-5 (flushing pending edits before switching) is the caller's job: the
  // dialog calls commitDraft() immediately before invoking this, exactly
  // like its existing tab-switch handler already does.
  function selectDocumentVersion(scope, versionId) {
    const jobId = resumePreview.jobId;
    if (!jobId || resumePreview.busy?.[scope]) return; // AC-8 backstop
    const versions = documentVersions[scope] || [];
    const version = versions.find((v) => v.id === versionId);
    if (!version) return;

    const lines =
      Array.isArray(version.content_lines) && version.content_lines.length > 0
        ? version.content_lines
        : typeof version.content === "string"
          ? version.content.split("\n")
          : [];

    updateTailoringJob(jobId, (entry) => ({
      ...entry,
      ...(scope === "cover"
        ? {
            coverLetterResultLines: lines,
            coverLetterPreviewHtml: undefined,
            // D-1 fix. Without this, docx.js:488 keeps serving the NEWEST
            // generation's bytes for this OLDER version's text. No
            // docx_path column on generated_cover_letters (F-11) to
            // substitute, so loadPreviewModel falls back to the uploaded
            // cover-letter template, or to plain text when none is uploaded,
            // for the rest of the session. ACCEPTED: right content unformatted
            // beats wrong content formatted, which is what ships today. Do
            // not restore the stale bytes or add a docx_path column here.
            coverLetterDocxB64: "",
          }
        : {
            result: typeof version.content === "string" ? version.content : lines.join("\n"),
            resultLines: lines,
            resumePreviewHtml: undefined,
            // D-1 fix: serve THIS version's own stored docx, not docxB64
            // (newest generation) or the stale reload-pointer docxPath. docx_path is nullable with no backfill, so a pre-migration row (or a failed docx upload) has no pointer here either and degrades to the same uploaded-template fallback the cover letter above uses.
            docxB64: "",
            docxPath: version.docx_path || "",
          }),
      // AC-3: clears only THIS scope's edited flag — selecting a résumé
      // version must never discard a hand-edited cover letter's edited
      // state (and vice versa).
      edited: withEditedScope(entry, scope, false),
      status: entry.status || "done",
    }));
    setCurrentVersionId((prev) => ({ ...prev, [scope]: version.id }));
    setPreviewReloadKey((k) => k + 1);

    // AC-6: best-effort — a failure here must never surface to the user or
    // undo the switch above, which has already taken effect.
    const positionId = positionIdRef.current;
    if (currentUser?.id && positionId) {
      const supabase = createClient();
      void pointApplicationAtVersion(supabase, {
        scope,
        versionId: version.id,
        userId: currentUser.id,
        positionId,
      });
    }
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
      busy: { ...EMPTY_SCOPE_FLAGS },
      notice: { ...EMPTY_SCOPE_TEXT },
      error: { ...EMPTY_SCOPE_TEXT },
    });
    loadVersionsForJob(job.id);
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

  // One record per distinct edit session — reopening and closing the preview
  // without new edits must not re-count the same rules toward promotion.
  const editSessionsSeenRef = useRef(new Set());
  // Buzzword toggles count once per job toward the cross-posting counters, so
  // re-applying the same exclusions on one job doesn't inflate "N postings".
  const buzzwordSeenRef = useRef(new Set());

  function closeResumePreview() {
    // The edit session is over — mine what the user changed (vs. the pristine
    // generated text snapshotted on first edit). Added lines feed the buzzword
    // scrape (permission-gated); MODIFIED lines are distilled into rewrite
    // rules and counted across sessions — resume and cover letter edits feed
    // the same counters, and consistent rules get auto-applied at render time.
    const jobId = resumePreview.jobId;
    const entry = jobId ? tailoringMap[jobId] : null;
    // AC-6: edited is per-scope now — mine whichever document(s) were
    // actually hand-edited, not both just because one of them was.
    const resumeEdited = editedForScope(entry, "resume");
    const coverEdited = editedForScope(entry, "cover");
    if (entry && (resumeEdited || coverEdited)) {
      try {
        // Snapshot which rules are already saved to the template, so an undo that
        // deletes one (recordEditRules self-heal) can be un-saved from it too.
        const persistedBefore = persistedEditRules();
        let recorded = false;
        for (const [doc, wasEdited, pristine, current] of [
          ["resume", resumeEdited, entry.pristineResumeLines, entry.resultLines],
          ["cover", coverEdited, entry.pristineCoverLines, entry.coverLetterResultLines],
        ]) {
          if (!wasEdited || !pristine) continue;
          const rules = deriveEditRules(pristine, current);
          if (rules.length === 0) continue;
          const sessionKey = `${jobId}:${doc}:${editFingerprint(JSON.stringify(rules))}`;
          if (editSessionsSeenRef.current.has(sessionKey)) continue;
          editSessionsSeenRef.current.add(sessionKey);
          recordEditRules(rules, { doc });
          recorded = true;
        }
        // Auto-apply is unchanged (promotedEditRules keeps applying these). What's
        // new: once a rule has recurred enough, save it to the server-side library
        // so it becomes a permanent part of the template — applied on every future
        // generation and across devices, not just replayed from this one. And a
        // rule an undo just removed gets un-saved from the template.
        if (recorded) {
          const key = (r) => `${r.before}→${r.after}`;
          const add = newlyPromotableEditRules();
          const stillPersisted = new Set(persistedEditRules().map(key));
          const remove = persistedBefore.filter((r) => !stillPersisted.has(key(r)));
          if (add.length > 0 || remove.length > 0) {
            // Fire-and-forget: persistence must never block closing the preview.
            void syncTemplateEdits({ add, remove });
          }
        }
      } catch {
        // Rule tracking must never block closing the preview.
      }
      if (typeof onDocumentEdited === "function") {
        const added = [
          resumeEdited && entry.pristineResumeLines ? addedEditText(entry.pristineResumeLines, entry.resultLines) : "",
          coverEdited && entry.pristineCoverLines ? addedEditText(entry.pristineCoverLines, entry.coverLetterResultLines) : "",
        ]
          .filter(Boolean)
          .join("\n");
        if (added.trim().length >= 12) {
          try {
            onDocumentEdited({ jobId, addedText: added });
          } catch {
            // Mining must never block closing the preview.
          }
        }
      }
    }
    setResumePreview((prev) => ({ ...prev, open: false }));
  }

  // The saved generation immediately OLDER than the one currently shown for
  // a scope (documentVersions is newest-first), or null when there isn't
  // one — first generation, no version history loaded, or signed out all
  // resolve here the same way (AC-6). The dialog independently derives the
  // same "is there a previous version" boolean from its own
  // documentVersions/currentVersionId props to show/hide the highlight
  // toggle, so this stays internal rather than exported.
  function previousVersionFor(scope) {
    const versions = documentVersions[scope] || [];
    const idx = versions.findIndex((v) => v.id === currentVersionId[scope]);
    return idx >= 0 && idx + 1 < versions.length ? versions[idx + 1] : null;
  }

  // Parse the active document into a render model for the preview dialog. Falls
  // back to a plain-text model when there is no .docx template to mirror.
  // AC-3: when the caller asks for highlighting (opts.highlight) and a
  // previous version exists for this scope, the model is annotated with
  // versionDiff.js's line-level change map before it's returned.
  async function loadPreviewModel(scope, opts = {}) {
    const entry = tailoringMap[resumePreview.jobId] || {};
    const blob = await buildPreviewBlob(entry, scope, { resumeFile, coverLetterFile });
    const model = blob
      ? await parseDocxToModel(await blob.arrayBuffer())
      : linesToModel(
          scope === "cover"
            ? entry.coverLetterResultLines || []
            : scope === "email"
              ? emailPreviewLines(entry)
              : entry.resultLines || String(entry.result || "").split("\n"),
        );
    if (!opts.highlight) return model;
    const previous = previousVersionFor(scope);
    if (!previous) return model;
    const previousLines =
      Array.isArray(previous.content_lines) && previous.content_lines.length > 0
        ? previous.content_lines
        : typeof previous.content === "string"
          ? previous.content.split("\n")
          : [];
    return markVersionChanges(model, previousLines, modelToLines(model, { includeEmpty: true }));
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
      // First edit of THIS scope after a (re)generation: snapshot its
      // pristine generated lines so edit-mining on close can diff what the
      // user added by hand. AC-4: gated on this scope's own edited flag, so
      // hand-editing the cover letter never disturbs (or is disturbed by) the
      // résumé's pristine snapshot, and vice versa.
      const alreadyEdited = editedForScope(entry, scope);
      const pristine = alreadyEdited
        ? {}
        : scope === "cover"
          ? { pristineCoverLines: Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [] }
          : { pristineResumeLines: Array.isArray(entry.resultLines) ? entry.resultLines : [] };
      const next =
        scope === "cover"
          ? {
              ...entry,
              ...pristine,
              coverLetterResultLines: lines,
              coverLetterPreviewHtml: html,
              edited: withEditedScope(entry, "cover", true),
            }
          : {
              ...entry,
              ...pristine,
              result: text,
              resultLines: lines,
              resumePreviewHtml: html,
              edited: withEditedScope(entry, "resume", true),
            };
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
    // Re-entrancy backstop, ref-based like resubmitDocumentPreview's guard
    // (AC-5) so it's immune to stale render-closure state — two clicks in the
    // same render cycle both see resumePreview.busy[scope] as false, so that
    // alone can't stop a double download. The "download:" prefix keeps this
    // independent from resubmit's use of the same ref set, so a download and
    // a revise on the same scope are tracked separately and never block
    // each other.
    const downloadKey = `download:${scope}`;
    if (inFlightScopesRef.current.has(downloadKey)) return;
    inFlightScopesRef.current.add(downloadKey);
    const text = typeof payload === "string" ? payload : payload?.text || "";
    const lines = text.split("\n");
    setScopeFlags(scope, { busy: true, error: "", notice: "" });
    try {
      const entry = tailoringMapRef.current[resumePreview.jobId] || {};
      const unchanged = text === scopeText(entry, scope);
      const serveFinished = !editedForScope(entry, scope) && unchanged;
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
        args.coverLetterTemplateDocxB64 = typeof entry.coverLetterDocxB64 === "string" ? entry.coverLetterDocxB64 : "";
        if (serveFinished && typeof entry.coverLetterDocxB64 === "string") args.coverLetterDocxB64 = entry.coverLetterDocxB64;
      } else {
        args.result = text;
        args.resultLines = lines;
        args.resumeFileName = entry.resumeFileName || "";
        args.templateDocxB64 = typeof entry.docxB64 === "string" ? entry.docxB64 : "";
        // MAJOR-1 fix: unconditional, NOT gated on serveFinished. docxB64 is
        // also the rebuild TEMPLATE an edited download falls onto, and a
        // version switch (D-1) clears it while pointing docxPath at THIS
        // version's own stored docx — so an edited download after a switch
        // needs that pointer too, not just the verbatim-serve path below.
        // docx.js resolves docxPath || templateDocxPath as the rebuild source.
        args.templateDocxPath = typeof entry.docxPath === "string" ? entry.docxPath : "";
        if (serveFinished && typeof entry.docxB64 === "string") args.docxB64 = entry.docxB64;
        // Restored chips have no in-session docx blob but do carry the saved
        // storage path — serve that faithful copy when the text is unedited.
        if (serveFinished && !entry.docxB64 && typeof entry.docxPath === "string" && entry.docxPath) {
          args.docxPath = entry.docxPath;
        }
      }
      const err = await downloadDocxFiles(args);
      setScopeFlags(scope, { busy: false, error: err || "" });
    } finally {
      inFlightScopesRef.current.delete(downloadKey);
    }
  }

  // Re-run the Gemini tailor for the previewed document using the free-text
  // steering instructions the user typed in the preview. Updates only the
  // active scope (resume or cover letter), drops any cached/edited preview HTML
  // so the fresh draft renders, and refreshes the open preview. Returns true on
  // success so the dialog can clear its input. Gemini-only by design — the
  // offline engines don't read steering instructions.
  async function resubmitDocumentPreview(scope, instructions, opts = {}) {
    const jobId = resumePreview.jobId;
    const text = String(instructions || "").trim();
    // A focus change re-tailors with a pinned library focus area instead of
    // steering text, and refreshes BOTH documents (they share the wrong focus).
    const focusChange = typeof opts.focusArea === "string";
    if (!jobId || (!text && !focusChange)) return false;
    const applyCover = scope === "cover" && !focusChange;
    // Which scope(s) this call touches: both on a focus change (it regenerates
    // both documents), otherwise just the one being revised. Drives the
    // re-entrancy guard and the busy/notice/error scoping below.
    const lockScopes = lockScopesFor(scope, focusChange);
    // AC-5 re-entrancy guard: reject a second in-flight call for the same
    // scope inside the hook itself (the disabled button alone is bypassable).
    if (lockScopes.some((s) => inFlightScopesRef.current.has(s))) return false;
    // AC-8: a cover-scoped revise grounds the letter in entry.resultLines (the
    // just-tailored résumé). If a résumé revise is already in flight, those
    // lines are seconds from changing, so refuse rather than ground the
    // letter in text that's about to go stale. The dialog also disables the
    // cover revise control while the résumé is busy (with an explanatory
    // tooltip) — this is the hook-level backstop for that same rule.
    if (applyCover && inFlightScopesRef.current.has("resume")) {
      setScopeFlags("cover", {
        error: "Wait for the résumé revision to finish before revising the cover letter.",
        notice: "",
      });
      return false;
    }
    if (!resumeFile) {
      setScopeFlags(lockScopes, { error: "Upload a resume first to revise it.", notice: "" });
      return false;
    }
    const entry = tailoringMapRef.current[jobId] || {};
    const posting = (resumePreview.posting || entry.jobDescription || "").trim();
    const url = (resumePreview.url || "").trim();
    if (!posting && !url) {
      setScopeFlags(lockScopes, { error: "Couldn't find the job posting to revise against.", notice: "" });
      return false;
    }
    fireDuplicateCheckSafely(onCheckDuplicate, { id: jobId, title: resumePreview.title, company: resumePreview.company, url, description: posting }, { jobId, entryPoint: "revise" }); // row 5: a job rehydrated from localStorage may never have been checked this session; fires before the paid call, title/company already known (like E1/E2).
    lockScopes.forEach((s) => inFlightScopesRef.current.add(s));
    setScopeFlags(lockScopes, { busy: true, notice: "", error: "" });
    try {
      const formData = new FormData();
      if (posting) formData.append("jobPosting", posting);
      else formData.append("jobPostingUrl", url);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
      // Revise with the engine the user selected — the embedded engine now
      // honors steering deterministically, so don't silently switch to Gemini.
      const engine = readEngine();
      formData.append("engine", engine);
      if (engine === "embedded") {
        const editRules = promotedEditRules();
        if (editRules.length > 0) formData.append("editRules", JSON.stringify(editRules));
      }
      if (text) formData.append("steeringInstructions", text);
      // Pinned focus area + buzzword toggles: the ones being applied now, or
      // the job's stored overrides so plain revises keep the user's choices.
      const focusOverride = focusChange ? opts.focusArea : entry.focusAreaOverride || "";
      if (engine === "embedded" && focusOverride) formData.append("focusArea", focusOverride);
      const kwEdits = focusChange ? opts.keywordEdits || null : entry.keywordEditsOverride || null;
      if (engine === "embedded" && kwEdits && (kwEdits.boost?.length || kwEdits.exclude?.length)) {
        formData.append("keywordEdits", JSON.stringify(kwEdits));
      }
      // Cover-letter framing (teaching/staff/industry): the one being applied
      // now, or the job's stored override; "" means auto-detect.
      const variantOverride =
        focusChange && typeof opts.coverVariant === "string" ? opts.coverVariant : entry.coverVariantOverride || "";
      if (engine === "embedded" && variantOverride) formData.append("coverVariant", variantOverride);
      // Persona (saved profile-reframing identity): the one being applied now,
      // or the job's stored override; "" means base profile.
      const personaOverride =
        focusChange && typeof opts.persona === "string" ? opts.persona : entry.personaOverride || "";
      if (engine === "embedded" && personaOverride) formData.append("persona", personaOverride);
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));
      contextFiles.forEach((file) => formData.append("contextFiles", file));
      formData.append("resume", resumeFile);
      // Cover-only revise: send the résumé already tailored (and possibly
      // hand-edited) for this job as the letter's content source, instead of
      // letting the route ground it in a fresh, edit-unaware resume re-run.
      if (applyCover && Array.isArray(entry.resultLines) && entry.resultLines.length > 0) {
        formData.append("tailoredResumeLines", JSON.stringify(entry.resultLines));
      }
      // Regenerate the cover letter when it's the document being revised, or on
      // a focus change (both documents carry the focus).
      const regenCover = (applyCover || focusChange) && coverLetterFile;
      if (regenCover) {
        const coverLetterTemplateLines = await buildTemplateLinesForUpload(coverLetterFile);
        formData.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
        formData.append("coverLetter", coverLetterFile);
      }

      const response = await fetch("/api/tailor", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to revise the document.");

      // Captured below so the persistence step after both blocks (AC-3) saves
      // exactly the document(s) this request actually regenerated, without
      // re-deriving them from payload a second time.
      let persistResume = null;
      let persistCover = null;

      if (applyCover || regenCover) {
        const lines = Array.isArray(payload.coverLetterResultLines) ? payload.coverLetterResultLines : [];
        const coverErr = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
        // Cover failures are fatal for a cover-scoped revise, soft on a focus
        // change (the resume result below still applies).
        if (coverErr && applyCover) throw new Error(coverErr);
        if (lines.length === 0 && applyCover) throw new Error("The engine returned an empty cover letter.");
        if (!coverErr && lines.length > 0) {
          updateTailoringJob(jobId, (entry) => ({
            ...entry,
            coverLetterResultLines: lines,
            coverLetterDocxB64: typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "",
            coverLetterPreviewHtml: undefined,
            // AC-3: clears only the cover letter's edited flag. On a focus
            // change the résumé block below clears its own flag separately,
            // so both end up cleared without either write clobbering the
            // other's scope.
            edited: withEditedScope(entry, "cover", false),
            status: "done",
          }));
          persistCover = {
            content:
              typeof payload.coverLetterResult === "string" && payload.coverLetterResult
                ? payload.coverLetterResult
                : lines.join("\n"),
            contentLines: lines,
          };
        }
      }
      if (!applyCover) {
        const result = payload.result?.trim() || "";
        const lines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
        if (!result) throw new Error("The engine returned an empty resume.");
        const nextTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
        updateTailoringJob(jobId, (entry) => ({
          ...entry,
          result,
          resultLines: lines,
          docxB64: typeof payload.docxB64 === "string" ? payload.docxB64 : "",
          resumePreviewHtml: undefined,
          ...(nextTitle ? { generatedJobTitle: nextTitle } : {}),
          // AC-3: clears only the résumé's edited flag — a hand-edited cover
          // letter must survive a résumé revise, version select, or the
          // résumé side of a focus change.
          edited: withEditedScope(entry, "resume", false),
          status: "done",
        }));
        persistResume = {
          content: result,
          contentLines: lines,
          docxB64: typeof payload.docxB64 === "string" ? payload.docxB64 : "",
        };
      }

      // AC-3: persist whichever document(s) this revise/focus-change just
      // regenerated — the resume, the cover letter, or both — so the trail
      // survives a reload the same way a fresh Generate run's output does.
      // Best-effort: persistGeneratedDocuments never throws on its own, and
      // this is wrapped anyway so a persistence failure can never break the
      // revise flow or the preview (AC-6).
      if (currentUser?.id && (persistResume || persistCover)) {
        try {
          const supabase = createClient();
          // Look up the existing position by external id rather than
          // upserting one. A revise must not touch positions at all; it only
          // needs the id to link the newly persisted documents, and all it
          // holds here is preview-derived title/company/url including an
          // AI-generated title. upsertPosition no longer NULLs a row's other
          // columns (it merges — lib/supabase/positionMerge.js), but this is
          // still wrong: identity fields are fill-once, so a guess written
          // into an empty row would become permanent.
          const { data: posRow } = await supabase
            .from("positions")
            .select("id")
            .eq("external_id", String(jobId))
            .maybeSingle();
          const positionId = posRow?.id || null;
          await persistGeneratedDocuments(supabase, {
            userId: currentUser.id,
            positionId,
            resume: persistResume,
            coverLetter: persistCover,
            sourceResumePath: `${currentUser.id}/resume`,
            additionalContext: additionalContext || null,
          });

          // Keep the version control's count/selection accurate immediately
          // after this call adds a new row to whichever scope(s) it just
          // regenerated (AC-3) — otherwise it would keep showing the
          // pre-revise history until the preview was closed and reopened.
          const touchedVersionScopes = [
            ...(persistResume ? ["resume"] : []),
            ...(persistCover ? ["cover"] : []),
          ];
          if (positionId && touchedVersionScopes.length > 0) {
            await refreshDocumentVersions(jobId, touchedVersionScopes, versionsRequestIdRef.current, positionId);
          }
        } catch {
          // Never let a persistence failure break the revise flow.
        }
      }

      // Remember which focus, keywords, letter framing, and persona drove this generation
      // (and the pinned overrides on a focus change) so the previewer's
      // controls stay truthful.
      //
      // AC-7: payload.report always reflects the résumé side of THIS request
      // (the server retailors the résumé even on a cover-only revise), and
      // payload.coverVariant is always present (possibly null) whether or not
      // the cover was touched. Writing every key unconditionally would let a
      // cover-only revise finishing later revert focus/keywords a concurrent
      // résumé revise just wrote, or let a résumé-only revise silently null
      // out the cover's coverVariantInfo — so only include a scope's metadata
      // keys when this call actually touched that scope.
      const touchedResume = !applyCover;
      const touchedCover = applyCover || regenCover;
      updateTailoringJob(jobId, {
        ...(touchedResume
          ? {
              focusInfo: payload.report?.meta?.focus || null,
              keywordsInfo: payload.report?.keywords || null,
              ...(payload.report?.meta?.persona !== undefined
                ? { personaInfo: payload.report?.meta?.persona || null }
                : {}),
            }
          : {}),
        ...(touchedCover && payload.coverVariant !== undefined
          ? { coverVariantInfo: payload.coverVariant || null }
          : {}),
        // The hiring email is grounded in THIS request's tailored résumé, so
        // propagate it here too — otherwise the email tab keeps showing a
        // draft grounded in the pre-revise résumé after a revise/focus
        // change. Guarded like coverVariant above: the external engine has
        // no tailorHiringEmail and resolves to an empty array, so an empty
        // response must never wipe a previously generated email.
        ...(Array.isArray(payload.emailResultLines) && payload.emailResultLines.length > 0
          ? {
              emailSubject: typeof payload.emailSubject === "string" ? payload.emailSubject : "",
              emailResultLines: payload.emailResultLines,
            }
          : {}),
        ...(focusChange
          ? {
              focusAreaOverride: opts.focusArea,
              keywordEditsOverride: kwEdits,
              ...(typeof opts.coverVariant === "string" ? { coverVariantOverride: opts.coverVariant } : {}),
              ...(typeof opts.persona === "string" ? { personaOverride: opts.persona } : {}),
            }
          : {}),
      });

      setPreviewReloadKey((k) => k + 1);

      // Count the applied embedded steering directives locally; when the same
      // term is steered revision after revision, hint that it belongs in the
      // library instead (the counters never modify the library themselves).
      let habitHint = "";
      const steeringMeta = payload.report?.meta?.steering;
      if (steeringMeta) {
        recordSteering(steeringMeta);
        habitHint = steeringHabitHint(steeringMeta);
      }

      // Learning signals for the focus/buzzword workflow (device-local, like
      // the other counters): count the focus correction and the newly-applied
      // buzzword toggles, and surface fix-it-in-/library hints when the same
      // correction keeps recurring across postings.
      const workflowHints = [];
      if (focusChange) {
        try {
          // Read the freshest known entry (not the one captured before the
          // await) so this "previous value" comparison reflects anything a
          // concurrent operation on this job already wrote (AC-7).
          const latestEntry = tailoringMapRef.current[jobId] || {};
          const prevFocus = latestEntry.focusInfo || null;
          if (opts.focusArea && prevFocus?.source !== "override") {
            const count = recordFocusOverride({ detected: prevFocus?.name || "", chosen: opts.focusArea });
            if (count >= 3) workflowHints.push(focusOverrideHint(prevFocus?.name || ""));
          }
          if (typeof opts.coverVariant === "string" && opts.coverVariant) {
            const prevVariant = latestEntry.coverVariantInfo || null;
            if (prevVariant?.source !== "override" && prevVariant?.detected !== opts.coverVariant) {
              const count = recordVariantOverride({
                detected: prevVariant?.detected || "",
                chosen: opts.coverVariant,
              });
              if (count >= 3) workflowHints.push(variantOverrideHint(prevVariant?.detected || ""));
            }
          }
          if (kwEdits && (kwEdits.boost?.length || kwEdits.exclude?.length)) {
            const seenKey = (t, dir) => `${jobId}:${dir}:${String(t).toLowerCase()}`;
            const fresh = {
              boost: (kwEdits.boost || []).filter((t) => !buzzwordSeenRef.current.has(seenKey(t, "boost"))),
              exclude: (kwEdits.exclude || []).filter((t) => !buzzwordSeenRef.current.has(seenKey(t, "exclude"))),
            };
            for (const t of fresh.boost) buzzwordSeenRef.current.add(seenKey(t, "boost"));
            for (const t of fresh.exclude) buzzwordSeenRef.current.add(seenKey(t, "exclude"));
            recordBuzzwordEdits(fresh);
            workflowHints.push(...buzzwordEditHints(kwEdits));
          }
        } catch {
          // Signal tracking must never break the regenerate flow.
        }
      }
      const hintTail = workflowHints.filter(Boolean).join(" ");

      const engineWarnings = (Array.isArray(payload.warnings) ? payload.warnings : []).filter(Boolean).join(" "); // DEFECT 2: every warning, not just "focus area", and not only on a focus change.
      const notice = focusChange
        ? `Regenerated with the ${opts.focusArea ? `“${opts.focusArea}”` : "auto-detected"} focus.${engineWarnings ? ` ${engineWarnings}` : ""}${hintTail ? ` ${hintTail}` : ""}`
        : `Revised the ${applyCover ? "cover letter" : "resume"} with your instructions.${habitHint ? ` ${habitHint}` : ""}${engineWarnings ? ` ${engineWarnings}` : ""}`;
      setScopeFlags(lockScopes, { busy: false, error: "", notice });
      return true;
    } catch (err) {
      setScopeFlags(lockScopes, { busy: false, error: err?.message || "Couldn't revise the document.", notice: "" });
      return false;
    } finally {
      lockScopes.forEach((s) => inFlightScopesRef.current.delete(s));
    }
  }

  // The previewer's focus picker: pin a library focus area (or "" for
  // auto-detect), per-posting buzzword toggles, the letter framing
  // (teaching/staff/industry, "" = auto), and persona (saved identity, "" = base profile),
  // then regenerate both documents.
  function applyFocusArea(name, keywordEdits = null, coverVariant = "", persona = "") {
    return resubmitDocumentPreview("resume", "", {
      focusArea: String(name ?? ""),
      keywordEdits,
      coverVariant: String(coverVariant ?? ""),
      persona: String(persona ?? ""),
    });
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
      busy: { ...EMPTY_SCOPE_FLAGS },
      notice: { ...EMPTY_SCOPE_TEXT },
      error: { ...EMPTY_SCOPE_TEXT },
    });
    loadVersionsForJob(jobId);
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
    applyFocusArea,
    finishByOpeningPreview,
    documentVersions,
    currentVersionId,
    selectDocumentVersion,
  };
}
