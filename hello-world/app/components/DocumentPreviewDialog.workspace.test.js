// @vitest-environment jsdom
// N178: semantic workspace journeys. Geometry, native keyboard/selection and
// live persistence require actual-browser evidence; this suite claims none.
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let removeInnerText;
beforeAll(() => {
  if (!("innerText" in document.createElement("div"))) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true, get() { return this.textContent; },
      set(value) { this.textContent = value; },
    });
    removeInnerText = () => { delete HTMLElement.prototype.innerText; };
  }
});
afterAll(() => removeInnerText?.());
let root, container;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function fixture() {
  return {
    open: true, jobTitle: "Staff Engineer", company: "Acme", initialTab: "resume",
    engine: "embedded",
    scopes: {
      resume: { available: true, text: "RESUME ORIGINAL", html: "<p>RESUME ORIGINAL</p>", fileName: "Resume File" },
      cover: { available: true, text: "COVER ORIGINAL", html: "<p>COVER ORIGINAL</p>", fileName: "Cover File" },
      email: { available: true, text: "Subject: Application\n\nEMAIL ORIGINAL" },
    },
    loadModel: vi.fn(async () => ({ paragraphs: [] })),
    onSave: vi.fn(), onClose: vi.fn(), onRenameFile: vi.fn(), onDownload: vi.fn(),
    onOpenFocusPicker: vi.fn(), onSetFraming: vi.fn(), onScrapePosting: vi.fn(),
    onResearchCompany: vi.fn(), onAskAi: vi.fn(), onResubmit: vi.fn(),
    onSetAsDefaultTemplate: vi.fn(), onRegenerateIntoTemplate: vi.fn(),
    onSelectVersion: vi.fn(), onSetSpacing: vi.fn(),
    documentVersions: { resume: [{ id: "v2", label: "Latest" }, { id: "v1", label: "Previous" }] },
    currentVersionId: { resume: "v2" }, busy: {}, notice: {}, error: {},
    drive: {
      status: "unconfigured", scopeCount: 2, connected: false, hasDriveReference: false,
      isStale: false, downloadStatus: "idle", onRefocusConsent: vi.fn(), onDownload: vi.fn(),
      leadingLine: null, rows: [], showConversionCaption: false, stale: false,
      reconnectCaption: false, hiringEmail: null, prompt: null,
      announcement: { polite: "", alert: "" }, saveToDrive: vi.fn(),
    },
  };
}
const normalize = (s) => (s || "").replace(/\s+/g, " ").trim();
function name(el) {
  return normalize(el.getAttribute("aria-label") ||
    (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || "").join(" ") || el.textContent);
}
function button(label) {
  return [...document.querySelectorAll("button")].find((el) => name(el) === label);
}
async function render(props) {
  await act(async () => root.render(createElement(DocumentPreviewDialog, props)));
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
}
async function click(el) {
  expect(el, "expected real rendered control").toBeTruthy();
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}
function tools() {
  const trigger = button("Document tools");
  expect(trigger, "secondary tools need a discoverable native button").toBeTruthy();
  const id = trigger.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const region = document.getElementById(id);
  expect(region, "disclosure target exists even while collapsed").toBeTruthy();
  expect(region.getAttribute("role")).toBe("region");
  expect(name(region)).toBeTruthy();
  return { trigger, region };
}
function structurallyHidden(el) {
  for (let node = el; node instanceof HTMLElement; node = node.parentElement) {
    if (node.hidden || node.style.display === "none" || node.style.visibility === "hidden") return true;
  }
  return false;
}
async function expandTools() {
  const target = tools();
  if (target.trigger.getAttribute("aria-expanded") !== "true") await click(target.trigger);
  expect(target.trigger.getAttribute("aria-expanded")).toBe("true");
  expect(structurallyHidden(target.region)).toBe(false);
  return target;
}
async function switchTab(label) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => name(el) === label);
  await click(tab);
  expect(tab.getAttribute("aria-selected")).toBe("true");
}
function noExternalActions(props) {
  for (const key of ["onResearchCompany", "onScrapePosting", "onAskAi", "onResubmit",
    "onSetAsDefaultTemplate", "onRegenerateIntoTemplate"]) expect(props[key]).not.toHaveBeenCalled();
}

it("names the modal and keeps secondary tools mounted, collapsed, and inert until requested", async () => {
  const props = fixture();
  await render(props);
  const dialog = document.querySelector('[role="dialog"]');
  const titleId = dialog.getAttribute("aria-labelledby");
  expect(titleId).toBeTruthy();
  expect(document.getElementById(titleId)?.textContent).toContain("Tailored documents");
  const { trigger, region } = tools();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(structurallyHidden(region)).toBe(true);
  expect(button("Edit")).toBeTruthy();
  expect(region.contains(button("Edit"))).toBe(false);
  const ask = button("Ask AI");
  expect(ask).toBeTruthy();
  expect(region.contains(ask)).toBe(true);
  await expandTools();
  await click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(structurallyHidden(region)).toBe(true);
  await expandTools();
  expect(button("Ask AI")).toBe(ask);
  expect(document.getElementById(trigger.getAttribute("aria-controls"))).toBe(region);
  expect(props.onSave).not.toHaveBeenCalled();
  noExternalActions(props);
});

it("keeps the current named editor and draft across tools toggles, then flushes on Close", async () => {
  const props = fixture();
  await render(props);
  await click(button("Edit"));
  const editor = document.querySelector('[contenteditable="true"]');
  expect(editor).toBeTruthy();
  expect(name(editor)).toBeTruthy();
  expect(editor.hasAttribute("aria-label") || editor.hasAttribute("aria-labelledby")).toBe(true);
  await act(async () => {
    editor.innerHTML = "<p>RESUME CHANGED IN CURRENT EDITOR</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const { trigger } = await expandTools();
  await click(trigger);
  await expandTools();
  expect(document.querySelector('[contenteditable="true"]')).toBe(editor);
  expect(editor.textContent).toBe("RESUME CHANGED IN CURRENT EDITOR");
  noExternalActions(props);
  const close = document.querySelector(".MuiDialogActions-root button");
  expect(name(close)).toBe("Close");
  await click(close);
  expect(props.onSave).toHaveBeenCalledWith("resume", expect.objectContaining({
    text: "RESUME CHANGED IN CURRENT EDITOR", html: "<p>RESUME CHANGED IN CURRENT EDITOR</p>",
  }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it("retains DOCX tools on their scopes and truthful read-only Email controls, resetting tools on reopen", async () => {
  const props = fixture();
  await render(props);
  await expandTools();
  expect(button("Edit")).toBeTruthy();
  expect(document.querySelector('[data-testid="set-default-template-control"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="spacing-control"]')).toBeTruthy();
  await switchTab("Cover letter");
  await expandTools();
  expect(button("Research company")).toBeTruthy();
  expect(button("Edit")).toBeTruthy();
  await switchTab("Hiring email");
  await expandTools();
  expect(document.querySelector('[role="dialog"]').textContent).toContain("Read-only");
  expect(button("Edit")).toBeUndefined();
  expect(button("Download .docx")).toBeUndefined();
  expect(document.querySelector('[data-testid="spacing-control"]')).toBeNull();
  expect(document.querySelector('[data-testid="set-default-template-control"]')).toBeNull();
  expect(button("Copy text of the hiring email")).toBeTruthy();
  noExternalActions(props);
  await render({ ...props, open: false });
  await render(props);
  expect(tools().trigger.getAttribute("aria-expanded")).toBe("false");
  expect(structurallyHidden(tools().region)).toBe(true);
});
