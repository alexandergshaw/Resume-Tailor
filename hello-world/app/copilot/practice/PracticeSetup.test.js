// node (this repo's default environment) — a SOURCE-TEXT test, the same tool
// and the same size as `app/copilot/SessionSetup.test.js` next door, and for
// the same reason: a real render of a setup surface drags in `PostingPicker`'s
// network calls, and what needs pinning here is placement and prop threading,
// not rendered output. The gate's BEHAVIOUR lives in
// `app/copilot/CodeLanguageField.test.js`, which renders the real thing.
//
// Written BEFORE the implementation exists (step 4b), and confirmed absent
// before it was written: `PracticeSetup.js` has no test file at all today, so
// every case here fails until wave 3 lands.
//
// THE INVARIANT THIS FILE PROTECTS, which is easy to break by accident:
// `PracticeSetup.js:12-18` declares the component purely presentational, and
// it calls ZERO hooks today. So does `SessionSetup.js`. The render gate, the
// interview-type subscription and F-C2's focus deferral all belong in
// `CodeLanguageField` — this surface gains ONE ELEMENT and no hooks. An
// implementer who reaches for a subscription here inverts a stated, currently
// true invariant in two files at once.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./PracticeSetup.js", import.meta.url)), "utf8");

const stripLineComments = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const CODE = stripLineComments(SOURCE);

describe("PracticeSetup takes the code-language props it must thread (§B.8, F-C1)", () => {
  it("destructures codeLanguage, onCodeLanguageChange and isEmbedded", () => {
    // `isEmbedded` is the one this surface genuinely lacks today — the live
    // surface already takes it as a prop, practice does not, and the gate
    // cannot render without it.
    expect(CODE).toMatch(/\bcodeLanguage\s*,/);
    expect(CODE).toMatch(/\bonCodeLanguageChange\s*,/);
    expect(CODE).toMatch(/\bisEmbedded\s*,/);
  });

  it("renders CodeLanguageField and passes all four of its props straight through", () => {
    expect(CODE).toMatch(/import CodeLanguageField from "\.\.\/CodeLanguageField"/);
    expect(CODE).toMatch(/<CodeLanguageField[\s\S]{0,240}interviewType=\{interviewType\}/);
    expect(CODE).toMatch(/<CodeLanguageField[\s\S]{0,240}isEmbedded=\{isEmbedded\}/);
    expect(CODE).toMatch(/<CodeLanguageField[\s\S]{0,240}value=\{codeLanguage\}/);
    expect(CODE).toMatch(/<CodeLanguageField[\s\S]{0,240}onChange=\{onCodeLanguageChange\}/);
  });
});

describe("placement: between the interview-type picker and the posting picker (A-34)", () => {
  it("sits between the two existing controls, in that order", () => {
    const typeAt = CODE.indexOf("<InterviewTypePicker");
    const languageAt = CODE.indexOf("<CodeLanguageField");
    const postingAt = CODE.indexOf("<PostingPicker");

    // Each marker must be FOUND before any of them is compared. `indexOf`
    // returns -1 for an element that is not there at all, and -1 is less than
    // everything — so a missing element would otherwise satisfy an ordering
    // assertion rather than failing one.
    expect(typeAt).toBeGreaterThan(-1);
    expect(languageAt).toBeGreaterThan(-1);
    expect(postingAt).toBeGreaterThan(-1);

    // The whole sequence, asserted as a sequence.
    const found = [typeAt, languageAt, postingAt];
    expect([...found].sort((a, b) => a - b)).toEqual(found);
  });

  it("does not edit the existing InterviewTypePicker element", () => {
    // Inserting BETWEEN preserves the shipped JSX; editing either neighbour is
    // what breaks a pinned assertion elsewhere. §C's rule for both setup
    // surfaces: "no existing line is edited".
    expect(CODE).toMatch(
      /<InterviewTypePicker\s+value=\{interviewType\}\s+onChange=\{onInterviewTypeChange\}\s+disabled=\{false\}\s*\/>/,
    );
  });
});

describe("PracticeSetup stays hook-free (prohibition 33)", () => {
  it("calls no hook at all", () => {
    // Both this file's header and `SessionSetup.js:24-26` say so ("no hooks,
    // no handlers, no derived values here — every value below arrives exactly
    // as it was computed in PracticeClient"), and both are true today. If a
    // task appears to need a hook here, it belongs in `CodeLanguageField`.
    expect(CODE).not.toMatch(/\buse[A-Z]\w*\s*\(/);
  });

  it("adds no gate of its own — the field owns the render decision (CONF-6)", () => {
    // A conditional here would be a SECOND code-bearing predicate, which is
    // exactly the duplicate list D4 removed.
    expect(CODE).not.toMatch(/isCodeBearingInterviewType/);
    expect(CODE).not.toMatch(/["']system-design["']/);
  });

  it("does not convert either picker to a native <select>", () => {
    expect(CODE).not.toMatch(/<select[\s>]/);
    expect(CODE).not.toMatch(/native:\s*true/);
  });
});
