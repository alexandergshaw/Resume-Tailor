// AC-Q3 - "about N words, roughly S seconds spoken".
//
// The point of this module is that live mode, practice mode and the "Speak as"
// drill must not disagree about what a measured speaking pace is, so the
// thresholds are IMPORTED from answerMetrics.js rather than restated. The
// source-text test at the bottom is what actually pins that: a copy of the
// numbers would satisfy every behavioural assertion here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SLOW_WPM_MAX, RUSHED_WPM_MIN, countWords } from "./answerMetrics.js";
import { spokenEstimate } from "./spokenPace.js";

const SOURCE = readFileSync(new URL("./spokenPace.js", import.meta.url), "utf8");
const EXPECTED_WPM = (SLOW_WPM_MAX + RUSHED_WPM_MIN) / 2;

describe("spokenEstimate", () => {
  it("reports the midpoint of the slow and rushed thresholds as its target pace", () => {
    expect(spokenEstimate("a b c").wpm).toBe(EXPECTED_WPM);
  });

  it("counts words the way the rest of the copilot does", () => {
    const text = "We missed the date, and here is the plan to recover it.";
    expect(spokenEstimate(text).words).toBe(countWords(text));
  });

  it("converts words to seconds at that pace", () => {
    const words = 140;
    const text = Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
    const got = spokenEstimate(text);
    expect(got.words).toBe(words);
    expect(got.seconds).toBe(Math.round((words / EXPECTED_WPM) * 60));
    // Sanity, in the units a reader cares about: 140 words at a measured pace
    // is about a minute, not six seconds and not ten minutes.
    expect(got.seconds).toBeGreaterThan(30);
    expect(got.seconds).toBeLessThan(120);
  });

  it("accepts an array of strings and an array of {text} lines", () => {
    const lines = ["We missed the date.", "Here is the recovery plan."];
    const joined = lines.join(" ");
    expect(spokenEstimate(lines).words).toBe(countWords(joined));
    expect(spokenEstimate(lines.map((text) => ({ text }))).words).toBe(countWords(joined));
  });

  it("does not count punctuation standing alone as a spoken word", () => {
    // The drill's answers are WRITTEN text, and this codebase's own house
    // style puts spaced dashes in them ("one person's fault - I own the
    // call"). countWords splits on whitespace, so each of those counts as a
    // word and the panel's "About N words - roughly S seconds" claim comes
    // out 1-2 words long. Nobody says a dash out loud.
    const spoken = "I own the call I made here and I am not going to dress it up";
    const written = "I own the call I made here - and I am not going to dress it up";
    expect(spokenEstimate(written).words).toBe(spokenEstimate(spoken).words);
    expect(spokenEstimate("one - two -- three").words).toBe(3);
  });

  it("returns zeroes rather than throwing on empty or malformed input", () => {
    for (const junk of [undefined, null, "", "   ", [], [null], [{}], 42, {}]) {
      const got = spokenEstimate(junk);
      expect(got.words).toBe(0);
      expect(got.seconds).toBe(0);
      expect(got.wpm).toBe(EXPECTED_WPM);
    }
  });
});

describe("spokenPace - source", () => {
  it("imports the thresholds instead of restating them", () => {
    expect(SOURCE).toMatch(/from\s+["'](\.\/|@\/lib\/copilot\/)answerMetrics(\.js)?["']/);
    expect(SOURCE).toMatch(/SLOW_WPM_MAX/);
    expect(SOURCE).toMatch(/RUSHED_WPM_MIN/);
    // The literal values, and their midpoint, must not appear as numbers here.
    const withoutComments = SOURCE.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/\b110\b/);
    expect(withoutComments).not.toMatch(/\b170\b/);
    expect(withoutComments).not.toMatch(/\b140\b/);
  });

  it("contains no NUL byte", () => {
    expect(readFileSync(new URL("./spokenPace.js", import.meta.url)).indexOf(0)).toBe(-1);
  });
});
