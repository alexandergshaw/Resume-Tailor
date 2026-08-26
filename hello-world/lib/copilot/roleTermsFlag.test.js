// Unit coverage for the split of app/api/copilot/answer/route.js's per-engine
// honesty flag into this module. The route's own test files
// (route.roleTermsUnbacked.test.js in particular) already cover this
// end-to-end through the real HTTP surface; what belongs HERE, at the unit
// level, is the one property that split exists to make structural: the two
// exports must judge the two engines' drafts against two DIFFERENT page
// texts, because handing the embedded engine's draft `kb.block` — the
// Gemini-only, budget-truncated prompt input — would report the candidate's
// own verbatim page text as an unbacked claim.
import { describe, it, expect } from "vitest";
import { geminiRoleTermsFlag, embeddedRoleTermsFlag } from "./roleTermsFlag.js";

const PROFILE = "Senior Engineer with no mention of the system in question.";

describe("geminiRoleTermsFlag / embeddedRoleTermsFlag", () => {
  it("emits nothing when the question named no role term", () => {
    expect(
      geminiRoleTermsFlag({ terms: [], points: ["Anything."], profile: PROFILE, resume: "", coverLetter: "", pagesBlock: "" }),
    ).toEqual({});
    expect(
      embeddedRoleTermsFlag({ terms: [], points: ["Anything."], profile: PROFILE, resume: "", coverLetter: "", story: null }),
    ).toEqual({});
  });

  it("reports both roleTermsUnbacked and roleTermsClaimed when a term is used but not backed", () => {
    const result = geminiRoleTermsFlag({
      terms: ["Workday"],
      points: ["Action: I built the Workday report."],
      profile: PROFILE,
      resume: "",
      coverLetter: "",
      pagesBlock: "",
    });
    expect(result.roleTermsUnbacked).toEqual(["Workday"]);
    // Index 0: the one and only point above is the claiming one.
    expect(result.roleTermsClaimed).toEqual([0]);
  });

  // THE ASYMMETRY CASE. Identical terms/points/profile — the only thing that
  // differs is which page text each engine's export judges the draft
  // against. `story` carries the term (the embedded engine's own selection,
  // across every page); `pagesBlock` does not (standing in for a Gemini
  // prompt that never included the page this draft actually quoted). An
  // implementation that let `kb.block` reach the embedded export — or that
  // collapsed both engines onto one shared `pageText` parameter, the defect
  // this module's two-export shape exists to make impossible — would report
  // the candidate's own verbatim text as unbacked here.
  it("the embedded export reads story, the gemini export reads pagesBlock — never the other's material", () => {
    const story = { title: "Workday headcount reporting", bullets: ["Built a custom Workday report."] };
    const points = ["Action: I built a custom Workday report."];

    const embedded = embeddedRoleTermsFlag({
      terms: ["Workday"],
      points,
      profile: PROFILE,
      resume: "",
      coverLetter: "",
      story,
    });
    expect(embedded.roleTermsUnbacked).toEqual([]);

    const gemini = geminiRoleTermsFlag({
      terms: ["Workday"],
      points,
      profile: PROFILE,
      resume: "",
      coverLetter: "",
      pagesBlock: "",
    });
    expect(gemini.roleTermsUnbacked).toEqual(["Workday"]);
  });
});
