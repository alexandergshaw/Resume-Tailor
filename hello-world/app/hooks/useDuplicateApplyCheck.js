"use client";

import { useMemo, useRef, useState } from "react";
import { evaluatePriorApplications, mergeVerdicts } from "@/lib/duplicateApply/duplicateApplyVerdict.js";
import { presentVerdict, orderVerdicts, dismissalFingerprint } from "@/lib/duplicateApply/verdictPresentation.js";
import { buildDupeLogRecord } from "@/lib/duplicateApply/duplicateApplyLog.js";
import {
  MAX_DUPE_LOG_ENTRIES,
  renderDuplicateApplyLog,
  duplicateApplyLogFileName,
} from "@/lib/duplicateApply/duplicateApplyLogDocument.js";
import { triggerBlobDownload } from "@/lib/document/download.js";
import { TRACKING_TAB_HIDDEN_STATUSES, STATUS_LABELS } from "@/lib/applications/statusVocabulary";

// The duplicate-application flag's state and single call site
// (3-plan-dupapply.md wave W3B). Split out of app/page.js -- not named by
// the plan's own file list, but required by a constraint the plan never
// measured: app/page.js carries three independent, already-shipped tests
// (app/components/DocumentPreviewMount.test.js, lib/drive/lineCeiling.test.js,
// lib/feed/feedTailorFullDescription.test.js) pinning it to FEWER THAN 3250
// lines, part of this repo's standing page.js-consolidation effort. The
// plan's own "+130 lines" estimate for page.js already exceeds that budget
// (3182 + 130 = 3312), before this file's own additions are counted at all.
// This hook is the same shape as every other non-trivial pipeline page.js
// already delegates to (useManualTailor, useDocumentPreview, ...); page.js
// itself keeps only the call sites and the live region.
export function useDuplicateApplyCheck({
  applicationData,
  applicationError,
  applicationLoadedOnce,
  appliedByExternalId,
  trackedJobs,
  setMainTab,
  setInterviewSearch,
}) {
  // One entry per tailored job id, holding the MERGE (mergeVerdicts) of
  // every check that has fired for it so far -- never a single call's raw
  // output, because E3 (and E4/E6) evaluate Signal 1 and Signal 2 at two
  // different times within one tailor run and neither may erase the other.
  const [dupeVerdicts, setDupeVerdicts] = useState([]);
  // AC S-17 / 1c U-4: per-session, in-memory dismissal keyed by a verdict
  // fingerprint, so a re-tailor with an unchanged verdict stays dismissed
  // while one that became more true (a new fingerprint) returns. Never
  // persisted.
  const [dupeDismissed, setDupeDismissed] = useState(() => new Set());
  // S-12 re-announcement: bumped on every check that updates dupeVerdicts,
  // even when the resulting text is byte-identical to the last one, because
  // a text-only diff a screen reader already announced is not reliably
  // re-announced (see the live region in app/page.js).
  const [dupeAnnounceSeq, setDupeAnnounceSeq] = useState(0);

  // ---- the log (the standing feature-logs rule) ---------------------------
  //
  // A REF, NOT STATE, AND ACCUMULATED, NOT REBUILT. Both halves matter:
  //
  //  * A ref because the log has to survive a Clear. "Clear all"
  //    (app/components/StatusBar.js) is `setTrackedJobs([])` and nothing else,
  //    so it never reaches this hook's data at all -- but a ledger held in
  //    state would still be one careless reset away from being nulled, and
  //    app/hooks/useKnowledgeScope.js's `sessionEventsRef` already established
  //    this idiom in this repo for exactly this reason ("held in a ref, never
  //    in state, so a Clear cannot null it").
  //  * Accumulated because the alternative -- rebuilding the log from current
  //    state at download time -- silently loses everything current state no
  //    longer holds. A dismissed verdict is filtered out of `dupeQueue` and a
  //    re-tailor MERGES into an existing entry, so a rebuild would report the
  //    merge and never the two fires that produced it. Unlike the knowledge
  //    feature (whose own log module records that "the log survives a Clear"
  //    is unsatisfiable for it, because Clear deletes the stored rows it
  //    rebuilds from), NOTHING here is persisted server-side in the first
  //    place: this ledger IS the whole record, so accumulating it makes the
  //    rule satisfiable rather than aspirational.
  //
  // `dupeLogCount` exists only to re-render: appending to a ref is invisible to
  // React, and the download control has to APPEAR once there is something to
  // download. It counts entries ever recorded, never the ref's length.
  const dupeLogRef = useRef([]);
  const dupeLogStartedAtRef = useRef(null);
  const dupeLogDroppedRef = useRef(0);
  const [dupeLogCount, setDupeLogCount] = useState(0);

  // Every append goes through here, and every append is stamped with a time
  // THIS hook read -- the lib modules are pure and synchronous by contract
  // (duplicateApplyLog.js's C-19 posture) and must never read a clock
  // themselves, so the ambient I/O stops at this boundary.
  function recordDupeLogEntry(kind, verdict, jobId, entryPoint) {
    try {
      const at = Date.now();
      if (dupeLogStartedAtRef.current === null) dupeLogStartedAtRef.current = at;
      dupeLogRef.current.push({ kind, at, record: buildDupeLogRecord({ verdict, jobId, entryPoint }) });
      // FIFO, oldest first: a long session's TAIL is where the user noticed
      // something was wrong (lib/copilot/sessionLog.js's own reasoning).
      while (dupeLogRef.current.length > MAX_DUPE_LOG_ENTRIES) {
        dupeLogRef.current.shift();
        dupeLogDroppedRef.current += 1;
      }
      setDupeLogCount((n) => n + 1);
    } catch {
      // Recording must never break a tailor run. buildDupeLogRecord already
      // promises never to throw; this is the second, independent guard the
      // same §4 A-1 reasoning requires of every call site here.
    }
  }

  const dupeTimeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  }, []);

  // The single call site of the duplicate-application core in the whole
  // app (§2.8 item e). Every tailoring entry point calls this -- never
  // evaluatePriorApplications directly -- so the never-throws guarantee
  // lives in one place. evaluatePriorApplications already promises never to
  // throw (C-19/C-25); this try/catch is the SECOND, independent guard §4
  // A-1 requires, since a promise made inside a module this file merely
  // calls is not verifiable at every call site -- and a throw here would
  // either abort a tailor before its paid model call (E1/E2/E3's first
  // fire, all OUTSIDE their handler's own try) or be caught by that
  // handler's own catch and discard an already-paid-for result (E3's
  // second fire, INSIDE its try -- RM-15/F-1).
  //
  // `rows` is ALWAYS `applicationData`, never a search-filtered derivative
  // (1c U-7 #6): a filtered copy would under-count without saying so.
  function runDuplicateCheck(candidate, { jobId, entryPoint, runStartedAt } = {}) {
    const startedAt = typeof runStartedAt === "number" ? runStartedAt : Date.now();
    const applyMerge = (verdict) => {
      // Recorded BEFORE the merge and OUTSIDE the updater below, on purpose:
      // the log wants the raw verdict THIS fire produced, not the accumulated
      // merge (E3 evaluates Signal 1 and Signal 2 at two different times and
      // the merge would hide the first one's own evidence), and a side effect
      // inside a setState updater would be run twice under StrictMode's
      // double-invoke and record every check twice.
      recordDupeLogEntry("check", verdict, jobId, entryPoint);
      setDupeVerdicts((prev) => {
        const idx = prev.findIndex((entry) => entry.jobId === jobId);
        if (idx === -1) return [...prev, { jobId, entryPoint, verdict }];
        const next = prev.slice();
        next[idx] = { jobId, entryPoint, verdict: mergeVerdicts(prev[idx].verdict, verdict) };
        return next;
      });
      setDupeAnnounceSeq((n) => n + 1);
    };
    try {
      // §4 A-2, the highest-value fix in the chunk: a failed or in-flight
      // load must not read as `clear`.
      const rowsState = applicationError ? "error" : !applicationLoadedOnce ? "loading" : "ready";

      // §4 A-3: a legacy row demoted to a hidden status (RM-10) while
      // keeping its real applied_at is invisible to the row-based scan --
      // appliedByExternalId is the one place that shape still shows up.
      let candidateStrandedApplied = false;
      const externalId = candidate && candidate.id != null ? String(candidate.id) : null;
      if (externalId && appliedByExternalId && typeof appliedByExternalId.get === "function") {
        const stranded = appliedByExternalId.get(externalId);
        candidateStrandedApplied =
          !!stranded && TRACKING_TAB_HIDDEN_STATUSES.includes(stranded.status) && stranded.appliedAt != null;
      }

      const verdict = evaluatePriorApplications({
        candidate,
        rows: applicationData,
        rowsState,
        candidateStrandedApplied,
        runStartedAt: startedAt,
        windowDays: 30,
        timeZone: dupeTimeZone,
      });
      applyMerge(verdict);
    } catch {
      const threwVerdict = {
        samePosition: { verdict: "unavailable", reason: "check-threw" },
        company: { verdict: "unavailable", reason: "check-threw" },
        checkedAt: startedAt,
        diagnostics: {
          rowsExamined: 0,
          rowsCounted: 0,
          rowsState: null,
          candidateKey: null,
          candidateCompanyKey: null,
          windowDays: 30,
          runStartedAt: startedAt,
        },
      };
      applyMerge(threwVerdict);
    }
  }

  // Dismissal is filtered out HERE, by fingerprint, rather than deleted from
  // dupeVerdicts, so a later check that merges into the same jobId still has
  // the full prior verdict to merge against (mergeVerdicts must never see a
  // gap it didn't cause).
  const dupeQueue = useMemo(
    () => dupeVerdicts.filter((entry) => !dupeDismissed.has(dismissalFingerprint(entry.verdict, entry.jobId))),
    [dupeVerdicts, dupeDismissed],
  );

  // presentVerdict() (Wave 2, frozen contract) is the ONLY place that
  // decides copy, severity and the evidence list. `null` means nothing
  // should render at all (S-10c/g/h/i).
  const dupeNotice = useMemo(() => {
    const worst = orderVerdicts(dupeQueue)[0];
    if (!worst) return null;
    const job = trackedJobs.find((j) => j.id === worst.jobId);
    return presentVerdict({
      verdict: worst.verdict,
      jobId: worst.jobId,
      jobTitle: job?.title || "",
      candidateCompany: job?.company || "",
      queueLength: dupeQueue.length,
      timeZone: dupeTimeZone,
      statusLabels: STATUS_LABELS,
    });
  }, [dupeQueue, trackedJobs, dupeTimeZone]);

  // 1c U-5: land the user on Interviewing with the search seeded to the
  // employer. `searchSeed` is presentVerdict's own S-14-guarded value,
  // forwarded by StatusBar.js verbatim -- never recomputed here.
  function onOpenApplications(searchSeed) {
    setMainTab("interviewing");
    setInterviewSearch(searchSeed);
  }

  // AC S-17: removes only this fingerprint's right to render (the
  // next-worst outstanding verdict, if any, takes its place) -- the entry
  // itself stays in dupeVerdicts so a later merge has something to merge
  // into.
  function onDupeDismiss(jobId) {
    const entry = dupeVerdicts.find((v) => v.jobId === jobId);
    if (!entry) return;
    const fingerprint = dismissalFingerprint(entry.verdict, jobId);
    // A dismissal is a DECISION, and it is recorded carrying the verdict it
    // dismissed -- not a bare "dismissed" line. Dismissal is the one action
    // that removes a warning from the screen without changing anything about
    // whether it was true, so a log that dropped it would be missing precisely
    // the entry a user reaches for when asking "I saw something, what was it?".
    recordDupeLogEntry("dismiss", entry.verdict, jobId, entry.entryPoint);
    setDupeDismissed((prev) => {
      const next = new Set(prev);
      next.add(fingerprint);
      return next;
    });
  }

  // ONE CLICK, ONE FILE. No format menu, no confirmation, no "are you sure":
  // nothing is destroyed and there is only one thing this can produce, so the
  // repo's minimize-clicks rule is satisfied structurally rather than excepted.
  // `null` until something has been recorded -- StatusBar.js renders the
  // control if and only if this is callable, so an always-present button that
  // would write an empty file never exists.
  function downloadDupeLog() {
    const markdown = renderDuplicateApplyLog({
      entries: dupeLogRef.current,
      startedAt: dupeLogStartedAtRef.current,
      dropped: dupeLogDroppedRef.current,
    });
    triggerBlobDownload(
      new Blob([markdown], { type: "text/markdown" }),
      duplicateApplyLogFileName({ startedAt: dupeLogStartedAtRef.current }),
    );
  }

  return {
    runDuplicateCheck,
    dupeNotice,
    dupeAnnounceSeq,
    onOpenApplications,
    onDupeDismiss,
    onDupeDownloadLog: dupeLogCount > 0 ? downloadDupeLog : null,
  };
}
