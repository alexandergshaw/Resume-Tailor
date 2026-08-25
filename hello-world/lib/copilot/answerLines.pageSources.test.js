// answerLines' THIRD positional array: which knowledge-base page each
// rendered line came from. Written from the acceptance criteria before the
// argument existed.
//
// In its own file, alongside answerLines.test.js, for the same reason that
// file exists separately from answerPoints.test.js: this is one property of
// the function, and keeping it here means the pairing rule for page sources
// can be read (and sabotage-checked) without wading through the cue rules it
// deliberately mirrors.
//
// The rule it mirrors: cues already pair with points positionally and are
// trusted ONLY when the arrays are the same length, because a cue against
// the wrong beat sends a candidate down the wrong line of their own answer.
// A page citation against the wrong beat is worse — it attributes a claim to
// a project that did not produce it, and the candidate says so out loud.

import { describe, it, expect } from "vitest";
import { answerLines } from "./answerPoints.js";

const P1 = { id: "p1", title: "Payments migration" };
const P2 = { id: "p2", title: "Search reindex" };

describe("answerLines — page sources", () => {
  it("attaches each page source to the line at the same index", () => {
    const lines = answerLines(
      ["The migration", "The reindex"],
      ["We moved settlement onto Kafka.", "We rebuilt the search index."],
      [P1, P2],
    );
    expect(lines.map((l) => l.pageSource)).toEqual([P1, P2]);
    // Positive control: the existing cue/point pairing is untouched by the
    // new argument. A change that quietly broke it would still satisfy the
    // assertion above.
    expect(lines.map((l) => l.point)).toEqual([
      "We moved settlement onto Kafka.",
      "We rebuilt the search index.",
    ]);
    expect(lines.map((l) => l.cue)).toEqual(["The migration", "The reindex"]);
  });

  it("carries a null for a line that came from no page", () => {
    const lines = answerLines(
      ["", "", ""],
      ["I'll start with context.", "We moved settlement onto Kafka.", "That is the shape of it."],
      [null, P1, null],
    );
    expect(lines.map((l) => l.pageSource)).toEqual([null, P1, null]);
  });

  it("drops EVERY page source when the count does not match the cleaned points", () => {
    const lines = answerLines(
      ["a", "b"],
      ["First sentence here.", "Second sentence here."],
      [P1],
    );
    expect(lines.map((l) => l.pageSource)).toEqual([null, null]);
  });

  it("pairs against the index BEFORE empty points are dropped, never after", () => {
    // The load-bearing ordering the existing comment in answerPoints.js
    // already describes for cues, now covering a second positional array.
    // "Task:" is a label with no sentence behind it, so it is dropped AFTER
    // the map. If pairing used a post-filter index, P2 would land on the
    // line that P1 belongs to.
    const lines = answerLines(
      ["", "", ""],
      ["Situation: We were losing settlements.", "Task:", "Result: We cut latency to four hours."],
      [P1, null, P2],
    );
    expect(lines).toHaveLength(2);
    // `label` carries the STAR word WITHOUT its colon — STAR_LABEL_RE's
    // capture group is `(Situation|Task|Action|Result)` and the colon sits
    // outside it. Pinned by answerLines.test.js:53.
    expect(lines.map((l) => l.label)).toEqual(["Situation", "Result"]);
    expect(lines.map((l) => l.pageSource)).toEqual([P1, P2]);
  });

  it("leaves every existing two-argument caller behaving exactly as before", () => {
    const lines = answerLines(["The migration"], ["We moved settlement onto Kafka."]);
    expect(lines.map((l) => l.pageSource)).toEqual([null]);
    expect(lines[0].cue).toBe("The migration");
    expect(lines[0].point).toBe("We moved settlement onto Kafka.");
  });

  it("never throws on junk", () => {
    expect(() => answerLines([], ["A real point."], null)).not.toThrow();
    expect(() => answerLines([], ["A real point."], "p1")).not.toThrow();
    expect(answerLines([], ["A real point."], [7])[0].pageSource).toBe(null);
  });
});
