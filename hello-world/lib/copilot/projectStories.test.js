import { describe, it, expect } from "vitest";
import { isEligiblePage, selectBestStory, starPointsFromStory, significantTerms, overlapScore } from "./projectStories.js";

// The user's own project pages, offered to the copilot as material for
// "tell me about a time..." answers. buildProjectStoriesBlock used to be
// tested here; that function moved to lib/experience/knowledgeBase.js's
// buildKnowledgeBaseBlock (ARCH §5/§7.9) and is covered by
// knowledgeBase.test.js instead. What stays behind — page eligibility and
// the embedded engine's own story picker — is what this file exists to
// cover now.
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

describe("isEligiblePage", () => {
  it("accepts an ordinary page", () => {
    expect(isEligiblePage(page())).toBe(true);
  });

  it("rejects any generated_kind, and archived pages", () => {
    expect(isEligiblePage(page({ generated_kind: "research" }))).toBe(false);
    expect(isEligiblePage(page({ generated_kind: "summary" }))).toBe(false);
    expect(isEligiblePage(page({ archived_at: "2026-08-01T00:00:00.000Z" }))).toBe(false);
  });

  it("never throws on junk input", () => {
    for (const input of [null, undefined, "x", 1, []]) {
      expect(() => isEligiblePage(input)).not.toThrow();
    }
    expect(isEligiblePage(null)).toBe(false);
  });
});

describe("significantTerms / overlapScore", () => {
  it("tokenises words of 4+ alphanumeric characters, lowercased", () => {
    expect(significantTerms("Led the Settlement Rewrite")).toEqual(new Set(["settlement", "rewrite"]));
  });

  it("scores overlap between two term sets/text", () => {
    const q = significantTerms("settlement rewrite");
    expect(overlapScore(q, "Led the settlement rewrite end to end")).toBe(2);
    expect(overlapScore(q, "unrelated text entirely")).toBe(0);
  });
});

describe("selectBestStory", () => {
  it("returns null when there is no eligible page", () => {
    expect(selectBestStory([])).toBeNull();
    expect(selectBestStory([page({ generated_kind: "research" })])).toBeNull();
  });

  it("picks the page that overlaps the question, honestly reporting matched:true", () => {
    const decoy = page({ id: "d1", title: "Beekeeping notes", body: "Rotated the hive frames." });
    const target = page({ id: "t1", title: "Ledger sharding", body: "Sharded the ledger by tenant." });
    const story = selectBestStory([decoy, target], { question: "Tell me about sharding a ledger." });
    expect(story.pageId).toBe("t1");
    expect(story.matched).toBe(true);
  });

  it("falls back to the first eligible page, honestly reporting matched:false, when nothing overlaps", () => {
    const story = selectBestStory([page({ id: "t1" })], { question: "completely unrelated topic" });
    expect(story.pageId).toBe("t1");
    expect(story.matched).toBe(false);
  });

  it("ranks a page's own bullets by overlap with the question, not document order", () => {
    const withBullets = page({
      body: "- Kicked off in Q1 with a kickoff meeting\n- Cut settlement time from three days to one",
    });
    const story = selectBestStory([withBullets], { question: "How did you cut settlement time?" });
    expect(story.bullets[0]).toBe("Cut settlement time from three days to one");
  });

  it("reports pageId as null when the winning page has no usable id", () => {
    const story = selectBestStory([page({ id: "" })]);
    expect(story.pageId).toBeNull();
  });
});

describe("starPointsFromStory", () => {
  it("builds Situation/Action/Result from the story's own title and bullets, verbatim", () => {
    const story = { title: "Payments migration", bullets: ["Cut settlement time from three days to one", "Mentored two junior engineers"] };
    const points = starPointsFromStory(story);
    expect(points).toEqual([
      "Situation: Payments migration.",
      "Action: Cut settlement time from three days to one.",
      "Result: Mentored two junior engineers.",
    ]);
  });

  it("returns null for a title with no bullets — a title alone is not a story", () => {
    expect(starPointsFromStory({ title: "No bullets here", bullets: [] })).toBeNull();
  });

  it("returns null for null input", () => {
    expect(starPointsFromStory(null)).toBeNull();
  });
});
