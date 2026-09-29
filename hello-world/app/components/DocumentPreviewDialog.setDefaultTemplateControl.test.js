// @vitest-environment jsdom
//
// N97 (4b) — AC-1 (the promote control is present + keyboard-reachable on the
// résumé and cover tabs, and STRUCTURALLY ABSENT on the email tab) and AC-7
// (the control reports the ACTIVE tab as the kind). REACHABILITY: we mount the
// REAL DocumentPreviewDialog and operate the REAL control the way the candidate
// does — a direct handler call would not satisfy AC-1 (this repo has shipped a
// panel with no opening button precisely because tests called the mechanism
// directly). The absence-on-email assertion is load-bearing: the
// resume_templates.kind CHECK excludes 'email', so a promote path on the email
// tab could only ever write an invalid row — the safe state is the control's
// ABSENCE there (AC-1 failure direction).
//
// RED-on-HEAD: no `onSetAsDefaultTemplate` prop and no such control exist in
// DocumentPreviewDialog (grep). `[data-testid="set-default-template-control"]`
// resolves to null, so every presence/operate query is red by absence.
//
// THE CONTROL CONTRACT this suite defines for the implementer (design §4.5):
//   * When DOCX_SCOPES.includes(tab) && available(tab): a control
//     [data-testid="set-default-template-control"] renders, ENABLED and
//     keyboard-focusable.
//   * Operating it commits the draft then calls
//     onSetAsDefaultTemplate(tab, <payload>) — tab === the active scope.
//   * On the email tab the control does NOT render (no email template path).
//
// NOTE: I do NOT pin the visible copy (1c's call); the control is found by its
// data-testid, matching the repo's spacing-control convention.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW_HTML =
  `<p data-preview="body" style="text-align:left;margin:0;white-space:pre-wrap;">RESUME BODY LINE</p>`;

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
    resume: { available: resumeAvailable, text: "RESUME BODY LINE", html: PREVIEW_HTML, fileName: "Resume File" },
    cover: { available: true, text: "Dear Hiring Manager,", html: undefined, fileName: "Cover File" },
    email: { available: true, text: "Subject: Hi\n\nBody" },
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
    onSetAsDefaultTemplate: vi.fn(), // NEW N97 prop, ignored on HEAD
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
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

// MUI Dialog portals to document.body.
const control = () => document.querySelector('[data-testid="set-default-template-control"]');
// The actionable button inside (or the control itself when it IS a button).
function actionable() {
  const el = control();
  if (!el) return null;
  if (el.tagName === "BUTTON") return el;
  return el.querySelector("button, [role='button']") || el;
}
async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("AC-1 — presence on DOCX tabs, ABSENCE on email", () => {
  it("renders the control on the résumé tab, enabled (RED on HEAD: absent)", async () => {
    await render(baseProps({ initialTab: "resume" }));
    const el = control();
    expect(el, "no set-as-default-template control on the résumé tab").toBeTruthy();
    const btn = actionable();
    expect(btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true").toBe(false);
  });

  it("renders the control on the cover tab (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "cover" }));
    expect(control(), "no control on the cover tab").toBeTruthy();
  });

  it("the control is KEYBOARD-focusable (native button or role=button with a tab stop) (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "resume" }));
    const btn = actionable();
    expect(btn, "no actionable control").toBeTruthy();
    const focusable =
      btn.tagName === "BUTTON" ||
      (btn.getAttribute("role") === "button" && Number(btn.getAttribute("tabindex")) >= 0);
    expect(focusable, "the control is not keyboard-reachable").toBe(true);
    await act(async () => btn.focus());
    expect(document.activeElement).toBe(btn);
  });

  it("does NOT render the control on the email tab (no email template path) (RED on HEAD via the DOCX-scope assertions above)", async () => {
    await render(baseProps({ initialTab: "email" }));
    // Absence is the SAFE state: kind='email' would violate the resume_templates
    // CHECK. A control that appeared here (even disabled) would be a defect.
    expect(control(), "the promote control must be absent on the email tab").toBeNull();
  });
});

describe("AC-7 — the control reports the ACTIVE tab as the kind", () => {
  it("clicking on the résumé tab calls onSetAsDefaultTemplate('resume', …) (RED on HEAD)", async () => {
    const spy = vi.fn();
    await render(baseProps({ initialTab: "resume", onSetAsDefaultTemplate: spy }));
    const btn = actionable();
    expect(btn, "no control to operate").toBeTruthy();
    await click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("resume");
  });

  it("clicking on the cover tab calls onSetAsDefaultTemplate('cover', …) — never hard-defaulted to 'resume' (RED on HEAD)", async () => {
    const spy = vi.fn();
    await render(baseProps({ initialTab: "cover", onSetAsDefaultTemplate: spy }));
    const btn = actionable();
    expect(btn, "no control to operate on cover").toBeTruthy();
    await click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("cover");
  });
});
