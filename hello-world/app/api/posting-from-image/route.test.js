import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));

import { POST, parseVisionJson, candidateUrls } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { fetchUrlContent, extractUrls } from "@/lib/scrape/fetchUrlContent";

function imageRequest(file) {
  const fd = new FormData();
  if (file) fd.append("image", file);
  return { formData: async () => fd };
}

function pngFile(name = "shot.png", type = "image/png", size = 1000) {
  const f = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  f.arrayBuffer = async () => new Uint8Array(8).buffer;
  return f;
}

const VISION_JSON = JSON.stringify({
  jobTitle: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  postingText: "We are hiring a Senior Engineer to build delightful products and scale our platform.",
  searchQuery: "Acme Senior Engineer remote",
});

function mockGemini({ vision = VISION_JSON, searchText = "https://acme.example/jobs/senior-engineer", grounded = [] } = {}) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi
    .fn()
    // 1st call: vision extraction
    .mockResolvedValueOnce({ text: vision })
    // 2nd call: URL search
    .mockResolvedValueOnce({
      text: searchText,
      candidates: grounded.length ? [{ groundingMetadata: { groundingChunks: grounded.map((uri) => ({ web: { uri } })) } }] : [{}],
    });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  extractUrls.mockImplementation((t) => {
    const m = String(t || "").match(/https?:\/\/[^\s]+/g);
    return m ? m.slice(0, 5) : [];
  });
});

describe("parseVisionJson", () => {
  it("parses the fields and ignores prose around the object", () => {
    const out = parseVisionJson("```json\n" + VISION_JSON + "\n```");
    expect(out.jobTitle).toBe("Senior Engineer");
    expect(out.company).toBe("Acme");
    expect(parseVisionJson("not json")).toBeNull();
  });
});

describe("candidateUrls", () => {
  it("prefers model-written URLs, then grounded redirects, de-duped", () => {
    const res = {
      text: "Best match: https://acme.example/jobs/1",
      candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertex.redirect/x" } }] } }],
    };
    expect(candidateUrls(res)).toEqual(["https://acme.example/jobs/1", "https://vertex.redirect/x"]);
  });
});

describe("POST /api/posting-from-image", () => {
  it("reads the screenshot, finds the URL, and returns the pulled posting", async () => {
    mockGemini();
    fetchUrlContent.mockResolvedValue({
      title: "Senior Engineer",
      company: "Acme",
      description: "A".repeat(200),
      finalUrl: "https://acme.example/jobs/senior-engineer",
    });
    const res = await POST(imageRequest(pngFile()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://acme.example/jobs/senior-engineer");
    expect(data.jobTitle).toBe("Senior Engineer");
    expect(data.postingText.length).toBeGreaterThan(80);
  });

  it("reports not-found when no posting URL can be located", async () => {
    mockGemini({ searchText: "NONE" });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    expect(data.found).toBe(false);
    expect(data.reason).toMatch(/couldn't find the live posting url/i);
  });

  it("falls back to the screenshot's own text when a located link can't be scraped", async () => {
    mockGemini();
    fetchUrlContent.mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    // URL was located, so we tailor — from the text read off the screenshot.
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://acme.example/jobs/senior-engineer");
    expect(data.postingText).toContain("Senior Engineer");
  });

  it("reports not-found when a link is located but neither it nor the image yields text", async () => {
    mockGemini({ vision: JSON.stringify({ jobTitle: "Eng", company: "Acme", location: "", postingText: "", searchQuery: "Acme Eng" }) });
    fetchUrlContent.mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    expect(data.found).toBe(false);
  });

  it("400s when no image is provided", async () => {
    const res = await POST(imageRequest(null));
    expect(res.status).toBe(400);
  });

  it("400s on a non-image file type", async () => {
    const res = await POST(imageRequest(pngFile("doc.pdf", "application/pdf")));
    expect(res.status).toBe(400);
  });

  it("503s when Gemini isn't configured", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    const res = await POST(imageRequest(pngFile()));
    expect(res.status).toBe(503);
  });
});
