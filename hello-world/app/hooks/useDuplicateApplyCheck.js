"use client";

import { useMemo, useState } from "react";
import { evaluatePriorApplications, mergeVerdicts } from "@/lib/duplicateApply/duplicateApplyVerdict.js";
import { presentVerdict, orderVerdicts, dismissalFingerprint } from "@/lib/duplicateApply/verdictPresentation.js";
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
    setDupeDismissed((prev) => {
      const next = new Set(prev);
      next.add(fingerprint);
      return next;
    });
  }

  return { runDuplicateCheck, dupeNotice, dupeAnnounceSeq, onOpenApplications, onDupeDismiss };
}
