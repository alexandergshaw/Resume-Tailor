// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// B-1 (N50 fix round 6, verify.r6.md) -- the invariant's own blocker: a
// failed or timed-out GET used to route into AppViewDialog.js's bare
// FieldError branch, which never rendered PrepPackPanel at all -- so the
// zero-control dead end the round-4 invariant exists to abolish was
// RELOCATED there, not closed, and structurally invisible to
// PrepPackPanel.controlInvariant.test.js (that file can only ever render
// PrepPackPanel directly; a state where AppViewDialog never reaches it is
// outside what it can see).
//
// This file mounts the REAL AppViewDialog -- never the panel alone -- for
// every read-failure shape the ruling names: a hung refetch past its own
// bound (ZP1), a first-open GET that fails outright (ZP2), and a row a later
// read can no longer find, e.g. deleted in another tab (ZP3), plus a first-
// open 500 (the shape dbFailureResponse actually returns). It is deliberately
// NOT a full replay of PrepPackPanel.controlInvariant.test.js's own 130-case
// cross-product: that sweep already proves the panel's OWN prop-driven logic
// has no zero-control state, and every one of its props is reachable through
// AppViewDialog's ordinary rendering once the panel actually mounts -- this
// file's job is narrower and different: proving the DIALOG'S OWN routing
// never again keeps the panel from mounting at all. The sweep below crosses
// every real `status` value the route can return with a first-open read
// failure, through the real dialog, which is exactly the seam
// PrepPackPanel.controlInvariant.test.js cannot reach.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "../AppViewDialog.js";
import { maximalGetResponse } from "@/test/helpers/prepMaximalFixture.js";
import { norm } from "@/test/helpers/prepPanelInstruments.js";
import {
  freshAppId,
  dialogProps,
  jsonResponse,
  click,
  wholePackRegenerateControl,
  sectionRegenerateControl,
  runningPrepGetBody,
  checkAgainControl,
  forwardControls,
  controlNamed,
} from "@/test/helpers/prepDialogHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAST_TIMEOUT_MS = 175_000;
// AppViewDialog.js's own PREP_FETCH_TIMEOUT_MS -- a plain literal here,
// mirroring this suite's existing PAST_TIMEOUT_MS discipline (that file's own
// export sweep pins the queue's default the same way; the bare `fetchPrep`
// export is deliberately not that constant itself).
const PAST_READ_TIMEOUT_MS = 25_000;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    // already unmounted by the case itself
  }
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(id) {
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id))));
  await advance(0);
}

async function reopen(id) {
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: false }))));
  await advance(0);
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: true }))));
  await advance(0);
}

describe("ZP1 -- a whole-pack POST settles, its own refetch GET never answers", () => {
  it("offers a forward control once the bounded fetch gives up, keeps it after 15 simulated minutes, and after a close+reopen", async () => {
    vi.useFakeTimers();
    const id = freshAppId("zp1");
    let getCount = 0;
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        getCount += 1;
        if (getCount === 1) return Promise.resolve(jsonResponse(maximalGetResponse()));
        // every GET after the mount's own: a stalled connection that never
        // answers on its own -- the settled handler's refetch, and every
        // GET a close+reopen issues after it, alike.
        return new Promise((resolve, reject) => {
          if (!init?.signal) return;
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return Promise.resolve(jsonResponse({ status: "ready" }));
    });
    vi.stubGlobal("fetch", f);
    await mount(id);

    await click(wholePackRegenerateControl());
    await advance(0);
    await advance(PAST_READ_TIMEOUT_MS);

    expect(document.body.textContent).toContain("Could not load your prep pack.");
    expect(forwardControls().length, "a failed read must never leave zero forward controls").toBeGreaterThan(0);
    // the cache is not merely present in the DOM somewhere -- it is what the
    // candidate can actually still read.
    expect(document.body.textContent, "the cached pack must not vanish behind the error").toContain(
      "I lead frontend platform work",
    );
    // N50 fix round 7 (verify.r7.md minor m-3) -- NOT applied; see
    // PrepPackPanel.js's own `GenerateControl` header for why the destructive
    // whole-pack control could not be gated off here without breaking this
    // suite's own landed PH1 (AppViewDialog.prepTimeout.test.js). The
    // non-destructive controls this ruling also names stay offered
    // regardless, which is worth pinning on its own.
    expect(sectionRegenerateControl("aboutYou"), "a non-destructive section control must stay offered").toBeTruthy();
    expect(checkAgainControl(), "the non-destructive escape hatch must stay offered").toBeTruthy();

    await advance(15 * 60 * 1000);
    expect(forwardControls().length, "a control must survive 15 simulated minutes of continued failure").toBeGreaterThan(0);

    await reopen(id);
    expect(forwardControls().length, "a control must survive a close+reopen while the read keeps failing").toBeGreaterThan(0);
  });
});

describe("ZP2 -- the very first GET this session issues fails outright", () => {
  it("a rejected fetch on first open still offers a forward control, and Check again recovers once the read succeeds", async () => {
    vi.useFakeTimers();
    const id = freshAppId("zp2");
    let succeed = false;
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        if (succeed) return Promise.resolve(jsonResponse(maximalGetResponse({ candidateName: "Recovered Candidate" })));
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(jsonResponse({ status: "disabled" }));
    });
    vi.stubGlobal("fetch", f);
    await mount(id);

    expect(document.body.textContent).toContain("Could not load your prep pack.");
    expect(forwardControls().length, "a first-open read failure must never leave zero forward controls").toBeGreaterThan(0);
    const control = checkAgainControl();
    expect(control, "Check again must be offered -- there is no cache yet, so it is the only sane recovery path").toBeTruthy();

    succeed = true;
    await click(control);
    await advance(0);

    expect(document.body.textContent, "a successful retry must show the real content").toContain("Recovered Candidate");
  });
});

describe("ZP3 -- a row this session can no longer find (deleted in another tab)", () => {
  it("a 404-shaped {error} body with no status still offers a forward control", async () => {
    vi.useFakeTimers();
    const id = freshAppId("zp3");
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        return Promise.resolve(jsonResponse({ error: "Application not found." }, 404));
      }
      return Promise.resolve(jsonResponse({ status: "disabled" }));
    });
    vi.stubGlobal("fetch", f);
    await mount(id);

    expect(document.body.textContent).toContain("Application not found.");
    expect(forwardControls().length, "a deleted-row read must never leave zero forward controls").toBeGreaterThan(0);
  });
});

describe("a 500 on first open (dbFailureResponse's own real shape)", () => {
  it("still offers a forward control", async () => {
    vi.useFakeTimers();
    const id = freshAppId("zp500");
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        return Promise.resolve(jsonResponse({ error: "Could not load this application's prep pack." }, 500));
      }
      return Promise.resolve(jsonResponse({ status: "disabled" }));
    });
    vi.stubGlobal("fetch", f);
    await mount(id);

    expect(forwardControls().length, "a server-error read must never leave zero forward controls").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The dialog-level sweep itself: every real `status` value the route can
// return, first-open, through the real dialog -- the seam
// PrepPackPanel.controlInvariant.test.js's own header explains it cannot
// reach (it can only ever render the panel directly) -- crossed with the
// read-failure axis this file exists for.
// ---------------------------------------------------------------------------

const STATUS_CASES = [
  ["ready", () => maximalGetResponse({ status: "ready" })],
  ["running", () => runningPrepGetBody()],
  ["failed", () => maximalGetResponse({ status: "failed" })],
  ["partial", () => maximalGetResponse({ status: "partial", completeSections: ["aboutYou"] })],
  ["unavailable", () => maximalGetResponse({ status: "unavailable" })],
  ["absent (no pack yet)", () => maximalGetResponse({ pack: null, status: null, completeSections: [] })],
  ["read error (network reject)", null],
  ["read error (404, deleted row)", () => ({ error: "Application not found." })],
  // N50 final polish (verify.r8.md minor m-2): a literal JSON `null` body --
  // `res.json()` resolving to `null` rather than rejecting or throwing, which
  // an empty/non-JSON body would. AppViewDialog.js's own `fetchPrep` used to
  // write this straight into `prepById` unexamined, leaving `dPrep` falsy and
  // the dialog stuck on its `!dPrep` spinner branch forever -- zero controls,
  // no Check again, no way out. See AppViewDialog.js's own `fetchPrep` header.
  ["read error (null body)", () => null],
];

/** Shared by both sweeps below -- the original (hasDescription:true) and the
 *  N50 fix round 7 (verify.r7.md minor m-4) addition (hasDescription:false).
 *  One implementation, so the two sweeps can never quietly drift apart.
 *
 *  N50 fix round 7 (verify.r7.md minor m-2): also checks `checkAgainControl`
 *  specifically for every read-failure row, not merely `forwardControls()`.
 *  `forwardControls().length > 0` alone is satisfied by GenerateControl's OWN
 *  "Prepare me…"/"Add a job description" button on every read-failure row
 *  (no pack exists yet, so that button renders regardless of
 *  `showCheckAgain`) -- so the ORIGINAL sweep was blind to `showCheckAgain`
 *  itself, and a mutant reverting it to `actionState === "in-flight"` only
 *  died to one unrelated case elsewhere in the suite. */
async function runStatusSweep({ hasDescription = true } = {}) {
  const offenders = [];
  for (const [label, build] of STATUS_CASES) {
    vi.useFakeTimers();
    const id = freshAppId(`sweep-${hasDescription ? "" : "nodesc-"}${label.replace(/[^a-z0-9]+/gi, "")}`);
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        if (!build) return Promise.reject(new Error("network error"));
        return Promise.resolve(jsonResponse(build()));
      }
      return Promise.resolve(jsonResponse({ status: "disabled" }));
    });
    vi.stubGlobal("fetch", f);
    await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { hasDescription }))));
    await advance(0);
    if (forwardControls().length === 0) offenders.push(label);
    if (label.startsWith("read error") && !checkAgainControl()) offenders.push(`${label} (no Check again)`);
    await act(async () => root.unmount());
    root = createRoot(container);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
  return offenders;
}

describe("INVARIANT, dialog level (N50 fix round 6, verify.r6.md B-1) -- every real status value, plus every read-failure shape, through the real dialog", () => {
  it(`renders ${STATUS_CASES.length} first-open combinations and offers at least one forward control (and Check again, on a read failure) in every one`, async () => {
    const offenders = await runStatusSweep();
    expect(offenders, `zero-control (or missing Check again) status values: ${offenders.join(" | ")}`).toEqual([]);
  });
});

// N50 fix round 7 (verify.r7.md minor m-4): the sweep above never varied
// `hasDescription` -- `prepDialogHarness.js`'s own `appRow` gives every row a
// description by default, so all of these combinations ran with
// `hasDescription: true` only. This re-runs the identical sweep with no job
// description, so the count above is not read as covering more than it does.
describe("INVARIANT, dialog level, hasDescription:false (N50 fix round 7, verify.r7.md minor m-4)", () => {
  it(`renders the same ${STATUS_CASES.length} combinations with no job description and offers at least one forward control (and Check again, on a read failure) in every one`, async () => {
    const offenders = await runStatusSweep({ hasDescription: false });
    expect(offenders, `zero-control (or missing Check again) status values, no description: ${offenders.join(" | ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M-1 (N50 fix round 7, verify.r7.md) -- the sweep above enumerates the
// ROUTE's own status values, all through the one dialog branch that reaches
// PrepPackPanel at all (`dPrep` truthy). It cannot see the ONE branch that
// still kept the panel from mounting: `!dApp?.id` (AppViewDialog.js, the
// "prep" render branch), reachable the instant the row itself leaves
// `applicationData` while this dialog stays open. verify.r7.md's own probe
// (PR-D) measured that branch offering a spinner, forever, with zero controls
// other than the dialog's own generic Previous/Next/Close.
// ---------------------------------------------------------------------------

describe("DIALOG BRANCH (N50 fix round 7, verify.r7.md M-1) -- the row itself disappears while the prep dialog stays open", () => {
  it("no longer spins forever with nothing to explain it", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1rowgone");
    const f = vi.fn(() => Promise.resolve(jsonResponse(maximalGetResponse())));
    vi.stubGlobal("fetch", f);
    await act(async () => root.render(createElement(AppViewDialog, dialogProps(id))));
    await advance(0);
    // positive control: before the row disappears, the panel is fully
    // mounted with real controls -- the instrument is discriminating.
    expect(forwardControls().length, "positive control before the row disappears").toBeGreaterThan(0);

    await act(async () => root.render(createElement(AppViewDialog, { ...dialogProps(id), applicationData: [] })));
    await advance(0);

    expect(document.body.textContent, "the branch must say why nothing is showing").toMatch(/no longer available/i);

    // N50 final polish (verify.r8.md minor m-4): the text alone does not
    // prove there is any way out of this branch. Pin the sole exit -- the
    // dialog's own Close, in DialogActions, outside this branch entirely --
    // and that Previous/Next (which offer no real destination once `pages`
    // empties with `dApp`) are disabled rather than silently inert.
    const closeControl = controlNamed(/^close$/i);
    expect(closeControl, "the branch's only exit must be the dialog's own Close").toBeTruthy();
    expect(closeControl.disabled, "Close must stay enabled").toBe(false);
    const previousControl = controlNamed(/^previous$/i);
    const nextControl = controlNamed(/^next$/i);
    expect(previousControl?.disabled, "Previous must be disabled once the row is gone").toBe(true);
    expect(nextControl?.disabled, "Next must be disabled once the row is gone").toBe(true);
  });
});
