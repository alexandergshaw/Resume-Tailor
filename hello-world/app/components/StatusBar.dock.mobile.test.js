// @vitest-environment jsdom
//
// The fixed bottom dock's PHONE behaviour (mobile pass, surface B — findings
// B-1, B-3, M-2 and M-4 of scratchpad/MOBILE-B-mainpage.md, each re-verified
// against the tree at 93ad8f7 before this file was written). Criteria:
// scratchpad/AC-bottom-dock.md.
//
// The four live defects exercised here:
//
//   B-1  NOTHING RESERVES SPACE FOR THE DOCK. `.floatingToolbar` is
//        `position: fixed; bottom: 0` (page.module.css:307-313) and a grep of
//        page.module.css + globals.css finds no compensating padding-bottom,
//        margin-bottom or scroll gutter anywhere — `.page` carries the same
//        `clamp(16px,4vw,40px)` bottom padding it would have with no dock at
//        all. So the last 84-459px of EVERY tab's content sits under the dock
//        permanently: you can scroll to the document end and the dock is
//        still on top of it.
//
//   B-3  `StatusBar.js:192` — `const vertical = expanded || isMobile` — forces
//        the tall column dock on every phone, and `:469` sets the
//        Expand/Collapse toggle to `display: "none"` when `isMobile`. There
//        is no control that makes the dock smaller. The only way to get the
//        screen back is the DESTRUCTIVE "Clear all".
//
//   M-2  `StatusBar.js:497` caps the chip list at `maxHeight: "50vh"`. On iOS
//        Safari `vh` resolves against the LARGE viewport (812 at 375x812),
//        not the ~635 actually visible, so "50vh" is ~64% of the screen.
//
//   M-4  `StatusBar.js:456`'s header row is a raw `display: flex` with no
//        `flexWrap`, holding a `white-space: nowrap` label plus three
//        `flex-shrink: 0` buttons ("Download duplicate-check log" alone is
//        ~205px of uppercase 0.75rem text). Nothing may shrink and nothing
//        may wrap, so the row overflows and `html { overflow-x: hidden }`
//        clips it.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE CAN AND CANNOT PROVE — read before adding to it.
//
// jsdom HAS NO LAYOUT ENGINE. `getBoundingClientRect()` returns zeros,
// `offsetHeight` is 0, and no box is ever laid out. NOTHING here asserts a
// height, an overlap, or whether content is reachable, and no such assertion
// may be added — it would be a fabricated pass. In particular this file does
// NOT prove that the spacer B-1 requires is the same height as the dock, only
// that the spacer exists, sits in normal flow OUTSIDE the fixed element, and
// is driven by a real measurement rather than a hardcoded guess.
//
// Vitest's `css: false` default (vitest.config.js sets no `css` option) also
// means CSS-module styles are NOT applied under jsdom, so `getComputedStyle`
// on a `.floatingToolbar` element reports browser defaults. Everything this
// file reads is therefore either an INLINE style (StatusBar's own
// `style={...}` objects, which jsdom does honour on `element.style`), the DOM
// tree, a role/name, or the component's source text.
//
// The measurements that actually settle B-1/B-3/M-2/M-4 in pixels are listed
// as browser-only manual checks in scratchpad/AC-bottom-dock.md, with their
// selectors and thresholds.
//
// The mobile matchMedia stub below is the whole reason this file is separate
// from app/components/StatusBar.test.js, which stubs `matches: false` (a
// desktop viewport) for the entire file and would have to keep doing so for
// its own cases to stay deterministic.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StatusBar from "./StatusBar.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Deliberately NOT `fileURLToPath(new URL(...))`: under
// `@vitest-environment jsdom` the global `URL` is jsdom's own class and
// `fileURLToPath` rejects it ("The URL must be of scheme file") — the same
// trap app/theme/themeSystem.test.js records at its own APP_DIR.
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "StatusBar.js"), "utf8");

let container;
let root;

// `useIsMobile()` is `useMediaQuery(theme.breakpoints.down("sm"), { noSsr:
// true })`, which compiles to `@media (max-width:599.95px)` and is answered by
// `window.matchMedia` directly — it never touches a stylesheet, so
// app/theme/computedStyleAtWidth.js's `atWidth` harness cannot emulate it and
// the stub has to. Matching on the literal `max-width` keeps this honest for
// `down("md")` too, should the component ever ask.
function stubViewport({ mobile }) {
  window.matchMedia = vi.fn((query) => ({
    matches: mobile ? /max-width/.test(String(query)) : false,
    media: String(query),
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

beforeEach(() => {
  stubViewport({ mobile: true });
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

function job(id, overrides = {}) {
  return { id, title: `Title for ${id}`, company: "Acme", url: "", ...overrides };
}

function baseProps(overrides = {}) {
  return {
    trackedJobs: [job("url-https://example.com/posting"), job("manual-1"), job("feed-42")],
    setTrackedJobs: vi.fn(),
    tailoringMap: {},
    jobResults: [],
    resumeFile: null,
    toolbarScrollRef: { current: null },
    toolbarCanScrollLeft: false,
    toolbarCanScrollRight: false,
    handleToolbarWheel: vi.fn(),
    handleToolbarScroll: vi.fn(),
    scrollToolbar: vi.fn(),
    isDocxResume: vi.fn(() => false),
    getDownloadFileNameForTitle: vi.fn(() => "resume.docx"),
    askAiAbout: vi.fn(),
    buildJobContextString: vi.fn(() => ""),
    setMainTab: vi.fn(),
    setActiveSection: vi.fn(),
    downloadResumeForChipJob: vi.fn(),
    handleToggleApplied: vi.fn(),
    handleIgnoreJob: vi.fn(),
    handleUntrackJob: vi.fn(),
    openResumePreview: vi.fn(),
    openCompanyResearch: vi.fn(),
    onRegenerate: vi.fn(),
    appliedByExternalId: null,
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(StatusBar, props));
  });
}

// The fixed dock. Located by `position: fixed`-bearing structure rather than
// by class name: the CSS-module class string is an implementation detail and,
// with `css: false`, carries no style to test against. The dock is the only
// element StatusBar renders that holds the "Generated (N)" label, so that is
// the anchor.
function dockEl() {
  const label = [...container.querySelectorAll("span")].find((el) => /^Generated \(\d+\)$/.test(el.textContent.trim()));
  return label ? label.closest("div").parentElement : null;
}

function collapseToggle() {
  return [...container.querySelectorAll("button")].find((b) => /^(Collapse|Expand) list$/.test(b.getAttribute("aria-label") || "")) || null;
}

function chipMenuButtons() {
  return [...container.querySelectorAll('button[aria-label="More actions"]')];
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// AC-1 / B-1 — the dock reserves the space it covers.
//
// The reservation is a FLOW SPACER rendered by StatusBar itself, marked
// `data-dock-spacer`, and NOT a `padding-bottom` on `.page`. Three reasons,
// recorded here because the test shape depends on the choice:
//   1. `.page` is the whole app's class; the audit itself flags a change
//      there as needing a coordination call with the other mobile surfaces.
//      A spacer touches only this component.
//   2. A `--dock-h` custom property would trip
//      app/theme/themeSystem.test.js's "every var(--token) used in
//      components/pages is a defined token" sweep, which reads
//      page.module.css and knows nothing outside the theme tokens.
//   3. It costs app/page.js ZERO lines — that file is 3206 against a hard
//      1000-line cap.
// StatusBar already renders as a direct child of `.page`, after `<main>`
// (app/page.js:3120), so a spacer emitted alongside the fixed dock lands
// exactly where the bottom gutter belongs.
// ---------------------------------------------------------------------------
describe("StatusBar — the fixed dock reserves the space it covers (B-1)", () => {
  it("renders a flow spacer whenever the dock is on screen", async () => {
    await render(baseProps());
    expect(
      container.querySelector("[data-dock-spacer]"),
      "no [data-dock-spacer]: the last screenful of every tab stays under the fixed dock",
    ).not.toBeNull();
  });

  it("keeps the spacer OUTSIDE the fixed dock, where it can occupy flow", async () => {
    // A spacer nested inside `position: fixed` reserves nothing — the fixed
    // element is out of flow, so its children are too. This is the assertion
    // that separates a real fix from a plausible-looking one.
    await render(baseProps());
    const spacer = container.querySelector("[data-dock-spacer]");
    expect(spacer, "no [data-dock-spacer] rendered").not.toBeNull();
    expect(dockEl(), "could not locate the dock element").not.toBeNull();
    expect(dockEl().contains(spacer), "the spacer is inside the fixed dock, so it reserves nothing").toBe(false);
  });

  it("hides the spacer from assistive tech — it is a gutter, not content", async () => {
    await render(baseProps());
    const spacer = container.querySelector("[data-dock-spacer]");
    expect(spacer).not.toBeNull();
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
  });

  it("also reserves space for the banner-only dock the empty-chip early return renders", async () => {
    // StatusBar.js:180-190's early return still renders a `.floatingToolbar`
    // — same `position: fixed`, same problem — whenever an untrack notice or
    // a log button is live. A fix that only covers the main return leaves
    // this one covering content.
    await render(
      baseProps({
        trackedJobs: [],
        onDupeDownloadLog: vi.fn(),
      }),
    );
    expect(
      container.querySelector("[data-dock-spacer]"),
      "the log-only dock is fixed too, and reserves nothing",
    ).not.toBeNull();
  });

  it("sizes the spacer from a MEASUREMENT of the dock, not a hardcoded constant", () => {
    // Source-level, deliberately: the dock's height is content-dependent
    // (1 chip ~84px, a duplicate banner + a full list ~672px) so a literal
    // cannot be right, and jsdom cannot measure the difference — every box
    // here is 0x0. `ResizeObserver` is the only API that re-measures when the
    // banner appears or a chip is added.
    expect(
      /ResizeObserver/.test(SOURCE),
      "StatusBar.js never observes the dock's size, so the spacer cannot track it",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-3 / B-3 — a phone can shrink the dock without destroying its data.
// ---------------------------------------------------------------------------
describe("StatusBar — the dock is collapsible on a phone (B-3)", () => {
  it("offers the collapse control on mobile instead of hiding it", async () => {
    await render(baseProps());
    const toggle = collapseToggle();
    expect(toggle, "no Expand/Collapse control rendered at all").not.toBeNull();
    // `style={isMobile ? { display: "none" } : undefined}` at
    // StatusBar.js:469 is the live defect: the control is in the DOM, named,
    // focusable and completely invisible.
    expect(toggle.style.display, "the collapse control is display:none on mobile").not.toBe("none");
  });

  it("starts collapsed on a phone, so the dock does not open at 23-82% of the screen", async () => {
    await render(baseProps());
    expect(
      chipMenuButtons().length,
      "the chip list is expanded on first paint; the dock covers up to 72% of a 375x812 screen before the user has done anything",
    ).toBe(0);
  });

  it("expands to the full chip list when the control is used, and collapses back", async () => {
    await render(baseProps());
    const toggle = collapseToggle();
    expect(toggle).not.toBeNull();
    await click(toggle);
    expect(chipMenuButtons().length, "expanding did not reveal the tracked-job chips").toBe(3);
    await click(collapseToggle());
    expect(chipMenuButtons().length, "collapsing did not put the screen back").toBe(0);
  });

  it("keeps the collapse control a real <button>, so the app-wide focus ring applies", async () => {
    // GUARD (already true at 93ad8f7). The focus ring ships as a
    // `MuiButtonBase` `.Mui-focusVisible` theme rule plus native-element
    // styling; a `<div role="button">` replacement would silently have no
    // focus indicator. Recorded because B-3's fix edits this exact element.
    await render(baseProps());
    const toggle = collapseToggle();
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
  });

  it('keeps "Clear all" reachable while collapsed — it must not become the only way out', async () => {
    // GUARD-shaped, but it is NOT currently guaranteed: "Clear all" renders
    // in the header row only under `vertical`, and B-3's fix changes what
    // `vertical` means. Pinned so the fix cannot trade one dead end for
    // another.
    await render(baseProps());
    const clear = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Clear all");
    expect(clear, '"Clear all" is not reachable in the collapsed dock').not.toBeNull();
  });

  it("still shows the duplicate-application banner while collapsed", async () => {
    // The banner is the one thing a shorter dock must not shorten away —
    // it is a warning the user has to see. Collapsing hides CHIPS, never the
    // notice.
    await render(
      baseProps({
        dupeNotice: {
          jobId: "url-https://example.com/posting",
          signals: [{ signal: "same-company", severity: "hit", kicker: "ALREADY APPLIED", sentence: "You applied to Acme on 1 Jan." }],
          evidence: [],
          interviewSearchSeed: "Acme",
          queueLabel: "",
        },
      }),
    );
    expect(container.querySelector('[data-dupe-flag="banner"]'), "the duplicate warning is not rendered").not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-6 / M-4 — the dock's header row wraps.
// ---------------------------------------------------------------------------
describe("StatusBar — the dock header row wraps instead of overflowing (M-4)", () => {
  it("declares flex-wrap and a row gap on the header row", async () => {
    await render(baseProps({ onDupeDownloadLog: vi.fn() }));
    const label = [...container.querySelectorAll("span")].find((el) => /^Generated \(\d+\)$/.test(el.textContent.trim()));
    expect(label, 'no "Generated (N)" label found').not.toBeNull();
    const row = label.parentElement;
    expect(row.style.display).toBe("flex");
    expect(row.style.flexWrap, "the header row cannot wrap, and none of its children may shrink").toBe("wrap");
    // A wrapped row whose lines touch is its own defect; `WRAP_ROW_SX`'s
    // `rowGap: 1` is 8px through MUI's spacing transform, but this is a plain
    // <div> with an inline style, where `rowGap: 1` would serialise to "1px".
    // The value is asserted in px for that reason — do NOT spread
    // WRAP_ROW_SX onto this element.
    expect(row.style.rowGap, "wrapped lines would sit flush against each other").toMatch(/^[1-9]\d*px$/);
  });
});

// ---------------------------------------------------------------------------
// AC-7 / M-2 — no large-viewport `vh` sizing survives in this component.
// ---------------------------------------------------------------------------
describe("StatusBar — viewport-relative heights use the dynamic viewport (M-2)", () => {
  it("declares no bare `vh` height anywhere in the component", () => {
    // Source-level: this is a value StatusBar writes into an inline style, and
    // the defect is the UNIT, which no jsdom render can distinguish (both
    // read back as the literal string). `50vh` on iOS Safari is 406px of a
    // ~635px visible viewport — 64%, not 50%. Once B-2 caps the dock itself
    // the inner cap should go entirely; if any viewport cap remains it must
    // be `dvh` with a `vh` fallback.
    const offenders = SOURCE.split("\n")
      .map((line, i) => ({ line: line.trim(), i: i + 1 }))
      .filter(({ line }) => /\b\d+(?:\.\d+)?vh\b/.test(line) && !/^\/\//.test(line) && !/^\*/.test(line))
      .map(({ line, i }) => `StatusBar.js:${i}  ${line}`);
    expect(offenders, `large-viewport \`vh\` sizing:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("does not hand-roll the touch-target number in JS", () => {
    // GUARD, and a live tripwire for whoever implements B-4:
    // app/theme/mobileSx.test.js's block-4 sweep fails any non-test .js file
    // under app/ that contains the literal `"44px"` or a
    // `min{Width,Height}: { xs: 38..48 }`. The 44px floors B-4 needs must
    // therefore land in app/page.module.css, not in an inline style here.
    expect(SOURCE.includes('"44px"'), 'a literal "44px" here reds app/theme/mobileSx.test.js').toBe(false);
    expect(/min(?:Width|Height):\s*\{\s*xs:\s*(3[89]|4[0-8])\b/.test(SOURCE), "a hand-rolled xs touch floor reds app/theme/mobileSx.test.js").toBe(false);
  });
});
