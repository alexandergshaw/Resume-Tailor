import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Route contract for the tracking table's researched digest. Written before
// the route exists.
//
// The expensive mistakes this pins are all about NOT calling the model: not
// for someone else's application, not for the embedded engine, and above all
// not when a digest already exists. A tracking table re-renders constantly;
// a route that researched afresh each time it was asked would bill a grounded
// search per render.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({
  listDigests: vi.fn(),
  upsertDigest: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { listDigests, upsertDigest } from "@/lib/supabase/applicationDigests";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";

const POSITION = {
  id: "p1",
  company: "Acme Robotics",
  title: "Senior Platform Engineer",
  location: "Remote (US)",
  description: "Own our Kubernetes estate.",
};

// The route reads the application scoped to the caller. `found` false models
// "not this user's row" — RLS would return nothing, and so must we.
function supabaseWith({ found = true } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: found ? { id: APP_ID, user_id: "user-1", positions: POSITION } : null,
    error: null,
  });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle,
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => chain),
  });
  return chain;
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: vi.fn(),
  });
}

function geminiReplying(markdown, groundedUris = ["https://www.crunchbase.com/organization/acme"]) {
  const generateContent = vi.fn().mockResolvedValue({
    text: markdown,
    candidates: [
      { groundingMetadata: { groundingChunks: groundedUris.map((uri) => ({ web: { uri, title: "s" } })) } },
    ],
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

const MARKDOWN = "## What the company does\n\nAcme builds warehouse robots. [Crunchbase](https://www.crunchbase.com/organization/acme)";

const request = (body) =>
  new Request("http://localhost/api/application-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  supabaseWith();
  // wantsEmbedded reads process.env directly, not the mocked getServerEnv.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  // The REAL lib/supabase/applicationDigests.js returns `digests` as an OBJECT
  // keyed by application_id, not an array. Mocking it as an array would make
  // every assertion here a test against a shape production never produces.
  listDigests.mockResolvedValue({ digests: {}, error: null });
  upsertDigest.mockImplementation(async (_s, _u, id, fields) => ({ digest: { application_id: id, ...fields }, error: null }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/application-digest", () => {
  it("refuses an unauthenticated caller before reading anything", async () => {
    signedOut();
    const generate = geminiReplying(MARKDOWN);
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
    expect(listDigests).not.toHaveBeenCalled();
  });

  it("rejects a missing application id without calling the model", async () => {
    const generate = geminiReplying(MARKDOWN);
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("will not research an application that is not the caller's", async () => {
    supabaseWith({ found: false });
    const generate = geminiReplying(MARKDOWN);
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(404);
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuses the embedded engine, creating nothing", async () => {
    const generate = geminiReplying(MARKDOWN);
    const res = await POST(request({ applicationId: APP_ID, engine: "embedded" }));
    expect(res.status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
    expect(upsertDigest).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/engine/i) });
  });

  it("returns an existing digest without calling the model again", async () => {
    // The tracking table asks for this on every load. Re-researching would
    // bill a grounded search per page view.
    listDigests.mockResolvedValue({
      digests: { [APP_ID]: { application_id: APP_ID, status: "ready", markdown: MARKDOWN, sources: [] } },
      error: null,
    });
    const generate = geminiReplying(MARKDOWN);
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ digest: { markdown: MARKDOWN } });
  });

  it("re-researches when the caller forces it, which is what the Research button does", async () => {
    listDigests.mockResolvedValue({
      digests: { [APP_ID]: { application_id: APP_ID, status: "ready", markdown: "stale", sources: [] } },
      error: null,
    });
    const generate = geminiReplying(MARKDOWN);
    const res = await POST(request({ applicationId: APP_ID, force: true }));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("researches and stores a digest for a row that has none", async () => {
    const generate = geminiReplying(MARKDOWN);
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0][0];
    // `config.tools`, NOT `call.tools`. This assertion is made against an
    // INJECTED FAKE client, which sees whatever object the route hands it and
    // cannot observe the SDK layer that DISCARDS a top-level `tools` — so it
    // was green for months against a request that never carried the key. The
    // second line is what stops the old shape ever coming back green here;
    // route.wire.test.js proves it on the actual bytes.
    expect(call.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(call.tools).toBeUndefined();
    expect(String(call.contents)).toContain("Acme Robotics");
    expect(upsertDigest).toHaveBeenCalledTimes(1);
    const stored = upsertDigest.mock.calls[0][3];
    expect(stored.status).toBe("ready");
    expect(stored.markdown).toContain("Acme builds warehouse robots");
  });

  it("stores an ungrounded claim without its invented link", async () => {
    // The parser is deliberately unmocked: the guarantee is that nothing
    // between it and the stored row can re-admit a source the model made up.
    geminiReplying("## Recent signals\n\nRaised a Series C. [Report](https://invented.example/x)");
    await POST(request({ applicationId: APP_ID }));
    const stored = upsertDigest.mock.calls[0][3];
    expect(stored.markdown).toContain("Raised a Series C.");
    expect(stored.markdown).not.toContain("invented.example");
  });

  it("records a failure instead of leaving the cell looking untried", async () => {
    const generateContent = vi.fn().mockRejectedValue(new Error("model exploded"));
    getGeminiClient.mockReturnValue({ models: { generateContent } });
    const res = await POST(request({ applicationId: APP_ID }));
    expect(upsertDigest).toHaveBeenCalledTimes(1);
    expect(upsertDigest.mock.calls[0][3].status).toBe("failed");
    // An empty cell reads as "nobody has looked yet"; the user needs to know
    // it was tried and can be retried.
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.digest.status).toBe("failed");
  });

  it("is dynamic and runs on node", async () => {
    const mod = await import("./route.js");
    expect(mod.runtime).toBe("nodejs");
    expect(mod.dynamic).toBe("force-dynamic");
  });
});
