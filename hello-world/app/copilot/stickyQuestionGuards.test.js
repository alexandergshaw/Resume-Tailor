// ARCH-sticky v8 — guards G-2, G-3, G-4 and G-5 for the sticky question
// strip (the slice: "the question is always visible wherever I am on the
// page"). These are written BEFORE the feature and are expected to be RED
// until waves A-C land; each one names the specific silent failure it
// exists to stop.
//
// WHAT IS NOT ASSERTED HERE, AND WHY
// ----------------------------------
// jsdom has no layout engine: `getBoundingClientRect()` returns zeroes,
// `max()`/`calc()`/`dvh` are never resolved, `@media (max-height:)` never
// evaluates, and nothing is ever painted. So every GEOMETRIC claim the
// design makes is a MANUAL BROWSER CHECK and is deliberately absent below:
//
//   * that `calc(64px + 4.25rem)` actually clears the panel's chrome plus
//     one full question line (the design's measured margin is +3.56px at
//     root 16 / +3.59px at root 32 — the smallest measured cap-minus-
//     requirement over the hosted grid is +5.56px, at 215x466 root 24);
//   * that the hosting predicate flips where it is calculated to flip
//     (avail = 240 / 297 / 354 px at root 16 / 24 / 32);
//   * that the strip never occludes AppHeader, LiveHearingStrip,
//     SessionSetup or PracticeControls;
//   * that the capped box scrolls rather than clipping.
//
// What IS assertable in jsdom, and is asserted below: declared style
// VALUES (G-5 reads the object `band()` returns, before any engine sees
// it), and source-level facts about files whose defect mode is silence
// (G-2, G-3, G-4).

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function sourceOf(relative) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  // Reported as a normal assertion failure rather than an ENOENT stack, so
  // a missing module reads as "the guard's subject does not exist yet".
  expect(existsSync(path), `${relative} does not exist`).toBe(true);
  return readFileSync(path, "utf8");
}

// The exact string the design's cap mechanism must emit for the shortest
// height band. Written out here rather than rebuilt from the constants on
// purpose: a guard that recomputes the value it is checking cannot catch a
// change to the computation.
const BAND_519_DVH = "max(calc(64px + 4.25rem), calc((100dvh - var(--sticky-top, 0px)) * 0.45))";
const BAND_519_VH = "max(calc(64px + 4.25rem), calc((100vh - var(--sticky-top, 0px)) * 0.45))";
const BAND_699_DVH = "max(calc(64px + 4.25rem), calc((100dvh - var(--sticky-top, 0px)) * 0.38))";
const BAND_BASE_DVH = "max(calc(64px + 4.25rem), calc((100dvh - var(--sticky-top, 0px)) * 0.30))";

describe("G-2: the relocated question panel carries no live region", () => {
  // This is what LICENSES the conditional mount. The strip is mounted only
  // once a question exists (live: `questions.length > 0 || held`; practice:
  // `dashboardQuestions.length > 0`), so it mounts ALREADY CARRYING its
  // final text. A live region that arrives in the DOM with its content
  // already in place announces nothing -- the failure is silent, and it is
  // silent specifically for the screen-reader user. The two live regions
  // the copilot page owns (CurrentAnswerPanel's and SpeakerBar's) do not
  // move and are not in scope here.
  const files = ["./dashboard/CurrentQuestionPanel.js", "./dashboard/panelShells.js"];

  for (const rel of files) {
    it(`${rel} declares no aria-live, role=status/alert or visuallyHidden`, () => {
      const src = sourceOf(rel);
      expect(src).not.toMatch(/aria-live/);
      expect(src).not.toMatch(/role\s*=\s*[{"']?["']?(status|alert|log)\b/);
      expect(src).not.toMatch(/visuallyHidden/);
    });
  }
});

describe("G-3: AppHeader carries the hook's query attribute", () => {
  it("declares data-app-header exactly once on the <header>", () => {
    // useStickyTop measures the pinned header through
    // document.querySelector("[data-app-header]"). Delete the attribute and
    // the query returns null forever, so stickyTop stays null, so the strip
    // renders `position: static` -- the feature does NOTHING, with no error,
    // no warning and no visual breakage anyone would report. A tag-name
    // query would be worse still: it binds to whatever <header> happens to
    // be first in the document.
    const src = sourceOf("../components/AppHeader.js");
    const hits = src.match(/data-app-header/g) || [];
    expect(hits).toHaveLength(1);

    // On the <header> element itself, not on some inner <span>: the height
    // that is measured has to be the height that is pinned.
    const headerIdx = src.indexOf("<header");
    const headerTagEnd = src.indexOf(">", src.indexOf("style=", headerIdx));
    expect(headerIdx).toBeGreaterThan(-1);
    expect(src.indexOf("data-app-header")).toBeGreaterThan(headerIdx);
    expect(src.indexOf("data-app-header")).toBeLessThan(headerTagEnd);
  });
});

describe("G-4: the floor's only content assumption -- the title is two words and cannot break", () => {
  // The cap's floor, calc(64px + 4.25rem), budgets exactly TWO title lines
  // above the question's first line. Two things could make three: a third
  // word in the title, or a title that is allowed to break mid-word. The
  // design's sweep found a maximum of 2 title lines over all 630 probes and
  // showed that "Current question here" -- three words -- forces 3 at 160
  // CSS px / root 32. Neither fact is visible to any other test.
  it("both copy constants' currentQuestionTitle is exactly two whitespace-separated words", () => {
    const src = sourceOf("../../lib/copilot/dashboardCopy.js");
    const titles = [...src.matchAll(/currentQuestionTitle:\s*"([^"]*)"/g)].map((m) => m[1]);
    // LIVE_COPY declares it; PRACTICE_COPY inherits it through the spread
    // and may or may not re-declare it. Whatever is declared must hold.
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      // NIT-3: "at most one space" also admits a zero-space CJK title,
      // which breaks at any character and is not bounded at two lines.
      // `/^\S+ \S+$/` says what is actually meant.
      expect(title, `currentQuestionTitle ${JSON.stringify(title)} is not two words`).toMatch(/^\S+ \S+$/);
    }
  });

  it("panelShells.js does not put a word-breaking sx on any title Typography", () => {
    // BREAK_LONG_WORDS_SX lives on the QUESTION line, never on the title.
    // With it on the title, "question" -- the longest word -- would break
    // instead of overflowing, and a narrow panel could then take three
    // title lines inside a floor that budgets two.
    const src = sourceOf("./dashboard/panelShells.js");
    const chunks = src.split("<Typography").slice(1);
    const titleChunks = chunks.filter((chunk) => {
      const body = chunk.slice(0, chunk.indexOf("</Typography>") + 1);
      return /\{\s*title\s*\}/.test(body);
    });
    // If this is 0 the guard has stopped guarding anything -- the titles
    // were renamed or moved and nobody updated this file.
    expect(titleChunks.length).toBeGreaterThan(0);
    for (const chunk of titleChunks) {
      const attributes = chunk.slice(0, chunk.indexOf(">"));
      expect(attributes).not.toMatch(/BREAK_LONG_WORDS_SX/);
      expect(attributes).not.toMatch(/wordBreak|overflowWrap|word-break|overflow-wrap/);
    }
  });
});

describe("G-5: the cap and the hosting predicate cannot drift apart", () => {
  // The floor, the bands, the gutter and the max share are read TWICE --
  // once by the CSS the strip declares (band()) and once by the JS hosting
  // predicate. Two copies of 4.25 is exactly the rot that produces a cap
  // and a predicate that disagree, and the disagreement is invisible: the
  // strip would simply be sticky on a viewport it does not fit, or static
  // on one it does.
  it("band() emits the exact 519 / 699 / base strings, in cascade order, for both units", async () => {
    const mod = await import("./useStickyTop.js");
    expect(typeof mod.band).toBe("function");

    const dvh = mod.band("dvh");
    // Source order matters: MUI/emotion emit these in object order, so 699
    // must be declared before 519 for the shorter band to win.
    expect(Object.keys(dvh)).toEqual([
      "maxHeight",
      "@media (max-height: 699px)",
      "@media (max-height: 519px)",
    ]);
    expect(dvh.maxHeight).toBe(BAND_BASE_DVH);
    expect(dvh["@media (max-height: 699px)"].maxHeight).toBe(BAND_699_DVH);
    expect(dvh["@media (max-height: 519px)"].maxHeight).toBe(BAND_519_DVH);

    // The `vh` form is the one that actually ships outside the @supports
    // block, so it is pinned too -- a max() that collapsed to the floor
    // where dvh is unsupported would silently cap every tall viewport at
    // 132px.
    expect(mod.band("vh")["@media (max-height: 519px)"].maxHeight).toBe(BAND_519_VH);
  });

  it("keeps the five cap constants module-local, and the predicate reads the same literals", () => {
    const src = sourceOf("./useStickyTop.js");

    // MAJOR-2: exporting STRIP_FLOOR_PX / STRIP_FLOOR_REM /
    // STRIP_GUTTER_PX / STRIP_BANDS / STRIP_MAX_SHARE would mint five
    // exports whose only outside consumer is this test, which is
    // `unused-export` + `importedByATest` and moves
    // exportReachability.sweep.test.js:476 (303) and :491 (359) -- the two
    // numbers §7 says are never a number to bump. That file records the
    // precedent itself at :486-490 (MAX_ACTIVITY_FIELD_CHARS and
    // truncateField "were caught by this very assertion on their first run
    // and un-exported, because both are applied inside that module and read
    // nowhere else"). Same ruling here: internal use does not rescue an
    // export, so the constants stay module-local and this guard asserts on
    // what actually ships -- band()'s emitted strings above, plus the
    // single-source-of-truth property below.
    for (const name of [
      "STRIP_FLOOR_PX",
      "STRIP_FLOOR_REM",
      "STRIP_GUTTER_PX",
      "STRIP_BANDS",
      "STRIP_MAX_SHARE",
    ]) {
      expect(src, `${name} must not be exported`).not.toMatch(
        new RegExp(`export\\s+(const|let|function)\\s+${name}\\b`),
      );
      expect(src, `${name} must not be re-exported`).not.toMatch(
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`),
      );
      // …but it must exist, exactly once, as a module-local const. A guard
      // that only forbids an export passes trivially against a file that
      // deleted the constant and inlined the number twice.
      const declarations = src.match(new RegExp(`\\bconst\\s+${name}\\b`, "g")) || [];
      expect(declarations, `${name} must be declared exactly once`).toHaveLength(1);
    }

    // Each magic number appears exactly once in the file: in its constant.
    // A second literal 4.25 (or 64, or 0.60) is the drift this guard exists
    // to make impossible.
    expect(src.match(/\b4\.25\b/g) || []).toHaveLength(1);
    expect(src.match(/\b0\.60\b/g) || []).toHaveLength(1);

    // And the predicate is written in terms of the constants, not in terms
    // of numbers that happen to match them today.
    const predicate = src.slice(src.indexOf("STRIP_MAX_SHARE"));
    for (const name of ["STRIP_FLOOR_PX", "STRIP_FLOOR_REM", "STRIP_GUTTER_PX", "STRIP_MAX_SHARE"]) {
      expect(predicate, `the hosting predicate must read ${name}`).toContain(name);
    }

    // MAJOR-1: the predicate reads the LARGE viewport
    // (document.documentElement.clientHeight), never window.innerHeight.
    // innerHeight is the DYNAMIC viewport: it moves 50-100 CSS px as a
    // phone's URL bar collapses and expands DURING A SCROLL, and the
    // predicate is a hard step with no hysteresis, so a hosted
    // configuration sitting near the threshold (landscape iPhone at root
    // 24 sits 17.3px from it) would turn its own stickiness on and off
    // mid-gesture -- swapping a 178px pinned box for a 663.56px static one
    // with nothing preserving scroll position. clientHeight is also what
    // the CSS `@media (max-height:)` bands evaluate against, so this makes
    // the JS and the CSS agree by construction rather than by argument.
    expect(src).not.toMatch(/window\.innerHeight/);
    expect(src).toMatch(/document\.documentElement\.clientHeight/);
  });
});
