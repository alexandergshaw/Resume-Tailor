// @vitest-environment jsdom
//
// D6: the "Download session log" control's disabled-reason used to live
// ONLY as an `aria-label` on a natively-disabled <button> — out of the tab
// order, so a keyboard/screen-reader user never reached it, and a sighted
// user saw a greyed button with no visible explanation at all. The fix
// mirrors app/copilot/practice/PracticeControls.js's own working pattern:
// `aria-describedby` pointing at a sibling VISIBLE caption with a real id,
// rendered under the same condition.
//
// This mounts the real CopilotClient.js, with every OTHER hook/child
// component it composes stubbed out — the point under test is CopilotClient's
// OWN render logic for this one control, not the rest of the live pipeline
// (already covered by useLiveSession.log.test.js, LiveHearingStrip.test.js,
// etc.). Rendered with react-dom/client, the same idiom
// app/components/JobDescriptionTab.test.js established as precedent for a
// full-DOM render under this suite's per-file jsdom opt-in.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("./SessionSetup", () => ({ default: () => null }));
vi.mock("./practice/PracticeClient", () => ({ default: () => null }));
vi.mock("./dashboard/CopilotDashboard", () => ({ default: () => null }));
vi.mock("./TranscriptView", () => ({ default: () => null }));
vi.mock("./QuestionFeed", () => ({ default: () => null }));
vi.mock("./LiveHearingStrip", () => ({ default: () => null }));
vi.mock("./ManualQuestion", () => ({ default: () => null }));
vi.mock("./StatusPill", () => ({ default: () => null }));
vi.mock("./SpeakerChip", () => ({ default: () => null }));
vi.mock("@/app/components/TabHeader", () => ({ default: () => null }));
vi.mock("@/app/hooks/useResponsive", () => ({ useIsMobile: () => false, useIsTablet: () => false }));
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
    ...overrides,
  };
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let CopilotClient;

beforeEach(async () => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false }));
  liveSessionReturn = baseLiveSessionReturn();
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

function downloadButton() {
  return [...container.querySelectorAll("button")].find((b) => /download session log/i.test(b.textContent));
}

describe("D6: the download-log disabled reason reaches everyone, through one real control", () => {
  it("renames the control to \"Download session log\" (matching practice mode's own name)", async () => {
    liveSessionReturn = baseLiveSessionReturn({ sessionLogHasEvents: true });
    await render();
    const button = downloadButton();
    expect(button).toBeTruthy();
    expect(button.textContent).toBe("Download session log");
    // No stale aria-label carrying the OLD reason text.
    expect(button.getAttribute("aria-label")).toBeNull();
  });

  it("points aria-describedby at a sibling caption whose id actually exists in the tree, while disabled", async () => {
    liveSessionReturn = baseLiveSessionReturn({ sessionLogHasEvents: false });
    await render();
    const button = downloadButton();
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The whole point of D6: the id this points at must be a REAL,
    // reachable, VISIBLE node — not merely a string nobody rendered.
    const target = container.querySelector(`#${describedBy}`);
    expect(target).toBeTruthy();
    expect(target.textContent.trim().length).toBeGreaterThan(0);
    expect(target.tagName).not.toBe("BUTTON");
  });

  it("carries no aria-describedby, and renders no caption, once the session has recorded something", async () => {
    liveSessionReturn = baseLiveSessionReturn({ sessionLogHasEvents: true });
    await render();
    const button = downloadButton();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector("#live-download-log-reason")).toBeNull();
  });
});
