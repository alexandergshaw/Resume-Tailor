import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pick } from "./pick.mjs";
import { parseBacklogYaml } from "./yamlLite.mjs";
import { BACKLOG_YML_PATH } from "./loadBacklog.mjs";
import { compareIds } from "./idOrder.mjs";

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

  it("SITE pick.mjs:30 -- picks the FIRST scoped, unblocked item in FILE order, not by numeric id", () => {
    // Non-monotonic fixture (N30 before N2 in array order, the reverse of numeric order) --
    // required so this test can tell "sorts by id" apart from "preserves array order" (R-BL-1,
    // N31). A [N2, N30] fixture would pass under either implementation and prove nothing.
    const items = [
      item({ id: "N30", owns: ["lib/a.js"], verify: "v" }),
      item({ id: "N2", owns: ["lib/b.js"], verify: "v" }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("actionable");
    // Resists vacuity: reinstating `.sort((a, b) => compareIds(a.id, b.id))` at pick.mjs:30 makes
    // this "N2" again -- the exact HEAD behavior this criterion exists to catch.
    expect(decision.item.id).toBe("N30");
  });

  it("SITE pick.mjs:38 -- reports unscoped ids in FILE order, not by numeric id", () => {
    const items = [
      item({ id: "N30", owns: null, verify: null }),
      item({ id: "N2", owns: null, verify: null }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("unscoped");
    // Resists vacuity: reinstating the sort at pick.mjs:38 flips this to ["N2", "N30"].
    expect(decision.ids).toEqual(["N30", "N2"]);
  });

  it("SITE pick.mjs:47 -- escalates to the FIRST owner item in FILE order, not by numeric/age id", () => {
    // No actionable items at all, so this exercises the owner branch in isolation from pick.mjs:30/:38.
    const items = [
      item({ id: "D5", state: "owner", blocked_reason: "w5", owed_by: null, evidence: [] }),
      item({ id: "D2", state: "owner", blocked_reason: "w2", owed_by: null, evidence: [] }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("escalate");
    // Resists vacuity: reinstating the sort at pick.mjs:47 flips this to "D2" (age/id order) --
    // the exact ordering R-BL-1 ruled out for this section too.
    expect(decision.item.id).toBe("D5");
  });

  it("SITE pick.mjs:50 -- escalates to the FIRST verification item in FILE order, not by numeric/age id", () => {
    // No actionable and no owner items, so this isolates the verification branch alone -- this is
    // the exact call site a prior round's single-site mutant left uncaught (all landed tests green).
    const items = [
      item({ id: "V5", state: "verification", instrument: "i5", owed_by: null, evidence: [] }),
      item({ id: "V2", state: "verification", instrument: "i2", owed_by: null, evidence: [] }),
    ];
    const decision = pick(items);
    expect(decision.type).toBe("escalate");
    // Resists vacuity: reinstating the sort at pick.mjs:50 flips this to "V2".
    expect(decision.item.id).toBe("V5");
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

  it("real docs/backlog.yml (regression fixture): reports unscoped over the real actionable items — this is the exact B2 defect this tooling exists to prevent. A naive selector reports 'nothing owed' here.", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const decision = pick(items);

    // Structural properties that hold for ANY valid backlog.yml — never a hard-coded id list, which
    // breaks every time an item is closed (closed items are deleted per this file's own "no diary"
    // rule, so the live file's contents change under this test by design).
    const actionable = items.filter((it) => it.state === "actionable");
    const trulyUnscoped = actionable.filter((it) => it.owns == null || it.verify == null);

    // The B2 property itself: real backlog.yml is never fully scoped, so this must be "unscoped",
    // never silently reported as "empty".
    expect(trulyUnscoped.length).toBeGreaterThan(0);
    expect(decision.type).toBe("unscoped");

    // Every actionable item lacking owns/verify is surfaced, and nothing else is.
    expect(decision.count).toBe(trulyUnscoped.length);
    expect(decision.ids.length).toBe(trulyUnscoped.length);
    for (const it of trulyUnscoped) {
      expect(decision.ids).toContain(it.id);
    }

    // Ordering rule, not values: ids come back in the file's own literal top-to-bottom order (the
    // owner's hand-set priority), never resorted by numeric id (R-BL-1, N31).
    //
    // Loud precondition, not a silent one: this real-file check only has power while the live
    // file's unscoped ids are NOT already ascending by id -- on an ascending file, "sorts by id"
    // and "preserves file order" produce the same sequence and this assertion would pass either
    // way (the exact zero-power trap a prior round's checker found in this same test). Fail loudly
    // here rather than silently losing power if docs/backlog.yml ever drifts to ascending.
    expect(
      trulyUnscoped.map((it) => it.id),
      "the real docs/backlog.yml's unscoped ids are currently ascending by id -- this regression check has lost its power to distinguish file order from id order and must be re-armed",
    ).not.toEqual([...trulyUnscoped.map((it) => it.id)].sort(compareIds));

    expect(decision.ids).toEqual(trulyUnscoped.map((it) => it.id));
  });

  it("regression: removing an item from an in-memory copy of the real backlog.yml does not break this suite (the coupling the hard-coded id list above used to create)", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const before = pick(items);
    expect(before.type).toBe("unscoped"); // precondition for this regression check to mean anything

    const [closedId, ...remainingIds] = before.ids;
    const shrunk = items.filter((it) => it.id !== closedId);
    const after = pick(shrunk);

    expect(after.type).toBe("unscoped");
    expect(after.count).toBe(before.count - 1);
    expect(after.ids).toEqual(remainingIds);
  });
});
