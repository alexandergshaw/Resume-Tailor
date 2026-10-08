import { describe, it, expect, vi, beforeEach } from "vitest";

// N143 owner ruling (2026-10-08): the Row-2 sub-route carries NO per-user rate
// limit. It first shipped with 40 per ten minutes; the owner removed the cap
// because it could only ever refuse a real person mid-interview. The spend
// bound for this feature lives on the pool PREWARM route instead.
//
// This is the behavioural half of that ruling (lib/rateLimit/adoption.test.js
// holds the static half). The request count is well past the old ceiling of 40,
// from ONE user, so a limiter that came back at any figure up to 60 would 429
// somewhere in the run. route.test.js in this directory is untouched.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn(() => ({})) }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));
vi.mock("@/lib/copilot/projectExampleGen", () => ({
  generateOnTheSpotProject: vi.fn(),
  stripPostingFigures: vi.fn((e) => e),
}));

import { createClient } from "@/lib/supabase/server";
import { generateOnTheSpotProject } from "@/lib/copilot/projectExampleGen";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "unmetered-user";
const POSITION = { id: "p1", company: "Acme", title: "SRE", description: "Own the estate." };
const ENTRY = { competency: "incident response", domain: "SRE", title: "t", bullets: ["a one", "b two"], hypothetical: true };

function signIn() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { id: APP_ID, user_id: USER_ID, positions: POSITION },
    error: null,
  });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: vi.fn(() => chain),
  });
}

function req(question) {
  return new Request("http://localhost/api/copilot/answer/project-example", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ applicationId: APP_ID, question, engine: "gemini" }),
  });
}

beforeEach(() => {
  generateOnTheSpotProject.mockReset();
  generateOnTheSpotProject.mockResolvedValue(ENTRY);
  signIn();
});

describe("Row-2 sub-route has no rate limit (owner ruling, 2026-10-08)", () => {
  it("[positive control] a single request is answered with a ready example", async () => {
    const res = await POST(req("Tell me about an incident."));
    expect(res.status).toBe(200);
    expect((await res.json()).projectExample.status).toBe("ready");
  });

  it("answers 60 consecutive requests from one user, none of them a 429", async () => {
    const statuses = [];
    for (let i = 0; i < 60; i += 1) {
      const res = await POST(req(`Question number ${i}?`));
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429)).toEqual([]);
    expect(new Set(statuses)).toEqual(new Set([200]));
    // Every one of them reached the model: nothing was refused before the call.
    expect(generateOnTheSpotProject).toHaveBeenCalledTimes(60);
  });
});
