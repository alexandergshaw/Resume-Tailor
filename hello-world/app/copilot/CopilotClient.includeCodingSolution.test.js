// @vitest-environment jsdom
//
// N162 Wave D, AC-N162-4 (the live control) + AC-N162-16 (the toggle reflects
// and persists the shared store). This mounts the REAL CopilotClient.js with
// react-dom/client, following the exact isolation pattern
// CopilotClient.wiring.test.js establishes: every hook that would fire a
// network request is mocked, every child with nothing to do with this fact is
// stubbed to `() => null`, but SessionControls (where the control mounts,
// beside Auto-draft) is left REAL.
//
// WHY A REAL MOUNT, NOT A DIRECT PROP/SETTER CALL. AC-N162-4 is a
// REACHABILITY criterion: a control that exists in SessionControls but that
// CopilotClient never wires to the store is exactly the "panel with no
// opening button" defect this repo has shipped past a green suite before. So
// the store (@/app/settings/includeCodingSolution) is left REAL and driven
// the way a user drives it — clicking the rendered switch — and the
// persistence is read back from localStorage, never from a setter this test
// called itself. A build that renders a control ignoring the store (hardwired
// checked/unchecked) REDs the reflect assertions; a build whose onChange does
// not persist REDs the localStorage assertion; a build that never mounts the
// control at all REDs every assertion (control absent).
//
// RED on HEAD: there is no such control anywhere — CopilotClient does not read
// useIncludeCodingSolution() and SessionControls renders no code-solution
// switch. Every assertion fails to find the control.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import { INCLUDE_CODING_SOLUTION_STORAGE_KEY } from "@/app/settings/includeCodingSolution";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Child isolation — identical to CopilotClient.wiring.test.js. SessionControls
// is deliberately NOT mocked: it is the surface under test.
vi.mock("./practice/PracticeClient", () => ({ default: () => null }));
vi.mock("./LiveHearingStrip", () => ({ default: () => null }));
vi.mock("./ManualQuestion", () => ({ default: () => null }));
vi.mock("./StatusPill", () => ({ default: () => null }));
vi.mock("./SpeakerBar", () => ({ default: () => null }));
vi.mock("./TranscriptView", () => ({ default: () => null }));
vi.mock("@/app/components/TabHeader", () => ({ default: () => null }));
vi.mock("./SessionSetup", () => ({ default: () => null }));
vi.mock("./VoiceCueSidebar", () => ({ default: () => null }));
vi.mock("./CompanyBriefPanel", () => ({ default: () => null }));
vi.mock("./dashboard/CopilotDashboard", () => ({
  default: () => null,
  LIVE_COPY: {},
  PRACTICE_COPY: {},
  useCurrentQuestionAnnouncement: () => "",
}));
vi.mock("./QuestionFeed", () => ({ default: () => null }));

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
    pinnedId: null,
    newerQuestionCount: 0,
    held: false,
    cueAnnouncement: { text: "", nonce: 0 },
    ...overrides,
  };
}

let container;
let root;
let CopilotClient;

beforeEach(async () => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom localStorage */
  }
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

// The code-solution switch: the native checkbox input whose associated
// <label> names the coding-solution control. The exact label wording is an
// OWNER micro-decision ("Add code solutions" recommended), so match the
// concept, not a fixed string — but it must be a real, labelled, native
// control (a checkbox input a keyboard reaches), never a bare clickable div.
function codeSolutionSwitches() {
  return [...container.querySelectorAll('input[type="checkbox"]')].filter((input) => {
    const label = input.closest("label");
    return label && /code solution/i.test(label.textContent || "");
  });
}

function autoDraftSwitch() {
  return [...container.querySelectorAll('input[type="checkbox"]')].find((input) => {
    const label = input.closest("label");
    return label && /auto-?draft/i.test(label.textContent || "");
  });
}

describe("CopilotClient mounts exactly one live coding-solution control (AC-N162-4)", () => {
  it("renders exactly one accessible, labelled switch beside Auto-draft", async () => {
    await render();
    const switches = codeSolutionSwitches();
    expect(switches).toHaveLength(1);
    const input = switches[0];
    // A real native control, keyboard-reachable, enabled, with a non-empty
    // accessible label.
    expect(input.tagName).toBe("INPUT");
    expect(input.disabled).toBe(false);
    expect((input.closest("label").textContent || "").trim().length).toBeGreaterThan(0);
    // It lives on the live control bar — the same row that hosts Auto-draft,
    // not buried in the collapsing setup surface.
    expect(autoDraftSwitch(), "the control must sit on the live SessionControls bar").toBeTruthy();
  });
});

describe("the control reflects the shared store (AC-N162-4 / AC-N162-16)", () => {
  it("renders OFF by default (the store's default, nothing stored)", async () => {
    await render();
    const input = codeSolutionSwitches()[0];
    expect(input).toBeTruthy();
    expect(input.checked).toBe(false);
  });

  it("renders ON when the store already holds true", async () => {
    // Drive the store the only durable way a prior tab would have: localStorage.
    // A control that hardwires its checked state ignores this and REDs.
    localStorage.setItem(INCLUDE_CODING_SOLUTION_STORAGE_KEY, "true");
    await render();
    const input = codeSolutionSwitches()[0];
    expect(input).toBeTruthy();
    expect(input.checked).toBe(true);
  });
});

describe("toggling the control persists to the store (AC-N162-4 / AC-N162-16)", () => {
  it("flips the persisted value and re-renders checked when clicked from OFF", async () => {
    await render();
    const input = codeSolutionSwitches()[0];
    expect(input.checked).toBe(false);
    expect(localStorage.getItem(INCLUDE_CODING_SOLUTION_STORAGE_KEY)).not.toBe("true");

    await act(async () => {
      input.click();
    });

    // Persisted (read back from localStorage, not from a setter this test
    // called), and the control reflects the new stored value.
    expect(localStorage.getItem(INCLUDE_CODING_SOLUTION_STORAGE_KEY)).toBe("true");
    expect(codeSolutionSwitches()[0].checked).toBe(true);
  });
});
