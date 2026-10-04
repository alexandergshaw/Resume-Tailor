import { describe, it, expect } from "vitest";
import {
  CATEGORY,
  ORIGIN,
  FLOOR_CATEGORIES,
  LLM_CATEGORIES,
  assertContainedFlag,
  assertWellFormed,
  computeCoverage,
} from "./contract.js";

// =============================================================================
// N106 slice-1 4b acceptance tests — lib/review/contract.js (plan r2 Step 1).
//
// RED-ON-HEAD: lib/review/ does not exist (AC r2 §0b / plan V1); this file
// cannot import ./contract.js, so every case errors at collection. That is the
// WEAK red. The BODIES below assert the real contract so they stay meaningful
// against a stub: a stub that returns `{}` from computeCoverage, or an
// assert*() that always returns true, reds these rows (not just the import).
//
// These values are hand-written literals from the FROZEN contract (AC r2 §0,
// design §2), NOT re-derived from any implementation — the honesty-coupling
// checks in particular recompute the 7-enum superset INDEPENDENTLY of the
// impl's own isSuperset (the "canary built from the same source proves only
// consistency" trap: a computeCoverage mutant isSuperset->true must not be able
// to satisfy a coupling check that also calls isSuperset).
// =============================================================================

// The seven contract categories, as literal strings (AC r2 §0 line 48).
const SEVEN = [
  "missing-keyword",
  "vague-unsupported",
  "repetition",
  "unverifiable-metric",
  "employer-plausibility",
  "consistency",
  "unsupported-authority",
];
const FLOOR = ["missing-keyword", "repetition", "unverifiable-metric", "vague-unsupported"];
const LLM = ["employer-plausibility", "consistency", "unsupported-authority"];
const ORIGINS = ["posting", "real-material", "draft"];

const sorted = (xs) => [...xs].sort();

describe("contract: CATEGORY / ORIGIN enums (AC-15 vocabulary, AC-16 single source)", () => {
  it("CATEGORY exposes EXACTLY the 7 contract string values and is frozen", () => {
    // Bind the VALUES (the wire vocabulary), not the key spellings — a
    // conformant impl may key them however it likes.
    expect(sorted(Object.values(CATEGORY))).toEqual(sorted(SEVEN));
    expect(Object.isFrozen(CATEGORY)).toBe(true);
  });

  it("ORIGIN exposes EXACTLY the 3 origin string values and is frozen", () => {
    expect(sorted(Object.values(ORIGIN))).toEqual(sorted(ORIGINS));
    expect(Object.isFrozen(ORIGIN)).toBe(true);
  });

  it("FLOOR_CATEGORIES is the 4-member floor set; LLM_CATEGORIES the 3-member LLM set; disjoint and covering", () => {
    expect(FLOOR_CATEGORIES instanceof Set).toBe(true);
    expect(LLM_CATEGORIES instanceof Set).toBe(true);
    expect(sorted(FLOOR_CATEGORIES)).toEqual(sorted(FLOOR));
    expect(sorted(LLM_CATEGORIES)).toEqual(sorted(LLM));
    // Floor ∪ LLM === the 7-enum, and they are disjoint (erratum: a category is
    // EITHER a floor full-depth home OR an LLM full-depth home, never both).
    expect(sorted([...FLOOR_CATEGORIES, ...LLM_CATEGORIES])).toEqual(sorted(SEVEN));
    for (const c of FLOOR_CATEGORIES) expect(LLM_CATEGORIES.has(c)).toBe(false);
  });
});

// Build the containment index the way reviewDocuments builds it (design §6).
function makeIndex() {
  return {
    draftSpanIds: new Map([
      ["hypothetical", new Set(["h1", "h2"])],
      ["applicationReady", new Set(["a1", "a2"])],
    ]),
    postingIds: new Set(["r1", "r2"]),
    realMaterialIds: new Set(["m1"]),
  };
}

describe("contract: assertContainedFlag (AC-1 single-span containment chokepoint)", () => {
  it("accepts a scalar spanId that exists in its own draft, no evidenceRef", () => {
    expect(assertContainedFlag({ draftKind: "hypothetical", spanId: "h1", category: "repetition" }, makeIndex())).toBe(true);
  });

  it("REJECTS a union spanId 's1+s2' (never a merged span — AC-1 Stub S union variant)", () => {
    expect(assertContainedFlag({ draftKind: "hypothetical", spanId: "h1+h2", category: "repetition" }, makeIndex())).toBe(false);
  });

  it("REJECTS a synthesized spanId 'gen-0' not in the input id-set (AC-1 Stub S synth variant)", () => {
    expect(assertContainedFlag({ draftKind: "hypothetical", spanId: "gen-0", category: "repetition" }, makeIndex())).toBe(false);
  });

  it("REJECTS an ARRAY spanId (must be scalar, never a union array)", () => {
    expect(assertContainedFlag({ draftKind: "hypothetical", spanId: ["h1", "h2"], category: "repetition" }, makeIndex())).toBe(false);
  });

  it("REJECTS a spanId naming a span that lives in a DIFFERENT draft", () => {
    expect(assertContainedFlag({ draftKind: "hypothetical", spanId: "a1", category: "repetition" }, makeIndex())).toBe(false);
  });

  it("accepts evidenceRef origin='draft' with draftKind present and spanId in that draft", () => {
    const flag = {
      draftKind: "hypothetical",
      spanId: "h1",
      category: "consistency",
      evidenceRef: { origin: "draft", draftKind: "applicationReady", spanId: "a2" },
    };
    expect(assertContainedFlag(flag, makeIndex())).toBe(true);
  });

  it("REJECTS evidenceRef origin='draft' WITHOUT draftKind (draftKind required iff origin==='draft')", () => {
    const flag = {
      draftKind: "hypothetical",
      spanId: "h1",
      category: "consistency",
      evidenceRef: { origin: "draft", spanId: "a2" },
    };
    expect(assertContainedFlag(flag, makeIndex())).toBe(false);
  });

  it("REJECTS evidenceRef origin='posting' WITH a draftKind present (draftKind forbidden unless origin==='draft')", () => {
    const flag = {
      draftKind: "hypothetical",
      spanId: "h1",
      category: "missing-keyword",
      evidenceRef: { origin: "posting", draftKind: "applicationReady", spanId: "r1" },
    };
    expect(assertContainedFlag(flag, makeIndex())).toBe(false);
  });

  it("accepts evidenceRef origin='posting' whose spanId is a posting requirement id", () => {
    const flag = {
      draftKind: "hypothetical",
      spanId: "h1",
      category: "missing-keyword",
      evidenceRef: { origin: "posting", spanId: "r2" },
    };
    expect(assertContainedFlag(flag, makeIndex())).toBe(true);
  });

  it("REJECTS evidenceRef origin='real-material' whose spanId is NOT a realMaterial id", () => {
    const flag = {
      draftKind: "hypothetical",
      spanId: "h1",
      category: "unsupported-authority",
      evidenceRef: { origin: "real-material", spanId: "nope" },
    };
    expect(assertContainedFlag(flag, makeIndex())).toBe(false);
  });
});

describe("contract: assertWellFormed (AC-15 shape + honesty coupling)", () => {
  const goodEmbedded = {
    flags: [
      { draftKind: "hypothetical", spanId: "h1", category: "repetition", evidenceRef: { origin: "draft", draftKind: "hypothetical", spanId: "h2" }, message: "x" },
    ],
    unresolvedQualifications: [{ requirementId: "r1", text: "req" }],
    coverage: { evaluatedCategories: [...FLOOR], engineMode: "mechanical-only", complete: false },
  };
  // Note: assertWellFormed validates flag/coverage SHAPE + the honesty coupling
  // (plan Step 1: "assertWellFormed(result)"); the requirementId ∈ posting
  // membership is a reviewDocuments-level fact and is checked INDEPENDENTLY in
  // reviewDocuments.test.js's AC-15 sweep, not here (no posting is available to
  // a single-arg validator).

  it("accepts a well-formed embedded result", () => {
    expect(assertWellFormed(goodEmbedded)).toBe(true);
  });

  it("REJECTS a flag with an out-of-enum category", () => {
    const bad = { ...goodEmbedded, flags: [{ draftKind: "hypothetical", spanId: "h1", category: "not-a-category", message: "x" }] };
    expect(assertWellFormed(bad)).toBe(false);
  });

  it("REJECTS a flag with draftKind set on an origin='posting' evidenceRef", () => {
    const bad = {
      ...goodEmbedded,
      flags: [{ draftKind: "hypothetical", spanId: "h1", category: "missing-keyword", evidenceRef: { origin: "posting", draftKind: "hypothetical", spanId: "r1" }, message: "x" }],
    };
    expect(assertWellFormed(bad)).toBe(false);
  });

  it("REJECTS Stub-E coverage: complete:true with EMPTY evaluatedCategories (the dangerous empty stub — honesty coupling)", () => {
    const bad = { ...goodEmbedded, coverage: { evaluatedCategories: [], engineMode: "full", complete: true } };
    expect(assertWellFormed(bad)).toBe(false);
  });

  it("REJECTS engineMode='mechanical-only' with complete:true (second conjunct of the coupling)", () => {
    const bad = { ...goodEmbedded, coverage: { evaluatedCategories: [...SEVEN], engineMode: "mechanical-only", complete: true } };
    expect(assertWellFormed(bad)).toBe(false);
  });

  it("REJECTS complete:false while evaluatedCategories IS the full 7-enum (under-coupled — complete must equal the superset fact)", () => {
    const bad = { ...goodEmbedded, coverage: { evaluatedCategories: [...SEVEN], engineMode: "full", complete: false } };
    expect(assertWellFormed(bad)).toBe(false);
  });

  it("accepts complete:true when evaluatedCategories IS the full 7-enum on the full path", () => {
    const good = { ...goodEmbedded, coverage: { evaluatedCategories: [...SEVEN], engineMode: "full", complete: true } };
    expect(assertWellFormed(good)).toBe(true);
  });
});

describe("contract: computeCoverage (I6 population rule — design §5, the overclaim-proof derivation)", () => {
  // The 7-enum superset fact, computed INDEPENDENTLY of any impl helper.
  const isAllSeven = (cats) => SEVEN.every((c) => cats.includes(c));

  it("embedded (judge absent): seamResolved=false ⇒ 4-floor / mechanical-only / complete:false", () => {
    const cov = computeCoverage({ seamResolved: false, reportedLlmCategories: [] });
    expect(sorted(cov.evaluatedCategories)).toEqual(sorted(FLOOR));
    expect(cov.engineMode).toBe("mechanical-only");
    expect(cov.complete).toBe(false);
    expect(cov.complete).toBe(isAllSeven(cov.evaluatedCategories)); // independent coupling
  });

  it("full + all 3 LLM reported: seamResolved=true ⇒ 7-enum / full / complete:true (the ONLY true-branch)", () => {
    const cov = computeCoverage({ seamResolved: true, reportedLlmCategories: [...LLM] });
    expect(sorted(cov.evaluatedCategories)).toEqual(sorted(SEVEN));
    expect(cov.engineMode).toBe("full");
    expect(cov.complete).toBe(true);
    expect(cov.complete).toBe(isAllSeven(cov.evaluatedCategories));
  });

  it("RESOLVED-YET-INCOMPLETE (F1): seamResolved=true but reportedLlmCategories=[] ⇒ 4-floor / FULL / complete:false — NEVER coerced to all-LLM", () => {
    // The #1 safety path at the unit level: a judge that resolved but reported
    // nothing usable must leave complete=false. engineMode reflects that the
    // seam DID run (full), but complete is gated by the superset fact.
    const cov = computeCoverage({ seamResolved: true, reportedLlmCategories: [] });
    expect(sorted(cov.evaluatedCategories)).toEqual(sorted(FLOOR));
    expect(cov.engineMode).toBe("full");
    expect(cov.complete).toBe(false);
    expect(cov.complete).toBe(isAllSeven(cov.evaluatedCategories));
  });

  it("partial LLM (one category reported): 4-floor + consistency / full / complete:false", () => {
    const cov = computeCoverage({ seamResolved: true, reportedLlmCategories: ["consistency"] });
    expect(sorted(cov.evaluatedCategories)).toEqual(sorted([...FLOOR, "consistency"]));
    expect(cov.engineMode).toBe("full");
    expect(cov.complete).toBe(false);
    expect(cov.complete).toBe(isAllSeven(cov.evaluatedCategories));
  });

  it("CONTROL: computeCoverage never over-fires — a floor category is ALWAYS evaluated (even embedded)", () => {
    // Distinguishes a correct derivation from a stub that returns [] always.
    const cov = computeCoverage({ seamResolved: false, reportedLlmCategories: [] });
    for (const c of FLOOR) expect(cov.evaluatedCategories).toContain(c);
  });
});
