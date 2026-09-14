import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pick } from "./pick.mjs";
import { parseBacklogYaml } from "./yamlLite.mjs";
import { BACKLOG_YML_PATH } from "./loadBacklog.mjs";

function item(overrides) {
  return {
    id: "N1",
    state: "actionable",
    title: "t",
    owed_by: "o",
    evidence: ["e"],
    blocked_reason: null,
    instrument: null,
    owns: null,
    verify: null,
    verify_proof: null,
    blocked_by: [],
    ...overrides,
  };
}

describe("pick", () => {
  it("no-op control: a single fully-scoped, unblocked actionable item is always picked", () => {
    const items = [item({ id: "N1", owns: ["lib/a.js"], verify: "npx vitest run lib/a.test.js" })];
    const decision = pick(items);
    expect(decision).toEqual({ type: "actionable", item: items[0] });
  });

  it("picks the lowest id among several scoped, unblocked items, numerically not lexically", () => {
    const items = [
      item({ id: "N10", owns: ["lib/a.js"], verify: "v" }),
      item({ id: "N2", owns: ["lib/b.js"], verify: "v" }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("actionable");
    expect(decision.item.id).toBe("N2");
  });

  it("skips a blocked item (blocker id present in items) in favor of the next eligible one", () => {
    const items = [
      item({ id: "N1", owns: ["a"], verify: "v", blocked_by: ["N0"] }),
      item({ id: "N0", owns: ["b"], verify: "v" }),
      item({ id: "N2", owns: ["c"], verify: "v" }),
    ];
    const decision = pick(items);
    // N0 (lowest id, unblocked) is picked; N1 stays blocked behind it.
    expect(decision.type).toBe("actionable");
    expect(decision.item.id).toBe("N0");
  });

  it("a dangling blocked_by (id that exists nowhere) permanently excludes the item, never crashes", () => {
    const items = [item({ id: "N1", owns: ["a"], verify: "v", blocked_by: ["ZZZ-nonexistent"] })];
    expect(() => pick(items)).not.toThrow();
    const decision = pick(items);
    expect(decision.type).toBe("empty");
  });

  it("B2 fix: items lacking owns/verify are reported as unscoped, never silently dropped into empty", () => {
    const items = [
      item({ id: "N1", owns: null, verify: null }),
      item({ id: "N2", owns: ["a"], verify: null }),
      item({ id: "N3", owns: null, verify: "v" }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("unscoped");
    expect(decision.count).toBe(3);
    expect(decision.ids).toEqual(["N1", "N2", "N3"]);
  });

  it("scoped-and-unblocked items take priority over reporting unscoped ones", () => {
    const items = [
      item({ id: "N1", owns: null, verify: null }),
      item({ id: "N2", owns: ["a"], verify: "v" }),
    ];
    const decision = pick(items);
    expect(decision).toEqual({ type: "actionable", item: items[1] });
  });

  it("escalates to the owner section before the verification section, regardless of id text", () => {
    const items = [
      item({ id: "V1", state: "verification", instrument: "inst", owed_by: null, evidence: [] }),
      item({ id: "D5", state: "owner", blocked_reason: "why", owed_by: null, evidence: [] }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("escalate");
    expect(decision.item.id).toBe("D5");
  });

  it("escalates to verification when no owner items remain", () => {
    const items = [item({ id: "V1", state: "verification", instrument: "inst", owed_by: null, evidence: [] })];
    const decision = pick(items);
    expect(decision).toEqual({ type: "escalate", item: items[0] });
  });

  it("reports empty only when nothing is left anywhere", () => {
    expect(pick([])).toEqual({ type: "empty" });
  });

  it("all actionable items blocked, with an owner item present, falls through to escalate (not empty)", () => {
    const items = [
      item({ id: "N1", owns: ["a"], verify: "v", blocked_by: ["N0"] }),
      item({ id: "D1", state: "owner", blocked_reason: "why", owed_by: null, evidence: [] }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("escalate");
    expect(decision.item.id).toBe("D1");
  });

  it("real docs/backlog.yml (regression fixture): reports unscoped over the 12 real actionable items — this is the exact B2 defect this tooling exists to prevent. A naive selector reports 'nothing owed' here.", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const decision = pick(items);
    expect(decision.type).toBe("unscoped");
    expect(decision.count).toBe(12);
    expect(decision.ids).toEqual([
      "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "N12",
    ]);
  });
});
