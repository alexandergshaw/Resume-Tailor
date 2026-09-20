// @vitest-environment jsdom
//
// V-5 (verify.r1.md, N29/N41 fix round 2) -- two of the four new props
// AppViewDialog.js passes into PrepPackPanel (`generating`, `triggerMessage`)
// had no reachability-level guard: severing either wire silently (hardcoding
// `generating={false}` or `triggerMessage={null}`) survived the entire
// `app/components` + `app/hooks` suite (1801 tests). `onGenerateNow` (M6)
// and `hasDescription` (M12) already have this guard, in
// AppViewDialog.prepGenerate.reachability.test.js -- this file extends the
// SAME pattern (real mount, real DOM button, real click, no direct call to
// handleGenerateNow/onGenerateNow) to the two unguarded wires, rather than
// editing that landed file.
//
// WHAT EACH CASE PROVES:
//   - triggerMessage: a `{status:"disabled"}` POST refusal must surface its
//     copy in a `role="alert"` region. If AppViewDialog.js hardcoded
//     `triggerMessage={null}` instead of `prepMessageById[dApp.id] ?? null`,
//     no alert would ever render here -- the N38 silent-failure class, on
//     this exact surface.
//   - generating: while a POST is pending, "Generating..." text must be
//     visible and the Generate button must be gone. If AppViewDialog.js
//     hardcoded `generating={false}` instead of
//     `generatingIds.has(dApp?.id) || refreshingIds.has(dApp?.id)`, the
//     button would still render mid-request, reopening the double-click
//     window DX's own sequencing fix (PLAN-N29.7) exists to close.
//
// Both wires already WORK on HEAD (verify.r1.md's own Probe D) -- these are
// new, additive instruments closing a missing-guard gap, not a repro of a
// live defect (unlike AppViewDialog.prepStaleResponse.test.js, this file's
// sibling for V-1).

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

// Reuses AppViewDialog.prepGenerate.reachability.test.js's own APP/response
// shapes (plan.r1.md §3.2 item 2's fixture, ultimately TrackingTab.prepEntryPoint.test.js:60-73).
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

function isGetCall(init) {
  return !init || init.method === undefined;
}

describe("[M10 guard] the triggerMessage wire -- a disabled POST refusal must reach a role=alert region", () => {
  it("clicking the real button, then receiving {status:'disabled'}, renders the refusal copy in a role=alert node", async () => {
    const fetchMock = vi.fn().mockImplementation((url, init) =>
      isGetCall(init) ? Promise.resolve(jsonResponse(ABSENT_GET_RESPONSE)) : Promise.resolve(jsonResponse({ status: "disabled" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await render(baseProps());
    await flush();

    const button = findButton(/prepare me for this interview/i);
    expect(button).toBeTruthy();
    await click(button);
    await flush();

    const alert = document.body.querySelector('[role="alert"]');
    expect(alert, "no role=alert region rendered after a disabled refusal -- the triggerMessage wire may be severed").toBeTruthy();
    expect(alert.textContent.toLowerCase()).toMatch(/isn't available right now/);
  });
});

describe("[M11 guard] the generating wire -- a pending POST must show 'Generating…' and remove the button", () => {
  it("while the POST is pending, no Generate button is rendered and 'Generating…' text is visible", async () => {
    let releasePost;
    const postGate = new Promise((resolve) => {
      releasePost = resolve;
    });
    const fetchMock = vi.fn().mockImplementation((url, init) =>
      isGetCall(init) ? Promise.resolve(jsonResponse(ABSENT_GET_RESPONSE)) : postGate.then(() => jsonResponse({ status: "ready" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await render(baseProps());
    await flush();

    const button = findButton(/prepare me for this interview/i);
    expect(button).toBeTruthy();
    await click(button);
    await flush();

    expect(
      findButton(/prepare me for this interview/i),
      "a button is still rendered while a generation is in flight -- the generating wire may be severed",
    ).toBeUndefined();
    expect(document.body.textContent.toLowerCase()).toMatch(/generating/);

    releasePost();
    await flush();
  });
});
