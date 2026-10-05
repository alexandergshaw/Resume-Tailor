// N105 AC-16 (N105 side) - one analyzer, and the Ideal feature CONSUMES it.
//
// N106 owns the reviewer (`reviewDocuments`, lib/review) and pins its own half in
// lib/review/index.test.js: exactly one distinct function in lib/review returns
// the review result. That census cannot see code that lives OUTSIDE lib/review, and
// that is exactly where N105 could quietly grow a second analyzer (a "quick" weak-
// ness pass in the pipeline, a flag builder in the surface) that drifts from the
// shared one. This file is the other half: it looks only at what N105 owns.
//
//   A  import census   N105-owned files reach lib/review only through the barrel
//                      (and only the pipeline does), plus the verdict, presentation
//                      and enum modules that are SHARED, and the one pure id -> text
//                      join (idealSurface only), never the detectors, the reference
//                      selector or the validators. A second path into the internals
//                      is how a second analyzer starts.
//   B  shape census    no function exported by an N105-owned module returns the
//                      review result shape when handed a valid reviewer input. The
//                      predicate is the RETURN SHAPE, not a name, as in N106's.
//   C  consumption     the pipeline's `ideal.review` IS what `reviewDocuments`
//                      resolved, called once over both drafts: it is not recomputed,
//                      merged or adjusted on the way out.
//
// Each census carries a control showing its predicate can see what it is hunting:
// A flags a synthetic deep import, B finds a decoy analyzer and the real one.
//
// Not covered here: the flags an N105 surface RENDERS (the band, the panel) are
// pinned by the Step 8 suites, and what the reviewer does with a draft is N106's.

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
// Wraps the real analyzer so call 3 can see what it was handed and what it
// returned; behavior is untouched.
vi.mock("@/lib/review", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, reviewDocuments: vi.fn(real.reviewDocuments) };
});

import { getGeminiClient } from "@/lib/llm/geminiClient";
import { reviewDocuments } from "@/lib/review";
import { runIdealPipeline } from "./idealPipeline.js";
import { EXAMPLE_CANDIDATE_LINES, EXAMPLE_HYPOTHETICAL_LINES } from "./__fixtures__/examplePair.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Everything N105 owns that could host or reach an analyzer.
const PREVIEW_FILES = ["IdealResultBands.js", "ReviewFlagsPanel.js", "RemovedClaimsList.js", "CappedList.js"];
function n105Sources() {
  const out = [];
  const add = (dir, keep) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (f.endsWith(".js") && !f.endsWith(".test.js") && keep(f)) out.push(`${dir}/${f}`);
    }
  };
  add("lib/llm/ideal", () => true);
  add("lib/tailor", (f) => f.startsWith("ideal"));
  add("app/api/tailor", (f) => f.startsWith("ideal"));
  add("app/components/preview", (f) => PREVIEW_FILES.includes(f));
  return out;
}
const SOURCES = n105Sources();
// The files whose exports can be called with a plain object: no JSX, no React.
const CALLABLE = SOURCES.filter((f) => !f.startsWith("app/components/"));

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// ---------------------------------------------------------------------------
// A - import census
// ---------------------------------------------------------------------------

// What an N105-owned file may import from lib/review, by repo-relative target.
const REVIEW_IMPORT_POLICY = {
  "lib/review": { only: ["lib/llm/ideal/idealPipeline.js"], names: ["reviewDocuments"] },
  "lib/review/index": { only: ["lib/llm/ideal/idealPipeline.js"], names: ["reviewDocuments"] },
  "lib/review/reviewVerdict": { names: ["reviewVerdict", "REVIEW_KIND"] },
  "lib/review/flagPresentation": { names: null },
  "lib/review/contract": { names: ["CATEGORY", "ORIGIN"] },
  // N113: the id -> text join for flag excerpts. A pure helper, not an analyzer (it
  // returns the flags it was handed with quotable lines joined on); the band's bridge
  // is its one N105-owned importer, so the join has one implementation, not two.
  "lib/review/resolveFlagExcerpts": { only: ["lib/tailor/idealSurface.js"], names: ["resolveFlagExcerpts"] },
};

function targetOf(file, spec) {
  let abs;
  if (spec.startsWith("@/")) abs = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) abs = join(ROOT, dirname(file), spec);
  else return null;
  return relative(ROOT, abs).split(sep).join("/").replace(/\.js$/, "");
}

// Every import/re-export in `code` as { spec, names }; names is the imported
// binding names ("*" for a namespace, "default" for a default import).
function importsOf(code) {
  const found = [];
  for (const m of code.matchAll(/\b(?:import|export)\s+([^"';]*?)\s*from\s*["']([^"']+)["']/g)) {
    const clause = m[1].trim();
    const names = [];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }
    if (/^\*/.test(clause)) names.push("*");
    const head = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    if (head && !head.startsWith("*")) names.push("default");
    found.push({ spec: m[2], names });
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g)) {
    found.push({ spec: m[1] ?? m[2], names: ["*"] });
  }
  return found;
}

// The reasons `file` (whose comment-stripped source is `code`) reaches into
// lib/review in a way the policy does not allow.
function reviewImportViolations(file, code) {
  const problems = [];
  for (const { spec, names } of importsOf(code)) {
    const target = targetOf(file, spec);
    if (target === null || !(target === "lib/review" || target.startsWith("lib/review/"))) continue;
    const rule = REVIEW_IMPORT_POLICY[target];
    if (!rule) {
      problems.push(`${file} imports ${target}: only the barrel and the shared verdict/presentation/enum modules are allowed`);
      continue;
    }
    if (rule.only && !rule.only.includes(file)) problems.push(`${file} imports ${target}: only ${rule.only.join(", ")} may`);
    if (rule.names) {
      for (const name of names) {
        if (!rule.names.includes(name)) problems.push(`${file} imports ${name} from ${target}: allowed ${rule.names.join(", ")}`);
      }
    }
  }
  return problems;
}

describe("AC-16 A - N105-owned code reaches the reviewer only through the shared surface", () => {
  it("scans a real file set (the sweep is not reading an empty list)", () => {
    expect(SOURCES).toContain("lib/llm/ideal/idealPipeline.js");
    expect(SOURCES).toContain("lib/tailor/idealBandState.js");
    expect(SOURCES).toContain("app/api/tailor/idealBranch.js");
    expect(SOURCES).toContain("app/components/preview/IdealResultBands.js");
    expect(SOURCES.length).toBeGreaterThan(15);
  });

  it("no N105-owned file imports reviewer internals, a second analyzer, or a validator", () => {
    const problems = SOURCES.flatMap((file) =>
      reviewImportViolations(file, stripComments(readFileSync(join(ROOT, file), "utf8"))),
    );
    expect(problems).toEqual([]);
  });

  it("CANARY: the pipeline really does import the analyzer from the barrel", () => {
    const code = stripComments(readFileSync(join(ROOT, "lib/llm/ideal/idealPipeline.js"), "utf8"));
    const reviewImports = importsOf(code).filter((i) => targetOf("lib/llm/ideal/idealPipeline.js", i.spec) === "lib/review");
    expect(reviewImports).toEqual([{ spec: "@/lib/review", names: ["reviewDocuments"] }]);
  });

  it("CONTROL: the predicate flags a deep import of a detector, of the selector, and a second barrel importer", () => {
    const file = "lib/llm/ideal/idealPipeline.js";
    expect(reviewImportViolations(file, `import { detectRepetition } from "@/lib/review/mechanicalDetectors";`)).toHaveLength(1);
    expect(reviewImportViolations(file, `import { selectAuthorityReference } from "../../review/referenceSelect.js";`)).toHaveLength(1);
    expect(reviewImportViolations(file, `import { reviewDocuments } from "@/lib/review/reviewDocuments";`)).toHaveLength(1);
    expect(reviewImportViolations(file, `import { computeCoverage } from "@/lib/review/contract";`)).toHaveLength(1);
    expect(reviewImportViolations("lib/tailor/idealSurface.js", `import { reviewDocuments } from "@/lib/review";`)).toHaveLength(1);
    // ...and passes what the feature legitimately uses.
    expect(reviewImportViolations(file, `import { reviewDocuments } from "@/lib/review";`)).toEqual([]);
    expect(reviewImportViolations("lib/tailor/idealSurface.js", `import { ORIGIN } from "../review/contract.js";`)).toEqual([]);
  });

  // N113: the policy opens exactly ONE pure-helper edge (the id -> text join), for
  // exactly ONE importer and ONE name. It is not an analyzer: it returns the flags it
  // was handed with lines joined on, never a review.
  describe("the one pure-helper edge: idealSurface -> lib/review/resolveFlagExcerpts", () => {
    const SURFACE = "lib/tailor/idealSurface.js";
    const HELPER = "lib/review/resolveFlagExcerpts.js";

    it("allows idealSurface.js to import resolveFlagExcerpts, by either spelling", () => {
      expect(reviewImportViolations(SURFACE, `import { resolveFlagExcerpts } from "../review/resolveFlagExcerpts.js";`)).toEqual([]);
      expect(reviewImportViolations(SURFACE, `import { resolveFlagExcerpts } from "@/lib/review/resolveFlagExcerpts";`)).toEqual([]);
    });

    it("allows it for NO other N105-owned file, and for no other name", () => {
      const line = `import { resolveFlagExcerpts } from "../review/resolveFlagExcerpts.js";`;
      expect(reviewImportViolations("lib/tailor/idealBandState.js", line)).toHaveLength(1);
      expect(reviewImportViolations("lib/llm/ideal/idealPipeline.js", line.replace("../review", "../../review"))).toHaveLength(1);
      expect(reviewImportViolations("app/components/preview/IdealResultBands.js", line.replace("../review", "@/lib/review"))).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `import { resolveFlagExcerpts, other } from "../review/resolveFlagExcerpts.js";`)).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `import * as join from "../review/resolveFlagExcerpts.js";`)).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `import join from "../review/resolveFlagExcerpts.js";`)).toHaveLength(1);
    });

    it("still forbids analyzer import-back from the same file: the barrel, the analyzer module, the detectors, the selector, a re-export", () => {
      expect(reviewImportViolations(SURFACE, `import { reviewDocuments } from "@/lib/review";`)).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `import { reviewDocuments } from "../review/index.js";`)).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `import { reviewDocuments } from "../review/reviewDocuments.js";`)).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `import { detectRepetition } from "../review/mechanicalDetectors.js";`)).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `import { selectAuthorityReference } from "../review/referenceSelect.js";`)).toHaveLength(1);
      expect(reviewImportViolations(SURFACE, `export { reviewDocuments } from "../review/reviewDocuments.js";`)).toHaveLength(1);
    });

    it("the helper is pure: it imports only the shared enum module and no export of it returns a review", async () => {
      const code = stripComments(readFileSync(join(ROOT, HELPER), "utf8"));
      const targets = importsOf(code).map((i) => targetOf(HELPER, i.spec));
      expect(targets).toEqual(["lib/review/contract"]);
      const { found, ran } = await scanExports(await import(new URL(`../../../${HELPER}`, import.meta.url).href), HELPER);
      expect(ran).toBeGreaterThanOrEqual(1);
      expect(found).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// B - shape census
// ---------------------------------------------------------------------------

// A valid reviewer input: whatever analyzer an N105 module hosted, this is the call
// that would make it return the review result.
const PROBE = {
  drafts: [{ kind: "hypothetical", authorityReference: "internal-consistency", spans: [{ id: "x1", text: "Led the team." }] }],
  posting: { requirements: [] },
  realMaterial: null,
};
const RESULT_KEYS = ["coverage", "flags", "unresolvedQualifications"];
const ownKeys = (o) => (o && typeof o === "object" ? Object.keys(o).sort() : null);
const isResultShape = (o) => JSON.stringify(ownKeys(o)) === JSON.stringify(RESULT_KEYS);

// Calls every exported function of `mod` with the probe; reports the ones that
// return the result shape and how many ran at all.
async function scanExports(mod, label) {
  const found = [];
  let ran = 0;
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    let out;
    try {
      out = await fn(PROBE, {});
    } catch {
      continue; // not callable with a reviewer input: not an analyzer of it
    }
    ran += 1;
    if (isResultShape(out)) found.push(`${label}:${name}`);
  }
  return { found, ran };
}

describe("AC-16 B - no N105-owned module exports a second analyzer", () => {
  it("no exported function returns the review result shape for a valid reviewer input", async () => {
    const found = [];
    let ran = 0;
    for (const file of CALLABLE) {
      const result = await scanExports(await import(new URL(`../../../${file}`, import.meta.url).href), file);
      found.push(...result.found);
      ran += result.ran;
    }
    expect(found).toEqual([]);
    // Not vacuous: most exports ran to completion rather than throwing on the probe.
    expect(ran).toBeGreaterThanOrEqual(10);
    // The scan is a no-network scan: the chain's input check refused before a client.
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("CONTROL: the same scan finds the real analyzer and a decoy that builds the shape", async () => {
    const real = await scanExports({ reviewDocuments }, "lib/review");
    expect(real.found).toEqual(["lib/review:reviewDocuments"]);
    const decoy = async () => ({ flags: [], unresolvedQualifications: [], coverage: { complete: false } });
    expect((await scanExports({ quickWeaknessPass: decoy }, "decoy")).found).toEqual(["decoy:quickWeaknessPass"]);
  });
});

// ---------------------------------------------------------------------------
// C - consumption
// ---------------------------------------------------------------------------

function exampleEngine() {
  const draft = (lines) => ({
    result: lines.join("\n"),
    resultLines: lines,
    jobTitle: "Payments Platform Engineer",
    companyName: "Northwind Commerce",
  });
  return {
    name: "gemini",
    supportsIdeal: true,
    async tailorIdeal() {
      return {
        postingAnalysis: { requirements: [] },
        keywordMap: { entries: [] },
        hypothetical: draft(EXAMPLE_HYPOTHETICAL_LINES),
        applicationReadyCandidate: draft(EXAMPLE_CANDIDATE_LINES),
      };
    },
  };
}

describe("AC-16 C - the pipeline's review IS the shared analyzer's result", () => {
  it("calls reviewDocuments once over both drafts and hands back exactly what it resolved", async () => {
    reviewDocuments.mockClear();
    const out = await runIdealPipeline({
      engine: exampleEngine(),
      args: { jobPosting: "payments", resumeText: "Jordan Rivera" },
      realMaterial: { spans: [{ id: "r1", text: "Jordan Rivera", contextKey: "" }], chronology: null },
    });

    expect(reviewDocuments).toHaveBeenCalledTimes(1);
    const [input] = reviewDocuments.mock.calls[0];
    expect(input.drafts.map((d) => d.kind)).toEqual(["applicationReady", "hypothetical"]);
    expect(input.drafts.every((d) => Array.isArray(d.spans) && d.spans.length > 0)).toBe(true);

    const resolved = await reviewDocuments.mock.results[0].value;
    expect(isResultShape(resolved)).toBe(true);
    // Identity, not equality: nothing re-derived, merged or adjusted it.
    expect(out.ideal.review).toBe(resolved);
  });
});
