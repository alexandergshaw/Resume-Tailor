// N104 Step 6 (4b) - the server wiring: the Ideal branch gates, then dispatches a
// regenerate request to the GATED regenerateToAddress (AC-5/AC-8, design r2 §7,
// D-7/D-10). CREATED this round (plan STALE-2: no idealBranch test existed).
//
// The regenerate reaches the server as an Ideal tailor POST carrying two new
// optional fields - `pinnedAnalysis` and `beforeReview` (plus `weaknessSteering`)
// - on `args`. When they are present the branch must run regenerateToAddress and
// return the closure report alongside the gated submittable resume; a first-run
// request (neither field) must be unchanged.
//
// NOTE (server signature is a plan-OPEN item, R6): the exact transport of
// pinnedAnalysis to the server is bounded plumbing the plan left to step 10. This
// file pins the INVARIANTS that are fixed regardless: (1) the engine-refusal gate
// is REUSED, refusing an unsupported engine with zero artifact; (2) a regenerate
// request produces a gated submittable resume plus a closure report; (3) a
// first-run request carries no closure. The carrier used here is `args` (the plan:
// "the Ideal tailor POST carries two new optional fields").

import { describe, it, expect, vi } from "vitest";
import { gateIdealRequest, runIdealBranch } from "./idealBranch.js";
import { detectMissingKeyword } from "@/lib/review/mechanicalDetectors";

const RESUME = [
  "Jordan Rivera",
  "PROFESSIONAL EXPERIENCE",
  "Acme Corp — Senior Engineer (2020-2024)",
  "Reduced support tickets at Acme Corp",
  "Deployed services on Kubernetes at Acme Corp",
].join("\n");

const FAB = "Led FDA Class-III regulatory submissions at Acme Corp";

function geminiStub() {
  const lines = [
    "Acme Corp — Senior Engineer (2020-2024)",
    "Reduced support tickets at Acme Corp",
    "Deployed services on Kubernetes at Acme Corp",
    FAB,
  ];
  return {
    name: "gemini",
    supportsIdeal: true,
    tailorResume: vi.fn(() => {
      throw new Error("the regenerate branch must never call the ungated standard route");
    }),
    async tailorIdeal() {
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
    },
  };
}

const PINNED = {
  postingAnalysis: { requirements: [{ id: "q3", text: "Kubernetes experience", kind: "requirement" }] },
  keywordMap: { entries: [] },
};
const beforeReview = {
  status: "reviewed",
  draftKind: "applicationReady",
  flags: detectMissingKeyword({ kind: "applicationReady", spans: [{ id: "s1", text: "Built tools" }] }, PINNED.postingAnalysis),
  unresolvedQualifications: [],
  lineCount: 1,
};

const scaffold = {
  warnings: [],
  scraped: { description: "", company: "", jobTitle: "" },
  postingMeta: { jobTitle: "", companyName: "" },
};

describe("gateIdealRequest - the refusal the regenerate REUSES (canary, green on HEAD)", () => {
  // Disclosed: this reuses shipped behaviour, so it is GREEN on HEAD and is NOT
  // counted in the RED set. It is load-bearing once the regenerate dispatch lands:
  // an unsupported engine must refuse with ZERO artifact, never emit an ungated
  // regenerate presented as truthful.
  it("an embedded engine is refused HTTP 422 with no artifact", () => {
    const res = gateIdealRequest({
      engineName: "embedded",
      engine: { name: "embedded", supportsIdeal: false },
      getEngine: () => ({ name: "embedded", supportsIdeal: false }),
      resumeText: "Jordan",
      resumeFileName: "r.docx",
    });
    expect(res.refused).toBeTruthy();
    expect(res.refused.status).toBe(422);
    expect(res.refused.body.result).toBeUndefined();
    expect(res.refused.body.ideal).toBeUndefined();
  });
});

describe("runIdealBranch - regenerate dispatch (RED on HEAD: branch ignores the new fields)", () => {
  it("a regenerate request returns the GATED resume plus a closure report", async () => {
    const engine = geminiStub();
    const out = await runIdealBranch({
      engine,
      args: {
        jobPosting: "payments role",
        resumeText: RESUME,
        resumeFileName: "r.docx",
        pinnedAnalysis: PINNED,
        beforeReview,
        weaknessSteering: { resolvable: [{ category: "missing-keyword", term: "Kubernetes" }] },
      },
      ...scaffold,
    });
    expect(out.status).toBe(200);
    // gated submittable resume: the fabrication is gone
    expect(out.body.result).not.toContain("FDA Class-III");
    // the regenerate dispatched to regenerateToAddress -> a closure report rides along
    expect(out.body.closure).toBeTruthy();
    expect(Array.isArray(out.body.closure.closed)).toBe(true);
    expect(out.body.closure.closed.map((c) => String(c.term).toLowerCase())).toContain("kubernetes");
    // never the ungated route
    expect(engine.tailorResume).not.toHaveBeenCalled();
  });

  it("a FIRST-RUN request (no pinnedAnalysis) carries NO closure (control / AC-8)", async () => {
    const out = await runIdealBranch({
      engine: geminiStub(),
      args: { jobPosting: "payments role", resumeText: RESUME, resumeFileName: "r.docx" },
      ...scaffold,
    });
    expect(out.status).toBe(200);
    expect(out.body.closure ?? null).toBeNull();
  });
});
