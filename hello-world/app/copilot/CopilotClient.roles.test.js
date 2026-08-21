// @vitest-environment jsdom
//
// AC-Q10 - the wiring wave for the "Speak as" drill.
//
// A source-text assertion ("the file imports RoleDrillClient") cannot catch
// the failure mode this repo has already shipped once: a fully built,
// fully tested component sitting beside its caller and never rendered. So
// this mounts the REAL CopilotClient and asserts what is actually on screen
// in each mode, following the harness CopilotClient.wiring.test.js already
// establishes - every hook that would fire a request is mocked to a static
// return, and the children that are not under test are stubbed.
//
// RoleDrillClient itself is stubbed to a marker: what is under test here is
// whether CopilotClient mounts it, not what it renders (that is
// app/copilot/roles/RoleDrillClient.contract.test.js's job).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Resolved from the vitest root rather than `import.meta.url`: under the
// jsdom environment `import.meta.url` is not a file: URL, so `fileURLToPath`
// throws at module scope and the whole file fails to collect.
const CLIENT_PATH = path.join(process.cwd(), "app", "copilot", "CopilotClient.js");
const SOURCE = readFileSync(CLIENT_PATH, "utf8");

// AC-R1: the stub now RECORDS what it was handed. The drill records audio
// and needs the microphone the user already chose for live mode plus the STT
// provider's name for its own privacy notice; both are owned here, not by the
// drill. Asserting only that the drill mounts would let it ship recording on
// the system-default microphone while the picker names another, and showing a
// notice that will not say where the audio actually goes - neither of which
// is visible from inside RoleDrillClient's own suite, since that one supplies
// the props itself.
const roleDrillProps = vi.hoisted(() => ({ current: null }));
vi.mock("./roles/RoleDrillClient", () => ({
  default: (props) => {
    roleDrillProps.current = props;
    return createElement("div", { "data-testid": "role-drill-stub" }, "role drill");
  },
}));
vi.mock("./practice/PracticeClient", () => ({
  default: () => createElement("div", { "data-testid": "practice-stub" }, "practice"),
}));
vi.mock("./SessionSetup", () => ({
  default: () => createElement("div", { "data-testid": "session-setup-stub" }, "setup"),
}));
vi.mock("./LiveHearingStrip", () => ({ default: () => null }));
vi.mock("./ManualQuestion", () => ({ default: () => null }));
vi.mock("./StatusPill", () => ({ default: () => null }));
vi.mock("./SpeakerBar", () => ({ default: () => null }));
vi.mock("./TranscriptView", () => ({ default: () => null }));
// Rendered rather than nulled: AC-Q10.4 is about what its description says.
vi.mock("@/app/components/TabHeader", () => ({
  default: (props) =>
    createElement(
      "div",
      { "data-testid": "tab-header" },
      createElement("span", { "data-testid": "tab-header-description" }, props.description || ""),
    ),
}));

vi.mock("@/app/hooks/useResponsive", () => ({ useIsMobile: () => false, useIsTablet: () => false }));
vi.mock("@mui/material/useMediaQuery", () => ({ default: () => false }));
// Mutable so the header's engine-dependent branch (AC-Q10.4) can be rendered
// on both engines; a mock pinned to "embedded" would leave the Gemini
// sentence - the DEFAULT engine's sentence - never rendered by any test.
let engineValue = "embedded";
vi.mock("@/app/settings/engine", () => ({
  useEngine: () => ({ engine: engineValue, setEngine: () => {} }),
  readEngine: () => engineValue,
}));
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

let liveSessionReturn;
vi.mock("./useLiveSession", () => ({ useLiveSession: () => liveSessionReturn }));

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
  engineValue = "embedded";
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

const buttonNamed = (re) =>
  [...container.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));

async function clickMode(re) {
  const button = buttonNamed(re);
  expect(button, `no mode button matching ${re}`).toBeTruthy();
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const stub = (id) => container.querySelector(`[data-testid="${id}"]`);
const description = () => stub("tab-header-description")?.textContent || "";

describe("CopilotClient - the third mode is reachable (AC-Q10.1, AC-Q10.3)", () => {
  it("offers Speak as beside Live interview and Practice", async () => {
    await render();
    expect(buttonNamed(/^live interview$/i)).toBeTruthy();
    expect(buttonNamed(/^practice$/i)).toBeTruthy();
    expect(buttonNamed(/^speak as$/i)).toBeTruthy();
  });

  it("renders nothing of the drill until its mode is chosen", async () => {
    await render();
    expect(stub("role-drill-stub")).toBeNull();
    expect(stub("session-setup-stub")).toBeTruthy();
  });

  it("renders the drill INSTEAD of the live column and instead of practice", async () => {
    await render();
    await clickMode(/^speak as$/i);
    expect(stub("role-drill-stub"), "the drill was never mounted").toBeTruthy();
    expect(stub("practice-stub")).toBeNull();
    expect(stub("session-setup-stub"), "live setup still on screen in the drill").toBeNull();
  });

  it("leaves none of the live apparatus behind it", async () => {
    // VoiceCueSidebar, CopilotDashboard and TranscriptDisclosure are left REAL
    // and unmocked above, so this sees whatever CopilotClient actually renders.
    // Asserting only that SessionSetup is gone would pass against a drill
    // rendered ON TOP of the whole live column.
    await render();
    const h3s = () => [...container.querySelectorAll("h3")].map((h) => h.textContent.trim());
    expect(h3s(), "the live rail is missing before the drill").toContain("Voice cues");

    await clickMode(/^speak as$/i);
    expect(h3s()).not.toContain("Voice cues");
    expect(container.textContent).not.toMatch(/detected questions/i);
    expect(container.textContent).not.toMatch(/transcript/i);
  });

  it("goes back to live mode, and on to practice, without stranding the drill", async () => {
    await render();
    await clickMode(/^speak as$/i);
    await clickMode(/^live interview$/i);
    expect(stub("role-drill-stub")).toBeNull();
    expect(stub("session-setup-stub")).toBeTruthy();
    await clickMode(/^practice$/i);
    expect(stub("practice-stub")).toBeTruthy();
    expect(stub("role-drill-stub")).toBeNull();
  });

  it("keeps the mode set when its own button is clicked again (MUI reports null)", async () => {
    await render();
    await clickMode(/^speak as$/i);
    await clickMode(/^speak as$/i);
    expect(stub("role-drill-stub")).toBeTruthy();
  });
});

describe("CopilotClient - leaving a session behind (AC-Q10.2)", () => {
  it("tears down a capture session that is still holding hardware", async () => {
    liveSessionReturn = baseLiveSessionReturn({ sessionRef: { current: { fake: true } } });
    await render();
    await clickMode(/^speak as$/i);
    expect(liveSessionReturn.stop).toHaveBeenCalledTimes(1);
  });

  it("does not call stop when there is no session at all", async () => {
    await render();
    await clickMode(/^speak as$/i);
    expect(liveSessionReturn.stop).not.toHaveBeenCalled();
  });
});

describe("CopilotClient - what the header claims (AC-Q10.4)", () => {
  it("describes the drill, and never claims the prep context is sent", async () => {
    await render();
    const live = description();
    await clickMode(/^speak as$/i);
    const drill = description();
    expect(drill).not.toBe(live);
    expect(drill.length).toBeGreaterThan(20);
    expect(drill).toMatch(/cadence|register|sound/i);
    expect(drill).not.toMatch(/prep context|resume|cover letter/i);
  });

  it("credits the server, not the browser, on the embedded engine", async () => {
    // The drill posts to this app's own routes on EVERY engine - the
    // embedded branch runs server-side. "Nothing leaves this browser" is
    // therefore false, and it is a privacy claim, which is the one kind of
    // sentence that must not be rounded up. The house wording for this is
    // groundingNotice.js's: on this server, with no AI provider, so nothing
    // is sent to Google.
    engineValue = "embedded";
    await render();
    await clickMode(/^speak as$/i);
    const drill = description();
    expect(drill).toMatch(/this server/i);
    expect(drill).not.toMatch(/leaves (this|your) browser/i);
    expect(drill).not.toMatch(/never leaves/i);
    expect(drill).toMatch(/no AI provider|not sent to Google|nothing is sent/i);
  });

  it("names Gemini, and only the role and situation, on the Gemini engine", async () => {
    engineValue = "gemini";
    await render();
    await clickMode(/^speak as$/i);
    const drill = description();
    expect(drill).toMatch(/Gemini/);
    expect(drill).toMatch(/situation/i);
    expect(drill).not.toMatch(/prep context|resume|cover letter/i);
  });
});

describe("CopilotClient - the drill's recording needs (AC-R1.1, AC-R1.11)", () => {
  it("hands the drill the microphone live mode already chose", async () => {
    await render();
    await clickMode(/^speak as$/i);
    expect(stub("role-drill-stub"), "the drill is not mounted at all").toBeTruthy();
    expect(roleDrillProps.current, "the drill was rendered with no props object").toBeTruthy();
    // The value itself is whatever the picker resolved to (null with no
    // stored selection); what must hold is that the prop is PASSED, so the
    // drill records on the same device the rest of the app names.
    expect(
      Object.keys(roleDrillProps.current),
      "the drill cannot record on the chosen microphone",
    ).toContain("micDeviceId");
    expect(Object.keys(roleDrillProps.current)).toContain("onMicDeviceChange");
    expect(typeof roleDrillProps.current.onMicDeviceChange).toBe("function");
  });

  it("hands the drill the transcription provider it must name in its own notice", async () => {
    await render();
    await clickMode(/^speak as$/i);
    expect(
      Object.keys(roleDrillProps.current),
      "the drill's privacy notice cannot name where the audio goes",
    ).toContain("sttProviderName");
  });

  it("stops claiming, in the header, that nothing about the user is recorded", async () => {
    engineValue = "gemini";
    await render();
    await clickMode(/^speak as$/i);
    const drill = description();
    // The mode now streams the user's voice off the machine. A header that
    // described only the reveal would be understating what the tab does, in
    // the one direction a privacy claim must never be wrong in.
    expect(drill, "the header never mentions that recording happens").toMatch(/record/i);
    expect(drill, "the header never mentions transcription").toMatch(/transcri/i);
  });
});

describe("CopilotClient - the other two modes are untouched (AC-Q10.6)", () => {
  it("keeps live mode's own description", async () => {
    await render();
    expect(description()).toContain("Live transcription, question detection");
  });

  it("keeps practice mode's own description", async () => {
    await render();
    await clickMode(/^practice$/i);
    expect(description()).toContain("Practice speaking out loud with your camera and mic");
  });
});

describe("CopilotClient - the file itself", () => {
  it("stays under the size cap", () => {
    expect(SOURCE.split("\n").length).toBeLessThan(1000);
  });

  it("contains no NUL byte", () => {
    expect(readFileSync(CLIENT_PATH).indexOf(0)).toBe(-1);
  });
});
