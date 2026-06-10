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

const PREF_KEY = "openPostingsBeside";

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

  if (forceNewTab || !isOpenBesideEnabled()) {
    return window.open(url, "_blank", "noopener,noreferrer");
  }

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

  // Use a unique window name each call. Reusing a fixed name makes browsers
  // ignore the new position/size features and just re-navigate the existing
  // window in place (a common reason the popup doesn't move to the right).
  const popup = window.open(url, "_blank", features);

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
