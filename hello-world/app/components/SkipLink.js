"use client";

import { useSyncExternalStore } from "react";

// The app's first tab stop: the bypass block for the repeated header, plus a
// second target for the one surface a keyboard user otherwise cannot afford to
// reach. WCAG 2.4.1 Bypass Blocks (A).
//
// ---------------------------------------------------------------------------
// WHY THIS MOUNTS IN app/layout.js AND NOT IN AppHeader
// ---------------------------------------------------------------------------
//
// It has to be the FIRST focusable in the document, and `AppHeader` is the
// first thing `layout.js` renders — so the naive move is to put it inside the
// header. That is wrong here for a reason that is already pinned by a test:
// `AppHeader.backButton.test.js` asserts the back control is the header's
// `firstElementChild` (§3) and its first focusable (AC-15). A skip link inside
// the header would displace it and break both.
//
// Rendered as `<body>`'s first child instead, this is first in the document
// AND leaves the header's own contract untouched. It is also deliberately
// OUTSIDE `<Providers>`: it needs no MUI theme (its styles are plain CSS in
// app/globals.css), so nothing about it can depend on client context being
// ready.
//
// ---------------------------------------------------------------------------
// THE SECOND LINK, AND WHY IT IS GATED ON THE DOCK ACTUALLY EXISTING
// ---------------------------------------------------------------------------
//
// The tracked-jobs dock (`StatusBar.js` -> `.floatingToolbar`) is
// `position: fixed; bottom: 0` — permanently on screen — but app/page.js
// mounts it LAST in the DOM, after `</main>`. Its per-job controls therefore
// sit behind every focusable in the active tab: roughly 230 Tab presses with
// 20 tracked applications. This link makes that one Tab and one Enter.
//
// But StatusBar returns `null` whenever there is no job and no log to reach,
// which is the state every session starts in and the state "Clear all" returns
// to. A permanently-rendered second link would then be a tab stop that goes
// nowhere — worse than not having it. So the link is gated on the target
// actually being in the document.
//
// `useSyncExternalStore` over a `MutationObserver` is the mechanism, chosen
// over the obvious `useState` + `useEffect` for two concrete reasons:
//   1. `react-hooks/set-state-in-effect` is error-level in this repo and
//      rejects a setState reachable synchronously from an effect body, which
//      is exactly the shape the initial read needs.
//   2. It is SSR-correct without a special case: `getServerSnapshot` returns
//      false, the first client render also reads false-or-true from the real
//      DOM, and React reconciles without a hydration mismatch.
//
// A one-shot read at mount would NOT do: this component is mounted by the root
// layout, long before the user tracks their first job. The observer is what
// makes the link appear when the dock does and withdraw when it goes away.
//
// COST, stated rather than hidden: the observer watches `document.body` with
// `subtree: true`, so its callback runs on structural DOM changes anywhere in
// the app. The callback is a single `getElementById` returning a boolean, and
// React bails out when that boolean is unchanged, so no render results from
// the overwhelming majority of notifications.

// The landmark ids this app is wired on. Kept as literals, not imports: the
// route files that render the targets are server components, and
// `hrefSafety.sweep.test.js` exempts only LITERAL hrefs from the
// `safeExternalHref` gate — a computed href here would be swept into it and
// fail. `app/appLandmarks.test.js` is what holds the two halves together.
const DOCK_ID = "job-dock";

// Module scope, so the reference is stable across renders — an inline
// `subscribe` would tear down and re-create the observer on every render.
function subscribeToDock(onStoreChange) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

const dockIsPresent = () => document.getElementById(DOCK_ID) !== null;

// The dock is never present during SSR (it is client state), and returning
// false here matches what the first client read produces on a fresh page.
const dockIsAbsentOnServer = () => false;

export default function SkipLink() {
  const hasDock = useSyncExternalStore(subscribeToDock, dockIsPresent, dockIsAbsentOnServer);

  return (
    <nav aria-label="Skip links" className="skip-links">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {hasDock ? (
        <a className="skip-link" href="#job-dock">
          Skip to generated jobs
        </a>
      ) : null}
    </nav>
  );
}
