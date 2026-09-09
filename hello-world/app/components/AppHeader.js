"use client";

import { usePathname } from "next/navigation";
import { useCallback, useLayoutEffect, useRef } from "react";
import BackButton from "./BackButton";
import EngineSelect from "./EngineSelect";
import SettingsMenu from "./SettingsMenu";

// The root-scrollport custom property this header publishes, consumed by the
// one `scroll-padding-top` declaration in app/globals.css. Module-local, and
// deliberately NOT exported: its only other consumer is a CSS file, which
// cannot import anything, so an export would mint a name whose sole JS reader
// is a test — the ruling lib/sourceScan/exportReachability.sweep.test.js
// already records for useStickyTop.js's own five constants.
//
// WHY A NEW NAME RATHER THAN REUSING `--sticky-pad`
// -------------------------------------------------
// `--sticky-pad` (app/copilot/useStickyTop.js) means "app header PLUS the
// copilot question strip". Three things rule out borrowing it:
//   1. It is written by that hook and only on /copilot, so on the three routes
//      that need padding it would resolve to a literal fallback — a magic
//      number wearing a var() costume.
//   2. Its value is strictly LARGER than this one. A second writer on the same
//      name would be a last-one-wins race whose losing outcome silently
//      UNDER-pads /copilot by the whole height of the strip.
//   3. Its lifetime is the strip's, not the header's: that hook removes it on
//      unmount, which would take the app-wide padding down with it.
// Same argument disqualifies `--sticky-top` (that hook's header-height
// property): identical value, but a foreign owner whose cleanup would delete
// a property the whole app depends on. One property, one writer, each.
const HEADER_HEIGHT_PROP = "--app-header-height";

// Sticky top bar for the app. Hidden on standalone auth routes (/login,
// /auth/*) so those pages render as clean full-screen surfaces without the
// app chrome (engine picker, settings).
export default function AppHeader() {
  const pathname = usePathname() || "";
  const headerRef = useRef(null);
  const hidden = pathname.startsWith("/login") || pathname.startsWith("/auth");

  // WCAG 2.4.11 Focus Not Obscured (Minimum). This header is `position:
  // sticky; top: 0`, so a fragment navigation — the skip link's `#main-content`
  // above all — scrolls its target to the top of the viewport, which is
  // UNDERNEATH the header. `scroll-padding-top` on the root scrollport is the
  // fix, and the only honest source for its value is this element's own
  // rendered height: `padding: "10px clamp(12px, 4vw, 24px)"` scales
  // horizontally only, and `flexWrap: "wrap"` lets the row break at narrow
  // widths, so the height is not a closed-form function of anything CSS can
  // see. Modelled on app/copilot/useStickyTop.js's measure-on-mount / resize /
  // ResizeObserver / remove-on-cleanup shape rather than inventing a second
  // one; it publishes a VALUE and leaves the policy (which scrollport, plus
  // how much clearance) to the single declaration in app/globals.css.
  //
  // Reads `headerRef` rather than a document-wide attribute query on purpose:
  // this binds to the element THIS component rendered, and it leaves the query
  // attribute below at exactly one occurrence in this file — which
  // app/copilot/stickyQuestionGuards.test.js's G-3 asserts, and which a second
  // literal in a comment would break.
  const publishHeight = useCallback(() => {
    const el = headerRef.current;
    const root = document.documentElement;
    if (!el) {
      // No header on this route (auth surfaces) — remove rather than write 0px,
      // so the CSS fallback is what applies and there is never a stale value
      // for the next route to inherit.
      root.style.removeProperty(HEADER_HEIGHT_PROP);
      return;
    }
    root.style.setProperty(HEADER_HEIGHT_PROP, `${el.getBoundingClientRect().height}px`);
  }, []);

  // Before the early return below, so the hook order is unconditional. Layout
  // effects run after refs of the SAME commit attach, so the first call already
  // reads a real rect — and it runs before paint, which matters for the one
  // case a post-paint `useEffect` would lose: a deep link straight to
  // `/#main-content`. `hidden` is a dependency so a client-side navigation onto
  // (or off) an auth route re-runs this and the property follows the header.
  useLayoutEffect(() => {
    publishHeight();
    window.addEventListener("resize", publishHeight);
    // jsdom has no ResizeObserver and vitest.setup.js does not polyfill one —
    // the same guard, for the same reason, as useStickyTop.js:260.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publishHeight) : null;
    if (headerRef.current) ro?.observe(headerRef.current);
    return () => {
      window.removeEventListener("resize", publishHeight);
      ro?.disconnect();
      document.documentElement.style.removeProperty(HEADER_HEIGHT_PROP);
    };
  }, [publishHeight, hidden]);

  if (hidden) return null;

  return (
    <header
      ref={headerRef}
      data-app-header="" // ARCH-sticky §3.4/G-3: the query useStickyTop.js measures this header by
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px clamp(12px, 4vw, 24px)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
        flexWrap: "wrap",
      }}
    >
      <BackButton />
      <span
        style={{
          marginRight: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          fontFamily: "var(--font-source-serif), Georgia, serif",
          fontWeight: 600,
          fontSize: "1.15rem",
          letterSpacing: "-0.01em",
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "var(--accent)",
            flexShrink: 0,
          }}
        />
        Resume Tailor
      </span>
      <EngineSelect />
      <SettingsMenu />
    </header>
  );
}
