// N161 SC-1 — the codingSolution CONTRACT module (AC-3 response shape, AC-5
// language precedence steps 2-4, AC-7 server-half verbatim code, AC-10 / D6
// embedded fallback). Authored at step 4b and landed RED: the module does not
// exist on HEAD, so this file fails at collection until it is built. The
// discarded reference recorded in tests.r1.md proves every red here is
// satisfiable.
//
// THIS FILE PINS THE FIELD CONTRACT the whole chunk builds to, so SC-2 (client
// plumbing) and SC-3 (render) have a fixed shape to carry and draw:
//
//   codingSolution = { approach: string, language: string, code: string,
//                      complexity: string, edgeCases: string[] }
//
//   normalizeCodingSolution(parsed, { languageFallback })
//     reads parsed.codingSolution; returns the 4-part object (+ language) when
//     approach/code/complexity are non-empty strings and edgeCases coerces to a
//     string[]; otherwise null (so the route degrades to a safe non-coding
//     answer — AC-3 "never a half-built object"). code is returned VERBATIM,
//     never passed through any honesty/derivation transform (AC-7).
//   resolveCodingLanguageLabel(codeLanguage)  — the deterministic steps-2-4
//     label (AC-5), the languageFallback the route hands the normaliser.
//   codingLanguageDirective(codeLanguage)     — the prompt block, non-empty for
//     every input incl. undefined (pseudocode default), gated on NO
//     descriptor.codeBearing (D5).
//   embeddedCodingFallback(type)              — honest marker, NO code (AC-10).

import { describe, it, expect } from "vitest";
import {
  normalizeCodingSolution,
  resolveCodingLanguageLabel,
  codingLanguageDirective,
  embeddedCodingFallback,
} from "./codingSolution.js";

// A conformant model payload — the shape buildPointsPrompt/buildAnswerPrompt's
// coding JSON line asks the model for. Code carries a first-person COMMENT and
// an imperative line on purpose (AC-7): neither may be stripped.
const CONFORMANT = {
  codingSolution: {
    approach: "Walk the list once, reversing each next-pointer in place.",
    language: "Python",
    code: [
      "def reverse(head):",
      "    prev = None",
      "    # I keep two pointers and swap as I go",
      "    while head:",
      "        nxt = head.next",
      "        head.next = prev",
      "        prev = head",
      "        head = nxt",
      "    return prev",
    ].join("\n"),
    complexity: "O(n) time, O(1) space.",
    edgeCases: ["empty list", "single node", "already reversed"],
  },
  type: "technical",
};

describe("normalizeCodingSolution — the four-part shape (AC-3)", () => {
  it("returns all four parts plus the display language for a conformant payload", () => {
    const result = normalizeCodingSolution(CONFORMANT, { languageFallback: "Pseudocode" });
    expect(result).toEqual({
      approach: CONFORMANT.codingSolution.approach,
      language: "Python",
      code: CONFORMANT.codingSolution.code,
      complexity: CONFORMANT.codingSolution.complexity,
      edgeCases: ["empty list", "single node", "already reversed"],
    });
  });

  it("coerces a missing edgeCases to [] — the one part allowed empty (AC-3 / OWNER sub-decision)", () => {
    const parsed = { codingSolution: { ...CONFORMANT.codingSolution, edgeCases: undefined } };
    const result = normalizeCodingSolution(parsed, { languageFallback: "Pseudocode" });
    expect(result).not.toBeNull();
    expect(result.edgeCases).toEqual([]);
  });

  it.each([
    ["approach missing", { ...CONFORMANT.codingSolution, approach: "" }],
    ["code missing", { ...CONFORMANT.codingSolution, code: "" }],
    ["complexity missing", { ...CONFORMANT.codingSolution, complexity: "   " }],
    ["approach not a string", { ...CONFORMANT.codingSolution, approach: 42 }],
    ["code not a string", { ...CONFORMANT.codingSolution, code: null }],
  ])("returns null (safe non-coding degrade) when %s — never a half-built object (AC-3)", (_label, cs) => {
    expect(normalizeCodingSolution({ codingSolution: cs }, { languageFallback: "Pseudocode" })).toBeNull();
  });

  it.each([null, undefined, {}, { codingSolution: null }, "nope", 7])(
    "returns null for a non-conformant top-level payload: %s",
    (parsed) => {
      expect(normalizeCodingSolution(parsed, { languageFallback: "Pseudocode" })).toBeNull();
    },
  );
});

describe("normalizeCodingSolution — code reaches the response VERBATIM (AC-7, server half)", () => {
  it("preserves newlines, indentation, a first-person comment and an imperative line byte-for-byte", () => {
    const result = normalizeCodingSolution(CONFORMANT, { languageFallback: "Pseudocode" });
    // The exact string, unchanged: not space-collapsed (deriveAnswerFromPoints),
    // not sentence-split / first-person-dropped (sanitizeTechTermDetail).
    expect(result.code).toBe(CONFORMANT.codingSolution.code);
    // The two shapes those transforms would mangle, pinned explicitly so a
    // mutant routing code through either one reddens on the specific lines.
    expect(result.code).toContain("# I keep two pointers and swap as I go");
    expect(result.code).toContain("    return prev");
    expect(result.code.split("\n").length).toBe(9);
  });
});

describe("normalizeCodingSolution — language sourcing (AC-5 step 1 model-driven + fallback)", () => {
  it("honours a well-formed model language token verbatim, even out-of-vocabulary (e.g. Rust)", () => {
    const parsed = { codingSolution: { ...CONFORMANT.codingSolution, language: "Rust" } };
    expect(normalizeCodingSolution(parsed, { languageFallback: "Python" }).language).toBe("Rust");
  });

  it("falls back to the deterministic label when the model omits the language", () => {
    const parsed = { codingSolution: { ...CONFORMANT.codingSolution, language: "" } };
    expect(normalizeCodingSolution(parsed, { languageFallback: "Python" }).language).toBe("Python");
  });
});

// AC-5 — the DETERMINISTIC precedence, scoped to steps 2-4 over the
// { override, resolved } object (step 1 is a model-prompt instruction, not a
// unit here). The label is emitted, never the storage slug; pseudocode when
// nothing resolves; INDEPENDENT of descriptor.codeBearing (D5 — this function
// takes no descriptor at all, which is the structural proof).
describe("resolveCodingLanguageLabel — steps 2-4 (AC-5)", () => {
  it("step 2: the candidate's override wins, as a LABEL not a slug", () => {
    expect(resolveCodingLanguageLabel({ override: "java", resolved: null })).toBe("Java");
    // The row where slug and label differ by more than case — never "csharp".
    expect(resolveCodingLanguageLabel({ override: "csharp", resolved: "Python" })).toBe("C#");
  });

  it("step 3: the posting-resolved language when there is no stated override", () => {
    expect(resolveCodingLanguageLabel({ override: "auto", resolved: "Python" })).toBe("Python");
  });

  it("step 4: pseudocode when nothing is set, and when override is pseudocode", () => {
    expect(resolveCodingLanguageLabel({ override: "auto", resolved: null })).toBe("Pseudocode");
    expect(resolveCodingLanguageLabel(undefined)).toBe("Pseudocode");
    // Explicit pseudocode preference beats a resolved real language.
    expect(resolveCodingLanguageLabel({ override: "pseudocode", resolved: "Python" })).toBe("Pseudocode");
  });

  it("never emits a storage slug for any control option — the §B.1 bridge rule", () => {
    for (const { slug, notSlug } of [
      { slug: "csharp", notSlug: "csharp" },
      { slug: "javascript", notSlug: "javascriptx" }, // label is "JavaScript"; slug lowercase
    ]) {
      const label = resolveCodingLanguageLabel({ override: slug, resolved: null });
      expect(label).not.toBe(notSlug === "javascriptx" ? "javascript" : slug);
    }
  });
});

describe("codingLanguageDirective — the prompt block, independent of codeBearing (AC-5 / D5)", () => {
  it("emits a non-empty block for EVERY input, including undefined (the general-session case)", () => {
    // The D5 teeth: codeLanguageLines(GENERAL, ...) returns [] today because it
    // gates on descriptor.codeBearing. This helper takes no descriptor, so a
    // coding question under a general session still gets a language directive.
    expect(codingLanguageDirective(undefined).length).toBeGreaterThan(0);
    expect(codingLanguageDirective({ override: "auto", resolved: null }).length).toBeGreaterThan(0);
  });

  it("names the resolved label in its lines, never the slug", () => {
    const lines = codingLanguageDirective({ override: "csharp", resolved: null }).join("\n");
    expect(lines).toContain("C#");
    expect(lines).not.toContain("csharp");
  });

  it("defaults to pseudocode when nothing resolves — never a real language picked at random", () => {
    const lines = codingLanguageDirective({ override: "auto", resolved: null }).join("\n");
    expect(lines).toMatch(/pseudocode/i);
    for (const real of ["Python", "JavaScript", "TypeScript", "Java", "C#", "Go", "SQL"]) {
      expect(lines).not.toContain(real);
    }
  });
});

// AC-10 / D6 — the embedded engine's honest fallback. NO code, EVER: the path
// has no model and no code producer, so honesty is structural. The marker is a
// field the UI renders as "switch to the AI engine for a worked solution".
describe("embeddedCodingFallback — no code, honest marker (AC-10 / D6)", () => {
  it("returns a fallback marker and carries the type", () => {
    const result = embeddedCodingFallback("technical");
    expect(typeof result.codingFallback).toBe("string");
    expect(result.codingFallback.length).toBeGreaterThan(0);
    expect(result.type).toBe("technical");
  });

  it("never carries a code or codingSolution field — fabricated code is impossible here", () => {
    const result = embeddedCodingFallback("technical");
    expect(result).not.toHaveProperty("code");
    expect(result).not.toHaveProperty("codingSolution");
  });
});
