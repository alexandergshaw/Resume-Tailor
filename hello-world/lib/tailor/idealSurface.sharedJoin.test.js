// N113 part 1 - idealSurface.js consumes the ONE shared id -> text join.
//
// N103 extracted the flag-excerpt join into lib/review/resolveFlagExcerpts.js for
// its own chokepoint (runDocumentReview.js) and left an identical private copy in
// idealSurface.js, because the single-analyzer census (lib/llm/ideal/
// singleAnalyzer.census.test.js, REVIEW_IMPORT_POLICY) did not let an N105-owned
// file import it. The policy now names that one pure-helper edge, and this file
// pins both halves of the de-dup:
//
//   A  source     idealSurface.js imports resolveFlagExcerpts from the shared
//                 module and defines no function of that name (nor the table
//                 helpers that only the private copy used).
//   B  behavior   the flags the surface hands the band are exactly what the shared
//                 join returns for the same tables, over the cases the join
//                 distinguishes (own excerpt kept, evidence by origin, unknown id
//                 unquoted, inherited key never resolves, bad input unchanged).
//
// A fails while the private copy exists; B holds before and after (the extraction
// changes no behavior), so a re-fork that drifts reds B.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "../sourceScan/tokenizeSource.js";
import { CATEGORY, ORIGIN } from "../review/contract.js";
import { resolveFlagExcerpts } from "../review/resolveFlagExcerpts.js";
import { idealSurfaceFor } from "./idealSurface.js";

const ALL_CATEGORIES = Object.values(CATEGORY);
const SOURCE = stripComments(readFileSync(fileURLToPath(new URL("./idealSurface.js", import.meta.url)), "utf8"));

describe("idealSurface.js - A: the join is imported, not re-implemented", () => {
  it("imports resolveFlagExcerpts from the shared review module", () => {
    expect(SOURCE).toMatch(/import\s*\{\s*resolveFlagExcerpts\s*\}\s*from\s*["'](?:\.\.\/review|@\/lib\/review)\/resolveFlagExcerpts(?:\.js)?["']/);
  });

  it("defines no private resolveFlagExcerpts, and none of the helpers only that copy used", () => {
    expect(SOURCE).not.toMatch(/\bfunction\s+resolveFlagExcerpts\b/);
    expect(SOURCE).not.toMatch(/\b(?:const|let|var)\s+resolveFlagExcerpts\b/);
    expect(SOURCE).not.toMatch(/\bfunction\s+evidenceTable\b/);
    expect(SOURCE).not.toMatch(/\bfunction\s+textAt\b/);
  });

  it("still CALLS the join (the import is not dead)", () => {
    expect(SOURCE).toMatch(/\bresolveFlagExcerpts\(\s*base\.flags\s*,\s*ideal\.spanTexts\s*\)/);
  });
});

describe("idealSurface.js - B: the surface's flags are the shared join's output", () => {
  const review = (flags) => ({
    coverage: { engineMode: "full", evaluatedCategories: ALL_CATEGORIES, complete: true },
    flags,
    unresolvedQualifications: [],
  });
  const surfaceFlags = (flags, spanTexts) =>
    idealSurfaceFor(
      { result: "READY", ideal: { applicationReady: { result: "READY" }, review: review(flags), spanTexts } },
      { title: "Staff Engineer", company: "Acme" },
    ).ideal.review.flags;

  const spanTexts = {
    applicationReady: { s1: "Led the platform team.", s2: "Improved latency by 300%." },
    hypothetical: { h1: "Ran a 90-person org." },
    realMaterial: { r1: "Senior Engineer, 2019-2023." },
    posting: { q1: "Must have Kubernetes." },
  };
  const flags = [
    { category: CATEGORY.UNVERIFIABLE_METRIC, draftKind: "applicationReady", spanId: "s2", message: "m" },
    { category: CATEGORY.MISSING_KEYWORD, draftKind: "applicationReady", spanId: "s1", message: "m", evidenceRef: { origin: ORIGIN.POSTING, spanId: "q1" } },
    { category: CATEGORY.CONSISTENCY, draftKind: "applicationReady", spanId: "s1", message: "m", evidenceRef: { origin: ORIGIN.REAL_MATERIAL, spanId: "r1" } },
    { category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "s1", message: "m", evidenceRef: { origin: ORIGIN.DRAFT, draftKind: "hypothetical", spanId: "h1" } },
    { category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "s2", message: "m", excerpt: "Joined by the server" },
    { category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "s99", message: "m" },
    { category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "constructor", message: "m" },
    { category: CATEGORY.REPETITION, draftKind: "__proto__", spanId: "s1", message: "m" },
  ];

  it("equals resolveFlagExcerpts(flags, spanTexts), flag for flag", () => {
    expect(surfaceFlags(flags, spanTexts)).toEqual(resolveFlagExcerpts(flags, spanTexts));
  });

  it("POSITIVE CONTROL: the comparison is not vacuous - the join really quoted lines", () => {
    const out = surfaceFlags(flags, spanTexts);
    expect(out[0].excerpt).toBe("Improved latency by 300%.");
    expect(out[1].evidenceExcerpt).toBe("Must have Kubernetes.");
    expect(out[2].evidenceExcerpt).toBe("Senior Engineer, 2019-2023.");
    expect(out[3].evidenceExcerpt).toBe("Ran a 90-person org.");
    expect(out[4].excerpt).toBe("Joined by the server");
    expect(out[5].excerpt).toBeUndefined();
    expect(out[6].excerpt).toBeUndefined();
    expect(out[7].excerpt).toBeUndefined();
  });

  it("with no id tables the flags come through as the same array (unknown stays unknown)", () => {
    const list = [{ category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "s1" }];
    expect(surfaceFlags(list, undefined)).toBe(list);
    expect(resolveFlagExcerpts(list, undefined)).toBe(list);
  });
});
