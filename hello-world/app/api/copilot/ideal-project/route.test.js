// N125 §3.6 (L5-accept / L10 / L12): the NEW POST /api/copilot/ideal-project
// endpoint — the per-question TAILORED channel plus the READY serve, the two
// examples' single server home. The per-question MODEL accept that used to
// live on the answer path (idealProjectWiring.test.js, now re-pointed) is
// asserted HERE.
//
// RED on HEAD: app/api/copilot/ideal-project/route.js does not exist yet, so
// this file fails to load until step 7 lands it.
//
// GROUNDING NOTE (TDD): these assertions are grounded on the design §3.6
// RESPONSE CONTRACT ({ tier, source, idealProject }) — they PIN that contract
// rather than having been run against a built endpoint. The TDD seat did not
// reference-build the endpoint (it is step-7 production code). The 4b checker /
// implementer closes satisfiability against the real handler.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache, idealProjectPoolCache, idealProjectTailoredCache } from "@/lib/copilot/answerSessionCache";

// A product posting — its DETERMINISTIC archetype title differs from
// GOOD_EXAMPLE.title below, which is how a test tells "served the model
// example" from "served the deterministic fallback".
const POSTING = [
  "Senior Product Manager, Education Technology",
  "We are hiring a product manager to own our K-12 product suite end to end.",
  "You will run Agile ceremonies and partner with UX design and customer success to shape the product roadmap.",
].join("\n");

const GOOD_EXAMPLE = {
  title: "Rebuilding the enrolment workflow teachers actually use, in Education.",
  sections: [
    { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the enrolment flow ran to seven screens." },
    { label: "Built", body: "A single-screen flow with the roster pre-filled from the student system, and an assistant flagging incomplete records before submission." },
    { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so settled trade-offs stayed settled." },
    { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the part that did not move at all." },
  ],
  outcomes: [
    { metric: "adoption rate", figure: "34% → 71% of teachers active weekly" },
    { metric: "user satisfaction / NPS", figure: "teacher NPS +9 → +38" },
    { metric: "time-to-ship", figure: "median idea-to-production 9 weeks → 3" },
  ],
};

function mockUser(description = POSTING, user = { id: "user-1" }) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === "applications") return { data: { id: "app-1", positions: { description } }, error: null };
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) }, from });
}

function mockGemini(example = GOOD_EXAMPLE) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async () => ({ text: JSON.stringify(example) }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

const call = (body) => POST({ json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
});

describe("POST /api/copilot/ideal-project — READY serve (N125 §3.6, L12)", () => {
  it("serves the deterministic example on a COLD pool, source 'fallback', without blocking on the model", async () => {
    mockUser();
    mockGemini(GOOD_EXAMPLE); // the self-prime loader returns a model example...
    const res = await call({ applicationId: "app-1", question: "Tell me about a project.", mode: "answer", engine: "gemini" });
    const data = await res.json();
    expect(data.tier).toBe("ready");
    expect(data.source).toBe("fallback");
    expect(data.idealProject).not.toBeNull();
    expect(data.idealProject.project.sections).toHaveLength(4);
    // ...but the SERVE peeked (a cold miss) rather than awaiting it, so the
    // served example is the deterministic archetype, NOT GOOD_EXAMPLE. This is
    // the endpoint's latency invariant: no model call is awaited on the serve.
    expect(data.idealProject.project.title).not.toBe(GOOD_EXAMPLE.title);
  });

  it("serves the deterministic example for the embedded engine, source 'fallback', ZERO model calls", async () => {
    mockUser();
    const generateContent = mockGemini(GOOD_EXAMPLE);
    const res = await call({ applicationId: "app-1", question: "Tell me about a project.", mode: "answer", engine: "embedded" });
    const data = await res.json();
    expect(data.tier).toBe("ready");
    expect(data.source).toBe("fallback");
    expect(data.idealProject.project.sections).toHaveLength(4);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("POST /api/copilot/ideal-project — TAILORED serve (N125 §3.6, L5-accept/L10)", () => {
  it("ENRICHES the deterministic aid with the per-question model example (keeps shape/summary/metrics, swaps project)", async () => {
    mockUser();
    mockGemini(GOOD_EXAMPLE);
    const res = await call({ applicationId: "app-1", question: "Tell me about a project you owned.", mode: "answer", engine: "gemini", tailored: true });
    const data = await res.json();
    expect(data.tier).toBe("tailored");
    expect(data.source).toBe("model");
    expect(data.idealProject).not.toBeNull();
    // Enrich, not substitute: deterministic shape/summary/metrics survive...
    expect(typeof data.idealProject.shape).toBe("string");
    expect(data.idealProject.summary).toMatch(/^They want a project built around/);
    expect(data.idealProject.metrics.length).toBeGreaterThan(0);
    // ...and the MODEL example is what `project` carries.
    expect(data.idealProject.project.title).toBe(GOOD_EXAMPLE.title);
  });

  it("returns idealProject null (never an error) when the tailored model call fails", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn(() => Promise.reject(new Error("network gone"))) } });
    const res = await call({ applicationId: "app-1", question: "Tell me about a project you owned.", mode: "answer", engine: "gemini", tailored: true });
    const data = await res.json();
    expect(data.tier).toBe("tailored");
    expect(data.idealProject).toBeNull();
    expect(data.source).toBeNull();
  });

  it("makes ZERO model calls for the embedded engine even when tailored:true is sent directly", async () => {
    mockUser();
    const generateContent = mockGemini(GOOD_EXAMPLE);
    const res = await call({ applicationId: "app-1", question: "Tell me about a project.", mode: "answer", engine: "embedded", tailored: true });
    const data = await res.json();
    expect(data.idealProject).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("POST /api/copilot/ideal-project — auth", () => {
  it("401s an unauthenticated request", async () => {
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) }, from: vi.fn() });
    const res = await call({ applicationId: "app-1", question: "Tell me about a project.", mode: "answer", engine: "gemini" });
    expect(res.status).toBe(401);
  });
});

// [REAL-ENV] (design §13): the 6s TAILORED deadline VALUE and whether TAILORED
// is the topmost-ideal for the exact question both need a live GEMINI key and
// real wall-clock. The settleWithin(..., 6000) timeout BEHAVIOUR is asserted
// above via a failing (rejecting) model call; the 6000ms NUMBER is not pinned
// here on purpose.
describe.skip("[REAL-ENV] TAILORED 6s deadline value and model role-fit (needs GEMINI_API_KEY)", () => {
  it("bounds the tailored wait at the tuned deadline", () => {});
});
