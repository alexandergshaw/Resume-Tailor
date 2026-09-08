// @vitest-environment jsdom
//
// ARCH-stats-in-strip r3 §2.3/§2.5/§2.6 — AC 14, 22, 23, 24, 31, 32, 34, 35.
// FAILING TESTS, written before `app/copilot/dashboard/StatsRow.js` exists.
// Every `it` below is RED until the component lands.
//
// THE CONTRACT THESE TESTS PIN (§2.3, §4.2):
//
//   <StatsRow pace={pace} fillers={fillers} />
//
// with `pace` / `fillers` the objects computeLivePace / computeLiveFillers
// already return (livePace.js) — the same objects DeliveryPanel is handed
// today. Two lines, one reading per line, `minHeight: calc(4px + 2.51rem)`.
//
// WHAT IS NOT ASSERTED HERE, AND WHY — jsdom HAS NO LAYOUT ENGINE.
// `getBoundingClientRect()` returns zeroes, `calc()`/`rem` are never
// resolved, no line ever wraps and nothing is ever painted. So each of these
// is a MANUAL BROWSER CHECK and is deliberately absent below, because a green
// test over an unobservable property is how a suite comes to defend a bug:
//
//   * AC 12 — that the row's outer height is identical across all four stats
//     states (measured 0/49 differ). Nothing here can see a height.
//   * AC 13 — that the rendered row equals calc(4px + 2.51rem)
//     (44.16/64.24/84.32 px at root 16/24/32). The source assertion below
//     pins the DECLARATION only; that the declaration is the right number is
//     §1.3's harness, not this file.
//   * That one reading per line actually holds at the width bound — jsdom
//     never wraps, so "one reading per line" is asserted here only as DOM
//     STRUCTURE (two sibling elements, one reading each), which is the part
//     that is real in jsdom and the part a flex-row rewrite would break.
//   * §1.5's contrast ratios. 6.308:1 for --text-secondary on --bg-canvas is
//     a measured number; what is checkable here is only WHICH TOKEN is named.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { appendSpeechSample, computeLivePace, computeLiveFillers } from "@/lib/copilot/livePace";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE_PATH = path.join(process.cwd(), "app/copilot/dashboard/StatsRow.js");

// Held in a variable rather than written as a literal so Vite's import
// analysis leaves it to the runtime resolver: a literal `import("./StatsRow.js")`
// fails the whole FILE at transform time while the module is absent, which
// would take the source-level assertions below down with it and report one
// unresolved-import stack instead of eight named reds.
const STATS_ROW_SPECIFIER = "./StatsRow.js";

async function loadStatsRow() {
  // An absent module reads as "the subject does not exist yet" rather than an
  // unresolved-import stack — stickyQuestionGuards.test.js:33-39's pattern.
  expect(existsSync(SOURCE_PATH), "app/copilot/dashboard/StatsRow.js does not exist yet").toBe(true);
  const mod = await import(STATS_ROW_SPECIFIER);
  return mod.default;
}

function sourceOf() {
  expect(existsSync(SOURCE_PATH), "app/copilot/dashboard/StatsRow.js does not exist yet").toBe(true);
  return readFileSync(SOURCE_PATH, "utf8");
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  const StatsRow = await loadStatsRow();
  await act(async () => {
    root.render(createElement(StatsRow, props));
  });
}

// Collapses runs of whitespace, NBSP included (JS `\s` matches U+00A0), so a
// Prettier-driven JSX reflow of the template cannot fail an assertion about
// the WORDS.
function norm(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function text() {
  return norm(container.textContent);
}

function lines() {
  const row = container.firstElementChild;
  return row ? [...row.children].map((el) => norm(el.textContent)) : [];
}

const UNMEASURED_PACE = { wordsPerMinute: null, paceLabel: null, measured: false };
const UNMEASURED_FILLERS = { fillerCount: null, fillerRate: null, fillerLabel: null, measured: false };
const PACE_125 = { wordsPerMinute: 125.4, paceLabel: "conversational", measured: true };
const FILLERS_12_5 = { fillerCount: 6, fillerRate: 12.5, fillerLabel: "heavy", measured: true };

describe("StatsRow: the reservation and the one-reading-per-line shape (AC 14, §1.3)", () => {
  it("declares minHeight: calc(4px + 2.51rem) and never a fixed `height`", () => {
    // §2.3: `minHeight`, not `height`. Above the width bound the content never
    // exceeds the reservation; below it the row is not hosted at all. So the
    // failure mode of a wrong bound is a TALLER STRIP, never a truncated
    // reading — truncation is the AccentPanel "PREDI…" defect
    // (panelShells.js:75-84) and must not be reintroduced. A four-digit wpm
    // (livePace.js:179-184 clamps nothing) is exactly the case this absorbs.
    const src = sourceOf();
    expect(src).toContain("calc(4px + 2.51rem)");
    expect(src).toMatch(/minHeight\s*:/);
    // `minHeight:` / `maxHeight:` / `lineHeight:` are all preceded by a
    // letter; a bare `height:` is not.
    const bare = src.match(/(?<![A-Za-z])height\s*:/g) || [];
    expect(bare, "StatsRow must reserve with minHeight, never height").toHaveLength(0);
  });

  it("puts each reading in its own element — two siblings, never one wrapping row", async () => {
    // This is the property ReadingSlot (CopilotDashboard.js:381-399) was built
    // for and LOSES at strip width: the shipped wrapping-flex form reflows in
    // 126/126 configurations, worst delta 100px. One reading per line plus a
    // constant minHeight restores it structurally. jsdom cannot see the
    // reflow; it CAN see a flex row rewritten back in, which is the mutation.
    await render({ pace: PACE_125, fillers: FILLERS_12_5 });
    const row = container.firstElementChild;
    expect(row).toBeTruthy();
    expect(row.children).toHaveLength(2);
    expect(lines()[0]).toContain("125 wpm");
    expect(lines()[0]).not.toContain("filler");
    expect(lines()[1]).toContain("12.5% filler");
    expect(lines()[1]).not.toContain("wpm");
  });
});

describe("StatsRow: measured readings (AC 35)", () => {
  it("renders the abbreviated pace unit and the threshold WORD", async () => {
    // §2.3's one deliberate divergence: `wpm` in the strip, `words/min` in the
    // dashboard. It is the unit token, not the label, and it is the entire
    // reason the width bound is 10.5rem instead of 12.5 (§1.2 finding 1) —
    // three configurations, two of them common phones at enlarged text, exist
    // because of it. Restoring `words/min` here silently costs them.
    await render({ pace: PACE_125, fillers: FILLERS_12_5 });
    expect(lines()[0]).toBe("125 wpm · Conversational");
    expect(text()).not.toContain("words/min");
  });

  it("keeps the noun `filler` on the filler line for every label", async () => {
    // §1.2 finding 2: the filler line never binds the width, so it does not
    // have to be abbreviated — and `12.5% · Clean` is genuinely ambiguous
    // ("12.5% of what?") in the one label that does not contain the word
    // itself. The threshold word stays, and so does its noun.
    for (const [fillerLabel, word] of [
      ["clean", "Clean"],
      ["noticeable", "Some filler"],
      ["heavy", "Heavy filler"],
    ]) {
      await render({
        pace: UNMEASURED_PACE,
        fillers: { fillerCount: 1, fillerRate: 0.5, fillerLabel, measured: true },
      });
      expect(lines()[1]).toBe(`0.5% filler · ${word}`);
      expect(lines()[1]).toContain("filler");
    }
  });

  it("carries every pace threshold in the WORD, never in colour alone", async () => {
    // §2.5 / WCAG 1.4.1. The strip uses --text-secondary only (§1.5:
    // --warning measures 4.322:1 on --bg-canvas and would be a NEW 1.4.3
    // failure in light mode), so the ONLY carrier of "is this too fast" is the
    // label text against SLOW_WPM_MAX = 110 / RUSHED_WPM_MIN = 170
    // (answerMetrics.js:38-39). If the word goes missing, the reading means
    // nothing to anyone — not only to a user who cannot distinguish the hues.
    for (const [wordsPerMinute, paceLabel, word] of [
      [95, "slow", "Slow"],
      [125, "conversational", "Conversational"],
      [190, "rushed", "Rushed"],
    ]) {
      await render({
        pace: { wordsPerMinute, paceLabel, measured: true },
        fillers: UNMEASURED_FILLERS,
      });
      expect(lines()[0]).toBe(`${wordsPerMinute} wpm · ${word}`);
    }
  });
});

describe("StatsRow: the unmeasured states — never a fabricated zero (§2.6, AC 22-24)", () => {
  it("renders BOTH shipped literals verbatim when neither reading is measured", async () => {
    // The literals are CopilotDashboard.js:446 and :458, reused verbatim.
    // §1.2 finding 3 measured that re-wording them buys nothing: the MEASURED
    // line is always the wider one, so `speed: not measured yet` (10.040 rem)
    // never binds. Re-wording is therefore pure churn against two strings a
    // user has already learned.
    await render({ pace: UNMEASURED_PACE, fillers: UNMEASURED_FILLERS });
    expect(lines()[0]).toBe("speed: not measured yet");
    expect(lines()[1]).toBe("filler: not measured yet");
  });

  it("never prints 0 wpm or 0.0% filler, even when the unmeasured reading carries a zero", async () => {
    // THE MUTATION THIS CATCHES: gating on `pace.wordsPerMinute != null` (or
    // on truthiness of the reading object, which is a constant `true` —
    // §2.6) instead of on `pace.measured`. Both hooks return an object on
    // every path, so the wrong gate produces a plausible, wrong, unflattering
    // reading rather than an error. AC-I2.14: a missing measurement is not a
    // measurement of zero.
    await render({
      pace: { wordsPerMinute: 0, paceLabel: "slow", measured: false },
      fillers: { fillerCount: 0, fillerRate: 0, fillerLabel: "clean", measured: false },
    });
    expect(lines()[0]).toBe("speed: not measured yet");
    expect(lines()[1]).toBe("filler: not measured yet");
    expect(text()).not.toMatch(/\b0 wpm\b/);
    expect(text()).not.toMatch(/0\.0% filler/);
    expect(text()).not.toMatch(/\b0%/);
    expect(text()).not.toContain("Slow");
    expect(text()).not.toContain("Clean");
  });

  it("gates each line on its OWN measured flag — pace measured, filler not", async () => {
    await render({ pace: PACE_125, fillers: UNMEASURED_FILLERS });
    expect(lines()[0]).toBe("125 wpm · Conversational");
    expect(lines()[1]).toBe("filler: not measured yet");
  });

  it("gates each line on its OWN measured flag — filler measured, pace not", async () => {
    // The converse. A COMBINED gate (`pace.measured && fillers.measured`)
    // passes the previous case and erases a real reading here.
    await render({ pace: UNMEASURED_PACE, fillers: FILLERS_12_5 });
    expect(lines()[0]).toBe("speed: not measured yet");
    expect(lines()[1]).toBe("12.5% filler · Heavy filler");
  });

  it("shows the real filler reading for a zero-duration frame (AC 24)", async () => {
    // §2.6, driven from the REAL functions rather than a hand-written fixture:
    // computeLivePace requires spanSec > 0 (livePace.js:179) and
    // computeLiveFillers deliberately does not (:199-208), so a single frame
    // whose start equals its end is genuinely pace-unmeasured and genuinely
    // filler-measured IN THE SAME FRAME. This is the case liveFiller.test.js
    // already fixes at the library level; here it must survive to the screen.
    const samples = appendSpeechSample([], {
      text: "um so I think that this is the answer here now",
      start: 0,
      duration: 0,
    });
    const pace = computeLivePace(samples);
    const fillers = computeLiveFillers(samples);
    expect(pace.measured, "fixture precondition: pace is unmeasured at spanSec <= 0").toBe(false);
    expect(fillers.measured, "fixture precondition: fillers ARE measured at spanSec <= 0").toBe(true);

    await render({ pace, fillers });
    expect(lines()[0]).toBe("speed: not measured yet");
    expect(lines()[1]).toContain(`${fillers.fillerRate.toFixed(1)}% filler`);
  });
});

describe("StatsRow: accessibility and the colour ruling (AC 31, 32, 34)", () => {
  it("announces nothing of its own accord — no live region, no heading element", async () => {
    // §2.4: the row's presence travels with the SESSION, so within a session
    // it mounts once and its text then changes on every tick. A live region
    // here would re-announce a wpm figure every second, over the interviewer.
    // And a heading element would reintroduce exactly the skip
    // copilotHeadingOrder.test.js's G-1 exists to catch — the dashboard's
    // "Your delivery" h4 (CopilotDashboard.js:433) does NOT travel with the row.
    await render({ pace: PACE_125, fillers: FILLERS_12_5 });
    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector('[role="status"],[role="alert"],[role="log"]')).toBeNull();
  });

  it("carries no interpolated aria-label (AC 32)", () => {
    // An aria-label that interpolates a reading re-announces on every change
    // in most screen readers, so it is a live region wearing a disguise — and
    // it passes any "no aria-live" grep, including G-2's. §2.4 allows exactly
    // one label and it is the static literal "Speaking stats".
    const src = sourceOf();
    for (const match of src.match(/aria-label\s*=\s*[^\n]*/g) || []) {
      expect(match, "aria-label must be a static string literal").not.toMatch(/[`]|\$\{/);
    }
  });

  it("names --text-secondary and none of --text-muted / --warning / --success (§1.5)", () => {
    // Measured on the strip's own ground, bgcolor: var(--bg-canvas)
    // (StickyQuestionStrip.js:58) — NOT the dashboard's --bg-soft:
    //   --warning        4.322:1  FAIL      (4.570 on --bg-soft, where it ships)
    //   --success        4.552:1  by 0.05
    //   --text-muted     3.684:1  FAIL      (ReadingSlot's unmeasured copy)
    //   --text-secondary 6.308:1  PASS
    // Reusing DeliveryPanel's PACE_LABEL_COLOR / FILLER_LABEL_COLOR here is
    // the natural thing to do and is a new WCAG 1.4.3 failure in light mode.
    const src = sourceOf();
    expect(src).toContain("--text-secondary");
    expect(src).not.toContain("--text-muted");
    expect(src).not.toContain("--warning");
    expect(src).not.toContain("--success");
    expect(src).not.toContain("PACE_LABEL_COLOR");
    expect(src).not.toContain("FILLER_LABEL_COLOR");
  });
});
