import { describe, expect, it } from "vitest";
import { resolveFactSources } from "./factCitations";

// AC-V4.4. The whitelist that turns the model's `factIds` into something the
// candidate can see, and refuses everything else.
//
// A deliberate structural copy of pageCitations.js's resolvePageSources,
// including all four of its non-obvious rules — pageCitations.js's own header
// records that this repo's answer to "the same shape for a different surface"
// is a second module rather than a generalisation, citing
// lib/meeting/insightContract.js as the earlier instance.
//
// Why this exists at all: the whole point of V4 is that the candidate says
// only things that were checked. A model that returns an id it was never shown
// has invented a citation, and an invented citation is worse than none because
// it looks checkable.

const FACTS = [
  { id: "fact-0", claim: "An online auction marketplace for heavy equipment.", url: "https://a.test/1" },
  { id: "fact-1", claim: "Online-only auctions since 2000.", url: "https://b.test/2" },
];

describe("resolveFactSources — the whitelist supplies the values", () => {
  it("resolves an id the model was shown, using the whitelist's own claim and url", () => {
    // Never the model's echo of them: a model that returns the right id and a
    // paraphrased claim must not get the paraphrase onto the screen.
    const out = resolveFactSources(["fact-1", null], { includedFacts: FACTS, pointCount: 2 });
    expect(out).toEqual([{ id: "fact-1", claim: FACTS[1].claim, url: FACTS[1].url }, null]);
  });

  it("resolves an id the model was NOT shown to null", () => {
    const out = resolveFactSources(["fact-9"], { includedFacts: FACTS, pointCount: 1 });
    expect(out).toEqual([null]);
  });

  it("resolves a fabricated non-id to null rather than passing it through", () => {
    for (const bogus of ["", "  ", "https://evil.test", 7, {}, []]) {
      expect(resolveFactSources([bogus], { includedFacts: FACTS, pointCount: 1 })).toEqual([null]);
    }
  });
});

describe("resolveFactSources — the pairing is all-or-nothing on length", () => {
  it("returns [] when the model returned a different number of ids than points", () => {
    // The pairing is positional, so a length mismatch means the positions
    // cannot be trusted at all — and a citation attached to the wrong point
    // tells the candidate a claim came from a source that did not produce it.
    // Truncating or padding would keep SOME of the pairing, which is the
    // dangerous half.
    expect(resolveFactSources(["fact-0"], { includedFacts: FACTS, pointCount: 2 })).toEqual([]);
    expect(
      resolveFactSources(["fact-0", "fact-1", "fact-0"], { includedFacts: FACTS, pointCount: 2 }),
    ).toEqual([]);
  });

  it("returns [] — not an array of nulls — when there is nothing to cite", () => {
    // The distinction is load-bearing downstream, exactly as pageCitations.js
    // documents for its own: [] means "citations do not apply to this answer",
    // an array of nulls means "they apply and none matched". A renderer that
    // cannot tell them apart shows an empty citation rail on every answer.
    expect(resolveFactSources(null, { includedFacts: FACTS, pointCount: 2 })).toEqual([]);
    expect(resolveFactSources(["fact-0"], { includedFacts: [], pointCount: 1 })).toEqual([]);
    expect(resolveFactSources(["fact-0"], { includedFacts: FACTS, pointCount: 0 })).toEqual([]);
  });

  it("distinguishes 'none matched' from 'not applicable'", () => {
    // The positive control for the case above: with facts shown and points to
    // pair against, ids that all miss produce nulls, NOT [].
    expect(
      resolveFactSources(["nope", "nope"], { includedFacts: FACTS, pointCount: 2 }),
    ).toEqual([null, null]);
  });
});

describe("resolveFactSources — never throws", () => {
  it("survives every malformed input, because it rides beside a live answer", () => {
    for (const args of [
      [undefined, undefined],
      ["not an array", { includedFacts: FACTS, pointCount: 1 }],
      [["fact-0"], null],
      [["fact-0"], { includedFacts: "nope", pointCount: 1 }],
      [[null], { includedFacts: [null, undefined], pointCount: 1 }],
    ]) {
      expect(() => resolveFactSources(...args)).not.toThrow();
    }
  });
});
