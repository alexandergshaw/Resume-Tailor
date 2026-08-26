import { describe, it, expect } from "vitest";
import {
  MAX_COMPANY_FACTS,
  COMPANY_FACTS_SYSTEM,
  buildCompanyFactsPrompt,
  parseFactsResponse,
  normalizeCompanyFacts,
  companyFactsBlock,
} from "./companyFacts.js";

// AC-V4.1/V4.3/V4.7. Direct unit coverage for the pure half of "verified
// company facts" — companyFactsSource.js's buildCompanyFacts is what runs
// the model call and the corroboration; this file only exercises the prompt
// text, the defensive parse, the normalize/cap/id step, and the block
// buildPointsPrompt injects.

describe("COMPANY_FACTS_SYSTEM", () => {
  it("is a single joined string, not an array", () => {
    // Passed straight to `config.systemInstruction` — an array would be a
    // different request, silently.
    expect(typeof COMPANY_FACTS_SYSTEM).toBe("string");
    expect(COMPANY_FACTS_SYSTEM.length).toBeGreaterThan(0);
  });
});

describe("buildCompanyFactsPrompt", () => {
  it("returns null when there is no company — the signal to skip the model call entirely", () => {
    expect(buildCompanyFactsPrompt({ company: "", jobTitle: "Engineer" })).toBeNull();
    expect(buildCompanyFactsPrompt({})).toBeNull();
    expect(buildCompanyFactsPrompt(undefined)).toBeNull();
  });

  it("names the company and asks for claim/url/kind in JSON", () => {
    const prompt = buildCompanyFactsPrompt({ company: "Purple Wave" });
    expect(prompt).toContain("Purple Wave");
    expect(prompt).toContain("claim");
    expect(prompt).toContain("url");
    expect(prompt).toContain("kind");
    expect(prompt).toContain('"facts"');
    expect(prompt).toContain(String(MAX_COMPANY_FACTS));
  });

  it("mentions the role only when one was given, never an empty mention", () => {
    const withRole = buildCompanyFactsPrompt({ company: "Purple Wave", jobTitle: "Director of Platform Engineering" });
    expect(withRole).toContain("Director of Platform Engineering");
    const withoutRole = buildCompanyFactsPrompt({ company: "Purple Wave", jobTitle: "" });
    expect(withoutRole).not.toContain("interviewing for the");
  });
});

describe("parseFactsResponse", () => {
  it("extracts the facts array from prose wrapped around a fenced JSON block", () => {
    // Gemini's googleSearch tool is incompatible with responseMimeType:json,
    // so the real response is prose around a fenced block — the same shape
    // app/api/company-research/route.js's parseArticles is written for.
    const raw = 'Here is what I found.\n```json\n{"facts":[{"claim":"A claim.","url":"https://a.test","kind":"what"}]}\n```';
    expect(parseFactsResponse(raw)).toEqual([{ claim: "A claim.", url: "https://a.test", kind: "what" }]);
  });

  it("returns [] when there is no JSON at all", () => {
    expect(parseFactsResponse("I could not find anything.")).toEqual([]);
  });

  it("returns [] when the JSON parses but carries no facts array", () => {
    expect(parseFactsResponse('{"articles": []}')).toEqual([]);
  });

  it("never throws on malformed input", () => {
    for (const input of [null, undefined, 42, "{", "{{{"]) {
      expect(() => parseFactsResponse(input)).not.toThrow();
    }
  });
});

describe("normalizeCompanyFacts", () => {
  it("trims fields, assigns position-derived ids, and normalizes kind", () => {
    const raw = [
      { claim: "  A real claim.  ", url: " https://a.test ", kind: " Recent " },
      { claim: "Another claim.", url: "https://b.test", kind: "bogus-kind" },
    ];
    expect(normalizeCompanyFacts(raw)).toEqual([
      { id: "fact-0", claim: "A real claim.", url: "https://a.test", kind: "recent" },
      // An unrecognised kind is normalized to "what" rather than dropped —
      // it is a hint for ordering, not itself part of the claim.
      { id: "fact-1", claim: "Another claim.", url: "https://b.test", kind: "what" },
    ]);
  });

  it("drops an entry missing a non-empty claim or url", () => {
    const raw = [
      { claim: "", url: "https://a.test", kind: "what" },
      { claim: "Something true.", url: "  ", kind: "what" },
      { claim: "Kept claim.", url: "https://c.test", kind: "what" },
    ];
    expect(normalizeCompanyFacts(raw)).toEqual([
      { id: "fact-0", claim: "Kept claim.", url: "https://c.test", kind: "what" },
    ]);
  });

  it("caps at MAX_COMPANY_FACTS by default, and at a caller-supplied cap", () => {
    const raw = Array.from({ length: 8 }, (_, i) => ({ claim: `Claim ${i}.`, url: `https://x.test/${i}` }));
    expect(normalizeCompanyFacts(raw)).toHaveLength(MAX_COMPANY_FACTS);
    expect(normalizeCompanyFacts(raw, { cap: 2 })).toHaveLength(2);
  });

  it("treats a missing or malformed raw array as no facts at all", () => {
    expect(normalizeCompanyFacts(null)).toEqual([]);
    expect(normalizeCompanyFacts(undefined)).toEqual([]);
    expect(normalizeCompanyFacts("not an array")).toEqual([]);
  });

  it("never throws, whatever it is handed", () => {
    for (const raw of [null, undefined, "x", 7, [null, undefined, 42, "x", {}]]) {
      expect(() => normalizeCompanyFacts(raw)).not.toThrow();
    }
  });
});

describe("companyFactsBlock", () => {
  it("renders one '(fact id: ...) claim' line per fact, joined by newline", () => {
    const facts = [
      { id: "fact-0", claim: "Purple Wave is an online auction marketplace.", url: "https://a.test", kind: "what" },
      { id: "fact-1", claim: "Founded in Manhattan, Kansas.", url: "https://b.test", kind: "size" },
    ];
    expect(companyFactsBlock(facts)).toBe(
      "(fact id: fact-0) Purple Wave is an online auction marketplace.\n(fact id: fact-1) Founded in Manhattan, Kansas.",
    );
  });

  it("never includes the source URL — the route hands that to the candidate through the whitelist, not the model", () => {
    const facts = [{ id: "fact-0", claim: "A claim.", url: "https://should-not-appear.test", kind: "what" }];
    expect(companyFactsBlock(facts)).not.toContain("https://should-not-appear.test");
  });

  it("returns '' — no heading, no empty block — for an empty or malformed facts list", () => {
    expect(companyFactsBlock([])).toBe("");
    expect(companyFactsBlock(null)).toBe("");
    expect(companyFactsBlock(undefined)).toBe("");
  });
});
