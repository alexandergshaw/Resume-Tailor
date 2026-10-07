import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateContract, sha256, idNamespaceViolation } from "./contract.mjs";
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

// N136: the id-namespace <-> state agreement (N = actionable, D = owner, V = verification) used to be
// asserted only by an inline map in yamlLite.test.js, so a valid-but-wrong pairing (an N id with state
// "owner") passed validateContract, passed the renderGate hook, and went red on main after the push.
describe("validateContract — N136: an id's namespace must agree with its state", () => {
  // Every field a state could require is populated, so the ONLY thing a wrong pairing can trip is the
  // namespace rule - a violation count of exactly 1 proves no other check is what rejected it.
  const full = (id, state) =>
    item({ id, state, title: "t", owed_by: "o", blocked_reason: "why blocked", instrument: "the instrument" });

  it("no-op control: each namespace with its own state has 0 violations", () => {
    for (const [id, state] of [["N1", "actionable"], ["D1", "owner"], ["V1", "verification"]]) {
      const { ok, violations } = validateContract([full(id, state)]);
      expect(violations, `${id}/${state}`).toEqual([]);
      expect(ok).toBe(true);
    }
  });

  it("THE miss, literally: an N id set to the VALID state \"owner\" is rejected, naming the id, the namespace and both states", () => {
    const { ok, violations } = validateContract([full("N134", "owner")]);
    expect(ok).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("N134");
    expect(violations[0]).toContain('namespace "N"');
    expect(violations[0]).toContain('requires state "actionable"');
    expect(violations[0]).toContain('state is "owner"');
  });

  it("every one of the 6 wrong namespace/state pairings is rejected with exactly one violation, and the 3 right ones with none", () => {
    const states = ["actionable", "owner", "verification"];
    const right = { N: "actionable", D: "owner", V: "verification" };
    let rejected = 0;
    for (const prefix of ["N", "D", "V"]) {
      for (const state of states) {
        const { violations } = validateContract([full(`${prefix}7`, state)]);
        if (state === right[prefix]) {
          expect(violations, `${prefix}7/${state}`).toEqual([]);
        } else {
          expect(violations, `${prefix}7/${state}`).toHaveLength(1);
          rejected += 1;
        }
      }
    }
    expect(rejected).toBe(6);
  });

  it("an id whose namespace is not N/D/V is rejected whatever its state (X1, n1, and the multi-letter NA1)", () => {
    for (const id of ["X1", "n1", "NA1", "SEC1"]) {
      const { ok, violations } = validateContract([full(id, "actionable")]);
      expect(ok, id).toBe(false);
      expect(violations, id).toHaveLength(1);
      expect(violations[0], id).toContain("not one of N (actionable), D (owner), V (verification)");
    }
  });

  it("the historical spelling: an N id with state \"shipped\" is rejected exactly once, as an unknown state (no second, derived violation)", () => {
    const { ok, violations } = validateContract([full("N134", "shipped")]);
    expect(ok).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('unknown state "shipped"');
  });

  it("a malformed id is reported once as non-namespaced and never reaches (or crashes) the namespace rule", () => {
    for (const id of ["notnamespaced", "", null, 7, undefined]) {
      let result;
      expect(() => {
        result = validateContract([full(id, "actionable")]);
      }, String(id)).not.toThrow();
      expect(result.ok, String(id)).toBe(false);
      expect(result.violations, String(id)).toHaveLength(1);
      expect(result.violations[0], String(id)).toContain("non-namespaced");
    }
  });

  it("reports every disagreement in a file at once, not just the first", () => {
    const { violations } = validateContract([full("N1", "owner"), full("D2", "actionable"), full("V3", "verification")]);
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.startsWith("N1:"))).toBe(true);
    expect(violations.some((v) => v.startsWith("D2:"))).toBe(true);
  });

  it("idNamespaceViolation is the same pure predicate: null on agreement, text on disagreement, never throws", () => {
    expect(idNamespaceViolation("N5", "actionable")).toBeNull();
    expect(idNamespaceViolation("D5", "owner")).toBeNull();
    expect(idNamespaceViolation("V5", "verification")).toBeNull();
    expect(idNamespaceViolation("N5", "owner")).toContain("N5");
    expect(idNamespaceViolation("N5", "shipped")).toContain('"shipped"');
    expect(idNamespaceViolation("N5", undefined)).not.toBeNull();
    expect(idNamespaceViolation(undefined, "actionable")).not.toBeNull();
    expect(idNamespaceViolation(null, null)).not.toBeNull();
    expect(idNamespaceViolation("", "actionable")).not.toBeNull();
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

// N21: vitest treats every positional as a substring FILTER, so `vitest run <real> <missing>` exits 0
// with "1 passed" and the missing path is silently absorbed. The contract is the only place a
// typo'd or invented path in `verify` can be caught, so it must existsSync what the command cites.
describe("validateContract — N21: a path cited in verify must exist", () => {
  function withVerify(verifyCmd) {
    return validateContract([item({ id: "N1", verify: verifyCmd, verify_proof: completeProof(verifyCmd) })]);
  }

  it("flags a verify that cites a NON-EXISTENT test path, naming the item and the missing path", () => {
    const { ok, violations } = withVerify("npx vitest run lib/llm/zzNoSuchFilezz.test.js");
    expect(ok).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("N1");
    expect(violations[0]).toContain("lib/llm/zzNoSuchFilezz.test.js");
    expect(violations[0]).toContain("does not exist");
  });

  it("passes a verify that cites a REAL path (resolved under hello-world/)", () => {
    const { ok, violations } = withVerify("npx vitest run lib/llm/featureEngine.test.js");
    expect(ok).toBe(true);
    expect(violations).toEqual([]);
  });

  it("passes a REAL path that only resolves from the repo root (a script run from there)", () => {
    const { ok, violations } = withVerify("node hello-world/scripts/backlog/render.mjs");
    expect(ok).toBe(true);
    expect(violations).toEqual([]);
  });

  it("the measured hazard, literally: a real path beside a missing one — only the missing one is named", () => {
    const { ok, violations } = withVerify(
      "npx vitest run lib/llm/featureEngine.test.js lib/llm/zzNoSuchFilezz.test.js",
    );
    expect(ok).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("lib/llm/zzNoSuchFilezz.test.js");
    expect(violations[0]).not.toContain("featureEngine");
  });

  it("reports every distinct missing path once, and a path repeated in the command only once", () => {
    const { violations } = withVerify(
      "npx vitest run lib/zzMissingOne.test.js lib/zzMissingTwo.test.js lib/zzMissingOne.test.js",
    );
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.includes("zzMissingOne"))).toBe(true);
    expect(violations.some((v) => v.includes("zzMissingTwo"))).toBe(true);
  });

  it("sees a path through shell quoting and trailing punctuation", () => {
    for (const cmd of [
      'npx vitest run "lib/zzQuoted.test.js"',
      "npx vitest run 'lib/zzQuoted.test.js'",
      "npx vitest run lib/zzQuoted.test.js;",
      "npx vitest run ./lib/zzQuoted.test.js",
    ]) {
      const { ok, violations } = withVerify(cmd);
      expect(ok, cmd).toBe(false);
      expect(violations.some((v) => v.includes("zzQuoted.test.js")), cmd).toBe(true);
    }
  });

  it("no false positive: a verify with no path-like token passes", () => {
    for (const cmd of [
      "npm run build",
      "npx vitest run --no-file-parallelism",
      "npx eslint .",
      "run the suite and confirm 339 of 339 pass, then read the Tests line by hand",
      "npx vitest run lib/llm", // a bare directory is a substring filter, not a cited file
    ]) {
      const { ok, violations } = withVerify(cmd);
      expect(violations, cmd).toEqual([]);
      expect(ok, cmd).toBe(true);
    }
  });

  it("no false positive: tokens that merely resemble a file are not treated as cited paths", () => {
    for (const cmd of [
      "npx vitest run zzNoSuchFilezz.test.js", // bare filename, no slash: a vitest filter that matches anywhere
      "curl https://example.com/zz/NoSuch.js", // a URL
      "npx vitest run lib/**/zzNoSuch*.test.js", // a glob
      "npx vitest run /zz/absolute/NoSuch.test.js", // absolute: not repo-relative
      "npx vitest run --config=zz/NoSuch.config.js", // a flag, not a positional
      "node -e \"require('./zz/NoSuch.js')\"", // code inside a quoted string
    ]) {
      const { violations } = withVerify(cmd);
      expect(violations, cmd).toEqual([]);
    }
  });

  it("the check lives inside the non-null verify branch: a null verify is never inspected", () => {
    const { ok, violations } = validateContract([
      item({ id: "N1", verify: null, owns: ["lib/zzNoSuchFilezz.test.js"], title: "see lib/zzNoSuchFilezz.test.js" }),
    ]);
    expect(ok).toBe(true);
    expect(violations).toEqual([]);
  });
});

// N139: validateContract's doc says it never throws, but `verify` was fed straight to string
// operations (.split in missingCitedPaths, the hash in verifyProofViolations) with no type check, and
// yamlLite happily parses `verify: []` / `verify: ["a"]` (a flow array is a legal scalar there). A
// hand-edit that wrote a list where a command string belongs therefore made `npm run backlog:check`
// die with a TypeError instead of naming the item - and made the renderGate hook fail OPEN on a defect
// it should have blocked.
describe("validateContract — N139: a non-string verify is a reported violation, never a throw", () => {
  const REAL_VERIFY = "npx vitest run lib/llm/featureEngine.test.js";
  const run = (items) => {
    let result;
    expect(() => {
      result = validateContract(items);
    }).not.toThrow();
    return result;
  };

  // [label, value, the type word the message must name]. 0 and false are falsy but NOT null, so they
  // are also the rows that a truthiness guard (`if (item.verify)`) in place of `!= null` would skip.
  const NON_STRING_VERIFY = [
    ["an empty array (verify: [])", [], "array"],
    ["an array holding a would-be-valid command", [REAL_VERIFY], "array"],
    ["a nested array", [[]], "array"],
    ["an empty object (verify: {})", {}, "object"],
    ["a number (verify: 7)", 7, "number"],
    ["zero (falsy, not null)", 0, "number"],
    ["false (falsy, not null)", false, "boolean"],
  ];

  it("no-op control: the very same item with a null verify has 0 violations (only the verify value differs below)", () => {
    const { ok, violations } = run([item({ id: "N77", verify: null })]);
    expect(violations).toEqual([]);
    expect(ok).toBe(true);
  });

  it.each(NON_STRING_VERIFY)("%s: one violation naming the id, the field and the type found - no throw", (_label, value, kind) => {
    const { ok, violations } = run([item({ id: "N77", verify: value })]);
    expect(ok).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0].startsWith("N77: verify ")).toBe(true);
    expect(violations[0]).toContain(kind);
  });

  it("with a populated verify_proof it is STILL exactly one violation: the proof checks hash the string, so they are not run on a non-string", () => {
    for (const value of [[], {}, 7]) {
      const { violations } = run([item({ id: "N1", verify: value, verify_proof: completeProof(REAL_VERIFY) })]);
      expect(violations, JSON.stringify(value)).toHaveLength(1);
      expect(violations[0]).toContain("verify must be");
    }
  });

  it("does not hide the rest of the file: every item's violations are still reported at once", () => {
    const { ok, violations } = run([
      item({ id: "N1", verify: [] }),
      item({ id: "N2", owed_by: null }),
      item({ id: "N3", verify: {} }),
    ]);
    expect(ok).toBe(false);
    expect(violations).toHaveLength(3);
    expect(violations.some((v) => v.startsWith("N1: verify "))).toBe(true);
    expect(violations.some((v) => v.startsWith("N2:") && v.includes("no owed_by"))).toBe(true);
    expect(violations.some((v) => v.startsWith("N3: verify "))).toBe(true);
  });

  it("through the real parser, as backlog:check reaches it: yamlLite's list spellings of verify become a violation, not a crash", () => {
    for (const spelling of ["[]", '["npx vitest run lib/llm/featureEngine.test.js"]', "[[]]"]) {
      const yml = [
        '- id: "N1"',
        '  state: "actionable"',
        '  title: "t"',
        '  owed_by: "o"',
        "  evidence: []",
        "  blocked_reason: null",
        "  instrument: null",
        "  owns: null",
        `  verify: ${spelling}`,
        "  verify_proof: null",
        "  blocked_by: []",
        "",
      ].join("\n");
      const { ok, violations } = run(parseBacklogYaml(yml));
      expect(ok, spelling).toBe(false);
      expect(violations, spelling).toHaveLength(1);
      expect(violations[0].startsWith("N1: verify "), spelling).toBe(true);
    }
  });

  it("well-formed verify values are unchanged: null passes, and a real command with a complete proof passes", () => {
    expect(run([item({ id: "N1", verify: null })])).toEqual({ ok: true, violations: [] });
    const withProof = item({ id: "N1", owns: ["lib/llm/featureEngine.js"], verify: REAL_VERIFY, verify_proof: completeProof(REAL_VERIFY) });
    expect(run([withProof])).toEqual({ ok: true, violations: [] });
  });

  it("a STRING verify still gets every pre-existing check (dead filter, missing path, missing proof): the guard short-circuits only non-strings", () => {
    const cmd = 'npx vitest run lib/zzNoSuchFilezz.test.js -t "x"';
    const { violations } = run([item({ id: "N1", verify: cmd, verify_proof: null })]);
    expect(violations).toHaveLength(3);
    expect(violations.some((v) => v.includes("-t"))).toBe(true);
    expect(violations.some((v) => v.includes("does not exist"))).toBe(true);
    expect(violations.some((v) => v.includes("verify_proof is not populated"))).toBe(true);
  });

  // The doc comment's claim, swept rather than sampled: every field an item carries, set to a value of
  // every shape the parser can emit (null, a string, a flow array, a nested one) plus the non-parser
  // shapes a direct caller could pass, must still return the { ok, violations: string[] } contract
  // that decideContractGate and backlog:check both rely on.
  const HOSTILE = [null, undefined, "", "x", 0, 7, true, false, [], ["a"], [[]], {}, { a: 1 }];
  const FIELDS = Object.keys(item());

  it(`never throws, and always returns { ok, violations: string[] }: ${FIELDS.length} fields x ${HOSTILE.length} values`, () => {
    let rows = 0;
    for (const field of FIELDS) {
      for (const value of HOSTILE) {
        const label = `${field} = ${JSON.stringify(value)}`;
        const result = run([item({ [field]: value })]);
        expect(Array.isArray(result.violations), label).toBe(true);
        expect(result.violations.every((v) => typeof v === "string"), label).toBe(true);
        expect(result.ok, label).toBe(result.violations.length === 0);
        rows += 1;
      }
    }
    expect(rows).toBe(FIELDS.length * HOSTILE.length);
  });

  it("never throws on a hostile verify_proof, or a hostile field inside one, beside a real string verify", () => {
    const proofKeys = Object.keys(completeProof(REAL_VERIFY));
    for (const value of HOSTILE) {
      const { violations } = run([item({ id: "N1", verify: REAL_VERIFY, verify_proof: value })]);
      expect(violations.every((v) => typeof v === "string"), JSON.stringify(value)).toBe(true);
      for (const key of proofKeys) {
        const { violations: inner } = run([
          item({ id: "N1", verify: REAL_VERIFY, verify_proof: completeProof(REAL_VERIFY, { [key]: value }) }),
        ]);
        expect(inner.every((v) => typeof v === "string"), `${key} = ${JSON.stringify(value)}`).toBe(true);
      }
    }
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
