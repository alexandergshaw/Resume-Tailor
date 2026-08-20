// AC-Q7 - the deterministic model answer for the "Speak as" drill.
//
// The sweep over every role and every bank situation is the real gate here.
// Two properties it enforces are the difference between a drill that teaches a
// register and one that merely claims to:
//
//   1. Every line is a complete sentence a person could actually SAY. Cue
//      fragments and bracketed placeholders are what this codebase already
//      shipped once and had to rewrite (see sampleAnswerLocal.js's history).
//   2. `termsUsed` is COMPUTED from the answer's own text, never asserted, and
//      at least two of the role's terms of art really appear in it. This test
//      recomputes it independently rather than trusting the returned array -
//      a hand-built expectation of what the code "should" have found would
//      pass against a function that returns its input.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_VALUES, roleRegister } from "./roleRegisters.js";
import { situationsFor } from "./roleSituationBank.js";
import { countWords } from "./answerMetrics.js";
import { roleResponseLocal, termsUsedIn, avoidHitsIn } from "./roleResponse.js";

const SOURCE = readFileSync(new URL("./roleResponse.js", import.meta.url), "utf8");

const cases = ROLE_VALUES.flatMap((role) =>
  situationsFor(role).map((s) => ({ role, situationId: s.id, situationPrompt: s.prompt })),
);

const joined = (lines) => lines.map((l) => l.text).join(" ");

// Independent oracle for AC-Q7.5 - deliberately NOT the module's own helper.
// Returns TERM STRINGS: `termsUsed` is a string[] everywhere it travels (the
// composer, the route, the panel), so there is one type and no `v.term ?? v`
// anywhere in the feature.
function termsPresent(role, lines) {
  const haystack = joined(lines).toLowerCase();
  return roleRegister(role)
    .vocabulary.filter((v) => haystack.includes(v.term.toLowerCase()))
    .map((v) => v.term);
}

describe("roleResponseLocal - every role, every situation", () => {
  it("returns one line per beat label, labelled in the register's order", () => {
    for (const c of cases) {
      const { lines } = roleResponseLocal(c);
      expect(lines.map((l) => l.label), c.situationId).toEqual(roleRegister(c.role).beatLabels);
    }
  });

  it("returns lines a person could speak aloud", () => {
    const failures = [];
    for (const c of cases) {
      for (const line of roleResponseLocal(c).lines) {
        const t = line.text.trim();
        if (t.length < 25) failures.push(`${c.situationId}: too short - ${t}`);
        if (!/^["“']?[A-Z0-9]/.test(t)) failures.push(`${c.situationId}: no capital - ${t}`);
        if (!/[.?!]["”']?$/.test(t)) failures.push(`${c.situationId}: unterminated - ${t}`);
        if (/[[\]{}]|TODO|<[a-z]/i.test(t)) failures.push(`${c.situationId}: placeholder - ${t}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("lands inside a spoken answer's length, never an essay", () => {
    const failures = [];
    for (const c of cases) {
      const words = countWords(joined(roleResponseLocal(c).lines));
      if (words < 70 || words > 190) failures.push(`${c.situationId}: ${words} words`);
    }
    expect(failures).toEqual([]);
  });

  it("actually uses at least two of the role's terms of art", () => {
    const failures = [];
    for (const c of cases) {
      const { lines, termsUsed } = roleResponseLocal(c);
      const present = termsPresent(c.role, lines);
      if (present.length < 2) failures.push(`${c.situationId}: ${present.length} present`);
      // The returned list must match what is really in the text - not a
      // superset the panel would then be lying about - and must be plain
      // strings, the one shape this feature carries end to end.
      expect([...termsUsed].sort(), c.situationId).toEqual([...present].sort());
      for (const entry of termsUsed) expect(typeof entry, c.situationId).toBe("string");
    }
    expect(failures).toEqual([]);
  });

  it("never speaks a phrase from its own do-not-say list", () => {
    // The panel prints these under "Do not say" directly beneath the answer.
    // An answer containing one teaches the opposite of the register it is
    // demonstrating.
    const failures = [];
    for (const c of cases) {
      const hits = avoidHitsIn(c.role, roleResponseLocal(c).lines);
      if (hits.length) failures.push(`${c.situationId}: ${hits.join(", ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("carries the register's own cadence, terms and avoid lists unchanged", () => {
    for (const c of cases) {
      const register = roleRegister(c.role);
      const got = roleResponseLocal(c);
      expect(got.cadence).toEqual(register.cadence);
      expect(got.terms).toEqual(register.vocabulary);
      expect(got.avoid).toEqual(register.avoid);
    }
  });

  it("hands out copies, so a consumer cannot poison the registry", () => {
    const before = [...roleRegister("manager").cadence];
    const got = roleResponseLocal(cases.find((c) => c.role === "manager"));
    got.cadence.push("mutated by a consumer");
    got.terms.length = 0;
    got.avoid.length = 0;
    expect(roleRegister("manager").cadence).toEqual(before);
    expect(roleRegister("manager").vocabulary.length).toBeGreaterThan(0);
    expect(roleRegister("manager").avoid.length).toBeGreaterThan(0);
  });

  it("is deterministic and varies with the situation", () => {
    for (const c of cases) {
      expect(roleResponseLocal(c)).toEqual(roleResponseLocal(c));
    }
    // Different situations for one role must not produce identical text -
    // otherwise the beats are being ignored and the drill answers everything
    // the same way.
    for (const role of ROLE_VALUES) {
      const texts = situationsFor(role).map((s) =>
        joined(roleResponseLocal({ role, situationId: s.id, situationPrompt: s.prompt }).lines),
      );
      expect(new Set(texts).size, role).toBe(texts.length);
    }
  });
});

describe("roleResponseLocal - one lead-in per line, never two", () => {
  // Some authored beats open themselves ("Let me tell you the assessment
  // plainly:", "I'll own this one myself"). Prepending a connector to those
  // produces "Here's where things stand, let me tell you the assessment
  // plainly: ..." - two run-ups to the same sentence, which is exactly what
  // a person rehearsing cadence must not be shown. A beat that already
  // opens itself is spoken as written.
  const SELF_OPENING = /^(I\b|I'm\b|I'll\b|My\b|We\b|We're\b|We'll\b|Let me\b|Here's\b)/i;

  function check(role, beats, lines, label) {
    const failures = [];
    beats.forEach((beat, i) => {
      if (!SELF_OPENING.test(beat.trim())) return;
      if (lines[i].text.trim() !== beat.trim()) {
        failures.push(`${label}[${i}]: ${lines[i].text}`);
      }
    });
    return failures;
  }

  it("speaks a self-opening bank beat as written", () => {
    const failures = [];
    for (const role of ROLE_VALUES) {
      for (const s of situationsFor(role)) {
        const got = roleResponseLocal({ role, situationId: s.id, situationPrompt: s.prompt });
        failures.push(...check(role, s.beats, got.lines, s.id));
      }
    }
    expect(failures).toEqual([]);
  });

  it("speaks a self-opening fallback beat as written", () => {
    const failures = [];
    for (const role of ROLE_VALUES) {
      const got = roleResponseLocal({
        role,
        situationId: "generated-12345",
        situationPrompt: "A stakeholder asks you, on the spot, why the number moved.",
      });
      failures.push(...check(role, roleRegister(role).fallbackBeats, got.lines, role));
    }
    expect(failures).toEqual([]);
  });

  it("opens on the beat itself, with no connector on the first line", () => {
    // Every register's FIRST cadence rule is a lead-with rule - "open with
    // the headline fact before any softening", "lead with the number in the
    // first breath", "state the assessment plainly before the caveats" - and
    // the panel prints it three lines under the answer. An opener like
    // "First, here's what's actually going on:" in front of the first beat
    // models the exact opposite of the rule it is teaching.
    const failures = [];
    for (const role of ROLE_VALUES) {
      for (const s of situationsFor(role)) {
        const got = roleResponseLocal({ role, situationId: s.id, situationPrompt: s.prompt });
        if (got.lines[0].text.trim() !== s.beats[0].trim()) {
          failures.push(`${s.id}: ${got.lines[0].text}`);
        }
      }
      const fb = roleResponseLocal({
        role,
        situationId: "generated-12345",
        situationPrompt: "A stakeholder asks you, on the spot, why the number moved.",
      });
      const first = roleRegister(role).fallbackBeats[0].trim();
      if (fb.lines[0].text.trim() !== first) failures.push(`${role} (fallback): ${fb.lines[0].text}`);
    }
    expect(failures).toEqual([]);
  });

  it("speaks a beat that carries its own colon as written", () => {
    // A beat like "What they are asking is real: the deal has been quiet for
    // eleven days" is not self-opening by pronoun, so a connector was
    // prepended and joined with a comma - "Here's where things stand, what
    // they are asking is real: ..." - two run-ups to one sentence, spliced.
    const failures = [];
    for (const role of ROLE_VALUES) {
      for (const s of situationsFor(role)) {
        const got = roleResponseLocal({ role, situationId: s.id, situationPrompt: s.prompt });
        s.beats.forEach((beat, i) => {
          if (beat.slice(0, 60).includes(":") && got.lines[i].text.trim() !== beat.trim()) {
            failures.push(`${s.id}[${i}]: ${got.lines[i].text}`);
          }
        });
      }
    }
    expect(failures).toEqual([]);
  });

  it("never repeats the beat's own opening word in the connector", () => {
    // "Next, the next step is a one-page memo." The closer and the beat say
    // the same thing twice.
    const failures = [];
    for (const role of ROLE_VALUES) {
      for (const s of situationsFor(role)) {
        for (const line of roleResponseLocal({ role, situationId: s.id, situationPrompt: s.prompt }).lines) {
          if (/^(next|going forward|looking ahead|from here)\b[^.]{0,4}\b(the next step|going forward|next)\b/i.test(line.text.trim())) {
            failures.push(`${s.id}: ${line.text}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("can fail: the check rejects a stacked lead-in", () => {
    // Positive control - without it, a sweep that found no self-opening
    // beats at all would report clean having checked nothing.
    const stacked = check("manager", ["Let me be plain: it slipped."], [{ text: "First, let me be plain: it slipped." }], "control");
    expect(stacked.length).toBe(1);
  });
});

describe("roleResponseLocal - the vocabulary comes from the content, never from decoration", () => {
  // The property: a term is marked "used in this answer" only because the
  // authored beat used it. A composer free to weave a term into its own
  // connective tissue produces things like "Let me be clear about the
  // escalate here:" - grammatically broken, and a claim about the answer's
  // vocabulary that the answer's own material does not support.
  const termsIn = (role, text) =>
    roleRegister(role)
      .vocabulary.filter((v) => text.toLowerCase().includes(v.term.toLowerCase()))
      .map((v) => v.term)
      .sort();

  it("adds no term the situation's own beats did not already contain", () => {
    const failures = [];
    for (const role of ROLE_VALUES) {
      for (const s of situationsFor(role)) {
        const got = roleResponseLocal({ role, situationId: s.id, situationPrompt: s.prompt });
        const fromBeats = termsIn(role, s.beats.join(" "));
        const fromAnswer = termsIn(role, joined(got.lines));
        if (JSON.stringify(fromBeats) !== JSON.stringify(fromAnswer)) {
          failures.push(`${s.id}: beats ${fromBeats.join("/")} vs answer ${fromAnswer.join("/")}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("adds no term the fallback beats did not already contain", () => {
    const failures = [];
    for (const role of ROLE_VALUES) {
      const got = roleResponseLocal({
        role,
        situationId: "generated-12345",
        situationPrompt: "A stakeholder asks you, on the spot, why the number moved.",
      });
      const fromBeats = termsIn(role, roleRegister(role).fallbackBeats.join(" "));
      const fromAnswer = termsIn(role, joined(got.lines));
      if (JSON.stringify(fromBeats) !== JSON.stringify(fromAnswer)) {
        failures.push(`${role}: beats ${fromBeats.join("/")} vs answer ${fromAnswer.join("/")}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("roleResponseLocal - the fallback path (a situation not in the bank)", () => {
  it("still answers, from the register's fallback beats", () => {
    for (const role of ROLE_VALUES) {
      const got = roleResponseLocal({
        role,
        situationId: "generated-12345",
        situationPrompt: "A stakeholder asks you, on the spot, why the number moved.",
      });
      expect(got.lines.map((l) => l.label), role).toEqual(roleRegister(role).beatLabels);
      expect(termsPresent(role, got.lines).length, role).toBeGreaterThanOrEqual(1);
      expect(countWords(joined(got.lines)), role).toBeGreaterThanOrEqual(50);
    }
  });

  it("normalizes an unknown role instead of throwing", () => {
    const got = roleResponseLocal({ role: "nonsense", situationId: "nope", situationPrompt: "x" });
    expect(got.lines.length).toBeGreaterThan(0);
  });
});

describe("termsUsedIn", () => {
  it("finds a role's term in the lines, case-insensitively, as a string", () => {
    const term = roleRegister("manager").vocabulary[0].term;
    const lines = [{ label: "L", text: `We agreed an ${term.toUpperCase()} for this.` }];
    expect(termsUsedIn("manager", lines)).toContain(term);
  });

  it("returns nothing when no term is present, and never throws on junk", () => {
    expect(termsUsedIn("manager", [{ label: "L", text: "zzz qqq" }])).toEqual([]);
    expect(termsUsedIn("manager", [])).toEqual([]);
    expect(termsUsedIn("manager", null)).toEqual([]);
    expect(termsUsedIn("nonsense", [{ text: "zzz" }])).toEqual([]);
  });

  it("does not mark a term that is only a substring of a longer word", () => {
    // "board" sits inside "onboarding", "whiteboard" and "aboard"; "scope"
    // inside "telescope". Two accidental hits are also enough to clear the
    // response route's two-term bar, so this is not merely cosmetic - it
    // admits a model answer with no register vocabulary in it at all, and
    // then marks the two accidents as "used in this answer".
    const decoys = {
      board: "We ran a smooth onboarding and put it on the whiteboard.",
      scope: "She looked through the telescope for an hour.",
      engagement: "There was real disengagement in the room.",
    };
    for (const [term, text] of Object.entries(decoys)) {
      const role = ROLE_VALUES.find((r) =>
        roleRegister(r).vocabulary.some((v) => v.term.toLowerCase() === term),
      );
      if (!role) continue;
      expect(termsUsedIn(role, [{ label: "L", text }]), `${role}/${term}`).not.toContain(term);
    }
  });

  it("still marks a term that is genuinely there, next to punctuation", () => {
    // Positive control for the boundary rule above: tightening the match
    // must not stop it finding a real use.
    const term = roleRegister("manager").vocabulary[0].term;
    expect(termsUsedIn("manager", [{ label: "L", text: `We agreed the ${term}.` }])).toContain(term);
    expect(termsUsedIn("manager", [{ label: "L", text: `(${term})` }])).toContain(term);
  });
});

describe("avoidHitsIn", () => {
  it("finds a do-not-say phrase in the lines, case-insensitively", () => {
    const { phrase } = roleRegister("manager").avoid[0];
    const lines = [{ label: "L", text: `Look, ${phrase.toUpperCase()}, and that is that.` }];
    expect(avoidHitsIn("manager", lines)).toContain(phrase);
  });

  it("still catches the phrase when the apostrophe is typographic", () => {
    // 27 of the 40 avoid phrases contain a straight apostrophe, and a model
    // routinely writes the curly one. A raw substring match therefore lets
    // the exact banned sentence through, and the panel then prints it as a
    // model answer with "do not say <that same sentence>" directly beneath.
    const withApostrophe = ROLE_VALUES.flatMap((role) =>
      roleRegister(role).avoid.map((a) => ({ role, phrase: a.phrase })),
    ).filter((a) => a.phrase.includes("'"));
    expect(withApostrophe.length).toBeGreaterThan(5);

    for (const { role, phrase } of withApostrophe) {
      const curly = phrase.split("'").join("’");
      const lines = [{ label: "L", text: `Honestly, ${curly}, and that is where we are.` }];
      expect(avoidHitsIn(role, lines), `${role}: ${curly}`).toContain(phrase);
    }
  });

  it("returns nothing for clean lines, and never throws on junk", () => {
    expect(avoidHitsIn("manager", [{ label: "L", text: "A perfectly ordinary sentence." }])).toEqual([]);
    expect(avoidHitsIn("manager", [])).toEqual([]);
    expect(avoidHitsIn("manager", null)).toEqual([]);
    expect(avoidHitsIn("nonsense", [{ text: "zzz" }])).toEqual([]);
  });
});

describe("roleResponse - purity", () => {
  it("reads no clock and no randomness, and makes no request", () => {
    expect(/Math\.random|Date\.now|fetch\(/.test("const x = Math.random();")).toBe(true);
    expect(SOURCE).not.toMatch(/Math\.random/);
    expect(SOURCE).not.toMatch(/Date\.now|new Date\(/);
    expect(SOURCE).not.toMatch(/\bfetch\(/);
  });

  it("contains no NUL byte", () => {
    expect(readFileSync(new URL("./roleResponse.js", import.meta.url)).indexOf(0)).toBe(-1);
  });
});
