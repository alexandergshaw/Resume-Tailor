"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import DocumentPreviewDialog from "./DocumentPreviewDialog";
import FocusPickerDialog from "./FocusPickerDialog";
import InsertedFactsStrip from "./preview/InsertedFactsStrip";
import AutoInsertFactsMessage from "./preview/AutoInsertFactsMessage";
import HypotheticalBand from "./preview/HypotheticalBand";
import IdealResultBands from "./preview/IdealResultBands";
import DocumentReviewSection from "./preview/DocumentReviewSection";
import { useCopyFeedback } from "./preview/CopyFeedback";
import { planMoveFact } from "../../lib/acceptedFacts/factMove";
import {
  requestSmoothTransition,
  confirmSmoothTransition,
  declineSmoothTransition,
  undoSmoothTransition,
} from "../../lib/coverFacts/smoothTransition";
import {
  buildTemplateLinesForUpload,
  getDownloadFileNameForTitle,
  getDownloadCoverLetterFileNameForTitle,
} from "../../lib/document/docx";
import { linesToModel } from "../../lib/document/docxPreview";
import { emailPreviewText, visibleScopesFor } from "../../lib/tailor/documentScopes";
import { idealSurfaceFor } from "../../lib/tailor/idealSurface";
import { reviewDocumentFor } from "../../lib/review/selectReviewDocument";
import { useDriveDocuments } from "../hooks/useDriveDocuments";
import useRegenerateWeaknesses from "../hooks/useRegenerateWeaknesses";
import { ENGINE_OPTIONS } from "../settings/engine";
import { recordDecision } from "@/lib/activityLog/appActivityLog.js";
import { visuallyHidden } from "@/lib/copilot/answerStatus";

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
// only the listed fields ever survive onto the record -- so this door cannot
// carry the inserted sentence, the company, the article title or a byte of
// the letter body, whatever fields `result` happens to hold.
// N90: a `nothing-eligible` result also carries the eligibility breakdown
// (plain counts, never content); gated to that code specifically so no other
// outcome's field shape changes.
function recordAutoInsertOutcome(result) {
  if (!result) return;
  const outcome = autoInsertDecisionOutcome(result);
  const fields = result.ok
    ? { count: typeof result.count === "number" ? result.count : 0 }
    : { reason: result.reason || "", code: result.code || "unknown-refusal" };
  if (result.code === "nothing-eligible") {
    fields.articleCount = typeof result.articleCount === "number" ? result.articleCount : 0;
    fields.droppedNoUrl = typeof result.droppedNoUrl === "number" ? result.droppedNoUrl : 0;
    fields.droppedNoSuggestion = typeof result.droppedNoSuggestion === "number" ? result.droppedNoSuggestion : 0;
    fields.droppedRemoved = typeof result.droppedRemoved === "number" ? result.droppedRemoved : 0;
    fields.droppedRemovedAlsoAccepted = typeof result.droppedRemovedAlsoAccepted === "number" ? result.droppedRemovedAlsoAccepted : 0;
  }
  recordDecision(AUTO_INSERT_DECISION_ID, outcome, fields);
}

// The owner reported the auto-insert feature "still not working" twice, and
// the activity log they sent both times proved research had succeeded and
// yet carried NO fact-auto-insert event at all -- because the coordinating
// effect below only ever calls `autoInsertFactsForJob` (and so only ever
// records anything) when research resolved WITH at least one article. Three
// ordinary outcomes -- research resolved empty, research failed outright, and
// the candidate closing the preview before research finished -- left no trace
// whatsoever, indistinguishable from the feature being broken. These three
// canned, content-free reasons are what the effect (never the function, which
// does not run in any of these cases) records for them below. Never the raw
// research error: that string can carry the company name or a source url
// (see the LEAKY_ERROR case the test file plants), and this record is written
// into a file the candidate downloads and shares onward.
const RESEARCH_EMPTY_REASON = "Company research finished but found nothing to add to this letter.";
const RESEARCH_FAILED_REASON = "Company research could not be completed.";
const RESEARCH_PENDING_REASON = "The letter was closed before company research finished.";

// None of the three surface on screen (see the RED test file's header
// ruling): this is a background nicety the candidate never asked for, and a
// banner over "we found nothing" or "research failed" when they merely opened
// their own letter reads as a fault, or a judgement on the employer, with no
// action attached -- the same reasoning that already keeps the `already-edited`
// refusal silent. The distinction the owner needs lives in the downloaded log
// (distinct outcome + code), not on their screen.

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
  // N104: what a regenerate needs beyond the preview itself -- the entry writer a
  // first Ideal run also uses, the preview's reload bump, and the two other inputs
  // a run takes (page.js passes all four).
  updateTailoringJob,
  onPreviewReload,
  additionalContext = "",
  contextFiles = [],
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
  // Tracks the PREVIOUS render's `previewOpen`, read (then overwritten) at the
  // top of the coordinating effect below -- distinct from `openRef` above,
  // which an earlier effect in this same commit already advances to the NEW
  // value before the coordinating effect runs, so it can never answer "was
  // this open a moment ago." Only a genuine true->false transition, caught
  // here, counts as a close; a component that mounts already-closed must
  // record nothing (see that effect's own comment).
  const prevPreviewOpenRef = useRef(previewOpen);
  const autoInsertJobId = preview.resumePreview.jobId;
  const autoInsertResearchEntry = research.researchByJob[autoInsertJobId];
  const autoInsertResearchResolved =
    !!autoInsertResearchEntry &&
    !autoInsertResearchEntry.loading &&
    Array.isArray(autoInsertResearchEntry.articles) &&
    autoInsertResearchEntry.articles.length > 0;
  // Resolved, no error, but nothing came back: distinct from "resolved with
  // articles" above (autoInsertResearchResolved) and from "could not run"
  // below (autoInsertResearchFailed) -- the three ordinary outcomes the
  // effect now records.
  const autoInsertResearchEmpty =
    !!autoInsertResearchEntry &&
    !autoInsertResearchEntry.loading &&
    !autoInsertResearchEntry.error &&
    Array.isArray(autoInsertResearchEntry.articles) &&
    autoInsertResearchEntry.articles.length === 0;
  const autoInsertResearchFailed = !!autoInsertResearchEntry && !autoInsertResearchEntry.loading && !!autoInsertResearchEntry.error;
  const autoInsertResearchLoading = !!autoInsertResearchEntry && !!autoInsertResearchEntry.loading;

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
    // Captured (then overwritten) FIRST, unconditionally, so the "was this
    // open a moment ago" read stays accurate across every early return below
    // -- including the ones for a job this effect will never otherwise touch.
    const wasOpen = prevPreviewOpenRef.current;
    prevPreviewOpenRef.current = previewOpen;
    if (!autoInsertJobId) return;
    if (autoInsertAttemptedRef.current.has(autoInsertJobId)) return;

    if (previewOpen && autoInsertResearchResolved) {
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
      return;
    }

    // The three ordinary "no facts arrived" outcomes below never reach
    // `autoInsertFactsForJob` -- it never runs for any of them -- so the
    // record can only come from here, the effect, exactly once per firing
    // (the mutually exclusive `if` chain), never alongside the function's
    // own record above.
    if (previewOpen && autoInsertResearchEmpty) {
      // Permanently dedupes like the real-attempt branch above: research
      // resolving empty is a terminal state for this job, so there is no
      // future retry this would wrongly suppress.
      autoInsertAttemptedRef.current.add(autoInsertJobId);
      recordDecision(AUTO_INSERT_DECISION_ID, "skipped", { reason: RESEARCH_EMPTY_REASON, code: "research-empty" });
      return;
    }

    if (previewOpen && autoInsertResearchFailed) {
      autoInsertAttemptedRef.current.add(autoInsertJobId);
      recordDecision(AUTO_INSERT_DECISION_ID, "failed", { reason: RESEARCH_FAILED_REASON, code: "research-failed" });
      return;
    }

    // The candidate closed the preview while research was still running --
    // `wasOpen` (not merely `!previewOpen`) makes this a genuine close, never
    // a mount that merely starts out closed. Deliberately NOT added to
    // `autoInsertAttemptedRef`: unlike the two branches above, "pending" is
    // not a terminal state -- research is still running and may resolve with
    // articles the next time this job's preview is open, and that later,
    // real attempt (the branch at the top of this effect) must still be free
    // to fire then. The `wasOpen` transition check already keeps this branch
    // from re-firing on every render while the preview stays closed -- it
    // only fires again on a SUBSEQUENT close, which is a genuine new event.
    if (!previewOpen && wasOpen && autoInsertResearchLoading) {
      recordDecision(AUTO_INSERT_DECISION_ID, "skipped", { reason: RESEARCH_PENDING_REASON, code: "research-pending" });
    }
  }, [
    previewOpen,
    autoInsertJobId,
    autoInsertResearchResolved,
    autoInsertResearchEmpty,
    autoInsertResearchFailed,
    autoInsertResearchLoading,
  ]);

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
  // that succeeds. Shared with N92 Wave 1's move controls below -- one
  // action-error slot for the strip, whichever control last failed.
  const [removeError, setRemoveError] = useState("");
  // N92 Wave 3 (Control B): at most ONE pending smoothed candidate at a time
  // -- CONFIRM-BEFORE-PERSIST (owner ruling D7). Produced by a "Smooth"
  // click, shown by InsertedFactsStrip/CoverFactSmoothConfirm, and NEVER
  // written to tailoringMap or the store until Apply (AC-B10/B12); Discard
  // just clears it (AC-B11). This is the ONE production surface that
  // imports lib/coverFacts/smoothTransition.js -- the seam's own module is
  // what makes AC-B8a's "unattended paths never import it" guard provable.
  const [pendingSmooth, setPendingSmooth] = useState(null);
  // N94: a live mirror of `pendingSmooth`, written ONLY through `setPending`.
  // handleSmooth awaits a network round-trip, so the `pendingSmooth` it closed
  // over at click time can be stale by the time the produce resolves -- the
  // candidate it must account for is whichever one is pending NOW.
  const pendingSmoothRef = useRef(null);
  function setPending(next) {
    pendingSmoothRef.current = next;
    setPendingSmooth(next);
  }
  // N93 (AC-B6): the applied candidate for each fact that currently has a
  // reachable Undo affordance -- at most one per fact, `{[factId]: candidate}`.
  // Stashed here (not inside smoothTransition.js, which stays isomorphic and
  // holds no state of its own) after a successful Apply; cleared -- WITHDRAWN,
  // never silently reused -- by a later remove, move, or fresh smooth of that
  // SAME fact, so an undo can never clobber work done after it (the safe
  // direction the design and AC-B6 both call for; a moved fact's undo is
  // withdrawn rather than guessed at restoring "relative to" its new spot).
  const [appliedSmooth, setAppliedSmooth] = useState({});
  function clearAppliedSmooth(factId) {
    setAppliedSmooth((m) => {
      if (!(factId in m)) return m;
      const next = { ...m };
      delete next[factId];
      return next;
    });
  }
  // N95: one in-flight op per fact -- MOVE and SMOOTH-PRODUCE share this flag
  // (a fact cannot be doing both at once, since both live on the row's own
  // controls), independent of `movability` (AC-M2's explicit requirement).
  // `applyPending` is separate: it lives on the confirm surface, not the row.
  const [factOpPending, setFactOpPending] = useState(null); // null | { factId, kind: "move" | "smooth-produce" }
  const [applyPending, setApplyPending] = useState(false);
  // Strip-action announcements (AC-M3/S3/K2-sibling). clearKey is JOB
  // IDENTITY ONLY, never previewReloadKey -- a move's own reload bump would
  // otherwise render-phase-reset this to EMPTY (CopyFeedback.js:75-78) and
  // wipe "Fact moved." the instant it lands.
  const { announce, regionProps } = useCopyFeedback(insertedFactsJobId);
  // N105 Step 7: null unless this job carries an Ideal run (D-10 / UX-20 key on
  // `entry.ideal`, never on the engine, so a later engine switch cannot undo it).
  const idealSurface = idealSurfaceFor(tailoringMap[insertedFactsJobId], {
    title: preview.resumePreview.title,
    company: preview.resumePreview.company,
  });
  // N103: the name a document goes by on the two places that name it (Ask AI's pin
  // and the review's subject line), so the two can never describe it differently.
  const documentLabel = (scope) =>
    `${preview.resumePreview.company || "Job"}${preview.resumePreview.title ? ` · ${preview.resumePreview.title}` : ""} — ${scope === "cover" ? "Cover letter" : scope === "hypothetical" ? "HYPOTHETICAL resume (not the candidate's real record)" : "Resume"}`;
  // N103: one review request per tab that has text to review (never the email
  // tab, which is plain text for a mail client). A tab with no text gets none, so
  // an empty job mounts no strip.
  const reviewRequests = {};
  for (const scope of visibleScopesFor(tailoringMap[insertedFactsJobId])) {
    const request = reviewDocumentFor(tailoringMap, insertedFactsJobId, scope, documentLabel(scope));
    if (request) reviewRequests[scope] = request;
  }
  const reviewStripMounted = Object.keys(reviewRequests).length > 0;
  // N104: the Regenerate row and report the resume strip carries. The in-flight guard,
  // the Undo snapshot and the failure flag live in this hook, above the strips, which
  // remount with the tab.
  const regenerate = useRegenerateWeaknesses({
    jobId: insertedFactsJobId,
    tailoringMap,
    engine: tailorEngine,
    engineLabel: ENGINE_OPTIONS.find((option) => option.value === tailorEngine)?.label,
    idealSurface,
    reviewRequests,
    posting: (preview.resumePreview.posting || tailoringMap[insertedFactsJobId]?.jobDescription || "").trim(),
    url: (preview.resumePreview.url || "").trim(),
    resumeFile,
    additionalContext,
    contextFiles,
    updateTailoringJob,
    onPreviewReload,
    announce,
  });
  async function handleMove(factId, direction) {
    setFactOpPending({ factId, kind: "move" });
    announce({ polite: "Moving the fact." });
    try {
      const result = await research.moveInsertedFact(insertedFactsJobId, factId, direction);
      const failed = result && result.ok === false;
      setRemoveError(failed ? result.reason || "Couldn't move that fact. Try again." : "");
      if (failed) {
        announce({ alert: result.reason || "Couldn't move that fact. Try again.", persist: true });
      } else {
        clearAppliedSmooth(factId);
        announce({ polite: "Fact moved." });
      }
    } finally {
      setFactOpPending(null);
    }
  }
  async function handleSmooth(factId) {
    clearAppliedSmooth(factId);
    const jobId = insertedFactsJobId;
    const entry = tailoringMap[jobId] || {};
    setFactOpPending({ factId, kind: "smooth-produce" });
    announce({ polite: "Smoothing the transition." });
    try {
      const candidate = await requestSmoothTransition({
        engine: tailorEngine,
        lines: entry.coverLetterResultLines || [],
        records: entry.insertedFacts || [],
        id: factId,
      });
      // N94: whatever is pending at this moment is about to be dropped -- replaced
      // by this candidate, or cleared by a failed produce. It was never approved,
      // so the log records it as the same "declined" decision Discard writes
      // (a candidate Apply already consumed is no longer pending, so it is never
      // double-recorded). Captured BEFORE the swap below.
      const superseded = pendingSmoothRef.current;
      if (candidate.status === "proposed") {
        setPending({ factId, candidate });
        announce({ polite: "Transition smoothed. Review before applying." });
      } else {
        setPending(null);
        setRemoveError("Couldn't smooth that transition. Try again.");
        announce({ alert: "Couldn't smooth that transition. Try again.", persist: true });
      }
      if (superseded) await declineSmoothTransition(superseded.candidate);
    } finally {
      setFactOpPending(null);
    }
  }
  async function handleApplySmooth(factId) {
    if (!pendingSmooth || pendingSmooth.factId !== factId) return;
    const { candidate } = pendingSmooth;
    let failureReason = "";
    let confirmed = { ok: false };
    setApplyPending(true);
    announce({ polite: "Applying the smoothed version." });
    try {
      // N94: the persist wrapper hands the hook's own { ok, reason } back to
      // confirmSmoothTransition -- that is how the ledger learns a refused save
      // and records "failed" rather than "acted". `confirmed.ok` is then the one
      // answer to "did it land", also for a persist that threw.
      confirmed = await confirmSmoothTransition(candidate, {
        persist: async (after) => {
          const result = await research.applySmoothedFact(insertedFactsJobId, after);
          if (result && result.ok === false) failureReason = result.reason || "";
          return result;
        },
      });
    } finally {
      setApplyPending(false);
    }
    const applied = confirmed.ok;
    setRemoveError(applied ? "" : failureReason || "Couldn't apply the smoothed version.");
    announce(applied ? { polite: "Transition applied." } : { alert: "Couldn't apply the smoothed version.", persist: true });
    setPending(null);
    // N93: only a genuinely persisted apply gets an Undo affordance -- a
    // failed persist left the letter unchanged, so there is nothing to undo.
    if (applied) setAppliedSmooth((m) => ({ ...m, [factId]: candidate }));
  }
  async function handleDiscardSmooth(factId) {
    if (!pendingSmooth || pendingSmooth.factId !== factId) return;
    await declineSmoothTransition(pendingSmooth.candidate);
    setPending(null);
  }
  // N93 (AC-B6): reverts a CONFIRMED, stashed smoothing. Withdraws the
  // affordance FIRST (not after the persist resolves) so a second click
  // during the in-flight undo can never fire a double-revert -- the same
  // "gone the instant it's used" contract Apply's own pendingSmooth clear
  // already follows.
  //
  // N122: like Apply (N94), the persist wrapper hands the hook's own
  // { ok, reason } back to undoSmoothTransition -- that is how the ledger learns a
  // refused save and records "failed" rather than "acted". The returned `ok` is
  // then the one answer to "did it land", also for a persist that threw, so the
  // user-visible error follows it rather than the hook's resolve alone.
  async function handleUndoSmooth(factId) {
    const candidate = appliedSmooth[factId];
    if (!candidate) return;
    clearAppliedSmooth(factId);
    let failureReason = "";
    const undone = await undoSmoothTransition(candidate, {
      persist: async (restored) => {
        const result = await research.applySmoothedFact(insertedFactsJobId, restored);
        if (result && result.ok === false) failureReason = result.reason || "";
        return result;
      },
    });
    setRemoveError(undone.ok ? "" : failureReason || "Couldn't undo the smoothing. Try again.");
  }
  // N92 Wave 1 (Control A): whether each inserted fact CAN move forward/
  // backward, computed with the exact same `planMoveFact` the click handler
  // below calls -- a dry run against the CURRENT lines/records, never
  // mutating anything. This is what lets the strip disable a boundary
  // control honestly, before any click (AC-A6): the fact's own move handler
  // returning `{changed:false}` is the single source of truth for
  // movability, so the render-time check and the click-time behaviour can
  // never disagree.
  const insertedFactsLines = tailoringMap[insertedFactsJobId]?.coverLetterResultLines || [];
  const insertedFactsMovability = {};
  for (const fact of insertedFacts) {
    insertedFactsMovability[fact.id] = {
      forward: planMoveFact({ lines: insertedFactsLines, records: insertedFacts, id: fact.id, direction: "forward" }).changed,
      backward: planMoveFact({ lines: insertedFactsLines, records: insertedFacts, id: fact.id, direction: "backward" }).changed,
    };
  }
  // N95: the single fact (if any) with a move or smooth-produce in flight,
  // and the narrower case of specifically a smooth-produce -- see
  // InsertedFactsStrip's own header comment for why the two are separate.
  const busyFactId = factOpPending?.factId ?? null;
  const smoothingFactId = factOpPending?.kind === "smooth-produce" ? factOpPending.factId : null;
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
      {insertedFacts.length > 0 || idealSurface?.announces || reviewStripMounted ? (
        <>
          {/* N95: the two hidden live regions only (no visible chip -- the
              row is already dense) -- reused verbatim from CopyFeedback.js's
              own markup so strip actions follow the same "already-mounted
              region, text-change on announce()" contract (N84-safe) as every
              other copy-feedback surface. Selected by data-copy-status, never
              role -- DocumentPreviewDialog already mounts a first
              role=status/alert pair for DriveResultRegion. N105 Step 7: the
              Application-ready band's Copy-line rows announce through this SAME
              pair (its onOutcome), mounted only while that band has rows, so the
              band adds no live region of its own. N103: the review strip
              announces its result through this pair too, so it is mounted
              whenever a strip is -- BEFORE the first click, since only a text
              change on an already-mounted region reliably announces. */}
          <Box component="span" role="status" aria-live="polite" data-copy-status="polite" sx={visuallyHidden}>
            {regionProps.polite ? <span key={regionProps.seq}>{regionProps.polite}</span> : null}
          </Box>
          <Box component="span" role="alert" data-copy-status="alert" sx={visuallyHidden}>
            {regionProps.alert ? <span key={regionProps.seq}>{regionProps.alert}</span> : null}
          </Box>
          {insertedFacts.length > 0 ? (
            <InsertedFactsStrip
              facts={insertedFacts}
              error={removeError}
              movability={insertedFactsMovability}
              busyFactId={busyFactId}
              smoothingFactId={smoothingFactId}
              applyPending={applyPending}
              onRemove={async (factId) => {
                const result = await research.removeInsertedFact(insertedFactsJobId, factId);
                const failed = result && result.ok === false;
                setRemoveError(failed ? result.reason || "Couldn't remove that fact. Try again." : "");
                if (!failed) clearAppliedSmooth(factId);
              }}
              onMove={handleMove}
              onSmooth={handleSmooth}
              smoothDisabled={tailorEngine === "embedded"}
              pendingSmooth={pendingSmooth}
              onApplySmooth={handleApplySmooth}
              onDiscardSmooth={handleDiscardSmooth}
              smoothApplied={appliedSmooth}
              onUndoSmooth={handleUndoSmooth}
            />
          ) : null}
        </>
      ) : null}
    </>
  );

  // N105 Step 7: the Ideal run's two bands, keyed by the dialog's OWN tab so the
  // HYPOTHETICAL banner appears in the same commit as the tab (a mount-chosen
  // single band would lag one commit behind a click, via onActiveScopeChange).
  // N103: the review strip stacks BELOW whichever band the tab has, so a level 1-5
  // job (no band) gets the strip alone, and the safety banner stays first. The
  // uploaded resume is read on activation (async, cached per file) as the real
  // material the strip's authority check compares against; no file, no material,
  // and the result says so.
  const loadRealMaterialLines = resumeFile ? () => buildTemplateLinesForUpload(resumeFile) : null;
  const reviewStrip = (scope) =>
    reviewRequests[scope] ? (
      <DocumentReviewSection
        key={`review-${insertedFactsJobId}-${scope}`}
        surface="modal"
        request={reviewRequests[scope]}
        announce={announce}
        covered={scope === "resume" && !!idealSurface?.reviewCovered}
        loadRealMaterialLines={loadRealMaterialLines}
        {...regenerate.forScope(scope)}
      />
    ) : null;
  const resultBands =
    idealSurface || reviewStripMounted
      ? {
          resume: (
            <>
              {idealSurface ? (
                <IdealResultBands
                  ideal={idealSurface.ideal}
                  currentText={idealSurface.currentText}
                  handEdited={idealSurface.handEdited}
                  onOutcome={announce}
                />
              ) : null}
              {reviewStrip("resume")}
            </>
          ),
          cover: reviewStrip("cover"),
          ...(idealSurface
            ? {
                hypothetical: (
                  <>
                    <HypotheticalBand
                      fileName={idealSurface.hypothetical.fileName}
                      busy={!!preview.resumePreview.busy?.hypothetical}
                      onDownload={() =>
                        preview.downloadDocumentPreview("hypothetical", {
                          text: idealSurface.hypothetical.text,
                          fileName: idealSurface.hypothetical.fileName,
                        })
                      }
                    />
                    {reviewStrip("hypothetical")}
                  </>
                ),
              }
            : {}),
        }
      : null;
  // The hook's loader falls back to the application-ready resume for any scope
  // it does not name (F-3), which would show the WRONG document under the
  // HYPOTHETICAL banner. The hypothetical previews from its own lines instead.
  const loadModel = idealSurface
    ? async (scope, opts) =>
        scope === "hypothetical" ? linesToModel(idealSurface.hypotheticalLines) : preview.loadPreviewModel(scope, opts)
    : preview.loadPreviewModel;

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
          // N105 Step 7: "Application-ready" is a claim, so it is derived -- null
          // (the dialog's own "Resume") once the review no longer fits the file.
          tabLabel: idealSurface?.resumeTabLabel,
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
        // N105 Step 7: present only for an Ideal job. `available` is the hypothetical's
        // OWN text (previewScopeAvailable would answer for the application-ready one);
        // no `html`, so the dialog always renders it read-only through `loadModel`.
        ...(idealSurface ? { hypothetical: idealSurface.hypothetical } : {}),
      }}
      // N105 (D-10): the tab set -- the legacy three unless this job carries an
      // Ideal run's hypothetical, so a level 1-5 preview never shows its tab.
      visibleScopes={visibleScopesFor(tailoringMap[preview.resumePreview.jobId])}
      resultBands={resultBands}
      engine={tailorEngine}
      loadModel={loadModel}
      reloadKey={previewReloadKey}
      onClose={preview.closeResumePreview}
      onSave={preview.saveDocumentPreview}
      onRenameFile={preview.renameDocument}
      // N105 (UX-20): Revise, Focus and Framing re-run the STANDARD route, which would
      // replace the gated Application-ready text with an ungated one, so an Ideal job
      // gets none of the three (the dialog hides each control when its callback is absent).
      onResubmit={idealSurface ? null : preview.resubmitDocumentPreview}
      onDownload={preview.downloadDocumentPreview}
      onSetAsDefaultTemplate={preview.setDefaultTemplateFromPreview}
      onAskAi={(scope, payload) =>
        chat.askAiAbout({
          label: documentLabel(scope),
          content: payload?.text || "",
          sourceJobId: preview.resumePreview.jobId,
          // N103: which document of the job is pinned, so the chat's review can
          // tell this resume from the same job's hypothetical.
          documentScope: { jobId: preview.resumePreview.jobId, scope },
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
      onOpenFocusPicker={idealSurface ? null : () => setFocusPickerOpen((v) => !v)}
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
      onSetFraming={
        idealSurface
          ? null
          : (variant) =>
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
      currentUser={currentUser}
      onRegenerateIntoTemplate={preview.regenerateActiveIntoTemplate}
      drive={drive}
      onActiveScopeChange={setActiveScope}
    />
  );
}
