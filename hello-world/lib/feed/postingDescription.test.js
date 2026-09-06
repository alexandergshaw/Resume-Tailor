import { describe, it, expect, vi } from "vitest";
import {
  fetchFullPostingDescription,
  tailorPostingFields,
  truncatedDescriptionNotice,
  FULL_DESCRIPTION_ENDPOINT,
} from "./postingDescription.js";
import { snippetFrom } from "./normalize.js";

// ---------------------------------------------------------------------------
// The defect these tests exist for.
//
// The feed LIST query (app/api/feed/route.js) deliberately omits `raw_data`,
// so a posting object on the client carries `description_snippet` -- a 400
// character truncation with an ellipsis (lib/feed/normalize.js snippetFrom) --
// and no `description` at all. handleTailorFeedPosting then tailored from
// whatever that object held.
//
// The apply / auto-apply-queue / cron paths all select `raw_data` and tailor
// from `raw_data.description`, the WHOLE posting. This module is how the Live
// Feed's Tailor button gets the same text, fetched only when the user actually
// clicks (never on a feed page load).
// ---------------------------------------------------------------------------

const FULL = [
  "About the role",
  "We are hiring a Staff Platform Engineer to own our multi-region ingest pipeline.",
  "Responsibilities: design the streaming topology, own the on-call rotation, mentor three engineers.",
  "Requirements: 8+ years building distributed systems, deep Kafka experience, Terraform, Go or Rust.",
  "Nice to have: prior work on a job board or ATS integration, experience with resume parsing at scale.",
  "Benefits: fully remote within the US, 4 weeks PTO, 401k match, annual learning budget.",
  "Our interview process is four stages and we give feedback at every one of them.",
].join("\n\n");

// The exact truncation the feed stores and therefore the exact text the buggy
// path fed to the tailoring engine.
const SNIPPET = snippetFrom(FULL);

// A sentence that lives past the 400-character cut, so "did we get the whole
// posting?" is a question the fixture can actually answer.
const LOST_SENTENCE = "we give feedback at every one of them";

const POSTING = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Staff Platform Engineer",
  company: "Acme",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  description_snippet: SNIPPET,
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

describe("the snippet this module exists to stop tailoring from", () => {
  it("is a 399-character truncation of a much longer posting", () => {
    // Guards the premise: if the fixture stopped being truncated, every test
    // below would pass while proving nothing.
    expect(FULL.length).toBeGreaterThan(400);
    // snippetFrom slices to 400, trimEnd()s (this fixture's cut lands in
    // whitespace, losing 2 chars), then appends the ellipsis.
    expect(SNIPPET.length).toBe(399);
    expect(SNIPPET.endsWith("…")).toBe(true);
    expect(FULL).toContain(LOST_SENTENCE);
    expect(SNIPPET).not.toContain(LOST_SENTENCE);
  });
});

describe("fetchFullPostingDescription", () => {
  it("reads the whole description for one posting, not the feed list", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: POSTING.id, description: FULL, full: true }),
    );

    const result = await fetchFullPostingDescription(POSTING, { fetchImpl });

    expect(result.full).toBe(true);
    expect(result.text).toBe(FULL);
    // The whole point: the text handed onward is NOT the truncation.
    expect(result.text).not.toBe(SNIPPET);
    expect(result.text).toContain(LOST_SENTENCE);

    // One targeted single-row read, addressed by posting id.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain(FULL_DESCRIPTION_ENDPOINT);
    expect(url).toContain(encodeURIComponent(POSTING.id));
  });

  it("reports full:false with a reason when the row has no stored description", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: POSTING.id,
        description: SNIPPET,
        full: false,
        reason: "This posting was ingested without a stored full description.",
      }),
    );

    const result = await fetchFullPostingDescription(POSTING, { fetchImpl });

    expect(result.full).toBe(false);
    expect(result.text).toBe(SNIPPET);
    expect(result.reason).toMatch(/without a stored full description/i);
  });

  it("falls back to the snippet, with a reason, when the request fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, { ok: false, status: 500 }));

    const result = await fetchFullPostingDescription(POSTING, { fetchImpl });

    expect(result.full).toBe(false);
    expect(result.text).toBe(SNIPPET);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toContain("500");
  });

  it("falls back to the snippet, with a reason, when the request throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await fetchFullPostingDescription(POSTING, { fetchImpl });

    expect(result.full).toBe(false);
    expect(result.text).toBe(SNIPPET);
    expect(result.reason).toContain("offline");
  });

  it("does not make a request at all for a posting with no id", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchFullPostingDescription({ description_snippet: SNIPPET }, { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.full).toBe(false);
    expect(result.text).toBe(SNIPPET);
  });
});

describe("tailorPostingFields", () => {
  it("sends the full text as jobPosting and DROPS the URL", () => {
    const fields = tailorPostingFields({ text: FULL, full: true, url: POSTING.url });

    expect(fields.jobPosting).toBe(FULL);
    // Not merely "a URL is also fine". lib/llm/tailorResume.js:85 builds the
    // Gemini prompt as `jobPostingUrl ? "<url>, fetch it" : "<text>"` -- when
    // BOTH are supplied the URL wins and the full text we just fetched is
    // thrown away. app/api/tailor/route.js:339 clears the URL for exactly this
    // reason after its own successful scrape. So the URL must not be sent.
    expect(fields.jobPostingUrl).toBe("");
  });

  it("keeps the URL (and sends no text) when only the truncation is available", () => {
    // Sending 400 characters here would be strictly worse than today: the
    // server-side scrape in app/api/tailor/route.js:328 can still recover the
    // whole posting from the URL.
    const fields = tailorPostingFields({ text: SNIPPET, full: false, url: POSTING.url });

    expect(fields.jobPostingUrl).toBe(POSTING.url);
    expect(fields.jobPosting).toBe("");
  });

  it("falls back to the truncation only when there is no URL either", () => {
    const fields = tailorPostingFields({ text: SNIPPET, full: false, url: "" });

    expect(fields.jobPosting).toBe(SNIPPET);
    expect(fields.jobPostingUrl).toBe("");
  });
});

describe("truncatedDescriptionNotice", () => {
  it("says nothing when the full description was used", () => {
    expect(truncatedDescriptionNotice({ full: true, scrapedDescription: "" })).toBe("");
  });

  it("says nothing when the server's scrape recovered the posting instead", () => {
    // full:false but /api/tailor came back with a scraped jobDescription --
    // the engine did see the whole posting, so warning would be a lie.
    expect(
      truncatedDescriptionNotice({ full: false, scrapedDescription: FULL, reason: "no raw_data" }),
    ).toBe("");
  });

  it("warns, naming the truncation and the reason, when nothing better was available", () => {
    const notice = truncatedDescriptionNotice({
      full: false,
      scrapedDescription: "",
      reason: "This posting was ingested without a stored full description.",
    });

    expect(notice).toBeTruthy();
    // Silence is the failure mode this exists to prevent: the user must be
    // able to tell that a tailored resume was built on a truncation.
    expect(notice).toMatch(/full job description/i);
    expect(notice).toMatch(/400/);
    expect(notice).toContain("without a stored full description");
  });
});
