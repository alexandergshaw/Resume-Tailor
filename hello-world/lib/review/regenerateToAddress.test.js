// N104 Step 5 (4b) - regenerateToAddress: the ONE gated regenerate orchestrator
// (AC-1 the no-fabrication crux, AC-4, AC-5; design r2 §10, D-1/D-2).
//
//   regenerateToAddress({ engine, args, realMaterial, beforeReview, pinnedAnalysis })
//     -> { regenerated, closure, confirm, genuinelyUnqualified }
//
// WHY A POWER ROW (R4, SAFETY). "Fill the weaknesses" is a fabrication engine by
// default. The one thing that makes it safe is that the submittable text IS
// runIdealPipeline's recomposed KEPT spans (gate output), never the engine's raw
// draft, and the regenerate re-enters the GATED path, never the ungated standard
// resume route (the F-C7 hazard). These tests drive the REAL pipeline with a mock
// engine and assert:
//   - Mutant A (fabrication): an unsupported bullet the engine inserts is ABSENT
//     from regenerated.resultLines.
//   - Mutant B (ungated route): engine.tailorResume is never called; tailorIdeal is.
//   - R5 wiring: weaknessSteering carries RESOLVABLE terms only (never a confirm
//     flag, never a keyword on an unqualified requirement).
//   - closure is DERIVED from the pin-scored re-review (never claimed blind).
//
// RED on HEAD: lib/review/regenerateToAddress.js does not exist. The pipeline,
// gate, classifier and comparator it composes DO exist, so this is the real
// composition seam - the implementer builds the wiring, not the pieces.
// Satisfiability + mutants watched in the scratchpad reference.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { regenerateToAddress } from "./regenerateToAddress.js";
import { detectMissingKeyword } from "./mechanicalDetectors.js";
import { CATEGORY } from "./contract.js";

const KEPT = "Reduced support tickets at Acme Corp";
const KUBE = "Deployed services on Kubernetes at Acme Corp";
const FAB = "Led FDA Class-III regulatory submissions at Acme Corp"; // unsupported -> must drop

const realMaterial = {
  spans: [
    { id: "r1", text: KEPT, contextKey: "Acme Corp" },
    { id: "r2", text: KUBE, contextKey: "Acme Corp" },
  ],
  chronology: { employers: [{ name: "Acme Corp", start: "2020", end: "2024" }] },
};

// The improved candidate: the two supported lines (one newly surfaces Kubernetes)
// plus a fabrication the gate must drop.
function makeEngine(capture = {}) {
  const lines = ["Acme Corp — Senior Engineer (2020-2024)", KEPT, KUBE, FAB];
  return {
    name: "gemini",
    supportsIdeal: true,
    tailorResume: vi.fn(() => {
      throw new Error("regenerate must NOT call the ungated standard route");
    }),
    tailorIdeal: vi.fn(async (args) => {
      capture.args = args;
      return {
        postingAnalysis: { requirements: [] },
        keywordMap: { entries: [] },
        hypothetical: { result: lines.join("\n"), resultLines: lines, jobTitle: "Engineer", companyName: "Acme Corp" },
        applicationReadyCandidate: {
          result: lines.join("\n"),
          resultLines: lines,
          jobTitle: "Engineer",
          companyName: "Acme Corp",
        },
      };
    }),
  };
}

// The pinned analysis: Kubernetes (resolvable - supported in real material), and
// Terraform (GENUINELY UNQUALIFIED - nothing in the real material supports it, so
// its keyword must be folded OUT of the resolvable steering set).
const PINNED = {
  postingAnalysis: {
    requirements: [
      { id: "q3", text: "Kubernetes experience", kind: "requirement" },
      { id: "qU", text: "Five years of Terraform", kind: "requirement" },
    ],
  },
  keywordMap: { entries: [] },
};

// beforeReview: real missing-keyword flags (so the message/term are the shipped
// format), an unqualified entry, and a confirm-tier flag.
const beforeDraft = { kind: "applicationReady", spans: [{ id: "s1", text: "Built reporting tools" }] };
const beforeMissing = detectMissingKeyword(beforeDraft, PINNED.postingAnalysis);
const beforeReview = {
  status: "reviewed",
  draftKind: "applicationReady",
  flags: [
    ...beforeMissing,
    {
      draftKind: "applicationReady",
      spanId: "s1",
      category: CATEGORY.UNVERIFIABLE_METRIC,
      message: 'The figure "90%" has no baseline, comparison or source to check it against.',
    },
  ],
  unresolvedQualifications: [{ requirementId: "qU", text: "Five years of Terraform" }],
  lineCount: 1,
};

const args = { jobPosting: "payments role", resumeText: "Jordan", resumeFileName: "r.docx" };

const normTerm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");

describe("regenerateToAddress - AC-1 no fabrication; routes through the GATED path", () => {
  it("Mutant A: the engine's unsupported bullet is ABSENT from the submittable output", async () => {
    const out = await regenerateToAddress({ engine: makeEngine(), args, realMaterial, beforeReview, pinnedAnalysis: PINNED });
    const text = out.regenerated.resultLines.join("\n");
    expect(text).not.toContain("FDA Class-III"); // dropped by the gate
    expect(text).toContain("Reduced support tickets"); // supported line retained
  });

  it("Mutant B: it NEVER calls the ungated standard resume route; it calls tailorIdeal", async () => {
    const engine = makeEngine();
    await regenerateToAddress({ engine, args, realMaterial, beforeReview, pinnedAnalysis: PINNED });
    expect(engine.tailorResume).not.toHaveBeenCalled();
    expect(engine.tailorIdeal).toHaveBeenCalledTimes(1);
  });

  it("D-1 source census: it imports runIdealPipeline and never the standard route", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./regenerateToAddress.js", import.meta.url), "utf8");
    expect(src).toMatch(/runIdealPipeline/); // the gated path (canary)
    expect(src).not.toMatch(/tailorResume|resubmitDocument/); // never the ungated route
  });
});

describe("regenerateToAddress - R5 wiring: steering is RESOLVABLE terms only", () => {
  it("weaknessSteering carries the resolvable keyword, never a confirm flag or an unqualified-req keyword", async () => {
    const capture = {};
    const engine = makeEngine(capture);
    await regenerateToAddress({ engine, args, realMaterial, beforeReview, pinnedAnalysis: PINNED });
    const steering = capture.args?.weaknessSteering;
    expect(steering).toBeTruthy();
    const terms = (steering.resolvable || []).map((e) => normTerm(e.term));
    expect(terms).toContain("kubernetes"); // q3 is resolvable (supported in real material)
    // MUTANT (an unqualified-req keyword leaks into steering): the Terraform
    // keyword sits on qU, which is genuinely unqualified, so it must NOT steer.
    expect(terms).not.toContain("terraform");
    // every steering entry is a real keyword term (never the confirm figure flag,
    // which carries no term at all)
    expect(steering.resolvable.every((e) => typeof e.term === "string" && e.term.length > 0)).toBe(true);
  });
});

describe("regenerateToAddress - AC-4 closure is derived from the pin-scored re-review", () => {
  it("reports the Kubernetes gap CLOSED (surfaced from real material) and the clearance gap STILL OPEN", async () => {
    const out = await regenerateToAddress({ engine: makeEngine(), args, realMaterial, beforeReview, pinnedAnalysis: PINNED });
    expect(out.closure.correspondenceUnavailable).toBe(false); // pin held -> ids correspond
    const closedTerms = out.closure.closed.map((c) => normTerm(c.term));
    expect(closedTerms).toContain("kubernetes");
    // the genuinely-unqualified clearance requirement is still reported open, never closed
    const unqIds = out.genuinelyUnqualified.map((u) => u.requirementId);
    expect(unqIds).toContain("qU");
    expect(out.closure.closed.map((c) => c.requirementId)).not.toContain("qU");
  });

  it("confirm bucket is returned (reported) and is never a closure target", async () => {
    const out = await regenerateToAddress({ engine: makeEngine(), args, realMaterial, beforeReview, pinnedAnalysis: PINNED });
    expect(out.confirm.some((f) => f.category === CATEGORY.UNVERIFIABLE_METRIC)).toBe(true);
    expect(out.closure.closed.map((c) => c.category)).not.toContain(CATEGORY.UNVERIFIABLE_METRIC);
  });
});

describe("regenerateToAddress - AC-5 engine reality: the regenerate makes NO stray network call", () => {
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("no network expected")));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("the only engine contact is the injected mock; global fetch is never called (recording spy)", async () => {
    await regenerateToAddress({ engine: makeEngine(), args, realMaterial, beforeReview, pinnedAnalysis: PINNED });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
