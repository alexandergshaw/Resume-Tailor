import { describe, it, expect } from "vitest";
import { enforceCoverLetterLengths } from "./coverLetterLengths.js";

describe("enforceCoverLetterLengths", () => {
  it("returns a line unchanged if it is within the cap", () => {
    const resultLines = ["Hello world"];
    const templateLines = ["x".repeat(20)]; // 20 chars, line is 11 chars, well under cap
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe("Hello world");
  });

  it("returns empty string for blank template slot", () => {
    const resultLines = ["This is a lot of generated text that would normally be output"];
    const templateLines = [""]; // blank template = blank output
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe("");
  });

  it("cuts at the last sentence boundary within the cap when first sentence fits", () => {
    // Template is 50 chars, so maxLen = Math.max(50 + 5, ceil(50 * 1.15)) = 58
    // Back half threshold = 29 chars
    // First sentence ends at position 45 (> 29, in back half): "This is the first sentence which is long. "
    // Second sentence starts at 46, goes beyond 58
    const templateLen = 50;
    const line = "This is the first sentence which is long. More content that extends well beyond the cap";
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // Should cut at the first sentence boundary at position 41
    expect(result[0]).toBe("This is the first sentence which is long.");
  });

  it("keeps a single long sentence intact when it has no boundary within cap", () => {
    // Template is 20 chars, maxLen = Math.max(25, 24) = 25
    // Single sentence is 50 chars with no period until the end
    const templateLen = 20;
    const line = "This is one very long sentence that goes on and on.";
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // Should return the entire line intact, not truncated
    expect(result[0]).toBe(line);
  });

  it("retains closing quotes after sentence boundary", () => {
    // Template is 60 chars, maxLen = 69
    // Back half = 34.5 chars
    // Line with quote boundary: 'He said "We ship fast." ' is 24 chars (< 34.5, in front half)
    // So this boundary alone won't work; we need a boundary in back half
    // Let's make: 'He said "We ship fast." The company values efficiency. More text.'
    // First boundary at 24 (front half), second at ~60 (back half)
    const templateLen = 60;
    const line = 'He said "We ship fast." The company values efficiency. More content beyond the cap that continues';
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // Should cut at the last boundary in back half: "The company values efficiency."
    expect(result[0]).toBe('He said "We ship fast." The company values efficiency.');
  });

  it("returns line intact when only boundary is in front half of cap", () => {
    // Template is 100 chars, maxLen = 116
    // Front half = 58 chars
    // Line: "Hi. " (4 chars) + very long sentence that exceeds 116
    // The only boundary "Hi. " is at position 4, which is less than 58, so it's in front half
    // Should return the entire line
    const templateLen = 100;
    const line = "Hi. " + "x".repeat(120); // Total 124 chars, exceeds 116
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe(line);
  });

  it("handles mixed array with multiple lines each respecting their own template length", () => {
    const resultLines = [
      "Short.", // within cap
      'He said "Great work." The result exceeded my expectations. More content after', // has boundary in back half
      "This is one very long sentence that has no period until far later in the text", // no boundary in cap
    ];
    const templateLines = [
      "x".repeat(20), // maxLen = 24, "Short." is 6 chars
      "x".repeat(50), // maxLen = 58, boundaries at 20 (front) and 57 (back half of 58 = 29+)
      "x".repeat(40), // maxLen = 46, no boundary in cap
    ];
    const result = enforceCoverLetterLengths(resultLines, templateLines);

    // First line: well within cap
    expect(result[0]).toBe("Short.");

    // Second line: should cut at the second boundary (back half)
    expect(result[1]).toBe('He said "Great work." The result exceeded my expectations.');

    // Third line: should return intact since no usable boundary
    expect(result[2]).toBe(resultLines[2]);
  });

  it("preserves multiple sentences when they fit within the cap", () => {
    const templateLen = 80;
    const line = "I excel at teamwork. I innovate daily. I drive results."; // 55 chars, well under 92
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe(line);
  });

  it("cuts to last sentence when multiple sentences exceed cap", () => {
    const templateLen = 35; // maxLen = 40
    // Back half = 20 chars
    // "First sentence. " = 16 chars (< 20, front half)
    // "First sentence. Second sentence. " = 34 chars (> 20, back half)
    // "First sentence. Second sentence. Third sentence" exceeds 40
    const line = "First sentence. Second sentence. Third sentence is longer.";
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // "First sentence. " at 16 is in front half, skip it
    // "First sentence. Second sentence. " at 34 is >= 20, in back half, and <= 40
    expect(result[0]).toBe("First sentence. Second sentence.");
  });

  it("handles exclamation and question marks as sentence boundaries", () => {
    const templateLen = 60; // maxLen = 69, back half = 34.5
    // "Is this great!" = 14 chars (< 34.5, front half)
    // "Is this great! Yes it is?" = 26 chars (< 34.5, front half)
    // Need a boundary > 34.5 chars
    const line =
      "Is this great! Yes it is? The answer is clear. Additional text that exceeds the cap significantly";
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // "The answer is clear." boundary is at ~47 chars, in back half
    expect(result[0]).toBe("Is this great! Yes it is? The answer is clear.");
  });

  it("handles closing parenthesis after sentence boundary", () => {
    const templateLen = 50; // maxLen = 58, back half = 29
    // "We achieve goals (as proven). " = 30 chars (>= 29, in back half)
    const line = "We achieve goals (as proven). Then more text that goes beyond the limit";
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // "We achieve goals (as proven)." boundary is at 29 chars, which is >= 29 (back half)
    expect(result[0]).toBe("We achieve goals (as proven).");
  });

  it("handles empty result line gracefully", () => {
    const resultLines = [""];
    const templateLines = ["x".repeat(50)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe("");
  });

  it("converts null/undefined to empty string and respects template length", () => {
    const resultLines = [null];
    const templateLines = ["x".repeat(30)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe("");
  });

  it("handles line exactly at cap boundary", () => {
    const templateLen = 30; // maxLen = 35
    const line = "I am exactly thirty chars long!!"; // 32 chars
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // 32 chars <= 35, should return unchanged
    expect(result[0]).toBe(line);
  });

  it("handles realistic cover letter sentence with complex punctuation", () => {
    const templateLen = 60; // maxLen = 69, back half = 34.5
    // First sentence: 'I was excited about the role (Sr. Backend Engineer). ' = 54 chars
    // 54 > 34.5, so it's in back half and <= 69
    const line =
      'I was excited about the role (Sr. Backend Engineer). I have extensive experience. This is extra content that should be cut.';
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    // Should cut at the first sentence
    expect(result[0]).toBe('I was excited about the role (Sr. Backend Engineer).');
  });

  it("maintains exact sentence ending without trailing spaces", () => {
    const templateLen = 40; // maxLen = 46, back half = 23
    // "Excellent work was done." = 24 chars, >= 23
    const line = "Excellent work was done. More content that goes on";
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe("Excellent work was done.");
    // Verify no trailing space
    expect(result[0]).not.toMatch(/ $/);
  });

  it("handles multiple closing quotes and brackets", () => {
    const templateLen = 70; // maxLen = 81, back half = 40.5
    // "She wrote (in her email): \"Indeed, we're excited.\"" = 50 chars, > 40.5
    const line =
      'She wrote (in her email): "Indeed, we\'re excited." This additional text extends beyond the limit';
    const resultLines = [line];
    const templateLines = ["x".repeat(templateLen)];
    const result = enforceCoverLetterLengths(resultLines, templateLines);
    expect(result[0]).toBe('She wrote (in her email): "Indeed, we\'re excited."');
  });
});
