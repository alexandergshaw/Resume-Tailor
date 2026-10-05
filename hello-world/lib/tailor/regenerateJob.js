// N104 - the per-job controller behind the Regenerate button: the in-flight guard,
// the atomic apply and the one-level Undo, kept OUTSIDE the component tree.
//
// A regenerate takes many seconds and the review strip that holds the button is
// keyed by job and tab, so it remounts on a tab switch or a reopened dialog. A flag
// kept in the strip would be lost with it, and a late result could land over a
// different document. So the state lives here, in one controller the preview mount
// holds for as long as the app runs, keyed by job id.
//
//   const jobs = createRegenerateJobs({ submit })
//   jobs.start(jobId, { request, snapshot }, { onReplace, onFail }) -> Promise<boolean>
//   jobs.running(jobId)                    -> boolean
//   jobs.undo(jobId, { onRestore })        -> boolean
//   jobs.hasUndo(jobId)                    -> boolean
//   jobs.subscribe(listener) / jobs.version()   for useSyncExternalStore
//
//   submit(request)   the one network call; resolves the result or rejects
//   snapshot          whatever the caller needs to put the document back, opaque here
//
// Guard: `start` marks the job running synchronously, before any await, so two clicks
// in one tick start ONE run; a second `start` for a running job does nothing.
// Atomic: a rejected submit calls onFail and nothing else - onReplace is never
// called and no Undo is armed, so a failed run changes nothing. Routing: each run's
// callbacks carry the jobId it was started for, so a result that lands after the
// user moved to another job is delivered to its own job and never another's.
// Undo: armed only after a result was applied (onReplace returning exactly `false`
// means "nothing was replaced" and arms nothing), holds the LATEST pre-run snapshot
// only, and is withdrawn the moment it is used, so it cannot revert twice.

export function createRegenerateJobs({ submit } = {}) {
  const inFlight = new Set();
  const snapshots = new Map();
  const listeners = new Set();
  let version = 0;

  function changed() {
    version += 1;
    listeners.forEach((listener) => listener());
  }

  async function start(jobId, { request, snapshot } = {}, { onReplace, onFail } = {}) {
    if (inFlight.has(jobId)) return false;
    inFlight.add(jobId);
    changed();
    let applied = false;
    try {
      const result = await submit(request);
      const replaced = onReplace?.(jobId, result);
      if (replaced !== false) snapshots.set(jobId, snapshot);
      applied = true;
    } catch (error) {
      onFail?.(jobId, error);
    } finally {
      inFlight.delete(jobId);
      changed();
    }
    return applied;
  }

  function undo(jobId, { onRestore } = {}) {
    if (!snapshots.has(jobId)) return false;
    const snapshot = snapshots.get(jobId);
    // Withdrawn before it runs, so a second activation cannot restore twice.
    snapshots.delete(jobId);
    changed();
    onRestore?.(jobId, snapshot);
    return true;
  }

  return {
    start,
    undo,
    running: (jobId) => inFlight.has(jobId),
    hasUndo: (jobId) => snapshots.has(jobId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}
