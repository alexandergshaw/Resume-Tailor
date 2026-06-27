import { describe, it, expect } from "vitest";
import { weaveSources, weaveSourcesAnnotated, placementOptions, PLACEMENTS } from "./coverLetterWeave.js";

const LINES = [
  "Dear Hiring Committee,",
  "I'm excited to apply for the Course Assistant position at University of Michigan. As a Senior Software Engineer, I bring depth.",
  "In my current role at Mutual of Omaha, I lead data platform initiatives.",
  "I also teach. As an adjunct professor, I've taught Web Development.",
  "That mix of industry and classroom is exactly what draws me to University of Michigan. I'd be glad to support students.",
  "I'd welcome the chance to talk. Thank you for your time.",
  "Sincerely,Alex Shaw",
];
const SUGG = "I was inspired to see UMSI's recent CHI awards.";

describe("weaveSources", () => {
  it("intro placement adds a connector after the first sentence (not a bare splice)", () => {
    const out = weaveSources(LINES, [{ target: "intro", suggestion: SUGG }]);
    expect(out[1]).toContain(`University of Michigan. In fact, ${SUGG} As a Senior Software Engineer`);
    expect(out[6]).toBe("Sincerely,Alex Shaw"); // sign-off untouched
  });

  it("places into the paragraph chosen by target, with its connector", () => {
    expect(weaveSources(LINES, [{ target: "why", suggestion: SUGG }])[4]).toContain(`draws me to University of Michigan. Beyond that, ${SUGG} I'd be glad`);
    expect(weaveSources(LINES, [{ target: "current", suggestion: SUGG }])[2]).toContain(`initiatives. Beyond my day-to-day work, ${SUGG}`);
    expect(weaveSources(LINES, [{ target: "teaching", suggestion: SUGG }])[3]).toContain(`Outside the classroom, ${SUGG}`);
  });

  it("moving a source between targets changes which paragraph carries it", () => {
    const intro = weaveSources(LINES, [{ target: "intro", suggestion: SUGG }]);
    const why = weaveSources(LINES, [{ target: "why", suggestion: SUGG }]);
    expect(intro[1]).toContain(SUGG);
    expect(intro[4]).not.toContain(SUGG);
    expect(why[4]).toContain(SUGG);
    expect(why[1]).not.toContain(SUGG);
  });

  it("falls back to the intro when the target paragraph isn't found", () => {
    const noWhy = LINES.slice(0, 4); // drop the why/close/signoff paragraphs
    const out = weaveSources(noWhy, [{ target: "why", suggestion: SUGG }]);
    expect(out[1]).toContain(SUGG); // landed in the intro instead
  });

  it("groups multiple sources for the same target", () => {
    const out = weaveSources(LINES, [
      { target: "intro", suggestion: "First note." },
      { target: "intro", suggestion: "Second note." },
    ]);
    expect(out[1]).toContain("In fact, First note. Second note.");
  });

  it("is a no-op with no placements or no lines", () => {
    expect(weaveSources(LINES, [])).toEqual(LINES);
    expect(weaveSources([], [{ target: "intro", suggestion: SUGG }])).toEqual([]);
  });
});

describe("weaveSourcesAnnotated", () => {
  const join = (paras) => paras.map((segs) => segs.map((s) => s.text).join("")).join("\n\n");
  const inserted = (paras) =>
    paras.flatMap((segs) => segs.filter((s) => s.insert).map((s) => s.text));

  it("joined text matches weaveSources verbatim", () => {
    const placements = [{ target: "intro", suggestion: SUGG }];
    expect(join(weaveSourcesAnnotated(LINES, placements))).toBe(weaveSources(LINES, placements).join("\n\n"));
  });

  it("flags the lead-in + suggestion as the only inserted segment", () => {
    const paras = weaveSourcesAnnotated(LINES, [{ target: "intro", suggestion: SUGG }]);
    expect(inserted(paras)).toEqual([`In fact, ${SUGG}`]);
    // the inserted chunk lives on the intro paragraph, surrounded by original text
    expect(paras[1].some((s) => s.insert)).toBe(true);
    expect(paras[1][0].insert).toBe(false);
  });

  it("marks each target's reference when several are woven in", () => {
    const paras = weaveSourcesAnnotated(LINES, [
      { target: "intro", suggestion: "First note." },
      { target: "why", suggestion: "Second note." },
    ]);
    expect(inserted(paras)).toEqual(["In fact, First note.", "Beyond that, Second note."]);
  });

  it("returns plain single segments when nothing is woven in", () => {
    expect(weaveSourcesAnnotated(LINES, [])).toEqual(LINES.map((l) => [{ text: l, insert: false }]));
  });
});

describe("placementOptions", () => {
  it("exposes id + label for every placement", () => {
    expect(placementOptions()).toHaveLength(PLACEMENTS.length);
    expect(placementOptions()[0]).toEqual({ id: "intro", label: "Opening paragraph" });
  });
});
