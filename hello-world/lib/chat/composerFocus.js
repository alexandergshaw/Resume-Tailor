// Composer focus helpers, extracted verbatim from lib/chat/chatbot.js
// (lib/chat/chatbot.refusal.test.js's "lib/chat's line budget: the ceiling
// A2's module headers cite" forbids trimming comments to make room, so this
// self-contained block -- closing over nothing in createChatHandlers, and
// operating only on the ref its caller supplies -- moved here instead).
// chatbot.js imports and re-exports both names so its existing import
// surface, and every test written against it, is unchanged.

// --- Focus helpers (A2 / AC-31, AC-31a) -------------------------------------
//
// This block used to sit at the END of chatbot.js, and its comment used to
// explain that placement ("after createChatHandlers's closing brace... nothing
// above shifts by their length"). It is a module of its own now: there is no
// `createChatHandlers` in this file, nothing above to shift, and hoisting is
// no longer doing any work. The explanation went stale the moment the code
// moved, which is the general hazard worth remembering here -- a comment that
// describes WHERE code sits stops being true when it is extracted, and
// nothing turns red.

// `askAiAbout`'s pre-A2 deferral value, exported so a test can advance fake
// timers by exactly this number rather than a drifting copy of it (the idiom
// AttachmentPanel.js:33 established for UNDO_WINDOW_MS).
export const FOCUS_RESTORE_DELAY_MS = 80;

// AC-31a: the deferral is LOAD-BEARING, not incidental. `setChatSending(false)`
// is a QUEUED React update, so at the instant this is invoked (from
// runChatRequest's `finally`, or from askAiAbout) the composer can still be
// `disabled` in the real DOM. This comment used to claim a real browser
// ignores focus() on a disabled element while jsdom does not enforce that --
// both halves were assumptions, never checked, and the second one is wrong:
// [MEASURED, this repo, jsdom 29.1.1] jsdom DOES ignore focus() on a disabled
// element, same as a real browser, as long as that element is not already the
// active one -- the one exception is an element that was already focused
// before it became disabled, which keeps focus in jsdom. That exception is
// exactly why this must not be made synchronous: a synchronous call here can
// land while the target is still the active, not-yet-disabled element and
// pass a naive spy test, while a real send -- where the composer was not
// already focused going in, or where the disabled state has already
// committed -- would see the call swallowed.
//
// `shouldFocus` is the ONE mechanism by which a caller can decline the
// restore, and it is evaluated INSIDE the deferred callback -- see
// `restoreComposerFocusIfLost` below, which is the only caller that passes
// one, and M-6 for why the timing of that evaluation is load-bearing rather
// than incidental.
export function focusComposerEnd(ref, delayMs = FOCUS_RESTORE_DELAY_MS, shouldFocus = null) {
  setTimeout(() => {
    try {
      if (typeof shouldFocus === "function" && !shouldFocus()) return;
      const el = ref?.current;
      if (!el) return;
      el.focus();
      const len = el.value?.length ?? 0;
      if (typeof el.setSelectionRange === "function") {
        el.setSelectionRange(len, len);
      }
    } catch {
      /* noop */
    }
  }, delayMs);
}

// AC-31 rev 3's own blockquote: "document.activeElement is NOT the check, and
// must not be used as one." This restores focus to the composer only when it
// was actually LOST elsewhere (to <body>, or nowhere) -- never when the user
// has since moved focus to another control on purpose (the chip ✕, Clear, ✕
// Context). Shape copied from
// app/components/experience/AttachmentPanel.js:301-304.
//
// M-6: the `ifLost` check below runs INSIDE focusComposerEnd's own deferred
// setTimeout, NOT synchronously here before the timer is armed. Two reasons:
//
//   1. Correctness. This is called from runChatRequest's `finally`. In
//      Fixture A (no résumé) the whole try/catch/finally completes
//      synchronously inside the click dispatch, one statement BEFORE any
//      OTHER control the user clicked (e.g. Clear) runs its own focus().
//      Sampling `document.activeElement` synchronously here would see
//      whatever had focus a moment ago -- typically <body> -- wrongly
//      conclude focus was "lost", and steal it back 80ms later from a
//      control the user has since moved to. Deferring the check into the
//      same callback that actually moves focus asks the question at the
//      moment it is actually meaningful: after the composer has been
//      re-enabled and after the user has had the whole in-flight window to
//      tab away.
//   2. Safety. A throw in a synchronous half here would run OUTSIDE any
//      `try`, in the `finally` of the caller -- replacing the live refusal
//      Error mid-`finally`, skipping runChatRequest's own `return`, and
//      escaping sendChatMessage (an onClick with no catch of its own) as an
//      unhandled rejection. Folding the guard into focusComposerEnd's
//      existing deferred `try` costs nothing and needs no second `try`.
//
// That last sentence is now literally true, and it was not before. This
// function used to DELEGATE to focusComposerEnd on the node branch and
// DUPLICATE its body -- timer, ref read, focus, caret, try -- on the browser
// branch, which is the branch real users are on. The consequence was not
// stylistic: an edit to focusComposerEnd was picked up by every node test and
// silently NOT by the browser, so the tests could stay green across a change
// that shipped to nobody. One body, one timer, one `try`, both branches.
export function restoreComposerFocusIfLost(ref) {
  focusComposerEnd(ref, FOCUS_RESTORE_DELAY_MS, composerFocusWasLost);
}

// The `ifLost` question itself, as a predicate focusComposerEnd calls inside
// its deferred `try`.
//
// Node test environment (no `document` global): degrade to an unconditional
// restore, the same shape revokeAttachmentPreview (chatbot.js, above
// `readChatResponse`) uses for a missing `URL` global. There is no
// activeElement to consult, so the jsdom-only half of this guard is covered
// exclusively by the jsdom suite (see ChatPanel.gaps.test.js's "ifLost guard"
// case) -- N5.
function composerFocusWasLost() {
  if (typeof document === "undefined") return true;
  const active = document.activeElement;
  return !(active && active !== document.body && active.isConnected);
}
