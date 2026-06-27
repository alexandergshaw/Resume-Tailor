import { describe, it, expect, vi, beforeEach } from "vitest";
import { jsonRequest } from "../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent: vi.fn() }));

import { POST, parseArticles, extractGroundingSources } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";

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

describe("POST /api/company-research (custom URL mode)", () => {
  it("summarizes a pasted article URL into one source", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    fetchUrlContent.mockResolvedValue({ title: "Acme opens new lab", description: "Acme opened a research lab." });
    getGeminiClient.mockReturnValue({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: '{"articles":[{"title":"Acme opens new lab","source":"TechNews","date":"2026","url":"x","summary":"New lab.","suggestion":"I admire Acme\'s new lab."}]}',
        }),
      },
    });
    const res = await POST(jsonRequest({ url: "https://news.example/acme-lab", company: "Acme" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].url).toBe("https://news.example/acme-lab"); // keeps the real URL
    expect(data.articles[0].suggestion).toContain("Acme");
  });

  it("falls back to a title-only card when Gemini isn't configured", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    fetchUrlContent.mockResolvedValue({ title: "Acme opens new lab", description: "..." });
    const res = await POST(jsonRequest({ url: "https://news.example/acme-lab" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.articles[0].title).toBe("Acme opens new lab");
    expect(data.articles[0].suggestion).toBe("");
    expect(data.warnings.length).toBeGreaterThan(0);
  });

  it("400s on a non-http URL", async () => {
    const res = await POST(jsonRequest({ url: "ftp://nope" }));
    expect(res.status).toBe(400);
  });

  it("falls back to Gemini's URL fetcher when our scrape is blocked (403)", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    fetchUrlContent.mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"articles":[{"title":"UMSI AI study","source":"si.umich.edu","date":"2026","url":"x","summary":"AI helps scientists.","suggestion":"I was struck by UMSI\'s AI-for-code research."}]}',
    });
    getGeminiClient.mockReturnValue({ models: { generateContent } });
    const res = await POST(jsonRequest({ url: "https://www.si.umich.edu/news/ai", company: "UMSI" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.articles[0].suggestion).toContain("UMSI");
    expect(data.articles[0].url).toBe("https://www.si.umich.edu/news/ai");
    // used the urlContext tool fallback
    expect(generateContent.mock.calls[0][0].tools).toEqual([{ urlContext: {} }]);
  });

  it("502s when the scrape is blocked and there is no Gemini key", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    fetchUrlContent.mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    const res = await POST(jsonRequest({ url: "https://blocked.example/x" }));
    expect(res.status).toBe(502);
  });
});
