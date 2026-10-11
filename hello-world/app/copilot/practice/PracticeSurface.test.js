// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-c (4b TDD seat) -- the PracticeSurface mount seam and
// the G1 non-collision instrument. Binds to docs/loop/N157.SC-C.design.r2.md
// section 5.2 (PracticeSurface and the mount seam, the HARD GATE) and findings
// F9 (the /^practice$/i label collision) and F10 (the seven mock-sites keep
// intercepting through PracticeSurface). Ledger DES-N157-C1, C24.
//
// WHAT THIS FILE DOES AND DOES NOT DO. The HARD GATE itself is the seven
// `vi.mock("./practice/PracticeClient")` suites passing UNMODIFIED after the
// rename; the implementer runs those and reads the `Test Files N failed |
// M passed` line (they are listed in tests.r1.md). This file carries the pieces
// of G1 that are a UNIT concern of PracticeSurface:
//   * it renders the MOCKED PracticeClient in practice mode -- proving
//     PracticeSurface imports "./PracticeClient", the resolved id the seven
//     suites mock (so their mock keeps intercepting through the new parent);
//   * it forwards the four practice props byte-identical;
//   * neither sub-view button's accessible name matches /^practice$/i, so
//     CopilotClient.roles.test.js's buttonNamed(/^practice$/i) still matches the
//     MODE button exactly once;
//   * StudyPlanClient mounts ONLY in the Study branch (no eager/hidden mount).
//
// RED on HEAD: app/copilot/practice/PracticeSurface.js does not exist yet, so
// the import throws and every `it` reds -- the honest greenfield red.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the two children exactly as the seven CopilotClient suites mock
// PracticeClient: by the module id PracticeSurface imports. If PracticeSurface
// imported some OTHER module, these mocks would not intercept and the stubs
// below would be absent -- which is the whole G1 property, made observable here.
let practiceProps = null;
vi.mock("./PracticeClient", () => ({
  default: (props) => {
    practiceProps = props;
    return createElement("div", { "data-testid": "practice-stub" }, "practice");
  },
}));
vi.mock("../study/StudyPlanClient", () => ({
  default: () => createElement("div", { "data-testid": "study-stub" }, "study"),
}));

let PracticeSurface;
beforeEach(async () => {
  practiceProps = null;
  ({ default: PracticeSurface } = await import("./PracticeSurface.js"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

let container;
let root;

const PROPS = {
  sttProviderName: "Deepgram",
  micDeviceId: "mic-7",
  onMicDeviceChange: () => {},
  onInterviewTypeAnnouncement: () => {},
};

async function mount(props = PROPS) {
  await act(async () => {
    root.render(createElement(PracticeSurface, props));
  });
}
async function click(btn) {
  expect(btn, "button not found").toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
}
const buttonByName = (name) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
const stub = (id) => document.body.querySelector(`[data-testid="${id}"]`);

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("PracticeSurface defaults to the Answer-aloud sub-view (OD-8)", () => {
  it("renders the mocked PracticeClient and NOT StudyPlanClient on first mount", async () => {
    await mount();
    // Positive control: the practice stub IS present, so the mount seam reached
    // the mocked child (not a vacuous "study is absent").
    expect(stub("practice-stub")).toBeTruthy();
    expect(stub("study-stub")).toBeNull();
  });

  it("forwards the four practice props byte-identical to PracticeClient", async () => {
    await mount();
    expect(practiceProps.sttProviderName).toBe("Deepgram");
    expect(practiceProps.micDeviceId).toBe("mic-7");
    expect(practiceProps.onMicDeviceChange).toBe(PROPS.onMicDeviceChange);
    expect(practiceProps.onInterviewTypeAnnouncement).toBe(PROPS.onInterviewTypeAnnouncement);
  });
});

describe("The two-button sub-view toggle (D-6, F9)", () => {
  it('exposes a group labelled "Practice tool" with buttons "Answer aloud" and "Study plan"', async () => {
    await mount();
    const group = document.body.querySelector('[aria-label="Practice tool"]');
    expect(group).toBeTruthy();
    expect(buttonByName("Answer aloud")).toBeTruthy();
    expect(buttonByName("Study plan")).toBeTruthy();
  });

  it("NEITHER sub-view button is named exactly /^practice$/i (no CopilotClient.roles mode-button collision)", async () => {
    await mount();
    const matches = [...document.body.querySelectorAll("button")].filter((b) => /^practice$/i.test(b.textContent.trim()));
    // A sub-view button named "Practice" would make CopilotClient.roles's
    // buttonNamed(/^practice$/i) match twice in practice mode. There must be ZERO
    // such buttons inside PracticeSurface itself (the MODE button lives above it).
    expect(matches).toHaveLength(0);
  });
});

describe("Switching sub-views mounts exactly one child (no eager/hidden Study mount)", () => {
  it("Study plan -> PracticeClient UNMOUNTS and StudyPlanClient mounts", async () => {
    await mount();
    await click(buttonByName("Study plan"));
    expect(stub("study-stub")).toBeTruthy();
    expect(stub("practice-stub")).toBeNull();
  });

  it("back to Answer aloud -> PracticeClient mounts again and Study unmounts", async () => {
    await mount();
    await click(buttonByName("Study plan"));
    await click(buttonByName("Answer aloud"));
    expect(stub("practice-stub")).toBeTruthy();
    expect(stub("study-stub")).toBeNull();
  });
});
