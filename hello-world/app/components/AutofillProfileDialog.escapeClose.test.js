// @vitest-environment jsdom
//
// Defect 1's concrete real-world instance for THIS dialog (see
// FormDialog.test.js for the scaffold-level mechanism and its own header for
// the full story). AutofillProfileDialog.js owns `saving`/`error` as its own
// local state and, unlike every other FormDialog consumer in this repo
// (AddAppDialog.js, EditAppDialog.js, StageDialog.js,
// AddCommunicationDialog.js), never passed its `error` down to FormDialog's
// own `error` prop -- it rendered a separate inline `<Alert>` instead. That
// meant FormDialog's own escape-while-busy reopen fix (see FormDialog.js's
// `reopenForError`) had nothing to react to here: `error` at the FormDialog
// level was always "", so a save that failed after the user pressed Escape
// mid-save stayed invisible regardless of the scaffold fix.
//
// The real sequence this file reproduces: LiveFeedTab.js wires this dialog
// with `onClose={() => setAutofillDialogOpen(false)}` -- unconditional,
// exactly like every other affected dialog's own onClose -- so `Harness`
// below mirrors that real caller rather than a bare `vi.fn()` that would
// hide the bug.
//
// Same jsdom transition caveat as FormDialog.test.js: MUI's Fade exit
// transition never completes without advancing real timers, so
// `vi.useFakeTimers()` plus an explicit advance is what actually proves the
// dialog left the DOM before checking whether the failure brings it back.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot } from "react-dom/client";
import AutofillProfileDialog from "./AutofillProfileDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE = { fullName: "Alex Shaw", email: "alexandergshaw@gmail.com" };

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  delete global.fetch;
});

// Mirrors LiveFeedTab.js's REAL wiring (`onClose={() => setAutofillDialogOpen(false)}`)
// -- unconditional, regardless of `saving`. A bare `vi.fn()` onClose would
// never actually flip `open`, hiding the exact bug this file exists to catch.
function Harness() {
  const [open, setOpen] = useState(true);
  return createElement(AutofillProfileDialog, {
    open,
    onClose: () => setOpen(false),
    profile: PROFILE,
    onSaved: () => {},
  });
}

async function render() {
  await act(async () => {
    root.render(createElement(Harness));
  });
  // The dialog seeds its draft from `profile` on a 0ms timeout.
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

const dialogRoot = () => document.querySelector('[role="dialog"]');

function saveButton() {
  return Array.from(document.querySelectorAll(".MuiDialogActions-root button")).find((b) =>
    /save/i.test(b.textContent || ""),
  );
}

async function pressEscape() {
  const target = document.querySelector(".MuiDialog-root");
  await act(async () => {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

async function finishExitTransition() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

describe("AutofillProfileDialog -- a save that fails after Escape mid-save is not silently lost", () => {
  it("brings the dialog back with the failure once the interrupted save actually fails", async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    await render();
    expect(dialogRoot(), "[instrument] dialog did not render").not.toBeNull();

    const save = saveButton();
    expect(save, "[instrument] no Save control found").toBeTruthy();
    await act(async () => {
      save.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(global.fetch, "[instrument] Save did not start the request").toHaveBeenCalledTimes(1);

    // Escape while the save is still in flight.
    await pressEscape();
    await finishExitTransition();
    expect(
      dialogRoot(),
      "[instrument] the dialog must actually leave the DOM once its exit transition completes -- the exit must keep working",
    ).toBeNull();

    // The interrupted save now settles -- with a FAILURE.
    await act(async () => {
      resolveFetch({ ok: false, status: 500, json: async () => ({ error: "Could not reach the server." }) });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      dialogRoot(),
      "the failed save must bring the dialog back so the user can see it, not leave it silently lost off-screen",
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Could not reach the server.");
  });
});
