// @vitest-environment jsdom
//
// AC-N29.12 -- THE reachability test for N29's manual "prepare me for this
// interview" control. Per plan.r1.md §3.2/§0.5: mounting AppViewDialog for
// the first time is a 9-prop, low-cost mount (every prop is a plain value,
// an empty object/Set, or a vi.fn() stub -- TrackingTab.prepEntryPoint.test.js's
// own APP fixture, :60-73, already supplies a shape that satisfies
// `applicationData`), NOT the "expensive new harness" a naive reading of
// design-structure.r1.md §3 would suggest.
//
// THIS TEST DOES NOT CALL handleGenerateNow OR onGenerateNow DIRECTLY --
// per AC-N29.12's own bar, a test asserting the control's presence, or
// calling whatever function backs its onClick directly, does NOT satisfy
// reachability. It drives the REAL rendered DOM button with a real `click`
// MouseEvent and asserts a real network request results, following
// TrackingTab.prepEntryPoint.test.js's own click idiom (":168,193" --
// "driven through the UI, not a setter call") and PrepPackPanel.test.js's
// own querySelector("button") + dispatchEvent idiom.
//
// WHY THIS BAR: this repo has already shipped this exact class of defect
// TWICE on this surface, past the entire ~14,000-test suite, because every
// existing test called the mechanism directly instead of the wire: N33's
// own re-verification (<scratchpad>/chunks/N33/verify.r2.md §7, mutant M2)
// found that renaming AppViewDialog.js:285's onSaveNames prop -- the ONLY
// thing connecting the names-panel's Save button to its handler -- survived
// the entire suite, exit 0. This file's own mutant-kill step (performed
// this round against an isolated scratchpad reference implementation, never
// against this repo's working tree, per this repo's own standing
// instrument-destination rule) reproduces that exact class of check for the
// NEW onGenerateNow wire, and is reported separately in this round's
// hand-off notes rather than committed here as a permanent, executed step
// (a committed test file cannot itself "watch a mutant fail" on every
// future run -- that is what this round's report attests to instead).
//
// RED ON HEAD: `<AppViewDialog>` renders no button whose accessible text
// matches /prepare me for this interview/i anywhere in its "prep" page --
// PrepPackPanel.js's meta-actions row today holds only "Download prep log"
// (confirmed by direct read this round, PrepPackPanel.js:313-317). Every
// case below fails because the control simply does not exist yet, not
// because of a fixture defect.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "./AppViewDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

// Reuses TrackingTab.prepEntryPoint.test.js:60-73's exact APP shape (plan.r1.md
// §3.2 item 2) -- a positions.description IS present, so `hasDescription` is
// true and the button is expected to render.
const APP = {
  id: "app-1",
  status: "applied",
  applied_at: "2026-01-05T00:00:00.000Z",
  application_url: null,
  positions: {
    id: "pos-1",
    company: "Stripe",
    title: "Frontend Engineer",
    url: null,
    description: "Build payment surfaces.",
  },
  generated_resumes: null,
};

const ABSENT_GET_RESPONSE = {
  pack: null,
  status: null,
  attemptsExhausted: false,
  completeSections: [],
  events: [],
  candidateName: null,
  interviewerNames: [],
  error: null,
};

function baseProps(overrides = {}) {
  return {
    appDialog: { open: true, rowIndex: 0, kind: "prep" },
    setAppDialog: vi.fn(),
    applicationData: [APP],
    communicationsDialog: { open: false, items: [] },
    loadCommunicationsForApp: vi.fn(),
    openAddCommunicationDialog: vi.fn(),
    digestsById: {},
    researchingIds: new Set(),
    researchOne: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(AppViewDialog, props));
  });
}

// A macrotask-based flush, not the bare `await act(async () => {})` idiom
// several sibling files use: the GET effect below chains fetch().then(res
// => res.json()).then(data => setState(...)) -- three microtask hops past
// the initial mount, one more than a single `await` chain needs, and a
// zero-delay `setTimeout` yields the whole microtask queue on every pass
// rather than gambling on how many bare `act` calls happen to be enough.
async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function accessibleText(node) {
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

// MUI's <Dialog> renders its content through a Portal onto `document.body`,
// NOT into the `container` node `root` is mounted on -- confirmed this
// round (a first empty-container failure led straight to it). Every DOM
// query below therefore reads `document.body`, with an explicit assertion
// that the two are NOT the same node (the tripwire this repo's own trap
// notes name: "assert document.body.textContent === container.textContent
// as an explicit check" -- here inverted, since a Dialog's content is
// asserted to NOT equal the empty container, proving the portal is real
// and this file is reading the right tree).
function findButton(pattern) {
  return Array.from(document.body.querySelectorAll('button, [role="button"]')).find((node) =>
    pattern.test(accessibleText(node)),
  );
}

function click(node) {
  return act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("AC-N29.12 -- clicking the REAL rendered button issues a REAL POST", () => {
  it("mounts, resolves the initial GET (absent state), clicks the real DOM button, and issues exactly one POST /api/interview-prep with {applicationId, triggerClass}", async () => {
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (!init || init.method === undefined) return Promise.resolve(jsonResponse(ABSENT_GET_RESPONSE));
      return Promise.resolve(jsonResponse({ status: "ready" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await render(baseProps());
    await flush();

    const callsBeforeClick = fetchMock.mock.calls.length;
    const button = findButton(/prepare me for this interview/i);
    expect(button, "no button named 'Prepare me for this interview' was found in the rendered dialog").toBeTruthy();

    await click(button);
    await flush();

    const newCalls = fetchMock.mock.calls.slice(callsBeforeClick);
    const postCalls = newCalls.filter(([, init]) => init && init.method === "POST");
    expect(postCalls, "clicking the rendered button issued no new POST request").toHaveLength(1);

    const [url, init] = postCalls[0];
    expect(url).toBe("/api/interview-prep");
    expect(JSON.parse(init.body)).toEqual({ applicationId: "app-1", triggerClass: expect.any(String) });
  });
});

describe("AC-N29.10 -- while a generation is already 'running', no button exists and no click can fire a POST", () => {
  it("an initial GET reporting status:'running' renders no Generate/Regenerate button, and clicking the meta-actions area issues no POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...ABSENT_GET_RESPONSE, status: "running" }));
    vi.stubGlobal("fetch", fetchMock);

    await render(baseProps());
    await flush();

    expect(findButton(/prepare me for this interview/i)).toBeUndefined();
    // m-a (N50 fix round 2): was `/^regenerate$/i` -- the whole-pack
    // control's own accessible name is now "Regenerate whole pack", so the
    // old pattern could never match anything and this assertion was
    // zero-power. Renamed rather than dropped: the "no button while running"
    // rule still needs a positive locator for the control it forbids.
    expect(findButton(/^regenerate whole pack$/i)).toBeUndefined();

    const callsBefore = fetchMock.mock.calls.length;
    // Clicking anywhere plausible in the dialog body must not manufacture a
    // POST -- there is deliberately no button to find and click here; this
    // asserts the ABSENCE holds under an actual interaction, not merely
    // that a querySelector came back empty.
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();
    const postCallsAfter = fetchMock.mock.calls.slice(callsBefore).filter(([, init]) => init && init.method === "POST");
    expect(postCallsAfter).toHaveLength(0);
  });
});

describe("AC-N29.8 -- an application with no job description renders no button and no POST is reachable", () => {
  it("an application whose positions.description is empty renders no Generate button", async () => {
    const NO_DESCRIPTION_APP = { ...APP, positions: { ...APP.positions, description: "" } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ABSENT_GET_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    await render(baseProps({ applicationData: [NO_DESCRIPTION_APP] }));
    await flush();

    expect(findButton(/prepare me for this interview/i)).toBeUndefined();
    expect(document.body.textContent).not.toBe(container.textContent); // the portal tripwire
    expect(document.body.textContent.toLowerCase()).toMatch(/no job description|nothing to generate/);
  });
});
