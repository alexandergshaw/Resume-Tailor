// AC-L1: a drafted answer is rendered as a CUE PLUS the sentence behind it,
// never as a cue with its sentence discarded.
//
// The reported failure: a three-point answer to "Could you tell me a bit about
// your experience working with technology platforms within a higher education
// environment?" rendered as "Product Curriculum Lead / Tech covered: SQL, APIs
// / Familiar with platforms". Those are the cues. The sentences they head were
// drafted, cached, and derived into `answer` — and then never shown to anyone.
//
// These tests assert the pairing CONTRACT (C1) rather than any markup: the
// repo's vitest config runs `environment: "node"`, so no component can be
// rendered here. The render sites consume this and are checked by hand.

import { describe, it, expect } from "vitest";
import { answerLines } from "./answerPoints.js";

const POINTS = [
  "I spent three years as a Product Curriculum Lead building learning tools used across a university system.",
  "I worked hands-on with SQL and REST APIs to integrate our platform with the student information system.",
  "That made me comfortable moving between faculty stakeholders and engineering teams.",
];
const CUES = ["Product curriculum lead", "SQL and REST APIs", "Faculty and engineering"];

describe("answerLines", () => {
  it("keeps the sentence behind every cue", () => {
    const lines = answerLines(CUES, POINTS);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.cue)).toEqual(CUES);
    expect(lines.map((l) => l.point)).toEqual(POINTS);
  });

  it("falls back to the sentence alone when a draft carries no cues", () => {
    const lines = answerLines([], POINTS);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.cue === "")).toBe(true);
    expect(lines.map((l) => l.point)).toEqual(POINTS);
  });

  it("drops every cue when there is not exactly one per point", () => {
    const lines = answerLines(["Only one cue"], POINTS);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.cue === "")).toBe(true);
  });

  it("carries a STAR label once, on `label`, stripped off both the cue and the point", () => {
    const lines = answerLines(
      ["Situation: New CRM rollout", "Result: Twelve campuses live"],
      [
        "Situation: We were rolling out a new CRM across twelve campuses in one academic year.",
        "Result: Every campus was live before the fall term, with no missed enrolment deadline.",
      ],
    );
    expect(lines[0].label).toBe("Situation");
    expect(lines[0].cue).toBe("New CRM rollout");
    expect(lines[0].point).toBe(
      "We were rolling out a new CRM across twelve campuses in one academic year.",
    );
    expect(lines[1].label).toBe("Result");
    expect(lines[1].cue).toBe("Twelve campuses live");
  });

  it("reports no label for a point that has none", () => {
    expect(answerLines(CUES, POINTS).every((l) => l.label === "")).toBe(true);
  });

  it("drops a cue that is not shorter than the sentence it heads", () => {
    // A model that hands back the sentence itself as its own cue: rendering
    // "X — X" is worse than rendering X once.
    const same = "I led the platform migration end to end.";
    expect(answerLines([same], [same])[0].cue).toBe("");
    expect(answerLines([same], [same])[0].point).toBe(same);
    // Same sentence, only punctuation and case differing.
    expect(answerLines(["i led the platform migration end to end"], [same])[0].cue).toBe("");
  });

  it("never returns an entry without a point, and drops blank points", () => {
    const lines = answerLines([], ["First real point.", "   ", "", "Second real point."]);
    expect(lines.map((l) => l.point)).toEqual(["First real point.", "Second real point."]);
    expect(lines.every((l) => typeof l.point === "string" && l.point.trim())).toBe(true);
  });

  it("returns nothing for an empty or malformed draft", () => {
    expect(answerLines([], [])).toEqual([]);
    expect(answerLines(null, null)).toEqual([]);
    expect(answerLines(["a cue"], [])).toEqual([]);
    expect(answerLines(undefined, ["  ", ""])).toEqual([]);
  });
});
