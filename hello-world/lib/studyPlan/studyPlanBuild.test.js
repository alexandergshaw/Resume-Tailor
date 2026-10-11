// N157 SC-C sub-chunk C-c (4b TDD seat) -- the CREATE-TIME lifecycle state
// machine, as a module-scope build store with INJECTED effects (design r2
// section 4.2 "two awaited phases, owned by a module, not a component" and
// section 8 "injected-effects orchestrator test"). Ledger DES-N157-C7, C8, C9,
// and the node half of the preserve-last-good instrument (DES-N157-C10/C21,
// the Layer-2 side).
//
// WHY A MODULE, NOT A COMPONENT. The digest call can run ~90-120s; phones
// background a tab and users switch sub-views, and a component-owned await chain
// dies with the component -- a remount would offer a second "Create" that
// double-bills the 12/10min limiter. The orchestration therefore lives in a
// plain async module whose effects are injected so the ORDERING is node-testable
// without React, jsdom, or the network. The React hook (useStudyPlanBuild) only
// subscribes and calls `run`; that thin seam is exercised in StudyPlanClient.test.js.
//
// THE CONTRACT THIS FILE PINS (greenfield; C-c owns BUILD_INTENTS per the ruling):
//   run({ applicationId, engine, intent, knobs, hadGoodPlan }, effects) -> Promise
//     effects = { ensureDigest, refreshDigest, requestBuild, reload }  (all async)
//   getBuildState(applicationId) -> { phase, error?, preserved? }
//     phase in "idle" | "researching" | "building" | "done" | "failed"
//   resetStudyPlanBuildStore()  test-only
//
// RED on HEAD: lib/studyPlan/studyPlanBuild.js does not exist yet, so the import
// throws and every `it` reds -- the honest greenfield red.
//
// THE MUTANT THIS FILE IS BUILT TO KILL (watched in tests.r1.md): the
// blank-good-plan-on-failed-rebuild mutant -- call effects.reload() on an
// `unavailable` result (e.g. "reload after every outcome"). loadStudyPlanRecord
// replaces the in-memory record wholesale, so reloading after a preserved/
// unavailable rebuild blanks the good plan on screen. The "reload NOT called on
// unavailable" assertions below red when that mutant lands.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { getBuildState, run, resetStudyPlanBuildStore } from "@/lib/studyPlan/studyPlanBuild.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const KNOBS = { strengths: ["systems"], weakAreas: ["sql"] };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Build an effects bundle of spies. Each resolver defaults to the happy value
// and is overridable per test.
function makeEffects(overrides = {}) {
  return {
    ensureDigest: vi.fn(async () => ({ status: "ready" })),
    refreshDigest: vi.fn(async () => ({ status: "ready" })),
    requestBuild: vi.fn(async () => ({ status: "ready", partial: false, reason: null })),
    reload: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  resetStudyPlanBuildStore();
});

describe("Two awaited phases, in order (phase 2 never starts before phase 1 resolves)", () => {
  it("gemini create: researches first, and requestBuild fires ONLY after the digest resolves ready", async () => {
    const gate = deferred();
    const effects = makeEffects({ ensureDigest: vi.fn(() => gate.promise) });

    const p = run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS, hadGoodPlan: false }, effects);

    // Synchronously into the first await: research is running, phase 2 has NOT started.
    expect(effects.ensureDigest).toHaveBeenCalledTimes(1);
    expect(effects.requestBuild).toHaveBeenCalledTimes(0);
    expect(getBuildState(APP_ID).phase).toBe("researching");

    gate.resolve({ status: "ready" });
    await p;

    expect(effects.requestBuild).toHaveBeenCalledTimes(1);
    expect(effects.reload).toHaveBeenCalledTimes(1);
    expect(getBuildState(APP_ID).phase).toBe("done");
  });

  it("the status walks researching -> building -> done (what the single live region reads)", async () => {
    const seen = [];
    const buildGate = deferred();
    const effects = makeEffects({
      requestBuild: vi.fn(async () => {
        seen.push(getBuildState(APP_ID).phase);
        return buildGate.promise;
      }),
    });
    const p = run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS }, effects);
    // requestBuild saw "building" at its call time; before it, phase was researching.
    buildGate.resolve({ status: "ready", partial: false, reason: null });
    await p;
    expect(seen).toEqual(["building"]);
    expect(getBuildState(APP_ID).phase).toBe("done");
  });
});

describe("Phase 1 is SKIPPED where it can only fail or is unneeded (F4, D-2)", () => {
  it("engine=embedded skips research entirely and goes straight to requestBuild", async () => {
    const effects = makeEffects();
    await run({ applicationId: APP_ID, engine: "embedded", intent: "create", knobs: KNOBS }, effects);
    expect(effects.ensureDigest).toHaveBeenCalledTimes(0);
    expect(effects.refreshDigest).toHaveBeenCalledTimes(0);
    expect(effects.requestBuild).toHaveBeenCalledTimes(1);
  });

  it('a plain "rebuild" skips research (the stored digest is unchanged, so it spends nothing)', async () => {
    const effects = makeEffects();
    await run({ applicationId: APP_ID, engine: "gemini", intent: "rebuild", knobs: KNOBS }, effects);
    expect(effects.ensureDigest).toHaveBeenCalledTimes(0);
    expect(effects.refreshDigest).toHaveBeenCalledTimes(0);
    expect(effects.requestBuild).toHaveBeenCalledTimes(1);
  });

  it('a "general" plan skips research', async () => {
    const effects = makeEffects();
    await run({ applicationId: APP_ID, engine: "gemini", intent: "general", knobs: KNOBS }, effects);
    expect(effects.ensureDigest).toHaveBeenCalledTimes(0);
    expect(effects.requestBuild).toHaveBeenCalledTimes(1);
  });
});

describe("The refresh/research intents pick the right digest call (only refresh spends a fresh search)", () => {
  it('"research-rebuild" calls ensureDigest (force:false path), NOT refreshDigest', async () => {
    const effects = makeEffects();
    await run({ applicationId: APP_ID, engine: "gemini", intent: "research-rebuild", knobs: KNOBS }, effects);
    expect(effects.ensureDigest).toHaveBeenCalledTimes(1);
    expect(effects.refreshDigest).toHaveBeenCalledTimes(0);
  });

  it('"refresh-rebuild" calls refreshDigest (the ONLY fresh grounded spend), NOT ensureDigest', async () => {
    const effects = makeEffects();
    await run({ applicationId: APP_ID, engine: "gemini", intent: "refresh-rebuild", knobs: KNOBS }, effects);
    expect(effects.refreshDigest).toHaveBeenCalledTimes(1);
    expect(effects.ensureDigest).toHaveBeenCalledTimes(0);
  });
});

describe("Phase 1 branches on digest.status, not only on a throw (F4: HTTP 200 + failed)", () => {
  it("a digest that resolves status:failed is surfaced as a failure; phase 2 never runs", async () => {
    const effects = makeEffects({ ensureDigest: vi.fn(async () => ({ status: "failed", error: "No public info found." })) });
    await run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS }, effects);
    expect(effects.requestBuild).toHaveBeenCalledTimes(0);
    const state = getBuildState(APP_ID);
    expect(state.phase).toBe("failed");
    expect(state.error).toContain("No public info found.");
  });

  it("a digest that THROWS fails too, and phase 2 never runs", async () => {
    const effects = makeEffects({ ensureDigest: vi.fn(async () => { throw new Error("network down"); }) });
    await run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS }, effects);
    expect(effects.requestBuild).toHaveBeenCalledTimes(0);
    expect(getBuildState(APP_ID).phase).toBe("failed");
  });
});

describe("Every build sends the stored knobs on the phase-2 request (F3: an omitted knobs resets customization)", () => {
  it("requestBuild receives { applicationId, engine, knobs } with the knobs passed to run", async () => {
    const effects = makeEffects();
    await run({ applicationId: APP_ID, engine: "gemini", intent: "rebuild", knobs: KNOBS }, effects);
    const [args] = effects.requestBuild.mock.calls[0];
    expect(args.applicationId).toBe(APP_ID);
    expect(args.engine).toBe("gemini");
    // The mutant this kills: requestBuild called with knobs omitted/undefined,
    // which the route turns into DEFAULT_KNOBS -- silently wiping SC-D's choices.
    expect(args.knobs).toEqual(KNOBS);
  });
});

describe("Preserve-last-good, the orchestration half (never blank a good plan on a failed rebuild)", () => {
  it("an unavailable + preserved:true result does NOT reload; it surfaces the failure as preserved", async () => {
    const effects = makeEffects({
      requestBuild: vi.fn(async () => ({
        status: "unavailable",
        partial: false,
        preserved: true,
        preservedReason: "good-plan",
        error: "The study plan could not be built.",
      })),
    });
    await run({ applicationId: APP_ID, engine: "gemini", intent: "rebuild", knobs: KNOBS, hadGoodPlan: true }, effects);

    // THE blank-good-plan guard: reload() replaces the in-memory record
    // wholesale, so calling it here would blank the plan the guard protects.
    expect(effects.reload).toHaveBeenCalledTimes(0);
    const state = getBuildState(APP_ID);
    expect(state.phase).toBe("failed");
    expect(state.preserved).toBe(true);
  });

  it("an unavailable result with NO preserve flag also does not reload (nothing good to show), and fails", async () => {
    const effects = makeEffects({
      requestBuild: vi.fn(async () => ({ status: "unavailable", partial: false, error: "The study plan could not be built." })),
    });
    await run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS, hadGoodPlan: false }, effects);
    expect(effects.reload).toHaveBeenCalledTimes(0);
    expect(getBuildState(APP_ID).phase).toBe("failed");
  });

  it("a ready/partial result DOES reload (the record must refresh to the new plan) -- the positive control", async () => {
    // Without this, "reload is never called" would pass a build that never
    // shows the finished plan. reload fires exactly on the success branch.
    const effects = makeEffects({ requestBuild: vi.fn(async () => ({ status: "partial", partial: true, reason: "unsourced" })) });
    await run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS }, effects);
    expect(effects.reload).toHaveBeenCalledTimes(1);
    expect(getBuildState(APP_ID).phase).toBe("done");
  });
});

describe("A second run for the same application while one is in flight is a no-op (R10: double-bill guard)", () => {
  it("two overlapping run() calls fire the effects ONCE", async () => {
    const gate = deferred();
    const effects = makeEffects({ ensureDigest: vi.fn(() => gate.promise) });

    const first = run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS }, effects);
    // Second call lands while the first is awaiting research.
    const second = run({ applicationId: APP_ID, engine: "gemini", intent: "create", knobs: KNOBS }, effects);

    gate.resolve({ status: "ready" });
    await Promise.all([first, second]);

    expect(effects.ensureDigest).toHaveBeenCalledTimes(1);
    expect(effects.requestBuild).toHaveBeenCalledTimes(1);
  });

  it("after a run settles, a fresh run for the same application is allowed again (the guard is not sticky)", async () => {
    const effects = makeEffects();
    await run({ applicationId: APP_ID, engine: "embedded", intent: "rebuild", knobs: KNOBS }, effects);
    await run({ applicationId: APP_ID, engine: "embedded", intent: "rebuild", knobs: KNOBS }, effects);
    expect(effects.requestBuild).toHaveBeenCalledTimes(2);
  });
});
