// N161 SC-1 / AC-1 — the coding-challenge detector, both directions, on a
// FIXED held-out corpus. Authored at step 4b and landed RED: the module under
// test does not exist on HEAD, so this whole file fails at collection
// (`Cannot find module './detectCodingChallenge.js'`). That import failure IS
// the red — reported as INVALID-until-built, not as a pass (loop-traps-tests:
// "a RED test that cannot pass hasn't verified anything either" is answered by
// the discarded reference run recorded in tests.r1.md).
//
// WHAT THE CORPUS IS FOR (AC-1). A coding challenge is an instruction to
// PRODUCE a concrete solution/algorithm/code; a conceptual technical question
// never is. The negatives are chosen so the detector cannot be a thin alias of
// `classifyQuestionType(q) === "technical"`: "hash map", "HTTPS" and "code
// review" all classify `technical` (questionType.js TECHNICAL_RE matches
// hash/http/code) yet are NOT coding challenges, so an alias-to-technical
// mutant reddens on exactly those three. "CAP theorem" / "why this role"
// classify `general` and are kept as the ordinary negatives. A constant-true
// or constant-false detector dies because both directions are asserted.
//
// SCOPE: this is the pure, node-decidable half. Real-world RECALL on live
// machine-transcribed speech is OUT of scope (owner/runtime) — the fixed
// corpus is the oracle, and the token lists are extendable by a later seat,
// never shrinkable, with the production-verb-AND-artifact invariant preserved.

import { describe, it, expect } from "vitest";
import { detectCodingChallenge } from "./detectCodingChallenge.js";
import { classifyQuestionType } from "./questionType.js";

// Real coding asks — each MUST detect. Kept as a named list so the mutation
// "constant false" reddens here and the alias-to-technical mutant is measured
// against the same inputs.
const POSITIVES = [
  "Write a function to reverse a linked list.",
  "Implement binary search.",
  "Given an array of integers, return the two indices that sum to the target.",
  "Code a function that checks if a string is a palindrome.",
  "Give pseudocode for a breadth-first search.",
  "FizzBuzz from 1 to 100.",
  "Write a SQL query that returns the top 3 earners per department.",
];

// The alias-to-`technical` TEETH: these classify `technical` (hash / code) but
// are conceptual, not production asks. A detector that is any form of
// `classifyQuestionType(q) === "technical"` returns true here — so this list
// is what kills that mutant.
//
// CORRECTION to the AC-1 corpus annotation (measured 2026-10-11, recorded in
// tests.r1.md): "Walk me through how HTTPS works." was listed as a third
// alias-to-technical negative "via http". It is NOT — questionType.js's
// TECHNICAL_RE has `http` inside a `\b(...)\b` group, so the trailing `\b`
// cannot match between the P and S of "HTTPS", and the question classifies
// `general`, not `technical`. It is still a correct NEGATIVE (the detector must
// not fire on it), just not alias-bait, so it moves to GENERAL_NEGATIVES below.
// hash map + code review are the two genuine alias-bait items, and two are
// enough to kill the alias-to-technical mutant.
const TECHNICAL_NEGATIVES = [
  "What is a hash map and when would you use one?",
  "How do you approach code review?",
];

// Ordinary negatives — behavioral and conceptual-general, none of which the
// detector may fire on. "CAP theorem" and "why this role" carry no TECHNICAL_RE
// token; "HTTPS works" carries one but classifies general (see correction note).
const GENERAL_NEGATIVES = [
  "Walk me through how HTTPS works.",
  "Tell me about a time you failed.",
  "Describe a conflict with a coworker.",
  "Explain the CAP theorem.",
  "Why do you want this role?",
  // The frozen-prompt fixture question — non-coding, and AC-2's byte-identity
  // guarantee depends on this staying false.
  "Tell me about yourself.",
];

describe("detectCodingChallenge — positive corpus (AC-1)", () => {
  it.each(POSITIVES)("detects a real coding ask: %s", (question) => {
    expect(detectCodingChallenge(question)).toBe(true);
  });
});

describe("detectCodingChallenge — negative corpus (AC-1)", () => {
  it.each([...TECHNICAL_NEGATIVES, ...GENERAL_NEGATIVES])("does NOT detect: %s", (question) => {
    expect(detectCodingChallenge(question)).toBe(false);
  });
});

describe("detectCodingChallenge — narrower than classifyQuestionType's `technical` (AC-1 / D2)", () => {
  it("the alias-bait negatives really do classify `technical` — the alias-mutant's bait", () => {
    // This is the control that makes the alias-to-technical mutation a FAITHFUL
    // one: if these ever stopped classifying `technical`, aliasing the detector
    // to `=== "technical"` would no longer fire here and the mutation would be
    // testing something easier than the named property. Pin the bait.
    for (const q of TECHNICAL_NEGATIVES) {
      expect(classifyQuestionType(q)).toBe("technical");
    }
  });

  it("is strictly narrower: at least one `technical`-classified question is NOT a coding challenge", () => {
    // The structural claim D2 settles. If detect ever equals
    // classifyQuestionType==="technical", this (and the negative corpus) red.
    const narrowerSomewhere = TECHNICAL_NEGATIVES.some(
      (q) => classifyQuestionType(q) === "technical" && detectCodingChallenge(q) === false,
    );
    expect(narrowerSomewhere).toBe(true);
  });
});

describe("detectCodingChallenge — total and never throws (contract)", () => {
  it.each([undefined, null, 0, {}, [], 42])("returns a boolean for non-string input %s", (value) => {
    // Same discipline as classifyQuestionType: stringify + guard, never throw.
    expect(typeof detectCodingChallenge(value)).toBe("boolean");
  });

  it("a trivial constant detector cannot satisfy both directions — the discrimination control", () => {
    // Not an assertion about production; an assertion about THIS suite's power.
    // If every positive and every negative agreed on one value, a constant
    // detector would pass. They must not.
    const pos = POSITIVES.map((q) => detectCodingChallenge(q));
    const neg = [...TECHNICAL_NEGATIVES, ...GENERAL_NEGATIVES].map((q) => detectCodingChallenge(q));
    expect(pos.every((v) => v === true)).toBe(true);
    expect(neg.every((v) => v === false)).toBe(true);
  });
});
