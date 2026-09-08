"use client";

import { useEffect, useRef, useState } from "react";

// ARCH-sticky §2.2/§3.4. The sticky question strip's one runtime measurement:
// the app header's height (what the strip sticks BELOW, and what the cap's
// percentage term is debited against), and whether the current viewport can
// host a sticky strip at all. Modelled on useLiveColumnHeight.js's own
// measure-on-mount / resize / ResizeObserver / cleanup shape.
//
// MAJOR-2/C-2: the five constants below are kept MODULE-LOCAL on purpose.
// Exporting them would mint five names whose only outside consumer is
// stickyQuestionGuards.test.js — `unused-export` + `importedByATest` — which
// moves lib/sourceScan/exportReachability.sweep.test.js's `:476`/`:491`
// counts (the two figures that file itself calls "never a number to bump").
// That file records the identical precedent for MAX_ACTIVITY_FIELD_CHARS and
// truncateField at `:486-490`: "caught by this very assertion on their first
// run and un-exported, because both are applied inside that module and read
// nowhere else." Same ruling here — G-5 (stickyQuestionGuards.test.js)
// asserts on what actually SHIPS instead: `band()`'s emitted strings, plus a
// source-level check that these five names are declared exactly once each
// and never re-exported, which is what stops the cap and the hosting
// predicate below from silently drifting onto two different floor rems.
const STRIP_FLOOR_PX = 64; // TABLE 3's worst chrome, px terms (border+padding+rowGap+Chip, none of which scale with root font size)
const STRIP_FLOOR_REM = 4.25; // two title lines + one question line, rounded UP from the measured 4.2475
const STRIP_GUTTER_PX = 12; // the strip's own `pb: 1.5` — the gap the dashboard grid's `gap: 1.5` used to supply
const STRIP_BANDS = [
  [519, 0.45],
  [699, 0.38],
  [Infinity, 0.30],
];
const STRIP_MAX_SHARE = 0.60; // of the space BELOW the header — the hosting rule (§2.2 point 3)

const FLOOR = `calc(${STRIP_FLOOR_PX}px + ${STRIP_FLOOR_REM}rem)`;
// `var(--sticky-top, 0px)` — unset (SSR, first paint) falls back to 0px,
// which is exactly the pre-header-debit cap: the fallback can only make the
// cap LARGER, never smaller, so it cannot clip.
const avail = (u) => `(100${u} - var(--sticky-top, 0px))`;

// ARCH-sticky §2.2. `band(u)` emits the cap's three-tier max()/@media ladder
// for whichever viewport unit `u` names ("vh" outside @supports, "dvh"
// inside it — StickyQuestionStrip.js declares both, in that order, so `dvh`
// wins where supported and `vh` survives where it is not). Object KEY ORDER
// matters: MUI/emotion emit these in declaration order, so the 699 band must
// be declared before the 519 band for the shorter one to win the cascade —
// see stickyQuestionGuards.test.js's G-5 for the exact strings this must
// produce.
export const band = (u) => ({
  maxHeight: `max(${FLOOR}, calc(${avail(u)} * 0.30))`,
  "@media (max-height: 699px)": { maxHeight: `max(${FLOOR}, calc(${avail(u)} * 0.38))` },
  "@media (max-height: 519px)": { maxHeight: `max(${FLOOR}, calc(${avail(u)} * 0.45))` },
});

// ARCH-sticky §2.2 point 3 / C-1 (MAJOR-1). Whether the current viewport can
// host a sticky strip at all. A floor tall enough never to clip a question's
// first line is, on a short enough CSS viewport, taller than the viewport
// itself — something has to give, and the honest thing to give is the
// stickiness, not the question's first line and not the page. Below the
// floor's own share of the space under the header, the strip renders in
// flow at its natural height instead: no cap, no scroller, nothing clipped —
// today's behaviour, with the question moved to the top of the page instead
// of into the dashboard grid.
//
// Reads `document.documentElement.clientHeight` — the LARGE viewport.
// deliberately NOT the DYNAMIC viewport property some browser APIs expose:
// that one moves 50-100 CSS px as a phone's URL bar collapses and expands
// WHILE THE USER SCROLLS, and this predicate is a hard step with no
// hysteresis. A hosted configuration can sit as little as 17.3px from the
// threshold (a landscape iPhone at root 24) — a fraction of what the URL bar
// alone is worth — so reading the dynamic viewport here would flip the
// strip's own stickiness on and off mid-scroll, swapping a ~180px pinned box
// for a ~660px static one with nothing preserving scroll position.
// `clientHeight` is also what the CSS `@media (max-height:)` bands above
// evaluate against, so this makes the JS and the CSS agree by construction
// instead of by argument. (Pinned by stickyQuestionGuards.test.js's G-5,
// which bans the dynamic property's literal name from this file outright.)
function isHostable(headerH) {
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const floorPx = STRIP_FLOOR_PX + STRIP_FLOOR_REM * rootPx;
  const viewportH = document.documentElement.clientHeight;
  const availPx = viewportH - headerH;
  const pct = STRIP_BANDS.find(([max]) => viewportH <= max)[1];
  const capPx = Math.max(floorPx, pct * availPx);
  return capPx + STRIP_GUTTER_PX <= STRIP_MAX_SHARE * availPx;
}

// ARCH-sticky §3.4. The only runtime measurement the sticky strip needs.
// Two observed targets: the app header (via its own query attribute — see
// G-3 for why not a tag-name query) and the strip's own outer element
// (`stripRef`, handed back for the caller to attach).
//
// Returns `stickyTop: null` for EITHER "not measured yet" (SSR/first paint)
// OR "this viewport cannot host a strip" (`isHostable` above) — both render
// `position: static` with no cap (see StickyQuestionStrip.js's own §3.3), not
// `top: 0`, which under AppHeader's `zIndex: 1100` would hide the strip's
// first 51-190px of content, silently, worst at the narrowest widths.
export function useStickyTop() {
  const stripRef = useRef(null);
  const [stickyTop, setStickyTop] = useState(null);

  useEffect(() => {
    // data-app-header rather than `querySelector("header")`: a tag-name
    // query silently binds to whatever <header> happens to be first in the
    // document. G-3 asserts the attribute exists, so its deletion — which
    // would make this feature do nothing, permanently, with no error — fails
    // a test instead of shipping.
    const header = document.querySelector("[data-app-header]");
    if (!header) return undefined;

    const measure = () => {
      const headerH = header.getBoundingClientRect().height;
      const hostable = isHostable(headerH);
      // The cap's own calc() reads `--sticky-top` (§2.2 point 2), so it must
      // be written BEFORE the strip's own height is read below, or the read
      // would still reflect the previous cap.
      document.documentElement.style.setProperty("--sticky-top", `${headerH}px`);
      const stripH = stripRef.current ? stripRef.current.getBoundingClientRect().height : 0;
      // §3.4: one writer, two scroll containers. `--sticky-pad` is the
      // MAXIMUM possible occlusion (headerH + the strip's current outer
      // height); the residual — over-padding when the page is scrolled past
      // the strip's flow position — can only scroll a focused control
      // further down its column than strictly necessary, never under the
      // strip.
      document.documentElement.style.setProperty("--sticky-pad", `${headerH + stripH}px`);
      document.documentElement.style.scrollPaddingTop = "var(--sticky-pad, 0px)";
      setStickyTop(hostable ? headerH : null);
    };

    measure();
    window.addEventListener("resize", measure);
    // jsdom has no ResizeObserver and vitest.setup.js does not polyfill one
    // — CopilotClient.wiring.test.js mounts the real client with the
    // dashboard (and, now, the strip) unmocked, so this is the first jsdom
    // surface to execute this hook, exactly as useLiveColumnHeight.js:36
    // already guards for the same reason.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(header);
    if (stripRef.current) ro?.observe(stripRef.current);

    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
      // All state restored on unmount — a strip that mounts, measures, then
      // unmounts (e.g. the live mount predicate flipping false) must not
      // leave a stale scroll-padding or custom property behind for whatever
      // renders next.
      document.documentElement.style.removeProperty("--sticky-top");
      document.documentElement.style.removeProperty("--sticky-pad");
      document.documentElement.style.scrollPaddingTop = "";
    };
  }, []);

  return { stripRef, stickyTop };
}
