import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({
  fetchUrlContent: vi.fn(),
  extractUrls: vi.fn(() => []),
}));
vi.mock("@/lib/scrape/atsLookup", () => ({ lookupAtsPostingUrl: vi.fn(async () => null) }));
vi.mock("@/lib/scrape/screenshotOcr", () => ({ readScreenshotOffline: vi.fn() }));
vi.mock("@/lib/scrape/webSearch", () => ({ searchPostingUrls: vi.fn(async () => []) }));

import { POST, parseVisionJson, candidateUrls, rankCandidates, tidyField, isBareDomain } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { fetchUrlContent, extractUrls } from "@/lib/scrape/fetchUrlContent";
import { lookupAtsPostingUrl } from "@/lib/scrape/atsLookup";
import { readScreenshotOffline } from "@/lib/scrape/screenshotOcr";
import { searchPostingUrls } from "@/lib/scrape/webSearch";
import { createClient } from "@/lib/supabase/server";

const ROUTE_SOURCE = readFileSync(
  path.join(process.cwd(), "app", "api", "posting-from-image", "route.js"),
  "utf8",
);

/** The bound this route declares. Duplicated in lib/rateLimit/adoption.test.js. */
const LIMIT = 30;

// USER IDS ARE UNIQUE PER CASE, deliberately. The rate limiter is a module
// singleton, so its counters survive between `it()` blocks in this file exactly
// as they survive between requests in a running server. Sharing one id would
// let an early case's requests deny a later one -- a defect in the TEST, not in
// the bound. Same discipline as app/api/copilot/ask/route.test.js.
let userSeq = 0;
function signedIn(userId = `shot-user-${(userSeq += 1)}`) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
  return userId;
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

// Default to the Gemini engine; the embedded suite passes "embedded" explicitly.
// (Without an engine, wantsEmbedded would pick embedded when no Gemini key is
// set in the test environment.)
function imageRequest(file, engine = "gemini") {
  const fd = new FormData();
  if (file) fd.append("image", file);
  if (engine) fd.append("engine", engine);
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
  signedIn();
  extractUrls.mockImplementation((t) => {
    const m = String(t || "").match(/https?:\/\/[^\s]+/g);
    return m ? m.slice(0, 5) : [];
  });
});

// ---------------------------------------------------------------------------
// Identity. This route used to have NO auth gate of any kind, and it is the
// most expensive single call in the product: vision + OCR + a grounded web
// search + up to five outbound fetches. A 12MB upload cap was the only thing
// throttling an anonymous loop.
// ---------------------------------------------------------------------------
describe("an anonymous caller cannot spend the vision pipeline", () => {
  it("401s without reading the upload or reaching Gemini", async () => {
    signedOut();
    const formData = vi.fn(async () => new FormData());
    const res = await POST({ formData });
    expect(res.status).toBe(401);
    // The gate precedes the multipart read, so a 12MB body is never buffered.
    expect(formData).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("401s the embedded path too — the gate precedes the engine branch", async () => {
    // The embedded path is keyless, but it still runs Tesseract OCR on this
    // server's CPU over an attacker-chosen image and then fans out to a web
    // search. A gate that only covered the Gemini branch would leave that open.
    signedOut();
    readScreenshotOffline.mockResolvedValue({
      jobTitle: "Senior Engineer",
      company: "Acme",
      location: "",
      postingText: "x".repeat(200),
      searchQuery: "Acme Senior Engineer",
    });
    const res = await POST(imageRequest(pngFile(), "embedded"));
    expect(res.status).toBe(401);
    expect(readScreenshotOffline).not.toHaveBeenCalled();
    expect(searchPostingUrls).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The bound. Only possible now that there is an id to key on.
// ---------------------------------------------------------------------------
describe("the spend ceiling actually bites", () => {
  it("denies past the bound with 429 and a Retry-After", async () => {
    signedIn("shot-greedy");
    mockGemini();

    const statuses = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      // No image 400s on validation -- which is deliberately AFTER the bound,
      // so a caller hammering this endpoint with junk exhausts its own
      // allowance rather than getting an unmetered lane.
      statuses.push((await POST(imageRequest(null))).status);
    }

    // A limiter built INSIDE the handler gets a fresh store on every request,
    // so every caller is forever on its first request and all LIMIT+1 are 400.
    expect(statuses.filter((s) => s === 400)).toHaveLength(LIMIT);
    expect(statuses[LIMIT]).toBe(429);

    const denied = await POST(imageRequest(pngFile()));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("RateLimit-Limit")).toBe(String(LIMIT));
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("counts per authenticated user, so one caller's flood cannot deny another", async () => {
    signedIn("shot-flooder");
    for (let i = 0; i < LIMIT + 1; i += 1) await POST(imageRequest(null));
    expect((await POST(imageRequest(null))).status).toBe(429);

    signedIn("shot-bystander");
    expect((await POST(imageRequest(null))).status).toBe(400);
  });

  it("builds the limiter at MODULE scope, never inside the handler", () => {
    // The static half of the assertion above. A per-request limiter counts
    // nothing while looking correct, so only a construction-site check sees it.
    const declaration = /^const \w+ = createRateLimiter\(/m;
    expect(ROUTE_SOURCE).toMatch(declaration);
    const limiterAt = ROUTE_SOURCE.search(declaration);
    const handlerAt = ROUTE_SOURCE.indexOf("export async function POST");
    expect(handlerAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeLessThan(handlerAt);
    expect(ROUTE_SOURCE.slice(handlerAt)).not.toMatch(/createRateLimiter\(/);
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

  it("does not surface a deep URL that redirects to the homepage (wrong/stale link)", async () => {
    // Wrong governmentjobs slug+id: 200, but finalUrl after redirect is the homepage.
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
    expect(data.reason).toMatch(/pin down|wasn't the right|Posting URL tab/i);
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

describe("POST /api/posting-from-image (embedded engine)", () => {
  const OFFLINE_FIELDS = {
    jobTitle: "Senior Engineer",
    company: "Acme",
    location: "Remote",
    postingText: "We are hiring a Senior Engineer to build delightful products and scale our platform.",
    searchQuery: "Acme Senior Engineer remote",
  };

  it("reads the screenshot offline (OCR) and finds the URL via keyless search — no Gemini", async () => {
    readScreenshotOffline.mockResolvedValue({ ...OFFLINE_FIELDS });
    searchPostingUrls.mockResolvedValue(["https://acme.example/jobs/senior-engineer"]);
    fetchUrlContent.mockResolvedValue({
      title: "Senior Engineer",
      company: "Acme",
      description: "A".repeat(200),
      finalUrl: "https://acme.example/jobs/senior-engineer",
    });

    const res = await POST(imageRequest(pngFile(), "embedded"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("https://acme.example/jobs/senior-engineer");
    expect(data.jobTitle).toBe("Senior Engineer");
    // The Gemini client must never be constructed on the embedded path.
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(searchPostingUrls).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Acme Senior Engineer remote" }),
    );
  });

  it("still uses the ATS board URL first on the embedded path", async () => {
    readScreenshotOffline.mockResolvedValue({ ...OFFLINE_FIELDS });
    lookupAtsPostingUrl.mockResolvedValueOnce({ url: "https://boards.greenhouse.io/acme/jobs/9" });
    searchPostingUrls.mockResolvedValue(["https://acme.example/jobs/from-search"]);
    fetchUrlContent.mockResolvedValue({
      title: "Senior Engineer",
      company: "Acme",
      description: "C".repeat(200),
      finalUrl: "https://boards.greenhouse.io/acme/jobs/9",
    });

    const res = await POST(imageRequest(pngFile(), "embedded"));
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(fetchUrlContent.mock.calls[0][0]).toBe("https://boards.greenhouse.io/acme/jobs/9");
  });

  it("works with no Gemini key configured at all", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Missing required environment variables: Gemini_LLM_API_Key");
    });
    readScreenshotOffline.mockResolvedValue({ ...OFFLINE_FIELDS });
    searchPostingUrls.mockResolvedValue(["https://acme.example/jobs/senior-engineer"]);
    fetchUrlContent.mockResolvedValue({
      title: "Senior Engineer",
      description: "A".repeat(200),
      finalUrl: "https://acme.example/jobs/senior-engineer",
    });

    const res = await POST(imageRequest(pngFile(), "embedded"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(true);
  });

  it("reports not-found when OCR yields no recognizable posting", async () => {
    readScreenshotOffline.mockResolvedValue({ jobTitle: "", company: "", location: "", postingText: "", searchQuery: "" });
    const res = await POST(imageRequest(pngFile(), "embedded"));
    const data = await res.json();
    expect(data.found).toBe(false);
    expect(searchPostingUrls).not.toHaveBeenCalled();
  });

  it("tailors from OCR text when the URL search finds nothing — fully offline", async () => {
    readScreenshotOffline.mockResolvedValue({ ...OFFLINE_FIELDS });
    searchPostingUrls.mockResolvedValue([]); // no providers / offline / no hits
    const res = await POST(imageRequest(pngFile(), "embedded"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("");
    expect(data.jobTitle).toBe("Senior Engineer");
    expect(data.postingText).toBe(OFFLINE_FIELDS.postingText);
    expect(fetchUrlContent).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("tailors from OCR text when even the search itself throws", async () => {
    readScreenshotOffline.mockResolvedValue({ ...OFFLINE_FIELDS });
    searchPostingUrls.mockRejectedValue(new Error("network down"));
    const res = await POST(imageRequest(pngFile(), "embedded"));
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("");
    expect(data.postingText).toBe(OFFLINE_FIELDS.postingText);
  });

  it("tailors from OCR text when candidates exist but none resolve to a real page", async () => {
    readScreenshotOffline.mockResolvedValue({ ...OFFLINE_FIELDS });
    searchPostingUrls.mockResolvedValue(["https://stale.example/jobs/123"]);
    // The only candidate redirects to the homepage — excluded by resolvePosting.
    fetchUrlContent.mockResolvedValue({
      title: "Site",
      description: "H".repeat(500),
      finalUrl: "https://stale.example/",
    });
    const res = await POST(imageRequest(pngFile(), "embedded"));
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.url).toBe("");
    expect(data.postingText).toBe(OFFLINE_FIELDS.postingText);
  });

  it("still reports not-found with no URL when OCR text is too thin to tailor from", async () => {
    readScreenshotOffline.mockResolvedValue({
      jobTitle: "Eng",
      company: "Acme",
      location: "",
      postingText: "Short snippet only.",
      searchQuery: "Acme Eng",
    });
    searchPostingUrls.mockResolvedValue([]);
    const res = await POST(imageRequest(pngFile(), "embedded"));
    const data = await res.json();
    expect(data.found).toBe(false);
  });
});
