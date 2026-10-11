// N157 SC-C: fillStudyCopy, the one template filler every study-plan surface
// uses. The property that matters is that DATA never acts as a replacement
// pattern: a company name or an error message holding "$&" must come out literal.

import { describe, it, expect } from "vitest";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { fillStudyCopy } from "@/lib/studyPlan/studyPlanNotices.js";

describe("fillStudyCopy", () => {
  it("fills every named slot in a pinned template, including a slot used twice", () => {
    expect(fillStudyCopy(STUDY_COPY.picker.intro, { title: "Staff Engineer", company: "Acme" })).toContain(
      "Build a study plan for Staff Engineer at Acme:",
    );
    expect(fillStudyCopy("<a> and <a>", { a: "x" })).toBe("x and x");
  });

  it("treats `$&`, `$1` and `$$` in the data as literal text (a replacer function, not a replacement string)", () => {
    const company = "Acme $& Co $1 $$";
    expect(fillStudyCopy("Researching <company>.", { company })).toBe(`Researching ${company}.`);
  });

  it("stringifies numbers and leaves an unknown slot untouched", () => {
    expect(fillStudyCopy(STUDY_COPY.card.progress, { done: 12, total: 40 })).toBe("12 of 40 done");
    expect(fillStudyCopy("<missing> here", { other: "x" })).toBe("<missing> here");
  });
});
