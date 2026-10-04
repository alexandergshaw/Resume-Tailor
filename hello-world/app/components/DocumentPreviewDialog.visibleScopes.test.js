// @vitest-environment jsdom
//
// N105 Step 5 (AC-17, D-10) -- the dialog's tab bar renders a mount-supplied
// `visibleScopes`, defaulting to the LEGACY three, never the raw SCOPES list.
// `hypothetical` is now a SCOPES member, so a dialog that still mapped SCOPES
// would show a disabled "Hypothetical resume (none)" tab in EVERY level 1-5
// preview. Mutant: revert the default (or the tab map) to SCOPES -> the first
// two tests red.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";
import { LEGACY_SCOPES } from "@/lib/tailor/documentScopes.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function driveProps() {
  return {
    status: "connected",
    scopeCount: 2,
    connected: true,
    hasDriveReference: false,
    isStale: false,
    downloadStatus: "idle",
    onRefocusConsent: vi.fn(),
    onDownload: vi.fn(),
    leadingLine: null,
    rows: [],
    showConversionCaption: false,
    stale: false,
    reconnectCaption: false,
    hiringEmail: null,
    prompt: null,
    announcement: { polite: "", alert: "" },
    saveToDrive: vi.fn(),
  };
}

// The hypothetical entry is AVAILABLE here on purpose: the default tab list
// must hide it on its own, not merely because the scope is unavailable.
function scopesWithHypothetical() {
  return {
    resume: { available: true, text: "RESUME BODY LINE", html: "<p>RESUME BODY LINE</p>", fileName: "Resume File" },
    cover: { available: true, text: "Dear Hiring Manager,", html: undefined, fileName: "Cover File" },
    email: { available: true, text: "Subject: Hi\n\nBody" },
    hypothetical: { available: true, text: "HYPOTHETICAL BODY", fileName: "[HYPOTHETICAL] Resume File" },
  };
}

function baseProps(overrides = {}) {
  return {
    open: true,
    jobTitle: "Staff Engineer",
    company: "Acme",
    initialTab: "resume",
    scopes: scopesWithHypothetical(),
    engine: "embedded",
    loadModel: vi.fn(async () => ({ paragraphs: [] })),
    onSave: vi.fn(),
    onRenameFile: vi.fn(),
    onDownload: vi.fn(),
    onClose: vi.fn(),
    busy: {},
    notice: {},
    error: {},
    drive: driveProps(),
    onActiveScopeChange: vi.fn(),
    spacing: null,
    onSetSpacing: vi.fn(),
    ...overrides,
  };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, props));
  });
}

// MUI Dialog portals to document.body.
const tabLabels = () =>
  [...document.querySelectorAll('[role="tab"]')].map((t) => (t.textContent || "").trim());

describe("N105 AC-17 -- the dialog renders visibleScopes, defaulting to the legacy three", () => {
  it("with no visibleScopes prop, exactly the three legacy tabs render and none is hypothetical", async () => {
    await render(baseProps());
    const labels = tabLabels();
    expect(labels).toEqual(["Resume", "Cover letter", "Hiring email"]);
    expect(labels.filter((l) => /hypothetical/i.test(l))).toEqual([]);
  });

  it("an unavailable hypothetical scope adds no tab either (not merely a disabled '(none)' one)", async () => {
    const scopes = scopesWithHypothetical();
    scopes.hypothetical = { available: false, text: "" };
    await render(baseProps({ scopes }));
    expect(tabLabels()).toHaveLength(LEGACY_SCOPES.length);
    expect(tabLabels().join("|")).not.toMatch(/hypothetical|\(none\)/i);
  });

  it("when the mount supplies visibleScopes with the hypothetical, it renders LAST", async () => {
    await render(baseProps({ visibleScopes: [...LEGACY_SCOPES, "hypothetical"] }));
    const labels = tabLabels();
    expect(labels).toHaveLength(LEGACY_SCOPES.length + 1);
    expect(labels[labels.length - 1]).toMatch(/hypothetical/i);
    expect(labels.slice(0, 3)).toEqual(["Resume", "Cover letter", "Hiring email"]);
  });
});
