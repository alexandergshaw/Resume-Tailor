"use client";

import { forwardRef, useRef, useState } from "react";
import Fab from "@mui/material/Fab";

// AC-K1: the floating "AI Help" launcher, extracted out of app/page.js (which
// was 3242 lines against this repo's 1000-line cap) so it can be mounted and
// tested on its own. Two requirements have to coexist here:
//
//   1. it is user-DRAGGABLE -- pointer capture, a 4px move threshold, and a
//      viewport clamp -- with the dragged position owned by the caller
//      (`pos`/`onPosChange`; persisted to localStorage in page.js) so that
//      dragging it does NOT also open/close the chat; and
//   2. it is keyboard-operable -- a real `<button>` (MUI's Fab already is
//      one) with a plain `onClick`, which is what Enter and Space on a
//      focused button produce with no hand-written key handler.
//
// The old implementation put the toggle inside `onPointerUp` specifically to
// suppress it on a drag -- but `onPointerUp` never fires from a keyboard.
// Moving the toggle to `onClick` and keeping the suppression is what makes
// both true at once: a browser fires a trailing `click` after `pointerup` on
// the same element when the pointer never left it, so `onPointerUp` arms a
// suppression flag that the click reaching `onClick` next consumes and
// clears. A pointerdown/up that never crossed the threshold never arms the
// flag, so that click reaches `onToggle` same as a keyboard-produced one
// would.
//
// A PREVIOUS VERSION OF THIS FILE self-cleared the flag with
// `queueMicrotask` on the premise that a same-element trailing `click`
// "always arrives synchronously as part of the same gesture, before any
// queued microtask runs". That premise is FALSE and was shipped without
// being checked against a real browser. `pointerup`, `mouseup` and `click`
// are three SEPARATE event dispatches; the HTML spec runs a microtask
// checkpoint every time the JS stack empties, which happens after each one
// returns. Measured with real trusted mouse input in Chrome, on this repo's
// exact react-dom (19.2.4), both as vanilla listeners and as React props:
//
//   onPointerUp   -> suppress := true, queueMicrotask(clear) queued
//     [MICROTASK] -> suppress := false        <<< runs HERE, before onClick
//   onClick       (suppress already false)
//       >>> onToggle() called
//
// So the microtask ran and cleared the flag *before* the trailing `click`
// arrived, on every completed drag -- meaning every drag also toggled the
// chat, which is precisely the bug this suppression exists to prevent.
// **jsdom cannot see this.** `element.dispatchEvent(...)` runs synchronously
// from JS, so the stack never empties between the synthetic `pointerup` and
// the synthetic `click` and no microtask checkpoint can fire in between --
// the ordering above is a real-browser-only fact, unobservable in a unit
// test. Do not "fix" this by restoring a `queueMicrotask` (or any other
// timer) self-clear on the strength of a green jsdom suite: a passing test
// here is not evidence about event-loop ordering jsdom cannot express, and a
// prior round did exactly that.
//
// THE ACTUAL FIX discriminates the input instead of racing the clock. A
// `click` produced by keyboard activation of a native `<button>` (Enter or
// Space on a focused button) carries `event.detail === 0`; a `click`
// produced by a real pointer (mouse or touch) carries `event.detail > 0`
// (verified against a real focused native `<button>` in Chrome: a key press
// fires a `click` with `detail: 0`, a mouse click fires one with `detail:
// 1`). So `onClick` below checks `e.detail` FIRST: a `detail === 0` click is
// a keyboard activation and is NEVER subject to the suppression flag,
// whatever its state -- there is no timing to race, only the event's own
// shape, which is stable and synchronous. Only a `detail > 0` (pointer)
// click can be suppressed, and only while the flag set by THIS gesture's
// `onPointerUp` is still armed.
//
// The flag must still not survive past the gesture that armed it. The
// viewport clamp below walks the Fab's position (not the pointer) to a stop,
// so the pointer can end the drag away from the button; a touch drag
// suppresses the compatibility `click` outright. Either way, no `click` ever
// lands on this element for THIS gesture, so a flag left armed would
// silently eat the very NEXT pointer click -- but not a keyboard one, which
// bypasses it unconditionally as above. `onPointerDown` resets the flag for
// that next pointer interaction (belt-and-braces: a fresh gesture must never
// inherit suppression armed by a previous one), so the flag's lifetime is
// bounded either by the click it was armed for consuming it, or by the next
// `pointerdown` clearing it -- no timer, no ordering assumption, in either
// case.
function ChatFab({ open, onToggle, pos, onPosChange }, ref) {
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef(null);
  const suppressClickRef = useRef(false);

  return (
    <Fab
      ref={ref}
      color="primary"
      variant="extended"
      onClick={(e) => {
        // A keyboard-produced click (`detail === 0`) is never suppressed,
        // regardless of the flag's state -- see the file header. Only a
        // pointer-produced click (`detail > 0`) can be swallowed, and only
        // while this gesture's own `onPointerUp` still has the flag armed.
        if (e.detail === 0) {
          suppressClickRef.current = false;
          onToggle();
          return;
        }
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onToggle();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // A fresh pointer interaction must never inherit suppression armed
        // by a previous one -- see the file header.
        suppressClickRef.current = false;
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          startRight: pos.right,
          startBottom: pos.bottom,
          moved: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const start = dragStartRef.current;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 4) return;
        start.moved = true;
        if (!dragging) setDragging(true);
        // right/bottom increase as we move left/up from the corner.
        const nextRight = Math.max(8, Math.min(window.innerWidth - 80, start.startRight - dx));
        const nextBottom = Math.max(8, Math.min(window.innerHeight - 48, start.startBottom - dy));
        onPosChange({ right: nextRight, bottom: nextBottom });
      }}
      onPointerUp={(e) => {
        const start = dragStartRef.current;
        dragStartRef.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDragging(false);
        // Arm the suppression for the trailing pointer-produced `click` a
        // real browser fires next -- see the file header for why the toggle
        // lives in `onClick` rather than here, and why this flag is cleared
        // by consumption (the click, or the next `onPointerDown`) rather
        // than by a timer. A keyboard activation is never affected by this
        // flag either way, so there is nothing to self-clear here.
        if (start?.moved) {
          suppressClickRef.current = true;
        }
      }}
      sx={{
        position: "fixed",
        right: pos.right,
        bottom: pos.bottom,
        zIndex: 1100,
        textTransform: "none",
        fontWeight: 700,
        letterSpacing: 0.1,
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
        boxShadow: "0 16px 32px rgba(25, 118, 210, 0.26)",
      }}
    >
      {open ? "Close" : "AI Help"}
    </Fab>
  );
}

export default forwardRef(ChatFab);
