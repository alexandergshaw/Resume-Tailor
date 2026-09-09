// AC-M16, AC-M17, AC-Q3, AC-Q5, AC-G6, R-362 (the per-term half) -- the
// admission filter.
//
// THE STORABILITY RULE, in one sentence: a term is worth storing exactly when a
// candidate could be asked "what is X?" and could get it wrong -- which is true
// exactly when the term's meaning is NOT recoverable from the ordinary English
// of its own words. `communication` is recoverable; `idempotency` is not.
// G1-G8 are the executable half of that rule. The prompt states it too, but a
// prompt is a request, not a control.
//
// `kind` and `provenance` are the two fields that describe the HONESTY of a row,
// and BOTH are computed by us. The model's own `kind` tag is overridden in both
// directions against `literallyMentioned` -- the same function guarding this
// repo's two other posting-term miners, both of whose headers record it as the
// fix for the "team" -> "Microsoft Teams" mining hazard.

import { describe, it, expect } from "vitest";
import {
  normalizeTerm,
  definitionRejection,
  admitHarvestedTerms,
  AMBIGUOUS_SINGLE_WORDS,
  GENERIC_PROFESSIONAL_PHRASES,
} from "./glossaryTerms.js";

const DESCRIPTION = [
  "Senior Platform Engineer, Payments.",
  "You will own our PostgreSQL estate and the payments ledger.",
  // `idempotency` is deliberately ABSENT from this posting: it is the fixture's
  // anticipated term, and a term the posting states is promoted to `explicit` by
  // the derivation rule, which would make every anchoring case below vacuous.
  "We care about correctness in every write path and about schema normalization.",
  "SOC 2 Type II compliance work sits with this team.",
  "Strong communication and cross-functional collaboration are expected.",
].join("\n");

const anchorContext = {
  description: DESCRIPTION,
  title: "Senior Platform Engineer",
  anchors: new Set(["PostgreSQL", "payments ledger", "role:senior platform engineer"]),
};

const GOOD_DEFINITION =
  "A property of an operation whereby applying it repeatedly produces the same observable result as applying it exactly once, which lets a caller retry safely.";

const term = (over = {}) => ({
  term: "idempotency",
  kind: "anticipated",
  category: "terminology",
  parent: "PostgreSQL",
  anchor_quote: "You will own our PostgreSQL estate and the payments ledger.",
  definition: GOOD_DEFINITION,
  ...over,
});

const admit = (candidates, over = {}) =>
  admitHarvestedTerms(candidates, { ...anchorContext, ...over });

describe("normalizeTerm", () => {
  it("lower-cases and collapses whitespace without touching internal punctuation", () => {
    expect(normalizeTerm("  Schema   Normalization ")).toBe("schema normalization");
    expect(normalizeTerm("SOC 2 Type II")).toBe("soc 2 type ii");
    expect(normalizeTerm(null)).toBe("");
  });
});

describe("G1-G5: the shape and vocabulary rules", () => {
  it("G1 rejects a single-word stopword", () => {
    const out = admit([term({ term: "team" })]);
    expect(out.terms).toHaveLength(0);
    expect(out.rejectedByRule.G1).toBe(1);
  });

  it("G2 rejects the ambiguous single words stopwords.json verifiably does NOT contain", () => {
    // This rule exists precisely because `platform`, `scale` and `index` are not
    // in stopwords.json. Without it they enter as bare single words and the
    // matcher marks them everywhere.
    for (const word of ["platform", "scale", "index"]) {
      expect(AMBIGUOUS_SINGLE_WORDS.has(word)).toBe(true);
      expect(admit([term({ term: word })]).terms).toHaveLength(0);
    }
  });

  it("G2 admits the same words as unambiguous multiword forms", () => {
    const out = admit([
      term({ term: "database index", definition: GOOD_DEFINITION }),
      term({ term: "horizontal scaling", definition: GOOD_DEFINITION }),
    ]);
    expect(out.terms.map((t) => t.term)).toEqual(["database index", "horizontal scaling"]);
  });

  it("G3 rejects a multiword term whose every token is a stopword", () => {
    const out = admit([term({ term: "working with teams" })]);
    expect(out.terms).toHaveLength(0);
    expect(out.rejectedByRule.G3).toBe(1);
  });

  it("G4 rejects the generic professional phrases -- the executable half of the storability rule", () => {
    for (const phrase of ["communication", "cross-functional collaboration", "attention to detail"]) {
      expect(GENERIC_PROFESSIONAL_PHRASES.has(phrase)).toBe(true);
    }
    const out = admit([
      term({ term: "communication" }),
      term({ term: "Cross-Functional Collaboration" }),
      term({ term: "attention to detail" }),
    ]);
    expect(out.terms).toHaveLength(0);
    expect(out.rejectedByRule.G4).toBe(3);
  });

  it("G5 rejects terms outside the shape bound", () => {
    expect(admit([term({ term: "ab" })]).terms).toHaveLength(0);
    expect(admit([term({ term: "x".repeat(61) })]).terms).toHaveLength(0);
    expect(admit([term({ term: "a b c d e f" })]).terms).toHaveLength(0);
    expect(admit([term({ term: "wat<script>" })]).terms).toHaveLength(0);
  });

  it("G8 dedupes case-insensitively, keeping the longest surface form", () => {
    const out = admit([
      term({ term: "schema normalization" }),
      term({ term: "Schema Normalization" }),
    ]);
    expect(out.terms).toHaveLength(1);
    expect(out.droppedCount).toBeGreaterThan(0);
  });

  it("AC-M17: exactly team, platform, scale and index admits ZERO terms", () => {
    const out = admit(["team", "platform", "scale", "index"].map((t) => term({ term: t })));
    expect(out.terms).toHaveLength(0);
    expect(out.rejectedCount).toBe(4);
  });

  it("positive control: a real non-compositional term survives every G-rule", () => {
    // Without this the whole suite passes when the filter rejects everything.
    const out = admit([term()]);
    expect(out.terms).toHaveLength(1);
    expect(out.terms[0].term).toBe("idempotency");
  });
});

describe("G6 and AC-Q5: the definition contract", () => {
  it("G6 rejects a definition that restates the term", () => {
    expect(
      definitionRejection(
        "communication skills",
        "The act of communicating clearly with the people on your team using communication.",
      ),
    ).toBe("G6");
  });

  it("rejects a definition over 80 words or under 10", () => {
    expect(definitionRejection("idempotency", "Too short.")).toBe("length");
    expect(definitionRejection("idempotency", `${"word ".repeat(81)}end.`)).toBe("length");
  });

  it("rejects markdown, links and inline HTML, and does NOT reject a bare comparison", () => {
    const base = "A property of an operation whereby applying it more than once has the same effect as applying";
    expect(definitionRejection("idempotency", `${base} it once, see http://x.example/y for more.`)).toBe("markup");
    expect(definitionRejection("idempotency", `${base} it once [see](http://x.example).`)).toBe("markup");
    expect(definitionRejection("idempotency", `${base} it once <b>always</b>.`)).toBe("markup");
    // `<` before a digit or space is prose, not a tag. This is the recogniser
    // ask/route.js:74 already uses, and "latency < 100ms" must survive it.
    expect(
      definitionRejection(
        "tail latency",
        `${base} it once and the budget stays under latency < 100ms at the ninety-ninth percentile.`,
      ),
    ).toBe(null);
  });

  it("accepts a well-formed definition", () => {
    expect(definitionRejection("idempotency", GOOD_DEFINITION)).toBe(null);
  });
});

describe("kind is DERIVED, never trusted (AC-G6, §3.6)", () => {
  it("demotes a term tagged explicit that is not literally in the posting", () => {
    const out = admit([term({ term: "idempotency", kind: "explicit" })]);
    expect(out.terms[0].kind).toBe("anticipated");
    // A demoted term must then satisfy the anchoring rules like any other.
    expect(out.terms[0].parent).toBe("PostgreSQL");
    expect(out.terms[0].anchor_quote).toBeTypeOf("string");
  });

  it("promotes a term tagged anticipated that IS literally in the posting, dropping its anchor", () => {
    const out = admit([term({ term: "PostgreSQL", kind: "anticipated" })]);
    expect(out.terms[0].kind).toBe("explicit");
    expect(out.terms[0].parent).toBeUndefined();
    expect(out.terms[0].anchor_quote).toBeUndefined();
    // AC-Q3: an explicit term carries an `evidence` snippet WE extracted.
    expect(DESCRIPTION.includes(out.terms[0].evidence)).toBe(true);
  });

  it("REJECTS a model-supplied provenance outright rather than warning", () => {
    const out = admit([term({ provenance: "researched" })]);
    expect(out.terms).toHaveLength(0);
    expect(out.rejectedByRule.provenance).toBe(1);
  });

  it("writes every admitted term recalled, with no source fields", () => {
    const out = admit([term()]);
    expect(out.terms[0].provenance).toBe("recalled");
    expect(out.terms[0]).not.toHaveProperty("source_url");
    expect(out.terms[0]).not.toHaveProperty("source_host");
    expect(out.terms[0]).not.toHaveProperty("source_title");
  });
});

describe("G7: anchoring (R-362)", () => {
  it("G7a rejects a parent outside the anchor space", () => {
    const out = admit([term({ parent: "Communication" })]);
    expect(out.terms).toHaveLength(0);
    expect(out.rejectedByRule.G7a).toBe(1);
  });

  it("G7c rejects an anchor_quote that is not a verbatim span of the description", () => {
    const out = admit([term({ anchor_quote: "We never wrote this sentence." })]);
    expect(out.terms).toHaveLength(0);
    expect(out.rejectedByRule.G7c).toBe(1);
  });

  it("G7b caps children per taxonomy anchor at 8", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      term({ term: `pg concept number ${i}`, anchor_quote: `You will own our PostgreSQL estate and the payments ledger.` }),
    );
    // Give each its own quote so G7d is not what binds, isolating G7b.
    const out = admit(many);
    expect(out.terms.length).toBeLessThanOrEqual(8);
  });

  it("G7d caps terms sharing one anchor quote at 6", () => {
    const quote = "You will own our PostgreSQL estate and the payments ledger.";
    const many = Array.from({ length: 20 }, (_, i) =>
      term({ term: `ledger concept ${i}`, parent: "payments ledger", anchor_quote: quote }),
    );
    const out = admit(many);
    expect(out.terms.length).toBeLessThanOrEqual(6);
  });

  it("gives the role token a larger budget than an ordinary anchor", () => {
    const quotes = DESCRIPTION.split("\n");
    const many = Array.from({ length: 40 }, (_, i) =>
      term({
        term: `role concept ${i}`,
        parent: "role:senior platform engineer",
        anchor_quote: quotes[i % quotes.length],
      }),
    );
    const out = admit(many);
    expect(out.terms.length).toBeGreaterThan(8);
    expect(out.terms.length).toBeLessThanOrEqual(20);
  });

  it("AC-G2: a hundred terms all parented on one anchor with one quote admit at most six", () => {
    const quote = "You will own our PostgreSQL estate and the payments ledger.";
    const attack = Array.from({ length: 100 }, (_, i) =>
      term({ term: `postgres internal ${i}`, parent: "PostgreSQL", anchor_quote: quote }),
    );
    const out = admit(attack);
    expect(out.terms.length).toBeLessThanOrEqual(6);
    expect(out.rejectedCount + out.droppedCount).toBeGreaterThanOrEqual(94);
  });

  it("AC-G3: a hundred terms re-parented onto an anchor outside the space admit ZERO", () => {
    const attack = Array.from({ length: 100 }, (_, i) =>
      term({ term: `postgres internal ${i}`, parent: "Communication" }),
    );
    expect(admit(attack).terms).toHaveLength(0);
  });
});

describe("counting is honest", () => {
  it("counts rejections per rule and reports the totals the row stores", () => {
    const out = admit([term({ term: "team" }), term({ term: "communication" }), term()]);
    expect(out.rejectedCount).toBe(2);
    expect(out.terms).toHaveLength(1);
    expect(out.explicitCount + out.anticipatedCount).toBe(out.terms.length);
  });

  it("caps the whole row at the 120-term ceiling the database CHECK enforces", () => {
    const quotes = DESCRIPTION.split("\n");
    const many = Array.from({ length: 400 }, (_, i) =>
      term({
        term: `distinct concept number ${i}`,
        parent: "role:senior platform engineer",
        anchor_quote: quotes[i % quotes.length],
      }),
    );
    expect(admit(many).terms.length).toBeLessThanOrEqual(120);
  });
});
