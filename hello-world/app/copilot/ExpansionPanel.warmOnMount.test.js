// @vitest-environment jsdom
//
// N153 — REACHABILITY for the per-bullet warm. The expansion of each bullet is
// warmed "as soon as it comes up on screen", driven the way a human reaches it:
// a REAL ExpansionScope wrapping a REAL AnswerLines, mounted, with NOTHING called
// directly. One ExpansionPanel renders per bullet (always mounted with the
// answer), and its useWarmOnMount is what fires — this test fails if the hook is
// present in the api but never wired into the leaf, which a method-level test
// could not catch.
//
// RED on HEAD: a rendered answer issues ZERO requests today (AnswerLines.
// expansion.test.js pins exactly that on HEAD). Once the warm is wired, mounting
// the answer issues one request per resolvable bullet, with no interaction.
//
// Pinned (design §2/§3, ledger N153-L1/L3/L6):
//   • mounting the answer warms each resolvable bullet exactly once;
//   • the warm NEVER opens a panel (every control stays collapsed, no sub-bullet
//     text on screen);
//   • a click after the warm issues no second request (store dedupe);
//   • an answer whose question cannot be resolved warms nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import AnswerLines from "./AnswerLines.js";
import { ExpansionScope } from "./useAnswerExpansions.js";
import { resetExpansionStore } from "@/lib/copilot/expansionStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINES = [
  { label: "", cue: "", point: "I rebuilt the ledger after the settlement outage.", pageSource: null, emphasis: null, sourceIndex: 0 },
  { label: "", cue: "", point: "I paged the on-call team during the incident.", pageSource: null, emphasis: null, sourceIndex: 1 },
  { label: "", cue: "", point: "I ran the postmortem with the payments group.", pageSource: null, emphasis: null, sourceIndex: 2 },
];
const QUESTIONS = [
  {
    id: 1,
    question: "Tell me about a failure.",
    points: LINES.map((l) => l.point),
    status: "done",
  },
];
const REQUEST = { applicationId: "app-1", profile: "", interviewType: "behavioral", codeLanguage: "auto", engine: "embedded" };

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const SUB = { subBullets: [{ text: "I reconciled every settlement by hand.", pageSource: null, source: null }], caption: "", empty: false };

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  resetExpansionStore();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(body = SUB) {
  const fetchMock = vi.fn(async () => okResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mount(children) {
  await act(async () => {
    root.render(createElement(ExpansionScope, { questions: QUESTIONS, request: REQUEST }, children));
  });
}

describe("mounting the answer warms each bullet's expansion", () => {
  it("issues one request per resolvable bullet, with no interaction (reachability via the real leaf)", async () => {
    const fetchMock = stubFetch();
    await mount(createElement(AnswerLines, { lines: LINES }));
    // Three bullets, three warms. ZERO on HEAD (no prefetch) -> red there.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("opens no panel: every control is still collapsed and no sub-bullet is on screen", async () => {
    stubFetch();
    await mount(createElement(AnswerLines, { lines: LINES }));
    const controls = [...container.querySelectorAll("li button")];
    expect(controls).toHaveLength(3);
    for (const btn of controls) expect(btn.getAttribute("aria-expanded")).toBe("false");
    // The warmed content exists in the store but is not rendered (prefetch does
    // not set `open`); the sub-bullet text must not be on screen.
    expect(container.textContent).not.toContain("I reconciled every settlement by hand.");
    expect(container.querySelector("li :scope > ul")).toBeNull();
  });

  it("a click after the warm opens the warmed record and issues no second request", async () => {
    const fetchMock = stubFetch();
    await mount(createElement(AnswerLines, { lines: LINES }));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => container.querySelectorAll("li button")[0].click());
    expect(container.querySelectorAll("li button")[0].getAttribute("aria-expanded")).toBe("true");
    // Opening the warmed record spends no new call.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("I reconciled every settlement by hand.");
  });

  it("warms nothing when the answer's question cannot be resolved", async () => {
    const fetchMock = stubFetch();
    await act(async () => {
      root.render(
        createElement(ExpansionScope, { questions: [], request: REQUEST }, createElement(AnswerLines, { lines: LINES })),
      );
    });
    // No control renders (the line resolves to nothing) and nothing is warmed.
    expect(container.querySelectorAll("li button")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
