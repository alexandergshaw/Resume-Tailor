// THE CARD'S WORDING -- AC-Q4's five variants, AC-Q8's positive absence
// sentence, AC-Q9's order, AC-R16''s five forbidden words. FAILING TESTS
// FIRST: `./glossaryCard.js` does not exist yet.
//
// WHY THE WORDING IS A PURE MODULE AND NOT A STRING IN THE COMPONENT. Every
// sentence here is an honesty claim about data a DIFFERENT user's browser
// wrote into a shared row, and the difference between the sourced and the
// unsourced card is the entire partial-research ruling. A claim that can only
// be checked by mounting a popover is a claim that gets checked once.
//
// WHAT LIVES ELSEWHERE, DELIBERATELY. The decision of WHETHER a term is
// sourced -- `safeExternalHref` + `citationHost` + the two redirector re-checks
// (AC-H22, AC-H18', AC-R33) -- lives in the component, in ONE expression
// beside the anchor it governs, because app/components/hrefSafety.sweep.test.js
// only recognises an href produced by a same-file `safeExternalHref(` binding.
// This module takes that decision as an input and never re-derives it.

import { describe, it, expect } from "vitest";

import {
  NO_SOURCE_SENTENCE,
  POSTING_ONLY_LINE,
  sourceLinkLabel,
  glossaryCardModel,
} from "./glossaryCard.js";

const HOST = "postgresql.org";

const explicit = {
  term: "covering index",
  kind: "explicit",
  evidence: "You will tune covering indexes on a 4TB table.",
  definition: "An index that carries every column a query needs, so the query is answered without visiting the table itself.",
  provenance: "recalled",
};

const anticipated = {
  term: "MVCC",
  kind: "anticipated",
  parent: "PostgreSQL",
  anchor_quote: "Deep PostgreSQL experience is required.",
  definition: "Multiversion concurrency control: readers see a snapshot rather than blocking on writers, at the cost of dead tuples that have to be vacuumed.",
  provenance: "recalled",
};

const quotesOnly = {
  term: "settlement ledger",
  kind: "explicit",
  evidence: "You will own the settlement ledger end to end.",
  definition: "",
  provenance: "recalled",
};

describe("AC-Q4 -- the provenance line, in words, for all five variants", () => {
  it("explicit + sourced names the posting AND the host", () => {
    const card = glossaryCardModel(explicit, { sourced: true, host: HOST });
    expect(card.provenanceLine).toBe("In this posting · postgresql.org");
  });

  it("anticipated + sourced says it is NOT stated in this posting", () => {
    const card = glossaryCardModel(anticipated, { sourced: true, host: HOST });
    expect(card.provenanceLine).toBe(
      "Likely to come up — not stated in this posting · postgresql.org",
    );
  });

  it("explicit + unsourced says 'No source' on the FIRST line, not by omission", () => {
    const card = glossaryCardModel(explicit, { sourced: false, host: null });
    expect(card.provenanceLine).toBe("In this posting · No source");
  });

  it("anticipated + unsourced does both", () => {
    const card = glossaryCardModel(anticipated, { sourced: false, host: null });
    expect(card.provenanceLine).toBe(
      "Likely to come up — not stated in this posting · No source",
    );
  });

  it("a quotes-only term says 'From the posting' and carries NO definition, ever", () => {
    const card = glossaryCardModel(quotesOnly, { sourced: false, host: null });
    expect(card.variant).toBe("quotes-only");
    expect(card.provenanceLine).toBe(POSTING_ONLY_LINE);
    expect(card.definition).toBe("");
    expect(card.quote).toBe("You will own the settlement ledger end to end.");
    // No source line at all: the embedded path answers a different question
    // and has no source to have or to lack.
    expect(card.closingLine).toBeNull();
    expect(card.linkLabel).toBeNull();
  });
});

describe("AC-H22 -- `sourced` false renders the UNSOURCED card ENTIRELY, first line included", () => {
  it("ignores a stored host when the render-time decision refused it", () => {
    // r4 re-validated only the anchor, which left the first line naming a host
    // for a URL the card then refused to link. Both lines are governed by the
    // same one input.
    const hostile = { ...explicit, provenance: "researched", source_host: "postgresql.org" };
    const card = glossaryCardModel(hostile, { sourced: false, host: null });
    expect(card.provenanceLine).toBe("In this posting · No source");
    expect(card.closingLine).toBe(NO_SOURCE_SENTENCE);
    expect(card.linkLabel).toBeNull();
    expect(JSON.stringify(card)).not.toContain("postgresql.org");
  });

  it("never reads the stored source_host when it IS sourced either", () => {
    // SEC-F2: the displayed host comes from the anchor's own href, computed by
    // the caller in the same expression -- never from this drifted second copy.
    const drifted = { ...explicit, provenance: "researched", source_host: "evil.example" };
    const card = glossaryCardModel(drifted, { sourced: true, host: HOST });
    expect(card.provenanceLine).toContain(HOST);
    expect(JSON.stringify(card)).not.toContain("evil.example");
  });

  it("AC-Q7 -- source_title is not on the model at all", () => {
    const titled = { ...explicit, provenance: "researched", source_title: "<script>alert(1)</script>" };
    const card = glossaryCardModel(titled, { sourced: true, host: HOST });
    expect(JSON.stringify(card)).not.toContain("script");
  });
});

describe("AC-Q8 -- the unsourced card states the absence POSITIVELY", () => {
  it("carries a sentence saying it has none, rather than merely omitting a link", () => {
    const card = glossaryCardModel(explicit, { sourced: false, host: null });
    expect(card.closingLine).toBe("This is a general definition. It has no source.");
    expect(card.closingLine.toLowerCase()).toContain("no source");
    expect(card.linkLabel).toBeNull();
  });

  it("the sourced card offers a link label and does NOT contain 'no source'", () => {
    const card = glossaryCardModel(explicit, { sourced: true, host: HOST });
    expect(card.linkLabel).toBe("Source: postgresql.org");
    expect(card.closingLine).toBeNull();
    expect(JSON.stringify(card).toLowerCase()).not.toContain("no source");
  });

  it("the two differ in TEXT, not merely in markup or colour (greyscale-safe)", () => {
    const text = (card) =>
      [card.provenanceLine, card.quote, card.definition, card.closingLine, card.linkLabel]
        .filter(Boolean)
        .join(" ");
    const sourced = text(glossaryCardModel(explicit, { sourced: true, host: HOST }));
    const unsourced = text(glossaryCardModel(explicit, { sourced: false, host: null }));
    expect(sourced).not.toBe(unsourced);
    // The difference survives being read aloud and printed in black and white:
    // it is carried by words each card has and the other does not.
    expect(sourced.includes(HOST) && !unsourced.includes(HOST)).toBe(true);
    expect(unsourced.includes("It has no source.") && !sourced.includes("It has no source.")).toBe(true);
  });

  it("sourceLinkLabel is meaningful out of context -- never 'here', never 'link'", () => {
    expect(sourceLinkLabel("learn.microsoft.com")).toBe("Source: learn.microsoft.com");
    expect(sourceLinkLabel(null)).toBeNull();
    expect(sourceLinkLabel("")).toBeNull();
  });
});

describe("AC-Q9 -- a screen reader hears the provenance BEFORE the definition", () => {
  it("the model's reading order puts the provenance line first and the source line last", () => {
    const card = glossaryCardModel(anticipated, { sourced: true, host: HOST });
    expect(card.order).toEqual(["heading", "provenanceLine", "quote", "definition", "sourceLine"]);
    expect(card.order.indexOf("provenanceLine")).toBeLessThan(card.order.indexOf("definition"));
    expect(card.order.at(-1)).toBe("sourceLine");
  });

  it("shows the anchor quote on an anticipated term and the evidence on an explicit one", () => {
    // The anchor quote is what lets a candidate judge whether an ANTICIPATED
    // term is really relevant to this job. It is not decoration.
    expect(glossaryCardModel(anticipated, { sourced: false, host: null }).quote).toBe(
      "Deep PostgreSQL experience is required.",
    );
    expect(glossaryCardModel(explicit, { sourced: false, host: null }).quote).toBe(
      "You will tune covering indexes on a 4TB table.",
    );
  });

  it("uses the posting's own casing for the heading", () => {
    expect(glossaryCardModel({ ...explicit, term: "SOC 2 Type II" }, { sourced: false, host: null }).heading).toBe(
      "SOC 2 Type II",
    );
  });
});

describe("AC-R16' -- the five forbidden words, and a positive control", () => {
  const FORBIDDEN = ["verified", "confirmed", "corroborated", "sourced from", "researched"];

  it("no rendered string of any variant uses any of them, in any casing", () => {
    const variants = [
      glossaryCardModel(explicit, { sourced: true, host: HOST }),
      glossaryCardModel(explicit, { sourced: false, host: null }),
      glossaryCardModel(anticipated, { sourced: true, host: HOST }),
      glossaryCardModel(anticipated, { sourced: false, host: null }),
      glossaryCardModel(quotesOnly, { sourced: false, host: null }),
    ];
    for (const card of variants) {
      const rendered = [card.provenanceLine, card.closingLine, card.linkLabel].filter(Boolean).join(" ").toLowerCase();
      for (const word of FORBIDDEN) {
        expect({ card: card.variant, word, found: rendered.includes(word) }).toEqual({
          card: card.variant,
          word,
          found: false,
        });
      }
    }
  });

  it("the sweep can fail: a planted string carrying each word IS detected", () => {
    const planted = "Researched and verified, confirmed, corroborated, sourced from the vendor.".toLowerCase();
    for (const word of FORBIDDEN) expect(planted.includes(word)).toBe(true);
  });

  it("but the DATA layer keeps `provenance: \"researched\"` -- only the label changed", () => {
    // The split is the point. A future reader must not "fix" the
    // inconsistency by renaming the stored value.
    const stored = { ...explicit, provenance: "researched" };
    const card = glossaryCardModel(stored, { sourced: true, host: HOST });
    expect(stored.provenance).toBe("researched");
    expect(JSON.stringify(card)).not.toContain("researched");
  });
});

describe("degenerate inputs never throw on a live interview surface", () => {
  it("survives a missing term, a missing definition and a missing quote", () => {
    for (const bad of [null, undefined, {}, { term: "x" }, { term: "x", kind: "nonsense" }]) {
      expect(() => glossaryCardModel(bad, { sourced: false, host: null })).not.toThrow();
    }
    const card = glossaryCardModel({ term: "x", kind: "explicit" }, { sourced: false, host: null });
    expect(card.definition).toBe("");
    expect(card.quote).toBe("");
  });
});
