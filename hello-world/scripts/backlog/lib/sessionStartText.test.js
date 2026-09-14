import { describe, it, expect } from "vitest";
import { formatDecision } from "./sessionStartText.mjs";

describe("formatDecision", () => {
  it("formats an actionable decision with the exact expected string — kills a truncation/mis-template mutant", () => {
    const text = formatDecision({
      type: "actionable",
      item: { id: "N1", title: "Fix the thing", owns: ["lib/a.js"], verify: "npx vitest run lib/a.test.js" },
    });
    expect(text).toBe(
      "Step 0: docs/backlog.yml has an actionable item — N1: Fix the thing | owns: lib/a.js | verify: npx vitest run lib/a.test.js. Read docs/BACKLOG.md before anything else."
    );
  });

  it("formats an unscoped decision with the exact count and id list", () => {
    const text = formatDecision({ type: "unscoped", count: 12, ids: ["N1", "N2"] });
    expect(text).toBe(
      "Step 0: docs/backlog.yml has 12 actionable item(s) with no owns/verify yet (N1, N2) — scoping one of them is the next action. Read docs/BACKLOG.md before anything else."
    );
  });

  it("formats an escalate decision", () => {
    const text = formatDecision({ type: "escalate", item: { id: "D1", state: "owner", title: "Decide X" } });
    expect(text).toBe("Step 0: no actionable work is pickable. Escalate D1 (owner) to the owner: Decide X. Read docs/BACKLOG.md before anything else.");
  });

  it("formats an empty decision as an accurate 'nothing owed' statement, not silence", () => {
    expect(formatDecision({ type: "empty" })).toBe("Step 0: docs/backlog.yml is empty. Nothing is owed.");
  });

  it("takes only the first line of a multi-line title, never the whole block", () => {
    const text = formatDecision({
      type: "actionable",
      item: { id: "N1", title: "Line one\nLine two", owns: ["a"], verify: "v" },
    });
    expect(text).toContain("Line one");
    expect(text).not.toContain("Line two");
  });

  it("throws on an unknown decision type rather than printing something misleading", () => {
    expect(() => formatDecision({ type: "mystery" })).toThrow(/unknown decision type/);
  });
});
