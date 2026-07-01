import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/logChatMessage", () => ({ logChatMessage: vi.fn(async () => {}) }));

import { POST } from "./route.js";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { createClient } from "@/lib/supabase/server";

function jsonRequest(body) {
  return { json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  });
});

describe("POST /api/chat (embedded engine)", () => {
  it("400s when no messages are provided", async () => {
    const res = await POST(jsonRequest({ messages: [], engine: "embedded" }));
    expect(res.status).toBe(400);
  });

  it("answers from context offline — no Gemini call or key", async () => {
    const res = await POST(
      jsonRequest({
        messages: [{ role: "user", content: "how many applications do I have?" }],
        applications: [{ company: "Acme", status: "applied", stages: [] }],
        engine: "embedded",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toMatch(/tracking 1 application/i);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("analyzes a pinned posting offline", async () => {
    const res = await POST(
      jsonRequest({
        messages: [{ role: "user", content: "I need help with this job: what should I emphasize?" }],
        pinnedContext: {
          label: "Backend Engineer",
          content: "Design scalable APIs in Node.js and TypeScript with PostgreSQL and AWS.",
        },
        engine: "embedded",
      }),
    );
    const data = await res.json();
    expect(data.reply).toMatch(/this posting leans most on/i);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });
});
