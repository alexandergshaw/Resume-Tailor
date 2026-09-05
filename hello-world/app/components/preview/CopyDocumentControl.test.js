// @vitest-environment jsdom
//
// ACCEPTANCE tests for AC-C6 (one activation, a real <button>, no key handler),
// AC-C10 (the enable gate's affordance and the refusal), AC-C2 (the label is
// captured at click time) and the parts of AC-C14/AC-C18 that are source shape.
//
// ===========================================================================
// THE JSDOM CLIPBOARD SEAM -- read this before adding a test to this file.
// ===========================================================================
// Measured in this exact environment (jsdom 29.1.1): `document.execCommand`,
// `navigator.clipboard`, `ClipboardEvent` and `DataTransfer` are ALL
// `undefined`. So with the shipped default deps EVERY click here takes the
// same failure branch, the success region is never fed, and a suite that
// asserts only "an outcome was announced" goes green on the wrong region --
// while the two failure modes this feature is measured on, a stale pre-edit
// paste and a paste missing every bullet, live only on the SUCCESS path.
//
// Hence: a NAMED install/remove pair, an afterEach that restores genuine
// absence, and two controls that must both stay in this file --
//
//   POSITIVE CONTROL  no stub installed -> the outcome is a FAILURE.
//                     (`writePlainText` returns reason:"unavailable" there;
//                     the literal is asserted in lib/clipboard/plainText.test.js,
//                     since the control's onOutcome carries a finished
//                     {polite, alert, visible, persist} and no reason field.)
//   NEGATIVE CONTROL  stub installed and resolving -> the polite half is
//                     non-empty AND the alert half is exactly "".
//
// `expect(x).not.toBe("")` on one half alone is banned in this file.
//
// TEARDOWN RULE: `delete navigator.clipboard`, NEVER `= undefined`.
// Measured: after `delete`, hasOwnProperty is false (the state jsdom starts
// in); after `= undefined`, `"clipboard" in navigator` is TRUE for every later
// file sharing this worker under --no-file-parallelism, so a feature check
// written as `in` silently changes behaviour in an unrelated suite.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import CopyDocumentControl from "./CopyDocumentControl.js";
import { DISABLED_REASON } from "./copyOutcome.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RESUME_TEXT = "ALEX SHAW\n\nEXPERIENCE\nLed migration\n";

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

// A hand-built, CANCELABLE copy event with a defineProperty'd fake
// clipboardData, dispatched separately -- a stubbed execCommand fires no copy
// event of its own (measured), and a non-cancelable event reports
// defaultPrevented === false after preventDefault(), which would make the
// assertion vacuous.
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

// Every <textarea> ADDED to the document while `run` executes.
//
// The step-3 fence CANNOT be observed after the fact: writePlainText removes
// the node in a `finally`, so `document.querySelectorAll("textarea").length` is
// 0 in BOTH modes once the click has settled (measured -- view mode adds one
// and leaves none behind; edit mode adds none). Only the CREATION
// discriminates, so the absence assertion below is paired with an observer that
// can see a presence.
//
// Measured too, and the reason `.select()` is asserted on the retained node
// rather than on the live document: jsdom's HTMLTextAreaElement.select() does
// NOT move document.activeElement (it stays on <body>), so the real-browser
// harm the fence exists to prevent -- .select() steals focus, the
// contentEditable's onBlur runs commitDraft, `edited` flips -- is not itself
// reproducible here. selectionStart/selectionEnd survive the node's removal, so
// "it was selected" is.
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
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function baseProps(overrides = {}) {
  return {
    getText: () => RESUME_TEXT,
    copyState: "ready",
    scopeLabel: "Resume",
    accessibleName: "Copy text of the resume",
    variant: "outlined",
    mode: "view",
    onOutcome: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(CopyDocumentControl, props));
  });
  // MUI portals nothing here, but a stale render still leaves a second button
  // reachable from `document` if a test forgets to unmount -- the same trap
  // that made a six-branch dialog probe return byte-identical output for all
  // six branches until every render unmounted the previous one.
  expect(document.querySelectorAll("button")).toHaveLength(1);
}

const control = () => container.querySelector("button");

async function click() {
  await act(async () => {
    control().click();
  });
}

// The repo's name resolver (app/components/feed/FeedToolbar.test.js), not
// `aria-label || textContent`: what an assistive technology actually resolves,
// rather than one technique for supplying it.
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

// The tri-state helper, COPIED from DocumentPreviewDialog.drive.test.js lines
// 537-543, where it is local to
// describe("AC-E14: no Drive action writes busy/notice/error, pinned across all ten gated controls")
// and therefore not importable. Measured: for an aria-disabled MUI Button
// `el.disabled === false` and `classList.contains("Mui-disabled") === false`,
// so a naive `expect(el.disabled).toBe(true)` is RED against correct code.
function isDisabled(el) {
  if (!el) return null;
  if (el.disabled === true) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.classList?.contains("Mui-disabled")) return true;
  return false;
}

// `readFileSync(new URL(rel, import.meta.url))` -- the idiom
// lib/drive/lineCeiling.test.js uses -- throws "The URL must be of scheme
// file" under a jsdom-environment file, because the global URL there is
// jsdom's class and node:fs does not accept it. fileURLToPath takes the string
// and hands back a plain path, which node:fs always accepts.
const HERE = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel) => readFileSync(join(HERE, rel), "utf8");

const SOURCE = srcOf("CopyDocumentControl.js");

function nonEmptyString(value) {
  expect(typeof value).toBe("string");
  expect(value.length).toBeGreaterThan(0);
  return value;
}

// ---------------------------------------------------------------------------
// harness controls
// ---------------------------------------------------------------------------

describe("harness controls", () => {
  it("this jsdom supplies NO clipboard surface at all -- which is what the seam exists for", () => {
    expect(typeof document.execCommand).toBe("undefined");
    expect(typeof navigator.clipboard).toBe("undefined");
    expect(typeof ClipboardEvent).toBe("undefined");
    expect(typeof DataTransfer).toBe("undefined");
  });

  it("the stub installs and DELETES cleanly, leaving no own key behind", () => {
    installClipboardStub();
    expect(typeof navigator.clipboard.writeText).toBe("function");
    removeClipboardStub();
    removeClipboardStub = null;
    expect(Object.prototype.hasOwnProperty.call(navigator, "clipboard")).toBe(false);
    installExecCommandStub(() => true);
    expect(typeof document.execCommand).toBe("function");
    removeExecCommandStub();
    removeExecCommandStub = null;
    expect(Object.prototype.hasOwnProperty.call(document, "execCommand")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE TWO SEAM CONTROLS
// ---------------------------------------------------------------------------

describe("the clipboard seam's two controls", () => {
  it("POSITIVE CONTROL: with NO stub installed a click produces a FAILURE, not a success", async () => {
    // Without this row a beforeEach that silently fails to install -- a typo,
    // a rename, a vi.stubGlobal the environment ignores -- is
    // indistinguishable from a working one, because BOTH produce "an outcome
    // was announced".
    const onOutcome = vi.fn();
    await render(baseProps({ onOutcome }));
    await click();
    expect(onOutcome).toHaveBeenCalledTimes(1);
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.alert);
    expect(outcome.polite).toBe("");
  });

  it("NEGATIVE CONTROL: with the stub installed and resolving, the polite half is fed and the alert half is exactly \"\"", async () => {
    installClipboardStub();
    const onOutcome = vi.fn();
    await render(baseProps({ onOutcome }));
    await click();
    expect(onOutcome).toHaveBeenCalledTimes(1);
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.polite);
    expect(outcome.alert).toBe("");
    // AC-C7: text/plain only, as a string, byte for byte.
    expect(writeTextCalls).toEqual([RESUME_TEXT]);
    expect(typeof writeTextCalls[0]).toBe("string");
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  it("reaches the copy-event fallback when there is no async clipboard, and prevents the event's default", async () => {
    // The union's second path, driven end to end through the control. The
    // stub is what decides whether the listener ran -- a stubbed execCommand
    // fires no copy event of its own.
    const store = [];
    let copyEvent = null;
    installExecCommandStub((command) => {
      if (command === "copy") copyEvent = dispatchCopyEvent(store);
      return true;
    });
    const onOutcome = vi.fn();
    await render(baseProps({ onOutcome }));
    await click();
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.polite);
    expect(outcome.alert).toBe("");
    expect(store).toEqual([{ type: "text/plain", value: RESUME_TEXT }]);
    // preventDefault() is load-bearing: without it the spec copies the current
    // SELECTION, which in the dialog can include DriveResultRegion's two
    // visuallyHidden clip-rect regions -- "Saved 2 documents to Drive" landing
    // in an ATS resume field.
    expect(copyEvent.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-C4 / AC-C9.1 -- the edit-mode fence, WIRED
// ---------------------------------------------------------------------------

describe("AC-C4 / AC-C9.1: `mode` is carried into writePlainText, and fences step 3 ONLY", () => {
  // Every other edit-mode row in this file installs the ASYNC clipboard stub,
  // which returns from step 1 -- so step 3 is never reached, `mode` is never
  // read, and four separate defects are invisible: the dialog omitting
  // `mode={mode}`, the dialog passing `mode="view"` literally, the control
  // calling `writePlainText(text)` with no options object at all, and the
  // fence being placed BEFORE step 2 instead of after it. The three rows here
  // drive step 3 and step 2 deliberately, with NO async clipboard.
  //
  // The harm the fence prevents, in bytes: `.select()` takes focus, the
  // contentEditable's onBlur runs commitDraft -> onSave -> saveDocumentPreview
  // sets `edited` with no dirty check, and editedForScope then switches
  // `Download .docx` from serving the engine bytes verbatim to REBUILDING them
  // onto the template -- a rebuild that has already lost every blank paragraph
  // of the cover letter. A user who opens Edit, types nothing, copies, and
  // downloads receives different bytes than one who never pressed Copy.

  it("mode=\"edit\": step 3 is never entered -- no textarea is created, and the refusal is announced", async () => {
    // The INERT branch of step 2: execCommand returns true but fires no copy
    // event of its own (measured), so `ran` stays false and the union falls
    // through to step 3 -- which is exactly where the fence must stop it.
    installExecCommandStub(() => true);
    const onOutcome = vi.fn();
    await render(baseProps({ mode: "edit", getText: () => RESUME_TEXT, onOutcome }));
    const created = await textareasCreatedDuring(click);
    expect(created).toHaveLength(0);
    // ...and nothing was left behind either, which is the weaker claim the
    // post-hoc count can make on its own.
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.alert);
    expect(outcome.polite).toBe("");
  });

  it("POSITIVE CONTROL: the identical click with mode=\"view\" DOES create and select one, and succeeds", async () => {
    // Without this row the assertion above is satisfied by a control that
    // never reaches step 3 in ANY mode -- a `writePlainText` that returned
    // early, a stub that was not installed, a button that did nothing.
    installExecCommandStub(() => true);
    const onOutcome = vi.fn();
    await render(baseProps({ mode: "view", getText: () => RESUME_TEXT, onOutcome }));
    const created = await textareasCreatedDuring(click);
    expect(created).toHaveLength(1);
    expect(created[0].value).toBe(RESUME_TEXT);
    // ...and it really was SELECTED: this is the act that steals focus in a
    // real browser, and the whole reason edit mode must not reach it.
    expect(created[0].selectionStart).toBe(0);
    expect(created[0].selectionEnd).toBe(RESUME_TEXT.length);
    expect(document.querySelectorAll("textarea")).toHaveLength(0); // removed again
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.polite);
    expect(outcome.alert).toBe("");
  });

  it("mode=\"edit\" STILL copies through the copy-event path -- the fence is after step 2, never before it", async () => {
    // A fence hoisted above step 2 passes both rows above and silently breaks
    // copy in edit mode on every origin that has no async clipboard: an
    // insecure-context (plain http) deployment, and the older Safari the
    // copy-event path exists for. The user is told to select the document and
    // copy it by hand while sitting in front of a browser that can copy it --
    // and the editor is precisely where they have just made the edit they most
    // want on the clipboard.
    const store = [];
    installExecCommandStub((command) => {
      if (command === "copy") dispatchCopyEvent(store);
      return true;
    });
    const onOutcome = vi.fn();
    await render(baseProps({ mode: "edit", getText: () => RESUME_TEXT, onOutcome }));
    const created = await textareasCreatedDuring(click);
    expect(created).toHaveLength(0); // ...and step 3 is STILL never entered
    expect(store).toEqual([{ type: "text/plain", value: RESUME_TEXT }]);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.polite);
    expect(outcome.alert).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-C6 -- the control itself
// ---------------------------------------------------------------------------

describe("AC-C6: a real <button>, one activation, and NO key handler of its own", () => {
  it("is a native BUTTON with an explicit type and no role shim", async () => {
    await render(baseProps());
    expect(control().tagName).toBe("BUTTON");
    expect(control().getAttribute("type")).toBeTruthy();
    expect(control().getAttribute("role")).toBeNull();
  });

  it("INVERTED KEY ASSERTION: Enter and Space produce NO clipboard write", async () => {
    // In a real browser Enter and Space each fire a synthesized `click`, so an
    // onKeyDown that invokes the action makes EVERY keypress copy twice: two
    // writes, two announcements, and on the fallback a race between two copy
    // events. jsdom produces 0 clicks from synthetic Enter/Space on a native
    // button (measured), so the naive assertion ("keys dispatch the handler
    // once") is RED against correct code. This is its inverse.
    installClipboardStub();
    const onOutcome = vi.fn();
    await render(baseProps({ onOutcome }));
    for (const key of ["Enter", " "]) {
      await act(async () => {
        control().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        control().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      });
    }
    expect(writeTextCalls).toHaveLength(0);
    expect(onOutcome).not.toHaveBeenCalled();
    // Positive control: the same control DOES copy when actually clicked, so
    // the zero above is about the key handler and not about a dead button.
    await click();
    expect(writeTextCalls).toHaveLength(1);
  });

  it("onMouseDown carries ONLY preventDefault -- the action is on onClick", async () => {
    // The focus guard: a pointer activation must not take focus from the
    // editor, because the contentEditable's onBlur runs commitDraft (AC-C4).
    // EditorToolbar.js puts the ACTION on onMouseDown for all eight of its
    // format buttons -- the right focus idiom on the wrong event, and those
    // eight are keyboard-dead. This copies the idiom and not the defect.
    installClipboardStub();
    const onOutcome = vi.fn();
    await render(baseProps({ onOutcome }));
    let ev;
    await act(async () => {
      ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      control().dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(writeTextCalls).toHaveLength(0);
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("a keyboard activation leaves focus on the control and does not move it elsewhere", async () => {
    installClipboardStub();
    await render(baseProps());
    await act(async () => {
      control().focus();
      control().click();
    });
    expect(document.activeElement).toBe(control());
  });

  it("two deliberate activations both write and both announce -- no debounce, no double-click guard", async () => {
    // S9: a second deliberate copy, after the user overwrote the clipboard in
    // the ATS, must work immediately.
    installClipboardStub();
    const onOutcome = vi.fn();
    await render(baseProps({ onOutcome }));
    await click();
    await click();
    expect(writeTextCalls).toEqual([RESUME_TEXT, RESUME_TEXT]);
    expect(onOutcome).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// AC-C12.2 / AC-C18.3 -- the two labels
// ---------------------------------------------------------------------------

describe("AC-C12.2: the visible label and the accessible name are SEPARATE, and 2.5.3 holds", () => {
  it("the visible text is a contiguous substring of the accessible name", async () => {
    await render(baseProps({ scopeLabel: "Cover letter", accessibleName: "Copy text of the cover letter" }));
    const visible = nonEmptyString(control().textContent.trim());
    const name = nonEmptyString(accessibleName(control()));
    expect(name).toContain(visible);
    // The accessible name carries the scope -- a screen-reader user has no
    // other confirmation of WHICH document they are copying, and AC-C2 exists
    // because getting that wrong costs an application.
    expect(name.toLowerCase()).toContain("cover letter");
  });

  it("the VISIBLE label does not change with the scope, and fits AC-C18.3's 12-character bound", async () => {
    // A label that mutated ("Copy resume text" -> "Copy cover letter text")
    // changes the button's width by ~6 characters; DialogActions carries
    // flexWrap:"wrap", so at 375 px that is enough to move the button to a
    // different line BETWEEN the two copies the user is alternating between.
    const seen = new Set();
    for (const [scopeLabel, name] of [
      ["Resume", "Copy text of the resume"],
      ["Cover letter", "Copy text of the cover letter"],
      ["Hiring email", "Copy text of the hiring email"],
    ]) {
      await render(baseProps({ scopeLabel, accessibleName: name }));
      const visible = nonEmptyString(control().textContent.trim());
      expect(visible.length).toBeLessThanOrEqual(12);
      seen.add(visible);
    }
    expect(seen.size).toBe(1);
  });

  it("the label is stable across every outcome state the control can render", async () => {
    // A success or failure word swapped into the label is exactly where a long
    // string sneaks into a 375 px bar -- and it breaks 2.5.3 for as long as it
    // shows, because the visible text stops being a substring of the name.
    installClipboardStub();
    await render(baseProps());
    const before = control().textContent.trim();
    await click();
    expect(control().textContent.trim()).toBe(before);
    expect(accessibleName(control())).toContain(control().textContent.trim());
  });

  it("takes its variant from the slot: contained on the email tab, outlined beside Download .docx", async () => {
    await render(baseProps({ variant: "outlined" }));
    expect(control().classList.contains("MuiButton-outlined")).toBe(true);
    expect(control().classList.contains("MuiButton-contained")).toBe(false);
    await render(baseProps({ variant: "contained" }));
    expect(control().classList.contains("MuiButton-contained")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-C10.2 / AC-C10.3 -- the disabled affordance
// ---------------------------------------------------------------------------

const DISABLED_STATES = ["unavailable", "unloaded", "loading", "errored"];

describe("AC-C10.3: the disabled affordance is a CONJUNCTION of three, because each alone is satisfiable by a defect", () => {
  it.each(DISABLED_STATES)("copyState=%s: aria-disabled true, no native disabled, pointer events NOT none", async (copyState) => {
    await render(baseProps({ copyState }));
    const el = control();
    // hasAttribute is useless: aria-disabled={false} renders literally as
    // "false", so only === "true" works.
    expect(el.getAttribute("aria-disabled")).toBe("true");
    // Native `disabled` is rejected: a focused control disabled by an async
    // event (a revise landing, a highlight toggle) is blurred and dropped
    // from the tab order -- the keyboard user's position destroyed by an
    // event they did not cause. DriveActions.js's header rules this for this
    // exact bar.
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.disabled).toBe(false);
    expect(el.tabIndex).toBe(0);
    // pointerEvents:"none" swallows a mouse user's click in silence, so they
    // get no reason at all -- the dead end this design exists to remove. And
    // it CANNOT be observed by a click-based assertion: both .click() and a
    // dispatched MouseEvent reach the handler regardless (measured).
    expect(getComputedStyle(el).pointerEvents).not.toBe("none");
    expect(isDisabled(el)).toBe(true);
  });

  it("POSITIVE CONTROL: copyState=ready renders aria-disabled=\"false\" -- so a selector that finds nothing cannot pass the four rows above", async () => {
    await render(baseProps({ copyState: "ready" }));
    expect(control().getAttribute("aria-disabled")).toBe("false");
    expect(isDisabled(control())).toBe(false);
  });

  it("is visibly dimmed when disabled, written explicitly against the same flag", async () => {
    // An `&.Mui-disabled` sx block is DEAD CODE here: aria-disabled applies no
    // Mui-disabled class (measured, with a positive control), so a block keyed
    // on it inherits nothing and the control LOOKS ENABLED while announcing
    // disabled.
    await render(baseProps({ copyState: "loading" }));
    expect(control().classList.contains("Mui-disabled")).toBe(false);
    expect(Number.parseFloat(getComputedStyle(control()).opacity)).toBeLessThan(1);
    await render(baseProps({ copyState: "ready" }));
    expect(Number.parseFloat(getComputedStyle(control()).opacity)).toBe(1);
  });
});

describe("AC-C10.4: every activation of a disabled control produces ONE announced outcome and NO clipboard write", () => {
  it.each(DISABLED_STATES)("copyState=%s refuses with a reason and writes nothing", async (copyState) => {
    installClipboardStub();
    const onOutcome = vi.fn();
    const getText = vi.fn(() => RESUME_TEXT);
    await render(baseProps({ copyState, onOutcome, getText }));
    await click();
    expect(writeTextCalls).toHaveLength(0);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.alert);
    expect(outcome.polite).toBe("");
    expect(outcome.alert.toLowerCase()).toContain("resume");
  });

  it("the disabled states announce their own reason -- the three DIFFERENT situations get three different sentences", async () => {
    // The user needs to tell "nothing has been generated for this posting"
    // from "it is still loading" from "the render failed" -- three different
    // things to do next. `unloaded` and `loading` deliberately SHARE one
    // sentence (1c's O5 covers "activated while not yet loaded / loading"):
    // to the user they are the same situation, and the first-paint frame is
    // not something they can name. Asserting four distinct sentences would be
    // red against the settled design.
    const messages = {};
    for (const copyState of DISABLED_STATES) {
      const onOutcome = vi.fn();
      await render(baseProps({ copyState, onOutcome }));
      await click();
      messages[copyState] = nonEmptyString(onOutcome.mock.calls[0][0].alert);
    }
    const distinctCauses = [messages.unavailable, messages.loading, messages.errored];
    expect(new Set(distinctCauses).size).toBe(3);
    // ...and `unloaded` SHARES `loading`'s sentence, which is the claim the
    // design actually makes.
    //
    // The assertion this replaces -- `new Set(Object.values(messages)).size`
    // >= 3 -- could not fail: the line above already pins three of these four
    // values pairwise distinct, so the four-value set was never smaller than 3
    // whatever `unloaded` said. It would have stayed green for an `unloaded`
    // that announced the ERRORED sentence, telling a user watching a document
    // arrive that the render had failed.
    expect(messages.unloaded).toBe(messages.loading);
  });

  it("the four disabled sentences are DERIVED from DISABLED_REASON, state for state", async () => {
    // The map is exported and totality-checked in copyOutcome.test.js, but
    // nothing tied its CONTENT to what the user hears -- so a second, hardcoded
    // table inside the message builder satisfied every existing row, and the
    // map's whole stated purpose (a future sixth state announcing a sentence
    // rather than nothing) rested on a duplicate that nothing keeps in step.
    //
    // The instrument is the map's own AGREEMENT PATTERN rather than its literal
    // strings: the map holds per-STATE templates while 1c's sentences name the
    // SCOPE, and the gate must not guess which side owns that substitution
    // (see the note in copyOutcome.test.js's header). Two states share a
    // sentence in the map if and only if they share one on screen.
    const messages = {};
    for (const copyState of DISABLED_STATES) {
      const onOutcome = vi.fn();
      await render(baseProps({ copyState, scopeLabel: "Cover letter", onOutcome }));
      await click();
      messages[copyState] = nonEmptyString(onOutcome.mock.calls[0][0].alert);
      // Whatever owns the substitution, the finished sentence names the scope:
      // a screen-reader user has no other confirmation of WHICH document was
      // refused.
      expect(messages[copyState].toLowerCase()).toContain("cover letter");
    }
    for (const a of DISABLED_STATES) {
      for (const b of DISABLED_STATES) {
        expect(messages[a] === messages[b]).toBe(DISABLED_REASON[a] === DISABLED_REASON[b]);
      }
    }
    // SELF-TEST, both directions: the map really does contain an agreeing pair
    // AND a disagreeing pair, so the equivalence above is vacuous in neither.
    expect(DISABLED_REASON.unloaded).toBe(DISABLED_REASON.loading);
    expect(DISABLED_REASON.unavailable).not.toBe(DISABLED_REASON.errored);
  });

  it("pressing a disabled control TWICE announces TWICE", async () => {
    // Without this the user presses the greyed button twice and hears the
    // reason once. None of the four design documents pinned it.
    const onOutcome = vi.fn();
    await render(baseProps({ copyState: "loading", onOutcome }));
    await click();
    await click();
    expect(onOutcome).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// "unavailable" is ONE literal naming TWO unrelated situations
// ---------------------------------------------------------------------------

// A manual-copy INSTRUCTION -- the thing that distinguishes "the clipboard did
// not work, here is what to do" from "there is nothing to copy". 1c's failure
// sentence is "Couldn't copy the {scope}. Select the document text and copy it
// manually."; none of the four enable-gate sentences carries an instruction,
// because none of them has one to give.
const MANUAL_COPY_INSTRUCTION = /\bmanual/i;

describe("the enable-state \"unavailable\" and the clipboard-failure \"unavailable\" are DIFFERENT sentences", () => {
  it("neither situation is answered with the other's message, and only the failure carries an instruction", async () => {
    // `"unavailable"` is overloaded: it is a `copyState` value (this posting
    // has no resume yet) AND a `writePlainText` failure reason (this browser
    // exposed no clipboard surface at all). Both collide through a message
    // table keyed on a bare string, and BOTH directions are harmful:
    //
    //   failure answered by the gate sentence -> a user looking at a perfectly
    //   good resume is told "There is no resume for this posting yet." -- a
    //   false statement about their own application data, and one that sends
    //   them to re-tailor a document that already exists.
    //
    //   gate answered by the failure sentence -> a genuinely empty scope is
    //   told to "select the document text and copy it manually", pointing the
    //   user at document text that does not exist.
    //
    // SELF-TEST of the instrument first, so a typo cannot make the two
    // assertions below permanently green.
    expect(MANUAL_COPY_INSTRUCTION.test("Select the document text and copy it manually.")).toBe(true);
    expect(MANUAL_COPY_INSTRUCTION.test("There is no resume for this posting yet.")).toBe(false);

    // (a) the ENABLE-STATE unavailable: the gate refuses before any write.
    const gate = vi.fn();
    await render(baseProps({ copyState: "unavailable", onOutcome: gate }));
    await click();
    const gateOutcome = gate.mock.calls[0][0];
    const gateAlert = nonEmptyString(gateOutcome.alert);

    // (b) the CLIPBOARD-FAILURE unavailable: copyState "ready", and no stub of
    // any kind -- which is exactly the {ok:false, via:"copyEvent",
    // reason:"unavailable"} branch this jsdom produces by default.
    const failure = vi.fn();
    await render(baseProps({ copyState: "ready", onOutcome: failure }));
    await click();
    const failureOutcome = failure.mock.calls[0][0];
    const failureAlert = nonEmptyString(failureOutcome.alert);

    expect(failureAlert).not.toBe(gateAlert);
    expect(MANUAL_COPY_INSTRUCTION.test(failureAlert)).toBe(true);
    expect(MANUAL_COPY_INSTRUCTION.test(gateAlert)).toBe(false);
    // ...and the second, independent discriminator (1c section 7.3): only the
    // one carrying an instruction stays on screen to be read.
    expect(failureOutcome.persist).toBe(true);
    expect(gateOutcome.persist).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-C10.1 -- the blank-document refusal, at click time, in BOTH modes
// ---------------------------------------------------------------------------

describe("AC-C10.1: a blank document is refused at CLICK time, in both modes, and never announced as a success", () => {
  it.each([
    ["view", ""],
    ["view", "   "],
    ["view", "\n\n  \n"],
    ["edit", ""],
    ["edit", "   "],
  ])("mode=%s, text=%j: one refusal, zero writes", async (mode, text) => {
    // Reachability is real: previewScopeAvailable(entry,"cover") is just
    // `Array.isArray(coverLetterResultLines) && length > 0`, so an entry whose
    // lines are ["",""] renders an AVAILABLE cover tab over a blank surface.
    // No success is ever announced over an empty clipboard.
    installClipboardStub();
    const onOutcome = vi.fn();
    await render(baseProps({ mode, getText: () => text, onOutcome }));
    await click();
    expect(writeTextCalls).toHaveLength(0);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    const outcome = onOutcome.mock.calls[0][0];
    nonEmptyString(outcome.alert);
    expect(outcome.polite).toBe("");
  });

  it("AC-C1.7: a getText that returns undefined refuses instead of throwing inside the async handler", async () => {
    // editorRef.current.innerText is `undefined` in this jsdom without the
    // polyfill, and `undefined.trim()` throws inside an async click handler,
    // where the rejection is unhandled and the user sees NOTHING AT ALL.
    installClipboardStub();
    const onOutcome = vi.fn();
    await render(baseProps({ getText: () => undefined, onOutcome }));
    // `click()` awaits the whole act() flush, so a throw or an unhandled
    // rejection inside the handler surfaces here rather than being swallowed.
    await expect(click()).resolves.toBeUndefined();
    expect(writeTextCalls).toHaveLength(0);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    nonEmptyString(onOutcome.mock.calls[0][0].alert);
  });
});

// ---------------------------------------------------------------------------
// O-1 / AC-C2 -- when the text and the label are read
// ---------------------------------------------------------------------------

describe("O-1: getText is called at CLICK time, never during render", () => {
  it("is not called by rendering, and is called exactly once per activation", async () => {
    // In edit mode the contentEditable changes WITHOUT a re-render: onInput
    // writes draftHtmlRef.current[tab] and calls scheduleAutoSave, whose only
    // state write is setSaveStatus("saving") -- a no-op after the first
    // keystroke of a burst. So a value computed during render is up to 600 ms
    // stale (the debounce), and a memo would make it permanently so.
    installClipboardStub();
    const getText = vi.fn(() => RESUME_TEXT);
    await render(baseProps({ getText }));
    expect(getText).not.toHaveBeenCalled();
    await click();
    expect(getText).toHaveBeenCalledTimes(1);
    await click();
    expect(getText).toHaveBeenCalledTimes(2);
  });

  it("copies the text as it is at the moment of the click, not as it was at the last render", async () => {
    installClipboardStub();
    let live = "FIRST";
    await render(baseProps({ getText: () => live }));
    live = "SECOND";
    await click();
    expect(writeTextCalls).toEqual(["SECOND"]);
  });
});

describe("AC-C2: the scope label is snapshotted into a local at the top of the click handler", () => {
  it("announces the label the copy STARTED with, even when the tab changes while the write is pending", async () => {
    // S14: a slow permission prompt. Without the snapshot the user hears
    // "Cover letter text copied." for a resume copy -- and acts on it.
    let resolveWrite;
    const pending = new Promise((resolve) => {
      resolveWrite = resolve;
    });
    installClipboardStub({
      writeText: (t) => {
        writeTextCalls.push(t);
        return pending;
      },
    });
    const onOutcome = vi.fn();
    await render(baseProps({ scopeLabel: "Resume", accessibleName: "Copy text of the resume", onOutcome }));
    await click();
    expect(onOutcome).not.toHaveBeenCalled(); // still in flight

    // The tab switches under it.
    await render(baseProps({ scopeLabel: "Cover letter", accessibleName: "Copy text of the cover letter", onOutcome }));
    await act(async () => {
      resolveWrite();
    });

    expect(onOutcome).toHaveBeenCalledTimes(1);
    const message = nonEmptyString(onOutcome.mock.calls[0][0].polite);
    expect(message.toLowerCase()).toContain("resume");
    expect(message.toLowerCase()).not.toContain("cover letter");
  });

  it("O-7: only the NEWEST activation's outcome is announced", async () => {
    const gates = [];
    installClipboardStub({
      writeText: (t) => {
        writeTextCalls.push(t);
        return new Promise((resolve) => gates.push(resolve));
      },
    });
    const onOutcome = vi.fn();
    await render(baseProps({ onOutcome }));
    await click(); // activation 1, left pending
    await click(); // activation 2, left pending
    expect(gates).toHaveLength(2);

    await act(async () => {
      gates[1]();
    });
    expect(onOutcome).toHaveBeenCalledTimes(1); // the newest one reported

    await act(async () => {
      gates[0]();
    });
    // A stale earlier outcome must not overwrite the later one the user is
    // already reading.
    expect(onOutcome).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Source shape -- AC-C14.3, AC-C18.1, AC-C10.2
// ---------------------------------------------------------------------------

describe("source shape: the control knows nothing of busy, the docx bytes, or the draft", () => {
  it("contains no busy / busyActive / anyBusy token", async () => {
    // AC-C14.3: a copy must not disable, or be disabled by, an in-flight
    // revise or Drive save. The existing drive suite CANNOT catch a wrongly
    // wired `disabled={busyActive}` here -- its gate is `tenControls()`, a
    // hardcoded enumeration, and a new control is simply not in the object.
    for (const token of [/\bbusy\b/, /\bbusyActive\b/, /\banyBusy\b/]) {
      expect(token.test(SOURCE)).toBe(false);
    }
    // Positive control: the same instrument DOES find those tokens in the file
    // that legitimately has them.
    const dialogSource = srcOf("../DocumentPreviewDialog.js");
    expect(/\bbusyActive\b/.test(dialogSource)).toBe(true);
    expect(/\banyBusy\b/.test(dialogSource)).toBe(true);
  });

  it("contains no docx byte token and no commitDraft", async () => {
    for (const token of [/docxB64/, /templateDocx/, /commitDraft/]) {
      expect(token.test(SOURCE)).toBe(false);
    }
    const dialogSource = srcOf("../DocumentPreviewDialog.js");
    expect(/commitDraft/.test(dialogSource)).toBe(true);
  });

  it("carries onMouseDown with preventDefault, and no key handler at all", async () => {
    expect(/onMouseDown/.test(SOURCE)).toBe(true);
    expect(/preventDefault/.test(SOURCE)).toBe(true);
    expect(/onKeyDown|onKeyUp|onKeyPress/.test(SOURCE)).toBe(false);
  });

  it("AC-C18.1: no fixed minWidth, no whiteSpace nowrap, no flexShrink 0 -- it must be free to wrap at 375 px", async () => {
    // jsdom performs no layout, so this cannot be MEASURED here; the repo's
    // precedent for that is a source-level guard
    // (DriveResultRegion.test.js's "caps the strip at 30vh with overflowY auto
    // at xs, as an explicit string").
    expect(/minWidth/.test(SOURCE)).toBe(false);
    expect(/whiteSpace/.test(SOURCE)).toBe(false);
    expect(/flexShrink/.test(SOURCE)).toBe(false);
    // Positive control: the same instrument finds all three in the file that
    // does use them.
    const dialogSource = srcOf("../DocumentPreviewDialog.js");
    expect(/minWidth/.test(dialogSource)).toBe(true);
    expect(/whiteSpace/.test(dialogSource)).toBe(true);
  });

  it("AC-C10.2: no pointerEvents anywhere in the control's source", async () => {
    expect(/pointerEvents/.test(SOURCE)).toBe(false);
    // Positive control: ChatPanel.js's Send button sets BOTH opacity:0.5 and
    // pointerEvents:"none". This control takes the opacity token and leaves
    // the pointer-events one behind.
    const chatPanel = srcOf("../ChatPanel.js");
    expect(/pointerEvents/.test(chatPanel)).toBe(true);
  });

  it("AC-C6.2 / 1c section 2.1: no Tooltip -- DriveActions.js's header rules them out of this bar", async () => {
    // Measured at Tooltip.js: with describeChild false, MUI puts the title in
    // aria-label on the cloned direct child, which for a span-wrapped control
    // has no role -- so ARIA drops it and the tooltip reaches NO accessible
    // name and NO accessible description. The scope information moves into the
    // accessible name instead, where it reaches everyone, including touch.
    expect(/Tooltip/.test(SOURCE)).toBe(false);
    const dialogSource = srcOf("../DocumentPreviewDialog.js");
    expect(/Tooltip/.test(dialogSource)).toBe(true);
  });

  it("AC-C13.4: the control stays well under 400 lines", async () => {
    expect(SOURCE.split("\n").length).toBeLessThan(400);
  });
});
