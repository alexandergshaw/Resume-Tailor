// @vitest-environment jsdom
//
// AC-N18.9/F-A1 — the confirm gate's production wiring: CopilotClient.js's
// onConfirmQuestion must call confirmQuestion AND, for an entry still
// `idle` (autoDraft off, so nothing has drafted it yet), onDraft too — the
// same click, not a second one. Mirrors CopilotClient.wiring.test.js's own
// harness (mocking every hook that would fire a network request, and every
// child component this wave did not touch) so this can mount the REAL
// CopilotClient.js and click a REAL rendered button rather than asserting
// against the handler in isolation, which would only prove the function is
// correct, never that it's actually reachable from the screen.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./practice/PracticeClient", () => ({ default: () => null }));
vi.mock("./LiveHearingStrip", () => ({ default: () => null }));
vi.mock("./ManualQuestion", () => ({ default: () => null }));
vi.mock("./StatusPill", () => ({ default: () => null }));
vi.mock("./SpeakerBar", () => ({ default: () => null }));
vi.mock("./TranscriptView", () => ({ default: () => null }));
vi.mock("@/app/components/TabHeader", () => ({ default: () => null }));
vi.mock("./SessionSetup", () => ({ default: () => null }));
vi.mock("@/app/hooks/useResponsive", () => ({ useIsMobile: () => false, useIsTablet: () => false }));
vi.mock("@mui/material/useMediaQuery", () => ({ default: () => false }));
vi.mock("@/app/settings/engine", () => ({ useEngine: () => ({ engine: "embedded", setEngine: () => {} }) }));
vi.mock("./usePrepContext", () => ({ usePrepContext: () => ["", () => {}] }));
vi.mock("./useApplicationDocs", () => ({
  useApplicationDocs: () => ({ status: "idle", resume: "", coverLetter: "", error: "", retry: () => {} }),
}));
vi.mock("./useCopilotDashboard", () => ({
  useCopilotDashboard: () => ({
    pace: {},
    fillers: {},
    recordSpeechSample: () => {},
    resetForSession: () => {},
  }),
}));
vi.mock("./useCaptureSetup", () => ({
  useCaptureSetup: () => ({
    source: "tab",
    onSourceChange: () => {},
    micDeviceId: null,
    onMicDeviceChange: () => {},
    micLabel: "System default",
    sourceAvailability: { tab: true, system: true, inperson: true },
    sourceUnavailableReason: "",
  }),
}));
vi.mock("./useCompanyBrief", () => ({
  useCompanyBrief: () => ({
    status: "idle",
    articles: [],
    warnings: [],
    error: "",
    company: "",
    open: false,
    openBrief: vi.fn(),
    closeBrief: vi.fn(),
    refresh: vi.fn(),
  }),
}));

let liveSessionReturn;
// F7: `questions` is CopilotClient's OWN useState, never read from this
// mocked hook's return — every existing test in this file reaches
// onConfirmQuestion through a WaitingList button, whose onClick passes the
// full entry object straight from the `waiting` prop, so it never needed
// `questions` populated at all. "Show next" is different: confirmNext()
// returns only an id, and onConfirmNextQuestion (CopilotClient.js) resolves
// it back to an entry via entryById(questions, id) — the exact seam F7's
// finding is about. `seedQuestions`, set per-test, is handed to CopilotClient
// through the SAME render-phase-update idiom copilotHeadingOrder.test.js
// uses, guarded so it fires exactly once.
let seedQuestions = null;
vi.mock("./useLiveSession", () => ({
  useLiveSession: (args) => {
    if (seedQuestions && args.questions.length === 0) args.setQuestions(seedQuestions);
    return liveSessionReturn;
  },
}));

function baseLiveSessionReturn(overrides = {}) {
  return {
    warning: "",
    setWarning: () => {},
    error: "",
    finals: [],
    interims: { them: "", you: "" },
    startedAt: null,
    liveSince: null,
    now: 0,
    elapsed: 0,
    stop: vi.fn(),
    start: vi.fn(),
    onDraft: vi.fn(),
    addManualQuestion: vi.fn(),
    clearAll: vi.fn(),
    copyTranscript: vi.fn(),
    speakerSnapshot: { userTag: null, confidence: "unknown", overridden: false, tags: [] },
    speakerLabelFor: vi.fn(),
    identityUnsettled: false,
    onAssignUser: vi.fn(),
    sessionRef: { current: null },
    downloadLog: vi.fn(),
    sessionLogHasEvents: false,
    pinnedId: null,
    newerQuestionCount: 0,
    held: false,
    cueAnnouncement: { text: "", nonce: 0 },
    // AC-N18.1..N18.12: the confirm gate's own surface — this file's whole
    // point is proving CopilotClient wires these two together correctly.
    current: null,
    currentIsSeed: true,
    history: [],
    waiting: [],
    confirmQuestion: vi.fn(),
    unconfirmQuestion: vi.fn(),
    ...overrides,
  };
}

let container;
let root;
let CopilotClient;

beforeEach(async () => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false }));
  liveSessionReturn = baseLiveSessionReturn();
  seedQuestions = null;
  ({ default: CopilotClient } = await import("./CopilotClient.js"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.resetModules();
});

async function render() {
  await act(async () => {
    root.render(createElement(CopilotClient));
  });
}

function findButton(pattern) {
  return [...container.querySelectorAll("button")].find(
    (b) => pattern.test(b.textContent) || pattern.test(b.getAttribute("aria-label") || ""),
  );
}

async function click(button) {
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("CopilotClient wiring — confirming a waiting question that is still idle also starts its draft (AC-N18.9/F-A1)", () => {
  it("calls confirmQuestion AND onDraft for an idle entry, in the same click", async () => {
    const idleEntry = { id: 7, question: "Describe your ideal team.", status: "idle", points: null };
    liveSessionReturn = baseLiveSessionReturn({
      current: { id: 1, question: "seed", status: "done", points: ["p"] },
      currentIsSeed: false,
      waiting: [idleEntry],
    });
    await render();

    const button = findButton(/describe your ideal team/i);
    expect(button).toBeTruthy();
    await click(button);

    expect(liveSessionReturn.confirmQuestion).toHaveBeenCalledWith(7);
    expect(liveSessionReturn.onDraft).toHaveBeenCalledWith(7);
  });

  it("[control] calls confirmQuestion but NOT onDraft for an entry that already has a draft in flight", async () => {
    const loadingEntry = { id: 8, question: "What motivates you?", status: "loading", points: null };
    liveSessionReturn = baseLiveSessionReturn({
      current: { id: 1, question: "seed", status: "done", points: ["p"] },
      currentIsSeed: false,
      waiting: [loadingEntry],
    });
    await render();

    const button = findButton(/what motivates you/i);
    await click(button);

    expect(liveSessionReturn.confirmQuestion).toHaveBeenCalledWith(8);
    expect(liveSessionReturn.onDraft).not.toHaveBeenCalled();
  });

  it("the seed's own reveal button confirms it and starts its draft when idle", async () => {
    const seed = { id: 1, question: "Tell me about yourself.", status: "idle", points: null };
    liveSessionReturn = baseLiveSessionReturn({
      current: seed,
      currentIsSeed: true,
    });
    await render();

    const reveal = findButton(/show answer/i);
    expect(reveal).toBeTruthy();
    await click(reveal);

    expect(liveSessionReturn.confirmQuestion).toHaveBeenCalledWith(1);
    expect(liveSessionReturn.onDraft).toHaveBeenCalledWith(1);
  });
});

// N18 delta review F7. Unlike a WaitingList item's own button (which passes
// the full entry straight from the `waiting` prop it already has), "Show
// next" only has an id back from confirmNext() — CopilotClient.js's
// onConfirmNextQuestion resolves it to an entry via entryById(questions, id)
// before handing it to the SAME onConfirmQuestion the tests above cover. If
// that lookup ever misses (questions and confirmNext's own internal state
// disagreeing about what's confirmable), onConfirmQuestion's `if (!entry)
// return;` guard swallows the call silently: the entry becomes current
// (confirmNext already recorded it, independent of anything CopilotClient
// does next) with its draft never started. Nothing exercised this control
// at all before this test — a grep for "Show next"/"onConfirmNext" across
// every *.test.js in this repo had no hits.
describe("CopilotClient wiring — 'Show next' also starts the draft for an idle entry (F7)", () => {
  it("clicking Show next confirms the entry confirmNext names AND starts its draft when idle", async () => {
    const idleEntry = { id: 9, question: "Tell me about your biggest failure.", status: "idle", points: null };
    seedQuestions = [idleEntry];
    liveSessionReturn = baseLiveSessionReturn({
      current: { id: 1, question: "seed", status: "done", points: ["p"] },
      currentIsSeed: false,
      waiting: [idleEntry],
      waitingCount: 1,
      confirmNext: vi.fn(() => idleEntry.id),
    });
    await render();

    const showNext = findButton(/show next/i);
    expect(showNext).toBeTruthy();
    await click(showNext);

    expect(liveSessionReturn.confirmNext).toHaveBeenCalledTimes(1);
    expect(liveSessionReturn.confirmQuestion).toHaveBeenCalledWith(idleEntry.id);
    expect(liveSessionReturn.onDraft).toHaveBeenCalledWith(idleEntry.id);
  });
});

describe("CopilotClient wiring — M7's undo control reaches useLiveSession's real unconfirmQuestion", () => {
  it("clicking the current panel's undo control calls unconfirmQuestion with the current entry's id", async () => {
    liveSessionReturn = baseLiveSessionReturn({
      current: { id: 5, question: "Describe your ideal team.", status: "done", points: ["p"] },
      currentIsSeed: false,
    });
    await render();

    const undo = findButton(/not the interviewer/i);
    expect(undo).toBeTruthy();
    await click(undo);

    expect(liveSessionReturn.unconfirmQuestion).toHaveBeenCalledWith(5);
  });
});
