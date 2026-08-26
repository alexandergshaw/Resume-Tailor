import { describe, it, expect, vi, beforeEach } from "vitest";

// AC-Y6. The screenshot pipeline's URL search actually ASKS for Google Search
// on the wire.
//
// THE DEFECT THIS FILE EXISTS TO CATCH. `GenerateContentParameters` has
// exactly three properties — `model`, `contents`, `config` — and `tools`
// belongs to `GenerateContentConfig`. The SDK's parameter transformer reads
// only those three keys and silently discards everything else before building
// the request body, so a `tools` passed at the TOP LEVEL never reaches Google:
// no error, no warning.
//
// Here the failure hides behind a fallback. With no search the model answers
// "where is this posting live?" from training data, so it returns nothing
// usable or an invented URL, and the route quietly falls back to the OCR text.
// The feature keeps working, worse, forever, while paying for a second model
// call that could not possibly succeed.
//
// WHY THIS DRIVES THE REAL SDK. `route.test.js` drives an INJECTED FAKE
// client, which sees whatever object the route hands it and cannot observe the
// layer that drops the key. Only the real transformer can catch this, so this
// file stubs `fetch` and reads the bytes. See `lib/llm/geminiWireProbe.js`.

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));
vi.mock("@/lib/scrape/atsLookup", () => ({ lookupAtsPostingUrl: vi.fn(async () => null) }));
vi.mock("@/lib/scrape/screenshotOcr", () => ({ readScreenshotOffline: vi.fn() }));
vi.mock("@/lib/scrape/webSearch", () => ({ searchPostingUrls: vi.fn(async () => []) }));

import { GoogleGenAI } from "@google/genai";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const VISION_JSON = JSON.stringify({
  jobTitle: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  postingText: "We are hiring a Senior Engineer to build delightful products and scale our platform.",
  searchQuery: "Acme Senior Engineer remote",
});

function pngFile() {
  const f = new File([new Uint8Array(8)], "shot.png", { type: "image/png" });
  Object.defineProperty(f, "size", { value: 1000 });
  f.arrayBuffer = async () => new Uint8Array(8).buffer;
  return f;
}

function imageRequest() {
  const fd = new FormData();
  fd.append("image", pngFile());
  fd.append("engine", "gemini");
  return { formData: async () => fd };
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  // The REAL client. A fake here would reproduce exactly the blindness that
  // let the defect ship.
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "test-key" }));
});

// The route makes two calls in order: vision extraction, then the URL search.
// Both are served the same canned vision JSON so the first parses and the
// second is actually reached.
const capture = () => captureGeminiRequests(() => POST(imageRequest()), { text: VISION_JSON });

describe("the posting-URL search asks for search on the wire (AC-Y6)", () => {
  it("puts googleSearch in the request body of the second call", async () => {
    const bodies = await capture();
    expect(bodies).toHaveLength(2);
    expect(toolsOf(bodies[1])).toEqual([{ googleSearch: {} }]);
  });

  it("leaves the vision call alone — it wants JSON, not a search", async () => {
    // The negative control that keeps a blanket "put tools in config
    // everywhere" edit honest: only one of these two calls is grounded.
    const bodies = await capture();
    expect(toolsOf(bodies[0])).toBeUndefined();
    expect(bodies[0]?.generationConfig?.responseMimeType).toBe("application/json");
    expect(bodies[1]?.generationConfig?.responseMimeType).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped (AC-Y6)", () => {
  it("proves the SDK discards a top-level tools key", async () => {
    // A standing negative control against the shape this call site used. If a
    // future SDK starts honouring the top-level key this goes red — the right
    // outcome: it means the rule changed and every comment about it is stale.
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
