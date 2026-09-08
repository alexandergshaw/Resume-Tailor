"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

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

// ARCH-stats-in-strip r3 §2.2 — THREE new constants for the speaking-stats
// row's own hosting predicate, counted alongside the five above (eight
// total) for the same reason: in a guard whose whole point is that an
// unlisted name is an unenforced name, a miscount IS the failure mode
// (stickyQuestionGuards.test.js's G-5). Module-local for the identical
// reason the five above are (see that comment) — exporting any of these
// would mint a name whose only outside consumer is that same test file.
const STATS_FLOOR_PX = 4; // allowance over the row's own rowGap (0.25 * 16 = 4px), rounded up from its 2px
const STATS_FLOOR_REM = 2.51; // two body2 line boxes (0.875 * 1.43 = 1.25125), doubled and rounded UP from the measured value
const STATS_MIN_STRIP_REM = 10.5; // the width bound (§1.2): a choice inside the measured interval that keeps the reservation from ever overflowing

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

// ARCH-stats-in-strip r3 §2.2. A SECOND, narrower predicate — alongside
// isHostable above, never replacing it — for whether the speaking-stats row
// can ALSO be hosted. Reads the strip's own rendered WIDTH (a new, free
// measurement: `measure()` below already calls `stripRef.current.
// getBoundingClientRect()` for the height; this reads `.width` off the same
// rect) plus the row's own reservation, and refuses a viewport too narrow or
// too short to hold both the question's cap AND the row inside the shared
// STRIP_MAX_SHARE budget.
//
// The `capPx` line restates what isHostable's own capPx already computes,
// identically — deliberately, so the two predicates read the SAME cap
// rather than two numbers that happen to agree today: G-5's "the predicate
// is written in terms of the constants" assertion extends over this one
// unchanged for exactly that reason.
function isStatsHostable(headerH, rootPx, stripW) {
  if (!isHostable(headerH)) return false; // never sticky for stats but not for the question (AC 5)
  if (stripW < STATS_MIN_STRIP_REM * rootPx) return false; // the width bound (§1.2)
  const viewportH = document.documentElement.clientHeight;
  const availPx = viewportH - headerH;
  const pct = STRIP_BANDS.find(([max]) => viewportH <= max)[1];
  const capPx = Math.max(STRIP_FLOOR_PX + STRIP_FLOOR_REM * rootPx, pct * availPx); // the SAME cap the CSS emits
  const reservePx = STATS_FLOOR_PX + STATS_FLOOR_REM * rootPx;
  return capPx + STRIP_GUTTER_PX + reservePx + STRIP_GUTTER_PX <= STRIP_MAX_SHARE * availPx;
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
//
// ARCH-stats-in-strip r3 §2.2/§2.4: also returns `statsHosted` — whether the
// stats row above can be hosted, `false` at first paint and on SSR like
// `stickyTop` is, so a strip that grows a row one frame later can only push
// content down, never clip it. It takes no render-state argument (not
// `pace`/`fillers`, not whether a question exists): AC 8 requires the row's
// PRESENCE to be identical across every stats state at a fixed geometry, and
// AC 5 requires it to never be true where `stickyTop` is null.
//
// POST-VERIFICATION MAJOR-1 FIX. `StickyQuestionStrip.js`'s stats-only early
// return unmounts the very Box `stripRef` is attached to, so `measure()`
// used to have exactly one chance at a real reading: after the collapse,
// `stripRef.current` was null forever, `stripW` read as 0 forever, and
// `isStatsHostable`'s width clause failed on every later call — a resize
// INTO a hostable geometry could never bring the row back. Two changes fix
// that without ever rendering the empty box AC 41 forbids:
//   1. `measure()` now treats "the ref I would read a rect from is null" as
//      "no evidence either way", not as "confirmed unhostable" — it resets
//      `measured` to `false` instead of latching `statsHosted` false on a
//      bogus zero-width rect.
//   2. A SECOND layout effect below re-runs `measure()` whenever `measured`
//      is `false`. Because a `false` reset makes `StickyQuestionStrip.js`
//      skip its early return on the very next render (the identical
//      first-mount shape it already had), the ref-bearing Box remounts
//      before that effect body runs — layout effects always run after refs
//      of the SAME commit have attached — so this second call gets a REAL
//      rect, not another zero. Both effects are `useLayoutEffect`, so this
//      whole probe-remount-remeasure cycle (at most two extra commits)
//      resolves before the browser paints; nothing above ever shows the
//      empty box to a user (this also closes MINOR-1, the transient
//      `useEffect` used to allow). `window.resize` and the header's own
//      `ResizeObserver` stay registered for the life of the mount
//      regardless of whether the strip is currently collapsed, so a resize,
//      a maximize, a rotation, or the header changing height all re-arm
//      this — none of them can get stuck the way the pre-fix version could.
export function useStickyTop() {
  const stripRef = useRef(null);
  // The ResizeObserver instance, shared between the two effects below so the
  // re-probe effect can re-observe whichever DOM node `stripRef` currently
  // points at — including a node that mounted AFTER the observer itself was
  // created, which a one-time `ro.observe(stripRef.current)` at setup can
  // never see (the second-order half of MAJOR-1: without this, only
  // `window.resize` could ever re-arm a strip that had collapsed once).
  const roRef = useRef(null);
  const [stickyTop, setStickyTop] = useState(null);
  const [statsHosted, setStatsHosted] = useState(false);
  // ARCH-stats-in-strip r3 §2.4: has this hook completed its most recent
  // measurement pass yet. A stats-only mount (no question to show) has to
  // tell "not yet measured" apart from "measured, and genuinely not
  // hosted" — both start life as `statsHosted === false` — because the
  // stats-only caller's own early return unmounts the very Box this hook
  // measures THROUGH (`stripRef`). Bailing out before a real measurement
  // would remove the ref before `stripW` was ever read for real,
  // permanently freezing `statsHosted` at its unmeasured default instead of
  // letting the actual geometry decide it. NOT a one-way latch: `measure()`
  // resets this back to `false` (see the fix note above) every time it is
  // asked to re-measure a strip that is not currently mounted, which is
  // what lets a LATER collapse recover too, not just the first one.
  const [measured, setMeasured] = useState(false);

  // Read fresh on every call rather than closed over once, so this same
  // function works both as the effect's own listener callback and as the
  // re-probe effect's imperative re-measurement below — a single
  // implementation neither effect has to duplicate. `useCallback` with no
  // deps keeps its identity stable across renders (it closes over nothing
  // that changes), so passing it in a dependency array below still runs the
  // owning effect only once per mount, same as the empty array it replaces.
  const measure = useCallback(() => {
    // data-app-header rather than `querySelector("header")`: a tag-name
    // query silently binds to whatever <header> happens to be first in the
    // document. G-3 asserts the attribute exists, so its deletion — which
    // would make this feature do nothing, permanently, with no error — fails
    // a test instead of shipping.
    const header = document.querySelector("[data-app-header]");
    if (!header) return;
    const headerH = header.getBoundingClientRect().height;
    const hostable = isHostable(headerH);
    // The cap's own calc() reads `--sticky-top` (§2.2 point 2), so it must
    // be written BEFORE the strip's own height is read below, or the read
    // would still reflect the previous cap.
    document.documentElement.style.setProperty("--sticky-top", `${headerH}px`);
    if (!stripRef.current) {
      // The strip's own box is not currently in the document — a stats-only
      // mount that collapsed to `null` on a previous, genuine measurement.
      // There is no rect left here to read a real width from, so this call
      // cannot decide `statsHosted` for real; resetting `measured` asks for
      // another chance instead of reconfirming "unhostable" on a fabricated
      // zero-width rect (see the fix note above the hook for the full
      // remount-and-remeasure cycle this triggers).
      setMeasured(false);
      return;
    }
    const stripRect = stripRef.current.getBoundingClientRect();
    const stripH = stripRect.height;
    // ARCH-stats-in-strip r3 §2.2: the free measurement isStatsHostable
    // needs — the SAME rect the height above already came off, so this
    // adds no new observer and no new listener.
    const stripW = stripRect.width;
    // §3.4: one writer, two scroll containers. `--sticky-pad` is the
    // MAXIMUM possible occlusion (headerH + the strip's current outer
    // height); the residual — over-padding when the page is scrolled past
    // the strip's flow position — can only scroll a focused control
    // further down its column than strictly necessary, never under the
    // strip.
    document.documentElement.style.setProperty("--sticky-pad", `${headerH + stripH}px`);
    document.documentElement.style.scrollPaddingTop = "var(--sticky-pad, 0px)";
    setStickyTop(hostable ? headerH : null);
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    setStatsHosted(isStatsHostable(headerH, rootPx, stripW));
    setMeasured(true);
  }, []);

  useLayoutEffect(() => {
    // Mirrors `measure()`'s own header check, but gates something `measure`
    // itself does not decide: whether to attach the resize listener and the
    // ResizeObserver AT ALL for the life of this mount. Unchanged from
    // before this fix — a document with no app header leaves this hook
    // fully inert, exactly as G-3 pins.
    const header = document.querySelector("[data-app-header]");
    if (!header) return undefined;

    window.addEventListener("resize", measure);
    // jsdom has no ResizeObserver and vitest.setup.js does not polyfill one
    // — CopilotClient.wiring.test.js mounts the real client with the
    // dashboard (and, now, the strip) unmocked, so this is the first jsdom
    // surface to execute this hook, exactly as useLiveColumnHeight.js:36
    // already guards for the same reason.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    roRef.current = ro;
    ro?.observe(header);
    if (stripRef.current) ro?.observe(stripRef.current);

    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
      roRef.current = null;
      // All state restored on unmount — a strip that mounts, measures, then
      // unmounts (e.g. the live mount predicate flipping false) must not
      // leave a stale scroll-padding or custom property behind for whatever
      // renders next.
      document.documentElement.style.removeProperty("--sticky-top");
      document.documentElement.style.removeProperty("--sticky-pad");
      document.documentElement.style.scrollPaddingTop = "";
    };
  }, [measure]);

  // The re-probe effect (MAJOR-1's fix). Runs on mount (there is no "before"
  // value for `measured` to compare against, so React runs every layout
  // effect at least once) and again every time `measure()` above resets
  // `measured` to `false` because it found no strip to read a rect from.
  // Both are the same case from this effect's point of view: "the box may
  // just have (re)appeared in the DOM this commit — go read its real rect
  // before anything paints." Skipped once `measured` is `true`, so a
  // successful measurement — hostable or not — does not loop: the only way
  // back to `false` is `measure()` itself finding a null ref again.
  useLayoutEffect(() => {
    if (measured) return;
    if (stripRef.current) roRef.current?.observe(stripRef.current);
    measure();
  }, [measured, measure]);

  return { stripRef, stickyTop, statsHosted, measured };
}
