import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// N157 SC-gen (4b TDD seat) -- THE WIRE TEST. The instrument that did not exist
// yet; the TDD seat builds it. Binds docs/loop/N157.SC-gen.plan.r1.md §2.5 +
// risk row R4, and N157.arch.r2.md §10 / ledger ARCH-N157-9.
//
// WHAT THIS PROVES, AND WHY IT DRIVES THE REAL SDK. The study-plan generation
// call consumes an ALREADY-grounded EvidenceSet, so it must be NON-grounded:
// `client.models.generateContent` with NO `tools`/`googleSearch` anywhere, and
// NOT `interactions.create`. Attaching tools would (a) spend a fresh grounded
// search, (b) re-introduce the vertexaisearch redirect-citation problem, and
// (c) risk the R-IP3-21 duration blowout.
//
// route.test.js asserts the request shape against an INJECTED FAKE client,
// which sees whatever object the route hands it and CANNOT observe the SDK
// layer that drops a top-level key or forwards a config-nested one. So this
// file stubs globalThis.fetch and reads the bytes actually put on the wire,
// exactly as app/api/application-digest/route.wire.test.js and
// app/api/salary-estimate/route.wire.test.js do. See lib/llm/geminiWireProbe.js.
//
// THE NEGATIVE CONTROL is the last describe: a generateContent call that nests
// `tools` inside `config` DOES reach the wire (unlike a top-level `tools`, which
// the SDK silently discards). That proves the "toolsOf is undefined" assertion
// on the route has POWER -- if the route ever nested tools in config, the bytes
// would carry them and the route assertion would red.
//
// RED ON HEAD: app/api/study-plan/route.js does not exist yet -> the import
// below throws at collection and every `it` reds (honest greenfield red).

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({ listDigests: vi.fn() }));

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { listDigests } from "@/lib/supabase/applicationDigests";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const POSITION = { id: "p1", title: "Senior Platform Engineer", company: "Acme Robotics", description: "Own the estate." };

// A ready, SOURCED digest so gatherEvidence yields a complete EvidenceSet and
// the route takes the gemini (model) branch.
const DIGEST = {
  application_id: APP_ID,
  status: "ready",
  markdown: "## What Acme Robotics does\n\nBuilds warehouse robots.",
  researched_at: "2026-09-01T00:00:00.000Z",
  sources: [{ url: "https://www.reuters.com/business/acme" }],
};

// One supabase double for both the applications ownership read and the
// study_plans upsert the write path performs after the request fires.
function supabase() {
  const store = new Map();
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from(table) {
      if (table === "applications") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { id: APP_ID, user_id: "user-1", positions: POSITION }, error: null }),
        };
        return chain;
      }
      return {
        upsert(row) {
          store.set(row.application_id, { ...(store.get(row.application_id) || {}), ...row });
          return { select: () => ({ maybeSingle: async () => ({ data: store.get(row.application_id), error: null }) }) };
        },
        select() {
          const f = {};
          const chain = { eq(c, v) { f[c] = v; return chain; }, maybeSingle: async () => ({ data: store.get(f.application_id) || null, error: null }) };
          return chain;
        },
      };
    },
  };
}

const request = () =>
  new Request("http://localhost/api/study-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: APP_ID, engine: "gemini" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue(supabase());
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  listDigests.mockResolvedValue({ digests: { [APP_ID]: DIGEST }, error: null });
  // The REAL client, built lazily inside the capture window. A fake here would
  // reproduce exactly the blindness that let the R-267 grounding defect ship.
  getGeminiClient.mockImplementation(() => new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("study-plan generation is NON-grounded on the wire (R4 / ARCH-N157-9)", () => {
  it("fires EXACTLY ONE request and carries NO tools / googleSearch", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toBeUndefined();
  });

  it("goes to generateContent (carries `contents`), not interactions (`input`)", async () => {
    // The surface discriminator. If a future change switched this route to the
    // Interactions API, the body would carry `input` and no `contents`.
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies[0]?.contents).toBeDefined();
    expect(bodies[0]?.input).toBeUndefined();
    // The evidence actually reached the model (the request is not empty).
    expect(String(JSON.stringify(bodies[0]?.contents))).toContain("Acme Robotics");
  });

  it("forces the JSON response mime type (positive control -- a missing body cannot pass vacuously)", async () => {
    // Without this, "toolsOf undefined" is satisfied by an empty/absent body,
    // which reads as coverage forever. This pins that a real, JSON-shaped
    // generateContent request was made.
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies[0]?.generationConfig?.responseMimeType).toBe("application/json");
  });
});

describe("the instrument discriminates -- a config-nested tools DOES reach the wire", () => {
  it("[control] proves toolsOf is not always undefined, so the route assertion has power", async () => {
    // generateContent forwards `config.tools` to the wire (the correct place for
    // this transport). This is why the route MUST pass no tools at all: if it
    // ever nested them, the bytes would carry them and the first test would red.
    const bodies = await captureGeminiRequests(() =>
      new GoogleGenAI({ apiKey: "test-key" }).models.generateContent({
        model: "gemini-2.5-flash",
        contents: "hi",
        config: { tools: [{ googleSearch: {} }] },
      }),
    );
    expect(toolsOf(bodies[0])).toEqual([{ googleSearch: {} }]);
  });
});
