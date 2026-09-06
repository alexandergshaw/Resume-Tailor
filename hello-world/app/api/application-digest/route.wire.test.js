import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// AC-Y2. The tracking table's researched digest actually ASKS for Google
// Search on the wire — and it now asks a DIFFERENT API than every other
// grounded call site in this repo.
//
// THE SURFACE MIGRATED, AND THE TWO REQUEST SHAPES ARE INVERTED.
//   * `models.generateContent` — seven call sites, unchanged: `tools` lives
//     INSIDE `config`. `GenerateContentParameters` has exactly three
//     properties (`model`, `contents`, `config`), and the SDK's parameter
//     transformer silently discards everything else, so a top-level `tools`
//     never reaches Google. The third test in this file still pins that.
//   * `interactions.create` — this route, and only this route: `tools` is
//     TOP-LEVEL, the input field is `input` (not `contents`), and there is no
//     `config` object at all.
// An assertion copied between the two is wrong in both directions. Nothing in
// this file may be propagated to the other seven wire tests.
//
// WHY THIS DRIVES THE REAL SDK. `route.test.js` asserts the request shape
// against an INJECTED FAKE client, which sees whatever object the route hands
// it and cannot observe the layer that drops a key — that assertion was green
// for months against a request that never carried `tools`. Only the real
// transport can catch it, so this file stubs `fetch` and reads the bytes. See
// `lib/llm/geminiWireProbe.js`.
//
// A FRESH CLIENT IS BUILT INSIDE EACH CAPTURE WINDOW, deliberately. The
// Interactions transport binds `globalThis.fetch` at the first `.interactions`
// access and holds that reference, so a client reused across windows can send
// its request to a stub that has already been restored. `getGeminiClient` is
// mocked with an IMPLEMENTATION rather than a return value for exactly that
// reason — the route calls it inside the window, so the client is built there.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({
  listDigests: vi.fn(),
  upsertDigest: vi.fn(),
}));

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { listDigests, upsertDigest } from "@/lib/supabase/applicationDigests";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";

const POSITION = {
  id: "p1",
  company: "Acme Robotics",
  title: "Senior Platform Engineer",
  location: "Remote (US)",
  description: "Own our Kubernetes estate.",
};

const request = () =>
  new Request("http://localhost/api/application-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: APP_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: APP_ID, user_id: "user-1", positions: POSITION },
      error: null,
    }),
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => chain),
  });
  // wantsEmbedded reads process.env directly, not the mocked getServerEnv.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  listDigests.mockResolvedValue({ digests: {}, error: null });
  upsertDigest.mockImplementation(async (_s, _u, id, fields) => ({
    digest: { application_id: id, ...fields },
    error: null,
  }));
  // The REAL client, built lazily INSIDE the capture window. A fake here would
  // reproduce exactly the blindness that let the original defect ship.
  getGeminiClient.mockImplementation(() => new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the digest asks the Interactions API for search on the wire (AC-Y2)", () => {
  it("sends google_search as a TOP-LEVEL tool on the interactions request body", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toEqual([{ type: "google_search" }]);
  });

  it("proves from the body alone that the request went to Interactions, not generateContent", async () => {
    // The surface discriminator, needing no probe change: an Interactions body
    // carries `input`; a generateContent body carries `contents`. If a future
    // change reverts the call site, `tools` would still be present (nested,
    // and therefore also on the wire) and the test above would still pass.
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies[0]?.input).toBeDefined();
    expect(bodies[0]?.contents).toBeUndefined();
    expect(String(JSON.stringify(bodies[0]?.input))).toContain("Acme Robotics");
  });

  it("sends no response_format, response_mime_type or generation_config beside the search tool", async () => {
    // The predecessor of this test asserted `generationConfig.responseMimeType`
    // was undefined. On an Interactions body that whole object is absent, so
    // the assertion would have passed VACUOUSLY — a test that can no longer
    // fail reads as coverage on every future audit. The positive control below
    // is what stops an empty or missing body satisfying it: a forced response
    // format is what would silently kill grounded prose.
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toBeDefined();
    expect(bodies[0]?.input).toBeDefined();
    expect(bodies[0]?.response_format).toBeUndefined();
    expect(bodies[0]?.response_mime_type).toBeUndefined();
    expect(bodies[0]?.generation_config).toBeUndefined();
    expect(bodies[0]?.generationConfig).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped on generateContent (AC-Y2)", () => {
  it("proves the SDK discards a top-level tools key on models.generateContent", async () => {
    // A standing negative control for the surface this route NO LONGER USES.
    // It never touched the route — it builds its own client and calls
    // `models.generateContent` directly — so the migration neither breaks it
    // nor inverts it: the fact it pins is still true, and seven other grounded
    // call sites still depend on it. Do not delete it, and do not "update" it
    // to the Interactions shape; those are different APIs with opposite rules.
    // If a future SDK starts honouring the top-level key this goes red, which
    // is the right outcome: it means every comment about the rule is stale.
    const bodies = await captureGeminiRequests(() =>
      new GoogleGenAI({ apiKey: "test-key" }).models.generateContent({
        model: "gemini-2.5-flash",
        contents: "hi",
        tools: [{ googleSearch: {} }],
        config: { systemInstruction: "sys" },
      }),
    );
    expect(toolsOf(bodies[0])).toBeUndefined();
  });
});
