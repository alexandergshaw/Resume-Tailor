// The ask box's source line, in the one case N148 made newly reachable.
//
// The ask box used to refuse before any model call when it had nothing to
// ground in, so "Answered from: nothing was available." could never sit under a
// real answer. It now answers general questions from general knowledge even
// then (Gemini engine), so that caption would be false under an answer that was
// in fact produced. The empty case reads as general knowledge instead; every
// other case is asserted unchanged so the edit stayed in the one arm.
import { describe, it, expect } from "vitest";
import { askSourceLine, buildAskBlocks } from "./askContext.js";

const GENERAL_KNOWLEDGE_LINE =
  "Answered from general knowledge -- this application had no material to draw on.";

describe("askSourceLine when there was no application material", () => {
  it("says the answer came from general knowledge, not that nothing was available", () => {
    const line = askSourceLine(
      { tracking: false, resume: false, coverLetter: false, pagesInScope: 0, pagesIncluded: 0 },
      { truncated: false },
    );
    expect(line).toBe(GENERAL_KNOWLEDGE_LINE);
    expect(line).not.toMatch(/nothing was available/i);
  });

  it("reads the same for sources the route derived from a genuinely empty context", () => {
    const { sources, empty } = buildAskBlocks({});
    expect(empty).toBe(true);
    expect(askSourceLine(sources, { truncated: false })).toBe(GENERAL_KNOWLEDGE_LINE);
  });

  it("keeps the experience-pages note beside it when pages existed but none fit", () => {
    const line = askSourceLine(
      { tracking: false, resume: false, coverLetter: false, pagesInScope: 3, pagesIncluded: 0 },
      { truncated: false },
    );
    expect(line.startsWith(GENERAL_KNOWLEDGE_LINE)).toBe(true);
    expect(line).toContain("None of your experience pages could be included for this question.");
  });
});

describe("askSourceLine is unchanged whenever material was present", () => {
  it("lists exactly the sources that were present", () => {
    expect(
      askSourceLine(
        { tracking: true, resume: true, coverLetter: false, pagesInScope: 0, pagesIncluded: 0 },
        { truncated: false },
      ),
    ).toBe("Answered from: this application's tracking row, your submitted resume.");
  });

  it("still reports the knowledge-base truncation count", () => {
    const line = askSourceLine(
      { tracking: false, resume: true, coverLetter: false, pagesInScope: 12, pagesIncluded: 4 },
      { truncated: true },
    );
    expect(line).toContain("Answered from: your submitted resume, 4 of your 12 experience pages.");
    expect(line).toContain("4 of your 12 pages were used");
    expect(line).not.toMatch(/general knowledge/i);
  });
});
