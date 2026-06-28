import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));
vi.mock("@/lib/scrape/atsLookup", () => ({ lookupAtsPostingUrl: vi.fn(async () => null) }));

import { POST, parseVisionJson, candidateUrls, rankCandidates, tidyField, isBareDomain } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { fetchUrlContent, extractUrls } from "@/lib/scrape/fetchUrlContent";
import { lookupAtsPostingUrl } from "@/lib/scrape/atsLookup";

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

describe("tidyField", () => {
  it("strips salary figures, ranges, and parentheticals from a title", () => {
    expect(tidyField("Senior Software Engineer - $120k-$150k - Remote")).toBe("Senior Software Engineer - Remote");
    expect(tidyField("Staff Engineer ($180,000/yr)")).toBe("Staff Engineer");
    expect(tidyField("Data Scientist | 130K–160K")).toBe("Data Scientist");
    expect(tidyField("Product Manager")).toBe("Product Manager");
    expect(tidyField("")).toBe("");
  });
});

describe("isBareDomain", () => {
  it("flags homepages / bare domains but not deep posting URLs", () => {
    expect(isBareDomain("https://www.governmentjobs.com/")).toBe(true);
    expect(isBareDomain("https://acme.com")).toBe(true);
    expect(isBareDomain("https://www.governmentjobs.com/careers/douglas/jobs/5389021/building-inspector")).toBe(false);
    expect(isBareDomain("https://boards.greenhouse.io/acme/jobs/9")).toBe(false);
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
  it("pushes aggregator hosts (LinkedIn, Indeed, …) to the end, order stable", () => {
    expect(
      rankCandidates([
        "https://www.linkedin.com/jobs/view/123",
        "https://www.indeed.com/viewjob?jk=abc",
        "https://boards.greenhouse.io/acme/jobs/1",
        "https://acme.com/careers/eng",
        "https://www.glassdoor.com/job-listing/x",
      ]),
    ).toEqual([
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://acme.com/careers/eng",
      "https://www.linkedin.com/jobs/view/123",
      "https://www.indeed.com/viewjob?jk=abc",
      "https://www.glassdoor.com/job-listing/x",
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

  it("uses the deep posting URL (not the homepage) when the posting page scrapes thin", async () => {
    // NEOGOV/governmentjobs repro: real posting first, homepage second.
    mockGemini({
      searchText:
        "https://www.governmentjobs.com/careers/douglas/jobs/5389021/building-inspector https://www.governmentjobs.com/",
    });
    fetchUrlContent.mockImplementation(async (url) => {
      if (url.includes("/jobs/5389021/")) return { error: "thin shell (JS-rendered)" };
      // the homepage scrapes fine — must NOT be chosen
      return { title: "Government Jobs", company: "", description: "G".repeat(200), finalUrl: "https://www.governmentjobs.com/" };
    });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://www.governmentjobs.com/careers/douglas/jobs/5389021/building-inspector");
    // posting text comes from the screenshot (vision), not the homepage
    expect(data.postingText).toContain("Senior Engineer");
  });

  it("skips a homepage candidate that scrapes fine, choosing the deep posting + its text", async () => {
    // Homepage listed FIRST; both scrape fine. The homepage must be skipped.
    mockGemini({
      searchText:
        "https://www.governmentjobs.com/ https://www.governmentjobs.com/careers/douglas/jobs/5389021/building-inspector",
    });
    fetchUrlContent.mockImplementation(async (url) => {
      if (isBareDomain(url)) return { title: "Government Jobs", description: "H".repeat(500), finalUrl: url };
      return { title: "Building Inspector", company: "Douglas County", description: "Real posting description text. ".repeat(20), finalUrl: url };
    });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://www.governmentjobs.com/careers/douglas/jobs/5389021/building-inspector");
    expect(data.postingText).toContain("Real posting description");
  });

  it("does not surface a deep URL that redirects to the homepage (expired posting)", async () => {
    // Stale governmentjobs id: 200, but finalUrl after redirect is the homepage.
    mockGemini({
      searchText: "https://www.governmentjobs.com/careers/douglascounty/jobs/2928863/building-inspector",
    });
    fetchUrlContent.mockResolvedValue({
      title: "GovernmentJobs",
      description: "H".repeat(500),
      finalUrl: "https://www.governmentjobs.com/",
    });
    const res = await POST(imageRequest(pngFile()));
    const data = await res.json();
    expect(data.found).toBe(false);
    expect(data.url || "").not.toContain("2928863");
    expect(data.reason).toMatch(/homepage|expired/i);
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

  it("503s when Gemini isn't configured", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    const res = await POST(imageRequest(pngFile()));
    expect(res.status).toBe(503);
  });
});
