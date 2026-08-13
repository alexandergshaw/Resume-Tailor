import { describe, it, expect } from "vitest";
import { buildProjectStoriesBlock, MAX_STORIES_CHARS } from "./projectStories.js";

// The user's own project pages, offered to the copilot as material for
// "tell me about a time..." answers.
//
// Two rules here are about honesty rather than correctness, and both come from
// things this codebase has already got wrong:
//
//  - A generated research page is a model's claims about the industry. Spoken
//    aloud in an interview as the candidate's own experience, that is a lie the
//    user did not know they were telling.
//  - The answer route labels its supporting aid with where the material came
//    from, and that label is a two-value enum today ("resume" or "prep"). Page
//    material must never borrow either. Being told a claim is "on your resume"
//    when it is not is worse than no aid at all, because the user will say it
//    with confidence in front of an interviewer.

const page = (over = {}) => ({
  id: "p1",
  title: "Payments migration",
  body: "Led the settlement rewrite.\n\n- Cut settlement from three days to one\n- Led a team of six engineers",
  generated_kind: null,
  archived_at: null,
  ...over,
});

describe("buildProjectStoriesBlock", () => {
  it("offers each page as a labelled story with its own body", () => {
    const { block } = buildProjectStoriesBlock([page()]);
    expect(block).toContain("Payments migration");
    expect(block).toContain("Cut settlement from three days to one");
  });

  it("never offers a generated page as the user's own experience", () => {
    const { block } = buildProjectStoriesBlock([
      page({ id: "r1", title: "Research: Payments", generated_kind: "research" }),
    ]);
    expect(block).toBe("");
  });

  it("treats any generated_kind as generated, and skips archived pages", () => {
    expect(buildProjectStoriesBlock([page({ generated_kind: "summary" })]).block).toBe("");
    expect(buildProjectStoriesBlock([page({ archived_at: "2026-08-01T00:00:00.000Z" })]).block).toBe("");
  });

  it("still offers ordinary pages", () => {
    // Positive control: excluding everything satisfies all three rules above.
    const { block } = buildProjectStoriesBlock([page(), page({ id: "p2", title: "Billing rewrite" })]);
    expect(block).toContain("Payments migration");
    expect(block).toContain("Billing rewrite");
  });

  it("returns an empty block for no eligible pages, so the prompt is unchanged", () => {
    // The route must be able to send a byte-identical prompt to today when the
    // user has no project pages. An empty string, not a header with nothing
    // beneath it.
    expect(buildProjectStoriesBlock([]).block).toBe("");
    expect(buildProjectStoriesBlock([page({ title: "", body: "" })]).block).toBe("");
  });

  it("stays within budget, drops whole pages, and says that it did", () => {
    // This route fires mid-question. It has no token counting and budgets only
    // with bare slices, so an unbounded block is a latency and truncation risk
    // at the worst possible moment. Half a project told as a complete story is
    // worse than one that was left out and said so.
    const many = Array.from({ length: 40 }, (_, i) =>
      page({ id: `p${i}`, title: `Project ${i}`, body: "x".repeat(2000) }),
    );
    const { block, truncated, includedCount } = buildProjectStoriesBlock(many);
    expect(block.length).toBeLessThanOrEqual(MAX_STORIES_CHARS);
    expect(truncated).toBe(true);
    expect(block.toLowerCase()).toMatch(/truncat|not included|omitted/);
    expect(includedCount).toBeLessThan(many.length);
  });

  it("reports nothing truncated when everything fits", () => {
    const { truncated, block } = buildProjectStoriesBlock([page()]);
    expect(truncated).toBe(false);
    expect(block.toLowerCase()).not.toMatch(/truncat/);
  });

  it("marks the block so an aid can name project pages as the source", () => {
    // The answer route attributes each aid to where its claim came from. Page
    // material must be attributable as page material - not silently folded in
    // beside the resume, which is the label the user would otherwise be shown.
    const { sourceLabel } = buildProjectStoriesBlock([page()]);
    expect(sourceLabel).toBeTruthy();
    expect(String(sourceLabel).toLowerCase()).not.toBe("resume");
    expect(String(sourceLabel).toLowerCase()).not.toBe("prep");
  });

  it("never throws on junk input", () => {
    for (const input of [null, undefined, [null], [{}], [{ title: null, body: null }]]) {
      expect(() => buildProjectStoriesBlock(input)).not.toThrow();
    }
  });
});
