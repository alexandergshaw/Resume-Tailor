// AC-Q2 - the situation bank behind the "Speak as" drill.
//
// The load-bearing test in this file is the last one: every situation's beats
// must actually use that role's own terms of art. That is the property that
// makes the drill teach vocabulary rather than merely list it, and it is only
// checkable by joining the two wave-1a files against each other.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_VALUES, roleRegister } from "./roleRegisters.js";
import { ROLE_SITUATIONS, situationsFor } from "./roleSituationBank.js";

const SOURCE = readFileSync(new URL("./roleSituationBank.js", import.meta.url), "utf8");

const allSituations = () =>
  ROLE_VALUES.flatMap((role) => situationsFor(role).map((s) => ({ role, ...s })));

describe("roleSituationBank - coverage", () => {
  it("covers exactly the registry's roles, five or more situations each", () => {
    expect(Object.keys(ROLE_SITUATIONS).sort()).toEqual([...ROLE_VALUES].sort());
    for (const role of ROLE_VALUES) {
      expect(situationsFor(role).length).toBeGreaterThanOrEqual(5);
    }
  });

  it("normalizes an unknown role rather than returning nothing", () => {
    expect(situationsFor("nonsense").length).toBeGreaterThanOrEqual(5);
    expect(situationsFor(undefined).length).toBeGreaterThanOrEqual(5);
  });

  it("gives every situation a globally unique id, namespaced by its role", () => {
    const all = allSituations();
    const ids = all.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of all) {
      expect(s.id.startsWith(`${s.role}-`)).toBe(true);
      expect(s.id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });
});

describe("roleSituationBank - each situation", () => {
  it("states a scene the user can answer out loud", () => {
    for (const s of allSituations()) {
      expect(s.prompt.trim().length, `prompt too short: ${s.id}`).toBeGreaterThanOrEqual(80);
      expect(s.prompt.length, `prompt too long: ${s.id}`).toBeLessThanOrEqual(420);
      // Second person: the user IS the role, so the prompt addresses them.
      expect(s.prompt, `prompt is not in the second person: ${s.id}`).toMatch(
        /\b(you|your|you're|you've)\b/i,
      );
    }
  });

  it("adds a short context line that does not just repeat the prompt", () => {
    for (const s of allSituations()) {
      expect(s.context.trim().length, `context missing: ${s.id}`).toBeGreaterThan(10);
      expect(s.context.length, `context too long: ${s.id}`).toBeLessThanOrEqual(200);
      expect(s.prompt.includes(s.context.trim()), `context repeats the prompt: ${s.id}`).toBe(false);
    }
  });

  it("carries one beat per beat label of its own role, in order", () => {
    for (const s of allSituations()) {
      const { beatLabels } = roleRegister(s.role);
      expect(s.beats.length, `beat count differs from beatLabels: ${s.id}`).toBe(beatLabels.length);
      for (const beat of s.beats) {
        expect(beat.trim().length, `beat too short: ${s.id}`).toBeGreaterThanOrEqual(20);
        expect(beat.length, `beat too long: ${s.id}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("uses every prompt and every context exactly once in the WHOLE bank", () => {
    // Within-role uniqueness alone is satisfied by five scenes copy-pasted
    // across all ten roles with the ids renamed, which is the same generic
    // drill ten times over.
    const all = allSituations();
    const prompts = all.map((s) => s.prompt.trim().toLowerCase());
    const contexts = all.map((s) => s.context.trim().toLowerCase());
    expect(new Set(prompts).size, "a prompt is reused across the bank").toBe(all.length);
    expect(new Set(contexts).size, "a context is reused across the bank").toBe(all.length);
  });

  it("varies the KIND of scene within a role rather than restaging one", () => {
    for (const role of ROLE_VALUES) {
      const prompts = situationsFor(role).map((s) => s.prompt.toLowerCase());
      expect(new Set(prompts).size, `duplicate prompts for ${role}`).toBe(prompts.length);
      // Two situations that share their first eight words are the same scene
      // reworded; this is the cheapest observable proxy for AC-Q2.6.
      const openers = prompts.map((p) => p.split(/\s+/).slice(0, 8).join(" "));
      expect(new Set(openers).size, `${role} restages one scene`).toBe(openers.length);
    }
  });
});

describe("roleSituationBank - the join with the registry (AC-Q2.7)", () => {
  it("uses at least two of the role's own terms of art in every situation's beats", () => {
    const failures = [];
    for (const s of allSituations()) {
      const { vocabulary } = roleRegister(s.role);
      const haystack = s.beats.join(" ").toLowerCase();
      const used = vocabulary.filter((v) => haystack.includes(v.term.toLowerCase()));
      if (used.length < 2) failures.push(`${s.id} (used ${used.length})`);
    }
    expect(failures).toEqual([]);
  });

  it("can fail: a beat set with none of the role's terms is rejected by the same check", () => {
    // Positive control for the sweep above - without it, a bank whose beats
    // were all empty strings would pass a badly-written version of that test.
    const { vocabulary } = roleRegister(ROLE_VALUES[0]);
    const haystack = "nothing here resembles the vocabulary at all";
    const used = vocabulary.filter((v) => haystack.includes(v.term.toLowerCase()));
    expect(used.length).toBeLessThan(2);
  });
});

describe("roleSituationBank - purity and size", () => {
  it("reads no clock and no randomness, and makes no request", () => {
    expect(/Math\.random|Date\.now|fetch\(/.test("const x = Math.random();")).toBe(true);
    expect(SOURCE).not.toMatch(/Math\.random/);
    expect(SOURCE).not.toMatch(/Date\.now|new Date\(/);
    expect(SOURCE).not.toMatch(/\bfetch\(/);
  });

  it("stays under the file-size cap", () => {
    expect(SOURCE.split("\n").length).toBeLessThan(1000);
  });

  it("contains no NUL byte", () => {
    expect(readFileSync(new URL("./roleSituationBank.js", import.meta.url)).indexOf(0)).toBe(-1);
  });
});
