// @vitest-environment jsdom
//
// AC-G1 (Group T amendment, section G). Source-text assertions cannot catch
// a composition defect — the review that supersedes CopilotClient.extraction
// .test.js/CopilotClient.structure.test.js's own gates demonstrated three
// mutants that stayed green against every existing test in this suite:
// `useLiveColumnHeight` imported but never called, with `const liveHeight =
// null`; a live region nested inside a truthiness check; and
// `postingGroundingNotice=""` hardcoded onto SessionSetup, which deletes the
// privacy notice from the screen. All three are composition bugs — the
// pieces exist and are individually correct, they are just wired together
// wrong — and only a real render can see that.
//
// This mounts the REAL CopilotClient.js with react-dom/client, following the
// pattern CopilotClient.downloadLog.test.js and useCopilotDashboard.wiring
// .test.js already establish for this suite: every hook that would fire a
// network request (useApplicationDocs, useCopilotDashboard, useCompanyBrief,
// useLiveSession) is mocked to a controllable, static return; every child
// component this file's own wave did not touch and that has nothing to do
// with what is under test here (PracticeClient, LiveHearingStrip,
// ManualQuestion, StatusPill, SpeakerBar, TranscriptView, TabHeader) is
// stubbed to `() => null`, the same way downloadLog.test.js isolates its own
// target. SessionSetup gets a purpose-built stub instead of a bare null one,
// because the grounding-notice assertion below needs to see EXACTLY the
// prop value CopilotClient computed and handed it — a real SessionSetup
// would work too, but would also drag in PostingPicker's own network calls
// for a fact this file already has its own dedicated test surface
// (groundingNotice.test.js) for.
//
// VoiceCueSidebar, CompanyBriefPanel, CopilotDashboard, QuestionFeed and
// TranscriptDisclosure are left REAL and unmocked — they are exactly the
// pieces this wiring wave rendered for the first time, so a test that
// stubbed them out would prove nothing about whether they are actually on
// screen.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FAKE_POSTING = {
  id: "posting-1",
  title: "Backend Engineer",
  company: "Acme Corp",
  description: "Build a billing platform.",
  url: "",
};

vi.mock("./practice/PracticeClient", () => ({ default: () => null }));
vi.mock("./LiveHearingStrip", () => ({ default: () => null }));
vi.mock("./ManualQuestion", () => ({ default: () => null }));
vi.mock("./StatusPill", () => ({ default: () => null }));
vi.mock("./SpeakerBar", () => ({ default: () => null }));
vi.mock("./TranscriptView", () => ({ default: () => null }));
vi.mock("@/app/components/TabHeader", () => ({ default: () => null }));

// AC-G1: the one component this file replaces with a purpose-built stub
// rather than a bare `() => null` — it has to actually render whatever
// `postingGroundingNotice` prop CopilotClient hands it, and offer a way to
// select a posting (the fact the notice is conditioned on), without dragging
// in PostingPicker's own network calls.
vi.mock("./SessionSetup", () => ({
  default: (props) =>
    createElement(
      "div",
      { "data-testid": "session-setup-stub" },
      createElement(
        "button",
        { type: "button", onClick: () => props.onPostingChange(FAKE_POSTING) },
        "Select posting",
      ),
      props.postingGroundingNotice
        ? createElement("p", { "data-testid": "grounding-notice" }, props.postingGroundingNotice)
        : null,
    ),
}));

vi.mock("@/app/hooks/useResponsive", () => ({ useIsMobile: () => false, useIsTablet: () => false }));
// I1: forces `isRailBelowMd` false, so the rail renders at its single `md`+
// position inside the bounded column rather than needing a real matchMedia
// (jsdom has none) to resolve a breakpoint.
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
    predictedQuestion: "",
    predictionStatus: "idle",
    predictionError: "",
    retryPrediction: () => {},
    retryPredraft: () => {},
    predictedPoints: [],
    predictedCues: [],
    predictedAnswerStatus: "idle",
    predictedAnswerError: "",
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
vi.mock("./usePredictionVisibility", () => ({
  usePredictionVisibility: () => ({ showPredictions: true, onToggleShowPredictions: () => {} }),
}));

let companyBriefReturn;
vi.mock("./useCompanyBrief", () => ({ useCompanyBrief: () => companyBriefReturn }));
function baseCompanyBriefReturn(overrides = {}) {
  return {
    status: "idle",
    articles: [],
    warnings: [],
    error: "",
    company: "",
    open: false,
    openBrief: vi.fn(),
    closeBrief: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

let liveSessionReturn;
vi.mock("./useLiveSession", () => ({ useLiveSession: () => liveSessionReturn }));
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
    // AC-T1.16..T1.18: the pin/hold surface this wave threads through.
    pinnedId: null,
    newerQuestionCount: 0,
    held: false,
    pinCurrentQuestion: vi.fn(),
    unpinQuestion: vi.fn(),
    cueAnnouncement: { text: "", nonce: 0 },
    ...overrides,
  };
}

let container;
let root;
let CopilotClient;

beforeEach(async () => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false }));
  liveSessionReturn = baseLiveSessionReturn();
  companyBriefReturn = baseCompanyBriefReturn();
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

async function selectPosting() {
  const button = [...container.querySelectorAll("button")].find((b) => /select posting/i.test(b.textContent));
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function h3TextEquals(text) {
  return [...container.querySelectorAll("h3")].some((h) => h.textContent.trim() === text);
}

describe("CopilotClient wiring — the grounding notice actually reaches the screen (AC-G1)", () => {
  it("renders no notice before a posting is selected", async () => {
    await render();
    expect(container.querySelector('[data-testid="grounding-notice"]')).toBeNull();
  });

  it("renders the real, computed notice once a posting is selected", async () => {
    await render();
    await selectPosting();
    const notice = container.querySelector('[data-testid="grounding-notice"]');
    expect(notice).toBeTruthy();
    // The embedded-engine sentence (useEngine is mocked to "embedded" above)
    // — proves this is groundingNotice.js's REAL output, not a placeholder.
    expect(notice.textContent).toMatch(/embedded engine drafts talking points/i);
  });
});

describe("CopilotClient wiring — one consolidated live region (AC-G1/I8)", () => {
  it("is present in the DOM, mounted empty, before anything has happened", async () => {
    await render();
    const region = container.querySelector('[data-testid="copilot-consolidated-live-region"]');
    expect(region).toBeTruthy();
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });
});

describe("CopilotClient wiring — the voice-cue sidebar renders (AC-G1)", () => {
  it("shows the sidebar's own landmark heading", async () => {
    await render();
    expect(h3TextEquals("Voice cues")).toBe(true);
  });
});

describe("CopilotClient wiring — the held badge and release control (AC-T1.16/AC-G1)", () => {
  it("renders neither the badge nor a release control while not held", async () => {
    liveSessionReturn = baseLiveSessionReturn({ held: false });
    await render();
    expect(container.textContent).not.toMatch(/held on screen/i);
    expect([...container.querySelectorAll("button")].some((b) => /release hold/i.test(b.textContent))).toBe(false);
  });

  it("renders the badge and a release control naming the arrival count while held", async () => {
    liveSessionReturn = baseLiveSessionReturn({ held: true, pinnedId: 1, newerQuestionCount: 2 });
    await render();
    expect(container.textContent).toMatch(/held on screen/i);
    const release = [...container.querySelectorAll("button")].find((b) => /release hold/i.test(b.textContent));
    expect(release).toBeTruthy();
    expect(release.textContent).toMatch(/2/);
    // I6: colour is never the only carrier — the release control is a real,
    // clickable button (not a static badge), reachable by keyboard.
    expect(release.disabled).toBe(false);
    await act(async () => {
      release.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(liveSessionReturn.unpinQuestion).toHaveBeenCalledTimes(1);
  });
});

describe("CopilotClient wiring — QuestionFeed's aria-busy flips with the hold (AC-T1.16/I9)", () => {
  it("carries no aria-busy region while not held", async () => {
    liveSessionReturn = baseLiveSessionReturn({ held: false });
    await render();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("carries aria-busy=true somewhere in the feed while held", async () => {
    liveSessionReturn = baseLiveSessionReturn({ held: true, pinnedId: 1, newerQuestionCount: 1 });
    await render();
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
    // It is QuestionFeed's own container, not some unrelated MUI internal —
    // the "Detected questions" heading lives inside the same element.
    expect(busy.textContent).toMatch(/detected questions/i);
  });
});
