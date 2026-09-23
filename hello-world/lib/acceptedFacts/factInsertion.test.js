// N35 fix round -- verify.r1.md's ruling on m3 (import lib/document/
// coverLetterWeave.js#PLACEMENTS instead of a hand-kept local anchor table)
// and M1 (a fact already present in the target paragraph must not be
// inserted a second time).
//
// Before this fix, `factInsertion.js` hand-copied PLACEMENT_ANCHORS from
// coverLetterWeave.js and dropped its `position` field, so an "intro" or
// "why" fact was always appended at the paragraph's END -- diverging,
// undisclosed, from the sibling research-weave feature, which inserts those
// two placements after the first sentence. `planCoverFacts` also appended
// every supplied fact unconditionally, so accepting the same fact twice
// (a re-click on a dialog that stays open with the same rows checked)
// duplicated it in the letter's text.

import { describe, it, expect } from "vitest";
import { planAcceptForEntry } from "./factInsertion.js";
import { PLACEMENTS } from "@/lib/document/coverLetterWeave.js";

const GREETING = "Dear Hiring Manager,";
const BODY_INTRO =
  "I am writing to apply for the Staff Engineer position at Acme. I have five years of platform experience.";
const WHY = "Acme's engineering culture is exactly what draws me to this role.";
const SIGN_OFF = "Sincerely,";
const LINES = [GREETING, BODY_INTRO, WHY, SIGN_OFF];

const FACT_TEXT = "Acme opened a Dublin telemetry lab in 2026.";

function entryWith(lines) {
  return { status: "done", coverLetterResultLines: [...lines] };
}
function fact(over = {}) {
  return { id: "f1", text: FACT_TEXT, placement: "intro", textOrigin: "template", ...over };
}

describe("planAcceptForEntry reuses the shared PLACEMENTS table (ruling: import, not a hand-kept copy)", () => {
  it("CONTROL: PLACEMENTS really does say after-first-sentence for intro and why", () => {
    expect(PLACEMENTS.find((p) => p.id === "intro").position).toBe("after-first-sentence");
    expect(PLACEMENTS.find((p) => p.id === "why").position).toBe("after-first-sentence");
  });

  it("an 'intro' placement inserts AFTER THE FIRST SENTENCE, not appended at the paragraph's end", () => {
    const plan = planAcceptForEntry(entryWith(LINES), { facts: [fact()] });
    const modified = plan.cover.lines[1];
    expect(modified).toContain(FACT_TEXT);
    // Right after "...at Acme." -- before the paragraph's second sentence,
    // not appended after it (which is what the old local-copy planner did).
    expect(modified.indexOf(FACT_TEXT)).toBeLessThan(modified.indexOf("I have five years"));
  });

  it("a 'why' placement also inserts after the first sentence of its paragraph", () => {
    const plan = planAcceptForEntry(entryWith(LINES), {
      facts: [fact({ id: "f2", placement: "why", text: "Acme's Dublin lab ships accessibility tooling." })],
    });
    const modified = plan.cover.lines[2];
    expect(modified.startsWith("Acme's engineering culture is exactly what draws me to this role.")).toBe(true);
    expect(modified.indexOf("Acme's Dublin lab ships")).toBeLessThan(modified.length);
    expect(modified.trim().endsWith("draws me to this role.")).toBe(false);
  });

  it("a 'current' placement (position: end) is unaffected -- still appended at the paragraph's end", () => {
    const roleLines = [GREETING, "In my current role at Acme, I lead a small team.", SIGN_OFF];
    const plan = planAcceptForEntry(entryWith(roleLines), {
      facts: [fact({ id: "f3", placement: "current", text: "Acme also opened a Berlin office." })],
    });
    expect(plan.cover.lines[1]).toBe("In my current role at Acme, I lead a small team. Acme also opened a Berlin office.");
  });
});

describe("planCoverFacts skips a fact whose text is already in the target paragraph (M1)", () => {
  it("accepting the identical fact twice only inserts it once", () => {
    const entry = entryWith(LINES);
    const firstPlan = planAcceptForEntry(entry, { facts: [fact()] });
    expect(firstPlan.cover.changed).toBe(true);

    const secondEntry = { ...entry, coverLetterResultLines: firstPlan.cover.lines };
    const secondPlan = planAcceptForEntry(secondEntry, { facts: [fact()] });

    expect(secondPlan.cover.changed).toBe(false);
    expect(secondPlan.cover.edits).toHaveLength(0);
    const occurrences = secondPlan.cover.lines.join("\n").split(FACT_TEXT).length - 1;
    expect(occurrences).toBe(1);
    // The no-op invariant other callers rely on: an unchanged plan returns
    // the SAME array reference, not a new array holding equal content.
    expect(secondPlan.cover.lines).toBe(secondEntry.coverLetterResultLines);
  });

  it("CONTROL: a DIFFERENT fact on the same paragraph still inserts normally", () => {
    const entry = entryWith(LINES);
    const firstPlan = planAcceptForEntry(entry, { facts: [fact()] });
    const secondEntry = { ...entry, coverLetterResultLines: firstPlan.cover.lines };
    const secondPlan = planAcceptForEntry(secondEntry, {
      facts: [fact({ id: "f2", text: "Acme also opened a Berlin office in 2026." })],
    });
    expect(secondPlan.cover.changed).toBe(true);
    expect(secondPlan.cover.lines.join("\n")).toContain("Acme also opened a Berlin office in 2026.");
    // The first fact is still there exactly once -- the dedupe did not
    // remove it, only prevented a second insertion of it.
    expect(secondPlan.cover.lines.join("\n").split(FACT_TEXT).length - 1).toBe(1);
  });
});
