import { describe, it, expect } from "vitest";
import { alignLinesToSlots } from "./alignLines";

describe("alignLinesToSlots", () => {
  it("identical arrays produce all fills with same indices", () => {
    const templates = ["line1", "line2", "line3"];
    const lines = ["line1", "line2", "line3"];
    const ops = alignLinesToSlots(templates, lines);

    expect(ops).toHaveLength(3);
    expect(ops[0]).toEqual({ type: "fill", slot: 0, text: "line1" });
    expect(ops[1]).toEqual({ type: "fill", slot: 1, text: "line2" });
    expect(ops[2]).toEqual({ type: "fill", slot: 2, text: "line3" });
  });

  it("one line inserted in the middle preserves surrounding lines", () => {
    const templates = ["line1", "line2", "line3"];
    const lines = ["line1", "NEW", "line2", "line3"];
    const ops = alignLinesToSlots(templates, lines);

    // Should have fills for all template slots + one insert
    const fills = ops.filter((op) => op.type === "fill");
    const inserts = ops.filter((op) => op.type === "insert");

    expect(fills).toHaveLength(3);
    expect(inserts).toHaveLength(1);

    // line1 at slot 0, line2 at slot 1, line3 at slot 2
    expect(fills.find((op) => op.text === "line1")).toEqual({
      type: "fill",
      slot: 0,
      text: "line1",
    });
    expect(fills.find((op) => op.text === "line2")).toEqual({
      type: "fill",
      slot: 1,
      text: "line2",
    });
    expect(fills.find((op) => op.text === "line3")).toEqual({
      type: "fill",
      slot: 2,
      text: "line3",
    });

    // NEW insert after slot 0
    expect(inserts[0]).toEqual({ type: "insert", afterSlot: 0, text: "NEW" });
  });

  it("one line deleted results in a remove and fills for remaining", () => {
    const templates = ["line1", "line2", "line3"];
    const lines = ["line1", "line3"];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");
    const removes = ops.filter((op) => op.type === "remove");

    expect(fills).toHaveLength(2);
    expect(removes).toHaveLength(1);

    // line1 at slot 0, line3 at slot 2
    expect(fills.find((op) => op.text === "line1")).toEqual({
      type: "fill",
      slot: 0,
      text: "line1",
    });
    expect(fills.find((op) => op.text === "line3")).toEqual({
      type: "fill",
      slot: 2,
      text: "line3",
    });

    // slot 1 (line2) is removed
    expect(removes[0]).toEqual({ type: "remove", slot: 1 });
  });

  it("one line reworded fills the same slot", () => {
    const templates = ["line1", "line2", "line3"];
    const lines = ["line1", "line2_reworded", "line3"];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");
    const removes = ops.filter((op) => op.type === "remove");
    const inserts = ops.filter((op) => op.type === "insert");

    // All slots filled, nothing removed, no inserts (reworded line pairs positionally with its slot)
    expect(fills).toHaveLength(3);
    expect(removes).toHaveLength(0);
    expect(inserts).toHaveLength(0);

    // line1, line3 match (anchors); line2_reworded fills slot 1 positionally
    expect(fills.find((op) => op.slot === 0)).toEqual({
      type: "fill",
      slot: 0,
      text: "line1",
    });
    expect(fills.find((op) => op.slot === 1)).toEqual({
      type: "fill",
      slot: 1,
      text: "line2_reworded",
    });
    expect(fills.find((op) => op.slot === 2)).toEqual({
      type: "fill",
      slot: 2,
      text: "line3",
    });
  });

  it("reword + insert + delete combined keeps anchored lines at their slots", () => {
    const templates = ["intro", "skill1", "skill2", "skill3", "outro"];
    const lines = ["intro", "skill1_new", "skill2", "new_skill", "outro"];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");

    // intro at slot 0, skill2 at slot 2, outro at slot 4 should all fill their original slots
    expect(fills.find((op) => op.text === "intro")).toEqual({
      type: "fill",
      slot: 0,
      text: "intro",
    });
    expect(fills.find((op) => op.text === "skill2")).toEqual({
      type: "fill",
      slot: 2,
      text: "skill2",
    });
    expect(fills.find((op) => op.text === "outro")).toEqual({
      type: "fill",
      slot: 4,
      text: "outro",
    });
  });

  it("completely different arrays degrade to positional pairing", () => {
    const templates = ["old1", "old2", "old3"];
    const lines = ["new1", "new2", "new3", "new4"];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");
    const inserts = ops.filter((op) => op.type === "insert");
    const removes = ops.filter((op) => op.type === "remove");

    // 3 fills (positional pairing min(3,4))
    expect(fills).toHaveLength(3);
    // 1 extra line becomes insert
    expect(inserts).toHaveLength(1);
    // No removes
    expect(removes).toHaveLength(0);

    expect(fills[0]).toEqual({ type: "fill", slot: 0, text: "new1" });
    expect(fills[1]).toEqual({ type: "fill", slot: 1, text: "new2" });
    expect(fills[2]).toEqual({ type: "fill", slot: 2, text: "new3" });
    expect(inserts[0]).toEqual({ type: "insert", afterSlot: 2, text: "new4" });
  });

  it("more lines than slots with all slots matching appends as inserts", () => {
    const templates = ["line1", "line2"];
    const lines = ["line1", "line2", "extra1", "extra2"];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");
    const inserts = ops.filter((op) => op.type === "insert");

    expect(fills).toHaveLength(2);
    expect(inserts).toHaveLength(2);

    expect(fills[0]).toEqual({ type: "fill", slot: 0, text: "line1" });
    expect(fills[1]).toEqual({ type: "fill", slot: 1, text: "line2" });

    expect(inserts[0]).toEqual({
      type: "insert",
      afterSlot: 1,
      text: "extra1",
    });
    expect(inserts[1]).toEqual({
      type: "insert",
      afterSlot: 1,
      text: "extra2",
    });
  });

  it("empty strings in lines are skipped", () => {
    const templates = ["line1", "line2", "line3"];
    const lines = ["line1", "", "line2", "line3"];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");
    const inserts = ops.filter((op) => op.type === "insert");

    // Empty string should not be filled or inserted
    expect(fills).toHaveLength(3);
    expect(inserts).toHaveLength(0);

    expect(fills[0]).toEqual({ type: "fill", slot: 0, text: "line1" });
    expect(fills[1]).toEqual({ type: "fill", slot: 1, text: "line2" });
    expect(fills[2]).toEqual({ type: "fill", slot: 2, text: "line3" });
  });

  it("blanking a line's content removes its slot", () => {
    const templates = ["Heading", "Old bullet text", "Footer"];
    const lines = ["Heading", "", "Footer"];
    const ops = alignLinesToSlots(templates, lines);

    // The blanked line consumed slot 1, so its paragraph must be removed —
    // otherwise "Old bullet text" would survive into the rebuilt document.
    expect(ops).toContainEqual({ type: "remove", slot: 1 });
    expect(ops.find((op) => op.type === "fill" && op.slot === 1)).toBeUndefined();

    // The anchors keep their slots.
    expect(ops).toContainEqual({ type: "fill", slot: 0, text: "Heading" });
    expect(ops).toContainEqual({ type: "fill", slot: 2, text: "Footer" });
  });

  it("whitespace-only lines are treated as empty", () => {
    const templates = ["line1", "line2", "line3"];
    const lines = ["line1", "   ", "line2", "line3"];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");

    // Whitespace-only (normalizes to empty) should be skipped
    expect(fills).toHaveLength(3);
    expect(fills[0]).toEqual({ type: "fill", slot: 0, text: "line1" });
    expect(fills[1]).toEqual({ type: "fill", slot: 1, text: "line2" });
    expect(fills[2]).toEqual({ type: "fill", slot: 2, text: "line3" });
  });

  it("empty templates and lines produce no operations", () => {
    const templates = [];
    const lines = [];
    const ops = alignLinesToSlots(templates, lines);

    expect(ops).toHaveLength(0);
  });

  it("empty templates with lines produce inserts", () => {
    const templates = [];
    const lines = ["line1", "line2"];
    const ops = alignLinesToSlots(templates, lines);

    const inserts = ops.filter((op) => op.type === "insert");

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toEqual({ type: "insert", afterSlot: -1, text: "line1" });
    expect(inserts[1]).toEqual({
      type: "insert",
      afterSlot: -1,
      text: "line2",
    });
  });

  it("empty lines with templates produce removes", () => {
    const templates = ["line1", "line2", "line3"];
    const lines = [];
    const ops = alignLinesToSlots(templates, lines);

    const removes = ops.filter((op) => op.type === "remove");

    expect(removes).toHaveLength(3);
    expect(removes[0]).toEqual({ type: "remove", slot: 0 });
    expect(removes[1]).toEqual({ type: "remove", slot: 1 });
    expect(removes[2]).toEqual({ type: "remove", slot: 2 });
  });

  it("preserves intentional spacing in text", () => {
    const templates = ["line1", "line2"];
    const lines = ["  spaced start", "end spaced  "];
    const ops = alignLinesToSlots(templates, lines);

    const fills = ops.filter((op) => op.type === "fill");

    // Intentional spacing is preserved in the returned text
    expect(fills[0]).toEqual({ type: "fill", slot: 0, text: "  spaced start" });
    expect(fills[1]).toEqual({ type: "fill", slot: 1, text: "end spaced  " });
  });

  it("complex multi-section document with structural anchors", () => {
    const templates = [
      "EXPERIENCE",
      "Job 1 title",
      "Job 1 description",
      "SKILLS",
      "Skill 1",
      "Skill 2",
      "EDUCATION",
    ];
    const lines = [
      "EXPERIENCE",
      "Job 1 title",
      "Job 1 description (updated)",
      "New bullet under job 1",
      "SKILLS",
      "Skill 1 (updated)",
      "Skill 2",
      "Skill 3",
      "EDUCATION",
    ];

    const ops = alignLinesToSlots(templates, lines);

    // Section headers (EXPERIENCE, SKILLS, EDUCATION) should anchor at their original slots
    const fills = ops.filter((op) => op.type === "fill");
    expect(fills.find((op) => op.slot === 0 && op.text === "EXPERIENCE")).toBeTruthy();
    expect(fills.find((op) => op.slot === 3 && op.text === "SKILLS")).toBeTruthy();
    expect(fills.find((op) => op.slot === 6 && op.text === "EDUCATION")).toBeTruthy();
  });
});
