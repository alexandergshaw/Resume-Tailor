import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Does the Live Feed's Tailor button actually USE the full description?
//
// postingDescription.test.js proves the helpers behave. Every one of those
// assertions passes just as happily against a page.js whose
// handleTailorFeedPosting still reads
//
//     const postingText = (posting.description || posting.description_snippet || "").trim();
//     ...
//     if (postingUrl) formData.append("jobPostingUrl", postingUrl);
//     else formData.append("jobPosting", postingText);
//
// with the new module sitting beside it, fully tested and never called. This
// file is the guard against exactly that.
//
// It reads source text, which is ordinarily a poor way to test anything. It is
// used here for the same reason lib/feed/liveFeedWiring.test.js does: the
// alternative is mounting app/page.js, a 3000-line client component that owns
// Supabase clients, file uploads, MUI dialogs and a preview pipeline, and the
// property being pinned is about the SHAPE OF THE REQUEST this handler builds.
// The behaviour itself lives in postingDescription.js, where it is tested
// properly.
// ---------------------------------------------------------------------------

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const PAGE = "../../app/page.js";
const FEED_ROUTE = "../../app/api/feed/route.js";

// The body of handleTailorFeedPosting, so an assertion cannot be satisfied by
// an unrelated part of a very large file.
function tailorHandlerSource() {
  const src = read(PAGE);
  const start = src.indexOf("async function handleTailorFeedPosting(");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n  return (", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("handleTailorFeedPosting tailors from the full description", () => {
  it("fetches the full stored description on demand", () => {
    const handler = tailorHandlerSource();
    expect(handler).toMatch(/fetchFullPostingDescription\s*\(/);
  });

  it("imports the helpers from lib/feed rather than inlining the decision", () => {
    const src = read(PAGE);
    expect(src).toMatch(/from ["']@\/lib\/feed\/postingDescription["']/);
  });

  it("no longer decides the request shape with the old url-or-snippet branch", () => {
    // This is the defect. `description` is never selected by the feed list, so
    // `posting.description || posting.description_snippet` always resolved to
    // the 400-character truncation, and the branch below sent either that
    // truncation or a bare URL -- never the whole posting we already store.
    const handler = tailorHandlerSource();
    expect(handler).not.toMatch(/if\s*\(postingUrl\)\s*formData\.append\(\s*["']jobPostingUrl["']/);
    expect(handler).not.toMatch(/else\s*formData\.append\(\s*["']jobPosting["']\s*,\s*postingText\s*\)/);
  });

  it("builds jobPosting / jobPostingUrl through tailorPostingFields", () => {
    const handler = tailorHandlerSource();
    expect(handler).toMatch(/tailorPostingFields\s*\(/);
  });

  it("can tell the user when it fell back to the truncation", () => {
    const handler = tailorHandlerSource();
    expect(handler).toMatch(/truncatedDescriptionNotice\s*\(/);
  });

  it("persists the full text as the position description, not the truncation", () => {
    // upsertPosition writes `job.description` straight into positions.description
    // (lib/supabase/upsertPosition.js:25). The old code stored
    // `nextJobDescription || postingText`, so any run where /api/tailor
    // returned no scraped description silently persisted 400 characters.
    const handler = tailorHandlerSource();
    expect(handler).not.toMatch(/description:\s*nextJobDescription\s*\|\|\s*postingText\s*,/);
  });
});

describe("the feed listing does not pay for it", () => {
  it("still omits raw_data from the feed LIST select", () => {
    // The tempting one-line "fix" is to add raw_data to this select. That
    // query returns up to 50 postings at once and raw_data holds entire job
    // descriptions, so it would inflate every feed page load for a field
    // needed only when a single posting is tailored.
    const src = read(FEED_ROUTE);
    const start = src.indexOf('.from("feed_postings")');
    expect(start).toBeGreaterThan(-1);
    const select = src.slice(start, src.indexOf(";", start));
    expect(select).toContain("description_snippet");
    expect(select).not.toContain("raw_data");
  });
});

describe("app/page.js stays within its line budget", () => {
  it("is at most 3250 lines", () => {
    expect(read(PAGE).split("\n").length).toBeLessThanOrEqual(3250);
  });
});
