import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { reviewDocuments } from "./reviewDocuments.js";

// =============================================================================
// N106 slice-1 4b — THE PUBLIC AC SUITE for reviewDocuments (plan r2 Step 4).
// Deep-imports ./reviewDocuments.js (NOT the barrel, which does not exist until
// Step 5). reviewDocuments is ASYNC; every call is awaited.
//
// RED-ON-HEAD by absence (AC r2 §0b / plan V1). The bodies assert the REAL
// contract so each row is meaningful-red against a stub:
//   Stub E = () => ({flags:[], unresolvedQualifications:[],
//                    coverage:{evaluatedCategories:[], engineMode:"full", complete:true}})
//   Stub A = flag-EVERYTHING with valid in-set ids
//   Stub S = synthesized / union spanId
// The named stub each row reds is in its comment.
//
// SLICE-1 uses FIXED FAKE judges only — never a live model. AC-12 proves the
// deterministic path makes ZERO fetch calls.
// =============================================================================

const SEVEN = [
  "missing-keyword", "vague-unsupported", "repetition", "unverifiable-metric",
  "employer-plausibility", "consistency", "unsupported-authority",
];
const FLOOR = ["missing-keyword", "repetition", "unverifiable-metric", "vague-unsupported"];
const LLM = ["employer-plausibility", "consistency", "unsupported-authority"];
const ORIGINS = ["posting", "real-material", "draft"];
const allSeven = (cats) => SEVEN.every((c) => cats.includes(c));

// ---- Fixed fake judges (test-local, implement the Judge signature) ----------
// All derive ids from judgeRequest so they stay valid as fixtures evolve.
const judgeAll3LLM = async () => ({ flags: [], evaluatedCategories: [...LLM] });
const judgeThrow = async () => { throw new Error("judge exploded"); };
// RESOLVES but reports garbage evaluatedCategories (the F1 #1 safety path).
const judgeMalformed = async () => ({ flags: [], evaluatedCategories: "everything" });
// One VALID-id flag (survives) + one FABRICATED-id flag (must be dropped via the
// SAME emit()/assertContainedFlag chokepoint). Both categories ∈ LLM so the F4
// category restriction does NOT pre-empt the containment drop (judge-side F2).
const judgeContainment = async (req) => {
  const d = req.drafts[0];
  return {
    flags: [
      { draftKind: d.kind, spanId: d.spans[0].id, category: "employer-plausibility", message: "VALID-JUDGE-FLAG" },
      { draftKind: d.kind, spanId: "judge-gen-0", category: "employer-plausibility", message: "FABRICATED-JUDGE-FLAG" },
    ],
    evaluatedCategories: ["employer-plausibility"],
  };
};
// Emits a FLOOR-category flag with a valid id — must be dropped (F4 ownership).
const judgeFloorCat = async (req) => {
  const d = req.drafts[0];
  return { flags: [{ draftKind: d.kind, spanId: d.spans[0].id, category: "missing-keyword", message: "JUDGE-FLOOR" }], evaluatedCategories: [] };
};

// ---- Fixture builders -------------------------------------------------------
const emptyPosting = { requirements: [] };
const cleanSpan = { id: "c1", text: "Reduced p99 latency from 800ms to 200ms by adding a read cache." };
const cleanDraft = { kind: "hypothetical", authorityReference: "internal-consistency", spans: [cleanSpan] };
const cleanInput = () => ({ drafts: [cleanDraft], posting: emptyPosting, realMaterial: null });

// One defect in EACH floor category across DISTINCT spans whose ids sort in a
// DIFFERENT order than their array position (AC-11 shuffle non-vacuity).
const multiDefectDraft = {
  kind: "hypothetical",
  authorityReference: "internal-consistency",
  spans: [
    { id: "s-d", text: "Improved performance by 300%." },                              // unverifiable-metric
    { id: "s-b", text: "Responsible for various strategic initiatives." },             // vague-unsupported
    { id: "s-c", text: "Spearheaded cross-functional initiatives across the organization." }, // repetition
    { id: "s-a", text: "Spearheaded cross-functional initiatives across the organization." }, // repetition sibling
  ],
};
const multiDefectInput = () => ({
  drafts: [multiDefectDraft],
  posting: { requirements: [{ id: "r-kube", text: "Experience with Kubernetes" }] }, // absent ⇒ missing-keyword
  realMaterial: null,
});

// Floor-CLEAN but EMPLOYER-IMPLAUSIBLE (the F1 breaking fixture).
const breakingInput = () => ({
  drafts: [{ kind: "hypothetical", authorityReference: "internal-consistency", spans: [{ id: "b1", text: "Led FDA Class-III medical device regulatory submissions end to end." }] }],
  posting: emptyPosting,
  realMaterial: null,
});

// Cross-draft date contradiction (AC-9).
const consistencyInput = () => ({
  drafts: [
    { kind: "hypothetical", authorityReference: "internal-consistency", spans: [{ id: "h1", text: "Acme Corp | 2018-2022" }] },
    { kind: "applicationReady", authorityReference: "internal-consistency", spans: [{ id: "a1", text: "Acme Corp | 2019-2022" }] },
  ],
  posting: emptyPosting,
  realMaterial: null,
});

// AC-2 Fixture H (coherent internal-consistency, drafts={H only}).
const H = { kind: "hypothetical", authorityReference: "internal-consistency", spans: [
  { id: "h1", text: "Led a 200-engineer platform org." },
  { id: "h2", text: "Senior Director of Engineering | 2014-2024" },
] };
const R_contradict = { spans: [{ id: "m1", text: "Associate Software Engineer | 2021-2024, 3 years." }] };
const inputH = (realMaterial) => ({ drafts: [H], posting: emptyPosting, realMaterial });

// AC-2 Fixture H' (internally incoherent).
const HprimeInput = () => ({
  drafts: [{ kind: "hypothetical", authorityReference: "internal-consistency", spans: [
    { id: "p1", text: "CTO leading a 200-engineer organization." },
    { id: "p2", text: "Associate Software Engineer | 2021-2024" },
  ] }],
  posting: emptyPosting,
  realMaterial: null,
});

// AC-2 Fixture U (user-material).
const uDraft = { kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "u1", text: "Directed a 50-person organization." }] };
const U_unsupInput = () => ({ drafts: [uDraft], posting: emptyPosting, realMaterial: { spans: [{ id: "m1", text: "Senior engineer on a 5-person team." }] } });
const U_supInput = () => ({ drafts: [uDraft], posting: emptyPosting, realMaterial: { spans: [{ id: "m1", text: "Directed a 50-person organization at Acme." }] } });

// AC-13(b) user-material + null realMaterial.
const ac13bInput = () => ({ drafts: [uDraft], posting: emptyPosting, realMaterial: null });

// AC-14 unresolvedQualifications: R1 resolved, R2 genuine gap, R3 phrasing gap.
const ac14Input = () => ({
  drafts: [{ kind: "applicationReady", authorityReference: "user-material", spans: [{ id: "d1", text: "Built data pipelines in Python." }] }],
  posting: { requirements: [
    { id: "r1", text: "5+ years of Python" },                 // resolved by the draft span
    { id: "r2", text: "Must hold an active government security clearance." }, // no keyword, no span, absent corpus ⇒ listed
    { id: "r3", text: "Experience with Docker" },             // keyword absent from draft, present in corpus ⇒ NOT listed
  ] },
  realMaterial: { spans: [{ id: "m1", text: "Shipped services with Docker." }] },
});

// AC-1 union fixture: a defect that naturally spans TWO bullets.
const unionInput = () => ({
  drafts: [{ kind: "hypothetical", authorityReference: "internal-consistency", spans: [
    { id: "s1", text: "Grew the team" },
    { id: "s2", text: "by 300%" },
  ] }],
  posting: emptyPosting,
  realMaterial: null,
});

// Registry used by the UNIVERSAL sweeps (AC-1(a), AC-15).
const FIXTURES = [
  { name: "multiDefect", input: multiDefectInput() },
  { name: "breaking", input: breakingInput() },
  { name: "floorClean", input: cleanInput() },
  { name: "consistencyCross", input: consistencyInput() },
  { name: "authorityHprime", input: HprimeInput() },
  { name: "authorityU_unsup", input: U_unsupInput() },
  { name: "authorityU_sup", input: U_supInput() },
  { name: "ac13b", input: ac13bInput() },
  { name: "ac14", input: ac14Input() },
  { name: "unionSplit", input: unionInput() },
  { name: "judge_all3LLM", input: cleanInput(), judge: judgeAll3LLM },
  { name: "judge_malformed", input: cleanInput(), judge: judgeMalformed },
  { name: "judge_throw", input: cleanInput(), judge: judgeThrow },
  { name: "judge_containment", input: cleanInput(), judge: judgeContainment },
  { name: "judge_floorCat", input: cleanInput(), judge: judgeFloorCat },
];

let RESULTS;
beforeAll(async () => {
  RESULTS = [];
  for (const fx of FIXTURES) {
    const result = await reviewDocuments(fx.input, fx.judge ? { judge: fx.judge } : {});
    RESULTS.push({ ...fx, result });
  }
});

function buildIndex(input) {
  const draftSpanIds = new Map();
  for (const d of input.drafts) draftSpanIds.set(d.kind, new Set(d.spans.map((s) => s.id)));
  return {
    draftSpanIds,
    postingIds: new Set((input.posting?.requirements || []).map((r) => r.id)),
    realMaterialIds: new Set((input.realMaterial?.spans || []).map((s) => s.id)),
  };
}
const catsOf = (flags) => flags.map((f) => f.category);
const authFlags = (result, draftKind) => result.flags.filter((f) => f.category === "unsupported-authority" && f.draftKind === draftKind);

// =============================================================================
// AC-1 — single-span containment (MECHANICAL + JUDGE sides)
// =============================================================================
describe("AC-1 — every flag names exactly one app-minted span that exists in its draft", () => {
  it("(a) UNIVERSAL post-condition over every fixture: scalar spanId ∈ its draft; evidenceRef.spanId ∈ its origin", () => {
    for (const { name, input, result } of RESULTS) {
      const idx = buildIndex(input);
      for (const f of result.flags) {
        expect(typeof f.spanId, `${name}: spanId scalar`).toBe("string"); // reds Stub S array/union
        expect(idx.draftSpanIds.get(f.draftKind)?.has(f.spanId), `${name}: spanId in draft ${f.draftKind}`).toBe(true);
        if (f.evidenceRef) {
          const o = f.evidenceRef.origin;
          const set = o === "posting" ? idx.postingIds : o === "real-material" ? idx.realMaterialIds : idx.draftSpanIds.get(f.evidenceRef.draftKind);
          expect(set?.has(f.evidenceRef.spanId), `${name}: evidenceRef.spanId in ${o}`).toBe(true);
        }
      }
    }
  });

  it("(b) union fixture: a floor defect split across s1/s2 FIRST elicits a flag, THEN names ONE of {s1,s2} — never a minted union", async () => {
    const result = await reviewDocuments(unionInput(), {});
    const floor = result.flags.filter((f) => FLOOR.includes(f.category));
    expect(floor.length, "the split metric must elicit ≥1 floor flag (non-vacuous)").toBeGreaterThanOrEqual(1);
    for (const f of floor) {
      expect(["s1", "s2"]).toContain(f.spanId); // reds Stub S union "s1+s2"
      expect(f.spanId).not.toBe("s1+s2");
    }
  });

  it("JUDGE-SIDE containment (F2): a VALID-id judge flag SURVIVES; a FABRICATED-id judge flag is DROPPED via the same chokepoint", () => {
    // Reds mutant (d): a judge-merge path that appends judge flags WITHOUT
    // re-validation — the fabricated id would then survive. The assertion can
    // tell "dropped" from "never produced" only because the fake judge is KNOWN
    // to have emitted both.
    const validId = cleanDraft.spans[0].id;
    const survived = RESULTS.find((r) => r.name === "judge_containment").result.flags;
    expect(survived.some((f) => f.spanId === validId && f.category === "employer-plausibility")).toBe(true);
    expect(survived.some((f) => f.spanId === "judge-gen-0")).toBe(false);
  });
});

// =============================================================================
// AC-2 — per-draft authority reference SPLIT (differential invariance)
// =============================================================================
describe("AC-2 — authority reference is split per draft and the selection is deterministic", () => {
  it("Fixture H: unsupported-authority flags on H are IDENTICAL under realMaterial=contradict vs null, and EMPTY in both", async () => {
    const runA = await reviewDocuments(inputH(R_contradict), {});
    const runB = await reviewDocuments(inputH(null), {});
    expect(authFlags(runA, "hypothetical")).toEqual(authFlags(runB, "hypothetical")); // reds the pre-split bug
    expect(authFlags(runA, "hypothetical")).toEqual([]); // coherent control
    expect(authFlags(runB, "hypothetical")).toEqual([]);
  });

  it("Fixture H': an internally-incoherent authority claim IS flagged with draft evidenceRef on its own draft", async () => {
    const result = await reviewDocuments(HprimeInput(), {});
    const a = result.flags.find((f) => f.category === "unsupported-authority" && f.draftKind === "hypothetical");
    expect(a).toBeTruthy();
    expect(a.evidenceRef.origin).toBe("draft");
    expect(a.evidenceRef.draftKind).toBe("hypothetical");
  });

  it("Fixture U: a user-material scope claim is flagged when realMaterial lacks it, NOT flagged when it supports it", async () => {
    const unsup = await reviewDocuments(U_unsupInput(), {});
    const sup = await reviewDocuments(U_supInput(), {});
    const u = unsup.flags.find((f) => f.category === "unsupported-authority" && f.draftKind === "applicationReady");
    expect(u).toBeTruthy();
    expect(u.evidenceRef.origin).toBe("real-material"); // reds Stub A over-flag? no — supported control below does
    expect(catsOf(sup.flags)).not.toContain("unsupported-authority"); // reds Stub A (flag-everything)
  });
});

// =============================================================================
// AC-3 — embedded path is a meaningful mechanical-floor subset AND always
// honestly partial; never readable as a complete clean review
// =============================================================================
describe("AC-3 — meaningful mechanical subset + always-honest coverage", () => {
  it("POSITIVE: a draft with a defect in each floor category ⇒ ≥1 flag per floor category, complete:false, mechanical-only", async () => {
    const result = await reviewDocuments(multiDefectInput(), {});
    expect(result.flags.length).toBeGreaterThan(0);
    for (const c of FLOOR) expect(catsOf(result.flags), `floor category ${c} present`).toContain(c); // reds Stub E (floor defect ⇒ flags required)
    expect(result.coverage.engineMode).toBe("mechanical-only");
    expect(result.coverage.complete).toBe(false);
  });

  it("BREAKING fixture (F1): floor-clean but employer-implausible on embedded ⇒ NOT a complete clean review", async () => {
    const result = await reviewDocuments(breakingInput(), {});
    expect(result.coverage.complete).toBe(false); // reds Stub E
    expect(result.coverage.engineMode).toBe("mechanical-only");
    expect(result.coverage.evaluatedCategories).not.toContain("employer-plausibility");
    // NOT the dangerous {flags:[], complete:true} shape:
    expect(result.flags.length === 0 && result.coverage.complete === true).toBe(false);
  });

  it("NEGATIVE: a floor-clean draft has no false floor flag, but coverage.complete is STILL false (honest partial)", async () => {
    const result = await reviewDocuments(cleanInput(), {});
    for (const c of FLOOR) expect(catsOf(result.flags)).not.toContain(c); // reds Stub A
    expect(result.coverage.complete).toBe(false);
  });

  it("complete:true positive control: a RESOLVED judge covering all 3 LLM categories ⇒ full / 7-enum / complete:true", async () => {
    const result = await reviewDocuments(cleanInput(), { judge: judgeAll3LLM });
    expect(result.coverage.engineMode).toBe("full");
    expect([...result.coverage.evaluatedCategories].sort()).toEqual([...SEVEN].sort());
    expect(result.coverage.complete).toBe(true);
    expect(result.coverage.complete).toBe(allSeven(result.coverage.evaluatedCategories)); // independent coupling
  });

  it("OVERCLAIM 2b (F1 resolved-yet-incomplete): judge RESOLVES with garbage evaluatedCategories ⇒ full / complete:false / exactly the 4 FLOOR, no LLM leak", async () => {
    const result = await reviewDocuments(cleanInput(), { judge: judgeMalformed });
    expect(result.coverage.engineMode).toBe("full"); // the seam DID resolve
    expect(result.coverage.complete).toBe(false); // reds mutant (c) coerce-malformed-to-all-LLM
    expect([...result.coverage.evaluatedCategories].sort()).toEqual([...FLOOR].sort());
    for (const c of LLM) expect(result.coverage.evaluatedCategories).not.toContain(c);
  });

  it("OVERCLAIM 2c: judge THROWS/times out ⇒ mechanical-only / complete:false (NEVER complete:true)", async () => {
    const result = await reviewDocuments(cleanInput(), { judge: judgeThrow });
    expect(result.coverage.engineMode).toBe("mechanical-only"); // reds mutant (b) swallow-and-claim-full
    expect(result.coverage.complete).toBe(false);
  });
});

// =============================================================================
// AC-9 — consistency incl. cross-draft evidenceRef
// =============================================================================
describe("AC-9 — cross-draft consistency with typed evidenceRef", () => {
  it("contradictory dates for the same employer across drafts ⇒ consistency flag whose evidenceRef names the OTHER draft", async () => {
    const result = await reviewDocuments(consistencyInput(), {});
    const c = result.flags.find((f) => f.category === "consistency");
    expect(c).toBeTruthy();
    expect(c.evidenceRef.origin).toBe("draft");
    expect(c.evidenceRef.draftKind).toBeTruthy();
    expect(c.evidenceRef.draftKind).not.toBe(c.draftKind);
  });

  it("CLEAN control: drafts that agree on shared dates ⇒ no consistency flag (reds Stub A)", async () => {
    const agree = {
      drafts: [
        { kind: "hypothetical", authorityReference: "internal-consistency", spans: [{ id: "h1", text: "Acme Corp | 2019-2022" }] },
        { kind: "applicationReady", authorityReference: "internal-consistency", spans: [{ id: "a1", text: "Acme Corp | 2019-2022" }] },
      ],
      posting: emptyPosting, realMaterial: null,
    };
    expect(catsOf((await reviewDocuments(agree, {})).flags)).not.toContain("consistency");
  });
});

// =============================================================================
// AC-11 — determinism and stable, content-keyed total order
// =============================================================================
describe("AC-11 — determinism + content-keyed order invariant to input span position", () => {
  it("repeat-call equality on the no-judge path", async () => {
    const a = await reviewDocuments(multiDefectInput(), {});
    const b = await reviewDocuments(multiDefectInput(), {});
    expect(a).toEqual(b);
  });

  it("shuffle-invariance on the multi-defect draft (≥4 flags; ≥2 appear in content order ≠ input order)", async () => {
    const base = multiDefectInput();
    const result = await reviewDocuments(base, {});
    expect(result.flags.length).toBeGreaterThanOrEqual(4);

    // Non-vacuity: the output order must diverge from input-span order in ≥2 places.
    const firstIdx = (spanId) => base.drafts[0].spans.findIndex((s) => s.id === spanId);
    const idxSeq = result.flags.map((f) => firstIdx(f.spanId));
    const sortedByInput = [...idxSeq].sort((x, y) => x - y);
    const differing = idxSeq.filter((v, i) => v !== sortedByInput[i]).length;
    expect(differing, "content order must differ from input order in ≥2 positions").toBeGreaterThanOrEqual(2); // reds iteration-order stub

    // Shuffle the spans; deep-equal result.
    const shuffled = multiDefectInput();
    shuffled.drafts[0].spans = [...shuffled.drafts[0].spans].reverse();
    const afterShuffle = await reviewDocuments(shuffled, {});
    expect(afterShuffle).toEqual(result);
  });
});

// =============================================================================
// AC-12 — purity of the deterministic core + injected judgment seam
// =============================================================================
describe("AC-12 — pure core, no IO on the no-judge path; LLM via injected seam", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  it("the no-judge path makes ZERO fetch calls (spy proven to fire by a recording positive control)", async () => {
    const spy = vi.fn(() => Promise.resolve({ ok: true }));
    globalThis.fetch = spy;
    globalThis.fetch("http://control"); // positive control: the spy records
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await reviewDocuments(multiDefectInput(), {});
    expect(spy).not.toHaveBeenCalled();
  });

  it("FOUR-WAY seam map: all-3-LLM⇒full/true; none⇒mechanical-only/false; throw⇒mechanical-only/false; resolved-malformed⇒full/false", async () => {
    const expectations = [
      { judge: judgeAll3LLM, engineMode: "full", complete: true },
      { judge: undefined, engineMode: "mechanical-only", complete: false },
      { judge: judgeThrow, engineMode: "mechanical-only", complete: false },
      { judge: judgeMalformed, engineMode: "full", complete: false },
    ];
    for (const e of expectations) {
      const result = await reviewDocuments(cleanInput(), e.judge ? { judge: e.judge } : {});
      expect(result.coverage.engineMode, JSON.stringify(e)).toBe(e.engineMode);
      expect(result.coverage.complete, JSON.stringify(e)).toBe(e.complete);
    }
  });

  it("F4 ownership: a judge flag in a FLOOR category is DROPPED (the floor is the deterministic core's territory)", async () => {
    // cleanInput + empty posting ⇒ the floor produces NO missing-keyword; so any
    // missing-keyword in the output could only have come from the judge.
    const result = await reviewDocuments(cleanInput(), { judge: judgeFloorCat });
    expect(catsOf(result.flags)).not.toContain("missing-keyword");
  });
});

// =============================================================================
// AC-13 — realMaterial contract: null legal without user-material; fail-closed with
// =============================================================================
describe("AC-13 — realMaterial null handling", () => {
  it("(a) drafts={internal-consistency only} + realMaterial=null ⇒ well-formed, no throw", async () => {
    const result = await reviewDocuments(inputH(null), {});
    expect(result).toBeTruthy();
    expect(Array.isArray(result.flags)).toBe(true);
    expect(result.coverage).toBeTruthy();
  });

  it("(b) a user-material draft + null realMaterial FAILS CLOSED: ≥1 unsupported-authority flag; NEVER flags:[] with complete:true", async () => {
    const result = await reviewDocuments(ac13bInput(), {});
    expect(authFlags(result, "applicationReady").length).toBeGreaterThanOrEqual(1); // reds Stub E
    expect(result.flags.length === 0 && result.coverage.complete === true).toBe(false);
  });
});

// =============================================================================
// AC-14 — unresolvedQualifications
// =============================================================================
describe("AC-14 — genuine gaps listed; resolved and phrasing gaps excluded", () => {
  it("R2 (clearance) listed; R1 (resolved Python) and R3 (Docker phrasing gap) excluded", async () => {
    const result = await reviewDocuments(ac14Input(), {});
    const ids = result.unresolvedQualifications.map((u) => u.requirementId);
    expect(ids).toContain("r2");  // list-none stub reds here
    expect(ids).not.toContain("r1"); // list-all stub reds here
    expect(ids).not.toContain("r3"); // list-all stub reds here
    const r2 = result.unresolvedQualifications.find((u) => u.requirementId === "r2");
    expect(typeof r2.text).toBe("string");
  });
});

// =============================================================================
// AC-15 — universal well-formedness incl. coverage + INDEPENDENT honesty coupling
// =============================================================================
describe("AC-15 — output well-formedness over every fixture (coverage + coupling)", () => {
  it("schema + coupling sweep over every fixture's result", () => {
    for (const { name, input, result } of RESULTS) {
      const postingIds = new Set((input.posting?.requirements || []).map((r) => r.id));
      for (const f of result.flags) {
        expect(SEVEN, `${name}: category in enum`).toContain(f.category);
        if (f.evidenceRef) {
          expect(ORIGINS, `${name}: origin in enum`).toContain(f.evidenceRef.origin);
          // draftKind present IFF origin === "draft"
          expect(("draftKind" in f.evidenceRef), `${name}: draftKind iff origin=draft`).toBe(f.evidenceRef.origin === "draft");
        }
      }
      for (const u of result.unresolvedQualifications) {
        expect(postingIds.has(u.requirementId), `${name}: requirementId in posting`).toBe(true);
      }
      const cov = result.coverage;
      expect(cov, `${name}: coverage present`).toBeTruthy();
      expect(["full", "mechanical-only"], `${name}: engineMode enum`).toContain(cov.engineMode);
      expect(Array.isArray(cov.evaluatedCategories)).toBe(true);
      for (const c of cov.evaluatedCategories) expect(SEVEN, `${name}: evaluatedCategories ⊆ enum`).toContain(c);
      expect(typeof cov.complete, `${name}: complete boolean`).toBe("boolean");
      // INDEPENDENT coupling (does NOT call the impl's isSuperset): reds the
      // computeCoverage mutant isSuperset->true.
      expect(cov.complete, `${name}: complete === all-seven fact`).toBe(allSeven(cov.evaluatedCategories));
      if (cov.engineMode === "mechanical-only") expect(cov.complete, `${name}: mechanical ⟹ not complete`).toBe(false);
    }
  });
});

// =============================================================================
// ERRATUM — embedded evaluatedCategories = the 4 FLOOR only; a skeleton flag in
// consistency/unsupported-authority does NOT add the category (plan P8 / design F2)
// =============================================================================
describe("ERRATUM — a skeleton category is emitted but NOT counted as evaluated on embedded", () => {
  it("consistencyCross (embedded) emits a consistency flag but consistency ∉ evaluatedCategories", async () => {
    const result = await reviewDocuments(consistencyInput(), {});
    expect(catsOf(result.flags)).toContain("consistency"); // the skeleton DID emit
    expect(result.coverage.evaluatedCategories).not.toContain("consistency"); // but not counted
  });

  it("authorityH' (embedded) emits an unsupported-authority flag but unsupported-authority ∉ evaluatedCategories", async () => {
    const result = await reviewDocuments(HprimeInput(), {});
    expect(catsOf(result.flags)).toContain("unsupported-authority");
    expect(result.coverage.evaluatedCategories).not.toContain("unsupported-authority");
  });

  it("every embedded fixture's evaluatedCategories contains NO LLM category", () => {
    for (const { name, judge, result } of RESULTS) {
      if (judge) continue; // embedded only
      for (const c of LLM) expect(result.coverage.evaluatedCategories, `${name}`).not.toContain(c);
      expect([...result.coverage.evaluatedCategories].sort(), `${name}`).toEqual([...FLOOR].sort());
    }
  });
});
