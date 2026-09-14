import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateContract, sha256 } from "./contract.mjs";
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

function completeProof(verifyCommand, overrides = {}) {
  return {
    command_sha256: sha256(verifyCommand),
    fails_on_head_exit: 1,
    passes_on_fix_exit: 0,
    kills_on_revert_exit: 1,
    survives_noop_exit: 0,
    proved_at: "2026-09-14T00:00:00Z",
    proved_by: "checker-session-1",
    ...overrides,
  };
}

describe("validateContract — structural rules", () => {
  it("no-op control: a real, complete, self-consistent, filter-free item set has 0 violations", () => {
    const verifyCmd = "npx vitest run lib/llm/featureEngine.test.js";
    const items = [item({ id: "N1", owns: ["lib/llm/featureEngine.js"], verify: verifyCmd, verify_proof: completeProof(verifyCmd) })];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(true);
    expect(violations).toEqual([]);
  });

  it("rejects an item with a non-namespaced id", () => {
    const { ok, violations } = validateContract([item({ id: "notnamespaced" })]);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("non-namespaced"))).toBe(true);
  });

  it("B3 fix: rejects a duplicate id — kills a mutant that skips the uniqueness check", () => {
    const { ok, violations } = validateContract([item({ id: "N1" }), item({ id: "N1" })]);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes('duplicate id "N1"'))).toBe(true);
  });

  it("requires owed_by on an actionable item", () => {
    const { ok, violations } = validateContract([item({ id: "N1", owed_by: null })]);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("no owed_by"))).toBe(true);
  });

  it("requires blocked_reason on an owner item, and title as the question", () => {
    const { ok, violations } = validateContract([
      item({ id: "D1", state: "owner", owed_by: null, evidence: [], blocked_reason: null }),
    ]);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("no blocked_reason"))).toBe(true);
  });

  it("requires instrument on a verification item", () => {
    const { ok, violations } = validateContract([
      item({ id: "V1", state: "verification", owed_by: null, evidence: [], instrument: null }),
    ]);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("no instrument"))).toBe(true);
  });

  it("does NOT require owns/verify on an actionable item (B8: nullable until scoped)", () => {
    const { ok } = validateContract([item({ id: "N1", owns: null, verify: null })]);
    expect(ok).toBe(true);
  });
});

describe("validateContract — B4: the verify gate's kill control", () => {
  it("THE central defeat, reproduced literally: a dead -t filter is REJECTED even with an otherwise-complete verify_proof", () => {
    const verifyCmd = 'npx vitest run lib/llm/featureEngine.test.js -t "zzNoSuchTestzz"';
    const items = [
      item({ id: "N1", owns: ["lib/llm/featureEngine.js"], verify: verifyCmd, verify_proof: completeProof(verifyCmd) }),
    ];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("N1") && v.includes("-t"))).toBe(true);
  });

  it("also rejects the --testNamePattern spelling of the same shape", () => {
    const verifyCmd = 'npx vitest run x.test.js --testNamePattern="nothing matches this"';
    const items = [item({ id: "N1", verify: verifyCmd, verify_proof: completeProof(verifyCmd) })];
    const { ok } = validateContract(items);
    expect(ok).toBe(false);
  });

  it("a non-null verify with no verify_proof at all is rejected", () => {
    const items = [item({ id: "N1", verify: "npx vitest run lib/a.test.js", verify_proof: null })];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("verify_proof is not populated"))).toBe(true);
  });

  it("B4 fix: rejects the ORIGINAL design's 3-part proof shape (no kills_on_revert_exit) — this is exactly what let Defeat 2 through", () => {
    const verifyCmd = "npx vitest run lib/a.test.js";
    const proof = completeProof(verifyCmd);
    delete proof.kills_on_revert_exit;
    const items = [item({ id: "N1", verify: verifyCmd, verify_proof: proof })];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("kills_on_revert_exit"))).toBe(true);
  });

  it("rejects a stale hash: verify_proof pinned to a different command string than the live one", () => {
    const provedCmd = "npx vitest run lib/a.test.js";
    const items = [item({ id: "N1", verify: "npx vitest run lib/a.test.js -- changed", verify_proof: completeProof(provedCmd) })];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("stale proof"))).toBe(true);
  });

  it("rejects fails_on_head_exit === 0 (verify must fail on HEAD before any fix)", () => {
    const verifyCmd = "npx vitest run lib/a.test.js";
    const proof = completeProof(verifyCmd, { fails_on_head_exit: 0 });
    const items = [item({ id: "N1", verify: verifyCmd, verify_proof: proof })];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("fails_on_head_exit is 0"))).toBe(true);
  });

  it("rejects kills_on_revert_exit === 0 (reverting the fix must go red again)", () => {
    const verifyCmd = "npx vitest run lib/a.test.js";
    const proof = completeProof(verifyCmd, { kills_on_revert_exit: 0 });
    const items = [item({ id: "N1", verify: verifyCmd, verify_proof: proof })];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(false);
    expect(violations.some((v) => v.includes("kills_on_revert_exit is 0"))).toBe(true);
  });

  it("positive control: a clean, filter-free verify command with a complete kill-including proof passes", () => {
    const verifyCmd = "npx vitest run lib/llm/featureEngine.test.js";
    const items = [item({ id: "N1", owns: ["lib/llm/featureEngine.js"], verify: verifyCmd, verify_proof: completeProof(verifyCmd) })];
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(true);
    expect(violations).toEqual([]);
  });
});

describe("validateContract — real docs/backlog.yml", () => {
  it("the migrated 15-item file has 0 contract violations today (all verify are null, as migration requires)", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const { ok, violations } = validateContract(items);
    expect(ok).toBe(true);
    expect(violations).toEqual([]);
  });
});
