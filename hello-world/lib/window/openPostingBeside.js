// Opens a job posting in a popup window docked to the right half of the screen
// and shrinks/moves the current app window to the left half, so the posting and
// the Resume Tailor app are visible side by side without leaving the app.
//
// Browser caveats handled here:
//   - resizeTo/moveTo on the *current* window is often blocked unless that
//     window was itself opened by script. We wrap it in try/catch and continue.
//   - window.open may return null when blocked by a popup blocker. Callers can
//     inspect the return value and fall back to a normal new tab.
//   - Multi-monitor setups: we respect screen.availLeft/availTop so the popup
//     lands on the same display as the app.
//
// SECURITY: every url this module is handed (`openPostingBeside`'s `url`,
// `navigateBeside`'s `url`) is `positions.url` or a value derived from it.
// `public.positions` has no `user_id` column and its update policy is
// `auth.role() = 'authenticated'`, so any signed-in account can overwrite any
// row's `url` - see lib/url/safeExternalHref.js for the full writeup. That
// module is the control for every `<a href>` in this app; `window.open` and
// `popup.location.href =` are the other two ways a string becomes a browser
// navigation, and neither has React (or anything else) filtering it. So
// every url reaches `safeExternalHref` here before it reaches either one.
//
// Refusal is signalled with a TRUTHY, non-popup sentinel rather than the
// `null`/`false` used for "blocked" or "no url" - see REFUSED below for why:
// every caller of this module (AutoApplyQueueTab.js, LiveFeedTab.js,
// app/page.js) writes its own `if (!opened) window.open(url, ...)` /
// `if (!navigated) { ...; window.open(url, ...) }` fallback for a
// browser-blocked popup, using the SAME url this module just validated (or
// refused). Returning falsy for a refusal would trip that fallback and open
// the exact url this module refused, one line later, in a file this fix does
// not touch.

import { safeExternalHref } from "../url/safeExternalHref.js";

const PREF_KEY = "openPostingsBeside";

// Returned by openPostingBeside/navigateBeside in place of a popup reference
// when the url fails safeExternalHref. Truthy so callers' own "did this
// return falsy? then fall back to a raw window.open(url, ...)" logic treats
// refusal as "handled" rather than "blocked, please retry" - see the module
// banner above. `closed: true` so any caller that later guards a close()
// call with `!popup.closed` (app/page.js does, for its preset blank popup)
// treats this sentinel as already gone rather than calling methods on it.
const REFUSED = Object.freeze({ refused: true, closed: true });

// A refused url must not fail silently: the user clicked something expecting
// a posting to open. `window.alert` is the only feedback channel available
// to a plain module with no access to the app's own UI state, so it is used
// here deliberately, guarded for the SSR/test environments that lack it.
function refuseUnsafeUrl() {
  try {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert("This posting's link couldn't be verified as safe, so it wasn't opened.");
    }
  } catch {
    // alert can throw or be suppressed (e.g. a sandboxed frame); the refusal
    // itself still holds regardless.
  }
  return REFUSED;
}

// Whether the "open beside" behavior is enabled. Defaults to true. Stored in
// localStorage so the choice persists. SSR-safe.
export function isOpenBesideEnabled() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

// Persist the "open beside" preference.
export function setOpenBesideEnabled(enabled) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_KEY, enabled ? "true" : "false");
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

// Read the usable screen geometry, falling back to sane defaults when the
// screen API is unavailable.
function readScreenGeometry() {
  const screen = (typeof window !== "undefined" && window.screen) || {};
  const availLeft = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
  const availTop = Number.isFinite(screen.availTop) ? screen.availTop : 0;
  const availWidth = Number.isFinite(screen.availWidth) ? screen.availWidth : 1280;
  const availHeight = Number.isFinite(screen.availHeight) ? screen.availHeight : 800;
  return { availLeft, availTop, availWidth, availHeight };
}

// Open `url` in a popup on the right half and dock the app to the left half.
// Returns the opened window reference, or null when the popup was blocked or no
// url was supplied. When `forceNewTab` is true (or the user opted out), falls
// back to a plain new tab.
export function openPostingBeside(url, { forceNewTab = false } = {}) {
  if (!url || typeof window === "undefined") return null;
  // Validate BEFORE branching: forceNewTab/opted-out calls window.open
  // directly, a few lines below, so the check has to precede that branch
  // rather than live only in the docked-popup path.
  if (safeExternalHref(url) === null) return refuseUnsafeUrl();

  if (forceNewTab || !isOpenBesideEnabled()) {
    return window.open(url, "_blank", "noopener,noreferrer");
  }

  return openBesideInternal(url);
}

// Open a positioned, blank right-half popup synchronously and return it without
// navigating. Use this when the caller must `await` something (a download, a
// clipboard write) before it knows the final URL: Chrome only grants popup
// placement when window.open runs inside the click gesture, before any await.
// Open the blank window first, do the async work, then call navigateBeside().
// Returns null when blocked or when the user opted out (caller should fall back).
export function openBlankBeside() {
  if (typeof window === "undefined") return null;
  if (!isOpenBesideEnabled()) return null;
  return openBesideInternal("about:blank");
}

// Point a previously-opened blank popup (from openBlankBeside) at the real URL.
export function navigateBeside(popup, url) {
  if (!popup || popup.closed || !url) return false;
  if (safeExternalHref(url) === null) {
    // A preset blank popup (from openBlankBeside) is already open and
    // visible - don't leave it dangling on about:blank.
    try {
      popup.close();
    } catch {
      // closing may be denied; not critical
    }
    refuseUnsafeUrl();
    // See REFUSED/module banner: `true` here, not `false`, so the caller's
    // own `if (!navigated) { openPostingBeside(url) ... }` fallback does not
    // retry this same refused url through a second path.
    return true;
  }
  try {
    popup.location.href = url;
  } catch {
    return false;
  }
  try {
    popup.focus();
  } catch {
    // focus may be denied; not critical
  }
  return true;
}

// Shared implementation: dock the app left, open `target` in a right-half popup,
// and force its placement. Returns the popup or null if blocked.
function openBesideInternal(target) {
  const { availLeft, availTop, availWidth, availHeight } = readScreenGeometry();
  const halfWidth = Math.floor(availWidth / 2);
  const rightLeft = availLeft + halfWidth;

  // Dock the current app window to the left half. Frequently blocked — ignore
  // failures and carry on so the posting still opens.
  try {
    window.moveTo(availLeft, availTop);
    window.resizeTo(halfWidth, availHeight);
  } catch {
    // resizing the current window is not permitted in this context
  }

  // Note: we deliberately omit "noopener" from the features. With "noopener",
  // window.open returns null, which would prevent us from detecting a blocked
  // popup, repositioning, and focusing it. To still guard against reverse
  // tab-nabbing we null out the popup's `opener` after opening.
  //
  // We also include "popup=1" so browsers open a separate window (not a tab) —
  // position/size features are only honored for popups, not tabs.
  const features = [
    "popup=1",
    `width=${halfWidth}`,
    `height=${availHeight}`,
    `left=${rightLeft}`,
    `top=${availTop}`,
  ].join(",");

  // Use "_blank" (not a fixed name). Reusing a fixed name makes browsers ignore
  // the new position/size features and re-navigate the existing window in place
  // (a common reason the popup doesn't move to the right).
  const popup = window.open(target, "_blank", features);

  // Popup blocked: signal failure so the caller can fall back to a new tab.
  if (!popup || popup.closed) return null;

  // Belt-and-suspenders: many browsers ignore the left/top open features but
  // honor moveTo/resizeTo on a script-opened popup. Force the right-half
  // placement explicitly.
  try {
    popup.resizeTo(halfWidth, availHeight);
    popup.moveTo(rightLeft, availTop);
  } catch {
    // positioning may be denied; the open features above still apply
  }

  try {
    popup.opener = null; // mitigate reverse tab-nabbing
  } catch {
    // cross-origin access to opener may be denied; not critical
  }
  try {
    popup.focus();
  } catch {
    // focus may be denied; not critical
  }
  return popup;
}

