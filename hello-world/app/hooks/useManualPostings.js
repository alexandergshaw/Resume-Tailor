"use client";

import { useEffect, useRef, useState } from "react";
import {
  createEntry,
  addEntry,
  removeEntry,
  setEntryText,
  patchEntry,
  submittableEntries,
  failedEntries,
  markQueued,
  restorePostingTexts,
  serializeEntries,
} from "../../lib/tailor/postingQueue";
import {
  enqueueTargets,
  createQueueState,
  enqueue,
  startNext,
  finish,
  isIdle,
} from "../../lib/tailor/rollingQueue";

const CONCURRENCY_LIMIT = 3;
const POSTINGS_KEY = "jobPostings";
const LEGACY_POSTING_KEY = "jobPosting"; // written by the old single-textarea tab; read-only here

// The multi-posting Job Description tab's queue: several posting boxes, each
// tracked + tailored independently through `tailorPosting` (the manual
// pipeline, app/hooks/useManualTailor.js), capped at CONCURRENCY_LIMIT
// simultaneous /api/tailor calls -- but ROLLING, not batched: pressing
// Tailor again while a run is already going ADDS to that run instead of
// waiting for it to finish or starting a second pool. lib/tailor/postingQueue.js
// still owns the entry state-shape rules (what a retry re-runs, what a
// reload restores); lib/tailor/rollingQueue.js owns the pool's own
// bookkeeping (what's eligible to enqueue, how many run at once across
// submissions, when the pool has actually drained). This hook is the wiring
// between the two, plus the async work itself.
//
// Why not runWithConcurrency (lib/tailor/runWithConcurrency.js) here
// anymore: it is a BATCH primitive -- a fixed array in, resolved when that
// array drains -- with no way to hand it more work mid-flight. Every guard
// that used to live in this file (submitAll/retryFailed refusing to run at
// all while busy, setPostingText/removePosting refusing EVERY entry mid-run)
// existed only to protect a batch that could not grow. runWithConcurrency
// itself is UNCHANGED -- app/page.js and other callers still use it
// correctly for genuinely fixed batches, and rewriting a shared primitive to
// serve this one caller would put every one of those callers in the blast
// radius.
export function useManualPostings({
  tailorPosting,
  resumeFile,
  tailoringMap,
  openResumePreview,
  previewScopeAvailable,
  // Fired the moment a submit/retry survives the re-entrancy guard, before
  // any of this hook's own guards run. Exists so the caller (app/page.js) can
  // clear the shared manual-pipeline error (app/hooks/useManualTailor.js) --
  // that error can also be set from outside this tab entirely (a StatusBar
  // chip's failed "Regenerate"), so a stale banner must not survive a fresh
  // run here. A wrapper function in app/page.js did this before, but page.js
  // is rendered by no test in this repo, so that wiring was invisible to
  // every gate (eslint, vitest, the build); this callback is observable from
  // this file's own jsdom test instead.
  onRunRequested,
}) {
  // Posting-box ids come from a counter, not a clock: several boxes can be
  // added within the same millisecond (typing fast, or the persistence
  // restore below), and a clock-based id would collide. Starts at 2: the
  // initial render's lone box (below) is the literal "posting-1" rather
  // than a counter-minted id, because reading a ref during render (even
  // through a useState lazy initializer) is itself unsafe -- see the
  // react-hooks/refs rule -- so it can't call nextEntryId() either.
  const idCounterRef = useRef(2);
  function nextEntryId() {
    const id = `posting-${idCounterRef.current}`;
    idCounterRef.current += 1;
    return id;
  }

  // Tracked-job ids likewise come from a counter, combined with Date.now()
  // for readability/uniqueness across sessions. This is the fix for the
  // defect this feature exists to avoid: runWithConcurrency starts its
  // runners SYNCHRONOUSLY, so three concurrent postings hit
  // `manual-${Date.now()}` in the exact same millisecond every time, which
  // collapses them onto one tracked job and silently destroys two résumés.
  const jobIdCounterRef = useRef(0);
  function nextJobId() {
    jobIdCounterRef.current += 1;
    return `manual-${Date.now()}-${jobIdCounterRef.current}`;
  }

  const [entries, setEntries] = useState(() => [createEntry("posting-1", "")]);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  // A4: what the last completed run produced -- null before the first run,
  // then { done, failed } for whichever run (submitAll or retryFailed) most
  // recently finished. Deliberately NOT derived from `entries`: a derived
  // count changes the instant the user edits or removes a finished posting,
  // which is exactly the bug this replaces (the live region re-announcing a
  // shrinking box count mid-typing, see progressAnnouncement in
  // JobDescriptionTab.js). `completed`/`total` stay as the run's live
  // progress counters -- they are not reset after a run ends, so a caller
  // must use `running` to know whether they're still current (see A4/A6 in
  // the fix notes) -- `lastRun` is the separate, stable "what happened"
  // answer for once the run is over.
  const [lastRun, setLastRun] = useState(null);

  // The rolling pool's own bookkeeping (lib/tailor/rollingQueue.js), kept in
  // a ref rather than state: `startNext`/`finish` must be read and updated
  // SYNCHRONOUSLY from within the pump below (React state is batched/async,
  // and the pump starts several workers back-to-back in the same tick, the
  // same reason `runWithConcurrency` used to start its runners
  // synchronously). `total`/`completed`/`running` state below are mirrors of
  // this ref, pushed out after every transition so the component re-renders.
  const queueRef = useRef(createQueueState());

  // This active period's own done/failed tally. Reset only when a period
  // STARTS (the queue was idle right before this enqueue) -- not per
  // submission, so a posting added mid-run is folded into the same tally
  // rather than starting a second one. Read once, when the period drains.
  const periodOutcomeRef = useRef({ done: 0, failed: 0 });

  // AC-4/A5: which single entry (if any) should auto-open its preview when
  // it finishes. Set only when the enqueue that STARTS a period contains
  // exactly one submittable posting in the whole tab (mirroring the old
  // single-run rule: based on every submittable posting, not just this
  // run's targets, so a retry of one failure out of several still does not
  // pop the preview open) -- and cleared by ANY later submission during the
  // same period, since two results would otherwise fight over the preview.
  const autoOpenEntryIdRef = useRef(null);

  // Each pending/in-flight id's own resolver, created the moment it is
  // enqueued (not when it actually starts) and resolved the moment its
  // worker finishes -- so a submit() call can await ALL of its own targets,
  // including ones that don't get a free concurrency slot until later,
  // because the cap is on the whole period and a pump triggered by an
  // earlier submission's completion may be what actually starts them.
  const settleRef = useRef(new Map());

  // The text a worker actually sends, captured at enqueue time. A target's
  // entry is locked (no edits allowed) for as long as it is pending or
  // processing, so this stays correct for the id's entire time in the pool.
  const targetTextRef = useRef(new Map());

  // Restore any saved postings once on mount. Conditional on something
  // actually being saved: with nothing to restore, the initial single blank
  // box (above) is already correct, so there's nothing to set.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(POSTINGS_KEY);
      const legacy = window.localStorage.getItem(LEGACY_POSTING_KEY);
      if (raw == null && !legacy) return;
      const texts = restorePostingTexts(raw, legacy);
      // A mount-time restore-from-storage is exactly what this effect is
      // for (same as app/hooks/useScreenshots.js's auto-run effect); it's
      // not a derived-state smell.
      setEntries(texts.map((text) => createEntry(nextEntryId(), text)));
    } catch {
      // Keep the default single empty box.
    }
  }, []);

  // Persist on every change -- but skip writing the fresh-mount single blank
  // box, which is still what `entries` is for the render(s) before the
  // restore effect above has had a chance to land its setEntries. Writing it
  // would clobber a saved queue with an empty one.
  //
  // A7: this used to be a "skip exactly one effect run" counter (flip a ref
  // true on invocation #1, write from #2 on). That relied on invocation #2
  // being a genuinely later commit -- true for a normal mount, but Next.js
  // runs StrictMode in dev, which re-invokes every passive effect once more
  // BEFORE any of them get to commit a re-render. So the restore effect's
  // setEntries call, AND this effect's own replayed "invocation #2", both
  // still close over THIS render's stale `entries` (the pristine blank
  // box) -- the count reached 2, the guard unlocked, and it wrote `[""]`
  // over the saved queue anyway. It self-heals on the next real commit, but
  // there's a window where localStorage holds the wrong thing.
  //
  // What actually distinguishes "safe to persist" was never how many times
  // the effect fired -- it's whether `entries` has become something other
  // than the exact array this hook was born with. `pristineEntriesRef`
  // captures that array once (useRef's initial-value argument is only used
  // on the very first call) and every persist attempt -- however many times
  // React chooses to invoke this effect for the same commit -- compares
  // against it by reference. Nothing (restore or a user edit) ever mutates
  // `entries` in place; every setEntries call in this file replaces it with
  // a new array, so identity is exactly the signal we want.
  const pristineEntriesRef = useRef(entries);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (entries === pristineEntriesRef.current) return;
    try {
      window.localStorage.setItem(POSTINGS_KEY, serializeEntries(entries));
    } catch {
      // best-effort only
    }
  }, [entries]);

  function addPosting() {
    setEntries((prev) => addEntry(prev, nextEntryId()));
  }

  function isLocked(id) {
    const target = entries.find((e) => e.id === id);
    return target ? target.status === "pending" || target.status === "processing" : false;
  }

  function removePosting(id) {
    // A4: a no-op ONLY for the entry that is pending or processing (AC-1),
    // even if called anyway -- the UI disables the control per-row, but
    // this is the backstop that keeps the queue from desyncing from an
    // in-progress worker for THAT entry. Every other row stays removable
    // while the run continues.
    if (isLocked(id)) return;
    setEntries((prev) => removeEntry(prev, id));
  }

  function setPostingText(id, text) {
    // A4's hook-level backstop, same reasoning as removePosting's above: the
    // UI disables the field per-row, but without this a call that slips
    // through anyway would reset a pending/processing entry to idle while
    // its worker is still running for the OLD text -- that worker's
    // patchEntry then lands "done", a job id and a title on top of the NEW
    // text, so Preview describes a document generated from text that's no
    // longer on screen or in localStorage. Every other row stays editable.
    if (isLocked(id)) return;
    setEntries((prev) => setEntryText(prev, id, text));
  }

  // Start as many pending ids as the shared cap allows, right now. Called
  // once synchronously by every submit() (so newly enqueued work gets a
  // chance to run immediately) and again from a worker's own completion (so
  // the next pending id takes the slot that just freed up) -- this IS the
  // "rolling" in rolling queue.
  function pump() {
    const { state, started } = startNext(queueRef.current, CONCURRENCY_LIMIT);
    queueRef.current = state;
    started.forEach((id) => {
      // Not awaited: a worker runs to completion on its own and re-pumps
      // when it finishes (see runWorker's `finally` below). Awaiting it here
      // would serialize what is supposed to be a concurrent pool.
      runWorker(id);
    });
  }

  // The unit of work for one queued id: call the pipeline, patch that one
  // entry's status/result, then tell the pool this id is done -- which
  // either ends the active period (nothing left pending or in flight) or
  // pumps the next pending id into the slot this one just freed.
  async function runWorker(id) {
    const text = targetTextRef.current.get(id) ?? "";
    // A5: fixed at the moment this id actually starts (this synchronous
    // call), not re-checked later -- a later submission cancels the ref for
    // anything not yet dispatched, but cannot retroactively change an
    // openPreview that has already been sent to the pipeline.
    const openPreview = autoOpenEntryIdRef.current === id;
    const syntheticJobId = nextJobId();
    setEntries((prev) => patchEntry(prev, id, { status: "processing" }));
    try {
      const result = await tailorPosting({
        syntheticJobId,
        overridePosting: text,
        openPreview,
        queued: true,
      });
      if (result?.ok) {
        periodOutcomeRef.current.done += 1;
        setEntries((prev) =>
          patchEntry(prev, id, {
            status: "done",
            error: "",
            warning: result.warning || "",
            jobId: result.jobId || syntheticJobId,
            jobTitle: result.jobTitle || "",
            company: result.company || "",
          }),
        );
      } else {
        periodOutcomeRef.current.failed += 1;
        setEntries((prev) =>
          patchEntry(prev, id, {
            status: "error",
            error: result?.error || "Tailoring failed.",
          }),
        );
      }
    } catch (err) {
      // One posting's pipeline rejecting outright must never take the
      // others down with it.
      periodOutcomeRef.current.failed += 1;
      setEntries((prev) =>
        patchEntry(prev, id, {
          status: "error",
          error: err?.message || "Tailoring failed.",
        }),
      );
    } finally {
      targetTextRef.current.delete(id);
      queueRef.current = finish(queueRef.current, id);
      setCompleted(queueRef.current.completed);
      // A2: draining is a race -- the period is only actually over once
      // NOTHING is pending AND nothing is in flight (isIdle checks both).
      // Checking just one would end the period early, mid-flight.
      if (isIdle(queueRef.current)) {
        setRunning(false);
        setLastRun({ done: periodOutcomeRef.current.done, failed: periodOutcomeRef.current.failed });
        autoOpenEntryIdRef.current = null;
      } else {
        pump();
      }
      const settle = settleRef.current.get(id);
      settleRef.current.delete(id);
      settle?.();
    }
  }

  // Enqueue `targets` and let the pump take it from there. Shared by
  // submitAll and retryFailed so both honor the same cap, the same
  // per-entry status transitions, and the same auto-open rule -- whether
  // this call STARTS a fresh period or ADDS to one already running.
  async function submit(targets) {
    const ids = targets.map((t) => t.id);
    const wasIdle = isIdle(queueRef.current);

    if (wasIdle) {
      // A2/A4: a fresh period starts here -- this run's own tally begins at
      // zero rather than carrying over whatever the previous, already-drained
      // period left behind.
      periodOutcomeRef.current = { done: 0, failed: 0 };
    }
    // A5: auto-open only when THIS enqueue starts the period AND it is the
    // one and only submittable posting in the whole tab (matching the old
    // single-run rule -- a retry of one failure out of several must still
    // not pop the preview open). Any submission that does NOT start a fresh
    // period is, by definition, later work arriving during an active one,
    // and cancels whatever auto-open was armed.
    autoOpenEntryIdRef.current = wasIdle && submittableEntries(entries).length === 1 ? ids[0] : null;

    const waits = ids.map((id) => {
      targetTextRef.current.set(id, targets.find((t) => t.id === id).text);
      let resolve;
      const promise = new Promise((res) => {
        resolve = res;
      });
      settleRef.current.set(id, resolve);
      return promise;
    });

    setEntries((prev) => markQueued(prev, ids));
    queueRef.current = enqueue(queueRef.current, ids);
    setTotal(queueRef.current.total);
    setCompleted(queueRef.current.completed);
    setRunning(true);

    pump();

    await Promise.all(waits);
  }

  async function submitAll(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    // A7: the re-entrancy guard moves from "is anything running" to "is
    // THIS entry already pending or processing" -- enqueueTargets already
    // encodes that, so a submission that adds nothing new is silently
    // ignored EXACTLY when a period is already active (a double-click on a
    // posting that is already going). When nothing is running at all, an
    // empty target list is the genuine "nothing to submit" guardrail below,
    // which does announce itself.
    const targets = enqueueTargets(entries);
    if (targets.length === 0) {
      if (isIdle(queueRef.current)) {
        onRunRequested?.();
        // Blank is checked before the missing-résumé guard, matching the
        // single-textarea version's own guard order (app/page.js:2622).
        setError("Please provide a job posting.");
      }
      return;
    }

    onRunRequested?.();
    if (!resumeFile) {
      setError("Please upload a resume file.");
      return;
    }
    setError("");
    await submit(targets);
  }

  async function retryFailed() {
    const targets = enqueueTargets(failedEntries(entries));
    if (targets.length === 0) return;

    onRunRequested?.();
    // A5: submitAll has always guarded a missing résumé; retryFailed didn't.
    // Reachable by re-picking the résumé file and cancelling the dialog
    // between runs -- unguarded, every retried posting would reach the
    // pipeline's own guard and write the same message into the one shared
    // banner while also showing it on its own card.
    if (!resumeFile) {
      setError("Please upload a resume file.");
      return;
    }
    setError("");
    await submit(targets);
  }

  // Open a finished posting's documents. Deliberately NOT memoized with a
  // dependency list -- app/hooks/useScreenshots.js:77 (previewItem) leaves
  // its equivalent unmemoized for the same reason: a stale `tailoringMap`
  // closure would open the preview with yesterday's (or no) content.
  function previewEntry(entry) {
    if (!entry?.jobId) return;
    const t = tailoringMap[entry.jobId] || {};
    openResumePreview(
      {
        id: entry.jobId,
        title: entry.jobTitle || t.generatedJobTitle || "",
        company: entry.company || "",
        // A1: the manual pipeline never writes `jobDescription` into
        // tailoringMap -- only the URL flow (app/page.js:2508-ish) and the
        // feed flow (:2706-ish) do -- so `t.jobDescription` is always "".
        // openResumePreview stores that as `posting`, and every Revise,
        // steering, focus-area, framing and persona action then fails with
        // "Couldn't find the job posting to revise against." The text is
        // sitting right here on the entry.
        description: t.jobDescription || entry.text || "",
      },
      { tab: previewScopeAvailable(t, "cover") ? "cover" : "resume" },
    );
  }

  return {
    entries,
    running,
    completed,
    total,
    lastRun,
    error,
    addPosting,
    removePosting,
    setPostingText,
    submitAll,
    retryFailed,
    previewEntry,
  };
}
