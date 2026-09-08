// @vitest-environment jsdom
//
// Two defects in the shared dialog scaffold. Written BEFORE the fix -- every
// case below fails against the current source unless marked GUARD.
//
// DEFECT 1 -- a save that fails after the user has already left is lost.
// FormDialog's own `requestClose` calls `onClose` unconditionally, even
// while `busy` (by design -- see FormDialog.js's own comment on the removed
// `allowCloseWhileBusy` gate: a busy lock is itself a defect, the ruling
// already made on CompanyResearchDialog). Every real caller's `onClose`
// reacts to that by setting its OWN `open` state to false, also
// unconditionally -- AddAppDialog.js, EditAppDialog.js, StageDialog.js,
// AddCommunicationDialog.js and experience/BulkActionsBar.js's bulk-delete
// confirm all do exactly this (see each file's own `onClose`/`close()`).
// That is correct for a save that SUCCEEDS after the user leaves. It is
// wrong for one that FAILS: the caller's async handler still calls its own
// `setXError(message)` once the request settles, but by then `open` is
// already false, so the dialog carrying that error's only display
// (FormDialog's own FieldError, fed by the `error` prop) never mounts. The
// user sees nothing and believes the save went through.
//
// The fix must not go the other way and turn `busy` into a lock -- Escape,
// the backdrop and Cancel must keep closing the dialog THE INSTANT they are
// used, exactly as today. What must change is what happens when a FAILURE
// arrives afterward: the dialog comes back to show it.
//
// MUI's own exit transition (Fade, a real `setTimeout`-driven
// react-transition-group `Transition`) never completes in jsdom without
// timers being advanced -- Modal.js only returns `null` (fully unmounting)
// once `!open && exited`, and `exited` is only ever set from the
// transition's `onExited` callback. Without advancing past it, the Paper
// stays in the DOM the whole time regardless of any fix here, which would
// make "the dialog is gone" a fabricated pass. `vi.useFakeTimers()` plus an
// explicit advance is what actually forces that transition to completion,
// so "gone" and "back" below are both real, not artifacts of an animation
// that never got the chance to run.
//
// DEFECT 2 -- the dialog's computed accessible name concatenates the title
// with the close button's own name, e.g. "Add application Close". MUI's
// Dialog always stamps ONE `aria-labelledby` (Dialog.js's own
// `useId(ariaLabelledbyProp)`) pointing at whatever element ends up with
// `id={titleId}` -- and DialogTitle.js hands that id to itself
// unconditionally. On a phone, FormDialog renders the close IconButton
// INSIDE that same `<DialogTitle>`, alongside the title text, so the
// labelledby target's "name from content" pulls in both. A `textContent`
// proxy (this repo's own NavTabs/JobDescriptionTab `accessibleName`
// helpers) would NOT catch this -- the close button contributes no visible
// text, only an `aria-label`, and `textContent` does not consult it.
// `computedAccessibleName` below does the real WAI-ARIA substitution (an
// embedded control's OWN `aria-label` stands in for its subtree), which is
// what actually reproduces "Add application Close" against the unfixed
// source.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../theme/index.js";
import FormDialog from "./FormDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport emulation (same stub as FormDialog.mobile.test.js) -----------
const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = PHONE;

function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}

window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

let container;
let root;

beforeEach(() => {
  viewportWidth = PHONE;
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
    root.render(
      createElement(
        ThemeProvider,
        { theme },
        createElement(FormDialog, { open: true, title: "Add application", ...props }, "body"),
      ),
    );
  });
}

const dialogRoot = () => document.querySelector('[role="dialog"]');

async function pressEscape() {
  const target = document.querySelector(".MuiDialog-root");
  await act(async () => {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// Real accname computation, not a `textContent` proxy -- see header.
// ---------------------------------------------------------------------------
function nameFromContent(el) {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.getAttribute("aria-hidden") === "true") continue;
      const ownLabel = node.getAttribute("aria-label");
      out += " " + (ownLabel || nameFromContent(node));
    }
  }
  return out;
}

function computedAccessibleName(el) {
  const own = el.getAttribute("aria-label");
  if (own) return own.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (!labelledBy) return "";
  const ids = labelledBy.split(/\s+/).filter(Boolean);
  const parts = ids.map((id) => {
    const target = document.querySelector(`#${CSS.escape(id)}`);
    return target ? nameFromContent(target) : "";
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// DEFECT 2 -- computed accessible name must be the title alone.
// ---------------------------------------------------------------------------
describe("FormDialog -- computed accessible name excludes the close control", () => {
  it("names the dialog by its title alone on a phone, where the close X shares the title bar", async () => {
    await render({});
    const dlg = dialogRoot();
    expect(dlg, "[instrument] no role=dialog element rendered").not.toBeNull();
    expect(
      computedAccessibleName(dlg),
      "the dialog's computed name must be the title text ONLY -- the close button's own accessible name must not be concatenated onto it",
    ).toBe("Add application");
  });

  it("GUARD (passes before the fix too): names the dialog by its title on desktop, where there is no close button in the title bar", async () => {
    viewportWidth = DESKTOP;
    await render({});
    const dlg = dialogRoot();
    expect(dlg).not.toBeNull();
    expect(computedAccessibleName(dlg)).toBe("Add application");
  });
});

// ---------------------------------------------------------------------------
// DEFECT 1 -- a save that fails after an escape-while-busy close is not
// silently lost.
// ---------------------------------------------------------------------------
describe("FormDialog -- a save that fails after an escape-while-busy close is not silently lost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Forces MUI's Fade exit transition to completion -- see header. Must run
  // inside `act()`: the transition's `onExited` callback drives a setState.
  async function finishExitTransition() {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }

  it("still closes on Escape while busy -- the fix must not add a busy lock", async () => {
    let closes = 0;
    await render({ busy: true, error: "", onClose: () => { closes += 1; } });
    await pressEscape();
    expect(closes).toBe(1);
  });

  it("brings the dialog back to show the error once the interrupted save actually fails", async () => {
    let closes = 0;
    await render({ busy: true, error: "", onClose: () => { closes += 1; } });
    await pressEscape();
    expect(closes).toBe(1);

    // The caller's own onClose (AddAppDialog.js etc. -- see header) reacts
    // by setting `open: false` unconditionally, regardless of the save
    // still being in flight. Mirror that here.
    await render({ open: false, busy: true, error: "" });
    await finishExitTransition();
    expect(dialogRoot(), "[instrument] the dialog must actually leave the DOM once its exit transition completes -- the exit must keep working").toBeNull();

    // The interrupted save now settles -- with a FAILURE, exactly like
    // AddAppDialog's own handleSaveAddApplication: setXError(message) then
    // setXSaving(false), with `open` never touched again.
    await render({ open: false, busy: false, error: "Failed to save application." });

    expect(
      dialogRoot(),
      "the save's own failure must bring the dialog back so the user can see it, not leave it silently lost off-screen",
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Failed to save application.");
  });

  it("does NOT reopen when the interrupted save actually succeeds", async () => {
    await render({ busy: true, error: "", onClose: () => {} });
    await pressEscape();
    await render({ open: false, busy: true, error: "" });
    await finishExitTransition();
    expect(dialogRoot()).toBeNull();

    // Success: busy clears and error stays empty, exactly like every real
    // caller's success path (see header).
    await render({ open: false, busy: false, error: "" });

    expect(dialogRoot(), "a successful save must not resurrect the dialog").toBeNull();
  });

  it("GUARD (passes before the fix too): an error while the dialog is still genuinely open is unaffected", async () => {
    await render({ open: true, busy: false, error: "Company and Role are required." });
    expect(dialogRoot()).not.toBeNull();
    expect(document.body.textContent).toContain("Company and Role are required.");
  });
});
