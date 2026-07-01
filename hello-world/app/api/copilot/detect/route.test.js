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

function mockUser(id = "user-1") {
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
