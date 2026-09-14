import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeWave, DISJOINTNESS_DISCLAIMER, WAVE_CAP } from "./wave.mjs";
import { listAllFiles } from "./listFiles.mjs";

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

describe("computeWave", () => {
  let dir;
  let files;

  function makeFixtureTree() {
    dir = mkdtempSync(join(tmpdir(), "backlog-wave-"));
    mkdirSync(join(dir, "lib", "alpha"), { recursive: true });
    mkdirSync(join(dir, "lib", "beta"), { recursive: true });
    writeFileSync(join(dir, "lib", "alpha", "one.js"), "");
    writeFileSync(join(dir, "lib", "alpha", "two.js"), "");
    writeFileSync(join(dir, "lib", "beta", "three.js"), "");
    files = listAllFiles(dir);
  }

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("(a) genuinely disjoint owns: both candidates accepted, against a REAL filesystem read", () => {
    makeFixtureTree();
    const items = [
      item({ id: "N1", owns: ["lib/alpha/one.js"], verify: "v" }),
      item({ id: "N2", owns: ["lib/beta/three.js"], verify: "v" }),
    ];
    const result = computeWave(items, files);
    expect(result.accepted.map((a) => a.id)).toEqual(["N1", "N2"]);
    expect(result.skipped).toEqual([]);
  });

  it("(b) exact-path-intersecting owns: the second candidate is rejected — kills a mutant that never detects intersection", () => {
    makeFixtureTree();
    const items = [
      item({ id: "N1", owns: ["lib/alpha/**"], verify: "v" }),
      item({ id: "N2", owns: ["lib/alpha/one.js"], verify: "v" }), // overlaps N1's expanded set
    ];
    const result = computeWave(items, files);
    expect(result.accepted.map((a) => a.id)).toEqual(["N1"]);
    expect(result.skipped).toEqual([{ id: "N2", reason: "exact-path intersection with an accepted item" }]);
  });

  it("(c) directory-level-but-not-exact-path overlap is ACCEPTED — the rule is exact path, not directory", () => {
    makeFixtureTree();
    const items = [
      item({ id: "N1", owns: ["lib/alpha/one.js"], verify: "v" }),
      item({ id: "N2", owns: ["lib/alpha/two.js"], verify: "v" }), // same directory, different file
    ];
    const result = computeWave(items, files);
    // A mutant that rejects on shared directory prefix (over-eager) would wrongly exclude N2 here.
    expect(result.accepted.map((a) => a.id)).toEqual(["N1", "N2"]);
    expect(result.skipped).toEqual([]);
  });

  it("(d) the disjointness disclaimer is present in the actual returned value, even with zero accepted items", () => {
    makeFixtureTree();
    const result = computeWave([], files);
    expect(result.accepted).toEqual([]);
    expect(result.note).toBe(DISJOINTNESS_DISCLAIMER);
  });

  it("(d) the disclaimer is present with exactly one accepted item too", () => {
    makeFixtureTree();
    const items = [item({ id: "N1", owns: ["lib/alpha/one.js"], verify: "v" })];
    const result = computeWave(items, files);
    expect(result.accepted).toHaveLength(1);
    expect(result.note).toBe(DISJOINTNESS_DISCLAIMER);
  });

  it("unscoped items (owns or verify null) are never wave candidates", () => {
    makeFixtureTree();
    const items = [
      item({ id: "N1", owns: null, verify: "v" }),
      item({ id: "N2", owns: ["lib/alpha/one.js"], verify: null }),
    ];
    const result = computeWave(items, files);
    expect(result.accepted).toEqual([]);
  });

  it("a blocked item is never a wave candidate", () => {
    makeFixtureTree();
    const items = [item({ id: "N1", owns: ["lib/alpha/one.js"], verify: "v", blocked_by: ["N0"] })];
    const result = computeWave(items, files);
    expect(result.accepted).toEqual([]);
  });

  it("stops accepting at the cap (3)", () => {
    makeFixtureTree();
    const items = [
      item({ id: "N1", owns: ["lib/alpha/one.js"], verify: "v" }),
      item({ id: "N2", owns: ["lib/alpha/two.js"], verify: "v" }),
      item({ id: "N3", owns: ["lib/beta/three.js"], verify: "v" }),
      item({ id: "N4", owns: ["lib/**"], verify: "v" }), // disjoint from nothing left, but cap already hit
    ];
    expect(WAVE_CAP).toBe(3);
    const result = computeWave(items, files);
    expect(result.accepted).toHaveLength(3);
    expect(result.accepted.map((a) => a.id)).toEqual(["N1", "N2", "N3"]);
  });
});
