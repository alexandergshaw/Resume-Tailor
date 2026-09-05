import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupAtsPostingUrl, titleMatchScore, normalizeCompanyKey } from "./atsLookup.js";

describe("normalizeCompanyKey", () => {
  it("lowercases, drops punctuation and common suffixes", () => {
    expect(normalizeCompanyKey("Acme, Inc.")).toBe("acme");
    expect(normalizeCompanyKey("Foo & Bar Technologies")).toBe("fooandbar");
    expect(normalizeCompanyKey("")).toBe("");
  });

  // FINDING 3 of the security review asked whether the unanchored suffix strip
  // has the same quadratic shape as stripTags' /<[^>]+>/g (29.5 s on 200 000
  // '<'). It does NOT: its alternation is a flat list of literals fenced by
  // zero-width \b, so there is nothing to backtrack into. Measured on 2026-09-05,
  // Node 22: the worst of nine 200 KB shapes was 80 ms ("&" repeated, which is
  // just the " and " expansion tripling the string), and 1 MB of "co." was
  // 64 ms. Left unchanged — including its matching semantics, which the board
  // slugs depend on. This test is the guard on that conclusion.
  it.each([
    ["200 KB of the shortest alternative", () => "co".repeat(100000)],
    ["200 KB with no alternative present", () => "a".repeat(200000)],
    ["200 KB of separators", () => " ".repeat(200000)],
    ["200 KB of '&', the expanding rewrite", () => "&".repeat(200000)],
    ["200 KB of word-boundaried alternatives", () => "co ".repeat(66666)],
    ["200 KB of punctuation-boundaried alternatives", () => "co.".repeat(66666)],
    ["200 KB of a near-miss prefix", () => "compan".repeat(33333)],
    ["200 KB of the longest alternative, one char short", () => "technologie".repeat(18181)],
    ["1 MB of punctuation-boundaried alternatives", () => "co.".repeat(349525)],
  ])("stays linear on %s", (_why, build) => {
    const input = build();
    const t0 = performance.now();
    normalizeCompanyKey(input);
    expect(performance.now() - t0).toBeLessThan(1000);
  }, 60000);
});

describe("titleMatchScore", () => {
  it("scores token overlap normalized by the shorter title", () => {
    expect(titleMatchScore("Senior Software Engineer", "Senior Software Engineer")).toBe(1);
    expect(titleMatchScore("Software Engineer", "Senior Software Engineer, Backend")).toBe(1);
    expect(titleMatchScore("Data Scientist", "Marketing Manager")).toBe(0);
  });
});

describe("lookupAtsPostingUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns null without a company and title", async () => {
    expect(await lookupAtsPostingUrl({ company: "", jobTitle: "Engineer" })).toBeNull();
    expect(await lookupAtsPostingUrl({ company: "Acme", jobTitle: "" })).toBeNull();
  });

  it("matches a known Greenhouse company's board and returns the posting URL", async () => {
    // "Anthropic" is in the curated Greenhouse list (slug "anthropic").
    fetch.mockImplementation(async (url) => {
      if (url.includes("boards-api.greenhouse.io/v1/boards/anthropic/jobs")) {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              { title: "Office Manager", absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/1" },
              { title: "Senior Software Engineer", absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/2" },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const out = await lookupAtsPostingUrl({ company: "Anthropic", jobTitle: "Senior Software Engineer" });
    expect(out).toEqual({
      url: "https://job-boards.greenhouse.io/anthropic/jobs/2",
      title: "Senior Software Engineer",
      source: "greenhouse",
    });
  });

  it("falls back to a guessed Lever slug, requiring a strong title match", async () => {
    fetch.mockImplementation(async (url) => {
      if (url.includes("api.lever.co/v0/postings/zeta")) {
        return {
          ok: true,
          json: async () => [
            { text: "Staff Data Scientist", hostedUrl: "https://jobs.lever.co/zeta/abc" },
          ],
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const out = await lookupAtsPostingUrl({ company: "Zeta", jobTitle: "Staff Data Scientist" });
    expect(out?.url).toBe("https://jobs.lever.co/zeta/abc");
    expect(out?.source).toBe("lever");
  });

  it("returns null when no posting title matches", async () => {
    fetch.mockImplementation(async (url) => {
      if (url.includes("boards-api.greenhouse.io/v1/boards/anthropic/jobs")) {
        return { ok: true, json: async () => ({ jobs: [{ title: "Recruiter", absolute_url: "https://x/1" }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    expect(await lookupAtsPostingUrl({ company: "Anthropic", jobTitle: "Senior Software Engineer" })).toBeNull();
  });
});
