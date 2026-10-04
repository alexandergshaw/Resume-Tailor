// N105 Step 4 (4b) — the route N105 branch: refusals, dispatch, duration bound.
// Binds to: N105.plan.r2.md Step 4 + PL-7/PL-14; N105.design.r2.md §2 + D-3/D-3b;
// AC-1, AC-2, UX-7/8/9, D-3b (resolved-engine gate), R-9 (maxDuration), UX-42.
//
// WHY K5 IS A POWER ROW (SILENT). The refusal gate must read engine.supportsIdeal
// AFTER the external->gemini fallback resolves, else an unconfigured-external
// Ideal request either phantom-refuses a capable run or silently runs gemini
// unflagged. And tailorMode must never leak into parseAggressiveness (AC-1):
// clamped to 5, N105 is silently absorbed into "Strong".
//
// Conventions copied from app/api/tailor/route.test.js (fake engines registered
// via registerEngine; POST takes { formData }). RED on HEAD: the route ignores
// tailorMode (returns the standard 200), exports no maxDuration, and never calls
// tailorIdeal. The "supported engine runs" positive controls depend on the full
// pipeline stack and are satisfiability-proven only in the reference pass.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { registerEngine } from "@/lib/llm/engines";
import * as route from "./route.js";

const { POST } = route;

function fakeSupabase(userId) {
  return { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) } };
}

function textFile(name, content, type = "text/plain") {
  const f = new File([content], name, { type });
  f.text = async () => content;
  return f;
}

function idealRequest({ engine = "gemini", resumeText = "Jane Doe\nEngineer\nReduced tickets at Acme.", resumeFileName = "resume.txt" } = {}) {
  const fd = new FormData();
  fd.append("jobPosting", "We need a payments engineer.");
  fd.append("resume", textFile(resumeFileName, resumeText));
  fd.append("templateLines", JSON.stringify(["Jane Doe", "Engineer"]));
  fd.append("engine", engine);
  fd.append("tailorMode", "ideal");
  return { formData: async () => fd };
}

// A fake engine with configurable Ideal capability. tailorResume covers the
// standard path (so a mis-routed request still returns something to assert on).
function fakeEngine(name, { supportsIdeal, tailorIdeal } = {}) {
  const engine = {
    name,
    async tailorResume() {
      return { engine: name, result: "STANDARD", resultLines: ["STANDARD"], jobTitle: "T", companyName: "C" };
    },
    async tailorCoverLetter() {
      return { engine: name, result: "", resultLines: [] };
    },
    async tailorHiringEmail() {
      return null;
    },
  };
  if (supportsIdeal !== undefined) engine.supportsIdeal = supportsIdeal;
  if (tailorIdeal) engine.tailorIdeal = tailorIdeal;
  return engine;
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue(fakeSupabase(null));
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", resumeEngine: "gemini" });
});

describe("AC-2 / UX-7 — embedded and external REFUSE Ideal with a 422 and ZERO artifact", () => {
  it("embedded Ideal -> 422 with refusal { level, code:'engine-unsupported', requires:'gemini' } and no output keys", async () => {
    registerEngine(fakeEngine("embedded", { supportsIdeal: false }));
    const res = await POST(idealRequest({ engine: "embedded" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.refusal).toMatchObject({ level: "ideal", code: "engine-unsupported", requires: "gemini" });
    expect(body.error).toEqual(expect.any(String));
    // Zero artifact: none of the output keys present.
    expect(body).not.toHaveProperty("result");
    expect(body).not.toHaveProperty("ideal");
  });

  // A CONFIGURED but Ideal-incapable external engine refuses. NOTE (R-12): how
  // the route detects an unconfigured-vs-configured external is a plan/impl input
  // (design §2); this test sets the configured state explicitly and pins the
  // OUTCOME (a resolved, Ideal-incapable engine refuses), not the mechanism.
  it("a CONFIGURED external (supportsIdeal:false) Ideal -> 422 engine-unsupported", async () => {
    const prev = process.env.RESUME_TAILOR_API_URL;
    process.env.RESUME_TAILOR_API_URL = "https://external.test";
    try {
      registerEngine(fakeEngine("external", { supportsIdeal: false }));
      const res = await POST(idealRequest({ engine: "external" }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.refusal?.code).toBe("engine-unsupported");
    } finally {
      if (prev === undefined) delete process.env.RESUME_TAILOR_API_URL;
      else process.env.RESUME_TAILOR_API_URL = prev;
    }
  });

  it("the refusal does NOT call the engine's generation (no artifact spent)", async () => {
    const tailorResume = vi.fn(async () => ({ engine: "embedded", result: "X", resultLines: ["X"] }));
    const engine = fakeEngine("embedded", { supportsIdeal: false });
    engine.tailorResume = tailorResume;
    registerEngine(engine);
    await POST(idealRequest({ engine: "embedded" }));
    expect(tailorResume).not.toHaveBeenCalled();
  });
});

describe("UX-9 — empty/unreadable resume text refuses BEFORE any model call", () => {
  it("Ideal with an empty resume -> 422 refusal.code='empty-resume', tailorIdeal never called", async () => {
    const tailorIdeal = vi.fn(async () => ({}));
    registerEngine(fakeEngine("gemini", { supportsIdeal: true, tailorIdeal }));
    const res = await POST(idealRequest({ engine: "gemini", resumeText: "", resumeFileName: "scan.txt" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.refusal?.code).toBe("empty-resume");
    expect(tailorIdeal).not.toHaveBeenCalled();
  });
});

describe("D-3b / K5 — the refusal gate reads the RESOLVED engine (post external->gemini fallback)", () => {
  // NOTE (R-12): the detection mechanism is a plan/impl input; this test pins the
  // OUTCOME — an UNCONFIGURED external (no RESUME_TAILOR_API_URL) under Ideal must
  // resolve onto gemini and RUN, never phantom-refuse. The env is left unset.
  it("unconfigured-external under Ideal runs on gemini (supported), NOT a phantom refusal", async () => {
    const prev = process.env.RESUME_TAILOR_API_URL;
    delete process.env.RESUME_TAILOR_API_URL;
    const external = fakeEngine("external", { supportsIdeal: false });
    const geminiTailorIdeal = vi.fn(async () => ({
      postingAnalysis: {}, keywordMap: {},
      hypothetical: { result: "HYPO", resultLines: ["HYPO"], jobTitle: "T", companyName: "C" },
      applicationReadyCandidate: { result: "Reduced tickets at Acme.", resultLines: ["Reduced tickets at Acme."], jobTitle: "T", companyName: "C" },
    }));
    registerEngine(external);
    registerEngine(fakeEngine("gemini", { supportsIdeal: true, tailorIdeal: geminiTailorIdeal }));
    try {
      const res = await POST(idealRequest({ engine: "external" }));
      // The capable run must actually happen: a 200 with an `ideal` block, NOT a
      // phantom engine-unsupported 422. On HEAD there is no N105 branch at all, so
      // no `ideal` block is produced -> this reds (a real red, not a vacuous one).
      // A gate-before-fallback mutant 422-refuses -> status !== 200 -> reds.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ideal).toBeTruthy();
      expect(body.refusal?.code).not.toBe("engine-unsupported");
    } finally {
      if (prev === undefined) delete process.env.RESUME_TAILOR_API_URL;
      else process.env.RESUME_TAILOR_API_URL = prev;
    }
  });
});

describe("AC-1 — the Ideal request is NOT clamped into aggressiveness=5", () => {
  it("a supported Ideal run produces an `ideal` block (the N105 path), not a plain standard result", async () => {
    const tailorIdeal = vi.fn(async () => ({
      postingAnalysis: {}, keywordMap: {},
      hypothetical: { result: "HYPO best-case", resultLines: ["HYPO best-case"], jobTitle: "T", companyName: "C" },
      applicationReadyCandidate: { result: "Reduced tickets at Acme.", resultLines: ["Reduced tickets at Acme."], jobTitle: "T", companyName: "C" },
    }));
    registerEngine(fakeEngine("gemini", { supportsIdeal: true, tailorIdeal }));
    const res = await POST(idealRequest({ engine: "gemini" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ideal).toBeTruthy();
    expect(body.ideal.applicationReady).toBeTruthy();
    expect(body.ideal.hypothetical).toBeTruthy();
    // tailorIdeal ran; the standard clamp path did not absorb it.
    expect(tailorIdeal).toHaveBeenCalled();
  });

  // UX-42: the top-level result the existing consumers read is the APPLICATION-
  // READY, never the hypothetical.
  it("UX-42: top-level result equals the application-ready, not the hypothetical", async () => {
    const tailorIdeal = vi.fn(async () => ({
      postingAnalysis: {}, keywordMap: {},
      hypothetical: { result: "HYPO best-case", resultLines: ["HYPO best-case"], jobTitle: "T", companyName: "C" },
      applicationReadyCandidate: { result: "Reduced tickets at Acme.", resultLines: ["Reduced tickets at Acme."], jobTitle: "T", companyName: "C" },
    }));
    registerEngine(fakeEngine("gemini", { supportsIdeal: true, tailorIdeal }));
    const res = await POST(idealRequest({ engine: "gemini" }));
    const body = await res.json();
    expect(body.result).toBe(body.ideal.applicationReady.result);
    expect(body.result).not.toBe(body.ideal.hypothetical.result);
  });
});

describe("R-9 / PL-14 — the route declares a numeric maxDuration", () => {
  it("exports a numeric maxDuration (the chain's atomic run is not killed at the platform default)", () => {
    expect(typeof route.maxDuration).toBe("number");
    expect(route.maxDuration).toBeGreaterThan(0);
  });
});
