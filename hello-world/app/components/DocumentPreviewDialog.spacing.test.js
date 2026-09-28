// @vitest-environment jsdom
//
// N69 (SPACING) — REACHABILITY: the spacing control is driven the way the
// candidate drives it. We mount the REAL DocumentPreviewDialog and operate the
// REAL control; a direct setter call would not satisfy CB-P-1/CB-L-3 (this repo
// has shipped a form with no save wiring and a panel with no opening button
// precisely because tests called the mechanism directly). Everything asserted
// here is an inline-style STRING on the read-only render — jsdom does no
// layout, so no height is ever read (N74).
//
// RED-on-HEAD: no spacing control exists anywhere in app/components +
// app/hooks (grep). `[data-testid="spacing-control"]` resolves to null, so
// every "operate the control" query is red by absence.
//
// THE CONTROL CONTRACT these tests define for the implementer (the tests ARE
// the interface):
//   * When DOCX_SCOPES.includes(tab) && available(tab): a region
//     [data-testid="spacing-control"] renders, ENABLED, exposing operable
//     options [data-testid="spacing-line-<multiplier>"] and
//     [data-testid="spacing-para-<pt>"] (real clickable controls).
//   * Operating an option calls onSetSpacing(scope, {lineSpacing,
//     paragraphSpacingPt}); the dialog applies the override to the read-only
//     render so <p> AND <li> inline styles move.
//   * When !available(tab): the region still renders, its options DISABLED,
//     with a stated reason — present, not absent (CB-D-3 clause ii).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A <p> and a <li> the candidate would see, with source-default margins so an
// applied override is a visible change (0pt -> 12pt) and an unset override is a
// visible non-change (<li> stays margin:0).
const PREVIEW_HTML =
  `<p data-preview="body" style="text-align:left;margin:0pt 0 0pt;white-space:pre-wrap;">SPACING BODY LINE</p>` +
  `<ul style="margin:0;padding-left:40px;"><li data-preview="bullet" style="margin:0;white-space:pre-wrap;">SPACING BULLET</li></ul>`;

function driveProps(overrides = {}) {
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
    ...overrides,
  };
}

function scopesFor({ resumeAvailable = true } = {}) {
  return {
    resume: { available: resumeAvailable, text: "SPACING BODY LINE\nSPACING BULLET", html: PREVIEW_HTML, fileName: "Resume File" },
    cover: { available: true, text: "Dear Hiring Manager,", html: undefined, fileName: "Cover File" },
    email: { available: false, text: "" },
  };
}

function baseProps(overrides = {}) {
  return {
    open: true,
    jobTitle: "Staff Engineer",
    company: "Acme",
    initialTab: "resume",
    scopes: scopesFor(),
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

// Wires onSetSpacing back into the `spacing` prop, exactly as page.js/
// DocumentPreviewMount own tailoringMap[jobId].spacing and feed it down (the
// same shape StatefulHost in the copy suite uses for onSave -> scopes). An
// implementation that instead holds the value in local dialog state still
// passes: we assert the RENDER changed, not where the value lives.
function SpacingHost({ onSetSpacingSpy, initialSpacing = null, ...rest }) {
  const [spacing, setSpacing] = useState(initialSpacing);
  const onSetSpacing = useCallback(
    (scope, value) => {
      onSetSpacingSpy?.(scope, value);
      setSpacing(value);
    },
    [onSetSpacingSpy],
  );
  return createElement(DocumentPreviewDialog, { ...rest, spacing, onSetSpacing });
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

async function render(Component, props) {
  await act(async () => {
    root.render(createElement(Component, props));
  });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

// MUI Dialog portals to document.body, so query the whole document.
const q = (sel) => document.querySelector(sel);
const previewEl = (attr) =>
  [...document.querySelectorAll(`[data-preview="${attr}"]`)].find((n) => n.textContent.includes("SPACING"));
async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("CB-P-1 / CB-L-3 — a reachable control changes the previewed spacing", () => {
  it("the spacing control is present and enabled on an available DOCX scope (RED on HEAD: absent)", async () => {
    await render(DocumentPreviewDialog, baseProps());
    expect(q('[data-testid="spacing-control"]'), "no spacing control in the dialog").toBeTruthy();
  });

  it("CB-P-1: operating the paragraph-spacing control moves the <p> bottom margin (RED on HEAD)", async () => {
    await render(SpacingHost, { ...baseProps(), onSetSpacingSpy: vi.fn() });
    expect(previewEl("body").getAttribute("style")).toMatch(/margin:0pt 0 0pt/); // before
    const opt = q('[data-testid="spacing-para-12"]');
    expect(opt, "no paragraph-spacing option").toBeTruthy();
    await click(opt);
    // 12pt of space after each paragraph, applied to the read-only render.
    expect(previewEl("body").getAttribute("style")).toMatch(/margin:0pt 0 12pt/);
  });

  it("CB-L-3: operating the line-spacing control moves the <p> line-height (RED on HEAD)", async () => {
    await render(SpacingHost, { ...baseProps(), onSetSpacingSpy: vi.fn() });
    expect(previewEl("body").getAttribute("style")).not.toMatch(/line-height:\s*1\.5/); // before
    const opt = q('[data-testid="spacing-line-1.5"]');
    expect(opt, "no line-spacing option").toBeTruthy();
    await click(opt);
    expect(previewEl("body").getAttribute("style")).toMatch(/line-height:\s*1\.5/);
  });
});

describe("CB-P-2 — list items honor the override; keep margin:0 when unset", () => {
  it("APPLY: operating paragraph spacing also moves the <li> bottom margin (RED on HEAD)", async () => {
    await render(SpacingHost, { ...baseProps(), onSetSpacingSpy: vi.fn() });
    expect(previewEl("bullet").getAttribute("style")).toMatch(/margin:0(;|\b)/); // unset default
    const opt = q('[data-testid="spacing-para-12"]');
    expect(opt, "no paragraph-spacing option").toBeTruthy();
    await click(opt);
    // The whole-document setting reaches the bullet too.
    expect(previewEl("bullet").getAttribute("style")).toMatch(/12pt/);
  });

  it("UNSET (invariant): with no override the <li> keeps its margin:0 (guards CB-R-1)", async () => {
    await render(SpacingHost, { ...baseProps(), initialSpacing: null, onSetSpacingSpy: vi.fn() });
    // No override operated -> the source default is untouched. Green today for
    // the render itself; the point is that the control's DEFAULT state does not
    // silently rewrite bullets.
    expect(previewEl("bullet").getAttribute("style")).toMatch(/margin:0;/);
    expect(previewEl("bullet").getAttribute("style")).not.toMatch(/12pt/);
  });
});

describe("CB-D-3 (ii) — degrade honestly, but only when nothing is downloadable", () => {
  it("PIN: control stays ENABLED whenever the scope is available (never hides a working capability) (RED on HEAD)", async () => {
    // The 'styled copy cleared but still downloadable' state surfaces to the
    // dialog as available(tab)===true, where a post-pass sweep still applies —
    // so the control must NOT be disabled there.
    await render(SpacingHost, { ...baseProps(), onSetSpacingSpy: vi.fn() });
    const opt = q('[data-testid="spacing-para-12"]');
    expect(opt).toBeTruthy();
    expect(opt.hasAttribute("disabled") || opt.getAttribute("aria-disabled") === "true").toBe(false);
  });

  it("DEGRADE: when the scope is not available the control is present but disabled (not absent) (RED on HEAD)", async () => {
    await render(SpacingHost, {
      ...baseProps({ scopes: scopesFor({ resumeAvailable: false }), initialTab: "resume" }),
      onSetSpacingSpy: vi.fn(),
    });
    const control = q('[data-testid="spacing-control"]');
    // Present-and-disabled is distinct from absent: a control that simply never
    // renders would pass an "is it disabled?" check vacuously.
    expect(control, "the disabled control must still RENDER, not vanish").toBeTruthy();
    const opt = q('[data-testid="spacing-para-12"]');
    expect(opt && (opt.hasAttribute("disabled") || opt.getAttribute("aria-disabled") === "true")).toBe(true);
  });
});
