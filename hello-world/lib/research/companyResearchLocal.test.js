import { describe, it, expect, vi } from "vitest";
import {
  researchCompanyLocal,
  researchUrlLocal,
  articleSummary,
  hostOf,
  suggestionFor,
} from "./companyResearchLocal.js";

describe("articleSummary", () => {
  it("extracts the informative sentences, not merely the first", () => {
    const text =
      "Please accept our cookies. Sign in for more content today. Acme announced a $50M funding round to expand its data platform.";
    const out = articleSummary(text, { company: "Acme" });
    // The later, on-topic funding sentence is selected over low-value filler.
    expect(out).toContain("funding");
    expect(out).not.toContain("Sign in");
    expect(articleSummary("", {})).toBe("");
  });
});

describe("hostOf / suggestionFor", () => {
  it("strips www and builds a sincere, article-specific opener", () => {
    expect(hostOf("https://www.technews.example/x")).toBe("technews.example");
    expect(suggestionFor({ company: "Acme", title: "Acme raises $50M", seed: "u1" })).toContain("Acme");
    expect(suggestionFor({ company: "Acme", title: "Acme raises $50M", seed: "u1" })).toContain("$50M");
    expect(suggestionFor({ company: "", title: "" })).toContain("your team");
  });

  it("varies the opener across different articles (seeds)", () => {
    const seeds = ["u1", "u2", "u3", "u4", "u5"].map((s) =>
      suggestionFor({ company: "Acme", title: "Acme wins award", seed: s }),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
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
