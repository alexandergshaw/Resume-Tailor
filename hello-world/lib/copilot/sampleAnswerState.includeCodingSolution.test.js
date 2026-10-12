import { describe, it, expect } from "vitest";
import { emptySampleAnswer, needsRedraft, cachedSampleAnswerFor } from "./sampleAnswerState.js";

// N162 Wave A AC-N162-5/AC-N162-21 — the coding toggle is threaded through the
// pure practice-mode derivations so a cache entry built under one toggle state
// is never reused under the other. Written from the design (§3.2) BEFORE the
// field exists.
//
// Three forced changes, each pinned here:
//   1. emptySampleAnswer() seeds `includeCodingSolution: false` (the OFF
//      default), the way it seeds codeLanguage to AUTO.
//   2. needsRedraft gains `includeCodingSolution` as the SIXTH positional
//      parameter, BEFORE the trailing `force = false`. Appending it AFTER
//      force would shift the argument and turn every reveal into a forced
//      redraft (the AC-C27c lesson, sampleAnswerState.js:158-162).
//   3. cachedSampleAnswerFor gains `includeCodingSolution` as the SEVENTH
//      positional parameter, NOT defaulted — an omitted argument folds to the
//      OFF grounding and is a MISS against an ON entry, the fail-safe
//      direction (the AC-C27/A-15 lesson, sampleAnswerState.js:212-217).
//
// WHY THE needsRedraft CASES PASS force EXPLICITLY. On HEAD the sixth argument
// IS `force`. If a test passed the toggle value as the sixth arg and omitted
// the seventh, HEAD would read the toggle as `force` and return a value that
// happens to agree with the correct build — a green-for-the-wrong-reason. Each
// case below passes force as an explicit LAST argument and chooses toggle
// values so the correct build and HEAD DISAGREE, so the red is real and the
// wrong (toggle-appended-after-force) signature cannot satisfy it either.

const PROFILE = "Senior engineer, dispatch and logistics.";
const TYPE = "technical";
const APP = "app-1";
const LANG = "auto";
const QUESTION = "Code a function that checks if a string is a palindrome.";

describe("emptySampleAnswer seeds the coding toggle to its OFF default", () => {
  it("has includeCodingSolution === false on the empty slot (not undefined)", () => {
    // Pins the inherited default explicitly: the slot carries the OFF value the
    // way it carries codeLanguage: AUTO, so a comparison against it is a real
    // boolean comparison, never undefined-vs-false noise. RED on HEAD (the
    // field is absent, so the slot's value is undefined, not false).
    expect(emptySampleAnswer().includeCodingSolution).toBe(false);
  });
});

describe("needsRedraft treats a toggle flip as a redraft (sixth param, before force)", () => {
  const activeDone = (over = {}) => ({
    status: "done",
    profile: PROFILE,
    interviewType: TYPE,
    applicationId: APP,
    codeLanguage: LANG,
    includeCodingSolution: true,
    ...over,
  });

  it("does NOT redraft when the toggle MATCHES and nothing else changed", () => {
    // active was drafted under ON; the current reveal is also ON; force is an
    // explicit false. Correct build: every field matches -> false (no
    // redraft). HEAD: reads the sixth arg (true) as `force` -> true. The
    // disagreement makes this RED on HEAD for the right reason, and the
    // wrong signature (toggle appended AFTER force) also fails it, because it
    // would read `true` as force.
    expect(needsRedraft(activeDone(), PROFILE, TYPE, APP, LANG, true, false)).toBe(false);
  });

  it("redrafts when the toggle FLIPS and nothing else changed", () => {
    // active drafted under ON; current reveal is OFF (sixth arg false); force
    // explicit false. Correct build: includeCodingSolution differs -> true
    // (redraft). HEAD: sixth arg false read as force -> then status done and
    // all four legacy fields match -> false. Disagreement => RED on HEAD; the
    // flip being invisible to HEAD is exactly the FD-3 hole.
    expect(needsRedraft(activeDone(), PROFILE, TYPE, APP, LANG, false, false)).toBe(true);
  });

  it("still redrafts on a language change regardless of the toggle (existing key survives)", () => {
    // Control: the fifth field keeps working. Correct build: codeLanguage
    // differs -> true. Toggle matches so it is not what forces this.
    expect(needsRedraft(activeDone(), PROFILE, TYPE, APP, "java", true, false)).toBe(true);
  });

  it("honours an explicit force even when the toggle matches", () => {
    // force is the SEVENTH argument now; passing true there must still force a
    // redraft. Guards that force was not displaced by the new field.
    expect(needsRedraft(activeDone(), PROFILE, TYPE, APP, LANG, true, true)).toBe(true);
  });
});

describe("cachedSampleAnswerFor keys on the coding toggle (seventh param, undefaulted)", () => {
  const codingGroundedEntry = (over = {}) => ({
    points: ["Name the constraint first.", "State the complexity."],
    cues: [],
    buzzwords: [],
    anchor: null,
    pageSources: [],
    grounding: null,
    profile: PROFILE,
    interviewType: TYPE,
    applicationId: APP,
    codeLanguage: LANG,
    includeCodingSolution: true,
    ...over,
  });

  it("HITs an ON-drafted entry for an ON reveal and echoes the toggle back", () => {
    // RED on HEAD: HEAD's cachedSampleAnswerFor has no seventh param and the
    // returned slot carries no includeCodingSolution, so the echo assertion
    // fails even though the entry is admitted.
    const hit = cachedSampleAnswerFor(codingGroundedEntry(), QUESTION, PROFILE, TYPE, APP, LANG, true);
    expect(hit).toBeTruthy();
    expect(hit.includeCodingSolution).toBe(true);
  });

  it("MISSES an ON-drafted entry for an OFF reveal (cross-toggle refusal, FD-3)", () => {
    // RED on HEAD: the toggle is invisible to the grounding comparison, so the
    // ON entry is served to an OFF reveal.
    expect(cachedSampleAnswerFor(codingGroundedEntry(), QUESTION, PROFILE, TYPE, APP, LANG, false)).toBe(null);
  });

  it("MISSES an ON-drafted entry when the seventh argument is OMITTED (undefaulted -> OFF grounding)", () => {
    // The fail-safe direction: a caller that forgot the toggle folds to the
    // OFF grounding and MISSES an ON entry, never a false hit. RED on HEAD for
    // the same cross-toggle reason; also pins that the param is NOT defaulted
    // to a value that would HIT the ON entry.
    expect(cachedSampleAnswerFor(codingGroundedEntry(), QUESTION, PROFILE, TYPE, APP, LANG)).toBe(null);
  });

  it("HITs an OFF-drafted entry for an OFF reveal and round-trips its points (regression guard, GREEN on HEAD)", () => {
    // The ordinary OFF path keeps hitting exactly as today — this is the pure
    // control (truthy + points round-trip), GREEN on HEAD and after, against a
    // build that turns every reveal into a miss. (The slot's echoed toggle is
    // pinned by the ON case above; asserting it here would make this a new RED
    // rather than the green control it exists to be.)
    const offEntry = codingGroundedEntry({ includeCodingSolution: false });
    const hit = cachedSampleAnswerFor(offEntry, QUESTION, PROFILE, TYPE, APP, LANG, false);
    expect(hit).toBeTruthy();
    expect(hit.points).toEqual(["Name the constraint first.", "State the complexity."]);
  });

  it("echoes includeCodingSolution === false back on an OFF hit", () => {
    // RED on HEAD (the returned slot carries no includeCodingSolution, so it
    // reads undefined). Pins that the slot carries the toggle even when OFF,
    // so a downstream read of the slot never falls through to undefined.
    const offEntry = codingGroundedEntry({ includeCodingSolution: false });
    const hit = cachedSampleAnswerFor(offEntry, QUESTION, PROFILE, TYPE, APP, LANG, false);
    expect(hit.includeCodingSolution).toBe(false);
  });
});
