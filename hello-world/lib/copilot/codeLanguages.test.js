// node (this repo's default environment). `lib/copilot/codeLanguages.js` is
// pure and imports nothing, which is the whole reason it exists as its own
// module: it is CLIENT-REACHABLE (51 non-test files under `app/copilot/`
// import from `lib/copilot/`), so keeping the vocabularies here is what keeps the
// resolver's system instruction — and its `console.info` — out of the browser
// bundle. See plan §A.1's CONF-12 note.
//
// Written BEFORE the implementation exists (step 4b): every case fails on the
// missing `./codeLanguages.js` module until wave 0 lands.
//
// THE THING THIS FILE IS ACTUALLY FOR: §0.7d names THREE different sets, and
// revision 5 of the criteria called all three "AC-C1's list". They are not the
// same set, and the collapse is silent —
//
//   * the RESOLVER OUTPUT set (7 capitalised languages + `none`) is what the
//     validator admits. It contains no `auto` and no `Pseudocode`: a resolver
//     returning "Auto" would otherwise put "the language resolved for this
//     application is Auto" into the answer prompt (AC-C8's own Fails if).
//   * the CONTROL OPTION set (9 lowercase slugs) is what the user picks and
//     what is stored, sent and keyed on.
//   * the RESPONSE REFERENCE list is a CONTRAST, never a restriction — a
//     question naming Rust must be able to yield a Rust label (AC-C19/D22),
//     which is why `normalizeLanguageToken` deliberately does not check
//     membership at all.
//
// And the bridge between the first two: **a slug reaching a prompt is a
// defect** (§B.1). `codeLanguageLabel` is the only crossing, and the one row
// where it is easiest to get wrong is `pseudocode` — slug and label differ
// only by case there.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  AUTO,
  NONE,
  PSEUDOCODE,
  RESOLVER_LANGUAGES,
  CONTROL_OPTIONS,
  normalizeCodeLanguageChoice,
  codeLanguageLabel,
  normalizeLanguageToken,
} from "./codeLanguages.js";

const SOURCE = readFileSync(fileURLToPath(new URL("./codeLanguages.js", import.meta.url)), "utf8");

// §B.1's table, restated here as data so every case below reads off one place.
const CONTROL_VALUES = [
  "auto",
  "python",
  "javascript",
  "typescript",
  "java",
  "csharp",
  "go",
  "sql",
  "pseudocode",
];

const CONTROL_LABELS = [
  "Auto",
  "Python",
  "JavaScript",
  "TypeScript",
  "Java",
  "C#",
  "Go",
  "SQL",
  "Pseudocode",
];

describe("the three sentinels (AC-C24b, AC-C28c)", () => {
  it("encodes Auto as the literal token `auto`, never as the empty string", () => {
    // AC-C24b. The empty encoding propagates through four other criteria — it
    // is what makes AC-C5's MUI label-shrink hazard exist at all
    // (`isFilled("")` is false), and it is what would let an omitted request
    // field and an explicit "no preference" compare equal in the cache key.
    expect(AUTO).toBe("auto");
  });

  it("spells the resolver's abstain value `none`, distinct from both other sentinels", () => {
    expect(NONE).toBe("none");
    expect(NONE).not.toBe(AUTO);
    expect(NONE).not.toBe(PSEUDOCODE);
  });

  it("spells the pseudocode value `pseudocode` — one string doing two jobs, deliberately", () => {
    // §B.1's last rule: `pseudocode` is simultaneously a control value and the
    // response token, which is what makes AC-C28c a no-op on that branch.
    expect(PSEUDOCODE).toBe("pseudocode");
  });
});

describe("RESOLVER_LANGUAGES — the resolver's output set (§0.7d)", () => {
  it("is exactly the seven capitalised members, in AC-C1's order", () => {
    // The order is load-bearing beyond tidiness: §B.9.2's "Allowed answers"
    // line is generated from this array, so a reordering silently rewrites the
    // resolver's prompt.
    expect(RESOLVER_LANGUAGES).toEqual([
      "Python",
      "JavaScript",
      "TypeScript",
      "Java",
      "C#",
      "Go",
      "SQL",
    ]);
  });

  it("contains neither sentinel and no Pseudocode — the collapse AC-C8's Fails if names", () => {
    expect(RESOLVER_LANGUAGES).not.toContain(AUTO);
    expect(RESOLVER_LANGUAGES).not.toContain("Auto");
    expect(RESOLVER_LANGUAGES).not.toContain(NONE);
    expect(RESOLVER_LANGUAGES).not.toContain(PSEUDOCODE);
    expect(RESOLVER_LANGUAGES).not.toContain("Pseudocode");
  });

  it("is a DIFFERENT set from the control's — capitalised, seven long, no slugs", () => {
    // D-18: the data-flow lane had `peekCodeLanguage` returning "python". The
    // lowercase forms are the CONTROL's values; no lane said they were two
    // vocabularies, which is exactly how one gets substituted for the other.
    for (const token of RESOLVER_LANGUAGES) {
      expect(CONTROL_VALUES).not.toContain(token);
    }
  });
});

describe("CONTROL_OPTIONS — what the user can pick (AC-C1)", () => {
  it("offers exactly nine options, in AC-C1's stated order", () => {
    expect(CONTROL_OPTIONS.map((o) => o.value)).toEqual(CONTROL_VALUES);
    expect(CONTROL_OPTIONS.map((o) => o.label)).toEqual(CONTROL_LABELS);
  });

  it("stores C# as `csharp`, with no `#` in a localStorage value or a JSON body field", () => {
    const csharp = CONTROL_OPTIONS.find((o) => o.label === "C#");
    expect(csharp).toBeTruthy();
    expect(csharp.value).toBe("csharp");
    for (const option of CONTROL_OPTIONS) {
      expect(option.value).not.toMatch(/#/);
      expect(option.value).toBe(option.value.toLowerCase());
    }
  });

  it("has `auto` first and defaultable, and `pseudocode` present as a real preference", () => {
    // §0.7d: Pseudocode is in the CONTROL set (a user may deliberately choose
    // it) and out of the RESOLVER's (a resolver claiming the employer's stack
    // is pseudocode is meaningless — abstention is what it means).
    expect(CONTROL_OPTIONS[0].value).toBe(AUTO);
    expect(CONTROL_OPTIONS.map((o) => o.value)).toContain(PSEUDOCODE);
    expect(CONTROL_OPTIONS.map((o) => o.value)).not.toContain(NONE);
  });
});

describe("normalizeCodeLanguageChoice — the CONTROL normalizer (AC-C4, A19)", () => {
  it("round-trips every control value unchanged", () => {
    for (const value of CONTROL_VALUES) {
      expect(normalizeCodeLanguageChoice(value)).toBe(value);
    }
  });

  it("folds anything outside the vocabulary to `auto`, and never throws", () => {
    // AC-C4: "reads back as Auto for anything outside the vocabulary". The
    // non-string inputs are the ones that matter — this function is handed a
    // raw `localStorage.getItem` result (which is `null` on a miss) and a raw
    // JSON body field on the route.
    const rejects = ["retired-language", "", "  ", "Rust", null, undefined, 42, {}, [], true];
    for (const value of rejects) {
      expect(() => normalizeCodeLanguageChoice(value)).not.toThrow();
      expect(normalizeCodeLanguageChoice(value)).toBe(AUTO);
    }
  });

  it("does NOT admit a resolver token — the two vocabularies stay separate", () => {
    // A "Python" arriving here means a resolver token has been routed through
    // the control path, which is the D-18 confusion. It reads back as `auto`
    // rather than being quietly accepted as a preference the user never set.
    expect(normalizeCodeLanguageChoice("Python")).toBe(AUTO);
  });
});

describe("codeLanguageLabel — the ONLY bridge from slug to prose (§B.1)", () => {
  it("maps every control value to its AC-C1 label", () => {
    CONTROL_VALUES.forEach((value, index) => {
      expect(codeLanguageLabel(value)).toBe(CONTROL_LABELS[index]);
    });
  });

  it("returns `C#` for `csharp` — the row a slug in a prompt is most visible on", () => {
    // §B.1: "The candidate has said they want csharp." is wrong output, and
    // A-12 asserts against it directly at the prompt.
    expect(codeLanguageLabel("csharp")).toBe("C#");
    expect(codeLanguageLabel("csharp")).not.toBe("csharp");
  });

  it("returns the CAPITALISED `Pseudocode` for `pseudocode` — the row revision 3 got wrong", () => {
    // The check's MATERIAL-2. Slug and label differ only by case here, which
    // is the hardest kind of mismatch to notice by eye, and the rule is
    // ALWAYS: the prompt emits the label.
    expect(codeLanguageLabel(PSEUDOCODE)).toBe("Pseudocode");
    expect(codeLanguageLabel(PSEUDOCODE)).not.toBe(PSEUDOCODE);
  });
});

describe("normalizeLanguageToken — SHAPE validation, never membership (AC-C19, D22, §B.2)", () => {
  it("admits a well-formed token that is NOT in any of the three sets", () => {
    // The whole point of D22: the response reference list is a contrast, not a
    // restriction. A question naming Rust must yield a Rust label, or the
    // label lies about a legitimate Rust body.
    expect(normalizeLanguageToken("Rust")).toBe("Rust");
    expect(normalizeLanguageToken("Kotlin")).toBe("Kotlin");
    expect(normalizeLanguageToken("C++")).toBe("C++");
  });

  it("trims, and measures its bounds after trimming", () => {
    expect(normalizeLanguageToken("  Python  ")).toBe("Python");
  });

  it("admits exactly 24 characters and rejects 25", () => {
    const twentyFour = "a".repeat(24);
    const twentyFive = "a".repeat(25);
    expect(normalizeLanguageToken(twentyFour)).toBe(twentyFour);
    expect(normalizeLanguageToken(twentyFive)).toBe(PSEUDOCODE);
  });

  it("rejects a sentence — the failure D22 names, `whatever the candidate prefers`", () => {
    // Passed through unvalidated, that string renders on the block as if it
    // were a language.
    expect(normalizeLanguageToken("whatever the candidate prefers")).toBe(PSEUDOCODE);
  });

  it("rejects anything outside the charset, including a newline", () => {
    for (const bad of ["Java\nScript", "Go!", "C/C++", "Py<thon>", "语言"]) {
      expect(normalizeLanguageToken(bad)).toBe(PSEUDOCODE);
    }
  });

  it("admits a single interior space but rejects a whitespace RUN", () => {
    expect(normalizeLanguageToken("Objective C")).toBe("Objective C");
    expect(normalizeLanguageToken("Objective  C")).toBe(PSEUDOCODE);
    expect(normalizeLanguageToken("Objective\tC")).toBe(PSEUDOCODE);
  });

  it("folds both internal sentinels to `pseudocode`, case-insensitively (AC-C28c)", () => {
    // AC-C28c: neither sentinel may reach the block label. They are internal
    // values with no user-facing meaning, and the user-facing fact in both
    // cases is the same one.
    for (const sentinel of ["auto", "Auto", "AUTO", "none", "None", "NONE"]) {
      expect(normalizeLanguageToken(sentinel)).toBe(PSEUDOCODE);
    }
  });

  it("renders an ABSTENTION and a user-chosen Pseudocode the same way (AC-C28c)", () => {
    // AC-C28c: `code.language` renders identically whether the resolver
    // abstained or the user chose Pseudocode, and **neither renders as `none`
    // or `auto`**. Asserted case-insensitively on purpose: §B.2 does not check
    // membership, so a well-formed `"Pseudocode"` is admitted verbatim — which
    // is fine, because the user-facing fact is the same one either way. What
    // must never happen is an internal sentinel reaching the block label.
    for (const input of ["pseudocode", "Pseudocode", "PSEUDOCODE", "auto", "none"]) {
      const rendered = normalizeLanguageToken(input);
      expect(rendered.toLowerCase()).toBe(PSEUDOCODE);
      expect(rendered).not.toBe(NONE);
      expect(rendered).not.toBe(AUTO);
    }
  });

  it("folds empty, blank and unstringifiable input to `pseudocode`, and never throws", () => {
    // Deliberately NOT asserting anything about a NUMBER. §B.2's rule is
    // `String(v ?? "").trim()` followed by a charset check, under which `42`
    // stringifies to a well-formed token and is admitted — which is correct
    // for a SHAPE validator and would be wrong to pin either way here.
    for (const bad of ["", "   ", null, undefined, {}, []]) {
      expect(() => normalizeLanguageToken(bad)).not.toThrow();
      expect(normalizeLanguageToken(bad)).toBe(PSEUDOCODE);
    }
  });
});

describe("this module is CLIENT-REACHABLE, and that is what the split is for (AC-C28b)", () => {
  // THE ARGUMENT THIS BLOCK TURNS INTO AN ASSERTION. The three-module
  // decomposition (CONF-12) exists for one structural reason: `lib/copilot/`
  // is a SHARED client/server directory — 51 non-test files under
  // `app/copilot/` import from it — and `CodeLanguagePicker` imports THIS file. So whatever
  // this module pulls in, the browser bundle pulls in.
  //
  // **There is no `server-only` package in this repo**, so importing the
  // Gemini client is NOT a bundling barrier — nothing would fail the build,
  // nothing would fail the suite, and the only thing keeping the resolver's
  // system instruction and the user's posting text out of the browser is
  // where the code lives. That makes the placement a testable property, not a
  // convention, and it is asserted here rather than only argued in a header.

  it("imports nothing at all", () => {
    // A-1: "zero imports". An allow-list would be the weaker form — the
    // module genuinely needs nothing, and every import is a bundling decision.
    expect(SOURCE).not.toMatch(/^\s*import\s/m);
    expect(SOURCE).not.toMatch(/\brequire\s*\(/);
    // And specifically not the two things that would carry the server in.
    expect(SOURCE).not.toContain("geminiClient");
    expect(SOURCE).not.toContain("CODE_LANGUAGE_SYSTEM");
  });

  it("logs nothing — ANY console method, not just console.info", () => {
    // The same line in this module rather than in `answerCodeLanguage.js`
    // would print the user's own posting text into their devtools console,
    // and nothing in the test suite would otherwise catch it. Scoped to
    // `console.` rather than to `console.info` because `warn`/`log`/`error`
    // leak exactly as much and are invisible to any spy set on one method.
    expect(SOURCE).not.toMatch(/\bconsole\s*\./);
  });
});
