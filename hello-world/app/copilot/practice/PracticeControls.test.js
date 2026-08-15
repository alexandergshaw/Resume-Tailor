// @vitest-environment jsdom
//
// AC-Q7.5: the download-log button lives on this presentational surface —
// see ManualQuestion.test.js for the precedent this harness follows (raw
// react-dom/client + act, no ThemeProvider needed for MUI's own default
// theme). This file only covers what PracticeControls itself controls: the
// button's label, its disabled/enabled state and accessible explanation, and
// that every control on this screen still resolves to its OWN accessible
// name — this codebase's own MUI Tooltip-on-disabled-span trap (see
// mui-a11y-traps) steals a control's name, and this component already had
// one near-miss of that shape (the pre-draft switch's own caption, written
// as plain text for exactly this reason). What actually gets recorded is
// usePracticeSessionLog.test.js's job, not this file's.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PracticeControls from "./PracticeControls.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function baseProps(overrides) {
  return {
    micDeviceId: null,
    onMicDeviceChange: vi.fn(),
    running: false,
    status: "idle",
    onStop: vi.fn(),
    onStart: vi.fn(),
    startedAt: null,
    elapsed: 0,
    controlsEnabled: false,
    cameraOff: false,
    hasVideo: false,
    onToggleCamera: vi.fn(),
    micMuted: false,
    onToggleMic: vi.fn(),
    sendFrames: false,
    isEmbedded: false,
    onSendFramesChange: vi.fn(),
    saveEnabled: true,
    onToggleSaveEnabled: vi.fn(),
    preDraftPredicted: true,
    onPreDraftChange: vi.fn(),
    showPredictions: true,
    onDownloadLog: vi.fn(),
    downloadLogEnabled: false,
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(PracticeControls, props));
  });
}

function allButtons() {
  return Array.from(container.querySelectorAll("button"));
}

function downloadButton() {
  const el = allButtons().find((b) => b.textContent.trim() === "Download session log");
  expect(el, "a 'Download session log' button must be rendered").toBeTruthy();
  return el;
}

// The accessible name a screen reader would announce for a button: its own
// aria-label if present (Tooltip's disabled-span idiom would have written
// one that is NOT this button's own text — see this repo's own a11y-trap
// note), otherwise its text content.
function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  return (el.textContent || "").trim();
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("the download-log button (AC-Q7.5)", () => {
  it("is visible before a session has ever run, disabled, with an accessible explanation", async () => {
    await render(baseProps({ downloadLogEnabled: false }));
    const btn = downloadButton();
    expect(btn.disabled).toBe(true);
    const describedBy = btn.getAttribute("aria-describedby");
    expect(describedBy, "a disabled control needs an accessible reason, not a Tooltip").toBeTruthy();
    const reason = container.querySelector(`#${CSS.escape(describedBy)}`);
    expect(reason, "the id the button points at must actually exist").toBeTruthy();
    expect(reason.textContent).toMatch(/session has started/i);
  });

  it("is enabled once something has been recorded, during a running session", async () => {
    await render(baseProps({ running: true, status: "live", downloadLogEnabled: true }));
    const btn = downloadButton();
    expect(btn.disabled).toBe(false);
    // Enabled means no dangling reason pointed at by aria-describedby.
    expect(btn.getAttribute("aria-describedby")).toBeFalsy();
  });

  it("stays visible and enabled AFTER the session has stopped (AC-Q7.4)", async () => {
    // Stopped: running/status back to idle, but downloadLogEnabled stays
    // true because something was recorded during the session that just
    // ended — the same "hasLog never goes back to false" contract
    // usePracticeSessionLog.js documents.
    await render(baseProps({ running: false, status: "idle", downloadLogEnabled: true }));
    const btn = downloadButton();
    expect(btn.disabled).toBe(false);
  });

  it("calls onDownloadLog exactly once per click — one button, no menu, no confirmation", async () => {
    const onDownloadLog = vi.fn();
    await render(baseProps({ downloadLogEnabled: true, onDownloadLog }));
    await click(downloadButton());
    expect(onDownloadLog).toHaveBeenCalledTimes(1);
    // No confirm dialog, no second control appeared as a result of the
    // click — still exactly one button with this label.
    expect(allButtons().filter((b) => b.textContent.trim() === "Download session log")).toHaveLength(1);
  });

  it("every control on this screen still has its own, distinct accessible name", async () => {
    await render(baseProps({ running: true, status: "live", downloadLogEnabled: false, hasVideo: true }));
    const names = allButtons().map(accessibleName);
    // Every button actually has a name at all (an empty string would mean
    // some other control's Tooltip stole it out from under this one).
    for (const name of names) expect(name).not.toBe("");
    // And no two controls collapsed onto the same name.
    expect(new Set(names).size).toBe(names.length);
  });
});
