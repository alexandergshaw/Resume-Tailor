import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as barrel from "./index.js";
import { reviewDocuments as deepReviewDocuments } from "./reviewDocuments.js";

// =============================================================================
// N106 slice-1 4b — lib/review/index.js barrel + AC-16 single-analyzer census
// (plan r2 Step 5). Targets the BARREL (index.js); the behavioral AC suite in
// reviewDocuments.test.js deep-imports ./reviewDocuments.js instead.
//
// RED-ON-HEAD by absence: index.js / reviewDocuments.js do not exist, so the
// static imports above fail at collection. The census below has real power once
// they exist: a SECOND analyzer of any name returning the ReviewResult shape
// reds it (zero-power token-matching is avoided — the predicate is the RETURN
// SHAPE, not the symbol name).
// =============================================================================

// The AC-16 probe fixture: a minimal VALID reviewDocuments input.
const PROBE = {
  drafts: [{ kind: "hypothetical", authorityReference: "internal-consistency", spans: [{ id: "x1", text: "Led the team." }] }],
  posting: { requirements: [] },
  realMaterial: null,
};
const RESULT_KEYS = ["coverage", "flags", "unresolvedQualifications"];
const ownKeysOf = (o) => (o && typeof o === "object" ? Object.keys(o).sort() : null);
const isResultShape = (o) => JSON.stringify(ownKeysOf(o)) === JSON.stringify(RESULT_KEYS);

describe("AC-16 — single exported analyzer + barrel public surface", () => {
  it("the barrel exposes EXACTLY { reviewDocuments, CATEGORY, ORIGIN } (closed in both directions)", () => {
    expect(Object.keys(barrel).sort()).toEqual(["CATEGORY", "ORIGIN", "reviewDocuments"]);
  });

  it("the barrel does NOT re-export detectors, the selector, or the validators (canaried against reviewDocuments, which IS present)", () => {
    const keys = Object.keys(barrel);
    expect(keys).toContain("reviewDocuments"); // canary: the sweep can see a real export
    for (const forbidden of [
      "detectMissingKeyword", "detectRepetition", "detectUnverifiableMetric",
      "detectVagueUnsupported", "detectConsistencySkeleton", "detectAuthoritySkeleton",
      "selectAuthorityReference", "assertContainedFlag", "assertWellFormed", "computeCoverage",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("the barrel's reviewDocuments IS the same function as ./reviewDocuments.js's export (identity, reconciles the deep-import)", () => {
    expect(barrel.reviewDocuments).toBe(deepReviewDocuments);
  });

  it("the barrel's reviewDocuments returns the ReviewResult shape { flags, unresolvedQualifications, coverage }", async () => {
    const result = await barrel.reviewDocuments(PROBE, {});
    expect(ownKeysOf(result)).toEqual(RESULT_KEYS);
  });

  it("CENSUS: exactly ONE DISTINCT exported function across the whole lib/review/ graph returns the ReviewResult shape, and it is reviewDocuments", async () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
    // Dedupe by function IDENTITY: the barrel re-exports reviewDocuments, so
    // the SAME function legitimately appears in both index.js and
    // reviewDocuments.js — that is one analyzer, not two. A genuine SECOND
    // analyzer (any name, any file) returning the ReviewResult shape is a
    // distinct function and reds this. geminiJudge.js (second slice) must not
    // return this shape when it ships.
    const found = new Map(); // fn -> "file:name" (for the failure message)
    for (const file of files) {
      const mod = await import(new URL(file, import.meta.url).href);
      for (const [name, val] of Object.entries(mod)) {
        if (typeof val !== "function" || found.has(val)) continue;
        let out;
        try {
          out = await val(PROBE, {});
        } catch {
          continue; // a function that cannot run against the probe is not the analyzer
        }
        if (isResultShape(out)) found.set(val, `${file}:${name}`);
      }
    }
    expect(found.size, `analyzers found: ${[...found.values()].join(", ")}`).toBe(1);
    expect([...found.keys()][0]).toBe(barrel.reviewDocuments);
  });
});
