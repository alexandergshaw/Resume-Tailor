// @vitest-environment jsdom
//
// N92 Wave 2 (Control C) -- AC-C6 (failed / not-yet-loaded resolves SAFE, one
// shared source, no new fetch race) and AC-C5 (turn-off-able) at the HOOK level.
//
// Design (section 4.2, plan W2-S2, LOAD-BEARING): Control C rides the EXACT
// fetch useCoverFactPlacement already issues for the placement default -- the
// hook gains `forward` / `setForward` seeded from the SAME GET response, so the
// settings UI and the insert path can never silently disagree (the N86 hazard
// this must not reintroduce). `forward` is SAFE by default: only an explicit
// loaded `true` enables it; not-yet-loaded, a failed GET, and a non-ok GET all
// resolve to false (D5: never fabricate a positioning the user did not set).
//
// RED ON HEAD (93afb75): the hook returns only `{ placement, setPlacement }` --
// there is no `forward` / `setForward`, so `result.forward` is undefined. Every
// "forward is a boolean" assertion below fails on HEAD by absence. The
// one-fetch-per-mount assertion is a GUARD (green on HEAD -- the hook already
// fetches once) made meaningful by the second-fetch mutant in the notes
// artifact. The load-safe cases are made discriminating by the loaded-true
// control (proves the value is not merely hard-wired false) and by the
// treat-pending-as-on mutant (which reds the pending/failed cases).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import { useCoverFactPlacement } from "./useCoverFactPlacement.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let hookResult = null;
let container = null;
let root = null;
let userPrefsGetCount = 0;
let putBodies = [];

function Probe() {
  hookResult = useCoverFactPlacement();
  return null;
}

// `configure(fetchImpl)` installs the /api/user-prefs behaviour for a test.
function configure(fetchImpl) {
  userPrefsGetCount = 0;
  putBodies = [];
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    if (u.includes("/api/user-prefs")) {
      if (method === "GET") {
        userPrefsGetCount += 1;
        return fetchImpl();
      }
      putBodies.push(init.body ? JSON.parse(init.body) : {});
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

const okPrefs = (prefs) => () => ({ ok: true, json: async () => ({ prefs }) });

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });
  await settle();
}

beforeEach(() => {
  hookResult = null;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete global.fetch;
  vi.restoreAllMocks();
});

describe("AC-C6 default-safe: only an explicit loaded true enables forward", () => {
  it("a loaded coverFactForward:true yields forward === true (CONTROL: proves it is not hard-wired false) (RED on HEAD)", async () => {
    configure(okPrefs({ coverFactForward: true }));
    await mount();
    expect(hookResult.forward, "a loaded coverFactForward:true was not read as forward-on").toBe(true);
  });

  it("a loaded coverFactForward:false yields forward === false (RED on HEAD)", async () => {
    configure(okPrefs({ coverFactForward: false }));
    await mount();
    expect(hookResult.forward, "a loaded false was not read as forward-off").toBe(false);
  });

  it("a not-yet-loaded (never-resolving) GET leaves forward === false, never on (RED on HEAD)", async () => {
    // The pending case: a build that reads pending as 'on' (the N86 unsafe
    // failure) would show true here. Safe is false.
    configure(() => new Promise(() => {}));
    await mount();
    expect(hookResult.forward, "a not-yet-loaded state was read as forward-on -- fabricates a positioning the user never set").toBe(false);
  });

  it("a failed (rejected) GET leaves forward === false (RED on HEAD)", async () => {
    configure(() => Promise.reject(new Error("network")));
    await mount();
    expect(hookResult.forward, "a failed GET was read as forward-on").toBe(false);
  });

  it("a non-ok GET leaves forward === false (RED on HEAD)", async () => {
    configure(() => ({ ok: false, json: async () => ({}) }));
    await mount();
    expect(hookResult.forward, "a non-ok GET was read as forward-on").toBe(false);
  });

  it("a truthy-but-non-boolean stored value does NOT enable forward (only a real true does) (RED on HEAD)", async () => {
    // The route drops non-booleans, but the client must also refuse to read a
    // non-boolean as on -- belt and braces against a stored-string leak.
    configure(okPrefs({ coverFactForward: "true" }));
    await mount();
    expect(hookResult.forward, "a non-boolean stored value was read as forward-on").not.toBe(true);
  });
});

describe("AC-C6 one shared source: forward and placement come from ONE fetch (no new race)", () => {
  it("a single GET seeds BOTH placement and forward (RED on HEAD for forward; placement is the control)", async () => {
    configure(okPrefs({ coverFactPlacement: "why", coverFactForward: true }));
    await mount();
    expect(hookResult.placement, "placement did not seed from the shared GET").toBe("why");
    expect(hookResult.forward, "forward did not seed from the SAME shared GET").toBe(true);
  });

  it("mounting the hook issues exactly ONE /api/user-prefs GET (GUARD: a second fetch would race N86)", async () => {
    // GUARD: green on HEAD (the hook already fetches once). Power comes from the
    // second-fetch mutant in the notes artifact, which makes this 2.
    configure(okPrefs({ coverFactForward: true }));
    await mount();
    expect(userPrefsGetCount, "the hook issued more than one /api/user-prefs GET -- a second source can disagree (N86)").toBe(1);
  });
});

describe("AC-C5 turn-off-able at the hook: setForward persists true then false (RED on HEAD)", () => {
  it("setForward is a function that PUTs the chosen boolean to /api/user-prefs", async () => {
    configure(okPrefs({}));
    await mount();
    expect(typeof hookResult.setForward, "the hook exposes no setForward writer").toBe("function");

    await act(async () => {
      hookResult.setForward(true);
    });
    await settle();
    await act(async () => {
      hookResult.setForward(false);
    });
    await settle();

    const forwardPuts = putBodies.filter((b) => b?.prefs && "coverFactForward" in b.prefs);
    expect(forwardPuts.length, "setForward did not PUT coverFactForward to /api/user-prefs").toBeGreaterThanOrEqual(2);
    expect(forwardPuts[0].prefs.coverFactForward).toBe(true);
    expect(
      forwardPuts[forwardPuts.length - 1].prefs.coverFactForward,
      "setForward(false) did not persist false -- the toggle is one-way (N82)",
    ).toBe(false);
  });
});
