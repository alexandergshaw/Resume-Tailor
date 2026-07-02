import { describe, it, expect } from "vitest";
import { pairEdits, minimalRule, deriveEditRules, sanitizeEditRules } from "./editRules.js";

const GENERATED = [
  "Alex Shaw",
  "Senior Software Engineer",
  "Led a cross-functional team of 5 through Agile delivery.",
  "Built a SQL-backed reporting platform.",
];

describe("pairEdits", () => {
  it("pairs a modified line with its original by similarity", () => {
    const edited = [...GENERATED];
    edited[2] = "Led a cross-functional team of 8 through Agile delivery.";
    const pairs = pairEdits(GENERATED, edited);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].before).toContain("team of 5");
    expect(pairs[0].after).toContain("team of 8");
  });

  it("does not pair unrelated additions/deletions", () => {
    const edited = [...GENERATED.slice(0, 3), "Completely unrelated new accomplishment line here."];
    // "Built a SQL-backed..." was deleted, an unrelated line added — no pair.
    expect(pairEdits(GENERATED, edited)).toHaveLength(0);
  });

  it("pairs multiple modified lines one-to-one", () => {
    const edited = [...GENERATED];
    edited[2] = "Led a cross-functional team of 8 through Agile delivery.";
    edited[3] = "Built a PostgreSQL-backed reporting platform.";
    expect(pairEdits(GENERATED, edited)).toHaveLength(2);
  });
});

describe("minimalRule", () => {
  it("distills a fact change with word context (never a bare number)", () => {
    const rule = minimalRule(
      "Led a cross-functional team of 5 through Agile delivery.",
      "Led a cross-functional team of 8 through Agile delivery.",
    );
    expect(rule.before).toBe("of 5 through");
    expect(rule.after).toBe("of 8 through");
  });

  it("captures formatting changes like casing", () => {
    const rule = minimalRule("Delivered through Agile delivery.", "Delivered through agile delivery.");
    expect(rule.before).toContain("Agile");
    expect(rule.after).toContain("agile");
    expect(rule.before.toLowerCase()).toBe(rule.after.toLowerCase());
  });

  it("supports in-line deletions when the removed text is substantial", () => {
    const rule = minimalRule(
      "Cut costs, delivering a 40% reduction in processing time overall.",
      "Cut costs overall.",
    );
    expect(rule.before.length).toBeGreaterThan(rule.after.length);
    expect(rule.before).toContain("40% reduction");
  });

  it("returns null for identical, empty, or too-short changes", () => {
    expect(minimalRule("same line", "same line")).toBeNull();
    expect(minimalRule("", "anything")).toBeNull();
    // A bare 1-char swap with no context is below the distinctiveness floor.
    expect(minimalRule("b", "x")).toBeNull();
  });

  it("keeps short swaps only when context words make them distinctive", () => {
    // Same 1-char swap, but the context words form an exact 5-char phrase.
    expect(minimalRule("a b c", "a x c")).toEqual({ before: "a b c", after: "a x c" });
  });
});

describe("deriveEditRules", () => {
  it("derives de-duplicated rules from a whole session", () => {
    const edited = [...GENERATED];
    edited[2] = "Led a cross-functional team of 8 through Agile delivery.";
    edited[3] = "Built a PostgreSQL-backed reporting platform.";
    const rules = deriveEditRules(GENERATED, edited);
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.after).join(" ")).toContain("PostgreSQL-backed");
  });

  it("returns nothing when only additions happened", () => {
    expect(deriveEditRules(GENERATED, [...GENERATED, "A brand new line entirely."])).toEqual([]);
  });
});

describe("sanitizeEditRules", () => {
  it("parses JSON, enforces shape and limits, de-dupes by before", () => {
    const raw = JSON.stringify([
      { before: "of 5 through", after: "of 8 through" },
      { before: "of 5 through", after: "conflicting duplicate" }, // dropped
      { before: "ok", after: "too short before" }, // dropped (< 4 chars)
      { before: "same", after: "same" }, // dropped (no-op)
      { before: "x".repeat(200), after: "y" }, // dropped (too long)
      "garbage",
    ]);
    const out = sanitizeEditRules(raw);
    expect(out).toEqual([{ before: "of 5 through", after: "of 8 through" }]);
    expect(sanitizeEditRules("not json")).toEqual([]);
    expect(sanitizeEditRules(null)).toEqual([]);
  });

  it("caps the rule count", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ before: `before ${i}`, after: `after ${i}` }));
    expect(sanitizeEditRules(many).length).toBeLessThanOrEqual(20);
  });
});
