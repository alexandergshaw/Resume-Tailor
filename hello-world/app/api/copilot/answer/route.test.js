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

const PROFILE = [
  "Senior Software Engineer, Acme Corp",
  "Jan 2020 – Present",
  "Built a React and Node.js platform serving 2M users.",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/copilot/answer (embedded engine)", () => {
  it("401s when not signed in", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ question: "Tell me about yourself.", engine: "embedded" }));
    expect(res.status).toBe(401);
  });

  it("drafts STAR talking points on-device — no Gemini call", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you handled a tight deadline.",
        profile: PROFILE,
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.type).toBe("behavioral");
    expect(Array.isArray(data.points)).toBe(true);
    expect(data.points[0]).toMatch(/^Situation:/);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("400s when no question is provided", async () => {
    mockUser();
    const res = await POST(jsonRequest({ question: "  ", engine: "embedded" }));
    expect(res.status).toBe(400);
  });
});
