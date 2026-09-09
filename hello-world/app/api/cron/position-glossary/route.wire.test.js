// R-341 / AC-R1, AC-R9, AC-R10, AC-R11a -- THE WIRE TEST.
//
// This file must exist and must be written BEFORE the route is finished. Every
// grounded feature in this repo that wrote its wire test afterwards shipped the
// defect first, and `lib/llm/geminiWireProbe.js:12-24` records why no other
// instrument can substitute:
//
//   "the tests that were supposed to pin the request shape asserted it against
//    an INJECTED FAKE CLIENT. A fake sees whatever object the caller hands it,
//    so it confirmed a `tools` that the real transport dropped -- the assertions
//    were permanently green against a request that never carried the key."
//
// THE TWO REQUEST SHAPES ARE INVERTED, AND BOTH ARE LIVE IN THIS REPOSITORY.
//   * `models.generateContent` -- `tools` lives INSIDE `config`, the tool object
//     is `{ googleSearch: {} }`, the prompt field is `contents`, the system
//     prompt is `config.systemInstruction`.
//   * `interactions.create` -- `tools` is TOP-LEVEL with a `type` discriminant
//     (`{ type: "google_search" }`), the prompt field is `input`, the system
//     prompt is `system_instruction`, and there is no `config` object at all.
// NEITHER WRONG FORM THROWS. The SDK's parameter transformer reads only the keys
// it knows and discards the rest, silently: no search, no citations, every term
// falls back to `recalled`, and a full grounded bill arrives anyway.
//
// FOUR SEPARATE ASSERTIONS, not one deep-equal on the body: a single deep-equal
// passes for the wrong reason when the body is built by a spread.
//
// A FRESH CLIENT IS BUILT INSIDE EACH CAPTURE WINDOW. The Interactions transport
// binds `globalThis.fetch` at the first `.interactions` access and holds that
// reference (`.models` is eager; `.interactions` is a lazy getter over a
// memoised next-gen client), so a client reused across windows sends its request
// to a stub that has already been restored. That is the trap that would silently
// defeat a naive wire test, so `getGeminiClient` is mocked with an
// IMPLEMENTATION, never a return value.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { GoogleGenAI } from "@google/genai";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const POSITION_ID = "11111111-1111-1111-1111-111111111111";

const TERMS = Array.from({ length: 12 }, (_, i) => ({
  term: `non compositional concept ${i}`,
  kind: "anticipated",
  category: "terminology",
  parent: "PostgreSQL",
  anchor_quote: "You will own our PostgreSQL estate.",
  definition: "A recalled definition produced by the harvest with no source at all, in plain prose.",
  provenance: "recalled",
}));

const ROW = {
  position_id: POSITION_ID,
  status: "partial",
  terms: TERMS,
  researched_count: 0,
  recalled_count: 12,
  research_cursor: 0,
  research_total: 1,
  research_batches: 0,
  unsearched_batches: 0,
  malformed_batches: 0,
  model_calls_fingerprint: 1,
  model_calls_total: 1,
  attempts: 1,
  posting_fingerprint: "fp1",
  refusal_reasons: {},
  usage_totals: null,
};

// A PostgREST-shaped fake that hands the worker exactly one row of work and
// swallows every write. The point of this file is the bytes on the Gemini wire,
// not the database.
function fakeAdmin() {
  const chain = {
    select: () => chain,
    update: () => chain,
    eq: () => chain,
    lt: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: ROW, error: null }),
    then: (res, rej) => Promise.resolve({ data: [ROW], error: null }).then(res, rej),
  };
  return { from: () => chain };
}

const request = () =>
  new Request("http://localhost/api/cron/position-glossary", {
    method: "POST",
    headers: { authorization: "Bearer test-cron-secret" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  vi.stubEnv("GLOSSARY_DISABLED", "");
  createAdminClient.mockImplementation(() => fakeAdmin());
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockImplementation(() => new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the research call asks the Interactions API for search on the wire (R-341)", () => {
  it("puts `tools` at the TOP LEVEL of the body", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies.length).toBeGreaterThan(0);
    expect(toolsOf(bodies[0])).toBeDefined();
  });

  it("uses the `type` discriminant, not the generateContent camelCase key", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(toolsOf(bodies[0])).toEqual([{ type: "google_search" }]);
    expect(toolsOf(bodies[0])[0].googleSearch).toBeUndefined();
  });

  it("sends `input`, and NEVER `contents`", async () => {
    // The surface discriminator, needing no probe change. Asserted separately
    // from `tools` because if a future change reverted the call site to
    // generateContent, a nested `tools` would still reach the wire and the first
    // assertion above would still pass.
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies[0]?.input).toBeDefined();
    expect(bodies[0]?.contents).toBeUndefined();
    expect(String(bodies[0]?.input)).toContain("non compositional concept 0");
  });

  it("sends `system_instruction` at the top level, and no `config` wrapper", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(bodies[0]?.system_instruction).toBeDefined();
    expect(bodies[0]?.config).toBeUndefined();
    expect(bodies[0]?.systemInstruction).toBeUndefined();
  });

  it("sends no response_format, so JSON mode and google_search are never composed unverified", () => {
    // The repo's only other Interactions call site passes none either, and
    // whether the two compose on this surface is not knowable from the typings.
    // Designing on it would be designing on an assumption.
    return captureGeminiRequests(() => POST(request())).then((bodies) => {
      expect(bodies[0]?.response_format).toBeUndefined();
      expect(bodies[0]?.response_mime_type).toBeUndefined();
    });
  });

  it("does NOT re-send the posting body in the research prompt", async () => {
    // The batch prompt carries only the terms and their <=160-char anchor
    // quotes. That cuts input tokens and shrinks the injection surface at once.
    const bodies = await captureGeminiRequests(() => POST(request()));
    expect(String(bodies[0]?.input).length).toBeLessThan(8000);
  });
});

describe("the standing negative control -- the probe can still SEE a dropped tools key", () => {
  it("proves the SDK discards a top-level tools key on models.generateContent", async () => {
    // This case never touches the route: it builds its own client and calls the
    // OTHER surface directly. Do not delete it and do not "update" it to the
    // Interactions shape -- those are different APIs with opposite rules, and
    // without it the four assertions above could all pass against a probe that
    // had quietly stopped observing anything. If a future SDK starts honouring
    // the top-level key this goes red, which is the right outcome: it means
    // every comment about the rule is stale.
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
