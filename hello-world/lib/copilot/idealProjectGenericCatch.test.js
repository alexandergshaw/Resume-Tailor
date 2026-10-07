// N125 §6 (L9), the taxonomy-FAILURE half of "always an example". The owner
// requirement is that a selected (non-empty) posting ALWAYS yields an example.
// idealProject.js has TWO null exits that violate that: the no-shape-term
// return (covered by idealProject.test.js's inverted ":167" case) and the
// `catch` around extractKeywords (idealProject.js:231-235). The design flagged
// the catch as a change with NO landed test — so this file adds it.
//
// Lives in its own file because the only way to drive the catch is to make
// extractKeywords THROW, and a module-level vi.mock of the taxonomy would
// poison every other idealProject case if it sat in idealProject.test.js.
//
// RED on HEAD: the catch currently returns null, so `not.toBeNull` fails until
// genericIdealProject is routed through it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/engines/tailor-lite/keywords", () => ({
  extractKeywords: vi.fn(() => {
    throw new Error("taxonomy exploded");
  }),
}));

import { idealProject } from "./idealProject.js";
import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";

// A posting whose vocabulary a real taxonomy WOULD recognize — so the only
// reason there is no shape here is the throw, not an unrecognizable posting.
const POSTING = "Senior Product Manager. We run Agile ceremonies in Education technology.";

describe("idealProject — a taxonomy failure still yields an example (N125 §6 catch branch, L9)", () => {
  beforeEach(() => {
    // `vi.restoreAllMocks()` does not clear a vi.fn() created in a vi.mock
    // factory, and this repo sets neither clearMocks nor restoreMocks — clear
    // the call history between cases so the not.toHaveBeenCalled control below
    // is honest.
    extractKeywords.mockClear();
  });

  it("returns a generic example, not null, when extractKeywords throws", () => {
    const result = idealProject(POSTING);
    // Positive control: the mock actually fired on this path. Without it the
    // not.toBeNull assertion could be satisfied by a build that never reached
    // the catch at all.
    expect(extractKeywords).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result.shape).toBe("");
    expect(result.project.sections).toHaveLength(4);
    expect(result.project.outcomes).toHaveLength(3);
    expect(JSON.stringify(result.project)).not.toMatch(/\{D1\}|\{D2\}|\{M\}|undefined/);
  });

  it("still returns null for an empty posting — the empty guard runs BEFORE the taxonomy call", () => {
    // The over-fire control: "always an example" must not become "an example
    // even with no posting selected". The empty/blank guard (idealProject.js
    // :225-226) returns null before extractKeywords is ever reached, so the
    // throw is never hit and no generic example is manufactured from nothing.
    expect(idealProject("")).toBeNull();
    expect(idealProject("   ")).toBeNull();
    expect(extractKeywords).not.toHaveBeenCalled();
  });
});
