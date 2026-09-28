"use client";

import { useEffect, useRef, useState } from "react";
import DocumentPreviewDialog from "./DocumentPreviewDialog";
import FocusPickerDialog from "./FocusPickerDialog";
import InsertedFactsStrip from "./preview/InsertedFactsStrip";
import AutoInsertFactsMessage from "./preview/AutoInsertFactsMessage";
import { getDownloadFileNameForTitle, getDownloadCoverLetterFileNameForTitle } from "../../lib/document/docx";
import { emailPreviewText } from "../../lib/tailor/documentScopes";
import { useDriveDocuments } from "../hooks/useDriveDocuments";
import { recordDecision } from "@/lib/activityLog/appActivityLog.js";

// The id this component is registered under on activityChannels.js's
// DECISION_LEDGER, and decisionCoverage.sweep.test.js's own derived scan --
// changing this string without changing both would fail that sweep in both
// directions (a listed id that never records, and a record under an id the
// ledger does not recognize). Same idiom as useDuplicateApplyCheck.js's
// DUPE_DECISION_ID.
const AUTO_INSERT_DECISION_ID = "fact-auto-insert";

// Maps one `autoInsertFactsForJob` result onto the closed DECISION_OUTCOMES
// vocabulary. `already-edited` is the one deliberate policy refusal (the
// RULING in useCompanyResearch.js: a hand-edited letter is never
// overwritten), so it reports as "refused" rather than "failed". The three
// "nothing to do" gates (no open surface, nothing eligible, nothing new) are
// normal, unremarkable outcomes, so they report as "skipped". Every other
// refusal code means something that should have worked did not, so it
// reports as "failed" -- including an unrecognized code, since an outcome
// this function cannot explain is closer to a failure than a shrug.
function autoInsertDecisionOutcome(result) {
  if (result.ok) return "acted";
  const code = result.code;
  if (code === "already-edited") return "refused";
  if (code === "no-open-surface" || code === "nothing-eligible" || code === "nothing-new") return "skipped";
  return "failed";
}

// N77: turns one `autoInsertFactsForJob` result into a decision record on the
// app-wide seam (activityChannels.js's DECISION_LEDGER, "fact-auto-insert"
// entry). recordDecision() itself enforces the closed field vocabulary --
// only `reason`, `count` and `code` ever survive onto the record -- so this
// door cannot carry the inserted sentence, the company, the article title or
// a byte of the letter body, whatever fields `result` happens to hold.
function recordAutoInsertOutcome(result) {
  if (!result) return;
  const outcome = autoInsertDecisionOutcome(result);
  const fields = result.ok
    ? { count: typeof result.count === "number" ? result.count : 0 }
    : { reason: result.reason || "", code: result.code || "unknown-refusal" };
  recordDecision(AUTO_INSERT_DECISION_ID, outcome, fields);
}

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
// Wave 6A: `useDriveDocuments` mounts HERE, not in page.js and not in
// DocumentPreviewDialog.js -- exactly per plan, since this component already
// closes over `tailoringMap`/`currentUser`/`resumeFile`/`coverLetterFile`
// (the three latter forwarded by Wave 5C for precisely this). The hook's
// return value is handed down as one `drive` prop; the dialog wraps its
// `saveToDrive` with its own `commitDraft()`/`commitFileName()` (ARCH.md
// §4.3) because only the dialog has access to that in-flight draft state.
export default function DocumentPreviewMount({
  preview,
  tailoringMap,
  research,
  chat,
  tailorEngine,
  previewReloadKey,
  scrapePreviewPosting,
  // Forwarded by Wave 5C so Wave 6A could mount useDriveDocuments here
  // without reopening page.js (see the header comment) -- now consumed
  // below, feeding the hook.
  currentUser,
  resumeFile,
  coverLetterFile,
}) {
  // The previewer's "wrong focus" flag: opens a picker of the library's focus
  // areas; applying one re-tailors the previewed job with that focus pinned.
  const [focusPickerOpen, setFocusPickerOpen] = useState(false);

  // The dialog's active tab is local state DocumentPreviewDialog has never
  // reported upward. `preview.resumePreview.tab` (passed below as
  // `initialTab`) is only the tab the dialog OPENED on -- the dialog can
  // resolve a DIFFERENT starting tab when that one isn't available, and the
  // user can switch tabs freely afterward with nothing telling this
  // component. `useDriveDocuments` needs the LIVE active scope only to gate
  // the hiring-email caption (`hiringEmail`), so the dialog reports every
  // tab change back through `onActiveScopeChange`, and this is reset to the
  // nominal starting tab whenever a different posting's preview opens.
  const [activeScope, setActiveScope] = useState(preview.resumePreview.tab);
  useEffect(() => {
    // The same `await Promise.resolve()` microtask hop useDriveDocuments.js's
    // own effects use (see that file's header comment) -- keeps this clear
    // of react-hooks/set-state-in-effect (which rejects a setState reachable
    // SYNCHRONOUSLY from an effect's own call stack) without changing the
    // observable timing.
    let cancelled = false;
    const nextTab = preview.resumePreview.tab;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setActiveScope(nextTab);
    })();
    return () => {
      cancelled = true;
    };
  }, [preview.resumePreview.jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const drive = useDriveDocuments({
    currentUser,
    tailoringMap,
    resumeFile,
    coverLetterFile,
    jobId: preview.resumePreview.jobId,
    jobTitle: preview.resumePreview.title,
    company: preview.resumePreview.company,
    activeScope,
  });

  // N73: the coordinating effect (backlog N61's missing last hop).
  // `research.autoInsertFactsForJob` already does the whole insert -- locate,
  // splice, highlight, store -- but on HEAD nothing called it; research
  // resolved and the facts just sat in `researchByJob`, never reaching the
  // letter. This fires it once per job, whenever the preview is OPEN, a job
  // is loaded, and that job's research has resolved with at least one
  // article -- the owner's "review after the fact": the candidate does
  // nothing but open the preview and let research resolve, and the facts
  // arrive on their own, already highlighted and one-click removable.
  //
  // `openRef` is a LIVE getter, not a captured boolean:
  // `autoInsertFactsForJob` awaits a docx splice and a network PUT and
  // re-checks `isOpen()` after each -- a snapshot boolean closed over at call
  // time would never see a candidate who closes the modal mid-flight.
  // `researchRef` holds the latest `research` prop the same way, so the
  // effect always calls today's function without needing the `research`
  // object itself (a fresh identity every render) in its own dependency
  // array -- refs read via `.current` are exempt from exhaustive-deps.
  // `autoInsertAttemptedRef` dedupes PER JOB, not globally: a re-render or a
  // tab switch must not re-fire this for the same job, but switching to a
  // different job -- or back -- must still insert that job's own facts.
  const previewOpen = preview.resumePreview.open;
  const openRef = useRef(previewOpen);
  useEffect(() => {
    openRef.current = previewOpen;
  }, [previewOpen]);
  const researchRef = useRef(research);
  useEffect(() => {
    researchRef.current = research;
  }, [research]);
  const autoInsertAttemptedRef = useRef(new Set());
  const autoInsertJobId = preview.resumePreview.jobId;
  const autoInsertResearchEntry = research.researchByJob[autoInsertJobId];
  const autoInsertResearchResolved =
    !!autoInsertResearchEntry &&
    !autoInsertResearchEntry.loading &&
    Array.isArray(autoInsertResearchEntry.articles) &&
    autoInsertResearchEntry.articles.length > 0;

  // N77: the readable half of the fix. `autoInsertMessage` is `{ severity,
  // text }` or null -- `severity` is either "failure" (role=alert) or "info"
  // (role=status); a "silent" result (see useCompanyResearch.js's ruling on
  // an already-edited letter) is recorded below but never lands here. A LIVE
  // ref, not the plain `autoInsertJobId` variable, guards the async
  // completion below: a slow refusal for a job the candidate has since
  // switched away from must not paint its message over the job now on
  // screen (mirrors `openRef`/`researchRef` above for the same reason).
  const [autoInsertMessage, setAutoInsertMessage] = useState(null);
  const autoInsertJobIdRef = useRef(autoInsertJobId);
  useEffect(() => {
    autoInsertJobIdRef.current = autoInsertJobId;
    // A message belongs to the job it was raised for; switching to a
    // different job's preview (including one with no message of its own
    // yet) must never leave the PRIOR job's refusal on screen. The same
    // `await Promise.resolve()` microtask hop as the `activeScope` effect
    // above (see its own comment) -- keeps this clear of
    // react-hooks/set-state-in-effect without changing the observable
    // timing: still cleared before any paint the candidate could see.
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setAutoInsertMessage(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [autoInsertJobId]);

  useEffect(() => {
    if (!previewOpen || !autoInsertResearchResolved || !autoInsertJobId) return;
    if (autoInsertAttemptedRef.current.has(autoInsertJobId)) return;
    autoInsertAttemptedRef.current.add(autoInsertJobId);
    const jobId = autoInsertJobId;
    researchRef.current.autoInsertFactsForJob(jobId, () => openRef.current).then((result) => {
      recordAutoInsertOutcome(result);
      if (result?.ok) {
        // A stale refusal left over from an earlier attempt on this same job
        // is worse than none once the facts actually arrive.
        if (autoInsertJobIdRef.current === jobId) setAutoInsertMessage(null);
        return;
      }
      const severity = result?.severity;
      if ((severity === "failure" || severity === "info") && autoInsertJobIdRef.current === jobId) {
        setAutoInsertMessage({ severity, text: result.reason || "" });
      }
    });
  }, [previewOpen, autoInsertJobId, autoInsertResearchResolved]);

  // N61: the cover letter's inserted-fact review strip. Built here (not
  // inside DocumentPreviewDialog.js, which is at its own line ceiling) and
  // handed down as one pre-built element -- the same pattern `focusControls`
  // already uses below. Gated on `activeScope`, not `preview.resumePreview.tab`
  // (see that state's own doc comment above): the strip is a cover-tab-only
  // band, like the companyReferences band it sits beside.
  const insertedFactsJobId = preview.resumePreview.jobId;
  const insertedFacts = tailoringMap[insertedFactsJobId]?.insertedFacts || [];
  // N61 (live defect, chunk N61): this used to discard the hook's
  // `{ok:false, reason}` outright, so a refused removal (e.g. a stale
  // locator) showed the candidate nothing -- the click looked like a silent
  // no-op, exactly what made the coalesced-offset bug above invisible.
  // Surfaced as a readable alert in the strip; cleared on the next attempt
  // that succeeds.
  const [removeError, setRemoveError] = useState("");
  // Shown on EVERY tab whenever the letter carries inserted facts, not only on
  // the cover tab. The combine control builds from the cover letter and is
  // reachable from any tab, so gating this on the active tab let a letter be
  // combined and downloaded with its research sentences neither marked nor
  // removable anywhere on screen -- a claim reaching an employer that the
  // candidate never had the chance to see. Review has to be possible wherever
  // the letter can leave.
  // N77: rendered in the SAME slot as InsertedFactsStrip (DocumentPreviewDialog.js
  // just renders `{insertedFactsStrip}` verbatim), ABOVE it, so it is visible
  // regardless of whether any fact has arrived -- exactly the case a refusal
  // produces, where `insertedFacts` stays empty and InsertedFactsStrip itself
  // renders null. `AutoInsertFactsMessage` returns null on its own whenever
  // there's nothing to show (no message, or a "silent" severity), so this
  // fragment is harmless to always pass down.
  const insertedFactsStrip = (
    <>
      <AutoInsertFactsMessage severity={autoInsertMessage?.severity} text={autoInsertMessage?.text} />
      {insertedFacts.length > 0 ? (
        <InsertedFactsStrip
          facts={insertedFacts}
          error={removeError}
          onRemove={async (factId) => {
            const result = await research.removeInsertedFact(insertedFactsJobId, factId);
            setRemoveError(result && result.ok === false ? result.reason || "Couldn't remove that fact. Try again." : "");
          }}
        />
      ) : null}
    </>
  );

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
      insertedFactsStrip={insertedFactsStrip}
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
      drive={drive}
      onActiveScopeChange={setActiveScope}
    />
  );
}
