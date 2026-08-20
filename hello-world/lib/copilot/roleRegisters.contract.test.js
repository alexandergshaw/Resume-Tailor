// AC-Q1 - the frozen contract for the "Speak as" drill's role registry.
//
// Written before the module existed, as the gate for wave 1a. Everything here
// asserts an OBSERVABLE property of the data (shape, uniqueness, purity,
// resolution rules), never an internal detail, so the content can be rewritten
// freely as long as the contract holds.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_ROLE,
  ROLE_REGISTERS,
  ROLE_VALUES,
  normalizeRole,
  roleRegister,
  roleLabel,
} from "./roleRegisters.js";

const SOURCE = readFileSync(new URL("./roleRegisters.js", import.meta.url), "utf8");

// AC-Q1.1 - the drill is worthless if it only covers one kind of workplace, so
// this set is part of the contract rather than a suggestion.
const REQUIRED_ROLES = [
  "manager",
  "executive",
  "professor",
  "clinician",
  "attorney",
  "consultant",
  "tech-lead",
  "account-executive",
  "teacher",
  "people-ops",
];

describe("roleRegisters - the registry itself", () => {
  it("carries at least ten roles, including every required one", () => {
    expect(ROLE_REGISTERS.length).toBeGreaterThanOrEqual(10);
    for (const value of REQUIRED_ROLES) {
      expect(ROLE_VALUES).toContain(value);
    }
  });

  it("keeps ROLE_VALUES in step with ROLE_REGISTERS, with unique kebab-case values", () => {
    expect(ROLE_VALUES).toEqual(ROLE_REGISTERS.map((r) => r.value));
    expect(new Set(ROLE_VALUES).size).toBe(ROLE_VALUES.length);
    for (const value of ROLE_VALUES) {
      expect(value).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });

  it("uses a real role as the default", () => {
    expect(ROLE_VALUES).toContain(DEFAULT_ROLE);
  });

  it("gives every role distinct labels and blurbs", () => {
    const labels = ROLE_REGISTERS.map((r) => r.label);
    const blurbs = ROLE_REGISTERS.map((r) => r.blurb);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(blurbs).size).toBe(blurbs.length);
  });
});

// AC-Q1.2. Without this block the whole premise of the feature is unenforced:
// ten roles carrying one shared guidance string, one shared vocabulary and one
// shared cadence list would satisfy every per-role assertion below while
// making a manager and a clinician sound identical.
describe("roleRegisters - the roles actually differ from each other", () => {
  const pairs = ROLE_REGISTERS.flatMap((a, i) => ROLE_REGISTERS.slice(i + 1).map((b) => [a, b]));

  it("has a distinct guidance string per role", () => {
    for (const [a, b] of pairs) {
      expect(a.guidance, `${a.value} and ${b.value} share guidance`).not.toBe(b.guidance);
    }
  });

  it("gives each role its own terms of art, overlapping by at most one", () => {
    const overlaps = [];
    for (const [a, b] of pairs) {
      const shared = a.vocabulary
        .map((v) => v.term.toLowerCase())
        .filter((t) => b.vocabulary.some((w) => w.term.toLowerCase() === t));
      if (shared.length > 1) overlaps.push(`${a.value}/${b.value}: ${shared.join(", ")}`);
    }
    expect(overlaps).toEqual([]);
  });

  it("does not reuse one cadence list across roles", () => {
    for (const [a, b] of pairs) {
      expect(a.cadence, `${a.value} and ${b.value} share cadence`).not.toEqual(b.cadence);
    }
  });

  it("does not reuse one set of beats across roles", () => {
    const shapes = ROLE_REGISTERS.map((r) => JSON.stringify(r.beatLabels));
    // Some overlap is legitimate (two roles may both open by naming the facts),
    // but ten identical beat lists is a single generic register wearing ten
    // labels - which is exactly the degenerate implementation this rules out.
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(Math.ceil(ROLE_REGISTERS.length / 2));
  });
});

describe.each(REQUIRED_ROLES)("roleRegisters - %s descriptor", (value) => {
  const role = () => ROLE_REGISTERS.find((r) => r.value === value);

  it("has a label and a one-sentence blurb", () => {
    const r = role();
    expect(r.label.trim().length).toBeGreaterThan(2);
    expect(r.blurb.trim().length).toBeGreaterThan(20);
    expect(r.blurb.length).toBeLessThanOrEqual(140);
    expect(r.blurb.trim().endsWith(".")).toBe(true);
  });

  it("has guidance long enough to steer a model prompt, addressed to the speaker", () => {
    const { guidance } = role();
    expect(guidance.trim().length).toBeGreaterThanOrEqual(150);
    expect(guidance).toMatch(/\byou(r|'re|’re|’ve|'ve)?\b/i);
    // Single line, no double quotes: the route tests compare this string
    // against the prompt actually sent to the model, and JSON escaping of a
    // newline or a quote would break that comparison against a route that
    // passes it through verbatim. interviewTypes.js concatenates fragments
    // for the same reason.
    expect(guidance).not.toMatch(/[\n\r"]/);
  });

  it("names three to four cadence characteristics", () => {
    const { cadence } = role();
    expect(cadence.length).toBeGreaterThanOrEqual(3);
    expect(cadence.length).toBeLessThanOrEqual(4);
    for (const line of cadence) {
      expect(line.length).toBeGreaterThanOrEqual(30);
      expect(line.length).toBeLessThanOrEqual(160);
    }
    expect(new Set(cadence).size).toBe(cadence.length);
  });

  it("carries five to eight terms of art, each saying what it signals", () => {
    const { vocabulary } = role();
    expect(vocabulary.length).toBeGreaterThanOrEqual(5);
    expect(vocabulary.length).toBeLessThanOrEqual(8);
    const terms = vocabulary.map((v) => v.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
    for (const entry of vocabulary) {
      expect(entry.term.trim().length).toBeGreaterThan(2);
      expect(entry.signals.trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it("names two to four register violations as QUOTABLE phrases, with the reason", () => {
    const { avoid } = role();
    expect(avoid.length).toBeGreaterThanOrEqual(2);
    expect(avoid.length).toBeLessThanOrEqual(4);
    for (const entry of avoid) {
      // The phrase has to be the actual wording, not a sentence describing it:
      // the response route rejects a model answer that CONTAINS one, which is
      // only possible against a quotable fragment.
      expect(entry.phrase.trim().length, `${value}: phrase too short`).toBeGreaterThanOrEqual(3);
      expect(entry.phrase.length, `${value}: phrase is a sentence, not a quote`).toBeLessThanOrEqual(60);
      expect(entry.phrase.trim(), `${value}: phrase ends like prose`).not.toMatch(/\.$/);
      expect(entry.why.trim().length, `${value}: no reason given`).toBeGreaterThanOrEqual(20);
    }
    const phrases = avoid.map((a) => a.phrase.toLowerCase());
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("names three to five ordered beats, with short labels", () => {
    const { beatLabels } = role();
    expect(beatLabels.length).toBeGreaterThanOrEqual(3);
    expect(beatLabels.length).toBeLessThanOrEqual(5);
    for (const label of beatLabels) {
      expect(label.trim().length).toBeGreaterThan(2);
      expect(label.length).toBeLessThanOrEqual(24);
    }
    expect(new Set(beatLabels).size).toBe(beatLabels.length);
  });

  it("carries one fallback beat per beat label", () => {
    const r = role();
    expect(r.fallbackBeats.length).toBe(r.beatLabels.length);
    for (const beat of r.fallbackBeats) {
      expect(beat.trim().length).toBeGreaterThanOrEqual(20);
      expect(beat.length).toBeLessThanOrEqual(200);
    }
  });

  it("writes the fallback beats as SPEECH, not as instructions about speech", () => {
    // These are spoken verbatim by the drill when a situation is not in the
    // bank. "The assessment is stated plainly, including what is still
    // uncertain" is a description of a good answer; it is not an answer.
    // Requiring the speaker to be present in the sentence is the cheapest
    // observable proxy for the difference.
    for (const beat of role().fallbackBeats) {
      expect(beat, `${value}: reads as an instruction, not speech`).toMatch(
        /\b(I|I'm|I'll|we|we're|we'll|my|our|you|your)\b/,
      );
    }
  });

  it("uses at least one of its own terms of art in the fallback beats", () => {
    // The drill promises the answer uses the role's vocabulary. If the
    // fallback content carries none, something downstream has to inject one -
    // which is how "Let me be clear about the escalate here" gets shipped.
    // The guarantee belongs in the content, not in a decorator.
    const r = role();
    const haystack = r.fallbackBeats.join(" ").toLowerCase();
    const used = r.vocabulary.filter((v) => haystack.includes(v.term.toLowerCase()));
    expect(used.length, `${value}: no term of art in the fallback beats`).toBeGreaterThanOrEqual(1);
  });
});

describe("roleRegisters - resolution", () => {
  it("resolves a known value, in any case, with whitespace", () => {
    expect(normalizeRole("manager")).toBe("manager");
    expect(normalizeRole("  Manager ")).toBe("manager");
    expect(normalizeRole("TECH-LEAD")).toBe("tech-lead");
  });

  it("falls back to the default for anything it does not know", () => {
    for (const junk of [null, undefined, "", "   ", "Manager Smith", "ceo-of-nothing", 42, {}, []]) {
      expect(normalizeRole(junk)).toBe(DEFAULT_ROLE);
    }
  });

  it("always returns a descriptor from roleRegister, defaulting on junk", () => {
    expect(roleRegister("professor").value).toBe("professor");
    expect(roleRegister("nonsense").value).toBe(DEFAULT_ROLE);
    expect(roleRegister(undefined).value).toBe(DEFAULT_ROLE);
  });

  it("labels a role, defaulting on junk", () => {
    expect(roleLabel("professor")).toBe(roleRegister("professor").label);
    expect(roleLabel("nonsense")).toBe(roleRegister(DEFAULT_ROLE).label);
  });
});

describe("roleRegisters - purity and size", () => {
  it("reads no clock and no randomness, and makes no request", () => {
    // A positive control first: if this pattern cannot match at all, the three
    // assertions below prove nothing (a clean scan of nothing reads as clean).
    expect(/Math\.random|Date\.now|fetch\(/.test("const x = Math.random();")).toBe(true);
    expect(SOURCE).not.toMatch(/Math\.random/);
    expect(SOURCE).not.toMatch(/Date\.now|new Date\(/);
    expect(SOURCE).not.toMatch(/\bfetch\(/);
  });

  it("stays under the file-size cap", () => {
    expect(SOURCE.split("\n").length).toBeLessThan(1000);
  });

  it("contains no NUL byte", () => {
    expect(readFileSync(new URL("./roleRegisters.js", import.meta.url)).indexOf(0)).toBe(-1);
  });
});
