import { describe, it, expect, vi, beforeEach } from "vitest";
import { jsonRequest } from "../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { POST, parseArticles, extractGroundingSources } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

const ARTICLES_JSON = JSON.stringify({
  articles: [
    { title: "Acme raises $50M", source: "TechNews", date: "March 2026", url: "https://technews.example/acme", summary: "Acme raised a big round.", suggestion: "I was excited to see Acme's recent funding." },
    { title: "Acme wins award", source: "BizWeekly", date: "Feb 2026", url: "https://biz.example/acme-award", summary: "Acme won best workplace.", suggestion: "Acme's best-workplace recognition resonates with me." },
    { title: "Acme launches X", source: "ProductHunt", date: "Jan 2026", url: "https://ph.example/acme-x", summary: "Acme launched a new product.", suggestion: "I admire the ambition behind Acme's new product." },
  ],
});

function mockGemini({ text = ARTICLES_JSON, grounded = true } = {}) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: "Here are the articles:\n```json\n" + text + "\n```",
        candidates: grounded
          ? [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertex.redirect/x", title: "TechNews" } }] } }]
          : [{}],
      }),
    },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("parseArticles", () => {
  it("parses {articles:[...]} and bare arrays, dropping malformed entries", () => {
    expect(parseArticles(ARTICLES_JSON)).toHaveLength(3);
    expect(parseArticles('[{"title":"T","summary":"S"}]')).toHaveLength(1);
    expect(parseArticles('[{"title":"","summary":"x"}]')).toHaveLength(0); // needs title + summary
    expect(parseArticles("not json")).toEqual([]);
  });
});

describe("extractGroundingSources", () => {
  it("reads grounded web URIs", () => {
    const r = { candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://a", title: "A" } }] } }] };
    expect(extractGroundingSources(r)).toEqual([{ uri: "https://a", title: "A" }]);
    expect(extractGroundingSources({})).toEqual([]);
  });
});

describe("POST /api/company-research", () => {
  it("returns 3 articles for a company", async () => {
    mockGemini();
    const res = await POST(jsonRequest({ company: "Acme", jobTitle: "Engineer" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.articles).toHaveLength(3);
    expect(data.articles[0].suggestion).toContain("Acme");
    expect(data.warnings).toEqual([]); // grounded
  });

  it("warns when search wasn't grounded", async () => {
    mockGemini({ grounded: false });
    const res = await POST(jsonRequest({ company: "Acme" }));
    const data = await res.json();
    expect(data.warnings.length).toBeGreaterThan(0);
  });

  it("400s when company is missing", async () => {
    mockGemini();
    const res = await POST(jsonRequest({ jobTitle: "Engineer" }));
    expect(res.status).toBe(400);
  });

  it("503s when Gemini isn't configured", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    const res = await POST(jsonRequest({ company: "Acme" }));
    expect(res.status).toBe(503);
  });
});
