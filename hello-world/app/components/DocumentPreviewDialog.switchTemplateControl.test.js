// @vitest-environment jsdom
//
// N151c (4b) — S7 / T6-MOUNT, T8-MOUNT, T9: the "Switch template..." control in
// the preview modal (plan §E S7, OR-2/OR-3/OR-4). REACHABILITY: we mount the
// REAL DocumentPreviewDialog and operate the REAL control the way a user does —
// a direct handler call would not satisfy the criterion (this repo has shipped a
// panel with no opening button because tests called the mechanism directly).
//
// RED on HEAD: there is no onRegenerateIntoTemplate prop and no such control in
// DocumentPreviewDialog (grep), so [data-testid="switch-template-control"]
// resolves to null and every presence/operate query reds by absence.
//
// THE CONTROL CONTRACT this suite defines for the implementer (plan §E S7):
//   * On DOCX_SCOPES.includes(tab) && available(tab): a control
//     [data-testid="switch-template-control"] renders, a SIBLING of
//     DialogActions (NEVER inside .MuiDialogActions-root — F13 census), named
//     "Switch template..." (OR-2), distinct from the N104 "Regenerate...".
//   * It is disabled WITH a reason when !currentUser?.id OR
//     documentVersions[tab] is empty (OR-3); enabled when both hold.
//   * Operating it opens a picker: the N151b library list (REUSE
//     listLibraryTemplates) + a `.docx` upload input. A library pick ->
//     fetchLibraryTemplateFile(tab, id) -> onRegenerateIntoTemplate(tab, File).
//     A .docx upload -> onRegenerateIntoTemplate(tab, file) directly; a
//     non-.docx upload is refused in-control (OR-4: nothing POSTed to the
//     library).
//   * Absent on the email tab (no email template path).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const lib = vi.hoisted(() => ({
  listLibraryTemplates: null,
  fetchLibraryTemplateFile: null,
  registerTemplateFromBytes: null,
}));
vi.mock("@/lib/document/templateLibraryClient", () => ({
  listLibraryTemplates: (...a) => lib.listLibraryTemplates(...a),
  fetchLibraryTemplateFile: (...a) => lib.fetchLibraryTemplateFile(...a),
  registerTemplateFromBytes: (...a) => lib.registerTemplateFromBytes(...a),
  selectLibraryTemplate: vi.fn(async () => ({ ok: true })),
  deleteLibraryTemplate: vi.fn(async () => ({ ok: true })),
}));

import DocumentPreviewDialog from "./DocumentPreviewDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DOCX_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PREVIEW_HTML = `<p data-preview="body" style="margin:0;white-space:pre-wrap;">RESUME BODY LINE</p>`;

function driveProps(overrides = {}) {
  return {
    status: "connected", scopeCount: 2, connected: true, hasDriveReference: false, isStale: false,
    downloadStatus: "idle", onRefocusConsent: vi.fn(), onDownload: vi.fn(), leadingLine: null, rows: [],
    showConversionCaption: false, stale: false, reconnectCaption: false, hiringEmail: null, prompt: null,
    announcement: { polite: "", alert: "" }, saveToDrive: vi.fn(), ...overrides,
  };
}
function scopesFor() {
  return {
    resume: { available: true, text: "RESUME BODY LINE", html: PREVIEW_HTML, fileName: "Resume File" },
    cover: { available: true, text: "Dear Hiring Manager,", html: undefined, fileName: "Cover File" },
    email: { available: true, text: "Subject: Hi\n\nBody" },
  };
}
const VERSIONS = { resume: [{ id: "v1", content: "x", content_lines: ["x"], created_at: "2026-08-01T00:00:00Z" }], cover: [{ id: "c1", content: "y", content_lines: ["y"], created_at: "2026-08-01T00:00:00Z" }] };

function baseProps(overrides = {}) {
  return {
    open: true, jobTitle: "Staff Engineer", company: "Acme", initialTab: "resume",
    scopes: scopesFor(), engine: "embedded", loadModel: vi.fn(async () => ({ paragraphs: [] })),
    onSave: vi.fn(), onRenameFile: vi.fn(), onDownload: vi.fn(), onClose: vi.fn(),
    busy: {}, notice: {}, error: {}, drive: driveProps(), onActiveScopeChange: vi.fn(),
    spacing: null, onSetSpacing: vi.fn(),
    // N151c NEW props (ignored on HEAD):
    currentUser: { id: "user-1" },
    documentVersions: VERSIONS,
    currentVersionId: { resume: "v1", cover: "c1" },
    onSelectVersion: vi.fn(),
    onRegenerateIntoTemplate: vi.fn(),
    ...overrides,
  };
}

let container, root;
beforeEach(() => {
  lib.listLibraryTemplates = vi.fn(async () => ({ ok: true, templates: [{ id: "lib-1", name: "Clean Resume" }], selectedId: null }));
  lib.fetchLibraryTemplateFile = vi.fn(async () => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "Clean Resume.docx", { type: DOCX_CT }));
  lib.registerTemplateFromBytes = vi.fn(async () => ({ ok: true, row: { id: "x" }, selected: true }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

async function render(props) {
  await act(async () => { root.render(createElement(DocumentPreviewDialog, props)); });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
const control = () => document.querySelector('[data-testid="switch-template-control"]');
const dialogActions = () => document.querySelector(".MuiDialogActions-root");
function actionable() {
  const el = control();
  if (!el) return null;
  if (el.tagName === "BUTTON") return el;
  return el.querySelector("button, [role='button']") || el;
}
function accessibleName(el) {
  if (!el) return "";
  return (el.getAttribute("aria-label") || el.textContent || "").trim();
}
async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

// ---------------------------------------------------------------------------
// T9 — presence on DOCX tabs, ABSENCE on email; distinct name; keyboard-reachable
// ---------------------------------------------------------------------------
describe("T9 — the control is present on DOCX tabs and absent on email", () => {
  it("renders on the résumé tab (RED on HEAD: absent)", async () => {
    await render(baseProps({ initialTab: "resume" }));
    expect(control(), "no switch-template control on the résumé tab").toBeTruthy();
  });

  it("renders on the cover tab (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "cover" }));
    expect(control(), "no switch-template control on the cover tab").toBeTruthy();
  });

  it("does NOT render on the email tab (no email template path) (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "email" }));
    expect(control(), "the switch-template control must be absent on the email tab").toBeNull();
  });

  it("is keyboard-focusable (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "resume" }));
    const btn = actionable();
    expect(btn, "no actionable control").toBeTruthy();
    await act(async () => btn.focus());
    expect(document.activeElement).toBe(btn);
  });

  it('is named "Switch template…", NEVER "Regenerate" (avoids the N104 collision, F12) (RED on HEAD)', async () => {
    await render(baseProps({ initialTab: "resume" }));
    const name = accessibleName(actionable());
    expect(name.toLowerCase()).toContain("switch template");
    expect(name.toLowerCase(), "the name collides with the N104 'Regenerate...' control").not.toContain("regenerate");
  });
});

// ---------------------------------------------------------------------------
// T9 / F13 — the control is a SIBLING of DialogActions, never inside the bar.
// The AC-C12 census in DocumentPreviewDialog.copy.test.js pins the bar's
// button-shaped-control count EXACTLY; a control that leaked into the bar would
// invalidate that pin. Here: assert the control is NOT a descendant of the bar,
// and that adding the new props leaves the bar's count unchanged (guard —
// survives HEAD and impl).
// ---------------------------------------------------------------------------
describe("T9 / F13 — the control is OUTSIDE .MuiDialogActions-root", () => {
  it("the control is not a descendant of the action bar (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "resume" }));
    const el = control();
    expect(el, "no control to place").toBeTruthy();
    expect(dialogActions().contains(el), "the control mounted INSIDE DialogActions — it breaks the AC-C12 census").toBe(false);
  });

  it("adding the N151c props does not change the DialogActions button count (census guard)", async () => {
    const SEL = 'button, [role="button"], a[href]';
    await render(baseProps({ initialTab: "resume", onRegenerateIntoTemplate: undefined, currentUser: null }));
    const without = dialogActions().querySelectorAll(SEL).length;
    await act(async () => { root.render(createElement(DocumentPreviewDialog, baseProps({ initialTab: "resume" }))); });
    const withNew = dialogActions().querySelectorAll(SEL).length;
    expect(withNew, "the switch-template control changed the action bar's count").toBe(without);
  });
});

// ---------------------------------------------------------------------------
// T8-MOUNT — OR-3 disabled-with-reason (not hidden) when it cannot persist.
// ---------------------------------------------------------------------------
describe("T8-MOUNT — OR-3 gating (disabled-with-reason)", () => {
  function isDisabled(btn) {
    expect(btn, "no switch-template control rendered (RED on HEAD: absent)").toBeTruthy();
    return btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true";
  }
  function hasReason(el) {
    // A reason the user can perceive: an aria-label/title on the control or its
    // wrapping tooltip span, or an aria-describedby.
    const wrap = el.closest("[title]") || el.parentElement?.closest("[title]");
    return Boolean(
      el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("aria-describedby") || (wrap && wrap.getAttribute("title")),
    );
  }
  it("signed out -> present but DISABLED with a reason (RED on HEAD: absent)", async () => {
    await render(baseProps({ initialTab: "resume", currentUser: null }));
    const el = control();
    expect(el, "control must stay visible with a reason, not vanish, when signed out").toBeTruthy();
    const btn = actionable();
    expect(isDisabled(btn), "signed-out: the control must be disabled").toBe(true);
    expect(hasReason(el), "a disabled control must carry a reason the user can read").toBe(true);
  });

  it("no saved versions for the tab -> DISABLED (nothing to reformat) (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "resume", documentVersions: { resume: [], cover: [] } }));
    expect(isDisabled(actionable())).toBe(true);
  });

  it("[no-op control] signed in with a saved version -> ENABLED (RED on HEAD)", async () => {
    await render(baseProps({ initialTab: "resume" }));
    expect(isDisabled(actionable())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T6-MOUNT — operating the picker: a library pick and a .docx upload each reach
// onRegenerateIntoTemplate(tab, File); a non-.docx is refused in-control, and an
// uploaded File is TRANSIENT (nothing POSTed to the library — OR-4).
// ---------------------------------------------------------------------------
describe("T6-MOUNT — the picker drives onRegenerateIntoTemplate (both sources)", () => {
  async function openPicker(props) {
    await render(props);
    const btn = actionable();
    expect(btn, "no switch-template control to open the picker (RED on HEAD: absent)").toBeTruthy();
    await click(btn);
    await flush();
  }
  const fileInput = () => document.querySelector('input[type="file"]');

  it("opening the picker reveals a .docx upload input AND the library templates (RED on HEAD)", async () => {
    await openPicker(baseProps({ initialTab: "resume" }));
    const input = fileInput();
    expect(input, "no .docx upload input in the picker").toBeTruthy();
    expect((input.getAttribute("accept") || "").toLowerCase()).toContain(".docx");
    // The N151b library list is reused (listLibraryTemplates was asked).
    expect(lib.listLibraryTemplates, "the picker did not reuse the library list").toHaveBeenCalled();
    expect(document.body.textContent).toContain("Clean Resume");
  });

  it("picking a library template fetches its bytes and regenerates with that File (RED on HEAD)", async () => {
    const onRegen = vi.fn();
    await openPicker(baseProps({ initialTab: "resume", onRegenerateIntoTemplate: onRegen }));
    const option = [...document.querySelectorAll('button, [role="button"], li, [role="option"]')].find((el) =>
      (el.textContent || "").includes("Clean Resume"),
    );
    expect(option, "no library option to pick").toBeTruthy();
    await click(option);
    await flush();
    expect(lib.fetchLibraryTemplateFile).toHaveBeenCalledWith("resume", "lib-1");
    expect(onRegen).toHaveBeenCalledTimes(1);
    expect(onRegen.mock.calls[0][0]).toBe("resume");
    expect(onRegen.mock.calls[0][1]).toBeInstanceOf(File);
  });

  it("uploading a .docx regenerates with that File directly, and POSTs NOTHING to the library (OR-4) (RED on HEAD)", async () => {
    const onRegen = vi.fn();
    await openPicker(baseProps({ initialTab: "resume", onRegenerateIntoTemplate: onRegen }));
    const input = fileInput();
    const docx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "My Template.docx", { type: DOCX_CT });
    Object.defineProperty(input, "files", { value: [docx], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(onRegen).toHaveBeenCalledTimes(1);
    expect(onRegen.mock.calls[0][0]).toBe("resume");
    expect(onRegen.mock.calls[0][1]).toBeInstanceOf(File);
    // TRANSIENT: an on-the-spot upload is never added to the library.
    expect(lib.registerTemplateFromBytes, "the uploaded template was saved to the library (OR-4 violated)").not.toHaveBeenCalled();
  });

  it("a non-.docx upload is refused in-control: onRegenerateIntoTemplate is NOT called (RED on HEAD)", async () => {
    const onRegen = vi.fn();
    await openPicker(baseProps({ initialTab: "resume", onRegenerateIntoTemplate: onRegen }));
    const input = fileInput();
    const notDocx = new File(["plain"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [notDocx], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(onRegen, "a non-docx reached the regen handler (empty bytes would hit the override)").not.toHaveBeenCalled();
  });
});
