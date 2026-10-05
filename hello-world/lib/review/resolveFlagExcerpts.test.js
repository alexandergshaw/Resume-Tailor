// N103 Step 1 (4b) -- the shared flag-excerpt resolver, EXTRACTED from
// lib/tailor/idealSurface.js into its own pure module so BOTH idealSurface.js
// (N105's band) and runDocumentReview.js (N103's chokepoint) can resolve a
// reviewer flag's span ids into quotable text without a second copy (AC-7/AC-8).
//
// A reviewer flag carries span IDS, never text (reviewDocuments.js normalizeFlag).
// resolveFlagExcerpts joins the id -> text tables onto `excerpt`/`evidenceExcerpt`
// so ReviewFlagsPanel can quote them. Behaviour must be byte-identical to the
// private function it replaces (idealSurface.test.js:121-155 keeps exercising the
// old call path and must stay green after the extraction).
//
// RED on HEAD: `lib/review/resolveFlagExcerpts.js` does not exist yet, so this
// file fails to resolve its import. Each `it` carries a real assertion that would
// also fail against a stub (e.g. an identity function, or one that overwrites a
// flag's own excerpt), so the power is not merely the missing module. Satisfiability
// + the mutants are proven against the scratchpad reference in the seat report.
//
// Node env: pure module, no React, no IO.

import { describe, it, expect } from "vitest";
import { resolveFlagExcerpts } from "./resolveFlagExcerpts.js";
import { ORIGIN } from "./contract.js";

const spanTexts = {
  applicationReady: { s1: "Led the platform team.", s2: "Improved latency by 300%." },
  hypothetical: { s1: "Ran a 90-person org." },
  realMaterial: { r1: "Senior Engineer, 2019-2023." },
  posting: { q1: "Must have Kubernetes." },
};

describe("resolveFlagExcerpts -- the one shared id->text join (S1)", () => {
  it("resolves a flag's own excerpt from its draftKind table by spanId", () => {
    const [flag] = resolveFlagExcerpts(
      [{ draftKind: "applicationReady", spanId: "s2", category: "unverifiable-metric", message: "..." }],
      spanTexts,
    );
    // Positive: the offending line's TEXT is joined on.
    expect(flag.excerpt).toBe("Improved latency by 300%.");
  });

  it("resolves evidenceExcerpt from the origin the evidenceRef claims (posting / real-material / draft)", () => {
    const [posting] = resolveFlagExcerpts(
      [{ draftKind: "applicationReady", spanId: "s1", category: "missing-keyword", message: "...", evidenceRef: { origin: ORIGIN.POSTING, spanId: "q1" } }],
      spanTexts,
    );
    expect(posting.evidenceExcerpt).toBe("Must have Kubernetes.");

    const [real] = resolveFlagExcerpts(
      [{ draftKind: "applicationReady", spanId: "s1", category: "unsupported-authority", message: "...", evidenceRef: { origin: ORIGIN.REAL_MATERIAL, spanId: "r1" } }],
      spanTexts,
    );
    expect(real.evidenceExcerpt).toBe("Senior Engineer, 2019-2023.");

    const [draft] = resolveFlagExcerpts(
      [{ draftKind: "hypothetical", spanId: "s1", category: "repetition", message: "...", evidenceRef: { origin: ORIGIN.DRAFT, draftKind: "hypothetical", spanId: "s1" } }],
      spanTexts,
    );
    expect(draft.evidenceExcerpt).toBe("Ran a 90-person org.");
  });

  it("leaves a flag that already carries a truthy excerpt UNTOUCHED (no overwrite)", () => {
    const [flag] = resolveFlagExcerpts(
      [{ draftKind: "applicationReady", spanId: "s2", excerpt: "server-joined line", category: "unverifiable-metric", message: "..." }],
      spanTexts,
    );
    // Mutant that unconditionally overwrites `excerpt` reds here.
    expect(flag.excerpt).toBe("server-joined line");
  });

  it("leaves an id with no table entry UNQUOTED (no fabricated text)", () => {
    const [flag] = resolveFlagExcerpts(
      [{ draftKind: "applicationReady", spanId: "s99", category: "vague-unsupported", message: "..." }],
      spanTexts,
    );
    expect(flag.excerpt).toBeUndefined();
  });

  it("is identity on bad input (non-array flags / non-object spanTexts)", () => {
    const flags = [{ draftKind: "applicationReady", spanId: "s1", category: "repetition", message: "..." }];
    expect(resolveFlagExcerpts(flags, null)).toBe(flags);
    expect(resolveFlagExcerpts("nope", spanTexts)).toBe("nope");
  });

  it("does not mutate the input flags in place (returns new objects)", () => {
    const input = [{ draftKind: "applicationReady", spanId: "s1", category: "repetition", message: "..." }];
    const out = resolveFlagExcerpts(input, spanTexts);
    expect(input[0].excerpt).toBeUndefined();
    expect(out[0].excerpt).toBe("Led the platform team.");
  });
});
