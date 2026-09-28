// @vitest-environment jsdom
//
// N63 -- feedback for the file-name/title copy (N63-T6, N63-T7).
//
// The success/failure of a title copy must be told to the candidate through
// the SAME useCopyFeedback instance the document-text copy already uses
// (DocumentPreviewDialog.js:543, :901) -- one polite region, one alert region,
// one visible chip, one 3 s auto-dismiss timer, one persist-on-failure rule.
// NOT a second strip and NOT a second idiom. And the WORDING must be right for
// a filename: the text-copy control announces "{doc} text copied." and, on
// failure, "...Select the document text and copy it manually." -- the latter is
// the WRONG remedy for a filename copy (there is no document text to select;
// the file name is in the field right there).
//
// MEASUREMENT CEILING (memory `measurement-instruments`, backlog N74): jsdom
// has no real clipboard. These rows prove the announcement DOM mutates and that
// a failure announcement persists while a success one self-clears -- they do
// NOT prove anything reached the OS clipboard (N63-T11, browser/manual only).
//
// TIMERS: the persist rule is a TIMER property -- a success outcome schedules a
// 3 s clear, a failure outcome schedules none. It cannot be proven on the same
// tick (brief item 13). Fake timers (setTimeout/clearTimeout only, so React's
// own scheduler is untouched) let us advance past the clear window and observe
// that the failure alert survives while the success chip clears.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewDialog from "./DocumentPreviewDialog.js";
import { getDownloadFileNameForTitle, getDownloadCoverLetterFileNameForTitle } from "@/lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLEAR_DELAY_MS = 3000; // CopyFeedback.js's own constant

let removeClipboardStub = null;
function installClipboardStub() {
  navigator.clipboard = {
    writeText: () => Promise.resolve(),
    write: vi.fn(async () => {}),
  };
  removeClipboardStub = () => {
    delete navigator.clipboard;
  };
}

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

function scopesFor({ jobTitle = "Senior Engineer", company = "Acme" } = {}) {
  return {
    resume: {
      available: true,
      text: "MODEL RESUME NAME",
      html: undefined,
      fileName: getDownloadFileNameForTitle(jobTitle, company).replace(/\.docx$/i, ""),
    },
    cover: {
      available: true,
      text: "MODEL COVER BODY",
      html: undefined,
      fileName: getDownloadCoverLetterFileNameForTitle(jobTitle, company).replace(/\.docx$/i, ""),
    },
    email: { available: true, text: "Subject: Application\n\nHi there," },
  };
}

function baseProps(overrides = {}) {
  return {
    open: true,
    jobTitle: "Senior Engineer",
    company: "Acme",
    initialTab: "resume",
    scopes: scopesFor(),
    engine: "embedded",
    loadModel: vi.fn(async (scope) => ({ blocks: [{ type: "paragraph", runs: [{ text: scope }] }] })),
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

let container;
let root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
  vi.useRealTimers();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewDialog, props));
  });
  expect(document.querySelectorAll(".MuiDialogActions-root")).toHaveLength(1);
}

const buttons = () => [...document.querySelectorAll("button")];
function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  return (el.textContent || "").trim();
}
const TITLE_NAME = /file ?name|title/i;
const titleCopyControl = () => buttons().find((b) => TITLE_NAME.test(accessibleName(b)));

const politeRegion = () => document.querySelector('[data-copy-status="polite"]');
const alertRegion = () => document.querySelector('[data-copy-status="alert"]');
const chipRegion = () => document.querySelector('[data-copy-status="chip"]');

async function clickTitleCopy() {
  const control = titleCopyControl();
  expect(control, "the title/file-name copy control must be reachable").toBeTruthy();
  await act(async () => {
    control.click();
  });
}

// ---------------------------------------------------------------------------
// N63-T6 -- success feedback, same mechanism, distinct wording, single strip
// ---------------------------------------------------------------------------

describe("N63-T6: success is announced through the SAME strip, in wording that names the FILE NAME", () => {
  it("feeds the polite region with file-name wording, leaves alert empty, and adds NO second strip", async () => {
    installClipboardStub();
    await render(baseProps());

    // Exactly ONE feedback strip in the dialog before the click...
    expect(document.querySelectorAll('[data-copy-status="polite"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-copy-status="alert"]')).toHaveLength(1);

    await clickTitleCopy(); // RED ON HEAD: no title control to click

    const polite = politeRegion().textContent;
    expect(polite.trim().length).toBeGreaterThan(0);
    // Names the FILE NAME / TITLE -- distinguishable from the text-copy's
    // "Resume text copied." (which does NOT contain "file name"/"title").
    expect(polite).toMatch(TITLE_NAME);
    // Exactly one channel fired.
    expect(alertRegion().textContent).toBe("");
    // ...through the SAME single strip, not a newly-added one.
    expect(document.querySelectorAll('[data-copy-status="polite"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-copy-status="chip"]')).toHaveLength(1);
    // The visible chip mirrors the announcement.
    expect(chipRegion().textContent.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// N63-T7 -- failure feedback is visible, persists, and gives the RIGHT remedy
// ---------------------------------------------------------------------------

describe("N63-T7: failure is announced, persists, and never tells the user to 'select the document text'", () => {
  it("with no clipboard surface the alert is fed, omits the text-copy remedy, and PERSISTS past the clear window", async () => {
    // No clipboard stub -> writePlainText returns {ok:false, ...unavailable};
    // titleCopyOutcome must announce a persistent alert with a filename-correct
    // remedy.
    await render(baseProps()); // RED ON HEAD: no title control

    await clickTitleCopy();
    const alertText = alertRegion().textContent;
    expect(alertText.trim().length).toBeGreaterThan(0);
    expect(politeRegion().textContent).toBe("");
    // The WRONG remedy for a filename copy is explicitly forbidden.
    expect(alertText).not.toMatch(/select the document text/i);
    // A REACHABLE remedy: the file name is in the field right there.
    expect(alertText).toMatch(TITLE_NAME);

    // PERSISTS: advance well past the 3 s auto-dismiss and the alert survives
    // (a failure outcome schedules no clear timer).
    await act(async () => {
      vi.advanceTimersByTime(CLEAR_DELAY_MS + 500);
    });
    expect(alertRegion().textContent).toBe(alertText);
  });

  it("COMPANION CONTROL: a SUCCESS announcement self-clears past the same window, proving the timer machinery is live", async () => {
    // Without this the persistence assertion above is vacuous -- an outcome
    // that never clears anything would pass it. This proves the same strip DOES
    // clear a non-persisting outcome at CLEAR_DELAY_MS, so the failure's
    // survival is a real persist opt-out, not a dead timer.
    installClipboardStub();
    await render(baseProps());
    await clickTitleCopy();
    expect(chipRegion().textContent.trim().length).toBeGreaterThan(0); // shown
    await act(async () => {
      vi.advanceTimersByTime(CLEAR_DELAY_MS + 500);
    });
    expect(politeRegion().textContent).toBe(""); // self-cleared
    expect(chipRegion().textContent).toBe("");
  });
});
