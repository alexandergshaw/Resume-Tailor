// @vitest-environment jsdom
//
// N144b S0 — the behavioural twin of LiveRail.extraction.test.js. The source
// test proves the ternary MOVED; this proves it still DECIDES correctly: the
// company-brief panel takes the rail's slot when `companyBrief.open`, otherwise
// the voice-cue sidebar does. Kills the "LiveRail hard-codes one branch" mutant
// (e.g. always VoiceCueSidebar, or collapsed={false}) that a source test cannot
// see.
//
// CompanyBriefPanel and VoiceCueSidebar are stubbed to text markers — the
// property under test is WHICH child the ternary mounts, not what either child
// renders (those have their own suites).
//
// RED on HEAD: app/copilot/LiveRail.js does not exist, so the import throws and
// the file fails to load. Intended red: the module is absent.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import { makeTheme } from "@/app/theme/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./CompanyBriefPanel", () => ({ default: () => createElement("div", null, "BRIEF-MARKER") }));
vi.mock("./VoiceCueSidebar", () => ({ default: () => createElement("div", null, "CUE-MARKER") }));

let LiveRail;
let container;
let root;

const baseBrief = (open) => ({
  open,
  status: "idle",
  articles: [],
  warnings: [],
  error: "",
  company: "",
  openBrief: vi.fn(),
  closeBrief: vi.fn(),
  refresh: vi.fn(),
});

const props = (open) => ({
  companyBrief: baseBrief(open),
  collapsed: false,
  onToggleCollapsed: vi.fn(),
  isEmbedded: true,
  hasCompany: false,
  speakerAttribution: {},
  speakerSnapshot: { userTag: null, confidence: "unknown", overridden: false, tags: [] },
});

beforeEach(async () => {
  ({ default: LiveRail } = await import("./LiveRail.js"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetModules();
});

async function mount(open) {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(LiveRail, props(open))));
  });
}

describe("LiveRail mounts the correct rail child for companyBrief.open", () => {
  it("open=false renders the voice-cue sidebar, not the brief panel", async () => {
    await mount(false);
    expect(container.textContent).toContain("CUE-MARKER");
    expect(container.textContent).not.toContain("BRIEF-MARKER");
  });

  it("open=true renders the company-brief panel, not the voice-cue sidebar", async () => {
    await mount(true);
    expect(container.textContent).toContain("BRIEF-MARKER");
    expect(container.textContent).not.toContain("CUE-MARKER");
  });
});
