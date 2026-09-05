// @vitest-environment jsdom
//
// THE ACCEPTANCE SUITE for "copy the text from the resume and cover letter
// sections of the preview/edit modal", against the REAL DocumentPreviewDialog.
//
// Domain framing, because it decides which assertions are worth writing: the
// user copies this text to paste into an ATS web form. The paste target is a
// text/plain textarea. What must be true is that the string in the paste
// buffer is THE DOCUMENT THEY WERE LOOKING AT, complete, in order, with line
// and paragraph boundaries intact. A silent truncation, a lost bullet
// boundary, a fused sign-off, or the OTHER tab's document costs a real job
// application. The two measured harms are a STALE PRE-EDIT paste and a paste
// MISSING EVERY BULLET -- and both are observable only on the SUCCESS path.
//
// ===========================================================================
// THE JSDOM CLIPBOARD SEAM -- read this before adding a test to this file.
// ===========================================================================
// Measured here: `document.execCommand`, `navigator.clipboard`,
// `ClipboardEvent` and `DataTransfer` are ALL undefined. So with the shipped
// default deps every click takes the same failure branch, the success region
// is never fed, and a suite that asserts only "an outcome was announced" is
// green while measuring nothing -- which is precisely the state in which the
// two harms above would be asserted by nothing at all.
//
// Hence a NAMED install/remove pair, an afterEach that restores genuine
// absence (`delete`, never `= undefined`: an assignment leaves a truthy own
// key, so `"clipboard" in navigator` becomes true for every later file
// sharing this worker under --no-file-parallelism), and two controls:
//
//   POSITIVE CONTROL  no stub installed -> the alert region is fed and the
//                     polite region is exactly "".
//   NEGATIVE CONTROL  stub installed and resolving -> the polite region is
//                     non-empty AND the alert region is exactly "".
//
// `expect(region.textContent).not.toBe("")` on one region alone is banned.
//
// REGION SELECTION: by `data-copy-status`, NEVER by role.
// `document.querySelector('[role="status"]')` in this dialog resolves to
// DriveResultRegion's region, which the DOM-order invariant puts ABOVE the
// copy strip -- so the naive selector reads Drive's always-empty region and
// the success assertion is red for the wrong reason, or green for the wrong
// one. Repo precedent for the attribute: data-testid="scope-error" /
// "scope-notice" in this very component, queried by the drive suite.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createElement, act, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";
import { htmlToPlainText } from "@/lib/document/htmlToPlainText.js";
import { renderModelToHtml, linesToModel } from "@/lib/document/docxPreview.js";
import { markVersionChanges } from "@/lib/document/versionDiff.js";
import { emailPreviewLines } from "@/lib/tailor/documentScopes.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// the innerText polyfill -- scoped to this file, removed in afterAll
// ---------------------------------------------------------------------------
// jsdom implements NO HTMLElement.prototype.innerText at all. commitDraft and
// activePayload both read editorRef.current.innerText, so without this
// AC-C4's POSITIVE CONTROL (focus -> blur -> onSave fires with the typed text)
// asserts nothing. Never left behind: a leak poisons every other file sharing
// this worker under --no-file-parallelism.
let removeInnerTextPolyfill = null;
beforeAll(() => {
  if (!("innerText" in document.createElement("div"))) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = value;
      },
    });
    removeInnerTextPolyfill = () => {
      delete HTMLElement.prototype.innerText;
    };
  }
});
afterAll(() => {
  removeInnerTextPolyfill?.();
});

// ---------------------------------------------------------------------------
// the seam
// ---------------------------------------------------------------------------

let removeClipboardStub = null;
let removeExecCommandStub = null;
let writeTextCalls;

function installClipboardStub({ writeText } = {}) {
  writeTextCalls = [];
  navigator.clipboard = {
    writeText:
      writeText ||
      ((t) => {
        writeTextCalls.push(t);
        return Promise.resolve();
      }),
    write: vi.fn(async () => {}),
  };
  removeClipboardStub = () => {
    delete navigator.clipboard;
  };
}

function installExecCommandStub(fn) {
  document.execCommand = fn;
  removeExecCommandStub = () => {
    delete document.execCommand;
  };
}

// Hand-built and CANCELABLE, dispatched separately: a stubbed execCommand
// fires no copy event of its own (measured), and a non-cancelable event
// reports defaultPrevented === false after preventDefault().
function dispatchCopyEvent(store) {
  const ev = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    configurable: true,
    value: {
      setData: (type, value) => {
        store.push({ type, value });
      },
    },
  });
  document.dispatchEvent(ev);
  return ev;
}

const lastCopied = () => writeTextCalls[writeTextCalls.length - 1];

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

// The hand-edited corpus of AC-C1.6: 7 top-level children (H2, P, P, H3, UL,
// DIV, P) comprising 9 line-bearing block nodes of which 6 are NON-<p>, with 9
// content lines and 1 blank line. Hand-authored to model Chrome's
// contentEditable output; every construct traces to a producer in AC-C1.3's
// table. This is the corpus a querySelectorAll("p") implementation loses 6 of
// 9 content lines on -- a resume pasted into an ATS with every bullet missing.
const NBSP = String.fromCharCode(0x00a0);
const HAND_EDITED_RESUME_HTML =
  "<h2>ALEX SHAW</h2>" +
  "<p>Staff Engineer<br>Omaha, NE</p>" +
  '<p style="min-height:0.9em;"><br></p>' +
  "<h3>EXPERIENCE</h3>" +
  "<ul><li>Led migration</li><li>Built pipeline</li><li>Shipped v2</li></ul>" +
  "<div>Added by pressing Enter</div>" +
  `<p>Skills: JS,${NBSP}SQL</p>`;
const BULLETS = ["Led migration", "Built pipeline", "Shipped v2"];

const MODEL_RESUME_LINES = ["MODEL RESUME NAME", "", "MODEL SUMMARY   ", "MODEL BULLET"];
const MODEL_COVER_LINES = ["Dear Hiring Manager,", "", "MODEL COVER BODY", "", "Sincerely,\nAlex Shaw"];
const EMAIL_ENTRY = {
  emailSubject: "Application: Staff Engineer",
  emailResultLines: ["Hi there,", "", "Please find my resume attached.  ", "", "Thanks,", "Alex Shaw"],
};
const EMAIL_LINES = emailPreviewLines(EMAIL_ENTRY);

const modelFor = (scope) =>
  linesToModel(scope === "resume" ? MODEL_RESUME_LINES : scope === "cover" ? MODEL_COVER_LINES : EMAIL_LINES);

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

// Forked from the drive suite's baseScopes rather than reused: that fixture
// gives resume AND cover a non-empty `html`, so isHandEdited is true and
// ensureLoaded NEVER calls loadModel -- the model branch would be untested --
// and its `email: { available: false }` means the email tab cannot render at
// all (SCOPES.find(available) reseeds `tab` away from it).
function scopesFor({ handEdited = false, emailAvailable = true } = {}) {
  return {
    resume: {
      available: true,
      text: MODEL_RESUME_LINES.join("\n"),
      html: handEdited ? HAND_EDITED_RESUME_HTML : undefined,
      fileName: "Resume File",
    },
    cover: {
      available: true,
      text: MODEL_COVER_LINES.join("\n"),
      html: undefined,
      fileName: "Cover File",
    },
    email: { available: emailAvailable, text: EMAIL_LINES.join("\n") },
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
    loadModel: vi.fn(async (scope) => modelFor(scope)),
    onSave: vi.fn(),
    onRenameFile: vi.fn(),
    onDownload: vi.fn(),
    onClose: vi.fn(),
    busy: {},
    notice: {},
    error: {},
    drive: driveProps(),
    onActiveScopeChange: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let container;
let root;

beforeEach(() => {
  writeTextCalls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  removeClipboardStub?.();
  removeClipboardStub = null;
  removeExecCommandStub?.();
  removeExecCommandStub = null;
});

async function render(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, props));
  });
  // MUI's Dialog portals to document.body, so a previously-mounted dialog
  // stays reachable by document.querySelector(".MuiDialogActions-root"). A
  // six-branch probe returned BYTE-IDENTICAL output for all six branches
  // until every render unmounted the previous one -- so this assertion is not
  // hygiene, it is the thing that makes every selector below mean anything.
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

// A stateful parent that feeds onSave's payload back into `scopes` exactly as
// DocumentPreviewMount.js does, and tracks `edited` the way
// saveDocumentPreview does (unconditionally, with no dirty check -- AC section 0.4).
function StatefulHost({ initialScopes, onSaveSpy, ...rest }) {
  const [scopes, setScopes] = useState(initialScopes);
  const onSave = useCallback(
    (scope, payload) => {
      onSaveSpy?.(scope, payload);
      setScopes((prev) => ({ ...prev, [scope]: { ...prev[scope], text: payload.text, html: payload.html } }));
    },
    [onSaveSpy],
  );
  return createElement(DocumentPreviewDialog, { ...rest, scopes, onSave });
}

// `saveDocumentPreview` sets `edited: withEditedScope(entry, scope, true)`
// UNCONDITIONALLY -- there is no dirty check anywhere on that path -- so "this
// scope's `edited` flag flipped" is exactly "onSave fired for this scope".
// Derived from the spy rather than tracked in a mutable container, which this
// repo's react-hooks lint rules forbid inside a component.
const editedScopes = (spy) => new Set(spy.mock.calls.map(([scope]) => scope));

async function renderStateful(props) {
  await act(async () => {
    root.render(createElement(StatefulHost, props));
  });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

const dialogActions = () => document.querySelector(".MuiDialogActions-root");
const buttons = () => [...document.querySelectorAll("button")];
const findButtonByText = (text) => buttons().find((b) => b.textContent.trim() === text);
const copyControl = () => findButtonByText("Copy text");
const editableEl = () => document.querySelector('[contenteditable="true"]');

const politeRegion = () => document.querySelector('[data-copy-status="polite"]');
const alertRegion = () => document.querySelector('[data-copy-status="alert"]');
const chipRegion = () => document.querySelector('[data-copy-status="chip"]');

// The read-only preview surface: the one direct child of DialogContent that is
// neither the scope-error/notice box nor the editor. Located by what it IS,
// never by a numeric index into the action bar (AC section 0.8 measures that every
// such index is unstable across branches).
function previewSurface() {
  const content = document.querySelector(".MuiDialogContent-root");
  if (!content) return null;
  return (
    [...content.children].find(
      (el) => !el.hasAttribute("data-testid") && el.getAttribute("contenteditable") !== "true",
    ) || null
  );
}

async function clickCopy() {
  await act(async () => {
    copyControl().click();
  });
}

async function switchTab(label) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === label);
  expect(tab).toBeTruthy();
  await act(async () => {
    tab.click();
  });
}

async function enterEditMode() {
  await act(async () => {
    findButtonByText("Edit").click();
  });
}

async function typeInEditor(html) {
  const editor = editableEl();
  editor.innerHTML = html;
  await act(async () => {
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function wait(ms) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

// Every <textarea> ADDED to the document while `run` executes.
//
// The step-3 fence cannot be observed after the fact: writePlainText removes
// the node in a `finally`, so `document.querySelectorAll("textarea").length` is
// 0 whether or not the fallback ran (measured -- view mode adds one and leaves
// none behind, edit mode adds none). Only the CREATION discriminates, so the
// absence assertion is paired with an observer that can see a presence.
async function textareasCreatedDuring(run) {
  const added = [];
  const collect = (records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.tagName === "TEXTAREA") added.push(node);
      }
    }
  };
  const observer = new window.MutationObserver(collect);
  observer.observe(document.body, { childList: true, subtree: true });
  await run();
  collect(observer.takeRecords());
  observer.disconnect();
  return added;
}

function accessibleName(el) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.querySelector(`#${CSS.escape(id)}`)?.textContent || "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  const text = (clone.textContent || "").trim();
  return text || (el.getAttribute("title") || "").trim();
}

// Copied from DocumentPreviewDialog.drive.test.js lines 537-543, local to
// describe("AC-E14: no Drive action writes busy/notice/error, pinned across all ten gated controls")
// and therefore not importable.
function isDisabled(el) {
  if (!el) return null;
  if (el.disabled === true) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.classList?.contains("Mui-disabled")) return true;
  return false;
}

function nonEmptyString(value) {
  expect(typeof value).toBe("string");
  expect(value.length).toBeGreaterThan(0);
  return value;
}

// `readFileSync(new URL(rel, import.meta.url))` -- the idiom
// lib/drive/lineCeiling.test.js uses -- throws "The URL must be of scheme
// file" under a jsdom-environment file, because the global URL there is
// jsdom's class and node:fs does not accept it. fileURLToPath takes the string
// and hands back a plain path, which node:fs always accepts.
const HERE = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel) => readFileSync(join(HERE, rel), "utf8");

const DIALOG_SOURCE = srcOf("DocumentPreviewDialog.js");
const CHAT_PANEL_SOURCE = srcOf("ChatPanel.js");

// Source text with comments removed. Every source-shape assertion below runs
// against this rather than the raw file, because the invariant those rows guard
// is one whose ONLY protection today is a comment -- and a comment is exactly
// what a later reader deletes, a formatter rewraps, or a linter's
// "remove commented-out code" rule tidies away. A shape assertion that a
// comment can satisfy guards nothing. The `[^:"'`]` guard keeps an "https://"
// inside a string literal from eating the rest of its line.
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const DIALOG_CODE = codeOnly(DIALOG_SOURCE);

// ---------------------------------------------------------------------------
// harness controls
// ---------------------------------------------------------------------------

describe("harness controls", () => {
  it("no-op arithmetic passes -- if this is not green, nothing else in this file can be trusted", () => {
    expect(1 + 1).toBe(2);
  });

  it("this jsdom supplies NO clipboard surface at all, which is what the seam exists for", () => {
    expect(typeof document.execCommand).toBe("undefined");
    expect(typeof navigator.clipboard).toBe("undefined");
    expect(typeof ClipboardEvent).toBe("undefined");
    expect(typeof DataTransfer).toBe("undefined");
  });

  it("the innerText polyfill is installed, so AC-C4's positive control can observe a blur-commit", () => {
    expect("innerText" in document.createElement("div")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-C5.2 / AC-C18.2 -- one control, on every tab, inside the action bar
// ---------------------------------------------------------------------------

describe("AC-C5.2: exactly ONE copy control on every tab, and it is inside DialogActions", () => {
  it.each([
    ["Resume", "resume"],
    ["Cover letter", "cover"],
    ["Hiring email", "email"],
  ])("%s tab", async (tabLabel, _scope) => {
    await render(baseProps());
    await switchTab(tabLabel);
    const controls = buttons().filter((b) => b.textContent.trim() === "Copy text");
    expect(controls).toHaveLength(1);
    expect(dialogActions().contains(controls[0])).toBe(true);
    // The one structural assertion that survives the bar's real DOM shape:
    // the variant class lands on the button itself, unaffected by any
    // wrapper. Exactly one contained button per tab -- Download .docx on
    // resume/cover, the copy control on email, never both.
    expect(dialogActions().querySelectorAll(".MuiButton-contained")).toHaveLength(1);
  });

  it("the email tab loses its old \"Copy email\" control entirely", async () => {
    await render(baseProps());
    await switchTab("Hiring email");
    expect(findButtonByText("Copy email")).toBeUndefined();
    expect(findButtonByText("Download .docx")).toBeUndefined();
    expect(copyControl()).toBeTruthy();
    // On email the copy control is the tab's only delivery action, so it
    // takes the contained variant and lands in exactly the slot Copy email
    // occupies today.
    expect(copyControl().classList.contains("MuiButton-contained")).toBe(true);
  });

  it("on resume and cover it is outlined, immediately before Download .docx", async () => {
    await render(baseProps());
    const download = findButtonByText("Download .docx");
    expect(download).toBeTruthy();
    expect(copyControl().classList.contains("MuiButton-outlined")).toBe(true);
    // Nothing a returning user has muscle memory for moves: Download .docx
    // keeps the rightmost position.
    const position = copyControl().compareDocumentPosition(download);
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("is a DIRECT child of DialogActions -- no Tooltip, no span, no wrapper Box", async () => {
    // A span-wrapped tooltip reaches no accessible name and no accessible
    // description (measured at Tooltip.js), and the wrapper is what creates
    // the index shift that killed every DOM-index assertion in this bar.
    await render(baseProps());
    expect(copyControl().parentElement).toBe(dialogActions());
  });
});

// ---------------------------------------------------------------------------
// AC-C11.2 / O-4 -- the DOM-order INVARIANT
// ---------------------------------------------------------------------------

describe("AC-C11 / O-4: DriveResultRegion -> CopyFeedbackStrip -> DialogActions, as an INVARIANT", () => {
  it("puts the strip OUTSIDE DialogActions, between DriveResultRegion and the bar", async () => {
    await render(baseProps());
    const polite = politeRegion();
    const alert = alertRegion();
    expect(polite).toBeTruthy();
    expect(alert).toBeTruthy();
    // UX.md rev 2 section 3, quoted verbatim in DriveActions.js's header: "No long
    // string is ever a sibling of the buttons." And structurally: no message
    // can ever contribute to the bar's wrap decision on a 375 px phone.
    expect(dialogActions().contains(polite)).toBe(false);
    expect(dialogActions().contains(alert)).toBe(false);
    expect(dialogActions().contains(chipRegion())).toBe(false);
    const position = polite.compareDocumentPosition(findButtonByText("Close"));
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("keeps the FIRST [role=\"status\"] in the document as DriveResultRegion's, not the strip's", async () => {
    // This is why the order is an invariant rather than a preference.
    // DocumentPreviewDialog.drive.test.js reads
    // document.querySelector('[role="status"]') -- the FIRST such node in
    // document order -- inside a test titled "renders unconditionally, ABOVE
    // DialogActions (the ReviseStrip slot), never inside the action bar".
    // Put the copy strip first and that assertion still PASSES while
    // measuring the wrong element, and nothing goes red.
    await render(baseProps());
    const firstStatus = document.querySelector('[role="status"]');
    const firstAlert = document.querySelector('[role="alert"]');
    expect(firstStatus.hasAttribute("data-copy-status")).toBe(false);
    expect(firstAlert.hasAttribute("data-copy-status")).toBe(false);
    // ...and the strip's own regions really do exist and really do carry the
    // roles, so the two assertions above are about ORDER and not about a
    // strip that forgot its roles.
    expect(politeRegion().getAttribute("role")).toBe("status");
    expect(alertRegion().getAttribute("role")).toBe("alert");
    const position = firstStatus.compareDocumentPosition(politeRegion());
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("mounts both strip regions EMPTY on the first render of the open lifetime", async () => {
    await render(baseProps());
    expect(politeRegion().textContent).toBe("");
    expect(alertRegion().textContent).toBe("");
    expect(chipRegion().textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// THE TWO SEAM CONTROLS, on the real dialog
// ---------------------------------------------------------------------------

describe("the clipboard seam's two controls, on the real dialog", () => {
  it("POSITIVE CONTROL: with NO stub installed, a click feeds the ALERT region and leaves polite exactly \"\"", async () => {
    // Measured: with the shipped default deps writePlainText returns
    // {ok:false, via:"copyEvent", reason:"unavailable"} in this environment.
    // Without this row, a beforeEach that silently failed to install a stub
    // would be indistinguishable from a working one -- both produce "an
    // outcome was announced".
    await render(baseProps());
    await clickCopy();
    nonEmptyString(alertRegion().textContent);
    expect(politeRegion().textContent).toBe("");
  });

  it("NEGATIVE CONTROL: with the stub resolving, polite is fed and the ALERT region is exactly \"\"", async () => {
    installClipboardStub();
    await render(baseProps());
    await clickCopy();
    nonEmptyString(politeRegion().textContent);
    expect(alertRegion().textContent).toBe("");
    expect(writeTextCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-C1 -- the clipboard IS the surface on screen
// ---------------------------------------------------------------------------

describe("AC-C1: the clipboard is the text of the surface on screen, by ONE function", () => {
  it("view mode, model branch: the copied string is htmlToPlainText of the surface's own innerHTML", async () => {
    installClipboardStub();
    await render(baseProps());
    const surface = previewSurface();
    // Corpus self-test: the surface really is showing the model document, so
    // the equality below is not comparing two empty strings.
    expect(surface.innerHTML).toContain("MODEL RESUME NAME");
    await clickCopy();
    expect(lastCopied()).toBe(htmlToPlainText(surface.innerHTML));
    expect(nonEmptyString(lastCopied())).toContain("MODEL RESUME NAME");
    // The rejected per-line trailing-whitespace strip would eat this.
    expect(lastCopied()).toContain("MODEL SUMMARY   ");
  });

  it("view mode, HAND-EDITED branch: the copy carries all three bullets", async () => {
    // THE MEASURED HARM. A querySelectorAll("p") implementation loses 6 of
    // this corpus's 9 content lines -- a resume pasted into an ATS with every
    // bullet missing.
    installClipboardStub();
    await render(baseProps({ scopes: scopesFor({ handEdited: true }) }));
    await clickCopy();
    const copied = nonEmptyString(lastCopied());
    expect(copied).toBe(htmlToPlainText(HAND_EDITED_RESUME_HTML));
    for (const bullet of BULLETS) {
      expect(copied).toContain(bullet);
    }
    // The <br> boundary survives as a real newline rather than fusing, the
    // same fusion class as "Sincerely,Alex Shaw".
    expect(copied).toContain("Staff Engineer\nOmaha, NE");
    // AC-C1.4's single substitution, with its corpus self-test.
    expect(HAND_EDITED_RESUME_HTML).toContain(NBSP);
    expect(copied).not.toContain(NBSP);
    expect(copied).toContain("Skills: JS, SQL");
  });

  it("the hiring email tab preserves emailPreviewLines' invariant byte for byte", async () => {
    // documentScopes.js's own doc comment states the invariant this feature
    // must uphold: the preview render model and the copy control are the same
    // text. Unifying on htmlToPlainText PRESERVES it; the modelToLines
    // unification that was proposed instead would have broken it.
    installClipboardStub();
    await render(baseProps());
    await switchTab("Hiring email");
    await clickCopy();
    expect(lastCopied()).toBe(EMAIL_LINES.join("\n"));
  });

  it("AC-C14.5 / D1: the render site AND the copy both prefer scopes[tab].html over the stale docState", async () => {
    // THE OTHER MEASURED HARM, and a live shipped bug this change fixes.
    // docState is NEVER invalidated by a hand-edit (commitDraft is not among
    // its writers, and ensureLoaded is gated on !docState[tab] so it never
    // re-runs) -- so today the read-only surface shows the PRE-EDIT document
    // after every hand-edit, and a select-all-copy from it puts the document
    // the user did NOT write onto the clipboard.
    installClipboardStub();
    const props = baseProps();
    await render(props); // model branch: docState.resume.html is the MODEL html
    expect(previewSurface().innerHTML).toContain("MODEL RESUME NAME");

    // A commit lands: scopes.resume.html now holds the edited document while
    // docState.resume.html still holds the model one.
    await render({ ...props, scopes: { ...props.scopes, resume: { ...props.scopes.resume, html: HAND_EDITED_RESUME_HTML } } });
    expect(props.loadModel).toHaveBeenCalledTimes(1); // no re-parse: docState was not invalidated

    expect(previewSurface().innerHTML).toContain("ALEX SHAW");
    expect(previewSurface().innerHTML).not.toContain("MODEL RESUME NAME");
    await clickCopy();
    expect(nonEmptyString(lastCopied())).toContain("Led migration");
    expect(lastCopied()).not.toContain("MODEL RESUME NAME");
    // Screen and clipboard are the same string, by construction.
    expect(lastCopied()).toBe(htmlToPlainText(previewSurface().innerHTML));
  });
});

// ---------------------------------------------------------------------------
// AC-C2 -- the ACTIVE tab's document, and its announcement
// ---------------------------------------------------------------------------

describe("AC-C2: the copied document is the ACTIVE tab's, and so is its announcement", () => {
  it("copying on the cover tab never carries the resume's sentinel, even with an uncommitted resume draft", async () => {
    installClipboardStub();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy: vi.fn() });
    await enterEditMode();
    await typeInEditor("<p>RESUME SENTINEL DO NOT LEAK</p>");
    await switchTab("Cover letter");
    await clickCopy();
    const copied = nonEmptyString(lastCopied());
    expect(copied).not.toContain("RESUME SENTINEL DO NOT LEAK");
    expect(copied).toContain("MODEL COVER BODY");
  });

  it("announces the scope captured at CLICK time when the tab changes while the write is pending", async () => {
    // S14, a slow permission prompt. Without the snapshot the user hears
    // "Cover letter text copied." for a resume copy -- and acts on it.
    let resolveWrite;
    installClipboardStub({
      writeText: (t) => {
        writeTextCalls.push(t);
        return new Promise((resolve) => {
          resolveWrite = resolve;
        });
      },
    });
    await render(baseProps());
    await clickCopy();
    expect(politeRegion().textContent).toBe(""); // still in flight
    await switchTab("Cover letter");
    await act(async () => {
      resolveWrite();
    });
    const announced = nonEmptyString(politeRegion().textContent);
    expect(announced.toLowerCase()).toContain("resume");
    expect(announced.toLowerCase()).not.toContain("cover letter");
  });
});

// ---------------------------------------------------------------------------
// AC-C3 / AC-C8 -- edit mode reads the LIVE editor
// ---------------------------------------------------------------------------

describe("AC-C3 / AC-C8: edit mode copies the live editor; view mode the rendered html; one function for both", () => {
  it("copies what was typed BEFORE the 600 ms debounce has committed anything", async () => {
    // The contentEditable changes WITHOUT a re-render: onInput writes
    // draftHtmlRef.current[tab] and calls scheduleAutoSave, whose only state
    // write is setSaveStatus("saving") -- a no-op after the first keystroke of
    // a burst. So any value computed during render is up to 600 ms stale.
    installClipboardStub();
    const onSaveSpy = vi.fn();
    const props = baseProps();
    await renderStateful({ ...props, initialScopes: scopesFor(), onSaveSpy });
    await enterEditMode();
    await typeInEditor(HAND_EDITED_RESUME_HTML);
    await clickCopy();
    expect(onSaveSpy).not.toHaveBeenCalled(); // nothing committed yet
    // Byte for byte: no .trim(), no /\n+/ collapsing anywhere between the
    // function and the write.
    expect(lastCopied()).toBe(htmlToPlainText(editableEl().innerHTML));
    for (const bullet of BULLETS) {
      expect(nonEmptyString(lastCopied())).toContain(bullet);
    }
  });

  it("after the commit, Preview shows and copies the SAME text, and the model is never re-parsed", async () => {
    installClipboardStub();
    const onSaveSpy = vi.fn();
    const props = baseProps();
    await renderStateful({ ...props, initialScopes: scopesFor(), onSaveSpy });
    await enterEditMode();
    await typeInEditor(HAND_EDITED_RESUME_HTML);
    await wait(700); // the debounce lands
    expect(onSaveSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      findButtonByText("Preview").click();
    });
    await clickCopy();
    expect(lastCopied()).toBe(htmlToPlainText(previewSurface().innerHTML));
    for (const bullet of BULLETS) {
      expect(nonEmptyString(lastCopied())).toContain(bullet);
    }
    // The hand-edited branch must not re-parse: exactly one loadModel call
    // across the whole sequence, from the initial view-mode load.
    expect(props.loadModel).toHaveBeenCalledTimes(1);
  });

  it("S17: entering Edit with ZERO keystrokes copies the same string Preview did", async () => {
    // The state no design document's table covered, and the most likely state
    // for a CAREFUL user -- the one who opens Edit to verify a detail before
    // pasting, which is exactly the user this feature is for. The same
    // untouched document is read from two different places; before this
    // design that produced two different clipboard strings (innerText's
    // "A\n\nB" against the model derivation's "A\nB").
    installClipboardStub();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy: vi.fn() });
    await clickCopy();
    const fromPreview = nonEmptyString(lastCopied());
    await enterEditMode();
    await clickCopy();
    expect(lastCopied()).toBe(fromPreview);
  });
});

// ---------------------------------------------------------------------------
// AC-C4 -- copying MUST NOT mark the document edited
// ---------------------------------------------------------------------------

describe("AC-C4: copying must not mark the document edited, and must not change saveStatus", () => {
  it("a POINTER activation in edit mode neither blurs the editor nor calls onSave", async () => {
    // Why this matters in bytes: commitDraft -> onSave -> saveDocumentPreview
    // sets `edited` with NO dirty check, and editedForScope then switches the
    // download from "serve the engine .docx verbatim" to "rebuild the
    // extracted text onto the template". A user who opens Edit, types
    // nothing, clicks Copy and then Download .docx would receive DIFFERENT
    // BYTES than if they had never clicked Copy -- and for the cover letter
    // that rebuild has already lost all seven blank paragraphs.
    installClipboardStub();
    const onSaveSpy = vi.fn();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy });
    await enterEditMode();
    expect(editableEl()).toBeTruthy();

    await act(async () => {
      const control = copyControl();
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      control.dispatchEvent(down);
      // Exactly what a browser does: focus moves only if the default was not
      // prevented.
      if (!down.defaultPrevented) control.focus();
      control.click();
    });

    expect(onSaveSpy).not.toHaveBeenCalled();
    expect(editedScopes(onSaveSpy).has("resume")).toBe(false);
    expect(writeTextCalls).toHaveLength(1); // ...and the copy really did happen
  });

  it("POSITIVE CONTROL: forcing focus onto the control DOES blur-commit, so the harness can see the failure it claims absent", async () => {
    // Measured: `button.click()` alone fires ZERO blur events while a
    // contenteditable has focus, so a .click()-only test cannot see a
    // blur-commit at all and the row above would pass over a broken guard.
    installClipboardStub();
    const onSaveSpy = vi.fn();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy });
    await enterEditMode();
    await act(async () => {
      copyControl().focus();
    });
    expect(onSaveSpy).toHaveBeenCalled();
    expect(editedScopes(onSaveSpy).has("resume")).toBe(true);
  });

  it("a pending auto-save survives a copy: not flushed at the click, and it still fires once at 600 ms", async () => {
    installClipboardStub();
    const onSaveSpy = vi.fn();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy });
    await enterEditMode();
    await typeInEditor("<p>TYPED WHILE PENDING</p>");
    await clickCopy();
    expect(onSaveSpy).not.toHaveBeenCalled();
    await wait(700);
    expect(onSaveSpy).toHaveBeenCalledTimes(1);
    expect(onSaveSpy.mock.calls[0][1].html).toContain("TYPED WHILE PENDING");
  });

  it("does not change saveStatus: a pending save still reads \"Saving\" after the copy", async () => {
    installClipboardStub();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy: vi.fn() });
    await enterEditMode();
    await typeInEditor("<p>TYPED</p>");
    const statusBefore = document.body.textContent.includes("Saving");
    expect(statusBefore).toBe(true); // corpus self-test: the indicator really is showing
    await clickCopy();
    expect(document.body.textContent.includes("Saving")).toBe(true);
  });

  it("the extracted control's source contains no commitDraft", async () => {
    const controlSource = srcOf("preview/CopyDocumentControl.js");
    expect(/commitDraft/.test(controlSource)).toBe(false);
    expect(/commitDraft/.test(DIALOG_SOURCE)).toBe(true); // positive control
  });

  // -------------------------------------------------------------------------
  // AC-C9.1 -- the fence is WIRED: the dialog's `mode` reaches writePlainText
  // -------------------------------------------------------------------------
  //
  // Every other edit-mode row in this file installs the ASYNC clipboard stub,
  // which returns from step 1 of the union -- so step 3 is never reached, the
  // `mode` prop is never read, and the whole wire is dead weight. Three
  // separate defects are invisible to the entire gate as a result: the dialog
  // omitting `mode={mode}` from the control's props, the dialog passing
  // `mode="view"` as a literal, and the control calling `writePlainText(text)`
  // with no options object at all. All three make the copy control open,
  // select and focus a hidden textarea while the user is IN THE EDITOR.
  //
  // The harm, in bytes: `.select()` takes focus, the contentEditable's onBlur
  // runs commitDraft -> onSave -> saveDocumentPreview, which sets `edited` with
  // NO dirty check; editedForScope then switches `Download .docx` from serving
  // the engine bytes verbatim to REBUILDING them onto the template -- a rebuild
  // that has already lost every blank paragraph of the cover letter. A user who
  // opens Edit, types nothing, presses Copy and then Download receives
  // different bytes than one who never pressed Copy.
  //
  // The two rows differ in EXACTLY ONE THING -- the mode the dialog is in when
  // the identical button is clicked. Both enter Edit first, so the editor has
  // been mounted and focused in both.

  it("EDIT mode: the textarea fallback is never reached, and the refusal is announced", async () => {
    // The INERT branch of step 2: execCommand returns true but fires no copy
    // event of its own (measured), so the union falls through to step 3 --
    // which is exactly where the fence must stop it.
    installExecCommandStub(() => true);
    const onSaveSpy = vi.fn();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy });
    await enterEditMode();
    expect(editableEl()).toBeTruthy(); // corpus self-test: we really are in Edit

    const created = await textareasCreatedDuring(clickCopy);
    expect(created).toHaveLength(0);
    nonEmptyString(alertRegion().textContent);
    expect(politeRegion().textContent).toBe("");
    // ...and the harm itself did not happen: nothing committed, nothing edited.
    expect(onSaveSpy).not.toHaveBeenCalled();
    expect(editedScopes(onSaveSpy).has("resume")).toBe(false);
  });

  it("POSITIVE CONTROL: the identical click back in PREVIEW mode DOES create and select one, and succeeds", async () => {
    // Without this row the assertion above is satisfied by a dialog whose copy
    // control never reaches step 3 in ANY mode -- a stub that was not
    // installed, a union that returned early, a button that did nothing.
    installExecCommandStub(() => true);
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy: vi.fn() });
    await enterEditMode();
    await act(async () => {
      findButtonByText("Preview").click();
    });
    expect(editableEl()).toBeNull(); // ...and we really are back in Preview

    const created = await textareasCreatedDuring(clickCopy);
    expect(created).toHaveLength(1);
    // The node carried the document that is on screen, and it was SELECTED --
    // the act that steals focus in a real browser, and the whole reason edit
    // mode must never reach it.
    expect(created[0].value).toBe(nonEmptyString(htmlToPlainText(previewSurface().innerHTML)));
    expect(created[0].selectionStart).toBe(0);
    expect(created[0].selectionEnd).toBe(created[0].value.length);
    nonEmptyString(politeRegion().textContent);
    expect(alertRegion().textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-C5.1 -- zero direct clipboard call sites left in the dialog
// ---------------------------------------------------------------------------

describe("AC-C5.1: DocumentPreviewDialog.js contains ZERO direct clipboard call sites", () => {
  it("has no navigator.clipboard and no execCommand(\"copy\")", async () => {
    expect(DIALOG_SOURCE).not.toMatch(/navigator\s*\.\s*clipboard/);
    expect(DIALOG_SOURCE).not.toMatch(/execCommand\(\s*["']copy["']/);
    // execCommand("insertHTML", ...) in insertReference is NOT covered -- the
    // second pattern is scoped to "copy".
    expect(DIALOG_SOURCE).toMatch(/execCommand\(\s*["']insertHTML["']/);
  });

  it("POSITIVE CONTROL: both patterns DO match ChatPanel.js, so a zero above is a real zero", async () => {
    expect(CHAT_PANEL_SOURCE).toMatch(/navigator\s*\.\s*clipboard/);
    expect(CHAT_PANEL_SOURCE).toMatch(/execCommand\(\s*["']copy["']/);
  });

  it("AC-C13.3: the dialog stays at or under 980 lines", async () => {
    // A one-time post-condition for THIS change: the file was 993 and this
    // change is -57 +35 = 971. The naive lifted-state shape (no
    // useCopyFeedback hook) lands over the bound, so the hook is not a
    // stylistic preference.
    expect(DIALOG_SOURCE.split("\n").length).toBeLessThanOrEqual(980);
  });

  it("AC-C18.1: DialogActions still carries flexWrap wrap", async () => {
    expect(DIALOG_SOURCE).toMatch(/flexWrap:\s*["']wrap["']/);
  });
});

// ---------------------------------------------------------------------------
// R-2 / O-6 -- the gate's ARGUMENT at the call site
// ---------------------------------------------------------------------------

describe("R-2: the enable gate is handed docState[tab] RAW, never the `|| {}` local beside it", () => {
  it("the one copyStateFor call passes the entry itself, and the `|| {}` local survives for its other reader", async () => {
    // copyOutcome.test.js pins the RULE -- copyStateFor(true, undefined) is
    // "unloaded" while copyStateFor(true, {}) is "ready". Nothing pinned the
    // ARGUMENT, and the argument is the entire content of the finding: the
    // dialog computes `const state = docState[tab] || {}` five lines away, and
    // that `|| {}` erases exactly the null the fourth conjunct reads. Hand the
    // gate `state` instead of `docState[tab]` and the control is ENABLED on the
    // first paint of every tab -- over a surface with nothing on it yet,
    // because ensureLoaded runs in a PASSIVE effect. The user copies a blank
    // document into an ATS resume field and is told it worked.
    //
    // No behavioural row in this file can reach it: `act()` flushes passive
    // effects, so no committed frame this suite can observe still carries the
    // un-loaded state. Source shape is the instrument the finding needs, and
    // this gate already uses readFileSync + regex as a first-class instrument a
    // dozen times over.
    //
    // Read from DIALOG_CODE, not DIALOG_SOURCE: the invariant's only protection
    // today is the comment sitting above the call, and the plan itself predicts
    // that comment being tidied away. A shape assertion a comment can satisfy
    // would go green on precisely the file that had lost the guard.
    const CALL = /copyStateFor\((?:[^()]|\([^()]*\))*\)/g;
    const calls = DIALOG_CODE.match(CALL) || [];
    expect(calls).toHaveLength(1); // one gate, one owner (plan R-3 / C-2)
    expect(calls[0]).toContain("docState[tab]");
    expect(calls[0]).not.toContain("||");
    // `state` as a whole word: `docState` does not contain it (no word boundary
    // between `c` and `S`, and the case differs), so this fires only on the
    // in-scope local.
    expect(calls[0]).not.toMatch(/\bstate\b/);

    // NEGATIVE CONTROL, and the reason this row is not merely "the file does
    // not contain the bad form": the `|| {}` local is still THERE, for the
    // readers that legitimately want a defaulted object. Without this the three
    // assertions above would all pass on a file that had deleted the local
    // outright -- or on one where neither form appeared at all.
    expect(DIALOG_CODE).toMatch(/const\s+state\s*=\s*docState\[tab\]\s*\|\|\s*\{\s*\}/);

    // POSITIVE CONTROLS for the two instruments, so neither can be silently
    // broken: the extractor really does isolate a whole call including its
    // nested parens, and really does flag the local when it is the argument...
    const badForm = "const copyState = copyStateFor(available(tab), state);";
    expect((badForm.match(CALL) || [])[0]).toBe("copyStateFor(available(tab), state)");
    expect((badForm.match(CALL) || [])[0]).toMatch(/\bstate\b/);
    // ...and the comment stripper really does remove a mention made in prose.
    // Matched with String.match rather than toMatch: CALL carries the `g` flag,
    // and a global regex handed to `.test()` advances its own lastIndex, which
    // makes the SECOND use of it in a file silently answer a different question.
    expect(codeOnly("const x = 1; // copyStateFor(available(tab), docState[tab])").match(CALL)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-C6 -- activation, in the dialog
// ---------------------------------------------------------------------------

describe("AC-C6: one activation, a real <button>, and no key handler of its own", () => {
  it("is a native BUTTON with an explicit type and no role shim", async () => {
    await render(baseProps());
    expect(copyControl().tagName).toBe("BUTTON");
    expect(copyControl().getAttribute("type")).toBeTruthy();
    expect(copyControl().getAttribute("role")).toBeNull();
  });

  it("INVERTED KEY ASSERTION: Enter and Space produce no clipboard write", async () => {
    installClipboardStub();
    await render(baseProps());
    for (const key of ["Enter", " "]) {
      await act(async () => {
        copyControl().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        copyControl().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      });
    }
    expect(writeTextCalls).toHaveLength(0);
    await clickCopy();
    expect(writeTextCalls).toHaveLength(1); // positive control
  });

  it("a pointer activation leaves focus exactly where it was and never leaves the dialog", async () => {
    installClipboardStub();
    await render(baseProps());
    const before = document.activeElement;
    await act(async () => {
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      copyControl().dispatchEvent(down);
      if (!down.defaultPrevented) copyControl().focus();
      copyControl().click();
    });
    expect(document.activeElement).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC-C7 -- plain text only, and no invisible codepoint
// ---------------------------------------------------------------------------

describe("AC-C7: text/plain only, and not one app-introduced invisible codepoint", () => {
  it("writes a string, never a ClipboardItem, and never calls navigator.clipboard.write", async () => {
    installClipboardStub();
    await render(baseProps());
    await clickCopy();
    expect(typeof lastCopied()).toBe("string");
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
    // Positive control: the spy is reachable, so "never called" is a fact
    // about the implementation rather than about a missing stub.
    await navigator.clipboard.write();
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
  });

  it("codepoint sweep across copy -> copy -> copy", async () => {
    // mui-a11y-traps item 6 records that a zero-width nonce added to defeat
    // React's coalescing bail LEAKED U+200B into copied text in this repo
    // before. An ATS keyword matcher sees "Java" + U+200B + "Script" as a
    // token that is not "JavaScript".
    const INVISIBLE = new RegExp("[\\u200B\\u200C\\u200D\\u2060\\uFEFF\\u00AD]");
    // MANDATORY SELF-TEST: one typo in the character class yields a
    // permanently-green sweep.
    expect(INVISIBLE.test("Java" + String.fromCharCode(0x200b) + "Script")).toBe(true);
    installClipboardStub();
    await render(baseProps({ scopes: scopesFor({ handEdited: true }) }));
    await clickCopy();
    await clickCopy();
    await clickCopy();
    expect(writeTextCalls).toHaveLength(3);
    for (const copied of writeTextCalls) {
      expect(INVISIBLE.test(nonEmptyString(copied))).toBe(false);
    }
    // ...and no announcement leaked one either.
    expect(INVISIBLE.test(politeRegion().textContent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-C10 -- the gate, the affordance, and the refusal, in the dialog
// ---------------------------------------------------------------------------

describe("AC-C10: the enable gate over the states the real dialog can reach", () => {
  it("READY: aria-disabled=\"false\", no native disabled, pointer events not none", async () => {
    // POSITIVE CONTROL for the three rows below -- otherwise a selector that
    // found nothing would satisfy all of them.
    await render(baseProps());
    expect(copyControl().getAttribute("aria-disabled")).toBe("false");
    expect(isDisabled(copyControl())).toBe(false);
  });

  it("LOADING: disabled by the conjunction of three, and a click refuses without writing", async () => {
    installClipboardStub();
    // A loadModel that never settles holds docState[tab] at {loading:true}.
    await render(baseProps({ scopes: scopesFor(), loadModel: vi.fn(() => new Promise(() => {})) }));
    const el = copyControl();
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(getComputedStyle(el).pointerEvents).not.toBe("none");
    expect(el.tabIndex).toBe(0); // still reachable by keyboard: never a dead end
    await clickCopy();
    expect(writeTextCalls).toHaveLength(0);
    nonEmptyString(alertRegion().textContent);
    expect(politeRegion().textContent).toBe("");
  });

  it("ERRORED: disabled, and a click refuses with its own reason", async () => {
    installClipboardStub();
    await render(baseProps({ scopes: scopesFor(), loadModel: vi.fn(async () => { throw new Error("Unable to render preview."); }) }));
    expect(copyControl().getAttribute("aria-disabled")).toBe("true");
    await clickCopy();
    expect(writeTextCalls).toHaveLength(0);
    nonEmptyString(alertRegion().textContent);
  });

  it("UNAVAILABLE: disabled, and a click refuses", async () => {
    installClipboardStub();
    const scopes = {
      resume: { available: false, text: "" },
      cover: { available: false, text: "" },
      email: { available: false, text: "" },
    };
    await render(baseProps({ scopes }));
    expect(copyControl().getAttribute("aria-disabled")).toBe("true");
    await clickCopy();
    expect(writeTextCalls).toHaveLength(0);
    nonEmptyString(alertRegion().textContent);
  });

  it("BLANK BUT AVAILABLE: enabled, refused at click time, and never announced as a success", async () => {
    // Reachability is real: previewScopeAvailable(entry,"cover") is only
    // `Array.isArray(coverLetterResultLines) && length > 0`, so an entry whose
    // lines are ["", ""] renders an AVAILABLE cover tab over a blank surface.
    installClipboardStub();
    await render(
      baseProps({
        scopes: { ...scopesFor(), cover: { available: true, text: "\n", html: renderModelToHtml(linesToModel(["", ""])) } },
      }),
    );
    await switchTab("Cover letter");
    expect(copyControl().getAttribute("aria-disabled")).toBe("false"); // enabled...
    await clickCopy();
    expect(writeTextCalls).toHaveLength(0); // ...and refused at click time
    nonEmptyString(alertRegion().textContent);
    expect(politeRegion().textContent).toBe("");
  });

  it("AC-C10.4.2: no failure or refusal message says \"below\"", async () => {
    // DialogContent PRECEDES DialogActions in the JSX, so the message sits
    // BENEATH the content and the text it points at is ABOVE it. Today's
    // copyEmail says the opposite.
    await render(baseProps({ loadModel: vi.fn(() => new Promise(() => {})) }));
    await clickCopy();
    expect(nonEmptyString(alertRegion().textContent).toLowerCase()).not.toContain("below");
    // Positive control for the instrument.
    expect("select the text below".toLowerCase()).toContain("below");
  });

  it("AC-C10.4.4: the live regions are NOT descendants of the element rendering the html", async () => {
    // visuallyHidden is a clip-rect, so its text IS in the selection tree. A
    // manual select-all over the preview surface must not sweep in a live
    // region's sentence.
    await render(baseProps());
    for (const region of [politeRegion(), alertRegion(), chipRegion()]) {
      expect(previewSurface().contains(region)).toBe(false);
      expect(document.querySelector(".MuiDialogContent-root").contains(region)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-C11.4 -- THE PROPERTY, driven by REAL CLICKS on the real control
// ---------------------------------------------------------------------------

describe("AC-C11.4: every activation mutates the live region, INCLUDING a byte-identical repeat", () => {
  // Records banked from the observer CALLBACK and merged with a final
  // takeRecords() -- the merge is load-bearing under `await act()` and is
  // documented at DriveResultRegion.test.js's
  // "MAJOR M-4: the ALERT region mutates across a failure -> retry ->
  // IDENTICAL failure sequence, not just the polite region".
  //
  // Driven by CLICKING THE CONTROL, never by re-rendering with new props:
  // re-rendering proves the region CAN mutate; the question is whether the
  // control produces two commits.
  async function secondClickMutations(regionFn) {
    await clickCopy();
    const node = regionFn();
    const records = [];
    const observer = new window.MutationObserver((rs) => records.push(...rs));
    observer.observe(node, { characterData: true, childList: true, subtree: true });
    records.length = 0; // the second click ALONE
    await clickCopy();
    records.push(...observer.takeRecords());
    observer.disconnect();
    return { records, node };
  }

  it("the async success path", async () => {
    installClipboardStub();
    await render(baseProps());
    const { records, node } = await secondClickMutations(politeRegion);
    expect(records.length).toBeGreaterThan(0);
    // Paired with a positive assertion, so the row cannot pass over an empty
    // region.
    nonEmptyString(node.textContent);
    expect(alertRegion().textContent).toBe("");
  });

  it("the synchronous copy-event fallback path", async () => {
    const store = [];
    installExecCommandStub((command) => {
      if (command === "copy") dispatchCopyEvent(store);
      return true;
    });
    await render(baseProps());
    const { records, node } = await secondClickMutations(politeRegion);
    expect(records.length).toBeGreaterThan(0);
    nonEmptyString(node.textContent);
    expect(store).toHaveLength(2);
  });

  it("a DISABLED control's refusal path -- the case none of the design documents pinned", async () => {
    // Without it, a user who presses the greyed button twice hears the reason
    // ONCE, and it is silent specifically for the screen-reader user, who is
    // the one the control is deliberately kept in the tab order for.
    installClipboardStub();
    await render(baseProps({ loadModel: vi.fn(() => new Promise(() => {})) }));
    const { records, node } = await secondClickMutations(alertRegion);
    expect(records.length).toBeGreaterThan(0);
    nonEmptyString(node.textContent);
    expect(politeRegion().textContent).toBe("");
  });

  it("the VISIBLE chip mutates on the repeat too, and the counter is never rendered", async () => {
    installClipboardStub();
    await render(baseProps());
    const { records, node } = await secondClickMutations(chipRegion);
    expect(records.length).toBeGreaterThan(0);
    nonEmptyString(node.textContent);
    expect(node.textContent).not.toMatch(/\d/);
    expect(politeRegion().textContent).not.toMatch(/\d/);
  });

  it("POSITIVE CONTROL: the same observer records NOTHING across a commit that announces nothing", async () => {
    installClipboardStub();
    await render(baseProps());
    await clickCopy();
    const records = [];
    const observer = new window.MutationObserver((rs) => records.push(...rs));
    observer.observe(politeRegion(), { characterData: true, childList: true, subtree: true });
    records.length = 0;
    await act(async () => {});
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records).toHaveLength(0);
  });

  it("stale feedback is cleared by a tab change -- the user-facing half of AC-C2", async () => {
    // "Resume text copied." still showing after the user switches to the
    // cover tab tells them the cover letter is on their clipboard when it is
    // not.
    installClipboardStub();
    await render(baseProps());
    await clickCopy();
    nonEmptyString(politeRegion().textContent);
    await switchTab("Cover letter");
    expect(politeRegion().textContent).toBe("");
    expect(chipRegion().textContent).toBe("");
  });

  // -------------------------------------------------------------------------
  // O-3 -- ALL FOUR clear triggers, not just the tab
  // -------------------------------------------------------------------------
  //
  // CopyFeedback.test.js pins the MECHANISM (a key change clears, the same key
  // does not); the row above pins ONE of the four things that must be in that
  // key. Drop `mode` from it, or drop `reloadKey` and `open`, and every
  // assertion in this gate stays green while a standing "Resume text copied."
  // outlives the document it was about.
  //
  // Each row's positive control is built in: the message is asserted PRESENT
  // immediately before the trigger, so the empty region afterwards is a clear
  // and not a region that was never fed. The 3 s auto-dismiss cannot account
  // for it either -- these rows run in milliseconds, and the row above already
  // proves the message survives an ordinary commit.

  it("entering Edit clears a standing message -- the same document, a different surface", async () => {
    // The copy was taken from the read-only preview. The moment the user enters
    // the editor they are looking at a surface they can change, and the
    // sentence still on screen no longer describes what is on the clipboard.
    installClipboardStub();
    await renderStateful({ ...baseProps(), initialScopes: scopesFor(), onSaveSpy: vi.fn() });
    await clickCopy();
    nonEmptyString(politeRegion().textContent);
    nonEmptyString(chipRegion().textContent);
    await enterEditMode();
    expect(politeRegion().textContent).toBe("");
    expect(chipRegion().textContent).toBe("");
  });

  it("a reloadKey bump clears it -- the trigger the user takes NO ACTION for", async () => {
    // The design calls this one WORSE than the tab case. The parent bumps
    // reloadKey after a revise, a focus change or a version switch: the content
    // on screen is REPLACED under the user, who did nothing. "Resume text
    // copied." keeps standing over a document that is no longer the one on
    // their clipboard -- and the whole point of this feature is a user who is
    // about to paste into an ATS form.
    installClipboardStub();
    const props = baseProps({ reloadKey: 1 });
    await render(props);
    await clickCopy();
    nonEmptyString(politeRegion().textContent);
    await render({ ...props, reloadKey: 2 });
    expect(politeRegion().textContent).toBe("");
    expect(chipRegion().textContent).toBe("");
  });

  it("a close and reopen clears it -- the strip must never mount carrying the last session's sentence", async () => {
    // The hook lives on the dialog component, which is NOT unmounted by
    // `open={false}` (measured: the action bar and both regions are still in
    // the document while the close transition runs). So without `open` in the
    // key the message is still there when the user reopens the modal -- for a
    // clipboard that has since been overwritten by whatever they pasted.
    installClipboardStub();
    const props = baseProps();
    await render(props);
    await clickCopy();
    nonEmptyString(politeRegion().textContent);
    await render({ ...props, open: false });
    await render({ ...props, open: true });
    expect(politeRegion().textContent).toBe("");
    expect(chipRegion().textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-C12 -- every control in the bar has a distinct, reachable name
// ---------------------------------------------------------------------------

describe("AC-C12: every DialogActions control has a non-empty, pairwise-distinct accessible name", () => {
  // The sweep MUST run with every optional control wired -- otherwise a
  // collision with a control that did not render cannot be detected.
  function fullyWiredProps(overrides = {}) {
    return baseProps({
      onOpenFocusPicker: vi.fn(),
      onSetFraming: vi.fn(),
      onScrapePosting: vi.fn(),
      onResubmit: vi.fn(),
      onAskAi: vi.fn(),
      onResearchCompany: vi.fn(),
      documentVersions: {
        resume: [{ id: "v2", label: "Latest" }, { id: "v1", label: "Previous" }],
        cover: [{ id: "c2", label: "Latest" }, { id: "c1", label: "Previous" }],
      },
      currentVersionId: { resume: "v2", cover: "c2" },
      onSelectVersion: vi.fn(),
      drive: driveProps({ status: "connected", hasDriveReference: true, connected: true }),
      ...overrides,
    });
  }

  it.each([["Resume"], ["Cover letter"], ["Hiring email"]])("%s tab, every optional control wired", async (tabLabel) => {
    await render(fullyWiredProps());
    await switchTab(tabLabel);
    const controls = [...dialogActions().querySelectorAll('button, [role="button"], a[href]')];
    // Corpus self-test: the bar really is populated, so "all distinct" is not
    // a statement about one button.
    expect(controls.length).toBeGreaterThanOrEqual(3);
    const names = controls.map(accessibleName);
    for (const name of names) nonEmptyString(name);
    expect(new Set(names).size).toBe(names.length);
    // ...and the copy control's own name is among them and carries the scope.
    const copyName = accessibleName(copyControl());
    expect(copyName).toContain("Copy text");
    expect(names).toContain(copyName);
  });

  // The census above cannot fail for a control it does not enumerate, and its
  // own self-test is `>= 3` -- which is satisfied by three of the six. Measured
  // here: `button, [role="button"], a[href]` finds SIX controls on the resume
  // and cover tabs and FIVE on the hiring-email tab (no Download .docx), and it
  // MISSES the combine-format `Select`. That Select is a MUI non-native select:
  // it renders a `<div role="combobox" tabindex="0">` plus an
  // `aria-hidden="true" tabindex="-1"` shadow `<input>`. So the seventh control
  // in the bar -- one a keyboard and screen-reader user reaches -- is outside
  // the sweep, and a name collision with it is UNDETECTABLE. (Standing repo
  // note: a `role=combobox` sweep never sees a native `<select>`, and this bar
  // has no native one.)
  const NARROW = 'button, [role="button"], a[href]';
  const WIDENED = 'button, [role="button"], [role="combobox"], a[href]';
  const BAR_CENSUS = [
    ["Resume", 6, 7],
    ["Cover letter", 6, 7],
    ["Hiring email", 5, 6], // no Download .docx on the plain-text scope
  ];

  it.each(BAR_CENSUS)(
    "%s tab: the bar holds exactly %i button-shaped controls and %i once the combine Select is counted, all distinctly named",
    async (tabLabel, narrowCount, widenedCount) => {
      await render(fullyWiredProps());
      await switchTab(tabLabel);
      const narrow = [...dialogActions().querySelectorAll(NARROW)];
      const widened = [...dialogActions().querySelectorAll(WIDENED)];
      // Pinned exactly, not `>= 3`: a control that silently stops rendering
      // takes its own name out of the distinctness check with it.
      expect(narrow).toHaveLength(narrowCount);
      // POSITIVE CONTROL for the widening: it really does add an element the
      // narrow selector misses, so the row below is not the same sweep twice.
      expect(widened).toHaveLength(widenedCount);
      expect(widened.length).toBe(narrow.length + 1);
      const extra = widened.filter((el) => !narrow.includes(el));
      expect(extra).toHaveLength(1);
      expect(extra[0].getAttribute("role")).toBe("combobox");

      const names = widened.map(accessibleName);
      for (const name of names) nonEmptyString(name);
      expect(new Set(names).size).toBe(names.length);
      // ...and the copy control is inside the WIDENED set, so a collision with
      // the Select would now be a failure rather than an invisible one.
      expect(names).toContain(accessibleName(copyControl()));

      // The Select's shadow <input> is EXCLUDED on purpose and the exclusion is
      // stated rather than assumed: it is aria-hidden and removed from the tab
      // order, so it has no accessible name to collide with and asserting one
      // would be red against correct MUI.
      const shadow = [...dialogActions().querySelectorAll("input")];
      expect(shadow).toHaveLength(1);
      expect(shadow[0].getAttribute("aria-hidden")).toBe("true");
      expect(shadow[0].tabIndex).toBe(-1);
    },
  );

  it("the copy control's accessible name distinguishes the three tabs", async () => {
    // A screen-reader user cannot see which tab is active; AC-C2 exists
    // because copying the cover letter into a resume field costs an
    // application.
    const seen = [];
    await render(fullyWiredProps());
    for (const tabLabel of ["Resume", "Cover letter", "Hiring email"]) {
      await switchTab(tabLabel);
      seen.push(nonEmptyString(accessibleName(copyControl())));
    }
    expect(new Set(seen).size).toBe(3);
    // The VISIBLE label, by contrast, never changes.
    expect(copyControl().textContent.trim()).toBe("Copy text");
  });
});

// ---------------------------------------------------------------------------
// AC-C14 -- nothing else changes behaviour
// ---------------------------------------------------------------------------

describe("AC-C14.3: busy / notice / error are untouched by the copy path, in BOTH directions", () => {
  it("busy on the active scope disables Download .docx (positive control) and NOT the copy control", async () => {
    // The existing drive suite cannot cover this: its gate is tenControls(),
    // a hardcoded enumeration of ten named selectors, and a copy control
    // wrongly wired disabled={busyActive} is simply not in the object -- so
    // every assertion there stays green.
    installClipboardStub();
    await render(baseProps({ busy: { resume: true } }));
    expect(isDisabled(findButtonByText("Download .docx"))).toBe(true);
    expect(isDisabled(copyControl())).toBe(false);
    await clickCopy();
    expect(writeTextCalls).toHaveLength(1);
    nonEmptyString(politeRegion().textContent);
  });

  it("busy on the OTHER scope leaves the copy control enabled", async () => {
    await render(baseProps({ busy: { cover: true } }));
    expect(isDisabled(copyControl())).toBe(false);
  });

  it("a Drive save in flight never gates a copy", async () => {
    installClipboardStub();
    await render(baseProps({ drive: driveProps({ status: "saving" }) }));
    expect(isDisabled(copyControl())).toBe(false);
    await clickCopy();
    expect(writeTextCalls).toHaveLength(1);
  });

  it("a copy writes nothing into notice or error", async () => {
    installClipboardStub();
    await render(baseProps());
    await clickCopy();
    expect(document.querySelector('[data-testid="scope-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="scope-notice"]')).toBeNull();
    // Positive control: the same selectors DO find the boxes when the props
    // carry them, so the two nulls are real.
    await render(baseProps({ error: { resume: "Something failed." } }));
    expect(document.querySelector('[data-testid="scope-error"]')).toBeTruthy();
  });

  it("the extracted control carries no docx byte token", async () => {
    const controlSource = srcOf("preview/CopyDocumentControl.js");
    for (const token of [/docxB64/, /templateDocx/, /\bbusy\b/, /anyBusy/]) {
      expect(token.test(controlSource)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-C19 -- the highlight toggle changes not one copied byte
// ---------------------------------------------------------------------------

describe("AC-C19: toggling the version highlight changes nothing about what is copied", () => {
  it("the copied string is byte-identical with the highlight on and off", async () => {
    installClipboardStub();
    // The toggle only renders when there IS a previous version to diff
    // against, and only acts when the scope is not hand-edited (a hand-edited
    // scope has no freshly parsed model to annotate).
    const previousLines = ["MODEL RESUME NAME", "", "MODEL SUMMARY   ", "AN OLD BULLET"];
    const loadModel = vi.fn(async (scope, { highlight } = {}) => {
      const model = modelFor(scope);
      return highlight ? markVersionChanges(model, previousLines, MODEL_RESUME_LINES) : model;
    });
    await render(
      baseProps({
        loadModel,
        documentVersions: { resume: [{ id: "v2", label: "Latest" }, { id: "v1", label: "Previous" }] },
        currentVersionId: { resume: "v2" },
        onSelectVersion: vi.fn(),
      }),
    );
    await clickCopy();
    const withoutHighlight = nonEmptyString(lastCopied());

    const toggle = findButtonByText("Highlight changes");
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle.click();
    });
    // Corpus self-test: the highlight really did take effect on the SCREEN,
    // so the equality below is not comparing an unannotated model with
    // itself.
    expect(loadModel).toHaveBeenCalledTimes(2);
    expect(previewSurface().innerHTML).toContain("background-color:rgba(255,213,79,0.55)");

    await clickCopy();
    expect(lastCopied()).toBe(withoutHighlight);
  });
});
