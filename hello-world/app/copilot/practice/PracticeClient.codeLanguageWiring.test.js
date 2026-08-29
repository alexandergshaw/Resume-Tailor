// node (this repo's default environment) — a SOURCE-TEXT test, deliberately,
// and for exactly the reason `PracticeClient.interviewTypeWiring.test.js`
// gives for its own: `PracticeClient` cannot be rendered under test (its own
// comment says so), so extracting the duty into a hook module makes the DUTY
// testable and proves nothing about whether anyone calls it. **A correct
// helper that is never wired is this repo's most common way to finish green
// and broken.**
//
// Written BEFORE the implementation exists (step 4b): every case fails against
// today's `PracticeClient.js`, which knows nothing about a code language.
//
// TWO CONSTRAINTS ON THIS FILE ITSELF, inherited from the chunk-A instance and
// binding on whoever edits it next:
//   1. It must assert the CALLER calls it, not merely that the import exists.
//   2. When a property later moves to another module, AMEND these assertions
//      to name the module that now holds it. A module must never be left
//      carrying dead code to keep a source-text test green.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { needsRedraft, cachedSampleAnswerFor } from "@/lib/copilot/sampleAnswerState";

const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");
const RAW = readSource("./PracticeClient.js");

// Line comments only — enough that prose naming a thing cannot satisfy or fail
// an assertion about the code that names it.
const stripLineComments = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const CLIENT = stripLineComments(RAW);

// The full call expression starting at `marker`, by BALANCING brackets.
//
// Slicing to the first `)` is the trap this helper exists to avoid, and it has
// already bitten once in this directory: in `usePracticeQuestions({ posting,
// onRequestFailed: () => {}, interviewType })` the first `)` is the one inside
// `() => {}`, so a naive slice ends before the argument under test is reached
// and the assertion is vacuously green.
function callExpression(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

// The comma-separated ARGUMENTS of a call expression, split only at depth 0 —
// so an object literal, an array, an arrow function or a nested call counts as
// ONE argument however many commas it contains. This is what makes "the fifth
// positional argument" a checkable claim rather than a guess.
function argumentsOf(call) {
  if (call === null) return null;
  const open = call.indexOf("(");
  const body = call.slice(open + 1, call.length - 1);
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// The opening tag of a JSX element, `{}`-balanced so an attribute value
// containing `>` cannot end it early.
function jsxOpeningTag(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

describe("PracticeClient WIRES the language hook (AC-A13b's rule, applied to chunk C)", () => {
  it("imports the hook module", () => {
    expect(CLIENT).toMatch(
      /import\s*\{[^}]*\busePracticeCodeLanguage\b[^}]*\}\s*from\s*["']\.\/usePracticeCodeLanguage(?:\.js)?["']/,
    );
  });

  it("actually CALLS it — an import alone ships the feature inert", () => {
    expect(CLIENT).toMatch(/\busePracticeCodeLanguage\s*\(/);
  });

  it("hands it the room-draft invalidator, which is the only duty it has", () => {
    // Omitting the callback from the bag is the same defect class as wiring
    // the hook to the wrong trigger: the hook is correct, the duty silently
    // never runs, and every pure test of the hook stays green.
    const call = callExpression(CLIENT, "usePracticeCodeLanguage(");
    expect(call).not.toBe(null);
    expect(call).toMatch(/\binvalidateRoomDrafts\b/);
    expect(call).toMatch(/roomQuestions\s*\.\s*invalidateDrafts\b/);
  });

  it("does NOT subscribe to the change itself — the container holds no duty list", () => {
    // D-1: `PracticeClient.interviewTypeWiring.test.js:199-206` is a
    // source-text test asserting this file names neither `discardAnswerWork`
    // nor `discardDraftedAnswers`, and it names them "chunk C's seams". Both
    // stay green AND STAY TRUE because the duty lives in the hook module. A
    // negative kept green by relocating the call would be the wrong fix;
    // keeping it TRUE is the point.
    expect(CLIENT).not.toMatch(/\buseCodeLanguageChange\s*\(/);
    expect(CLIENT).not.toMatch(/\bdiscardDraftedAnswers\s*\(/);
  });
});

describe("the language reaches the sample-answer path (AC-C24, AC-C25, AC-C27)", () => {
  it("passes it into useSampleAnswer's argument object", () => {
    const call = callExpression(CLIENT, "useSampleAnswer(");
    expect(call).not.toBe(null);
    expect(call).toMatch(/\bcodeLanguage\b/);
  });

  it("passes it as the FIFTH positional argument to queue (AC-C27c's ordering rule)", () => {
    // Positional, and the position is load-bearing: `needsRedraft`'s new
    // parameter goes BEFORE its trailing `force = false`, and appending after
    // it would silently shift the argument the call site already passes —
    // `force` becomes a truthy string and every reveal pays a fresh model call
    // forever. The queue call is the surface where that ordering is visible.
    const args = argumentsOf(callExpression(CLIENT, "sampleAnswer.queue("));
    expect(args).not.toBe(null);
    expect(args).toHaveLength(5);
    expect(args[4]).toMatch(/codeLanguage/);
  });

  it("lists it in the queue effect's dependency array", () => {
    // Without it the effect never re-runs on a language change, and the queued
    // draft stays in the old language until something unrelated moves.
    const effects = [];
    let from = 0;
    for (;;) {
      const at = CLIENT.indexOf("useEffect(", from);
      if (at === -1) break;
      const call = callExpression(CLIENT.slice(at), "useEffect(");
      effects.push(call);
      from = at + 1;
    }
    const queueEffect = effects.find((body) => body.includes("sampleAnswer.queue("));
    expect(queueEffect, "no useEffect calls sampleAnswer.queue").toBeTruthy();

    const args = argumentsOf(queueEffect);
    expect(args.length).toBeGreaterThanOrEqual(2);
    const deps = args[args.length - 1];
    expect(deps.startsWith("[")).toBe(true);
    expect(deps).toMatch(/\bcodeLanguage\b/);
  });
});

describe("the language reaches the setup surface (AC-C1, AC-C2b, §B.8)", () => {
  it("threads the value, the change callback and isEmbedded into PracticeSetup", () => {
    // `PracticeSetup` takes no `isEmbedded` today (F-C1) and `PracticeClient`
    // passes none — the gate cannot render without it.
    //
    // THE IDENTIFIER INSIDE THE BRACES, not merely the prop name. `toMatch(/\bisEmbedded=\{/)`
    // is satisfied by `isEmbedded={false}` — at which point AC-C2b is dead on
    // the practice tab and the control ships VISIBLE on the embedded engine,
    // while `CodeLanguageField.test.js` proves the gate given a correct prop
    // and `PracticeSetup.test.js` proves the prop is threaded by name. Nothing
    // joined the three. Same hole for the value and the callback: a literal
    // `codeLanguage={"auto"}` renders a control that can never move.
    //
    // Written the way this file already asserts `roomQuestions.invalidateDrafts`
    // two describes earlier.
    const tag = jsxOpeningTag(CLIENT, "<PracticeSetup");
    expect(tag).not.toBe(null);
    expect(tag).toMatch(/\bcodeLanguage=\{\s*[A-Za-z_$][\w$]*\s*\}/);
    expect(tag).toMatch(/\bonCodeLanguageChange=\{\s*[A-Za-z_$][\w$]*\s*\}/);
    expect(tag).toMatch(/\bisEmbedded=\{\s*isEmbedded\s*\}/);
    // And explicitly not the literals that satisfy a name-only check.
    expect(tag).not.toMatch(/\bisEmbedded=\{\s*(?:true|false)\s*\}/);
    expect(tag).not.toMatch(/\bcodeLanguage=\{\s*["']/);
  });

  it("hands useSampleAnswer the language by identifier, not a literal", () => {
    const call = callExpression(CLIENT, "useSampleAnswer(");
    expect(call).not.toBe(null);
    expect(call).toMatch(/\bcodeLanguage\s*(?:,|\}|:\s*[A-Za-z_$][\w$]*)/);
    expect(call).not.toMatch(/codeLanguage\s*:\s*["']/);
  });
});

// ---------------------------------------------------------------------------
// AC-C27 / AC-C27c — the practice reveal path's cache contract.
//
// WHY HERE. `sampleAnswerState.js`'s own suite (A-16) is an EXISTING file this
// author may not modify, and measured, AC-C27 and AC-C27c otherwise have no
// assertion anywhere: the only related check in the tree is a source-text
// presence check on `useSampleAnswer(`'s call expression. This file already
// owns the fifth-positional-argument claim at the CALL site
// (`sampleAnswer.queue(`), and this is the same contract read from the other
// end — the signature that call depends on. A-16 must still carry its own.
describe("needsRedraft and cachedSampleAnswerFor carry the language (AC-C27, AC-C27c)", () => {
  const QUESTION = "Implement a cache that evicts the least recently used entry.";
  const PROFILE = "Senior engineer, dispatch and logistics.";

  // `needsRedraft(active, profile, interviewType, applicationId, codeLanguage, force = false)`
  const active = {
    status: "done",
    profile: PROFILE,
    interviewType: "technical",
    applicationId: "app-1",
    codeLanguage: "auto",
  };

  it("redrafts when the language differs, and does not when it matches", () => {
    // AC-C27's own Fails if: "only one does". `sampleAnswerState.js:129-143`
    // records that the duplication between these two functions is deliberate,
    // and that its own suite drives both off one table and asserts they agree
    // — which is exactly why a field added to one and not the other is silent.
    expect(needsRedraft(active, PROFILE, "technical", "app-1", "java")).toBe(true);
    expect(needsRedraft(active, PROFILE, "technical", "app-1", "auto")).toBe(false);
  });

  it("puts the language BEFORE `force`, not after it (AC-C27c's named failure)", () => {
    // The case the ordering rule exists for, and the only one that can see the
    // mistake. Appended AFTER `force`, the language lands in the `force` slot
    // — `"auto"` is a truthy string — so **every reveal pays a fresh model
    // call forever**, silently, while a differing-language check still
    // "passes" by always returning true.
    //
    // Correct order: false. Transposed: the language occupies `force`, and it
    // is true.
    expect(needsRedraft(active, PROFILE, "technical", "app-1", "auto", false)).toBe(false);

    // The positive control — `force` still forces, so the sixth slot really is
    // `force` and not an argument this case is ignoring.
    expect(needsRedraft(active, PROFILE, "technical", "app-1", "auto", true)).toBe(true);
  });

  it("still redrafts on a changed profile, type or posting — the other three survive", () => {
    expect(needsRedraft(active, "different prep notes", "technical", "app-1", "auto")).toBe(true);
    expect(needsRedraft(active, PROFILE, "behavioral", "app-1", "auto")).toBe(true);
    expect(needsRedraft(active, PROFILE, "technical", "app-2", "auto")).toBe(true);
  });

  it("cachedSampleAnswerFor misses on a different language and hits on the same one", () => {
    // `cachedSampleAnswerFor(entry, question, profile, interviewType, applicationId, codeLanguage)`
    // — the sixth argument is positional and, per A-15, deliberately NOT
    // defaulted.
    const entry = {
      points: ["Name the constraint first."],
      profile: PROFILE,
      interviewType: "technical",
      applicationId: "app-1",
      codeLanguage: "auto",
    };
    expect(cachedSampleAnswerFor(entry, QUESTION, PROFILE, "technical", "app-1", "auto")).toBeTruthy();
    expect(cachedSampleAnswerFor(entry, QUESTION, PROFILE, "technical", "app-1", "java")).toBeFalsy();
  });

  it("treats an OMITTED sixth argument as a MISS, never as a false hit", () => {
    // Undefaulted deliberately: an omitted argument folds to `""` through
    // `normalizeField` and is a miss, which is the fail-safe direction. A
    // default of `"auto"` would make a caller that forgot the field HIT a
    // genuine `auto` entry — serving an answer drafted under an explicit
    // language as the Auto answer, which is the stale-serve CONF-2 exists to
    // prevent (reconciliation A18's whole subject, one function over).
    const entry = {
      points: ["Name the constraint first."],
      profile: PROFILE,
      interviewType: "technical",
      applicationId: "app-1",
      codeLanguage: "auto",
    };
    expect(cachedSampleAnswerFor(entry, QUESTION, PROFILE, "technical", "app-1")).toBeFalsy();
  });
});

describe("the staleness caption is NOT prepared for here (D-7, prohibitions 23 and 28)", () => {
  it("introduces no staleChangeNote and no second staleTypeChangeAt writer", () => {
    // Chunk C emits no code, so a caption reading "drafted before the code
    // language changed" would point at a difference that does not exist on
    // screen — a claim about something the app cannot yet do. The visible mark
    // and its wording are chunk B's, and asserting their absence HERE is what
    // stops them being added early.
    //
    // Asserted over the RAW source, comments included: "do not prepare for it
    // by threading a prop nothing sets" covers a commented-out prop just as
    // much as a live one.
    expect(RAW).not.toContain("staleChangeNote");
    expect(RAW).not.toContain("staleTypeChangeAt");
  });
});
