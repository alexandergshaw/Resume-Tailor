// TDD RED handoff -- N33's O-15 exemption, THE HEART OF THIS CHUNK.
//
// Under test: two ADDITIVE exports design-reconciled.r2.md ss4.2 specifies
// for lib/interviewPrep/prepParse.js -- `detectedNameSpans` and
// `isUserSuppliedName`. NEITHER EXISTS YET in this checkout:
//   grep -rn "isUserSuppliedName|detectedNameSpans" hello-world/lib hello-world/app
//     -> 0 hits (this round, output_mode files_with_matches, head_limit 0)
//   canary: grep -rn "export function containsDetectedName"
//     hello-world/lib/interviewPrep/prepParse.js -> 1 hit (prepParse.js:237)
// confirming the search root/tool are live and the absence is real, the same
// instrument ac.r1.md ss1.4 already used. `containsDetectedName` itself is
// NOT modified by this chunk (N26 ledger constraint #1; this seat's own
// brief forbids reopening the detector's internals) -- every test below
// that exercises it is a REGRESSION PIN on existing, unchanged behaviour the
// new exemption's safety argument depends on, never a request to change it.
//
// THE CENTRAL, LOAD-BEARING PROPERTY (design-reconciled.r2.md ss4.2,
// design-security.r1.md ss1.3, AC-N33.1/1.2): `isUserSuppliedName(text,
// storedNames)` must be a UNIVERSAL quantifier over
// `detectedNameSpans(text)` -- EVERY span equal, after normalization, to a
// stored value -- never an EXISTENTIAL substring/whole-text check.
// `design-structure.r1.md`'s own illustrative sketch (ss2.3, quoted and
// mechanically traced in design-security.r1.md ss1.1/1.2) was exactly the
// forbidden shape: "true iff text contains a stored value as a
// case-insensitive, whitespace-normalized LITERAL substring." SEC-N33.2 and
// SEC-N33.3 below are that sketch's own two worked bypass attacks,
// reproduced as executable fixtures a case-insensitive-substring
// implementation CANNOT pass -- see the "[SUBSTRING BYPASS REGRESSION]"
// tests, which are the ones this brief names as making that shape
// impossible to ship green.
//
// EVERY FIXTURE'S GIVEN-NAME-LEXICON MEMBERSHIP IS VERIFIED, NOT ASSUMED
// (this repo has already been burned once, N26: "Zzyzx" and "Regional" are
// real SSA-registered names). Verified this round directly against
// lib/interviewPrep/data/givenNames.generated.js (grep -i, case-insensitive
// since the file stores lowercase entries):
//   PRESENT (used as a detected span's FIRST word, or as a stored given
//   name): alex, robert, sarah, jordan, grace, jane, rose, ann, will, priya,
//   james, mary, mark.
//   ABSENT (used where a word must NOT be lexicon-registered, so it cannot
//   start a false-positive pair): analyst, kafka, native, qzxlon (the
//   verified-absent token this seat's brief names).
//   Surnames used only as a pair's SECOND word (Klein, Smith, Shaw, Connor,
//   Turner, Petrov, Lee, Watson) need no lexicon membership at all --
//   `containsDetectedName` never checks the second word's identity, only
//   that it is not one of the 23 ORG_SUFFIX_WORDS, none of which any surname
//   here spells.
//
// AN OPEN QUESTION THIS FILE DOES NOT PAPER OVER (recorded per this seat's
// brief -- "if r2 is silent or ambiguous, record it as a question"):
// AC-N33.4 requires Unicode-NFC normalization of both comparison sides.
// `TITLE_CASE_RUN_RE` (`prepParse.js:188`) is `[A-Z][a-z]+`, a STRICT ASCII
// character class -- verified by reading, not assumed. A precomposed or
// combining-mark character (anything outside U+0041-U+005A / U+0061-U+007A)
// cannot appear inside a matched word, so `detectedNameSpans` can never
// return a span containing a non-ASCII code point. Unicode normalization is
// a no-op on pure-ASCII text (NFC and NFD coincide there), so no fixture
// pairing an NFD-decomposed STORED value against an NFC DETECTED span can
// ever be constructed against the real detector -- the scenario
// design-security.r1.md's own attack-table row #7 describes (a "detected
// span NFC" containing a diacritic) appears to be unreachable given the
// current, unchanged scan. The test in the NFC block below states this
// plainly and checks only what IS reachable (no throw, no false-positive on
// a stored value that itself carries a combining sequence) rather than
// asserting a "correctly normalizes" claim this repo cannot currently
// exercise. This is flagged for the implementer/next design round, not
// invented around.

import { describe, it, expect } from "vitest";

const SPECIFIER = "./prepParse.js";
let modPromise;
function load() {
  if (!modPromise) modPromise = import(SPECIFIER);
  return modPromise;
}

describe("detectedNameSpans -- additive, built from containsDetectedName's own scan", () => {
  it("[control] returns exactly one span for a single detected Title-Case pair", async () => {
    const { detectedNameSpans } = await load();
    expect(detectedNameSpans("Robert Klein is presenting the roadmap.")).toEqual(["Robert Klein"]);
  });

  it("[control] returns EVERY span in a text with two independent detected pairs, in order found -- the property SEC-N33.2's attack depends on", async () => {
    const { detectedNameSpans } = await load();
    const text = "Jane Smith introduced herself before Alex Shaw asked the first question.";
    expect(detectedNameSpans(text)).toEqual(["Jane Smith", "Alex Shaw"]);
  });

  it("slides one word at a time within a single Title-Case run, collecting OVERLAPPING pairs -- never consuming the run two words at a time", async () => {
    const { detectedNameSpans } = await load();
    // "Robert" and "James" are both lexicon-registered given names; "Klein"
    // is not an ORG_SUFFIX_WORD. A run-consumed-in-pairs implementation
    // would see only ["Robert James"]; the sliding scan also finds "James
    // Klein" starting from the run's second word.
    expect(detectedNameSpans("Robert James Klein reviewed the design.")).toEqual(["Robert James", "James Klein"]);
  });

  it("does not count a pair whose FIRST word is not a registered given name -- 'Analyst' gates out, 'Robert Klein' still counts (design-security.r1.md's own worked trace)", async () => {
    const { detectedNameSpans } = await load();
    expect(detectedNameSpans("Analyst Robert Klein reviewed the design.")).toEqual(["Robert Klein"]);
  });

  it("[no-op control] returns [] for text with no Title-Case run at all", async () => {
    const { detectedNameSpans } = await load();
    expect(detectedNameSpans("the meeting starts at nine and runs for an hour")).toEqual([]);
  });

  it("[no-op control] returns [] whenever containsDetectedName itself is false -- the two functions must never disagree on the EXISTENCE of a detected name", async () => {
    const { detectedNameSpans, containsDetectedName } = await load();
    const samples = [
      "the meeting starts at nine",
      "React Native and Google Cloud were discussed.", // "React"/"Google" absent from the lexicon
      "",
      "Solo",
    ];
    for (const text of samples) {
      expect(detectedNameSpans(text).length > 0).toBe(containsDetectedName(text));
    }
  });

  it("is total -- never throws on a degenerate input, always returns an array", async () => {
    const { detectedNameSpans } = await load();
    for (const v of [null, undefined, 42, {}, [], true]) {
      expect(() => detectedNameSpans(v)).not.toThrow();
      expect(Array.isArray(detectedNameSpans(v))).toBe(true);
    }
  });

  it("does not mutate containsDetectedName's own signature or behaviour -- N26 ledger constraint #1, re-confirmed this round", async () => {
    const { containsDetectedName } = await load();
    expect(containsDetectedName.length).toBe(1);
    expect(containsDetectedName("Robert Klein is presenting.")).toBe(true);
    expect(containsDetectedName("the meeting starts at nine")).toBe(false);
  });
});

describe("isUserSuppliedName -- AC-N33.1/1.2: per-span, whole-equality, never a whole-text substring check", () => {
  describe("AC-N33.1 / SEC-N33.2 -- the co-occurring-name attack ('Jane Smith ... Alex Shaw', stored only 'Alex Shaw')", () => {
    it("[SUBSTRING BYPASS REGRESSION] refuses to exempt: a whole-text case-insensitive substring check would return true here (the stored value literally appears in the text) -- the correct per-span rule must return false", async () => {
      const { isUserSuppliedName } = await load();
      const text = "Jane Smith introduced herself before Alex Shaw asked the first question.";
      // A build shaped like design-structure.r1.md's own rejected sketch
      // (`text.toLowerCase().includes(stored.toLowerCase())`) computes TRUE
      // here -- "alex shaw" is literally present. This assertion is FALSE,
      // so that shape cannot ship and pass this suite.
      expect(isUserSuppliedName(text, ["Alex Shaw"])).toBe(false);
    });

    it("[companion control, distinguishes an over-refusing build] the SAME stored name, in a sentence where it is the ONLY detected name, IS exempted", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is presenting the offer letter today.", ["Alex Shaw"])).toBe(true);
    });
  });

  describe("AC-N33.2 / SEC-N33.3 -- the common-word attack ('...will ask...', stored only 'Will')", () => {
    it("[SUBSTRING BYPASS REGRESSION] a bare one-word stored value can never exempt a two-word detected span, and can never act as a case-insensitive wildcard over the whole sentence", async () => {
      const { isUserSuppliedName } = await load();
      const text = "Your interviewer, Robert Klein, will ask about your experience.";
      // A whole-text, case-insensitive substring check finds "will" inside
      // "will ask" and returns true. The correct rule must return false:
      // "Will" (one word) can never equal "Robert Klein" (a two-word span).
      expect(isUserSuppliedName(text, ["Will"])).toBe(false);
    });

    it("[SUBSTRING BYPASS REGRESSION, first-word variant] 'Will Turner' (a name the model invented, sharing only the stored first word) is not exempted by storing 'Will' alone", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Will Turner will lead the panel.", ["Will"])).toBe(false);
    });

    it("[companion control] a stored FULL two-word name that genuinely is the only detected span IS exempted", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Robert Klein will ask about your experience.", ["Robert Klein"])).toBe(true);
    });
  });

  describe("AC-N33.3 -- a stored bare first name never bridges an unknown surname by inference", () => {
    it("stored 'Sarah' does not exempt 'Sarah Connor' (any surname, fabricated or genuinely unknown)", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Sarah Connor will be on the call.", ["Sarah"])).toBe(false);
    });

    it("[companion control] the full stored name 'Sarah Connor' DOES exempt the identical span", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Sarah Connor will be on the call.", ["Sarah Connor"])).toBe(true);
    });
  });

  describe("AC-N33.4 -- normalization: NFC, trim, internal-whitespace collapse; NO other transform", () => {
    it("trims leading/trailing whitespace from the STORED value before comparing", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["  Alex Shaw  "])).toBe(true);
    });

    it("collapses an internal whitespace run (double space / tab) in the STORED value before comparing", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["Alex   Shaw"])).toBe(true);
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["Alex\tShaw"])).toBe(true);
    });

    it("[SEC row #6] does NOT strip punctuation -- a stored value with trailing punctuation (a copy-paste artifact) does not match, and this is the safe direction, not a bug", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["Alex Shaw,"])).toBe(false);
    });

    it("[NFC -- see this file's header for why a reachable positive case cannot be constructed] does not throw and does not falsely exempt when a stored value carries a combining-mark sequence that can never appear in any real detected span (TITLE_CASE_RUN_RE is ASCII-only)", async () => {
      const { isUserSuppliedName } = await load();
      const decomposed = "Alex Shawé"; // "Shawé" spelled with a combining acute accent
      expect(() => isUserSuppliedName("Alex Shaw is on this call.", [decomposed])).not.toThrow();
      // The detected span is plain ASCII "Alex Shaw"; the stored value,
      // NFC-normalized, becomes "Alex Shawé" -- still not byte-equal to
      // "Alex Shaw". This is the one property that IS reachable: a
      // non-ASCII stored value must never accidentally match an ASCII span.
      expect(isUserSuppliedName("Alex Shaw is on this call.", [decomposed])).toBe(false);
    });
  });

  describe("AC-N33.5 -- case-sensitive, exact match; this is the test that would catch a case-insensitive implementation shipping by mistake", () => {
    it("a lowercase stored value does not exempt a Title-Case detected span", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["alex shaw"])).toBe(false);
    });

    it("an all-caps stored value does not exempt a Title-Case detected span", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["ALEX SHAW"])).toBe(false);
    });

    it("[companion control] an exact-case match DOES exempt", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["Alex Shaw"])).toBe(true);
    });
  });

  describe("AC-N33.6 -- empty/whitespace-only stored values never match anything (this seat's brief: 'the single highest-leverage test in this chunk')", () => {
    it("[SUBSTRING BYPASS REGRESSION] a lone empty-string entry never exempts a real detected span -- text.includes('') is true for every string, so any substring-shaped comparison fails this", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Robert Klein will ask about your experience.", [""])).toBe(false);
    });

    it("a whitespace-only entry never exempts anything either, independent of the write-side reject AC-N33.6 also requires", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Robert Klein will ask about your experience.", ["   "])).toBe(false);
    });

    it("an empty entry alongside a genuinely correct one does not change the outcome either way (no interaction)", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Alex Shaw is on this call.", ["", "Alex Shaw"])).toBe(true);
      expect(isUserSuppliedName("Jane Smith and Alex Shaw are on this call.", ["", "Alex Shaw"])).toBe(false);
    });
  });

  describe("AC-N33.7 -- a one-character stored name is allowed but structurally inert (disclosed residual, not gated)", () => {
    it("a single-character stored value can never equal any real detected span (TITLE_CASE_RUN_RE requires 2+ letters per word)", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Robert Klein will ask about your experience.", ["A"])).toBe(false);
    });
  });

  describe("AC-N33.8 / SEC row #8 -- homoglyph substitution in the MODEL's own output (regression pin on existing, unchanged containsDetectedName behaviour)", () => {
    it("a Cyrillic homoglyph substituted for the leading Latin letter of a registered given name is never detected at all -- containsDetectedName and detectedNameSpans agree it is invisible, so the exemption comparison is never even reached", async () => {
      const { containsDetectedName, detectedNameSpans } = await load();
      // Cyrillic capital А, U+0410 -- visually identical to Latin 'A', a
      // different code point. TITLE_CASE_RUN_RE's [A-Z] is ASCII-only, so
      // this cannot begin a Title-Case word at all.
      const text = "Аlex Shaw asked the first question.";
      expect(containsDetectedName(text)).toBe(false);
      expect(detectedNameSpans(text)).toEqual([]);
    });
  });

  describe("SEC row #10 -- zero-width character injected mid-word (regression pin, pre-existing, not new)", () => {
    it("a zero-width space injected inside a given name breaks the word match; the name is never detected, so the exemption comparison is never reached (a disclosed, pre-existing detector gap this chunk does not fix)", async () => {
      const { containsDetectedName, detectedNameSpans } = await load();
      const text = "Al​ex Shaw asked the first question.";
      expect(containsDetectedName(text)).toBe(false);
      expect(detectedNameSpans(text)).toEqual([]);
    });
  });

  describe("SEC row #14 -- a stored value that is a substring of a DIFFERENT real person's name", () => {
    it("stored 'Ann' does not exempt 'Ann Petrov'", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Ann Petrov will join the call.", ["Ann"])).toBe(false);
    });

    it("[companion control] the full stored name 'Ann Petrov' DOES exempt the identical span", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Ann Petrov will join the call.", ["Ann Petrov"])).toBe(true);
    });
  });

  describe("SEC row #15 -- regex/SQL metacharacters in a stored value never throw and never accidentally match", () => {
    it("does not throw when a stored value contains apostrophes, parens, percent signs, or a SQL-comment-shaped string", async () => {
      const { isUserSuppliedName } = await load();
      const hostileStored = [
        "O'Brien",
        "D'Angelo (Sr.)",
        "%_",
        "'; DROP TABLE interview_prep_packs;--",
        "[A-Z]+",
        ".*",
      ];
      expect(() => isUserSuppliedName("Robert Klein will ask about your experience.", hostileStored)).not.toThrow();
      expect(isUserSuppliedName("Robert Klein will ask about your experience.", hostileStored)).toBe(false);
    });
  });

  describe("SEC row #16 -- referential namesake collision: a disclosed, ACCEPTED residual, not a defect to gate here", () => {
    it("a stored value that string-matches a detected span is exempted even when (in the real world) it names an unrelated person -- isUserSuppliedName has no way to know, and per R-N26-10 is not required to", async () => {
      const { isUserSuppliedName } = await load();
      // The candidate genuinely stored "Jordan Lee" as their interviewer's
      // name; the model's line happens to name a DIFFERENT Jordan Lee. The
      // string comparison cannot and does not distinguish this -- documented
      // as the AC's own accepted tradeoff (design-reconciled.r2.md ss1.4 /
      // SEC-N33.6), not asserted as a bug.
      expect(isUserSuppliedName("Jordan Lee once worked at a rival firm.", ["Jordan Lee"])).toBe(true);
    });
  });

  describe("SEC row #17 -- a 3+-token stored full name can NEVER be exempted, structurally (disclosed, UNDECIDED product question, pinned here as a mechanical fact)", () => {
    it("a stored 3-word name is never equal to any 2-word detected span, even when the text contains that EXACT 3-word run", async () => {
      const { isUserSuppliedName, detectedNameSpans } = await load();
      const text = "Mary Jane Watson will be in the room.";
      // The run slides into two overlapping 2-word spans; neither equals the
      // 3-word stored value.
      expect(detectedNameSpans(text)).toEqual(["Mary Jane", "Jane Watson"]);
      expect(isUserSuppliedName(text, ["Mary Jane Watson"])).toBe(false);
    });
  });

  describe("purity and totality", () => {
    it("never throws on a degenerate text or storedNames argument, and always returns a boolean", async () => {
      const { isUserSuppliedName } = await load();
      const degenerateTexts = [null, undefined, 42, {}, ""];
      const degenerateStoredNames = [null, undefined, 42, {}, "not-an-array"];
      for (const text of degenerateTexts) {
        for (const storedNames of degenerateStoredNames) {
          expect(() => isUserSuppliedName(text, storedNames)).not.toThrow();
          expect(typeof isUserSuppliedName(text, storedNames)).toBe("boolean");
        }
      }
    });

    it("a missing/undefined storedNames argument fails closed (never exempts)", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("Robert Klein will ask about your experience.", undefined)).toBe(false);
    });

    it("[control, vacuous truth is harmless] text with zero detected spans is vacuously exempt regardless of storedNames -- moot in production because refusesLine only ever consults this after containsDetectedName(text) is already true", async () => {
      const { isUserSuppliedName } = await load();
      expect(isUserSuppliedName("the meeting starts at nine", [])).toBe(true);
      expect(isUserSuppliedName("the meeting starts at nine", ["Alex Shaw"])).toBe(true);
    });
  });
});
