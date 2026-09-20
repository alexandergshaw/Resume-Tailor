// @vitest-environment jsdom
//
// V-1 (verify.r1.md, N29/N41 fix round 2) -- a REGRESSION the reopen-refetch
// fix itself introduced. The pre-fix mount effect held `let cancelled =
// false`, guarded both `.then`/`.catch` with `if (!cancelled)`, and returned
// `() => { cancelled = true; }` in its cleanup. The reopen-refetch fix
// (AppViewDialog.prepReopenRefetch.test.js) replaced the whole guard with
// `prepFetchedForRef` but dropped the cancellation entirely -- `fetchPrep`
// now writes to `prepById` UNCONDITIONALLY (AppViewDialog.messageFor.test.js
// pins that unconditional single `setPrepById` call as `fetchPrep`'s own
// contract, so the fix must NOT change fetchPrep itself -- the guard has to
// live at the call site instead).
//
// Consequence: a SLOW GET issued before a close/reopen can resolve AFTER the
// reopen's own fresh GET already has, and overwrite it -- re-creating the
// exact stuck-"running", no-button state the reopen fix exists to remove.
// AppViewDialog.prepReopenRefetch.test.js's own cases cannot see this: both
// of its mocked responses resolve immediately, in issue order, so a
// resolve-out-of-order race never occurs there.
//
// RED ON HEAD (before this round's fix): GET #1 is held open (never
// resolved) while the dialog closes and reopens, issuing GET #2, which
// resolves first with `{status:"ready"}`. GET #1 then resolves with a STALE
// `{status:"running"}` body and overwrites `prepById["app-1"]`, since
// nothing tracks which GET was issued last. The final assertion below (no
// "generating..." text after the stale GET lands) fails against
// unfixed source.

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
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

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
  generated_resumes: { content: "Resume content." },
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

async function renderWith(props) {
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

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const RUNNING_BODY = {
  pack: null,
  status: "running",
  attemptsExhausted: false,
  completeSections: [],
  events: [],
  candidateName: null,
  interviewerNames: [],
  error: null,
};

const READY_BODY = {
  pack: { version: 1, sections: {} },
  status: "ready",
  attemptsExhausted: false,
  completeSections: [],
  events: [],
  candidateName: null,
  interviewerNames: [],
  error: null,
};

describe("AppViewDialog stale-GET guard (V-1 fix, N29/N41 round 2)", () => {
  it("a SLOW first GET that resolves AFTER a fresher reopen's GET must not overwrite the fresher result", async () => {
    const first = deferred();
    const fetchMock = vi.fn();
    fetchMock.mockImplementationOnce(() => first.promise);
    vi.stubGlobal("fetch", fetchMock);

    await renderWith(baseProps());
    await flush();
    // GET #1 is still pending -- nothing to assert about content yet, only
    // that exactly one fetch call has been made so far.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Close, then reopen the SAME row -- this issues GET #2, which resolves
    // BEFORE GET #1 does.
    await renderWith(baseProps({ appDialog: { open: false, rowIndex: 0, kind: "prep" } }));
    await flush();
    fetchMock.mockResolvedValueOnce(jsonResponse(READY_BODY));
    await renderWith(baseProps({ appDialog: { open: true, rowIndex: 0, kind: "prep" } }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent.toLowerCase()).toMatch(/ready/);

    // NOW the slow GET #1 finally resolves, with a STALE 'running' body.
    first.resolve(jsonResponse(RUNNING_BODY));
    await flush();

    expect(
      document.body.textContent.toLowerCase(),
      "a stale GET issued before the reopen overwrote the fresh 'ready' state -- the reopen fix's own cancellation guard is missing",
    ).not.toMatch(/generating your interview prep pack now/);
    expect(document.body.textContent.toLowerCase()).toMatch(/ready/);
  });
});
