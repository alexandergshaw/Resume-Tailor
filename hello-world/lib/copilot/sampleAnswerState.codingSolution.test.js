// N161 SC-2 (step 4b) — the practice cache's half of AC-8, as a pure test of
// sampleAnswerState.js. Written BEFORE SC-2's implementation exists; the
// coding-carrying cases fail against today's module.
//
// THE LOAD-BEARING FACT this file pins, and the one the structural design
// (N161.arch.r1.md §3.4) did NOT account for: a DETECTED coding answer carries
// NO spoken `points` — the worked solution REPLACES them (SC-1 contract /
// AC-11). So the cache ENTRY the hook writes for a coding answer has
// `points: []` and a `codingSolution` instead. But the ONE cache-admission
// gate every reveal funnels through — answerGrounding.js:114
// `if (points.length === 0) return null;`, reached by cachedSampleAnswerFor via
// cachedAnswerFor — REJECTS an entry with no usable points. So "carry the field
// through, exactly like pageSources" (the arch's instruction) is NOT sufficient:
// pageSources rides an entry that also has points, so the entry is a HIT; a
// coding entry has no points, so it is a MISS, and a reveal -> hide -> reveal of
// it refetches instead of replaying. AC-8 ("survives a reveal->hide->reveal of a
// cache HIT") therefore cannot hold until that gate is relaxed to admit an entry
// whose points are empty BUT which carries a codingSolution / codingFallback.
// This file pins that admission as an observable contract of
// cachedSampleAnswerFor, leaving the implementer free to relax it wherever is
// cleanest (the shared cachedAnswerFor, or a coding-aware branch inside
// cachedSampleAnswerFor itself).
//
// Mirrors sampleAnswerState.pageSources.test.js next door — same helper shape,
// same positive controls, same grounding-outranks case.

import { describe, it, expect } from "vitest";
import { emptySampleAnswer, cachedSampleAnswerFor, needsRedraft } from "./sampleAnswerState.js";

const PROFILE = "Senior engineer, dispatch and logistics.";
const TYPE = "technical";
const APP = "app-1";
const LANG = "auto";
const QUESTION = "Code a function that checks if a string is a palindrome.";

const CODING = {
  approach: "Two pointers from both ends of the string.",
  language: "Python",
  // Newlines, indentation and a first-person comment deliberately present —
  // the carried value must be the SAME object, untouched.
  code: "def is_pal(s):\n    i, j = 0, len(s) - 1\n    # I keep two pointers\n    while i < j:\n        if s[i] != s[j]:\n            return False\n        i, j = i + 1, j - 1\n    return True",
  complexity: "O(n) time, O(1) space.",
  edgeCases: ["Empty string", "Single character"],
};

const CODING_OTHER = {
  approach: "Reverse and compare.",
  language: "JavaScript",
  code: "const isPal = s => s === [...s].reverse().join('');",
  complexity: "O(n) time, O(n) space.",
  edgeCases: [],
};

// A coding entry: the shape the practice hook's cache write produces for a
// detected coding answer — NO usable points, a codingSolution instead.
function codingEntry(extra = {}) {
  return {
    points: [],
    cues: [],
    buzzwords: [],
    anchor: null,
    pageSources: [],
    grounding: null,
    codingSolution: CODING,
    profile: PROFILE,
    interviewType: TYPE,
    applicationId: APP,
    codeLanguage: LANG,
    ...extra,
  };
}

describe("emptySampleAnswer carries no coding solution until one is drafted", () => {
  it("has no codingSolution and no codingFallback on the empty slot (absent, not an empty object)", () => {
    // Regression guard (green on HEAD): absent is what a non-coding draft must
    // keep, so a coding field never appears beside an ordinary answer. The
    // teeth for "the field is CARRIED" live in the cache cases below.
    expect(emptySampleAnswer().codingSolution).toBeUndefined();
    expect(emptySampleAnswer().codingFallback).toBeUndefined();
  });
});

describe("cachedSampleAnswerFor admits a coding entry and carries the solution (AC-8 practice)", () => {
  it("returns a HIT for a coding entry whose points are empty but which carries a codingSolution", () => {
    // RED on HEAD: the entry has no usable points, so cachedAnswerFor's
    // `points.length === 0` gate rejects it and this returns null — a reveal
    // would refetch. The worked solution REPLACES points, so admission must
    // not depend on points when a codingSolution is present.
    const hit = cachedSampleAnswerFor(codingEntry(), QUESTION, PROFILE, TYPE, APP, LANG);
    expect(hit).toBeTruthy();
    // The SAME object, byte-for-byte — never re-derived, never passed through
    // any answer transform.
    expect(hit.codingSolution).toBe(CODING);
  });

  it("carries an embedded codingFallback marker back out of the cache too (AC-10 via the cache)", () => {
    // RED on HEAD: same empty-points rejection. The embedded engine's honest
    // marker rides the entry and must replay on a reveal just like the AI
    // engine's codingSolution does.
    const entry = codingEntry({ codingSolution: undefined, codingFallback: "Switch to the AI engine for a worked solution." });
    const hit = cachedSampleAnswerFor(entry, QUESTION, PROFILE, TYPE, APP, LANG);
    expect(hit).toBeTruthy();
    expect(hit.codingFallback).toBe("Switch to the AI engine for a worked solution.");
  });

  it("still hits an ordinary (points-bearing) entry and carries no coding fields — the positive control", () => {
    // A non-coding entry must keep hitting exactly as today, and must NOT
    // sprout a coding field. If the whole cache read broke, this reds too, so
    // the coding cases above cannot pass by having disabled the ordinary path.
    const hit = cachedSampleAnswerFor(
      { points: ["Name the constraint first."], profile: PROFILE, interviewType: TYPE, applicationId: APP, codeLanguage: LANG },
      QUESTION,
      PROFILE,
      TYPE,
      APP,
      LANG,
    );
    expect(hit).toBeTruthy();
    expect(hit.points).toEqual(["Name the constraint first."]);
    expect(hit.codingSolution).toBeUndefined();
  });
});

describe("the coding solution is an OUTPUT on the entry, never a cache KEY (AC-8 / M2)", () => {
  it("hits regardless of WHICH codingSolution the entry carries — the field is not compared", () => {
    // The forbidden change this reds against: adding codingSolution to
    // groundingFor / the sameGrounding comparison. The query below passes no
    // coding field; if the entry's own codingSolution joined the key it would
    // never match the query's (absent) one, and both of these would miss.
    expect(cachedSampleAnswerFor(codingEntry({ codingSolution: CODING }), QUESTION, PROFILE, TYPE, APP, LANG)).toBeTruthy();
    expect(cachedSampleAnswerFor(codingEntry({ codingSolution: CODING_OTHER }), QUESTION, PROFILE, TYPE, APP, LANG)).toBeTruthy();
  });

  it("a language change is STILL a miss for a coding entry — the existing codeLanguage key survives (AC-8)", () => {
    // AC-8 is explicit: the coding field does NOT join the input comparison,
    // and a language-change redraft is ALREADY forced by the existing
    // codeLanguage key. Pinned here against a coding entry so the gate
    // relaxation above cannot be implemented as "a coding entry always hits".
    const hit = cachedSampleAnswerFor(codingEntry(), QUESTION, PROFILE, TYPE, APP, "java");
    expect(hit).toBe(null);
  });

  it("grounding still OUTRANKS the coding field — a mismatched profile refuses the whole entry", () => {
    // Green on HEAD vacuously (no points short-circuits before the grounding
    // check); non-vacuous once the gate admits coding entries — then the
    // grounding check is the thing that must still refuse this. The coding
    // field must never be what makes a stale entry look usable.
    expect(cachedSampleAnswerFor(codingEntry(), QUESTION, "a different profile", TYPE, APP, LANG)).toBe(null);
  });
});

describe("needsRedraft ignores the coding field entirely (AC-8 / M2)", () => {
  // needsRedraft is the sibling comparison that gates a reveal before the
  // cache is even consulted; sampleAnswerState.js keeps it deliberately
  // independent of cachedSampleAnswerFor. Both must ignore codingSolution.
  const active = {
    status: "done",
    profile: PROFILE,
    interviewType: TYPE,
    applicationId: APP,
    codeLanguage: LANG,
    codingSolution: CODING,
  };

  it("does not redraft when only the coding field would differ (green on HEAD — guard that it stays so)", () => {
    expect(needsRedraft(active, PROFILE, TYPE, APP, LANG)).toBe(false);
    expect(needsRedraft({ ...active, codingSolution: CODING_OTHER }, PROFILE, TYPE, APP, LANG)).toBe(false);
  });

  it("still redrafts when the language differs — the existing key is untouched (the positive control)", () => {
    expect(needsRedraft(active, PROFILE, TYPE, APP, "java")).toBe(true);
  });
});
