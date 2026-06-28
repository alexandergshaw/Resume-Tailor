import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));
vi.mock("@/lib/scrape/atsLookup", () => ({ lookupAtsPostingUrl: vi.fn(async () => null) }));
vi.mock("@/lib/scrape/screenshotOcr", async (importOriginal) => ({
  ...(await importOriginal()),
  readScreenshotOffline: vi.fn(),
  fieldsFromText: vi.fn(),
}));
vi.mock("@/lib/scrape/webSearch", () => ({ searchPostingUrls: vi.fn(async () => []) }));

import { POST, parseVisionJson, candidateUrls, rankCandidates, tidyField, offlineSearchQueries } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { fetchUrlContent, extractUrls } from "@/lib/scrape/fetchUrlContent";
import { lookupAtsPostingUrl } from "@/lib/scrape/atsLookup";
import { readScreenshotOffline, fieldsFromText } from "@/lib/scrape/screenshotOcr";
import { searchPostingUrls } from "@/lib/scrape/webSearch";

function imageRequest(file, mode) {
  const fd = new FormData();
  if (file) fd.append("image", file);
  if (mode) fd.append("mode", mode);
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

describe("tidyField", () => {
  it("strips salary figures, ranges, and parentheticals from a title", () => {
    expect(tidyField("Senior Software Engineer - $120k-$150k - Remote")).toBe("Senior Software Engineer - Remote");
    expect(tidyField("Staff Engineer ($180,000/yr)")).toBe("Staff Engineer");
    expect(tidyField("Data Scientist | 130K–160K")).toBe("Data Scientist");
    expect(tidyField("Product Manager")).toBe("Product Manager");
    expect(tidyField("")).toBe("");
  });
});

describe("offlineSearchQueries", () => {
  it("prefers title+company, then a careers variant, capped at 3", () => {
    const qs = offlineSearchQueries({ jobTitle: "Senior Engineer", company: "Acme", postingText: "Some posting text about the role here" });
    expect(qs[0]).toBe("Senior Engineer Acme");
    expect(qs[1]).toBe("Senior Engineer Acme careers job posting");
    expect(qs.length).toBeLessThanOrEqual(3);
  });

  it("falls back to raw heading lines when title/company are empty", () => {
    const qs = offlineSearchQueries({ jobTitle: "", company: "", postingText: "Staff Data Scientist\nat Globex Corporation\nWe build models" });
    expect(qs).toContain("Staff Data Scientist");
    expect(qs.length).toBeGreaterThan(0);
  });

  it("always yields at least one query from raw text as a last resort", () => {
    const qs = offlineSearchQueries({ jobTitle: "", company: "", postingText: "short" });
    expect(qs).toEqual(["short"]);
    expect(offlineSearchQueries({ jobTitle: "", company: "", postingText: "" })).toEqual([]);
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

  it("sinks LinkedIn below the original source", () => {
    const res = {
      text: "https://www.linkedin.com/jobs/view/123 or https://boards.greenhouse.io/acme/jobs/1",
      candidates: [{}],
    };
    expect(candidateUrls(res)).toEqual([
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://www.linkedin.com/jobs/view/123",
    ]);
  });
});

describe("rankCandidates", () => {
  it("pushes LinkedIn-style hosts to the end while keeping other order stable", () => {
    expect(
      rankCandidates([
        "https://www.linkedin.com/jobs/view/123",
        "https://boards.greenhouse.io/acme/jobs/1",
        "https://acme.com/careers/eng",
        "https://lnkd.in/abc",
      ]),
    ).toEqual([
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://acme.com/careers/eng",
      "https://www.linkedin.com/jobs/view/123",
      "https://lnkd.in/abc",
    ]);
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

  it("uses the company's ATS board URL first when one is found", async () => {
    mockGemini({ searchText: "https://acme.example/jobs/from-search" });
    lookupAtsPostingUrl.mockResolvedValueOnce({ url: "https://boards.greenhouse.io/acme/jobs/9", title: "Senior Engineer", source: "greenhouse" });
    fetchUrlContent.mockResolvedValue({
      title: "Senior Engineer",
      company: "Acme",
      description: "C".repeat(200),
      finalUrl: "https://boards.greenhouse.io/acme/jobs/9",
    });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    expect(data.found).toBe(true);
    // resolvePosting tried the ATS URL first
    expect(fetchUrlContent.mock.calls[0][0]).toBe("https://boards.greenhouse.io/acme/jobs/9");
    expect(data.url).toBe("https://boards.greenhouse.io/acme/jobs/9");
  });

  it("names the job from the clean screenshot fields, not the salary-laden page title", async () => {
    mockGemini();
    fetchUrlContent.mockResolvedValue({
      // a typical noisy job-board <title>
      title: "Senior Engineer - $120k-$150k - Remote",
      company: "Some Job Board",
      description: "B".repeat(200),
      finalUrl: "https://acme.example/jobs/senior-engineer",
    });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.jobTitle).toBe("Senior Engineer"); // vision value, not the page title
    expect(data.company).toBe("Acme");
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

  it("503s when Gemini isn't configured (AI mode)", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    const res = await POST(imageRequest(pngFile()));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/posting-from-image (offline mode)", () => {
  it("uses browser-supplied OCR text (no image, no server OCR, no Gemini)", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    fieldsFromText.mockReturnValue({
      jobTitle: "Senior Engineer",
      company: "Acme",
      location: "",
      postingText: "P".repeat(200),
      searchQuery: "Acme Senior Engineer",
    });
    lookupAtsPostingUrl.mockResolvedValueOnce({ url: "https://boards.greenhouse.io/acme/jobs/9", title: "Senior Engineer", source: "greenhouse" });
    fetchUrlContent.mockResolvedValue({
      title: "Senior Engineer",
      company: "Acme",
      description: "Q".repeat(200),
      finalUrl: "https://boards.greenhouse.io/acme/jobs/9",
    });
    const fd = new FormData();
    fd.append("mode", "offline");
    fd.append("ocrText", "Senior Engineer at Acme — we are hiring...");
    const res = await POST({ formData: async () => fd });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://boards.greenhouse.io/acme/jobs/9");
    expect(fieldsFromText).toHaveBeenCalled();
    expect(readScreenshotOffline).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("400s offline with neither an image nor OCR text", async () => {
    const fd = new FormData();
    fd.append("mode", "offline");
    const res = await POST({ formData: async () => fd });
    expect(res.status).toBe(400);
  });

  it("reads via server OCR + ATS without Gemini, no key required", async () => {
    // Even with no Gemini key, offline mode must work.
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    readScreenshotOffline.mockResolvedValue({
      jobTitle: "Senior Engineer",
      company: "Acme",
      location: "",
      postingText: "P".repeat(200),
      searchQuery: "Acme Senior Engineer",
    });
    lookupAtsPostingUrl.mockResolvedValueOnce({ url: "https://boards.greenhouse.io/acme/jobs/9", title: "Senior Engineer", source: "greenhouse" });
    fetchUrlContent.mockResolvedValue({
      title: "Senior Engineer",
      company: "Acme",
      description: "Q".repeat(200),
      finalUrl: "https://boards.greenhouse.io/acme/jobs/9",
    });
    const res = await POST(imageRequest(pngFile(), "offline"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://boards.greenhouse.io/acme/jobs/9");
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("falls back to a non-AI web search when the ATS board has no match", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    readScreenshotOffline.mockResolvedValue({
      jobTitle: "Niche Role",
      company: "Unknown Co",
      location: "",
      postingText: "Z".repeat(200),
      searchQuery: "Unknown Co Niche Role",
    });
    lookupAtsPostingUrl.mockResolvedValueOnce(null);
    searchPostingUrls.mockResolvedValueOnce(["https://unknown.example/careers/niche"]);
    fetchUrlContent.mockResolvedValue({
      title: "Niche Role",
      company: "Unknown Co",
      description: "W".repeat(200),
      finalUrl: "https://unknown.example/careers/niche",
    });
    const res = await POST(imageRequest(pngFile(), "offline"));
    const data = await res.json();
    expect(searchPostingUrls).toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled(); // still no AI
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://unknown.example/careers/niche");
  });

  it("searches on raw OCR lines when parsing yields no title/company", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    // extractPostingMeta found nothing usable, but the OCR text has lines.
    fieldsFromText.mockReturnValue({
      jobTitle: "",
      company: "",
      location: "",
      postingText: "Staff Machine Learning Engineer\nat Globex Corporation\nWe build models at scale",
      searchQuery: "",
    });
    lookupAtsPostingUrl.mockResolvedValueOnce(null);
    // First query (a raw line) returns a hit.
    searchPostingUrls.mockResolvedValueOnce(["https://globex.example/jobs/ml-eng"]);
    fetchUrlContent.mockResolvedValue({
      title: "Staff Machine Learning Engineer",
      company: "Globex",
      description: "M".repeat(200),
      finalUrl: "https://globex.example/jobs/ml-eng",
    });
    const fd = new FormData();
    fd.append("mode", "offline");
    fd.append("ocrText", "Staff Machine Learning Engineer at Globex...");
    const res = await POST({ formData: async () => fd });
    const data = await res.json();
    expect(searchPostingUrls).toHaveBeenCalled();
    expect(searchPostingUrls.mock.calls[0][0].query).toBe("Staff Machine Learning Engineer");
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://globex.example/jobs/ml-eng");
  });

  it("reports not-found offline when neither the ATS board nor web search match", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    readScreenshotOffline.mockResolvedValue({
      jobTitle: "Niche Role",
      company: "Unknown Co",
      location: "",
      postingText: "Z".repeat(200),
      searchQuery: "Unknown Co Niche Role",
    });
    lookupAtsPostingUrl.mockResolvedValueOnce(null);
    searchPostingUrls.mockResolvedValueOnce([]);
    const res = await POST(imageRequest(pngFile(), "offline"));
    const data = await res.json();
    expect(data.found).toBe(false);
  });
});
