import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { critiqueAnswerLocal, normalizeMetrics } from "@/lib/copilot/critiqueLocal";

function jsonRequest(body) {
  return { json: async () => body };
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

// Mocks the Gemini path to return exactly the given critique payload, the
// same shape the route asks the model for via buildPrompt's JSON contract.
function mockGemini(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(payload) }),
    },
  });
}

// A behavioral answer that actually trips all four STAR cues detected by
// lib/copilot/critiqueLocal.js, so the embedded rubric hands back a real
// (non-null, all-true) star breakdown rather than an empty one.
const STAR_ANSWER =
  "When I was at Acme Corp, my task was to reduce deployment time. I built a new CI pipeline. As a result, we reduced deployment time by 40%.";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/copilot/critique", () => {
  it("401s when not signed in, with the interview-copilot sign-in message", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ question: "Q", type: "general", answer: "A", engine: "embedded" }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Sign in to use the interview copilot.");
  });
});

describe("POST /api/copilot/critique (embedded engine)", () => {
  it("returns the deterministic critique with source 'embedded', never touches Gemini, and never parses frames", async () => {
    mockUser();
    const question = "Tell me about a time you resolved a conflict.";
    const type = "behavioral";
    const bodyWithJunkFrames = {
      question,
      type,
      answer: STAR_ANSWER,
      engine: "embedded",
      // Garbage that would need real parsing to survive if this path ever
      // looked at frames at all.
      frames: ["not-a-real-frame", 123, { evil: true }, "data:image/jpeg;base64,not-base64!!"],
    };
    const res = await POST(jsonRequest(bodyWithJunkFrames));
    expect(res.status).toBe(200);
    const data = await res.json();

    const expected = critiqueAnswerLocal({
      question,
      type,
      answer: STAR_ANSWER,
      posting: null,
      profile: "",
      metrics: normalizeMetrics(null),
    });
    expect(data.score).toBe(expected.score);
    expect(data.verdict).toBe(expected.verdict);
    expect(data.source).toBe("embedded");
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();

    // Frames have zero effect on this path: the same request with no
    // frames field at all must produce a byte-identical response.
    const resNoFrames = await POST(jsonRequest({ question, type, answer: STAR_ANSWER, engine: "embedded" }));
    const dataNoFrames = await resNoFrames.json();
    expect(data).toEqual(dataNoFrames);
  });
});

describe("POST /api/copilot/critique (server-assigned source cannot be spoofed)", () => {
  it("ignores a Gemini response's own claimed source and reports 'gemini' for the path actually taken", async () => {
    mockUser();
    mockGemini({
      score: 80,
      verdict: "Solid, focused answer.",
      strengths: [],
      improvements: [],
      missing: [],
      star: null,
      delivery: [],
      source: "embedded",
    });
    const res = await POST(
      jsonRequest({ question: "Tell me about a challenge.", type: "general", answer: "I solved a hard bug.", engine: "gemini" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("gemini");
  });
});

describe("POST /api/copilot/critique (star only for behavioral questions)", () => {
  it("embedded: a technical question never returns a star object", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        question: "How would you design a URL shortener?",
        type: "technical",
        answer: "I would use a hash function and a key-value store.",
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.star).toBeNull();
  });

  it("embedded: a behavioral question returns a real STAR breakdown", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you resolved a conflict.",
        type: "behavioral",
        answer: STAR_ANSWER,
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.star).toEqual({ situation: true, task: true, action: true, result: true });
  });

  it("gemini: forces star to null for a non-behavioral type even when the model returns one", async () => {
    mockUser();
    mockGemini({
      score: 70,
      verdict: "Reasonable technical approach.",
      strengths: [],
      improvements: [],
      missing: [],
      star: { situation: true, task: true, action: true, result: true },
      delivery: [],
    });
    const res = await POST(
      jsonRequest({ question: "Explain caching.", type: "technical", answer: "I would use an LRU cache.", engine: "gemini" }),
    );
    const data = await res.json();
    expect(data.star).toBeNull();
  });

  it("gemini: passes through a behavioral star breakdown from the model, coerced to booleans", async () => {
    mockUser();
    mockGemini({
      score: 75,
      verdict: "Good STAR coverage.",
      strengths: [],
      improvements: [],
      missing: [],
      star: { situation: 1, task: 0, action: "yes", result: null },
      delivery: [],
    });
    const res = await POST(
      jsonRequest({ question: "Tell me about a conflict.", type: "behavioral", answer: STAR_ANSWER, engine: "gemini" }),
    );
    const data = await res.json();
    expect(data.star).toEqual({ situation: true, task: false, action: true, result: false });
  });
});

describe("POST /api/copilot/critique (frame sanitation reaches Gemini only, and only the good ones)", () => {
  it("drops a non-JPEG data URL, undecodable base64, a non-string entry, and anything past the third frame", async () => {
    mockUser();
    mockGemini({
      score: 60,
      verdict: "Reasonable.",
      strengths: [],
      improvements: [],
      missing: [],
      star: null,
      delivery: [],
    });
    const frames = [
      "data:image/jpeg;base64,aGVsbG8=", // valid #1 ("hello")
      "data:image/png;base64,aGVsbG8=", // wrong mime type -> dropped
      "data:image/jpeg;base64,IR==", // matches the shape but fails the base64 round-trip -> dropped
      12345, // not a string -> dropped
      "data:image/jpeg;base64,d29ybGQ=", // valid #2 ("world")
      "data:image/jpeg;base64,dGhyZWU=", // valid #3 ("three")
      "data:image/jpeg;base64,Zm91cg==", // valid shape, but a 4th frame -> dropped by the MAX_FRAMES cap
    ];
    const res = await POST(jsonRequest({ question: "Q", type: "general", answer: "A", engine: "gemini", frames }));
    expect(res.status).toBe(200);

    const client = getGeminiClient();
    const call = client.models.generateContent.mock.calls[0][0];
    const imageParts = call.contents[0].parts.filter((p) => p.inlineData);
    expect(imageParts.map((p) => p.inlineData.data)).toEqual(["aGVsbG8=", "d29ybGQ=", "dGhyZWU="]);
    expect(imageParts.every((p) => p.inlineData.mimeType === "image/jpeg")).toBe(true);
  });
});

describe("POST /api/copilot/critique (gemini failures still return a usable critique, never a 5xx)", () => {
  it("falls back when Gemini throws", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("network down")) },
    });
    const question = "Tell me about a time you led a project.";
    const type = "behavioral";
    const res = await POST(jsonRequest({ question, type, answer: STAR_ANSWER, engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("embedded");
    const expected = critiqueAnswerLocal({
      question,
      type,
      answer: STAR_ANSWER,
      posting: null,
      profile: "",
      metrics: normalizeMetrics(null),
    });
    expect(data.score).toBe(expected.score);
    expect(data.verdict).toBe(expected.verdict);
  });

  it("falls back when the model's response can't be parsed as JSON", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({ text: "sorry, here is some feedback" }) },
    });
    const res = await POST(jsonRequest({ question: "Q", type: "general", answer: "A", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("embedded");
    expect(typeof data.verdict).toBe("string");
    expect(data.verdict.length).toBeGreaterThan(0);
  });

  it("does not 5xx when the client's delivery metrics are malformed", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const res = await POST(
      jsonRequest({
        question: "Q",
        type: "general",
        answer: "A solid general answer, for example with real specifics.",
        engine: "gemini",
        metrics: {
          wordCount: "not-a-number",
          video: "not-an-object",
          fillers: { not: "an array" },
          paceLabel: "warp-speed",
        },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("embedded");
    expect(Number.isInteger(data.score)).toBe(true);
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(100);
    expect(typeof data.verdict).toBe("string");
    expect(data.verdict.length).toBeGreaterThan(0);
  });
});

describe("POST /api/copilot/critique (response is clamped to the AC-C4-1 contract)", () => {
  it("rounds and clamps an out-of-range score into an integer 0-100", async () => {
    mockUser();
    mockGemini({ score: 142.7, verdict: "Way over the line.", strengths: [], improvements: [], missing: [], star: null, delivery: [] });
    const res = await POST(jsonRequest({ question: "Q", type: "general", answer: "A", engine: "gemini" }));
    const data = await res.json();
    expect(data.score).toBe(100);
    expect(Number.isInteger(data.score)).toBe(true);
  });

  it("clamps a negative score to 0", async () => {
    mockUser();
    mockGemini({ score: -30, verdict: "Terrible.", strengths: [], improvements: [], missing: [], star: null, delivery: [] });
    const res = await POST(jsonRequest({ question: "Q", type: "general", answer: "A", engine: "gemini" }));
    const data = await res.json();
    expect(data.score).toBe(0);
  });

  it("caps strengths/improvements/missing/delivery to 4 items each, keeping the first 4 in order", async () => {
    mockUser();
    const many = (label) => Array.from({ length: 7 }, (_, i) => `${label} ${i + 1}`);
    mockGemini({
      score: 80,
      verdict: "Detailed.",
      strengths: many("Strength"),
      improvements: many("Improvement"),
      missing: many("Missing"),
      star: null,
      delivery: many("Delivery"),
    });
    const res = await POST(jsonRequest({ question: "Q", type: "general", answer: "A", engine: "gemini" }));
    const data = await res.json();
    expect(data.strengths).toEqual(["Strength 1", "Strength 2", "Strength 3", "Strength 4"]);
    expect(data.improvements).toEqual(["Improvement 1", "Improvement 2", "Improvement 3", "Improvement 4"]);
    expect(data.missing).toEqual(["Missing 1", "Missing 2", "Missing 3", "Missing 4"]);
    expect(data.delivery).toEqual(["Delivery 1", "Delivery 2", "Delivery 3", "Delivery 4"]);
  });

  it("drops any unexpected field from the model, returning only the eight contract keys", async () => {
    mockUser();
    mockGemini({
      score: 55,
      verdict: "Fine.",
      strengths: [],
      improvements: [],
      missing: [],
      star: null,
      delivery: [],
      hackerField: "<script>evil()</script>",
      internalDebugInfo: { prompt: "leaked" },
    });
    const res = await POST(jsonRequest({ question: "Q", type: "general", answer: "A", engine: "gemini" }));
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(
      ["delivery", "improvements", "missing", "score", "source", "star", "strengths", "verdict"].sort(),
    );
    expect(data.hackerField).toBeUndefined();
    expect(data.internalDebugInfo).toBeUndefined();
  });
});
