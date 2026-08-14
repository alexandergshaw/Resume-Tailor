import { describe, it, expect } from "vitest";
import { parsePostings, looksLikeJobPosting } from "@/lib/feed/llmSearchParse";

// Gemini's googleSearch tool is incompatible with responseMimeType:json (see the
// comment on parseArticles in app/api/company-research/route.js), so the model
// returns prose wrapped around a JSON block and it must be parsed defensively.

describe("parsePostings", () => {
  it("pulls postings out of a fenced JSON block surrounded by prose", () => {
    const raw = [
      "Here is what I found!",
      "```json",
      '{"postings":[{"title":"React Engineer","company":"Acme","location":"Remote","url":"https://acme.com/j/1"}]}',
      "```",
      "Hope that helps.",
    ].join("\n");
    expect(parsePostings(raw)).toEqual([
      {
        title: "React Engineer",
        company: "Acme",
        location: "Remote",
        url: "https://acme.com/j/1",
        employmentType: "",
        postedText: "",
      },
    ]);
  });

  it("accepts a bare array as well as a {postings:[...]} envelope", () => {
    const raw = '[{"title":"Rust Dev","company":"Globex","url":"https://globex.com/1"}]';
    expect(parsePostings(raw)).toHaveLength(1);
  });

  it("drops the model's own description entirely", () => {
    // The description is the single most dangerous field to trust: it is what a
    // resume gets tailored against. It must come from the fetched page, never
    // from the model. See lib/feed/llmSearch.js.
    const raw =
      '[{"title":"X","company":"Y","url":"https://y.com/1","description":"INVENTED RESPONSIBILITIES"}]';
    const parsed = parsePostings(raw);
    expect(JSON.stringify(parsed)).not.toContain("INVENTED");
    expect(parsed[0]).not.toHaveProperty("description");
  });

  it("requires both a title and a url", () => {
    const raw =
      '[{"title":"No url","company":"A"},{"url":"https://b.com/1","company":"B"},{"title":"Good","url":"https://c.com/1"}]';
    expect(parsePostings(raw).map((p) => p.title)).toEqual(["Good"]);
  });

  it("returns [] rather than throwing on unparseable or empty output", () => {
    for (const bad of ["", null, undefined, "no json at all", "{broken", "[1,2,3]"]) {
      expect(parsePostings(bad)).toEqual([]);
    }
  });
});

describe("looksLikeJobPosting", () => {
  const realPosting = [
    "Senior React Engineer at Acme",
    "About the role: you will build and ship product surfaces used by millions.",
    "Responsibilities: own features end to end, review code, mentor engineers, and partner with design.",
    "Qualifications: 5+ years of experience with React and TypeScript, strong testing habits.",
    "Benefits: health, dental, generous PTO. Apply now to join our team.",
  ].join("\n");

  it("accepts a page that reads like an individual posting", () => {
    expect(looksLikeJobPosting({ description: realPosting })).toBe(true);
  });

  it("rejects a page too short to be a real posting EVEN when it carries a marker", () => {
    // Exercises the length floor alone. A fixture that is both short and
    // marker-less passes whichever check survives, so it tests neither.
    expect(looksLikeJobPosting({ description: "React Engineer. Apply here." })).toBe(false);
    expect(looksLikeJobPosting({ description: "Experience required." })).toBe(false);
    expect(looksLikeJobPosting({ description: "Benefits: PTO." })).toBe(false);
  });

  it("accepts a long page carrying any ONE of the posting markers", () => {
    // Exercises each marker alone. The realPosting fixture contains all of
    // them at once, so five of the six are otherwise never tested.
    for (const marker of [
      "Responsibilities: own features end to end and review code.",
      "Qualifications: a strong portfolio and good testing habits.",
      "Requirements: a degree or an equivalent practical background.",
      "Benefits: health, dental, and generous paid time off.",
      "What you'll do: ship product surfaces used by many people.",
    ]) {
      expect(looksLikeJobPosting({ description: marker.padEnd(500, " x") })).toBe(true);
    }
  });

  it("rejects a long page carrying none of the posting markers", () => {
    // A blog post or a 404 body: long, and useless to the tailor pipeline.
    expect(looksLikeJobPosting({ description: "lorem ipsum dolor sit amet ".repeat(80) })).toBe(false);
  });

  it("rejects a careers INDEX page that happens to mention posting words", () => {
    // The realistic false positive, and the one a short fixture never reaches:
    // a board listing every opening mentions "requirements" somewhere and is
    // long, but describes no single job.
    const index = [
      "Careers at Acme — 84 open roles",
      "Filter by team, location and requirements. Browse all departments below.",
      ...Array.from({ length: 40 }, (_, i) => `Software Engineer ${i} — Remote — View role`),
    ].join("\n");
    expect(looksLikeJobPosting({ description: index })).toBe(false);
  });

  it("rejects an unreadable fetch outright", () => {
    for (const bad of [null, undefined, {}, { error: "403" }, { description: "" }]) {
      expect(looksLikeJobPosting(bad)).toBe(false);
    }
  });
});
