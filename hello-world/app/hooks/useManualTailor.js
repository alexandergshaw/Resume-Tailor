"use client";

import { useState } from "react";
import { buildTemplateLinesForUpload } from "../../lib/document/docx";
import { promotedEditRules } from "../../lib/tailor/localSignals";
import { createClient } from "../../lib/supabase/client";
import { upsertPosition } from "../../lib/supabase/upsertPosition";
import { upsertApplication } from "../../lib/supabase/upsertApplication";
import { persistGeneratedDocuments } from "../../lib/supabase/persistGeneration";

// The manual (job-description) tailoring pipeline -- moved verbatim out of
// app/page.js's `handleManualSubmit` so it can be called both directly (a
// StatusBar chip's "Regenerate", and the reviewed-fields flow) AND, with
// `opts.queued: true`, once per posting by the multi-posting queue in
// app/hooks/useManualPostings.js.
//
// Behaviour changes from the original handleManualSubmit (everything else --
// the FormData fields, the Supabase persistence calls, their order -- is
// unchanged):
//   1. it now RETURNS { ok, error?, jobId?, jobTitle?, company?, warning? }
//      from every exit point (both guards, the success path, the catch)
//      instead of returning nothing -- though only the success path
//      actually carries jobId/jobTitle/company; the two guards and the
//      catch return just { ok: false, error }, since there is nothing else
//      to report before (or when) the request itself fails;
//   2. `opts.openPreview` (default true) gates the auto-open of the finished
//      preview;
//   3. `opts.queued` (default false) suppresses every write to the tab-wide
//      submitting/error state below -- otherwise the first of several
//      concurrent postings to settle would re-enable the Generate button
//      and its error would overwrite every other posting's;
//   4. a cover-letter failure is returned as `warning` on an otherwise
//      successful result, rather than written to the tab-wide error -- the
//      résumé still generated fine, so the posting is not a failure;
//   5. the default synthetic id gets a random suffix
//      (`manual-${Date.now()}-${random}`, matching
//      app/hooks/useScreenshots.js:40) so a caller that doesn't supply its
//      own `syntheticJobId` can't collide the way `manual-${Date.now()}`
//      alone could.
export function useManualTailor({
  resumeFile,
  coverLetterFile,
  contextFiles,
  additionalContext,
  aggressiveness,
  tailorEngine,
  currentUser,
  setTrackedJobs,
  updateTailoringJob,
  maybeOfferLibraryUpdate,
  withClearedEditedScopes,
  finishByOpeningPreview,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function tailorPosting(event, opts = {}) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    const scope = opts.scope || "both";
    const applyResume = scope !== "cover";
    const applyCover = scope !== "resume";
    const sourcePosting = String(opts.overridePosting ?? "");

    if (!sourcePosting.trim()) {
      const message = "Please provide a job posting.";
      // A5: gated on `queued` like every other write to the tab-wide state
      // below -- otherwise every posting in a queued run that trips this
      // guard (blank text slipping through, in practice unreachable since
      // submittableEntries already filters it, but the pipeline's own guard
      // must not assume its caller got that right) stomps the one shared
      // banner on top of its own card's message.
      if (!opts.queued) setError(message);
      return { ok: false, error: message };
    }

    if (!resumeFile) {
      const message = "Please upload a resume file.";
      // Reachable from "Retry failed" if the résumé is cleared between runs
      // (A5) -- same reasoning as the guard above.
      if (!opts.queued) setError(message);
      return { ok: false, error: message };
    }

    if (!opts.queued) {
      setError("");
      setSubmitting(true);
    }

    const syntheticJobId =
      opts.syntheticJobId ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setTrackedJobs((prev) =>
      prev.some((j) => j.id === syntheticJobId)
        ? prev
        : [
            ...prev,
            { id: syntheticJobId, title: "Generating from posting…", company: "", url: "", description: sourcePosting },
          ],
    );
    updateTailoringJob(syntheticJobId, { status: "tailoring" });

    try {
      const formData = new FormData();
      formData.append("jobPosting", sourcePosting);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
      formData.append("engine", tailorEngine);
      // Promoted recurring hand-edits (localStorage) — the embedded engine
      // applies them document-wide so consistent fixes are pre-made.
      if (tailorEngine === "embedded") {
        const editRules = promotedEditRules();
        if (editRules.length > 0) formData.append("editRules", JSON.stringify(editRules));
      }
      if (opts.values && typeof opts.values === "object") {
        formData.append("values", JSON.stringify(opts.values));
      }
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));
      contextFiles.forEach((file) => formData.append("contextFiles", file));
      formData.append("resume", resumeFile);

      if (coverLetterFile) {
        const coverLetterTemplateLines = await buildTemplateLinesForUpload(coverLetterFile);
        formData.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
        formData.append("coverLetter", coverLetterFile);
      }

      const response = await fetch("/api/tailor", { method: "POST", body: formData });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || "Failed to generate a response.");
      maybeOfferLibraryUpdate(payload, syntheticJobId);

      const nextResult = payload.result?.trim() || "No output returned from Gemini.";
      const nextResultLines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
      const nextJobTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
      const nextCompany = typeof payload.company === "string" ? payload.company.trim() : "";
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines) ? payload.coverLetterResultLines : [];
      const nextCoverLetterResult =
        typeof payload.coverLetterResult === "string" && payload.coverLetterResult
          ? payload.coverLetterResult
          : nextCoverLetterResultLines.join("\n");
      const nextCoverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
      const nextEngine = typeof payload.engine === "string" ? payload.engine : "";
      const nextDocxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const nextCoverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";
      // Hiring-team email (session state only — see AC-8 note in route.js).
      const nextEmailSubject = typeof payload.emailSubject === "string" ? payload.emailSubject : "";
      const nextEmailResultLines = Array.isArray(payload.emailResultLines) ? payload.emailResultLines : [];

      // Change 4: the résumé generated fine even when the cover letter
      // failed, so this is never a tab-wide error — it's returned as a
      // warning for the caller to show wherever this posting's own outcome
      // is shown (its own card in the queue, for the multi-posting case).
      const warning = nextCoverLetterError || "";

      // A3: the queue reads `warning` off the return value and shows it on
      // the posting's own card -- but handleRegenerateSyntheticJob and
      // generateWithReviewedValues (app/page.js) both call tailorPosting
      // directly and discard whatever it returns, exactly like they discard
      // everything else here for a non-queued run. Without this, the résumé
      // regenerates, the chip reads "done", the preview auto-opens, and
      // nobody is ever told the cover letter failed. `setError("")` when
      // there's no warning is deliberate too: it's what actually clears a
      // stale cover-letter error left over from a previous run.
      if (!opts.queued) setError(nextCoverLetterError);

      // Update the synthesized tracked job's title/company now that we have them.
      const syntheticJob = {
        id: syntheticJobId,
        title: nextJobTitle || "Untitled role",
        company: nextCompany,
        url: "",
        description: sourcePosting,
      };
      setTrackedJobs((prev) =>
        prev.map((j) =>
          j.id === syntheticJobId
            ? { ...j, title: syntheticJob.title, company: syntheticJob.company || j.company }
            : j,
        ),
      );
      updateTailoringJob(syntheticJobId, (entry) => ({
        ...entry,
        status: "done",
        generatedJobTitle: nextJobTitle,
        engine: nextEngine,
        // AC-3: clear only the scope(s) this run actually regenerated.
        edited: withClearedEditedScopes(entry, [
          ...(applyResume ? ["resume"] : []),
          ...(applyCover ? ["cover"] : []),
        ]),
        emailSubject: nextEmailSubject,
        emailResultLines: nextEmailResultLines,
        ...(applyResume ? { result: nextResult, resultLines: nextResultLines, docxB64: nextDocxB64 } : {}),
        ...(applyCover ? { coverLetterResultLines: nextCoverLetterResultLines, coverLetterDocxB64: nextCoverLetterDocxB64 } : {}),
      }));

      // Persist the generated resume + cover letter and link them to an application.
      if (currentUser) {
        const supabase = createClient();
        const positionId = await upsertPosition(supabase, syntheticJob);
        if (positionId) {
          await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "applied" });
        }
        await persistGeneratedDocuments(supabase, {
          userId: currentUser.id,
          positionId,
          resume: applyResume ? { content: nextResult, contentLines: nextResultLines, docxB64: nextDocxB64 } : null,
          coverLetter:
            applyCover && nextCoverLetterResultLines.length > 0
              ? { content: nextCoverLetterResult, contentLines: nextCoverLetterResultLines }
              : null,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
      }

      // Change 2: only auto-open when the caller wants it (default true) —
      // a queued, multi-posting run passes false so N results don't fight.
      if (opts.openPreview !== false) {
        finishByOpeningPreview({
          jobId: syntheticJobId,
          jobTitle: nextJobTitle,
          company: nextCompany,
          posting: sourcePosting || "",
          applyResume,
          applyCover,
          coverLetterResultLines: nextCoverLetterResultLines,
        });
      }

      return { ok: true, jobId: syntheticJobId, jobTitle: nextJobTitle, company: nextCompany, warning };
    } catch (err) {
      const message = err.message || "Unexpected error.";
      if (!opts.queued) setError(message);
      updateTailoringJob(syntheticJobId, { status: "error" });
      return { ok: false, error: message };
    } finally {
      if (!opts.queued) setSubmitting(false);
    }
  }

  return { tailorPosting, submitting, error, setError };
}
