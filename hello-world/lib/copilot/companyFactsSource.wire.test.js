import { describe, expect, it, afterEach } from "vitest";
import { GoogleGenAI } from "@google/genai";

// AC-V4.8. The company-facts call must actually ASK for Google Search.
//
// WHY THIS FILE EXISTS, and why it drives the REAL SDK instead of a fake.
// `companyFactsSource.test.js` asserts the request shape against an injected
// fake client, and an injected fake sees whatever object the caller passes it.
// So it happily confirmed `tools: [{ googleSearch: {} }]` sitting at the TOP
// LEVEL of the `generateContent` argument — a position the SDK silently drops.
// `GenerateContentParameters` has exactly three properties (`model`,
// `contents`, `config`); `tools` belongs to `GenerateContentConfig`. The
// SDK's own parameter transformer reads only those three keys and discards
// everything else before building the request body.
//
// The consequence was total and silent: no `tools` on the wire, so no search,
// so no `groundingMetadata`, so `extractGroundingSources` returns [], so
// `buildCompanyFacts` short-circuits and returns [] on every call forever —
// while still paying for a full Gemini call. The entire verified-facts
// feature would have shipped inert, with every unit test green, because the
// only test of the request shape could not see the layer that drops it.
//
// A fake cannot catch this class of defect by construction. Only the real
// transformer can, so this file stubs `fetch` and reads the actual bytes.
//
// This is not a hypothetical: twelve call sites across eight files in this
// repo pass `tools` at the top level, including the very company-research
// route this feature was told to mirror. "The codebase already does it this
// way" was evidence about consistency and nothing about correctness.

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Captures the JSON body the SDK actually puts on the wire for one call.
async function bodyFor(args) {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const ai = new GoogleGenAI({ apiKey: "test-key" });
  await ai.models.generateContent(args);
  return bodies[0];
}

describe("the SDK's actual request body (AC-V4.8)", () => {
  it("drops tools passed at the top level — the defect this file exists to prevent", async () => {
    // A negative control, asserted so nobody "simplifies" the call back to
    // the shape twelve other call sites in this repo still use. If a future
    // SDK starts honouring the top-level key this test goes red, which is the
    // right outcome: it means the rule changed and the comment above is stale.
    const body = await bodyFor({
      model: "gemini-2.5-flash",
      contents: "hi",
      tools: [{ googleSearch: {} }],
      config: { systemInstruction: "sys" },
    });
    expect(body.tools).toBeUndefined();
  });

  it("transmits tools declared inside config", async () => {
    const body = await bodyFor({
      model: "gemini-2.5-flash",
      contents: "hi",
      config: { systemInstruction: "sys", tools: [{ googleSearch: {} }] },
    });
    expect(body.tools).toEqual([{ googleSearch: {} }]);
  });
});

describe("buildCompanyFacts asks for search on the wire (AC-V4.8)", () => {
  it("puts googleSearch in the request body of its real Gemini call", async () => {
    // The end-to-end version of the two cases above, through the module under
    // test rather than through a hand-built argument object — so a correct
    // argument shape that the module never actually uses cannot pass.
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const { buildCompanyFacts } = await import("./companyFactsSource.js");
    const client = new GoogleGenAI({ apiKey: "test-key" });

    await buildCompanyFacts(
      { company: "Purple Wave", jobTitle: "Director of Platform Engineering" },
      { client, model: "gemini-2.5-flash" },
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0].tools).toEqual([{ googleSearch: {} }]);
    // And the search tool's own constraint is still honoured: no JSON response
    // mime type alongside it on this model, which is why the response is
    // parsed defensively out of prose.
    expect(bodies[0].generationConfig?.responseMimeType).toBeUndefined();
  });
});
