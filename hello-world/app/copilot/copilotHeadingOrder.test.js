// @vitest-environment jsdom
//
// ARCH-sticky v8 — guard G-1. Written BEFORE the feature; the first test
// below is expected to be RED until the strip lands.
//
// WHY THIS IS CLIENT-SCOPED AND NOT COMPONENT-SCOPED. Today the question
// panel's heading level is pinned inside CopilotDashboard.render.test.js as
// the component-scoped list [3,4,4,4]. Once the panel moves OUT of the
// dashboard and into a sticky strip mounted beside it, that list stops
// seeing the panel at all -- and the realistic mutation (H-1: dropping
// `headingLevel="h3"` from the strip's call, so the question renders h4
// directly under the tab's h2) leaves the dashboard's own subtree
// completely untouched and therefore passes [3,4,4,4] unchanged. The guard
// has to be able to see BOTH subtrees at once, so it mounts the client.
//
// The mount strategy is CopilotClient.wiring.test.js's, deliberately: every
// hook that would fire a network request is mocked to a static return, and
// only the components with nothing to do with heading structure are stubbed
// out. TabHeader is left REAL, because its <h2> is the level everything
// below is measured against. CopilotDashboard is left REAL for the same
// reason.
//
// `held: true` with `questions: []` is how the strip is reached here: the
// hook is mocked, so CopilotClient.js's own `useState([])` for `questions`
// is never populated, and the live mount predicate's `|| held` disjunct is
// the only path in. That is pin 15's path, and it is the reason the
// disjunct is kept.
//
// NOT ASSERTED HERE (jsdom has no layout engine): that the strip is
// actually pinned, that it does not occlude anything, or that the cap
// binds. Those are manual browser checks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./practice/PracticeClient", () => ({ default: () => null }));
vi.mock("./roles/RoleDrillClient", () => ({ default: () => null }));
vi.mock("./LiveHearingStrip", () => ({ default: () => null }));
vi.mock("./ManualQuestion", () => ({ default: () => null }));
vi.mock("./StatusPill", () => ({ default: () => null }));
vi.mock("./SpeakerBar", () => ({ default: () => null }));
vi.mock("./TranscriptView", () => ({ default: () => null }));
vi.mock("./SessionSetup", () => ({ default: () => null }));
vi.mock("./TranscriptDisclosure", () => ({ default: () => null }));
vi.mock("./VoiceCueSidebar", () => ({ default: () => null }));
vi.mock("./CompanyBriefPanel", () => ({ default: () => null }));

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
    pinCurrentQuestion: vi.fn(),
    unpinQuestion: vi.fn(),
    cueAnnouncement: { text: "", nonce: 0 },
    ...overrides,
  };
}

const QUESTION_TITLE = "Current question";
const DASHBOARD_TITLE = "Live dashboard";

let container;
let root;
let CopilotClient;

beforeEach(async () => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false }));
  // The held branch is the only one that reaches the question surface with
  // useLiveSession mocked -- see the file header.
  liveSessionReturn = baseLiveSessionReturn({ held: true, newerQuestionCount: 0 });
  ({ default: CopilotClient } = await import("./CopilotClient.js"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(CopilotClient));
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.resetModules();
});

// Every heading on the page, in document order, as [level, text].
function headings() {
  return [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((node) => [
    Number(node.tagName.slice(1)),
    (node.textContent || "").trim(),
  ]);
}

describe("G-1: the copilot page's heading outline, measured at the client", () => {
  it("puts the question's heading first, at h3, directly under the tab's h2", () => {
    // The strip is a sibling of the dashboard, above it in flow, so the
    // question's heading is a SIBLING of "Live dashboard" -- not a child of
    // it. Both sit one level under the tab's h2. This is the assertion the
    // component-scoped [3,4,4,4] pin cannot make, and it is the one that
    // fails when `headingLevel="h3"` is dropped from the strip's call
    // (mutation H-1).
    expect(headings().slice(0, 3)).toEqual([
      [2, "Interview copilot"],
      [3, QUESTION_TITLE],
      [3, DASHBOARD_TITLE],
    ]);
  });

  it("[guard — green before the change] skips no heading level anywhere on the page", () => {
    // Green today ([2,3,4,4,4] has no skip) and therefore a guard, not a
    // failing test. It is here because H-1's actual WCAG defect is the
    // h2 -> h4 skip it introduces, and a sequence equality assertion alone
    // would be satisfied by any future reshuffle that happened to match.
    const levels = headings().map(([level]) => level);
    expect(levels.length).toBeGreaterThan(0);
    for (let i = 1; i < levels.length; i += 1) {
      expect(
        levels[i],
        `heading ${i} (${JSON.stringify(headings()[i])}) skips a level after h${levels[i - 1]}`,
      ).toBeLessThanOrEqual(levels[i - 1] + 1);
    }
  });

  it("[guard — green before the change] renders the current-question title exactly once as a heading", () => {
    // Green today (one panel, one heading) and therefore a guard. It exists
    // for mutation H-2: someone "restores" <CurrentQuestionPanel> inside
    // CopilotDashboard to make the old component-scoped pins green again,
    // and the page then carries TWO "Current question" headings over two
    // panels showing the same thing. A sequence assertion fails that on
    // length alone; this one names the actual problem.
    const matches = headings().filter(([, text]) => text === QUESTION_TITLE);
    expect(matches).toHaveLength(1);
  });
});
