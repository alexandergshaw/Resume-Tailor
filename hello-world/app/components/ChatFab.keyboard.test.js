// @vitest-environment jsdom
//
// AC-K-B1 (half 1 of 2): THE AI HELP LAUNCHER MUST BE OPERABLE BY KEYBOARD.
//
// THE ORIGINAL DEFECT THIS FILE FALSIFIES
// ----------------------------------------
// `app/page.js:3055-3107` rendered the AI Help `<Fab>` with `onPointerDown`,
// `onPointerMove` and `onPointerUp` and **no `onClick` at all** (verified:
// `sed -n '3055,3107p' app/page.js | grep -c onClick` -> 0). The toggle lived
// inside `onPointerUp` (`:3082-3092`). Pressing Enter or Space on a focused
// native `<button>` dispatches a `click` event and NO pointer events
// whatsoever, so the handler never ran: the chat could not be opened -- or,
// once opened by the "Ask AI" buttons elsewhere, closed -- from the keyboard.
// Touch fires pointerdown/move/up, which is why a touch audit never saw it.
//
// WHY THIS FILE IMPORTS A MODULE THAT DOES NOT EXIST YET
// -----------------------------------------------------
// The Fab is 53 lines of JSX inside `app/page.js`, which is 3242 lines against
// this repo's 1000-line cap. Mounting `page.js` to test it is not possible and
// growing it further is not allowed. The fix is therefore an EXTRACTION, which
// makes `page.js` SMALLER, not larger:
//
//   * new file `app/components/ChatFab.js` owns the Fab element, the 4px drag
//     threshold, the pointer capture, and the clamp;
//   * `page.js` keeps `fabPos` / `setFabPos` (they are persisted to
//     localStorage at `:969-995` and clamped at `:996-1005`) and replaces
//     `:3055-3107` with a single `<ChatFab ... />` element -- a net reduction
//     of roughly 45 lines.
//
// REQUIRED PROP CONTRACT (what this file mounts):
//
//   <ChatFab
//     open={boolean}                 // drives the label: "AI Help" / "Close"
//     onToggle={() => {}}            // called on activation, NOT on a drag
//     pos={{ right: number, bottom: number }}
//     onPosChange={(next) => {}}     // called with the clamped {right,bottom}
//   />
//
// A SECOND DEFECT, INTRODUCED BY THE FIRST FIX, AND WHAT REPLACED IT
// --------------------------------------------------------------------
// Moving the toggle to `onClick` needed a way to keep a drag from also
// toggling the chat. An earlier revision of `ChatFab.js` armed a
// `suppressClickRef` flag in `onPointerUp` and self-cleared it with
// `queueMicrotask`, reasoning that a same-element trailing `click` always
// arrives synchronously before any queued microtask runs. That reasoning is
// FALSE: `pointerup`, `mouseup` and `click` are three separate dispatches,
// and measured with real trusted mouse input in Chrome (see `ChatFab.js`'s
// header for the trace) the microtask runs and clears the flag *before* the
// trailing `click` arrives. Every completed drag therefore also toggled the
// chat -- the exact bug the flag exists to prevent, reappearing on the other
// side of it.
//
// **jsdom cannot see this, in either direction.** `element.dispatchEvent()`
// runs synchronously from JS, so the stack between a synthetic `pointerup`
// and a synthetic `click` never empties and no microtask checkpoint can run
// in between. A suite built on `dispatchEvent` cannot fail no matter which
// side of that race the flag lands on -- a green result here was NEVER
// evidence that the microtask ordering was safe, and this file contains no
// test that claims otherwise. Do not add one, and do not restore a
// `queueMicrotask`/timer self-clear on the strength of this suite being
// green. That real-browser ordering is a manual check (see below and
// `docs/REGRESSION.md`), not something a unit test can prove.
//
// The actual fix (in `ChatFab.js`) discriminates the `click` itself instead
// of racing a timer against it: a keyboard-produced click on a native button
// carries `event.detail === 0`; a pointer-produced one carries
// `event.detail > 0`. Unlike the microtask race, `event.detail` is a plain,
// synchronously-set property of the event object, not a timing fact -- so
// jsdom sets and reads it exactly as a real browser would, and it IS safe to
// assert on here. Every test below that models "the click a keyboard press
// produces" builds it with no `detail` (jsdom's own default is 0); every
// test that models a real pointer's trailing click sets `detail: 1`
// explicitly, because a bare jsdom `MouseEvent` defaults to `detail: 0`
// regardless of how it's produced and would otherwise silently mis-model a
// pointer click as a keyboard one.
//
// WHAT IS TESTED HERE AND WHAT IS NOT
// -----------------------------------
// jsdom does NOT implement a native button's default keyboard activation
// behaviour: dispatching a synthetic `keydown{key:"Enter"}` at a real
// `<button>` produces no `click`, because that synthesis is the browser's, not
// the DOM's. (MUI's ButtonBase synthesizes it only for NON-native roots -- see
// `useButtonBase.js` -- which is why a jsdom keydown "works" on a
// `component="span"` ButtonBase and not on a `<button>`.) So the machine-checkable
// proxy is: the control is a real `<button>` AND a `detail: 0` `click` on it
// always toggles it, regardless of the suppression flag's state. Every
// browser guarantees the Enter/Space -> click half.
//
//   MANUAL / BROWSER-ONLY (not asserted here, and not claimed):
//     * Tab to the AI Help launcher, press Enter -> panel opens. Press Space ->
//       panel opens. (The real key-to-click synthesis.)
//     * A real drag-and-release with the pointer still over the launcher does
//       NOT also toggle the chat, and Tab + Enter right afterwards still
//       opens it. (The real pointerup/mouseup/click ordering -- see
//       `ChatFab.js`'s header for why jsdom cannot exercise this either way.)
//     * The focus ring is actually VISIBLE at the launcher's fixed position and
//       is not clipped by the viewport edge (jsdom has no layout engine).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatFab from "./ChatFab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  // The drag path calls these on the Fab element; jsdom ships neither.
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (typeof Element.prototype.releasePointerCapture !== "function") {
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
  if (typeof Element.prototype.hasPointerCapture !== "function") {
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
      return true;
    };
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function accessibleName(node) {
  if (!node) return "";
  const labelled = node.getAttribute("aria-labelledby");
  if (labelled) {
    const target = document.getElementById(labelled);
    if (target) return (target.textContent || "").trim();
  }
  return (
    node.getAttribute("aria-label")
    || (node.textContent || "").trim()
    || node.getAttribute("title")
    || ""
  ).trim();
}

async function render(props) {
  await act(async () => {
    root.render(
      createElement(ChatFab, {
        open: false,
        onToggle: () => {},
        pos: { right: 24, bottom: 24 },
        onPosChange: () => {},
        ...props,
      })
    );
  });
  return container;
}

// jsdom 29 has no PointerEvent constructor. A MouseEvent carrying the pointer
// fields React reads is the equivalent for this code path.
function pointer(type, init) {
  const Ctor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
  const event = new Ctor(type, { bubbles: true, cancelable: true, button: 0, ...init });
  if (typeof event.pointerId !== "number") {
    Object.defineProperty(event, "pointerId", { value: init?.pointerId ?? 1 });
  }
  return event;
}

describe("ChatFab -- the AI Help launcher is keyboard-operable", () => {
  it("renders a real <button>, which is what makes Enter and Space activate it", async () => {
    const el = await render({});
    const fab = el.querySelector(".MuiFab-root");
    expect(fab, "no Fab rendered").toBeTruthy();
    // A native <button> is the ONLY shape that gets Enter AND Space activation
    // from the browser without a hand-written key handler. See the header for
    // why this is the proxy and the real key press is a manual check.
    expect(fab.tagName).toBe("BUTTON");
    expect(fab.disabled).toBe(false);
    // Never a positive tabindex, and never removed from the tab order.
    expect(fab.getAttribute("tabindex")).not.toBe("-1");
  });

  it("carries .MuiButtonBase-root, so the app-wide focus ring reaches it", async () => {
    // app/theme/index.js paints `MuiButtonBase.styleOverrides.root
    // ["&.Mui-focusVisible"]` (2px solid accent, offset 2px). A control that
    // is not a ButtonBase opts out of that ring silently.
    const el = await render({});
    const fab = el.querySelector(".MuiFab-root");
    expect(fab.classList.contains("MuiButtonBase-root")).toBe(true);
  });

  it("toggles the chat on a plain click -- the event a keyboard press produces", async () => {
    const onToggle = vi.fn();
    const el = await render({ onToggle });
    const fab = el.querySelector(".MuiFab-root");
    await act(async () => {
      fab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("names itself for the state it will produce", async () => {
    const closed = await render({ open: false });
    expect(accessibleName(closed.querySelector(".MuiFab-root"))).toMatch(/ai help/i);
    const opened = await render({ open: true });
    expect(accessibleName(opened.querySelector(".MuiFab-root"))).toMatch(/close/i);
  });

  it("still suppresses the toggle when the user DRAGS it (the reason the suppression flag exists)", async () => {
    // This is the constraint the onPointerUp-armed flag exists to satisfy:
    // dragging the launcher across the screen must not also open the chat.
    // The trailing click is modelled with `detail: 1` because that's what a
    // real pointer-produced click carries -- see the file header for why a
    // bare jsdom MouseEvent (default `detail: 0`) would mis-model this as a
    // keyboard click and pass for the wrong reason.
    const onToggle = vi.fn();
    const onPosChange = vi.fn();
    const el = await render({ onToggle, onPosChange });
    const fab = el.querySelector(".MuiFab-root");
    await act(async () => {
      fab.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      fab.dispatchEvent(pointer("pointermove", { clientX: 160, clientY: 140 }));
      fab.dispatchEvent(pointer("pointerup", { clientX: 160, clientY: 140 }));
      // A real browser fires `click` after a pointerup on the same element,
      // drag or not -- so the suppression has to survive it.
      fab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(onPosChange).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("still toggles when the pointer never moved past the drag threshold", async () => {
    const onToggle = vi.fn();
    const el = await render({ onToggle });
    const fab = el.querySelector(".MuiFab-root");
    await act(async () => {
      fab.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      fab.dispatchEvent(pointer("pointerup", { clientX: 101, clientY: 100 }));
      fab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("consumes the suppression exactly once, so the click AFTER the suppressed one toggles normally", async () => {
    // The flag must not over-suppress: once the drag's own trailing click has
    // consumed it, a later, unrelated pointer click on the same element (a
    // fresh pointerdown/up/click gesture) must toggle same as any other.
    const onToggle = vi.fn();
    const onPosChange = vi.fn();
    const el = await render({ onToggle, onPosChange });
    const fab = el.querySelector(".MuiFab-root");
    await act(async () => {
      fab.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      fab.dispatchEvent(pointer("pointermove", { clientX: 160, clientY: 140 }));
      fab.dispatchEvent(pointer("pointerup", { clientX: 160, clientY: 140 }));
      fab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(onToggle).not.toHaveBeenCalled();

    await act(async () => {
      fab.dispatchEvent(pointer("pointerdown", { clientX: 200, clientY: 200 }));
      fab.dispatchEvent(pointer("pointerup", { clientX: 200, clientY: 200 }));
      fab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not swallow the NEXT activation after a drag whose trailing click never lands on the Fab", async () => {
    // Reproduces the viewport clamp (`:83-84`): the Fab's position stops at
    // the edge while the pointer keeps travelling, so the browser's trailing
    // `click` -- if it fires at all -- lands somewhere else, never on this
    // element. A touch drag reaches the same place: browsers suppress the
    // compatibility click outright after a touch sequence that moved.
    //
    // The suppression flag armed by this drag stays armed -- nothing clicks
    // the Fab to consume it. That "next activation" is modelled here the
    // same way the rest of this file models a keyboard press: a bare `click`
    // with no pointer events of its own and `detail: 0` (Enter/Space on a
    // focused native button produces a `click` and nothing else -- see the
    // file header). This passes because a `detail: 0` click bypasses the
    // flag unconditionally, NOT because the flag happens to be clear -- an
    // implementation that went back to gating every click on the flag alone
    // (no `detail` check) would fail this, which is exactly what AC-K1.2
    // exists to catch: a keyboard Enter/Space must never be swallowed by a
    // flag left over from an unrelated drag.
    const onToggle = vi.fn();
    const onPosChange = vi.fn();
    const el = await render({ onToggle, onPosChange });
    const fab = el.querySelector(".MuiFab-root");

    // The drag: crosses the threshold, moves the Fab, and ends with NO
    // trailing click landing on it.
    await act(async () => {
      fab.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      fab.dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 400 }));
      fab.dispatchEvent(pointer("pointerup", { clientX: 400, clientY: 400 }));
    });
    expect(onPosChange).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    // The next activation, later and unrelated to the drag above -- e.g. the
    // user tabs back to the now-parked launcher and presses Enter. This must
    // succeed; if it doesn't, the launcher this chunk exists to make
    // keyboard-operable ignores the first keypress after every drag that
    // doesn't end with a click on the button itself.
    await act(async () => {
      fab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a subsequent POINTER click either, after a drag whose trailing click never lands on the Fab", async () => {
    // Same stale-flag setup as the test above, but the next activation is a
    // genuine pointer gesture rather than a keyboard one. A `detail > 0`
    // click IS still subject to the flag, so this only works because
    // `onPointerDown` resets `suppressClickRef` at the start of the new
    // gesture -- belt-and-braces line called out in the file header. Without
    // it, this real click would be wrongly eaten by the previous drag's
    // leftover flag.
    const onToggle = vi.fn();
    const onPosChange = vi.fn();
    const el = await render({ onToggle, onPosChange });
    const fab = el.querySelector(".MuiFab-root");

    await act(async () => {
      fab.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      fab.dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 400 }));
      fab.dispatchEvent(pointer("pointerup", { clientX: 400, clientY: 400 }));
    });
    expect(onToggle).not.toHaveBeenCalled();

    await act(async () => {
      fab.dispatchEvent(pointer("pointerdown", { clientX: 400, clientY: 400 }));
      fab.dispatchEvent(pointer("pointerup", { clientX: 400, clientY: 400 }));
      fab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
