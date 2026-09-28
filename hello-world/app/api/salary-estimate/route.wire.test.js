import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// N65 step 1, K1 — THE WIRE TEST. The single instrument that catches the R-267
// silent-drop: if `tools` is nested inside a `config` object instead of sent
// TOP-LEVEL, the SDK drops it, no google_search runs, and the route returns a
// perfectly normal-looking answer with NO grounding behind it — a full grounded
// bill for an ungrounded guess. An assertion against an INJECTED FAKE client
// cannot see that layer (it sees whatever object the route hands it); only the
// real transport with a stubbed `fetch`, reading the bytes, catches it. That is
// what `lib/llm/geminiWireProbe.js` exists for, and this file is the ONLY test
// in the feature that pins it.
//
// This route uses `client.interactions.create`, where `tools` is TOP-LEVEL and
// there is NO `config` object at all — the OPPOSITE of `models.generateContent`.
// The K1 mutant (nest `tools` inside `config`) is watched failing this test in
// the seat's report.
//
// A FRESH CLIENT IS BUILT INSIDE EACH CAPTURE WINDOW (the Interactions transport
// binds globalThis.fetch at first access), so getGeminiClient is mocked with an
// IMPLEMENTATION, exactly as the digest wire test does.
//
// RED ON HEAD: app/api/salary-estimate/route.js does not exist — collection red.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const request = () =>
  new Request("http://localhost/api/salary-estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Senior Platform Engineer", company: "Acme Robotics", location: "Remote (US)" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(),
  });
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  // The REAL client, built lazily inside the capture window. A fake here would
  // reproduce exactly the blindness that let the original R-267 defect ship.
  getGeminiClient.mockImplementation(() => new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the salary estimate asks the Interactions API for search on the wire (K1)", () => {
  it("sends google_search as a TOP-LEVEL tool on the interactions request body", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies).toHaveLength(1);
    // The whole point: nesting this under `config` would make it VANISH from the
    // wire. `toolsOf` reads the top-level key on the captured body.
    expect(toolsOf(bodies[0])).toEqual([{ type: "google_search" }]);
  });

  it("proves from the body alone the request went to Interactions, not generateContent", async () => {
    // An Interactions body carries `input`; a generateContent body carries
    // `contents` and a `config`. If a future change reverted the surface, tools
    // could still be present (nested) and the first test could pass — this one
    // pins the surface itself.
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies[0]?.input).toBeDefined();
    expect(bodies[0]?.contents).toBeUndefined();
    expect(bodies[0]?.config).toBeUndefined();
    // The role/company actually reached the query (the input is not empty).
    expect(String(JSON.stringify(bodies[0]?.input))).toContain("Acme Robotics");
  });
});
