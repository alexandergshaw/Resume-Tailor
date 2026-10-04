// N105 Step 3c - AC-8 / AC-9: the model's reading of the posting is grounded to
// the posting. A planted requirement or keyword that the posting does not contain
// must not reach the response; a real one (paraphrased or literal) must survive,
// so the filter cannot degrade into dropping everything.
import { describe, it, expect } from "vitest";
import { groundToPosting } from "./postingGrounding.js";

const POSTING = [
  "Senior Payments Engineer",
  "- 5+ years of experience building payment systems",
  "- Strong knowledge of PostgreSQL and AWS",
  "- Experience with Go and CI/CD pipelines",
  "Nice to have: familiarity with Kubernetes.",
].join("\n");

const analysis = {
  requirements: [
    { id: "q1", text: "5+ years experience building payment systems", kind: "requirement" },
    { id: "q2", text: "Knowledge of PostgreSQL and AWS", kind: "requirement" },
    { id: "q3", text: "Must hold a security clearance of 12 years", kind: "requirement" },
  ],
};
const keywordMap = {
  entries: [
    { keyword: "PostgreSQL", section: "skills", priority: 1, requirementId: "q2" },
    { keyword: "Go", section: "skills", priority: 2, requirementId: null },
    { keyword: "CI/CD", section: "skills", priority: 3, requirementId: null },
    { keyword: "Rust", section: "skills", priority: 4, requirementId: "q3" },
    { keyword: "Kubernetes", section: "summary", priority: 5, requirementId: null },
  ],
};

describe("groundToPosting", () => {
  it("removes a planted requirement that is not in the posting and keeps the real ones in order", () => {
    const out = groundToPosting({ postingAnalysis: analysis, keywordMap }, POSTING);
    expect(out.checked).toBe(true);
    expect(out.postingAnalysis.requirements.map((r) => r.id)).toEqual(["q1", "q2"]);
  });

  it("removes a planted keyword, keeps the real ones (including short ones) in priority order", () => {
    const out = groundToPosting({ postingAnalysis: analysis, keywordMap }, POSTING);
    expect(out.keywordMap.entries.map((e) => e.keyword)).toEqual(["PostgreSQL", "Go", "CI/CD", "Kubernetes"]);
  });

  it("nulls a kept keyword's requirementId when its requirement was removed", () => {
    const withLink = {
      entries: [{ keyword: "AWS", section: "skills", priority: 1, requirementId: "q3" }],
    };
    const out = groundToPosting({ postingAnalysis: analysis, keywordMap: withLink }, POSTING);
    expect(out.keywordMap.entries).toEqual([{ keyword: "AWS", section: "skills", priority: 1, requirementId: null }]);
  });

  it("does not ground an item to words scattered over DIFFERENT posting lines", () => {
    const scattered = {
      requirements: [{ id: "q1", text: "Kubernetes experience with PostgreSQL" }],
    };
    const out = groundToPosting({ postingAnalysis: scattered, keywordMap: { entries: [] } }, POSTING);
    expect(out.postingAnalysis.requirements).toEqual([]);
  });

  it("passes everything through, unchecked, when there is no posting text to ground to", () => {
    const out = groundToPosting({ postingAnalysis: analysis, keywordMap }, "");
    expect(out.checked).toBe(false);
    expect(out.postingAnalysis.requirements).toHaveLength(3);
    expect(out.keywordMap.entries).toHaveLength(5);
  });

  it("tolerates a missing analysis", () => {
    const out = groundToPosting({}, POSTING);
    expect(out.postingAnalysis.requirements).toEqual([]);
    expect(out.keywordMap.entries).toEqual([]);
  });
});
