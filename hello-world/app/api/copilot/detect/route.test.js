import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";

function jsonRequest(body) {
  return { json: async () => body };
}

// Unique per call: the module-scope limiter's counters survive between `it()`
// blocks in this file exactly as they survive between requests in a running
// server, so a shared id would let an early case deny a later one. Same
// discipline as app/api/copilot/ask/route.test.js.
let userSeq = 0;
function mockUser(id = `detect-user-${(userSeq += 1)}`) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/copilot/detect (embedded engine)", () => {
  it("401s when not signed in", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ utterance: "What is your name?", engine: "embedded" }));
    expect(res.status).toBe(401);
  });

  it("detects a question via the heuristic — no Gemini, with a type", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({ utterance: "Tell me about a time you resolved a conflict.", engine: "embedded" }),
    );
    const data = await res.json();
    expect(data.isQuestion).toBe(true);
    expect(data.question).toMatch(/conflict/i);
    expect(data.type).toBe("behavioral");
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("returns the cleaned question, not the raw utterance", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        utterance: "Okay, great, so, um, can you tell me about a time you missed a deadline?",
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.isQuestion).toBe(true);
    expect(data.question).toBe("Can you tell me about a time you missed a deadline?");
  });

  it("classifies a non-question as not a question", async () => {
    mockUser();
    const res = await POST(jsonRequest({ utterance: "Great, thanks for sharing.", engine: "embedded" }));
    const data = await res.json();
    expect(data.isQuestion).toBe(false);
    expect(data.question).toBe("");
    expect(data.type).toBe("general");
  });

  it("400s on an empty utterance", async () => {
    mockUser();
    const res = await POST(jsonRequest({ utterance: "   ", engine: "embedded" }));
    expect(res.status).toBe(400);
  });
});

// Mocks the Gemini path to return exactly the given payload, following the
// same pattern as app/api/copilot/answer/route.test.js's mockGemini.
function mockGemini(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(payload) }),
    },
  });
}

describe("POST /api/copilot/detect (Gemini engine, AC-R2.4)", () => {
  it("401s when not signed in", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ utterance: "What is your name?", engine: "gemini" }));
    expect(res.status).toBe(401);
  });

  it("400s on an empty utterance", async () => {
    mockUser();
    const res = await POST(jsonRequest({ utterance: "   ", engine: "gemini" }));
    expect(res.status).toBe(400);
  });

  it("detects a question via Gemini, same fields as today and no degraded flag", async () => {
    mockUser();
    mockGemini({ isQuestion: true, question: "Why do you want to work here?", type: "general" });
    const res = await POST(
      jsonRequest({ utterance: "So why do you want to work here", context: "", engine: "gemini" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      isQuestion: true,
      question: "Why do you want to work here?",
      type: "general",
    });
    expect(data.degraded).toBeUndefined();
    expect(getGeminiClient).toHaveBeenCalled();
    expect(getServerEnv).toHaveBeenCalled();
  });

  it("classifies a non-question from Gemini's response", async () => {
    mockUser();
    mockGemini({ isQuestion: false, question: "", type: "general" });
    const res = await POST(jsonRequest({ utterance: "We're a team of forty engineers.", engine: "gemini" }));
    const data = await res.json();
    expect(data).toEqual({ isQuestion: false, question: "", type: "general" });
  });
});

describe("POST /api/copilot/detect (LLM unavailable degrades, AC-R2.2)", () => {
  it("falls back to the local heuristic and returns 200 with degraded:true when getServerEnv throws (no API key)", async () => {
    mockUser();
    getServerEnv.mockImplementation(() => {
      throw new Error("Gemini_LLM_API_Key is not set.");
    });
    const res = await POST(
      jsonRequest({ utterance: "Tell me about a time you resolved a conflict.", engine: "gemini" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isQuestion).toBe(true);
    expect(data.question).toMatch(/conflict/i);
    expect(data.type).toBe("behavioral");
    expect(data.degraded).toBe(true);
    expect(typeof data.degradedReason).toBe("string");
    expect(data.degradedReason.length).toBeGreaterThan(0);
  });

  it("degrades when getGeminiClient throws", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockImplementation(() => {
      throw new Error("client construction failed");
    });
    const res = await POST(jsonRequest({ utterance: "What is your greatest strength?", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.degraded).toBe(true);
    expect(data.isQuestion).toBe(true);
  });

  it("degrades when the model call itself throws", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("upstream 503")) },
    });
    const res = await POST(jsonRequest({ utterance: "Great, thanks for sharing.", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.degraded).toBe(true);
    // The heuristic agrees this isn't a question — degrading doesn't force a
    // "yes", it just means the LOCAL answer is used instead of Gemini's.
    expect(data.isQuestion).toBe(false);
  });

  it("still 401s / 400s before ever touching Gemini — genuine client faults are not degraded", async () => {
    mockUser(null);
    const res401 = await POST(jsonRequest({ utterance: "What is your name?", engine: "gemini" }));
    expect(res401.status).toBe(401);

    mockUser();
    const res400 = await POST(jsonRequest({ utterance: "   ", engine: "gemini" }));
    expect(res400.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The spend ceiling. This route fires once per interviewer utterance during a
// LIVE interview -- the highest legitimate request rate in the product -- so the
// bound is deliberately generous and the window short. It still turns an
// unbounded loop against a model call into a bounded one.
// ---------------------------------------------------------------------------
describe("the detect spend ceiling actually bites", () => {
  const LIMIT = 90;
  const body = { utterance: "Tell me about a time you resolved a conflict.", engine: "embedded" };

  it("denies past the bound with 429, Retry-After and the RateLimit-* headers", async () => {
    mockUser("detect-greedy");

    const statuses = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      statuses.push((await POST(jsonRequest(body))).status);
    }

    // A limiter built INSIDE the handler gets a fresh store on every request,
    // so every caller is forever on its first request and all LIMIT+1 succeed.
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMIT);
    expect(statuses[LIMIT]).toBe(429);

    const denied = await POST(jsonRequest(body));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("RateLimit-Limit")).toBe(String(LIMIT));
  });

  it("denies with a 429 rather than degrading to the local heuristic", async () => {
    // The Gemini path here degrades to localDetection on ANY failure and
    // answers 200. A rate-limited request must NOT take that door: a caller
    // over its allowance has to see the 429, or the bound is invisible to it
    // and it never backs off.
    mockUser("detect-degrade");
    for (let i = 0; i < LIMIT + 1; i += 1) await POST(jsonRequest(body));

    getServerEnv.mockImplementation(() => {
      throw new Error("Gemini_LLM_API_Key is not set.");
    });
    const denied = await POST(jsonRequest({ ...body, engine: "gemini" }));
    expect(denied.status).toBe(429);
    const data = await denied.json();
    expect(data.degraded).toBeUndefined();
  });

  it("counts per authenticated user, so one caller's flood cannot deny another", async () => {
    mockUser("detect-flooder");
    for (let i = 0; i < LIMIT + 1; i += 1) await POST(jsonRequest(body));
    expect((await POST(jsonRequest(body))).status).toBe(429);

    mockUser("detect-bystander");
    expect((await POST(jsonRequest(body))).status).toBe(200);
  });
});
