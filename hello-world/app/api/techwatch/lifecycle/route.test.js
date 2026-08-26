import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Route contract for the grounded lifecycle top-up. Written before the route
// exists.
//
// This is the only Tech Watch endpoint that calls a model, so most of what is
// pinned here is about NOT calling it: not for a signed-out caller, not for the
// embedded engine, not when there is nothing to look up, and not more than the
// per-request cap. The briefing already works without this route; every failure
// path must leave it exactly as it was.
//
// lib/techwatch/lifecycleSearch.js is deliberately NOT mocked - "an ungrounded
// row never reaches the client" is a real integration between this route and
// that parser, and mocking it away would leave the guarantee untested.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/techwatch/cache", () => ({
  cached: vi.fn(async (_key, _ttl, producer) => producer()),
  __resetMemoryCache: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { cached } from "@/lib/techwatch/cache";
import { POST } from "./route.js";

const TECHNOLOGIES = [{ id: "typescript", label: "TypeScript" }];

function signedIn(userId = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

// A grounded model reply: one row, cited to a host the response says it searched.
function geminiReplying(rows, groundedUris = ["https://devblogs.microsoft.com/typescript/x/"]) {
  const generateContent = vi.fn().mockResolvedValue({
    text: JSON.stringify(rows),
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: groundedUris.map((uri) => ({ web: { uri, title: "src" } })),
        },
      },
    ],
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

const ROW = {
  technology: "TypeScript",
  cycle: "5.9",
  latest: "5.9.3",
  supportEndsAt: "2026-03-01",
  eolAt: null,
  state: "security-only",
  sourceUrl: "https://devblogs.microsoft.com/typescript/x/",
};

const request = (body) =>
  new Request("http://localhost/api/techwatch/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  // `wantsEmbedded` reads process.env DIRECTLY, not through the mocked
  // getServerEnv. With no explicit engine and no key present it falls back to
  // "embedded" and every request here would 503 before reaching anything worth
  // testing. app/api/experience/research/route.test.js documents the same trap.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  cached.mockImplementation(async (_key, _ttl, producer) => producer());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/techwatch/lifecycle", () => {
  it("refuses an unauthenticated caller before doing anything else", async () => {
    signedOut();
    const generate = geminiReplying([ROW]);
    const res = await POST(request({ technologies: TECHNOLOGIES }));
    expect(res.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuses the embedded engine with a clear message and no model call", async () => {
    const generate = geminiReplying([ROW]);
    const res = await POST(request({ technologies: TECHNOLOGIES, engine: "embedded" }));
    expect(res.status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
    const body = await res.json();
    expect(String(body.error)).toMatch(/engine/i);
  });

  it("does nothing at all when there is no gap to fill", async () => {
    const generate = geminiReplying([ROW]);
    for (const body of [{ technologies: [] }, {}, { technologies: null }]) {
      const res = await POST(request(body));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ rows: [] });
    }
    // The briefing already renders without this route; asking a model about
    // an empty list is pure cost.
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns grounded rows for a gap", async () => {
    geminiReplying([ROW]);
    const res = await POST(request({ technologies: TECHNOLOGIES }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      technologyId: "typescript",
      technology: "TypeScript",
      cycle: "5.9",
      state: "security-only",
      source: "ai",
    });
    expect(body.rows[0].citation.url).toBe("https://devblogs.microsoft.com/typescript/x/");
  });

  it("never returns a row the model did not ground, even end to end", async () => {
    // The parser enforces this and is deliberately not mocked here: the point
    // is that nothing between it and the response body can re-admit the row.
    geminiReplying([{ ...ROW, sourceUrl: "https://invented.example/ts" }]);
    const body = await (await POST(request({ technologies: TECHNOLOGIES }))).json();
    expect(body.rows).toEqual([]);
    expect(body.dropped.length).toBeGreaterThan(0);
  });

  it("searches the web rather than answering from the model's own memory", async () => {
    const generate = geminiReplying([ROW]);
    await POST(request({ technologies: TECHNOLOGIES }));
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0][0];
    // `config.tools`, NOT `call.tools`. This is an INJECTED FAKE client: it
    // sees whatever object the route hands it and cannot observe the SDK layer
    // that DISCARDS a top-level `tools`, so this line was green against a
    // request that never carried the key — the panel really was answering from
    // model memory. The second assertion stops that shape returning;
    // route.wire.test.js proves it on the actual bytes.
    expect(call.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(call.tools).toBeUndefined();
    expect(String(call.contents)).toContain("TypeScript");
  });

  it("caps how many technologies one request may ask about, and says what it skipped", async () => {
    const generate = geminiReplying([ROW]);
    // Distinctive labels, NOT single letters: the prompt's own boilerplate
    // contains ordinary English ("For each technology, ..."), so asserting
    // that a bare "F" is absent is unsatisfiable no matter how correct the
    // capping is.
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, label: `Tech-${id.toUpperCase()}` }));
    const body = await (await POST(request({ technologies: many }))).json();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(body.skipped.length).toBeGreaterThan(0);
    const asked = String(generate.mock.calls[0][0].contents);
    expect(asked).toContain("Tech-A");
    expect(asked).not.toContain("Tech-F");
  });

  it("caches globally, not per user, because the answer is the same for everyone", async () => {
    geminiReplying([ROW]);
    await POST(request({ technologies: TECHNOLOGIES }));
    expect(cached).toHaveBeenCalledTimes(1);
    const [key, ttl] = cached.mock.calls[0];
    expect(key).toContain("techwatch:lifecycle");
    expect(key).toContain("typescript");
    expect(key).not.toMatch(/user/i);
    expect(ttl).toBe(60 * 60 * 24);
  });

  it("degrades to an empty top-up when the model errors, never to a broken briefing", async () => {
    const generateContent = vi.fn().mockRejectedValue(new Error("model exploded"));
    getGeminiClient.mockReturnValue({ models: { generateContent } });
    const res = await POST(request({ technologies: TECHNOLOGIES }));
    // This is progressive enhancement over an already-rendered briefing. A
    // 5xx here would surface in the panel as a failure of the whole feature.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.error).toBeTruthy();
  });

  it("degrades the same way when the model returns nothing usable", async () => {
    geminiReplying("not json at all");
    const res = await POST(request({ technologies: TECHNOLOGIES }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ rows: [] });
  });

  it("reports a missing Gemini key as a 503 rather than pretending to search", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    const res = await POST(request({ technologies: TECHNOLOGIES }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("rejects a malformed body without calling the model", async () => {
    const generate = geminiReplying([ROW]);
    const res = await POST(
      new Request("http://localhost/api/techwatch/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("is dynamic and runs on node", async () => {
    const mod = await import("./route.js");
    expect(mod.runtime).toBe("nodejs");
    expect(mod.dynamic).toBe("force-dynamic");
  });
});
