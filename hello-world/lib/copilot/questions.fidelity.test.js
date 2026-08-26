import { describe, expect, it } from "vitest";
import { cleanQuestion } from "./questions";

// AC-V3. cleanQuestion's own header promises it is "purely cosmetic — never
// changes the substance of the ask". In the live session the user recorded on
// 2026-08-25 it deleted the main verb of a question:
//
//   spoken: "What do you know about Purple Wave?"
//   stored and sent to the model: "What do about Purple Wave?"
//
// FILLER_RE strips "you know" unconditionally as hesitation filler. In "what
// do you know about X" it is not filler, it IS the ask — and the model, asked
// to answer "What do about Purple Wave?", returned four sentences of
// job-description vocabulary with no fact about the company in any of them.
//
// The rule these cases pin is structural, not a longer exception list: a
// multi-word discourse marker is filler when it sits at a CLAUSE BOUNDARY —
// touching a comma on at least one side, or opening the utterance — and is
// content everywhere else. "It was, you know, hard" cleans; "what do you know
// about" does not.

describe("cleanQuestion keeps the words that carry the ask (AC-V3.1)", () => {
  it("keeps 'you know' when it is the verb of the question", () => {
    expect(cleanQuestion("What do you know about Purple Wave?")).toBe(
      "What do you know about Purple Wave?",
    );
  });

  it("keeps 'you know' in every other shape where it carries the ask", () => {
    // A positive control across the real phrasings an interviewer uses. Each
    // asserted in full, not by `toContain`, so a fix that mangles a different
    // part of the sentence fails here too.
    expect(cleanQuestion("Do you know how our auction platform works?")).toBe(
      "Do you know how our auction platform works?",
    );
    expect(cleanQuestion("How much do you know about the equipment resale market?")).toBe(
      "How much do you know about the equipment resale market?",
    );
    expect(cleanQuestion("What do you mean by shared platform services?")).toBe(
      "What do you mean by shared platform services?",
    );
  });

  it("still strips 'you know' where it really is filler", () => {
    // The honest-refusal half of the boundary: this is what the rule must
    // keep doing, or it has simply been deleted rather than corrected.
    expect(cleanQuestion("Tell me about a time when, you know, a deadline slipped.")).toBe(
      "Tell me about a time when a deadline slipped.",
    );
    expect(cleanQuestion("You know, tell me about your last role.")).toBe(
      "Tell me about your last role.",
    );
  });

  it("applies the same boundary rule to 'I mean'", () => {
    // AC-V3.3.2. The first two assertions here are REGRESSION guards, not
    // boundary-rule evidence: both pass against the unmodified source, one
    // because "you mean" was never what FILLER_RE matched and the other
    // because the unconditional rule strips ", I mean," identically. A peer
    // review with a mutation harness shipped an implementation that left
    // "i mean" unconditional and passed this test as originally written.
    expect(cleanQuestion("What did you mean by that answer?")).toBe(
      "What did you mean by that answer?",
    );
    expect(cleanQuestion("So, I mean, how would you approach it?")).toBe(
      "How would you approach it?",
    );
    // THIS is the assertion that discriminates: "I mean" as content, with the
    // marker spelled exactly as the filler rule spells it. It is the same
    // defect as "What do about Purple Wave?", one marker over.
    expect(cleanQuestion("Do you know what I mean by scope creep?")).toBe(
      "Do you know what I mean by scope creep?",
    );
  });

  it("recognizes a clause boundary in all three of its shapes (AC-V3.3.1)", () => {
    // The boundary rule has three shapes and a fixture set where every
    // marker happens to carry a TRAILING comma is satisfied by a
    // comma-after-only rule — which leaves the two cases below untouched.
    // One case per shape, so no single shape can carry the others.

    // Shape 1: comma on both sides.
    expect(cleanQuestion("Tell me about a time when, you know, a deadline slipped.")).toBe(
      "Tell me about a time when a deadline slipped.",
    );
    // Shape 2: start of utterance, NO comma anywhere near it.
    expect(cleanQuestion("I mean how would you approach it?")).toBe(
      "How would you approach it?",
    );
    // Shape 3: comma BEFORE the marker only, at the end of the utterance.
    expect(cleanQuestion("Tell me how that project went, you know.")).toBe(
      "Tell me how that project went.",
    );
  });
});

describe("cleanQuestion drops an interviewer's own preamble (AC-V3.2)", () => {
  it("strips a 'great question' preamble so the stored question is the question", () => {
    // From the same session: the interviewer's acknowledgement was stored as
    // part of the question text, which ALSO gave it a different normalized
    // key from the identical question asked 16 seconds earlier — so the
    // answer cache missed and the copilot paid for a model call it had
    // already made.
    expect(cleanQuestion("That's a great question. What do you know about Purple Wave?")).toBe(
      "What do you know about Purple Wave?",
    );
    expect(cleanQuestion("Good question, so tell me about your last role.")).toBe(
      "Tell me about your last role.",
    );
  });

  it("strips the preamble in framings the fixtures above do not spell out", () => {
    // AC-V3.2 names six adjectives and every natural framing of them. Two
    // literal sentences are satisfied by two literal `startsWith` checks —
    // which is exactly the implementation a mutation harness produced, and it
    // passed. These use a different adjective and a different separator.
    expect(cleanQuestion("Interesting question — how do you handle on-call?")).toBe(
      "How do you handle on-call?",
    );
    expect(cleanQuestion("That's a tough question. Why us?")).toBe("Why us?");
  });

  it("does not delete the preamble vocabulary when it is the content (AC-V3.3)", () => {
    // A preamble rule with no `^` anchor deletes the ask out of the middle of
    // both of these. Both are real things an interviewer says, and both were
    // mangled by a surviving mutant: "What makes a in a design review?" and
    // "Tell me about a time you asked a really".
    expect(cleanQuestion("What makes a great question in a design review?")).toBe(
      "What makes a great question in a design review?",
    );
    expect(cleanQuestion("Tell me about a time you asked a really good question.")).toBe(
      "Tell me about a time you asked a really good question.",
    );
  });

  it("keeps a first sentence that is context, not preamble (AC-V3.3)", () => {
    // The distinction "strip the preamble" has to hold that "keep only the
    // last sentence" does not. Three mutants collapsed to the latter, passed
    // every other case in this file, and threw away the context the model
    // needs to answer the question at all.
    expect(cleanQuestion("We use Kafka. How would you scale the consumer group?")).toBe(
      "We use Kafka. How would you scale the consumer group?",
    );
    expect(cleanQuestion("Our team ships weekly. What does your release process look like?")).toBe(
      "Our team ships weekly. What does your release process look like?",
    );
  });

  it("leaves no dangling '!' behind an exclaimed preamble (AC-V3.2.1)", () => {
    // PREAMBLE_RE's terminator was a LOOKAHEAD for `[,.!]`/whitespace/end,
    // deliberately not consumed, on the stated reasoning that the loop's own
    // leading-separator strip would mop it up. That strip is
    // /^[,.\-–—:;\s]+/ — it has no `!` and no `?` in it, so an exclaimed
    // preamble left the mark behind and the stored question began with "! ".
    // "Great question!" is one of the most common things an interviewer
    // says, and before AC-V3.2 existed the string was returned untouched, so
    // this was a regression: the stored question, the answer-cache key and
    // the text sent to the model all started with a stray "! ".
    expect(cleanQuestion("Fair question! What is your salary expectation?")).toBe(
      "What is your salary expectation?",
    );
    expect(cleanQuestion("Great question! Why us?")).toBe("Why us?");
    // The comma and period framings must keep behaving exactly as they did —
    // this is a fix to one terminator, not a rewrite of the rule.
    expect(cleanQuestion("Good question, so tell me about your last role.")).toBe(
      "Tell me about your last role.",
    );
    expect(cleanQuestion("That's a great question. What do you know about Purple Wave?")).toBe(
      "What do you know about Purple Wave?",
    );
  });

  it("consumes a REPEATED terminator, and the '?' framing it never covered (P3)", () => {
    // AC-V3.2.1 closed the single-`!` case and left three open, because the
    // terminator it started consuming was exactly ONE character and the
    // character class had no `?` in it. R4's stated harm — the stored
    // question, the answer-cache key and the text sent to the model all
    // beginning with a stray mark — survives verbatim for every one of these:
    //
    //   "Great question!!!"        -> "!!"
    //   "Tough question!! Why us?" -> "! Why us?"
    //   "Great question!?"         -> "?"
    //   "Fair question? What is…"  -> not stripped at all
    //
    // An interviewer typing (or a transcriber emitting) a doubled mark is not
    // exotic, and "Fair question?" — asking whether it was a fair question —
    // is as ordinary a framing as "Fair question!".
    expect(cleanQuestion("Tough question!! Why us?")).toBe("Why us?");
    expect(cleanQuestion("Fair question? What is your salary expectation?")).toBe(
      "What is your salary expectation?",
    );
    expect(cleanQuestion("Great question?! Why us?")).toBe("Why us?");
    // And the preamble-only utterances stay whole, which is the same contract
    // the single-`!` case already has: stripping that would leave nothing
    // returns the original text, not "".
    expect(cleanQuestion("Great question!!!")).toBe("Great question!!!");
    expect(cleanQuestion("Great question!?")).toBe("Great question!?");
    expect(cleanQuestion("Fair question?")).toBe("Fair question?");
  });

  it("still refuses to eat the front of a word that merely starts with 'question' (AC-V3.3)", () => {
    // The negative control for consuming the terminator rather than looking
    // ahead at it: the terminator is also what stops the rule from matching
    // "Good questions come from…", so a fix that consumes it must not also
    // start matching when there is no terminator there at all.
    expect(cleanQuestion("Good questions come from real curiosity, don't they?")).toBe(
      "Questions come from real curiosity, don't they?",
    );
  });

  it("never strips a preamble that is the whole utterance", () => {
    // cleanQuestion's existing contract: when stripping would leave nothing,
    // it returns the original trimmed text rather than "". Asserted here
    // because the new preamble rule is the most likely way to break it.
    expect(cleanQuestion("That's a great question.")).toBe("That's a great question.");
  });
});

describe("cleanQuestion does not maul a word that merely starts with a marker (AC-V3.1.1)", () => {
  it("keeps 'I meant', which is not 'I mean'", () => {
    // DISCOURSE_MARKER_RE's alternation had no trailing word boundary, so
    // `,\s*(?:you know|i mean)` matched INSIDE "I meant" and took the "mean"
    // out of it, leaving the orphaned "t" to be capitalised into the front of
    // the sentence: "So, I meant to ask about scale." -> "T to ask about
    // scale.". Inherited from the old unconditional rule rather than
    // introduced by AC-V3, but it is the exact defect class AC-V3 exists to
    // fix, one word over — and the rule's own comment claims these markers
    // "carry the ask and must survive untouched" outside a clause boundary,
    // which it did not honour.
    expect(cleanQuestion("So, I meant to ask about scale.")).toBe("I meant to ask about scale.");
    expect(cleanQuestion("I meant to follow up on that.")).toBe("I meant to follow up on that.");
  });

  it("keeps 'you knowledge' and friends, which are not 'you know'", () => {
    // The same hole on the other alternative. Contrived as a sentence, and
    // that is the point: the corpus AC-V3 was built from had no member with a
    // suffix after the marker at all, which is precisely why this survived
    // review. Any word continuing past the marker must be left alone.
    expect(cleanQuestion("Where does your knowledge of auctions come from?")).toBe(
      "Where does your knowledge of auctions come from?",
    );
    expect(cleanQuestion("Tell me about a gap in your process, you knowingly shipped it?")).toBe(
      "Tell me about a gap in your process, you knowingly shipped it?",
    );
  });

  it("still strips the markers themselves at a clause boundary (AC-V3.1)", () => {
    // The positive control: adding a word boundary must not make the rule
    // stop firing on the shapes it was built for.
    expect(cleanQuestion("Tell me about a time when, you know, a deadline slipped.")).toBe(
      "Tell me about a time when a deadline slipped.",
    );
    expect(cleanQuestion("You know, tell me about your last role.")).toBe(
      "Tell me about your last role.",
    );
  });
});

describe("cleanQuestion's existing behaviour is unchanged (AC-V3.4)", () => {
  it("still strips hesitations and interleaved lead-ins", () => {
    expect(cleanQuestion("Um, so tell me about your last role.")).toBe(
      "Tell me about your last role.",
    );
    expect(cleanQuestion("Okay, um, so describe your team.")).toBe("Describe your team.");
  });

  it("still collapses transcription stutter and synthesizes a question mark", () => {
    expect(cleanQuestion("can can you walk me through it")).toBe("Can you walk me through it?");
  });
});
