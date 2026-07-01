import { describe, it, expect, vi } from "vitest";
import {
  researchCompanyLocal,
  researchUrlLocal,
  firstSentences,
  hostOf,
  suggestionFor,
} from "./companyResearchLocal.js";

describe("firstSentences", () => {
  it("takes the first couple of sentences, clamped", () => {
    expect(firstSentences("One. Two. Three.", 100, 2)).toBe("One. Two.");
    expect(firstSentences("   ")).toBe("");
    const long = "a".repeat(300);
    expect(firstSentences(long, 240).endsWith("…")).toBe(true);
  });
});

describe("hostOf / suggestionFor", () => {
  it("strips www and builds a sincere opener", () => {
    expect(hostOf("https://www.technews.example/x")).toBe("technews.example");
    expect(suggestionFor({ company: "Acme", title: "Acme raises $50M" })).toContain("Acme");
    expect(suggestionFor({ company: "", title: "" })).toContain("your team");
  });
});

describe("researchCompanyLocal", () => {
  it("searches, filters non-news, scrapes, and builds cards", async () => {
    const searchImpl = vi.fn(async () => [
      "https://technews.example/acme-50m",
      "https://www.linkedin.com/x", // filtered
      "https://boards.greenhouse.io/acme/jobs/1", // filtered
      "https://bizweekly.example/acme-award",
    ]);
    const fetchImpl = vi.fn(async (url) => ({
      title: url.includes("award") ? "Acme wins award" : "Acme raises $50M",
      description: "Acme announced funding today. Growth continues.",
      publishedDate: "March 2026",
      finalUrl: url,
    }));

    const out = await researchCompanyLocal(
      { company: "Acme", jobTitle: "Engineer" },
      { searchImpl, fetchImpl, env: {} },
    );
    expect(out.articles.length).toBeGreaterThanOrEqual(1);
    expect(out.articles.every((a) => !/linkedin|greenhouse/.test(a.url))).toBe(true);
    expect(out.articles[0].date).toBe("March 2026");
    expect(out.grounded.length).toBe(out.articles.length);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("returns no articles (and no warning) when nothing scrapes", async () => {
    const out = await researchCompanyLocal(
      { company: "Ghost" },
      { searchImpl: async () => ["https://x.example/a"], fetchImpl: async () => ({ error: "gone" }), env: {} },
    );
    expect(out.articles).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("requires a company", async () => {
    const out = await researchCompanyLocal({ company: "" }, { searchImpl: async () => [], fetchImpl: async () => ({}) });
    expect(out.articles).toEqual([]);
  });
});

describe("researchUrlLocal", () => {
  it("builds one card from a readable page", async () => {
    const out = await researchUrlLocal(
      { url: "https://news.example/acme-lab", company: "Acme" },
      { fetchImpl: async () => ({ title: "Acme opens lab", description: "Acme opened a lab in Boston. AI focus." }) },
    );
    expect(out.articles).toHaveLength(1);
    expect(out.articles[0].url).toBe("https://news.example/acme-lab");
    expect(out.articles[0].summary).toContain("Acme");
  });

  it("returns an error object when the page can't be read", async () => {
    const out = await researchUrlLocal(
      { url: "https://blocked.example/x" },
      { fetchImpl: async () => ({ error: "403" }) },
    );
    expect(out.error).toMatch(/couldn't read/i);
    expect(out.status).toBe(502);
  });
});
