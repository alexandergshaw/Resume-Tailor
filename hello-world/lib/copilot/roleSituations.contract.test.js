// AC-Q5 - choosing the next situation for the "Speak as" drill.
//
// Same discipline as practiceQuestions.js: deterministic, seeded, no clock, no
// randomness, and it never dead-ends. The drain test is the load-bearing one -
// it asserts the WHOLE sequence, because a selector that silently repeats or
// silently skips would satisfy any per-call assertion.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_VALUES, DEFAULT_ROLE } from "./roleRegisters.js";
import { situationsFor } from "./roleSituationBank.js";
import { nextRoleSituation } from "./roleSituations.js";

const SOURCE = readFileSync(new URL("./roleSituations.js", import.meta.url), "utf8");

// Walks a role's bank the way the UI does: ask, record the prompt, ask again.
function drain(role) {
  const asked = [];
  const seen = [];
  const flags = [];
  for (let i = 0; i < situationsFor(role).length; i += 1) {
    const { situation, exhausted } = nextRoleSituation({ role, asked });
    seen.push(situation.id);
    flags.push(exhausted);
    asked.push(situation.prompt);
  }
  return { seen, flags, asked };
}

describe("nextRoleSituation - determinism", () => {
  it("returns byte-identical results for identical inputs", () => {
    for (const role of ROLE_VALUES) {
      const a = nextRoleSituation({ role, asked: [] });
      const b = nextRoleSituation({ role, asked: [] });
      expect(a).toEqual(b);
    }
  });

  it("returns a full situation, beats included", () => {
    const { situation } = nextRoleSituation({ role: "manager", asked: [] });
    const fromBank = situationsFor("manager").find((s) => s.id === situation.id);
    expect(fromBank).toBeTruthy();
    expect(situation.prompt).toBe(fromBank.prompt);
    expect(situation.context).toBe(fromBank.context);
    expect(situation.beats).toEqual(fromBank.beats);
  });

  it("is seeded rather than a plain walk of the bank's declaration order", () => {
    const differing = ROLE_VALUES.filter((role) => {
      const declared = situationsFor(role).map((s) => s.id);
      return JSON.stringify(drain(role).seen) !== JSON.stringify(declared);
    });
    // A hash-seeded permutation leaves declaration order intact only by
    // coincidence, so "one role out of ten was shuffled" is far too weak a
    // bar - it passes against a selector that special-cases a single role.
    expect(differing.length).toBeGreaterThanOrEqual(Math.ceil(ROLE_VALUES.length / 2));
  });
});

describe("nextRoleSituation - never repeats while anything is unasked", () => {
  it.each(ROLE_VALUES)("covers every situation exactly once for %s", (role) => {
    const bankIds = situationsFor(role).map((s) => s.id);
    const { seen, flags } = drain(role);
    expect([...seen].sort()).toEqual([...bankIds].sort());
    expect(new Set(seen).size).toBe(bankIds.length);
    // Only the very last call in the drain may be flagged exhausted, and it
    // must not be: the flag means "everything has now been asked", which is
    // only true on the call AFTER the drain.
    expect(flags).toEqual(bankIds.map(() => false));
  });

  it("matches an asked prompt regardless of case and surrounding whitespace", () => {
    const first = nextRoleSituation({ role: "manager", asked: [] }).situation;
    const messy = `   ${first.prompt.toUpperCase().replace(/\s+/g, "   ")}  `;
    const next = nextRoleSituation({ role: "manager", asked: [messy] }).situation;
    expect(next.id).not.toBe(first.id);
  });

  it("ignores asked entries that belong to another role", () => {
    const other = situationsFor("professor")[0].prompt;
    const withNoise = nextRoleSituation({ role: "manager", asked: [other] });
    const clean = nextRoleSituation({ role: "manager", asked: [] });
    expect(withNoise.situation.id).toBe(clean.situation.id);
  });
});

describe("nextRoleSituation - exhaustion cycles rather than dead-ends", () => {
  it.each(ROLE_VALUES)("flags exhausted and restarts the order for %s", (role) => {
    const { asked, seen } = drain(role);
    const after = nextRoleSituation({ role, asked });
    expect(after.exhausted).toBe(true);
    expect(after.situation.id).toBe(seen[0]);
    expect(after.situation.prompt.length).toBeGreaterThan(0);
  });
});

describe("nextRoleSituation - resolution and purity", () => {
  it("normalizes an unknown or missing role instead of throwing", () => {
    const dflt = nextRoleSituation({ role: DEFAULT_ROLE, asked: [] });
    expect(nextRoleSituation({ role: "nonsense", asked: [] })).toEqual(dflt);
    expect(nextRoleSituation({})).toEqual(dflt);
    expect(nextRoleSituation({ role: "manager" }).situation.id).toBeTruthy();
  });

  it("reads no clock and no randomness, and makes no request", () => {
    expect(/Math\.random|Date\.now|fetch\(/.test("const x = Math.random();")).toBe(true);
    expect(SOURCE).not.toMatch(/Math\.random/);
    expect(SOURCE).not.toMatch(/Date\.now|new Date\(/);
    expect(SOURCE).not.toMatch(/\bfetch\(/);
  });

  it("contains no NUL byte", () => {
    expect(readFileSync(new URL("./roleSituations.js", import.meta.url)).indexOf(0)).toBe(-1);
  });
});
