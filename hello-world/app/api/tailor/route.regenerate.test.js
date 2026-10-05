// N104 - the regenerate THROUGH THE ROUTE: the production call site that reads the
// two request fields off the form data and hands them to the Ideal branch (a value
// that crosses a boundary is wired where it is produced, not only where it is used).
//
// What this pins, end to end with only the engine faked:
//   - a gemini regenerate request reaches regenerateToAddress: the engine is asked
//     for the Ideal chain once, with steering derived from the POSTED review, and the
//     response carries the closure report
//   - an embedded or external engine REFUSES a regenerate exactly as it refuses a
//     first run (422, no artifact, the engine never called): the gate the first run
//     passes is the same gate in front of the regenerate
//   - a regenerate with an unreadable field is a 422 with no artifact, not a quiet
//     first-time generation
//   - a first-run request is untouched: no closure, no steering

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { registerEngine } from "@/lib/llm/engines";
import { detectMissingKeyword } from "@/lib/review/mechanicalDetectors";
import { POST } from "./route.js";

const RESUME = [
  "Jordan Rivera",
  "PROFESSIONAL EXPERIENCE",
  "Acme Corp — Senior Engineer (2020-2024)",
  "Reduced support tickets at Acme Corp",
  "Deployed services on Kubernetes at Acme Corp",
].join("\n");

const PIN = {
  postingAnalysis: { requirements: [{ id: "q3", text: "Kubernetes experience", kind: "requirement" }] },
  keywordMap: { entries: [] },
};
const BEFORE = {
  status: "reviewed",
  flags: detectMissingKeyword({ kind: "applicationReady", spans: [{ id: "s1", text: "Built tools" }] }, PIN.postingAnalysis),
  unresolvedQualifications: [],
  lineCount: 1,
};

function textFile(name, content) {
  const f = new File([content], name, { type: "text/plain" });
  f.text = async () => content;
  return f;
}

function request({ engine = "gemini", fields = {} } = {}) {
  const fd = new FormData();
  fd.append("jobPosting", "We need a payments engineer with Kubernetes.");
  fd.append("resume", textFile("resume.txt", RESUME));
  fd.append("templateLines", JSON.stringify(["Jordan Rivera", "Engineer"]));
  fd.append("engine", engine);
  fd.append("tailorMode", "ideal");
  for (const [name, value] of Object.entries(fields)) fd.append(name, typeof value === "string" ? value : JSON.stringify(value));
  return { formData: async () => fd };
}

function fakeEngine(name, { supportsIdeal, tailorIdeal } = {}) {
  const engine = {
    name,
    tailorResume: vi.fn(async () => ({ engine: name, result: "STANDARD", resultLines: ["STANDARD"], jobTitle: "T", companyName: "C" })),
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

const LINES = ["Acme Corp — Senior Engineer (2020-2024)", "Deployed services on Kubernetes at Acme Corp"];
const chain = () => ({
  postingAnalysis: { requirements: [] },
  keywordMap: { entries: [] },
  hypothetical: { result: LINES.join("\n"), resultLines: LINES, jobTitle: "Engineer", companyName: "Acme Corp" },
  applicationReadyCandidate: { result: LINES.join("\n"), resultLines: LINES, jobTitle: "Engineer", companyName: "Acme Corp" },
});

const REGENERATE = { pinnedAnalysis: PIN, beforeReview: BEFORE };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", resumeEngine: "gemini" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a gemini regenerate through the route", () => {
  it("runs the Ideal chain once with steering derived from the posted review, and returns the closure", async () => {
    const tailorIdeal = vi.fn(async () => chain());
    const engine = fakeEngine("gemini", { supportsIdeal: true, tailorIdeal });
    registerEngine(engine);
    const res = await POST(request({ fields: REGENERATE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(tailorIdeal).toHaveBeenCalledTimes(1);
    const sent = tailorIdeal.mock.calls[0][0];
    expect(sent.weaknessSteering.resolvable.map((e) => e.term)).toEqual(["Kubernetes"]);
    expect(sent).not.toHaveProperty("pinnedAnalysis");
    expect(sent).not.toHaveProperty("beforeReview");
    expect(body.closure.correspondenceUnavailable).toBe(false);
    expect(body.closure.closed.map((c) => c.term)).toEqual(["Kubernetes"]);
    expect(body.ideal.postingAnalysis.requirements.map((r) => r.id)).toEqual(["q3"]);
    expect(engine.tailorResume).not.toHaveBeenCalled();
  });

  it("CONTROL: the same request without the two fields is a first run with no closure and no steering", async () => {
    const tailorIdeal = vi.fn(async () => chain());
    registerEngine(fakeEngine("gemini", { supportsIdeal: true, tailorIdeal }));
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.closure).toBeUndefined();
    expect(tailorIdeal.mock.calls[0][0]).not.toHaveProperty("weaknessSteering");
  });

  it("an unreadable field is a 422 with no artifact, and the engine is never asked", async () => {
    const tailorIdeal = vi.fn(async () => chain());
    registerEngine(fakeEngine("gemini", { supportsIdeal: true, tailorIdeal }));
    const res = await POST(request({ fields: { pinnedAnalysis: "not json", beforeReview: BEFORE } }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.failure).toEqual({ stage: "input", code: "bad-input" });
    expect(body).not.toHaveProperty("result");
    expect(body).not.toHaveProperty("ideal");
    expect(tailorIdeal).not.toHaveBeenCalled();
  });
});

describe("an engine that cannot run the Ideal level refuses a regenerate exactly as it refuses a first run", () => {
  it("embedded: 422, no artifact, nothing generated", async () => {
    const engine = fakeEngine("embedded", { supportsIdeal: false });
    registerEngine(engine);
    const res = await POST(request({ engine: "embedded", fields: REGENERATE }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.refusal).toMatchObject({ level: "ideal", code: "engine-unsupported", requires: "gemini" });
    expect(body).not.toHaveProperty("result");
    expect(body).not.toHaveProperty("ideal");
    expect(body).not.toHaveProperty("closure");
    expect(engine.tailorResume).not.toHaveBeenCalled();
  });

  it("external (configured): 422, no artifact, nothing generated", async () => {
    const prev = process.env.RESUME_TAILOR_API_URL;
    process.env.RESUME_TAILOR_API_URL = "https://external.test";
    try {
      const engine = fakeEngine("external", { supportsIdeal: false });
      registerEngine(engine);
      const res = await POST(request({ engine: "external", fields: REGENERATE }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.refusal?.code).toBe("engine-unsupported");
      expect(body).not.toHaveProperty("closure");
      expect(engine.tailorResume).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.RESUME_TAILOR_API_URL;
      else process.env.RESUME_TAILOR_API_URL = prev;
    }
  });
});
