import { describe, it, expect } from "vitest";

// N65 step 1 — the pure salary-estimate builder, `buildSalaryEstimate`.
//
// THIS FILE IS THE FEATURE'S WHOLE GUARANTEE, in one place: a compensation
// NUMBER is reachable only past a `cites.length === 0` early return, only when
// the model actually searched, and only when a real range parses. Everything
// else is a WITHHOLD, never a fabricated figure. If that guarantee is removed
// the feature is just a chatbot guessing (app-vs-chat REMOVAL test, S13/K3).
//
// DRIVEN THROUGH THE PUBLIC SEAM ON PURPOSE. `parseEstimateRange`,
// `usableCitations` and `deriveBasisKind` are module-PRIVATE (plan P-R2: only
// `buildSalaryEstimate` is exported, so the export-reachability census stays
// 71/364). Importing them here would make them test-only and bump that census,
// AND would test a path no caller reaches. Every S2/S3/S5/S6/S7/S13 behaviour
// below is reachable through `buildSalaryEstimate`, which is the entry point the
// route actually calls, so that is what these fixtures drive.
//
// RED ON HEAD: `lib/salary/salaryEstimate.js` does not exist yet, so this file
// fails at COLLECTION (the import throws). That is the canonical TDD hand-off
// red; the reference implementation in the seat's report proves every assertion
// below is satisfiable, and the K2/K3/K7/K8 mutants prove each one bites.
//
// FIXTURES ARE CONSTRUCTED, NOT OBSERVED. `sources` is the shape
// `extractCitationSources` (lib/llm/interactionCitations.js) returns —
// `{ uri, title, startByte, endByte }` — built to the documented @google/genai
// URLCitation shape; there is no GEMINI_API_KEY in this checkout, so none was
// captured on the wire.

import { buildSalaryEstimate } from "./salaryEstimate.js";

// A real publisher URL `citationHref`/`safeExternalHref` admits verbatim.
const PUBLISHER = "https://www.levels.fyi/company/acme/salaries";
const PUBLISHER_HOST = "levels.fyi";
// A vertexaisearch grounding redirect — a real publisher domain it is NOT.
// `servesGroundingRedirect` must drop it before it can ever become a link or
// count toward the >=1-citation gate (S5/S6, K2). This is the exact class of
// dead-link-labelled-with-a-real-domain the whole citation contract exists to
// prevent (memory gemini-grounding-redirects).
const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUx3k9-abc123";

const src = (uri, title) => ({ uri, title, startByte: 0, endByte: 0 });

// A well-formed grounded result that DOES support an estimate: one publisher
// citation, a searched interaction, a two-bound ESTIMATE envelope line.
const OK_SOURCES = [src(PUBLISHER, "Acme salaries on Levels.fyi")];
const OK_TEXT = "ESTIMATE: $100k–$120k\nBased on Levels.fyi data for this role.";

function build(overrides = {}) {
  return buildSalaryEstimate({
    outputText: OK_TEXT,
    sources: OK_SOURCES,
    searched: true,
    truncated: false,
    company: "Acme",
    ...overrides,
  });
}

describe("buildSalaryEstimate — the positive control: it CAN produce a number", () => {
  // Without this, every withhold assertion below is satisfied by a builder that
  // never produces a range at all (trap: an absence assertion is met by a dead
  // feature). This proves the happy path emits a labelled range with citations.
  it("returns an estimated range with its surviving citations when everything holds", () => {
    const out = build();
    expect(out.status).toBe("estimated");
    expect(out.reason).toBe("ok");
    expect(out.range).toEqual({ min: 100000, max: 120000 });
    expect(out.sourceCount).toBe(1);
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].url).toBe(PUBLISHER);
    expect(out.citations[0].host).toBe(PUBLISHER_HOST);
  });
});

describe("buildSalaryEstimate — S13/K3: NO number without a surviving citation", () => {
  // THE REMOVAL TEST. This is the app-vs-chat gate: delete the
  // `cites.length === 0` early return and the builder falls through to parse the
  // range and emit `status:"estimated"` with `citations: []` — a bare number
  // with nothing behind it, which is exactly the ungrounded guess /api/chat
  // already produces. The mutant proof (delete that return) is watched in the
  // seat's report.
  it("withholds — no range, no estimate — when zero citations survive extraction", () => {
    const out = build({ sources: [] });
    // The load-bearing assertion: NO number is shown.
    expect(out.range).toBeNull();
    expect(out.status).toBe("insufficient_sources");
    expect(out.reason).toBe("no_sources");
    expect(out.citations).toHaveLength(0);
    expect(out.sourceCount).toBe(0);
  });

  it("still withholds even though a perfectly good ESTIMATE line was present", () => {
    // Names the defect direction precisely: the range is parseable, the ONLY
    // thing missing is provenance. A correct build must not let the parseable
    // number leak out.
    const out = build({ sources: [], outputText: "ESTIMATE: $200k–$240k" });
    expect(out.status).not.toBe("estimated");
    expect(out.range).toBeNull();
  });
});

describe("buildSalaryEstimate — S5/S6/K2: redirects never become sources", () => {
  it("drops a vertexaisearch grounding redirect and keeps only the publisher", () => {
    const out = build({ sources: [src(REDIRECT, "Acme pay"), src(PUBLISHER, "Levels.fyi")] });
    expect(out.status).toBe("estimated");
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].host).toBe(PUBLISHER_HOST);
    // The redirect host must appear NOWHERE in what the user is shown.
    const shownHosts = out.citations.map((c) => c.host);
    expect(shownHosts).not.toContain("vertexaisearch.cloud.google.com");
    for (const c of out.citations) {
      expect(c.url).not.toContain("vertexaisearch");
      expect(c.url).not.toContain("grounding-api-redirect");
    }
  });

  it("a redirect that is the ONLY 'source' counts as zero — withhold, never a number", () => {
    // The redirect does not survive, so the >=1-citation gate is not met: this
    // is a withhold, not an estimate resting on a dead link.
    const out = build({ sources: [src(REDIRECT, "Acme pay")] });
    expect(out.status).toBe("insufficient_sources");
    expect(out.range).toBeNull();
  });

  it("S6: an interaction that never searched is a degraded FAILURE, not a negative", () => {
    // No google_search_call step => `searched:false`. Even with a usable
    // citation and a parseable range, no number may be shown: no proof of search
    // means retrieval degraded (S14 family), and the safe outcome is a failure
    // the caller renders as "couldn't check", never "$0" or "pays nothing".
    const out = build({ searched: false });
    expect(out.status).toBe("failed");
    expect(out.reason).toBe("not_searched");
    expect(out.range).toBeNull();
  });
});

describe("buildSalaryEstimate — S3/K7: a range or a withhold, never a bare point", () => {
  it("withholds when only one bound is present (a lone $X is not a range)", () => {
    const out = build({ outputText: "ESTIMATE: $120k\nA single figure, not a band." });
    expect(out.status).toBe("insufficient_sources");
    expect(out.reason).toBe("no_range");
    expect(out.range).toBeNull();
    // It HAD sources — so this proves the range gate, not the citation gate.
    expect(out.sourceCount).toBe(1);
  });

  it("withholds on an explicit 'ESTIMATE: none' rather than inventing a figure", () => {
    const out = build({ outputText: "ESTIMATE: none\nThe sources do not support a range." });
    expect(out.status).not.toBe("estimated");
    expect(out.range).toBeNull();
  });

  it("withholds when there is no ESTIMATE envelope line at all", () => {
    const out = build({ outputText: "Salaries for this role vary a great deal by region." });
    expect(out.status).not.toBe("estimated");
    expect(out.range).toBeNull();
  });
});

describe("buildSalaryEstimate — S7/K8: basis honesty (support vs. membership)", () => {
  it("says 'company' only when a surviving citation actually names the company", () => {
    const out = build({
      company: "Acme",
      sources: [src(PUBLISHER, "Acme Corporation pay bands")],
    });
    expect(out.status).toBe("estimated");
    expect(out.basisKind).toBe("company");
  });

  it("says 'comparable' when the sources are generic, not about the company", () => {
    const out = build({
      company: "Acme",
      sources: [src(PUBLISHER, "Software engineer pay bands, 2026")],
    });
    expect(out.status).toBe("estimated");
    expect(out.basisKind).toBe("comparable");
  });

  it("K8: does NOT claim 'company' on a mere substring match of the company token", () => {
    // The false-positive fixture: company "Meta", a citation whose host is
    // metafilter.com and whose title never says "Meta" as a word. A naive
    // `host.includes("meta")` matches "metafilter" and would claim
    // company-specificity the sources do not support (S7's worse direction).
    const out = build({
      company: "Meta",
      sources: [src("https://www.metafilter.com/jobs/pay", "Software pay overview")],
    });
    expect(out.status).toBe("estimated");
    expect(out.basisKind).toBe("comparable");
  });
});

describe("buildSalaryEstimate — totality", () => {
  it("never throws on a malformed / empty envelope, it withholds", () => {
    // The route passes "" when the interaction produced no output_text (K4). The
    // builder must be total and treat that as a withhold, never a throw.
    expect(() => build({ outputText: "" })).not.toThrow();
    const out = build({ outputText: "" });
    expect(out.status).not.toBe("estimated");
    expect(out.range).toBeNull();
  });
});
