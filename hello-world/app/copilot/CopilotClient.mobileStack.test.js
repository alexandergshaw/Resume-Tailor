// @vitest-environment jsdom
//
// N144b core — the mobile control-stack reduction, driven through the REAL
// CopilotClient. All changes are CONDITIONAL RENDERS at `isMobile && live`,
// none a reorder; desktop DOM is unchanged. See docs/loop/N144b.plan.r1.md §2
// and ledger L3/L4/L10/L11 (and A1 at L-rider).
//
// THE HARNESS, AND WHY IT IS NEW. The six existing suites that mount
// CopilotClient all mock useResponsive to useIsMobile:()=>false, so NONE of
// them can see a mobile branch (plan §8, R3). This file replaces that fixed
// mock with a `vi.hoisted` MUTABLE flag, so the same file mounts the component
// at desktop and at mobile. It keeps TabHeader, ModeSwitch, SessionControls and
// CollapsibleAid REAL — those carry the behaviour under test — and stubs the
// heavy children (SessionSetup, ManualQuestion, CopilotDashboard,
// LiveHearingStrip, the rail, the strip, practice/roles) with text markers, the
// same mock set askAiPreSession.test.js established, minus the TabHeader stub.
//
// `live` is reached the real way: CopilotClient's own `status` useState is
// flipped through the `setStatus` it hands useLiveSession, captured here. A
// handler/setter call here IS the user path — CopilotClient owns that state and
// the Start button calls the same setter — so this is a faithful mount, not a
// shortcut (the setStatus capture is the same instrument askAiPreSession uses
// for setQuestions).
//
// jsdom has NO layout. M-5 reads DECLARED cascade via atWidth (not geometry),
// with a positive control. Every "absent" assertion is paired with a mount
// where the node is PRESENT (idle, or desktop), so none is vacuous.
//
// RED on HEAD: M-1/M-2/M-3/M-5/M-6 are red because the conditional renders,
// the compact tuck and the warning-dismiss touch floor do not exist yet. M-4
// is a REGRESSION GUARD (reorder-nothing already holds) and passes on HEAD —
// disclosed as such; its teeth are a future reorder.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Alert from "@mui/material/Alert";

import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx";
import { resetAllChoiceStores } from "@/lib/copilot/choiceStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- the mutable viewport flag (the one change from the askAiPreSession set) -
const responsive = vi.hoisted(() => ({ isMobile: false }));
vi.mock("@/app/hooks/useResponsive", () => ({
  useIsMobile: () => responsive.isMobile,
  useIsTablet: () => responsive.isMobile,
}));
// useIsRailBelowMd() uses this directly; below md whenever we are mobile, so the
// rail renders below the dashboard rather than inside the row.
vi.mock("@mui/material/useMediaQuery", () => ({ default: () => responsive.isMobile }));

// --- marker stubs for the heavy children (text so DOM order is readable) -----
const marker = (text) => ({ default: () => createElement("div", null, text) });
vi.mock("./SessionSetup", () => marker("SETUP-MARKER"));
vi.mock("./ManualQuestion", () => marker("MANUALQ-MARKER"));
vi.mock("./dashboard/CopilotDashboard", () => marker("DASH-MARKER"));
vi.mock("./LiveHearingStrip", () => marker("HEARING-MARKER"));
vi.mock("./SpeakerBar", () => ({ default: () => null }));
vi.mock("./TranscriptDisclosure", () => ({ default: () => null }));
vi.mock("./VoiceCueSidebar", () => ({ default: () => null }));
vi.mock("./CompanyBriefPanel", () => ({ default: () => null }));
vi.mock("./dashboard/StickyQuestionStrip", () => ({ default: () => null }));
vi.mock("./dashboard/AskAiBox", () => ({ default: () => null }));
vi.mock("./practice/PracticeClient", () => ({ default: () => null }));
vi.mock("./roles/RoleDrillClient", () => ({ default: () => null }));

// --- the rest of the askAiPreSession mock set, verbatim ----------------------
vi.mock("@/app/settings/engine", () => ({ useEngine: () => ({ engine: "embedded", setEngine: () => {} }) }));
vi.mock("./usePrepContext", () => ({ usePrepContext: () => ["", () => {}] }));
vi.mock("./useApplicationDocs", () => ({
  useApplicationDocs: () => ({ status: "idle", resume: "", coverLetter: "", error: "", retry: () => {} }),
}));
vi.mock("@/app/hooks/useApplicationProjectPool", () => ({
  useApplicationProjectPool: () => ({ noteRowOneStatus: () => {} }),
}));
vi.mock("./useCopilotDashboard", () => ({
  useCopilotDashboard: () => ({ pace: {}, fillers: {}, recordSpeechSample: () => {}, resetForSession: () => {} }),
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
vi.mock("./useSttProviderName", () => ({ useSttProviderName: () => "Deepgram" }));

let liveSessionReturn;
let liveSessionArgs;
vi.mock("./useLiveSession", () => ({
  useLiveSession: (args) => {
    liveSessionArgs = args;
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
    redraftCurrentAnswer: vi.fn(),
    addManualQuestion: vi.fn(),
    clearAll: vi.fn(),
    copyTranscript: vi.fn(),
    speakerSnapshot: { userTag: null, confidence: "unknown", overridden: false, tags: [] },
    speakerLabelFor: vi.fn(),
    identityUnsettled: false,
    onAssignUser: vi.fn(),
    speakerAttribution: {},
    sessionRef: { current: null },
    downloadLog: vi.fn(),
    sessionLogHasEvents: false,
    logEvent: vi.fn(),
    current: null,
    currentIsSeed: false,
    history: [],
    waiting: [],
    confirmNext: vi.fn(),
    confirmQuestion: vi.fn(),
    unconfirmQuestion: vi.fn(),
    ...overrides,
  };
}

let container;
let root;
let CopilotClient;

beforeEach(async () => {
  responsive.isMobile = false;
  resetAllChoiceStores();
  try {
    localStorage.clear();
  } catch {
    /* memory-authoritative */
  }
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  liveSessionReturn = baseLiveSessionReturn();
  liveSessionArgs = null;
  ({ default: CopilotClient } = await import("./CopilotClient.js"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetModules();
});

async function render() {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(CopilotClient)));
  });
}
async function goLive() {
  await act(async () => liveSessionArgs.setStatus("live"));
}
function accessibleName(el) {
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  return (clone.textContent || "").trim();
}
const text = () => container.textContent || "";
const named = (name) => [...container.querySelectorAll("button")].find((b) => accessibleName(b) === name);
const h2Title = () => [...container.querySelectorAll("h2")].some((h) => h.textContent.trim() === "Interview copilot");

// ---------------------------------------------------------------------------
// M-1 — the share paragraph is hidden ONLY at mobile && live. RED on HEAD.
// ---------------------------------------------------------------------------
const SHARE = "Both sides of the conversation";
describe("M-1: the share instructions paragraph hides at mobile && live only", () => {
  it("absent at mobile + live", async () => {
    responsive.isMobile = true;
    await render();
    await goLive();
    expect(text()).not.toContain(SHARE);
  });
  it("present at mobile + idle (positive control)", async () => {
    responsive.isMobile = true;
    await render();
    expect(text()).toContain(SHARE);
  });
  it("present at desktop + live (positive control)", async () => {
    responsive.isMobile = false;
    await render();
    await goLive();
    expect(text()).toContain(SHARE);
  });
});

// ---------------------------------------------------------------------------
// M-2 — the TabHeader description hides at mobile && live; the h2 title stays.
// RED on HEAD.
// ---------------------------------------------------------------------------
const DESC = "Live transcription, question detection";
describe("M-2: the TabHeader description hides at mobile && live; the h2 title never moves", () => {
  it("description absent at mobile + live, but the h2 title is still there", async () => {
    responsive.isMobile = true;
    await render();
    await goLive();
    expect(text()).not.toContain(DESC);
    expect(h2Title(), "the h2 title stays, so heading order is untouched").toBe(true);
  });
  it("description present at mobile + idle (positive control)", async () => {
    responsive.isMobile = true;
    await render();
    expect(text()).toContain(DESC);
    expect(h2Title()).toBe(true);
  });
  it("description present at desktop + live (positive control)", async () => {
    responsive.isMobile = false;
    await render();
    await goLive();
    expect(text()).toContain(DESC);
  });
});

// ---------------------------------------------------------------------------
// M-3 — CopilotClient passes compact={isMobile}: the disclosure header exists
// at mobile + live, and at desktop + live Copy is inline and there is no header.
// Kills a hard-coded `compact`. RED on HEAD.
// ---------------------------------------------------------------------------
const ACTIONS_LABEL = "Copy, clear and download";
describe("M-3: the actions disclosure exists at mobile+live and NOT at desktop+live", () => {
  it("mobile + live: a 'Copy, clear and download' header is present", async () => {
    responsive.isMobile = true;
    await render();
    await goLive();
    expect(named(ACTIONS_LABEL), "the tuck header").toBeTruthy();
  });
  it("desktop + live: no header, and Copy is inline (positive control / hard-coded-compact mutant grave)", async () => {
    responsive.isMobile = false;
    await render();
    await goLive();
    expect(named(ACTIONS_LABEL)).toBeFalsy();
    expect(named("Copy"), "Copy is inline on desktop").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// M-4 — reorder-nothing. The markers that render in BOTH states keep their
// relative DOM order. REGRESSION GUARD (green on HEAD). */
// ---------------------------------------------------------------------------
describe("M-4: b1 reorders nothing — common markers keep their order in both states", () => {
  async function orderOf() {
    const setup = [...container.querySelectorAll("div")].find((d) => d.textContent === "SETUP-MARKER");
    const stop = named("Stop");
    const manualq = [...container.querySelectorAll("div")].find((d) => d.textContent === "MANUALQ-MARKER");
    const dash = [...container.querySelectorAll("div")].find((d) => d.textContent === "DASH-MARKER");
    return [setup, stop, manualq, dash];
  }
  function precedesInOrder(nodes) {
    for (const n of nodes) expect(n, "a common marker is present").toBeTruthy();
    for (let i = 0; i < nodes.length - 1; i += 1) {
      expect(nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  }
  it("mobile + live: SETUP -> Stop -> MANUALQ -> DASH", async () => {
    responsive.isMobile = true;
    await render();
    await goLive();
    precedesInOrder(await orderOf());
  });
  it("desktop + live: the same relative order", async () => {
    responsive.isMobile = false;
    await render();
    await goLive();
    precedesInOrder(await orderOf());
  });
});

// ---------------------------------------------------------------------------
// M-5 — the warning Alert's dismiss button carries the 44px touch floor at xs,
// auto at sm+. Declared cascade via atWidth, with a positive control. RED on HEAD.
// ---------------------------------------------------------------------------
describe("M-5: the warning Alert dismiss button meets the 44px touch floor at 375, auto at 1000", () => {
  const readMin = (el, width) => atWidth(width, () => window.getComputedStyle(el).minWidth);
  const dismissOf = () => {
    const warn = [...container.querySelectorAll(".MuiAlert-root")].find((a) =>
      (a.className || "").includes("MuiAlert-standardWarning") || a.getAttribute("role") === "alert",
    );
    const scope = warn || container;
    return scope.querySelector(".MuiAlert-action button") || scope.querySelector(".MuiAlert-action .MuiIconButton-root");
  };

  it("[control] a plain MUI Alert close button does NOT read a 44px floor at 375", async () => {
    // Proves the measurement discriminates: 44px is the token, not something
    // every Alert close button carries.
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const probeRoot = createRoot(probe);
    await act(async () => {
      probeRoot.render(
        createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Alert, { severity: "warning", onClose: () => {} }, "x")),
      );
    });
    const plain = probe.querySelector(".MuiAlert-action button");
    expect(plain, "a plain Alert close button exists").toBeTruthy();
    expect(readMin(plain, 375)).not.toBe(`${MOBILE_TAP_MIN}px`);
    await act(async () => probeRoot.unmount());
    probe.remove();
  });

  it("the CopilotClient warning dismiss reads 44px at 375 and auto at 1000", async () => {
    liveSessionReturn = baseLiveSessionReturn({ warning: "Heads up: the shared tab muted itself." });
    responsive.isMobile = true;
    await render();
    const dismiss = dismissOf();
    expect(dismiss, "the warning Alert dismiss button").toBeTruthy();
    expect(readMin(dismiss, 375)).toBe(`${MOBILE_TAP_MIN}px`);
    expect(readMin(dismiss, 1000)).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// M-6 — A1 rider: ModeSwitch is not rendered at mobile && live (it is
// disabled={live} anyway); present idle-mobile and live-desktop. RED on HEAD.
// ---------------------------------------------------------------------------
describe("M-6 (A1): ModeSwitch hides at mobile && live only", () => {
  const MODE = "Mode:";
  it("absent at mobile + live", async () => {
    responsive.isMobile = true;
    await render();
    await goLive();
    expect(text()).not.toContain(MODE);
  });
  it("present at mobile + idle (positive control)", async () => {
    responsive.isMobile = true;
    await render();
    expect(text()).toContain(MODE);
  });
  it("present at desktop + live, disabled (positive control)", async () => {
    responsive.isMobile = false;
    await render();
    await goLive();
    expect(text()).toContain(MODE);
  });
});

// ---------------------------------------------------------------------------
// Source scan — no CSS `order` is introduced in CopilotClient (L11). Regression
// guard; canary proves the ban can match a real `order:` use.
// ---------------------------------------------------------------------------
describe("source scan: CopilotClient adds no CSS order (no reorder by stylesheet)", () => {
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  it("CopilotClient.js declares no numeric `order:`", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = stripComments(readFileSync(path.resolve(process.cwd(), "app/copilot/CopilotClient.js"), "utf8"));
    expect(src).not.toMatch(/\border:\s*-?\d/);
    // [canary] the ban really matches a CSS order declaration when one exists.
    expect(stripComments("sx={{ order: 2 }}")).toMatch(/\border:\s*-?\d/);
  });
});
