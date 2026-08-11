"use client";

import { useEffect, useRef, useState } from "react";
import { runWithConcurrency } from "../../lib/tailor/runWithConcurrency";
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

const CONCURRENCY_LIMIT = 3;
const POSTINGS_KEY = "jobPostings";
const LEGACY_POSTING_KEY = "jobPosting"; // written by the old single-textarea tab; read-only here

// The multi-posting Job Description tab's queue: several posting boxes, each
// tracked + tailored independently through `tailorPosting` (the manual
// pipeline, app/hooks/useManualTailor.js), capped at CONCURRENCY_LIMIT
// simultaneous /api/tailor calls via runWithConcurrency. All the state-shape
// rules (what's submittable, what a retry re-runs, what a reload restores)
// live in lib/tailor/postingQueue.js; this hook is the wiring around them.
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

  // A ref twin of `running`, checked synchronously by the re-entrancy guard
  // in submitAll/retryFailed -- state updates are batched/async, so a guard
  // that read `running` state instead could still let a second submit
  // through before the first render committed.
  const runningRef = useRef(false);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  function removePosting(id) {
    // A no-op while a run is in flight, even if called anyway (AC-1) -- the
    // UI disables the control, but this is the backstop that keeps the
    // queue from desyncing from an in-progress run.
    if (runningRef.current) return;
    setEntries((prev) => removeEntry(prev, id));
  }

  function setPostingText(id, text) {
    // A2's hook-level backstop, same reasoning as removePosting's above: the
    // UI disables the field mid-run, but without this a call that slips
    // through anyway would reset the entry to idle while an in-flight
    // worker for the OLD text is still running -- that worker's patchEntry
    // then lands "done", a job id and a title on top of the NEW text, so
    // Preview describes a document generated from text that's no longer on
    // screen or in localStorage.
    if (runningRef.current) return;
    setEntries((prev) => setEntryText(prev, id, text));
  }

  // Run `targets` (a subset of `entries`) through the tailoring pipeline,
  // at most CONCURRENCY_LIMIT at once. Shared by submitAll and retryFailed
  // so both honor the same cap, the same per-entry status transitions, and
  // the same auto-open rule.
  async function runQueue(targets) {
    setError("");
    runningRef.current = true;
    setRunning(true);
    setTotal(targets.length);
    setCompleted(0);
    // AC-4: the preview only auto-opens for a lone posting -- with several
    // in flight it would fight the other results. Based on every submittable
    // posting, not just this run's targets, so a retry of one failure (out
    // of a queue of several) still does not pop the preview open.
    const openPreview = submittableEntries(entries).length === 1;
    setEntries((prev) => markQueued(prev, targets.map((e) => e.id)));

    // A4: this run's own done/failed tally, kept as a plain local (not
    // state) because it only needs to exist once, at the end -- reading it
    // back out of `entries` afterwards would require filtering to just this
    // run's target ids (entries also holds postings from earlier runs) and
    // would race the same batched-setEntries timing that makes `completed`
    // unsuitable for anything but live progress.
    const outcome = { done: 0, failed: 0 };

    try {
      await runWithConcurrency(
        targets,
        CONCURRENCY_LIMIT,
        async (target) => {
          const syntheticJobId = nextJobId();
          setEntries((prev) => patchEntry(prev, target.id, { status: "processing" }));
          try {
            const result = await tailorPosting({
              syntheticJobId,
              overridePosting: target.text,
              openPreview,
              queued: true,
            });
            if (result?.ok) {
              outcome.done += 1;
              setEntries((prev) =>
                patchEntry(prev, target.id, {
                  status: "done",
                  error: "",
                  warning: result.warning || "",
                  jobId: result.jobId || syntheticJobId,
                  jobTitle: result.jobTitle || "",
                  company: result.company || "",
                }),
              );
            } else {
              outcome.failed += 1;
              setEntries((prev) =>
                patchEntry(prev, target.id, {
                  status: "error",
                  error: result?.error || "Tailoring failed.",
                }),
              );
            }
          } catch (err) {
            // One posting's pipeline rejecting outright must never take the
            // others down with it.
            outcome.failed += 1;
            setEntries((prev) =>
              patchEntry(prev, target.id, {
                status: "error",
                error: err?.message || "Tailoring failed.",
              }),
            );
          }
        },
        () => setCompleted((c) => c + 1),
      );
    } finally {
      runningRef.current = false;
      setRunning(false);
      setLastRun({ done: outcome.done, failed: outcome.failed });
    }
  }

  async function submitAll(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    // Checked before anything else touches the queue: a second submit while
    // one is already running must not reset any status or the progress
    // counter (AC-6).
    if (runningRef.current) return;

    onRunRequested?.();

    // Blank is checked before the missing-résumé guard, matching the
    // single-textarea version's own guard order (app/page.js:2622).
    const targets = submittableEntries(entries);
    if (targets.length === 0) {
      setError("Please provide a job posting.");
      return;
    }
    if (!resumeFile) {
      setError("Please upload a resume file.");
      return;
    }

    await runQueue(targets);
  }

  async function retryFailed() {
    if (runningRef.current) return;
    onRunRequested?.();
    const targets = failedEntries(entries);
    if (targets.length === 0) return;
    // A5: submitAll has always guarded a missing résumé; retryFailed didn't.
    // Reachable by re-picking the résumé file and cancelling the dialog
    // between runs -- unguarded, every retried posting would reach the
    // pipeline's own guard and write the same message into the one shared
    // banner while also showing it on its own card.
    if (!resumeFile) {
      setError("Please upload a resume file.");
      return;
    }
    await runQueue(targets);
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
