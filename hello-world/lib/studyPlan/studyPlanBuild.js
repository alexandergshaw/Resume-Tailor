// N157 SC-C: the CREATE-TIME lifecycle of a study plan, as a module-scope
// per-application build store with INJECTED effects (design r2 section 4.2).
//
// WHY A MODULE AND NOT A COMPONENT. The research call can run ~90-120 seconds;
// phones background a tab and users switch sub-views, and a component-owned
// await chain dies with the component, after which a remount would offer a second
// "Create" that double-bills the 12-per-10-minutes limiter. The orchestration is a
// plain async function here, its effects are passed in (so the ORDERING is
// node-testable without React or the network), and a hook only subscribes to the
// state and calls `run`. A per-application in-flight guard, checked synchronously,
// makes a second `run` for the same application a no-op.
//
// THE TWO PHASES, in order. Phase 2 never starts before phase 1 has resolved:
//   1. research  -- ensureDigest (force:false: reuse a ready digest, research only
//                   a missing or failed one) or, for "refresh-rebuild" only,
//                   refreshDigest (force:true, the one path that spends a fresh
//                   grounded search). SKIPPED for the embedded engine (the digest
//                   route refuses it with a 503 before it even reads the cache)
//                   and for the "rebuild" / "general" intents (the stored digest is
//                   unchanged, so a rebuild spends nothing on research).
//                   The digest route answers a failed research with HTTP 200 and
//                   `digest.status === "failed"`, so the result is branched on, not
//                   only a throw.
//   2. build     -- requestBuild, with the STORED knobs (an omitted knobs resets the
//                   learner's customization server-side).
//
// PRESERVE-LAST-GOOD, the orchestration half. Only a ready/partial result
// reloads the record. loadStudyPlanRecord replaces the in-memory record wholesale,
// so reloading after an unavailable result would blank a good plan on screen when
// the read happens to fail; the server's own guard (studyPlanGenerate.js) is what
// keeps the stored row, and the display rule in the hook keeps the screen. A failed
// run says whether the previous plan is untouched (`preserved`): true when the
// server reports it withheld the write, and true for a failure that happened before
// any plan write could (research failed, a transport or HTTP error) when the caller
// had a good plan.
//
// Nothing runs at import: only empty collections are constructed here.

import { STUDY_COPY } from "./studyPlanCopy.js";
import { fillStudyCopy } from "./studyPlanNotices.js";

/**
 * The intents `run` accepts. The shell names them from here; the overview and
 * the banner (which are presentational and import nothing from this module)
 * emit the same strings, and an unrecognised one is refused by `run`.
 */
export const BUILD_INTENTS = Object.freeze({
  CREATE: "create",
  REBUILD: "rebuild",
  RESEARCH_REBUILD: "research-rebuild",
  REFRESH_REBUILD: "refresh-rebuild",
  GENERAL: "general",
});

const KNOWN_INTENTS = new Set(Object.values(BUILD_INTENTS));

// Intents that go straight to phase 2: the stored digest is unchanged (a plain
// rebuild) or deliberately not wanted (a general plan).
const SKIP_RESEARCH_INTENTS = new Set([BUILD_INTENTS.REBUILD, BUILD_INTENTS.GENERAL]);

const IDLE_STATE = Object.freeze({ phase: "idle", kind: null, error: null, preserved: false, intent: null });

// applicationId -> the frozen state of its latest run.
const states = new Map();
// Applications with a run in flight. Checked synchronously, before any await.
const inFlight = new Set();
const listeners = new Set();

// useSyncExternalStore needs a referentially stable snapshot that changes only
// on a write.
let version = 0;
let snapshot = { version: 0 };

function notify() {
  version += 1;
  snapshot = { version };
  for (const listener of [...listeners]) listener();
}

function setState(applicationId, next) {
  states.set(applicationId, Object.freeze({ ...IDLE_STATE, ...next }));
  notify();
}

/** Subscribe to state writes. Returns the unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A referentially stable value that changes only when a state does. */
export function getSnapshot() {
  return snapshot;
}

/**
 * The state of one application's latest run: `{ phase, kind, error, preserved,
 * intent }`. `phase` is "idle" | "researching" | "building" | "done" | "failed".
 * `error` is the user-facing message and `kind` is its cause ("research-failed",
 * "research-error", "build-error", "needs-research", "unavailable"). Never null.
 */
export function getBuildState(applicationId) {
  return states.get(applicationId) ?? IDLE_STATE;
}

/** Whether a run for this engine and intent goes straight to phase 2. */
export function skipsResearch(engine, intent) {
  return engine === "embedded" || SKIP_RESEARCH_INTENTS.has(intent);
}

function messageOf(err) {
  return typeof err?.message === "string" && err.message !== "" ? err.message : STUDY_COPY.failure.unavailable;
}

async function execute({ applicationId, engine, intent, knobs, hadGoodPlan }, effects) {
  const keptPlan = hadGoodPlan === true;
  const fail = (kind, error, preserved) =>
    setState(applicationId, { phase: "failed", kind, error, preserved, intent });

  if (!KNOWN_INTENTS.has(intent)) {
    fail("unavailable", STUDY_COPY.failure.unavailable, keptPlan);
    return;
  }

  try {
    if (!skipsResearch(engine, intent)) {
      setState(applicationId, { phase: "researching", intent });
      let digest;
      try {
        const research = intent === BUILD_INTENTS.REFRESH_REBUILD ? effects.refreshDigest : effects.ensureDigest;
        digest = await research({ applicationId, engine });
      } catch (err) {
        fail("research-error", messageOf(err), keptPlan);
        return;
      }
      if (digest?.status !== "ready") {
        const detail = typeof digest?.error === "string" && digest.error !== "" ? digest.error : "Please try again.";
        fail("research-failed", fillStudyCopy(STUDY_COPY.failure.researchFailed, { error: detail }), keptPlan);
        return;
      }
    }

    setState(applicationId, { phase: "building", intent });
    let result;
    try {
      result = await effects.requestBuild({ applicationId, engine, knobs });
    } catch (err) {
      fail("build-error", messageOf(err), keptPlan);
      return;
    }

    if (result?.status === "ready" || result?.status === "partial") {
      await effects.reload();
      setState(applicationId, { phase: "done", intent });
      return;
    }

    // Unavailable (or an unrecognised status): never reload, see the header.
    if (engine === "embedded" && result?.reason === "no-research") {
      fail("needs-research", STUDY_COPY.failure.embeddedNeedsResearch, result?.preserved === true);
      return;
    }
    const error = typeof result?.error === "string" && result.error !== "" ? result.error : STUDY_COPY.failure.unavailable;
    fail("unavailable", error, result?.preserved === true);
  } catch (err) {
    // Only a failing reload (or a missing effect) can land here: the plan was
    // built, so nothing was preserved by this run.
    fail("build-error", messageOf(err), false);
  }
}

/**
 * Runs one build for an application and records its progress in the store.
 *
 * `effects` is `{ ensureDigest, refreshDigest, requestBuild, reload }`, all
 * async. The function never rejects: every failure is a "failed" state. A second
 * call for an application whose run has not settled returns at once.
 *
 * @param {{ applicationId: string, engine: string, intent: string, knobs?: object, hadGoodPlan?: boolean }} args
 * @param {{ ensureDigest: Function, refreshDigest: Function, requestBuild: Function, reload: Function }} effects
 */
export async function run(args, effects) {
  const applicationId = args?.applicationId;
  if (typeof applicationId !== "string" || applicationId === "" || inFlight.has(applicationId)) return;
  inFlight.add(applicationId);
  try {
    await execute(args, effects);
  } finally {
    inFlight.delete(applicationId);
  }
}

/** Test-only. Never called from application code. */
export function resetStudyPlanBuildStore() {
  states.clear();
  inFlight.clear();
  notify();
}
