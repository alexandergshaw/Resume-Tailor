// AC-bullet-truncation r10 — AC-S.7, AC-B.1, AC-D.1.
// FAILING TESTS, written before `lib/copilot/pointLength.js` exists.
// Every `it` below is RED until the module lands.
//
// THE CONTRACT THIS FILE PINS:
//
//   lib/copilot/pointLength.js exports
//     pointWordCount(text) -> number
//     standsAlone(point)   -> boolean        (AC-S.7, r10 §5.7.1)
//     MAX_POINT_WORDS, MIN_POINT_WORDS, MIN_TITLE_WORDS,
//     GROUNDED_SPAN_MIN_WORDS, MAX_HEADER_TAIL_WORDS,
//     HEADER_TITLECASE_RATIO, MIN_HEADER_SEGMENTS
//     ANAPHOR_OPENERS, COORDINATOR_OPENERS, FUNCTION_HEADS, FINITE_FORMS
//
// WHY THIS FILE IS THE SPEC'S TEETH. r10 §3.3/§5.7.3 records that the r9
// carrier rewrite `Action: Your steps — e.g. …` REGRESSED 108 of live's 1,976
// lines against this criterion, and that the fix was to change the rewrite to
// `Action: Describe it — e.g. …` rather than to relax the criterion. That pair
// is the discriminator: a `standsAlone` that returns true for everything fails
// the `Your steps` assertion, one that returns false for everything fails the
// `Describe it` assertion, and one that merely looks for a capital and a full
// stop fails both AGG assertions. There is no stub that satisfies this file.
//
// NOT ASSERTED HERE, AND WHY:
//   * `FINITE_FORMS.size`. r10 §5.7.1 annotates the class "(26)" but ENUMERATES
//     only 23 words. The enumeration is authoritative over the parenthetical,
//     so membership is asserted and the count is not. Reported to the owner.
//   * `FUNCTION_HEADS.size`. r10 declares 57 and enumerates none of them, only
//     the four categories. Membership of the words the predicate demonstrably
//     needs is asserted; an exact count over an unenumerated list is not.
//   * Anything about how a bullet READS. AC-S.7 is a structural gate and
//     r10 §5.7.4 says so; this file does not pretend otherwise.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH = path.join(process.cwd(), "lib/copilot/pointLength.js");

// Held in a variable so Vite's import analysis leaves resolution to runtime:
// a literal import of an absent module fails the whole FILE at transform time
// and reports one unresolved-import stack instead of every named red below.
const SPECIFIER = "./pointLength.js";

async function load() {
  expect(existsSync(SOURCE_PATH), "lib/copilot/pointLength.js does not exist yet").toBe(true);
  return import(SPECIFIER);
}

// r10 §5.7.1's two fully enumerated closed classes, verbatim.
const ANAPHORS_19 = [
  "it", "its", "this", "that", "these", "those", "they", "them", "their", "theirs",
  "he", "him", "his", "she", "her", "hers", "such", "one", "ones",
];
const COORDINATORS_8 = ["and", "but", "or", "nor", "so", "yet", "plus", "which"];
const FINITE_ENUMERATED = [
  "am", "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
];

describe("AC-B.1 — pointWordCount", () => {
  it("counts whitespace words, and a lone em dash IS a word (r10 §17)", async () => {
    const { pointWordCount } = await load();
    // r10 §17 states these two explicitly, because every `fixed` figure in
    // §3.3's MOD column depends on the em dash counting.
    expect(pointWordCount("Ground it — e.g.")).toBe(4);
    expect(pointWordCount("Action: Describe it — e.g.")).toBe(5);
    expect(pointWordCount("Anchor it — e.g.")).toBe(4);
  });

  it("is byte-identical to answerPoints.js's private wordCount", async () => {
    const { pointWordCount } = await load();
    for (const s of ["", "   ", "one", " a  b   c ", "a\tb\nc"]) {
      expect(pointWordCount(s)).toBe(String(s || "").trim().split(/\s+/).filter(Boolean).length);
    }
    expect(pointWordCount(null)).toBe(0);
    expect(pointWordCount(undefined)).toBe(0);
  });
});

describe("AC-D.1 — the thresholds live in exactly one place", () => {
  it("declares every gate constant r10 §9 names, at its ruled value", async () => {
    const m = await load();
    expect(m.MAX_POINT_WORDS).toBe(12);
    expect(m.MIN_POINT_WORDS).toBe(2);
    expect(m.MIN_TITLE_WORDS).toBe(2);
    expect(m.GROUNDED_SPAN_MIN_WORDS).toBe(4);
    expect(m.MAX_HEADER_TAIL_WORDS).toBe(2);
    expect(m.HEADER_TITLECASE_RATIO).toBe(0.8);
    expect(m.MIN_HEADER_SEGMENTS).toBe(2);
  });

  it("declares AC-S.7's four closed word classes as membership-testable sets", async () => {
    const m = await load();
    for (const name of ["ANAPHOR_OPENERS", "COORDINATOR_OPENERS", "FUNCTION_HEADS", "FINITE_FORMS"]) {
      expect(typeof m[name]?.has, `${name} must be a Set`).toBe("function");
    }
    // Fully enumerated in r10 §5.7.1, and the declared sizes agree: exact.
    expect([...m.ANAPHOR_OPENERS].sort()).toEqual([...ANAPHORS_19].sort());
    expect([...m.COORDINATOR_OPENERS].sort()).toEqual([...COORDINATORS_8].sort());
    // Enumerated but the parenthetical count disagrees: membership only.
    for (const w of FINITE_ENUMERATED) expect(m.FINITE_FORMS.has(w), `FINITE_FORMS missing ${w}`).toBe(true);
    // Unenumerated: the members the predicate provably needs, and the ones it
    // must NOT have (a content word in FUNCTION_HEADS silently disables the
    // imperative-head escape that S3 leans on).
    for (const w of ["the", "a", "an", "my", "this", "in", "of", "because", "i", "they"]) {
      expect(m.FUNCTION_HEADS.has(w), `FUNCTION_HEADS missing ${w}`).toBe(true);
    }
    for (const w of ["describe", "ground", "anchor", "situation", "ledger", "acme"]) {
      expect(m.FUNCTION_HEADS.has(w), `FUNCTION_HEADS must not contain the content word ${w}`).toBe(false);
    }
  });
});

describe("AC-S.7 — standsAlone, the criterion that encodes the user's fourth constraint", () => {
  // ---------------------------------------------------------------------
  // THE DISCRIMINATOR. r10 §5.7.3: `Your steps` regresses 108 live lines,
  // `Describe it` restores 1,976/1,976, and the two are the SAME 5 fixed
  // words. If a `standsAlone` cannot tell these apart it has no content.
  // ---------------------------------------------------------------------
  it("REJECTS r9's `Your steps` carrier on S3 and ACCEPTS r10's `Describe it`", async () => {
    const { standsAlone } = await load();
    const clause = "led the payments migration and cut deployment time by 40%";
    expect(standsAlone(`Action: Your steps — e.g. ${clause}.`)).toBe(false);
    expect(standsAlone(`Action: Describe it — e.g. ${clause}.`)).toBe(true);
  });

  it("accepts all four of live's MOD carriers (r10 §3.3, measured 1,976/1,976)", async () => {
    const { standsAlone } = await load();
    expect(standsAlone("Action: Describe it — e.g. built and scaled a payments platform.")).toBe(true);
    expect(standsAlone("Ground it — e.g. migrated the monolith to Kubernetes with zero downtime.")).toBe(true);
    expect(standsAlone("Anchor it — e.g. built and scaled a payments platform.")).toBe(true);
    expect(standsAlone("Situation: Open with where and when — Acme Payments, Senior Engineer.")).toBe(true);
  });

  it("REJECTS both AGG arms — the two failures that rule AGG out (r10 §3.3, §11)", async () => {
    const { standsAlone } = await load();
    // S3: a label plus two nouns is not a complete thought.
    expect(standsAlone("Situation: Acme Payments, Senior Engineer.")).toBe(false);
    // S1: lowercase after label-stripping. This is AC-N.2's rule, subsumed.
    expect(standsAlone("Action: e.g. led the payments migration and cut deployment time by 40%.")).toBe(false);
  });

  it("REJECTS producer 7's bare proper-noun Situation beat on S3 (r10 §4.2, §12.6)", async () => {
    const { standsAlone } = await load();
    expect(standsAlone("Situation: Ledger Rebuild.")).toBe(false);
    expect(standsAlone("Situation: API.")).toBe(false);
  });

  describe("S1 CLOSED — capital in, terminal punctuation out, over the LABEL-STRIPPED body", () => {
    it("rejects a body that opens lowercase even though the raw point opens on a capital", async () => {
      const { standsAlone } = await load();
      expect(standsAlone("Result: built and scaled a payments platform.")).toBe(false);
      expect(standsAlone("Built and scaled a payments platform.")).toBe(true);
    });

    it("rejects a body with no terminal punctuation, and allows a closing quote or bracket", async () => {
      const { standsAlone } = await load();
      expect(standsAlone("Action: I shipped the migration")).toBe(false);
      expect(standsAlone("Action: I shipped the migration.")).toBe(true);
      expect(standsAlone('Action: I shipped the migration."')).toBe(true);
      expect(standsAlone("Action: Did I ship the migration?")).toBe(true);
    });
  });

  describe("S2 UNCHAINED — first token only", () => {
    it("rejects a clause-initial coordinator (a fragment of the bullet above)", async () => {
      const { standsAlone } = await load();
      expect(standsAlone("And I'd want to talk through the specifics with you rather than speak in generalities.")).toBe(false);
      expect(standsAlone("And it's why I'm genuinely excited about this opportunity.")).toBe(false);
      expect(standsAlone("And that's the background I'd bring to this specific role.")).toBe(false);
    });

    it("rejects a clause-initial pro-form, INCLUDING one wearing a contraction", async () => {
      const { standsAlone } = await load();
      // r10 §5.7.2's largest failing class — 102 points on one carrier.
      expect(standsAlone("That's close to work I've actually done — built and scaled a payments platform.")).toBe(false);
      expect(standsAlone("It's the thing I'm proudest of.")).toBe(false);
      expect(standsAlone("They were the team I built.")).toBe(false);
    });

    it("PERMITS a discourse adverb — it orders a sentence that is already complete", async () => {
      const { standsAlone } = await load();
      // r10 §5.7.1 calls this out by name. A rule that rejects it is
      // over-fitted to the failing strings rather than to the criterion.
      expect(standsAlone("Finally, I'd say how I'd test it and handle the edge cases before calling it done.")).toBe(true);
    });

    it("PERMITS an interior anaphor — the rule is first-token-only, deliberately", async () => {
      const { standsAlone } = await load();
      // r10 §5.7.4 (i) records this as the rule's admitted permissiveness.
      // Asserting it keeps a future tightening from silently failing live's
      // three MOD carriers, which all lean on exactly this `it`.
      expect(standsAlone("Ground it — e.g. built and scaled a payments platform.")).toBe(true);
      expect(standsAlone("I owned it end to end.")).toBe(true);
    });
  });

  describe("S3 PREDICATED — five independent ways to find a verb", () => {
    it("finds a verb by morphology, by finite form, by ACHIEVEMENT_VERBS, and by contraction", async () => {
      const { standsAlone } = await load();
      expect(standsAlone("Result: Deployment time dropped by 40%.")).toBe(true); // (a) -ed
      expect(standsAlone("Result: Deployment time is down 40%.")).toBe(true); // (b) finite
      expect(standsAlone("Result: My team shipped it.")).toBe(true); // (c) ACHIEVEMENT_VERBS
      expect(standsAlone("Result: Here's the outcome I'd point to.")).toBe(true); // (d) contraction
    });

    it("accepts an imperative head — capitalised, not a function word, with a lowercase token after", async () => {
      const { standsAlone } = await load();
      expect(standsAlone("Task: Name the goal you personally owned.")).toBe(true);
    });

    it("rejects a bare proper-noun run, which has no lowercase token to follow the head", async () => {
      const { standsAlone } = await load();
      expect(standsAlone("Situation: Acme Payments Senior Engineer.")).toBe(false);
      expect(standsAlone("Situation: Northwind Traders.")).toBe(false);
    });

    it("does not read a POSSESSIVE `'s` as a finite verb (r10 §5.7.1 (d))", async () => {
      const { standsAlone } = await load();
      // "the platform's cache" must not satisfy (d). The body opens on the
      // function head `The`, so the imperative-head escape is closed too, and
      // no token carries verb morphology.
      expect(standsAlone("Result: The platform's cache.")).toBe(false);
      // The contrast: a pronoun host DOES make it finite.
      expect(standsAlone("Result: That's the cache I built.")).toBe(false); // S2 rejects first
      expect(standsAlone("Result: Here's the cache.")).toBe(true); // (d) via a pronoun host
    });

    it("judges S3 on the OPENING CLAUSE only, cut at the first dash / colon / semicolon", async () => {
      const { standsAlone } = await load();
      // The example after the dash is full of verbs; the carrier in front of
      // it is not. If S3 ranged over the whole body, `Your steps` would pass
      // and r10's entire §3.3 correction would be undetectable.
      expect(standsAlone("Action: Your steps — e.g. I led the payments migration and shipped it.")).toBe(false);
    });
  });

  it("is total — it never throws on a degenerate point", async () => {
    const { standsAlone } = await load();
    for (const v of ["", "   ", ".", "Situation:", null, undefined]) {
      expect(() => standsAlone(v)).not.toThrow();
      expect(typeof standsAlone(v)).toBe("boolean");
    }
  });
});
