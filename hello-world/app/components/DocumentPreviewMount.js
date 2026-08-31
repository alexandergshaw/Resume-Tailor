"use client";

import { useState } from "react";
import DocumentPreviewDialog from "./DocumentPreviewDialog";
import FocusPickerDialog from "./FocusPickerDialog";
import { getDownloadFileNameForTitle, getDownloadCoverLetterFileNameForTitle } from "../../lib/document/docx";
import { emailPreviewText } from "../../lib/tailor/documentScopes";

// Extracted verbatim from app/page.js:3172-3270 (Wave 5C, mechanical move --
// no logic changed). `focusPickerOpen` moved from page-level state into this
// component because it was already local to this JSX subtree (nothing else
// in page.js ever read it): this component stays mounted for the app's whole
// lifetime, only the dialog's `open` prop toggles, so the state's lifetime is
// unchanged. `getDownloadFileNameForTitle`, `getDownloadCoverLetterFileNameForTitle`,
// and `emailPreviewText` are imported directly rather than threaded as props,
// matching how StatusBar.js and TrackingTab.js already pull the same
// pure/stateless helpers from lib/document/docx.
//
// `useDriveDocuments` mounts here in the NEXT wave (6A), not in this one --
// deliberately kept out so this extraction stays pure and page.js does not
// pick up any Drive wiring.
export default function DocumentPreviewMount({
  preview,
  tailoringMap,
  research,
  chat,
  tailorEngine,
  previewReloadKey,
  scrapePreviewPosting,
  // Forwarded so Wave 6A can mount useDriveDocuments here without reopening
  // page.js -- not consumed by this component yet (see the header comment).
  currentUser,
  resumeFile,
  coverLetterFile,
}) {
  // The previewer's "wrong focus" flag: opens a picker of the library's focus
  // areas; applying one re-tailors the previewed job with that focus pinned.
  const [focusPickerOpen, setFocusPickerOpen] = useState(false);

  return (
    <DocumentPreviewDialog
      open={preview.resumePreview.open}
      jobTitle={preview.resumePreview.title}
      company={preview.resumePreview.company}
      initialTab={preview.resumePreview.tab}
      scopes={{
        resume: {
          available: preview.previewScopeAvailable(tailoringMap[preview.resumePreview.jobId], "resume"),
          text: tailoringMap[preview.resumePreview.jobId]?.result || "",
          html: tailoringMap[preview.resumePreview.jobId]?.resumePreviewHtml,
          fileName:
            tailoringMap[preview.resumePreview.jobId]?.resumeFileName ||
            getDownloadFileNameForTitle(preview.resumePreview.title, preview.resumePreview.company).replace(/\.docx$/i, ""),
        },
        cover: {
          available: preview.previewScopeAvailable(tailoringMap[preview.resumePreview.jobId], "cover"),
          text: (tailoringMap[preview.resumePreview.jobId]?.coverLetterResultLines || []).join("\n"),
          html: tailoringMap[preview.resumePreview.jobId]?.coverLetterPreviewHtml,
          fileName:
            tailoringMap[preview.resumePreview.jobId]?.coverLetterFileName ||
            getDownloadCoverLetterFileNameForTitle(preview.resumePreview.title, preview.resumePreview.company).replace(/\.docx$/i, ""),
        },
        // AC-1/AC-3: plain text only — no fileName/html, it's never downloaded
        // as a docx or hand-edited (see DocumentPreviewDialog's DOCX_SCOPES gating).
        email: {
          available: preview.previewScopeAvailable(tailoringMap[preview.resumePreview.jobId], "email"),
          text: emailPreviewText(tailoringMap[preview.resumePreview.jobId]),
        },
      }}
      engine={tailorEngine}
      loadModel={preview.loadPreviewModel}
      reloadKey={previewReloadKey}
      onClose={preview.closeResumePreview}
      onSave={preview.saveDocumentPreview}
      onRenameFile={preview.renameDocument}
      onResubmit={preview.resubmitDocumentPreview}
      onDownload={preview.downloadDocumentPreview}
      onAskAi={(scope, payload) =>
        chat.askAiAbout({
          label: `${preview.resumePreview.company || "Job"}${preview.resumePreview.title ? ` · ${preview.resumePreview.title}` : ""} — ${scope === "cover" ? "Cover letter" : "Resume"}`,
          content: payload?.text || "",
          sourceJobId: preview.resumePreview.jobId,
        })
      }
      onScrapePosting={
        preview.resumePreview.posting || preview.resumePreview.url ? scrapePreviewPosting : null
      }
      focus={tailoringMap[preview.resumePreview.jobId]?.focusInfo || null}
      coverVariant={tailoringMap[preview.resumePreview.jobId]?.coverVariantInfo || null}
      persona={tailoringMap[preview.resumePreview.jobId]?.personaInfo || null}
      keywordEditsCount={
        (tailoringMap[preview.resumePreview.jobId]?.keywordEditsOverride?.boost?.length || 0) +
        (tailoringMap[preview.resumePreview.jobId]?.keywordEditsOverride?.exclude?.length || 0)
      }
      onOpenFocusPicker={() => setFocusPickerOpen((v) => !v)}
      focusControls={
        <FocusPickerDialog
          embedded
          key={focusPickerOpen ? `focus-${preview.resumePreview.jobId}` : "focus-idle"}
          open={focusPickerOpen}
          currentFocus={tailoringMap[preview.resumePreview.jobId]?.focusInfo || null}
          override={tailoringMap[preview.resumePreview.jobId]?.focusAreaOverride || ""}
          keywords={tailoringMap[preview.resumePreview.jobId]?.keywordsInfo || null}
          keywordEdits={tailoringMap[preview.resumePreview.jobId]?.keywordEditsOverride || null}
          coverVariant={tailoringMap[preview.resumePreview.jobId]?.coverVariantInfo || null}
          coverVariantOverride={tailoringMap[preview.resumePreview.jobId]?.coverVariantOverride || ""}
          persona={tailoringMap[preview.resumePreview.jobId]?.personaInfo || null}
          personaOverride={tailoringMap[preview.resumePreview.jobId]?.personaOverride || ""}
          postingTitle={preview.resumePreview.title}
          onClose={() => setFocusPickerOpen(false)}
          onApply={preview.applyFocusArea}
        />
      }
      onSetFraming={(variant) =>
        preview.applyFocusArea(
          tailoringMap[preview.resumePreview.jobId]?.focusAreaOverride || "",
          tailoringMap[preview.resumePreview.jobId]?.keywordEditsOverride || null,
          variant,
          tailoringMap[preview.resumePreview.jobId]?.personaOverride || "",
        )
      }
      onResearchCompany={() =>
        research.openCompanyResearch({
          id: preview.resumePreview.jobId,
          title: preview.resumePreview.title,
          company: preview.resumePreview.company,
          description: tailoringMap[preview.resumePreview.jobId]?.jobDescription || "",
        })
      }
      researchLoading={!!research.researchByJob[preview.resumePreview.jobId]?.loading}
      researchCount={(research.researchByJob[preview.resumePreview.jobId]?.articles || []).length}
      companyReferences={research.companyResearchByJob[preview.resumePreview.jobId] || []}
      busy={preview.resumePreview.busy}
      notice={preview.resumePreview.notice}
      error={preview.resumePreview.error}
      documentVersions={preview.documentVersions}
      currentVersionId={preview.currentVersionId}
      onSelectVersion={preview.selectDocumentVersion}
    />
  );
}
