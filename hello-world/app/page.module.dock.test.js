// The fixed bottom dock's CSS contract (mobile pass, surface B — findings
// B-2, B-4, B-5 and m-2 of scratchpad/MOBILE-B-mainpage.md, re-verified
// against the tree at 93ad8f7 before this file was written).
//
// ---------------------------------------------------------------------------
// WHY SOURCE TEXT AND NOT getComputedStyle — read before adding to this file.
//
// vitest.config.js sets no `css` option, so Vitest's `css: false` default
// applies NO CSS-module style at all under jsdom: `getComputedStyle` on a
// `.floatingToolbar` element reports the browser defaults, and
// `styles.floatingToolbar` from the CSS-module import proxy is a
// self-satisfying string that exists whether or not the class is declared.
// Even with `css: true` it would not help: every rule this file cares about
// lives in `@media (max-width: 640px)`, and jsdom's `evaluateMediaList`
// returns true only for an empty list or the bare types `all`/`screen` — a
// `max-width` condition is ALWAYS false there, and `app/theme/
// computedStyleAtWidth.js`'s `atWidth` harness deliberately rewrites only
// `min-width` conditions (see its own "THE LIMIT, STATED ACCURATELY" note).
// So this file reads app/page.module.css as text, exactly as
// app/page.module.dupFlag.test.js and app/theme/themeSystem.test.js already
// do, and asserts DECLARATIONS.
//
// WHAT THIS FILE CANNOT PROVE, and what must never be asserted here:
//   * that the dock actually fits the viewport. jsdom has no layout engine;
//     `getBoundingClientRect()` returns zeros.
//   * that the "⋯" button is really 44px. A declaration of `min-height: 44px`
//     is not a rendered box.
//   * that a long company name no longer pushes the chip actions off-screen.
//     `app/globals.css` sets `html { overflow-x: hidden }`, so
//     `document.scrollWidth` is clipped into uselessness and a fit claim can
//     only come from element bounds in a real browser.
// The manual checks that DO settle those are listed in
// scratchpad/AC-bottom-dock.md §"Browser-only checks", with their selectors
// and thresholds.
//
// The 640px breakpoint is the DOCK's own existing one (the shipped
// `@media (max-width: 640px)` block at the end of page.module.css), not the
// 600px `useIsMobile()` uses — the same consistency ruling
// app/page.module.dupFlag.test.js already records for `.dupFlagAction`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS_PATH = path.join(process.cwd(), "app/page.module.css");
const CSS = readFileSync(CSS_PATH, "utf8");

// The 44px iOS/WCAG-2.5.5 touch minimum. Spelled as a number here, never as
// the string "44px": app/theme/mobileSx.test.js's block-4 sweep fails any
// non-test .js file under app/ that contains the literal `"44px"`, and this
// file is a .test.js so it is exempt — but the SOURCE fix these cases drive
// must land in CSS for exactly that reason. See the AC doc.
const TAP_MIN = 44;

// ---------------------------------------------------------------------------
// Source readers. `blockAfter` pulls the first `{ ... }` body following a
// literal marker; `declIn` reads one property out of a body. Same method as
// app/page.module.dupFlag.test.js's `declAfter`, split in two because several
// cases below need to read more than one property out of the same block, and
// because two cases need a body from INSIDE a media query.
// ---------------------------------------------------------------------------
function blockAfter(marker, from = 0) {
  const i = CSS.indexOf(marker, from);
  if (i < 0) throw new Error(`marker not found in app/page.module.css: ${JSON.stringify(marker)}`);
  const open = CSS.indexOf("{", i);
  const close = CSS.indexOf("}", open);
  if (open < 0 || close < 0) throw new Error(`no block after marker: ${JSON.stringify(marker)}`);
  return CSS.slice(open + 1, close);
}

// Every value declared for `prop` in `block`, in source order. A list rather
// than a single value because the dvh/vh fallback pattern (M-2) is TWO
// declarations of the same property, and the later one must be the dvh.
function declsIn(block, prop) {
  const out = [];
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, "gi");
  let m;
  while ((m = re.exec(block))) out.push(m[1].trim());
  return out;
}

function declIn(block, prop) {
  const all = declsIn(block, prop);
  return all.length ? all[all.length - 1] : null;
}

// The body of `selector` as declared INSIDE the `@media (max-width: 640px)`
// block — i.e. the phone-only rule, not a base rule that happens to share the
// name. Returns null when the selector is not in that block at all.
const MOBILE_AT = "@media (max-width: 640px)";
function mobileBlockFor(selector) {
  // There is more than one `@media (max-width: 640px)` in this file (the
  // .dupFlagAction one and the trailing layout one), so every occurrence is
  // searched rather than only the first.
  let at = CSS.indexOf(MOBILE_AT);
  while (at >= 0) {
    // The media block runs to its own closing brace: find it by counting.
    const open = CSS.indexOf("{", at);
    let depth = 0;
    let end = -1;
    for (let i = open; i < CSS.length; i += 1) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const media = CSS.slice(open + 1, end < 0 ? CSS.length : end);
    const hit = media.indexOf(selector);
    if (hit >= 0) {
      const o = media.indexOf("{", hit);
      const c = media.indexOf("}", o);
      if (o >= 0 && c >= 0) return media.slice(o + 1, c);
    }
    at = CSS.indexOf(MOBILE_AT, end < 0 ? CSS.length : end);
  }
  return null;
}

// "44px" / "44" / "2.75rem" -> 44. Anything else -> NaN, which fails the
// comparison rather than silently passing it.
function toPx(value) {
  if (value == null) return NaN;
  const m = /^([\d.]+)(px|rem|em)?$/.exec(String(value).trim());
  if (!m) return NaN;
  const n = Number(m[1]);
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
}

// ---------------------------------------------------------------------------
// AC-2 / B-2 — the dock is bounded and scrolls its own overflow.
//
// `.floatingToolbar` is `position: fixed; bottom: 0` with no `max-height` and
// no `overflow`. A duplicate-application banner plus the header plus the chip
// list can exceed the viewport, and a fixed, bottom-anchored box overflows
// off the TOP edge — where nothing can scroll to it. The banner is the
// element at the top, so the warning is what disappears.
// ---------------------------------------------------------------------------
describe("app/page.module.css — .floatingToolbar is height-bounded and scrolls (B-2)", () => {
  it("caps its own height against the viewport", () => {
    const block = blockAfter(".floatingToolbar {");
    const caps = declsIn(block, "max-height");
    expect(caps.length, "`.floatingToolbar` declares no max-height at all").toBeGreaterThan(0);
  });

  it("expresses that cap in dvh, with a vh declaration first as the fallback", () => {
    // Hazard #6 / M-2: on iOS Safari `vh` resolves against the LARGE viewport
    // (the URL-bar-collapsed height), so a `vh` cap is taller than what is
    // actually visible — which is the exact failure this cap exists to
    // prevent. `dvh` is the dynamic-viewport unit; the plain-`vh`
    // declaration must come FIRST so a browser without `dvh` still gets a
    // cap rather than none.
    const block = blockAfter(".floatingToolbar {");
    const caps = declsIn(block, "max-height");
    expect(caps.length, `expected a vh fallback then a dvh cap, got: ${JSON.stringify(caps)}`).toBeGreaterThanOrEqual(2);
    expect(caps[caps.length - 2], "first max-height should be the plain-vh fallback").toMatch(/\dvh\b/);
    expect(caps[caps.length - 1], "last max-height should be the dvh value").toMatch(/\ddvh\b/);
    const pct = Number(/([\d.]+)dvh/.exec(caps[caps.length - 1])[1]);
    expect(pct, "a dock allowed more than 70% of the viewport is not a cap").toBeLessThanOrEqual(70);
  });

  it("scrolls the overflow it now has instead of pushing it off the top edge", () => {
    const block = blockAfter(".floatingToolbar {");
    const overflow = declIn(block, "overflow-y") || declIn(block, "overflow");
    expect(overflow, "`.floatingToolbar` declares no overflow, so a capped box would CLIP").not.toBeNull();
    expect(overflow).toMatch(/^(auto|scroll)$/);
  });
});

// ---------------------------------------------------------------------------
// AC-4 / B-4, M-6 — the dock's own controls reach the 44px touch minimum.
//
// `.toolbarChipBtn` is `padding: 3px 5px` at `font-size: 0.82rem` with
// `line-height: 1` (~23x19 rendered), and on a phone it is the ONLY route to
// Download / Regenerate / Mark applied / Open posting / Remove — the arrows
// and the drag-preview affordance are all behind `!vertical`.
// `.toolbarClear` (`padding: 5px 10px`, `0.75rem`, ~24px tall) carries the
// DESTRUCTIVE "Clear all". `.dupFlagAction` already got its 44px floor at
// page.module.css's `@media (max-width: 640px)`; these two did not.
// ---------------------------------------------------------------------------
describe("app/page.module.css — the dock's controls meet MOBILE_TAP_MIN on phones (B-4, M-6)", () => {
  it("gives .toolbarChipBtn a 44px floor in BOTH axes", () => {
    // Both axes, because this control's content is a single "⋯" glyph: a
    // min-height alone leaves it ~23px wide, which still fails WCAG 2.5.8's
    // 24x24 AA floor on the other axis.
    const block = mobileBlockFor(".toolbarChipBtn");
    expect(block, "`.toolbarChipBtn` has no rule inside @media (max-width: 640px)").not.toBeNull();
    expect(toPx(declIn(block, "min-height"))).toBeGreaterThanOrEqual(TAP_MIN);
    expect(toPx(declIn(block, "min-width"))).toBeGreaterThanOrEqual(TAP_MIN);
  });

  it("gives .toolbarClear a 44px floor, matching the .dupFlagAction precedent", () => {
    const block = mobileBlockFor(".toolbarClear");
    expect(block, "`.toolbarClear` has no rule inside @media (max-width: 640px)").not.toBeNull();
    expect(toPx(declIn(block, "min-height"))).toBeGreaterThanOrEqual(TAP_MIN);
  });

  it("GUARD (already true at 93ad8f7): .dupFlagAction keeps its 44px floor", () => {
    // Passes before the fix. Here so the phone rule that already exists is
    // not lost while its two neighbours are being added next to it.
    const block = mobileBlockFor(".dupFlagAction");
    expect(block).not.toBeNull();
    expect(toPx(declIn(block, "min-height"))).toBeGreaterThanOrEqual(TAP_MIN);
  });
});

// ---------------------------------------------------------------------------
// AC-5 / B-5 — a long company name cannot push the chip's actions off-screen.
//
// In the vertical dock the chip is `width: 100%`, but `.toolbarChip` keeps
// `white-space: nowrap` with no `overflow`. `.toolbarChipTitle` can ellipsize
// (it has `overflow: hidden`, so its min-content floor is 0);
// `.toolbarChipCompany` has NO max-width, NO overflow and NO text-overflow,
// so its intrinsic minimum is its full text width and it cannot shrink. It
// pushes `.toolbarChipActions` (`flex-shrink: 0`) past the right edge, where
// `html { overflow-x: hidden }` clips it away with no scrollbar — the "⋯"
// button silently ceases to exist.
// ---------------------------------------------------------------------------
describe("app/page.module.css — a long company name ellipsizes instead of clipping the actions (B-5)", () => {
  it("lets .toolbarChipCompany shrink below its content width", () => {
    const block = blockAfter(".toolbarChipCompany {");
    expect(toPx(declIn(block, "min-width")), "without `min-width: 0` a flex item cannot shrink below min-content").toBe(0);
  });

  it("makes .toolbarChipCompany ellipsize rather than overflow", () => {
    const block = blockAfter(".toolbarChipCompany {");
    expect(declIn(block, "overflow")).toBe("hidden");
    expect(declIn(block, "text-overflow")).toBe("ellipsis");
  });

  it("clips the chip itself as the backstop", () => {
    // `.toolbarChip` is `white-space: nowrap` with no overflow: even with the
    // company fixed, any other nowrap child can escape the chip's box. The
    // chip must be the boundary.
    const block = blockAfter(".toolbarChip {");
    expect(declIn(block, "overflow")).toBe("hidden");
  });

  it("GUARD (already true at 93ad8f7): .toolbarChipTitle can already ellipsize", () => {
    // Passes before the fix — recorded so the working half is not "fixed"
    // into breaking while its sibling is repaired.
    const block = blockAfter(".toolbarChipTitle {");
    expect(declIn(block, "overflow")).toBe("hidden");
    expect(declIn(block, "text-overflow")).toBe("ellipsis");
  });
});

// ---------------------------------------------------------------------------
// AC-8 / m-2 — no CSS `order` in the dock.
//
// `.dupFlag { order: -1 }` moves pixels but not focus or reading order
// (WCAG 2.4.3 / 1.3.2). It is inert TODAY only because StatusBar.js already
// renders both banners as the dock's first DOM children — which makes it a
// live tripwire, not a feature: the next person to move that JSX gets a
// silent DOM/visual divergence, and B-2's fix (making the dock a scroll
// container) is exactly the kind of edit that invites moving it.
// ---------------------------------------------------------------------------
describe("app/page.module.css — the dock relies on DOM order, not CSS order (m-2)", () => {
  it("declares no `order` anywhere in the dock's own block", () => {
    const dockCss = CSS.slice(CSS.indexOf(".floatingToolbar {"));
    const offenders = dockCss
      .split("\n")
      .map((line, i) => ({ line: line.trim(), i }))
      .filter(({ line }) => /^order\s*:/.test(line))
      .map(({ line, i }) => `page.module.css (dock block) +${i}: ${line}`);
    expect(offenders, `CSS \`order\` reorders paint but not focus:\n${offenders.join("\n")}`).toEqual([]);
  });
});
