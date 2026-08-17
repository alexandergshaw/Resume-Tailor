import { describe, it, expect } from "vitest";
import {
  companyBriefRequest,
  normalizeBriefArticles,
  briefStatusMessage,
  MAX_BRIEF_ARTICLES,
  MAX_BRIEF_POSTING_CHARS,
} from "./companyBrief.js";

// AC-T2.1..T2.4. Pure shaping for the live-interview company brief: what goes
// out to /api/company-research, what comes back that is safe to render, and
// what a polite live region says about it.

const posting = (extra = {}) => ({
  id: "app-1",
  title: "Staff Engineer",
  company: "Acme Corp",
  description: "We are hiring a staff engineer to own the billing platform.",
  url: "https://example.com/job",
  label: "Staff Engineer — Acme Corp",
  ...extra,
});

// F9: without these, any value passes the cap tests below — MAX_BRIEF_ARTICLES
// was only constrained to >= 2, and MAX_BRIEF_POSTING_CHARS not at all. Both
// numbers are stated in the AC and one of them has to agree with the research
// route's own (private) MAX_POSTING_CHARS, so both are pinned here.
describe("the caps are the values the AC states", () => {
  it("shows at most three article cards", () => {
    expect(MAX_BRIEF_ARTICLES).toBe(3);
  });

  it("sends at most the same posting text the route itself keeps", () => {
    expect(MAX_BRIEF_POSTING_CHARS).toBe(6000);
  });
});

describe("companyBriefRequest (AC-T2.1)", () => {
  it("builds the route's body from the selected posting", () => {
    expect(companyBriefRequest(posting())).toEqual({
      company: "Acme Corp",
      jobTitle: "Staff Engineer",
      posting: "We are hiring a staff engineer to own the billing platform.",
    });
  });

  it("returns null when there is no posting", () => {
    expect(companyBriefRequest(null)).toBeNull();
    expect(companyBriefRequest(undefined)).toBeNull();
  });

  it("returns null when the posting names no company", () => {
    expect(companyBriefRequest(posting({ company: "" }))).toBeNull();
    expect(companyBriefRequest(posting({ company: "   " }))).toBeNull();
    expect(companyBriefRequest(posting({ company: null }))).toBeNull();
  });

  it("trims the company and title", () => {
    const body = companyBriefRequest(posting({ company: "  Acme Corp  ", title: " Staff Engineer " }));
    expect(body.company).toBe("Acme Corp");
    expect(body.jobTitle).toBe("Staff Engineer");
  });

  it("tolerates a missing title and a missing description", () => {
    const body = companyBriefRequest({ company: "Acme Corp" });
    expect(body).toEqual({ company: "Acme Corp", jobTitle: "", posting: "" });
  });

  it("caps the posting text it sends", () => {
    expect(MAX_BRIEF_POSTING_CHARS).toBeGreaterThan(0);
    const body = companyBriefRequest(posting({ description: "x".repeat(MAX_BRIEF_POSTING_CHARS + 500) }));
    expect(body.posting.length).toBe(MAX_BRIEF_POSTING_CHARS);
  });
});

describe("normalizeBriefArticles (AC-T2.2)", () => {
  const article = (extra = {}) => ({
    id: "art-0",
    title: "Acme raises Series C",
    source: "TechCrunch",
    date: "2026-02-01",
    url: "https://example.com/a",
    summary: "Acme raised $80M to expand its billing platform.",
    suggestion: "Ask how the raise changes the platform roadmap.",
    ...extra,
  });

  it("passes a well-formed article through, trimmed", () => {
    const [out] = normalizeBriefArticles([article({ title: "  Acme raises Series C  " })]);
    expect(out.title).toBe("Acme raises Series C");
    expect(out.source).toBe("TechCrunch");
    expect(out.summary).toBe("Acme raised $80M to expand its billing platform.");
    expect(out.suggestion).toBe("Ask how the raise changes the platform roadmap.");
    expect(out.url).toBe("https://example.com/a");
  });

  it("drops entries with no title or no summary", () => {
    expect(normalizeBriefArticles([article({ title: "" })])).toEqual([]);
    expect(normalizeBriefArticles([article({ summary: "   " })])).toEqual([]);
    expect(normalizeBriefArticles([article({ title: null, summary: null })])).toEqual([]);
  });

  it("keeps the good entries alongside the dropped ones", () => {
    const out = normalizeBriefArticles([article({ title: "" }), article({ title: "Kept" })]);
    expect(out.map((a) => a.title)).toEqual(["Kept"]);
  });

  it(`caps the list at MAX_BRIEF_ARTICLES (${MAX_BRIEF_ARTICLES})`, () => {
    const many = Array.from({ length: MAX_BRIEF_ARTICLES + 4 }, (_, i) => article({ title: `T${i}` }));
    expect(normalizeBriefArticles(many)).toHaveLength(MAX_BRIEF_ARTICLES);
  });

  it("gives every entry a non-empty id, even when the source omitted one", () => {
    const out = normalizeBriefArticles([article({ id: "" }), article({ id: undefined, title: "Second" })]);
    expect(out).toHaveLength(2);
    for (const a of out) expect(String(a.id).length).toBeGreaterThan(0);
    expect(new Set(out.map((a) => a.id)).size).toBe(2);
  });

  // F8: uniqueness-within-one-call was satisfied by Math.random(). AC-T2.2
  // says STABLE, and it has to be: these ids are React keys, so a value that
  // changes per call remounts every article card on every parent render,
  // dropping focus and any disclosure state mid-interview.
  it("gives the same input the same ids every time", () => {
    const input = [article({ id: "" }), article({ id: undefined, title: "Second" })];
    const first = normalizeBriefArticles(input).map((a) => a.id);
    const second = normalizeBriefArticles(input).map((a) => a.id);
    expect(second).toEqual(first);
  });

  it("tolerates a non-array, null entries and missing fields", () => {
    expect(normalizeBriefArticles(null)).toEqual([]);
    expect(normalizeBriefArticles(undefined)).toEqual([]);
    expect(normalizeBriefArticles("nope")).toEqual([]);
    expect(normalizeBriefArticles([null, undefined])).toEqual([]);
    const [out] = normalizeBriefArticles([{ title: "T", summary: "S" }]);
    expect(out).toMatchObject({ title: "T", summary: "S", source: "", date: "", url: "", suggestion: "" });
  });
});

describe("briefStatusMessage (AC-T2.3)", () => {
  const cases = [
    ["idle", { status: "idle", company: "Acme Corp" }],
    ["loading", { status: "loading", company: "Acme Corp" }],
    ["done-with-articles", { status: "done", count: 3, company: "Acme Corp" }],
    ["done-with-none", { status: "done", count: 0, company: "Acme Corp" }],
    ["error", { status: "error", company: "Acme Corp", error: "Company research failed." }],
  ];

  for (const [name, input] of cases) {
    it(`returns a non-empty sentence for ${name}`, () => {
      const text = briefStatusMessage(input);
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
    });
  }

  // A live region that repeats itself announces nothing: React bails out of
  // committing an unchanged text node, so two statuses sharing a sentence are
  // silent for whichever transition lands second.
  it("never returns the same sentence for two different statuses", () => {
    const texts = cases.map(([, input]) => briefStatusMessage(input));
    expect(new Set(texts).size).toBe(texts.length);
  });

  // F5: every assertion above, including the distinctness one, was fully
  // satisfied by `briefStatusMessage = (o) => JSON.stringify(o || {})` — which
  // a screen reader would read out as `{"status":"done","count":2,...}`.
  // Nothing asserted the output was prose. These do.
  for (const [name, input] of cases) {
    it(`returns a spoken sentence, not a serialized object, for ${name}`, () => {
      const text = briefStatusMessage(input);
      expect(text).not.toMatch(/[{}[\]"]/);
      expect(text).toMatch(/^[A-Z][^{}[\]"]*\.$/);
    });
  }

  // The two states most easily confused with each other, and the two whose
  // confusion matters most: a search that RAN and found nothing is a different
  // fact from a search that FAILED, and neither may borrow the other's wording.
  it("distinguishes 'found nothing' from 'could not look it up'", () => {
    const none = briefStatusMessage({ status: "done", count: 0, company: "Acme" });
    const failed = briefStatusMessage({ status: "error", company: "Acme" });
    expect(none).not.toBe(failed);
    expect(none.toLowerCase()).toMatch(/no .*article|none/);
    expect(failed.toLowerCase()).toMatch(/could not|couldn't|failed|unavailable/);
  });

  it("names the company in the done-with-articles sentence", () => {
    expect(briefStatusMessage({ status: "done", count: 2, company: "Acme Corp" })).toContain("Acme Corp");
  });

  it("reports how many articles came back", () => {
    expect(briefStatusMessage({ status: "done", count: 2, company: "Acme Corp" })).toMatch(/\b2\b/);
  });

  it("carries the real error text when there is one", () => {
    expect(
      briefStatusMessage({ status: "error", company: "Acme", error: "Gemini key not configured." }),
    ).toContain("Gemini key not configured.");
  });

  it("still returns a sentence for an unknown status or a missing company", () => {
    expect(briefStatusMessage({}).trim().length).toBeGreaterThan(0);
    expect(briefStatusMessage({ status: "weird" }).trim().length).toBeGreaterThan(0);
    expect(briefStatusMessage({ status: "done", count: 1 }).trim().length).toBeGreaterThan(0);
  });
});

describe("companyBrief.js is pure (AC-T2.4)", () => {
  // F8: `Math.random` was missing from this scan — the one guard that would
  // have caught an unstable article id was the one with the gap.
  it("reaches for no clock, no randomness, no DOM, no network", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./companyBrief.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|document\.|window\.|fetch\(/);
  });
});
