// node (this repo's default environment) — a SOURCE-TEXT test, deliberately,
// and for exactly the reason PracticeClient.codeLanguageWiring.test.js /
// PracticeClient.interviewTypeWiring.test.js give for their own: PracticeClient
// cannot be rendered under test (its own comment says so), so a correct hook
// that is never wired is this repo's most common way to finish green and
// broken. This file proves the CALLER wires the N162 coding-solution toggle
// into the practice sample-answer path, the same way those files prove the
// code-language and interview-type wiring.
//
// N162 Wave D. The live hook (useDraftAnswer) reads the store directly; the
// PRACTICE hook (useSampleAnswer) takes `includeCodingSolution` as a PROP
// (arch §6.4), so PracticeClient must:
//   1. read useIncludeCodingSolution() from the shared store,
//   2. pass includeCodingSolution into useSampleAnswer's argument object,
//   3. pass it as the trailing (sixth) positional argument to sampleAnswer.queue,
//   4. list it in the queue effect's dependency array.
//
// RED on HEAD: PracticeClient.js knows nothing about the toggle — no import, no
// call, and the queue call carries five args ending at codeLanguage.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripLineComments } from "@/test/helpers/stripComments.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, "./PracticeClient.js"), "utf8");
const CLIENT = stripLineComments(RAW);

// The full call expression starting at `marker`, by BALANCING brackets — the
// same helper codeLanguageWiring uses, so "the sixth positional argument" is a
// checkable claim rather than a guess.
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

describe("PracticeClient reads the shared coding-solution store (AC-N162-4/16)", () => {
  it("imports useIncludeCodingSolution from the shared store module", () => {
    expect(CLIENT).toMatch(
      /import\s*\{[^}]*\buseIncludeCodingSolution\b[^}]*\}\s*from\s*["']@\/app\/settings\/includeCodingSolution["']/,
    );
  });

  it("actually CALLS it — an import alone ships the feature inert", () => {
    expect(CLIENT).toMatch(/\buseIncludeCodingSolution\s*\(/);
  });
});

describe("the toggle reaches the sample-answer path (AC-N162-5, AC-N162-21)", () => {
  it("passes includeCodingSolution into useSampleAnswer's argument object, by identifier", () => {
    const call = callExpression(CLIENT, "useSampleAnswer(");
    expect(call).not.toBe(null);
    expect(call).toMatch(/\bincludeCodingSolution\b/);
    // Not a hardcoded literal (which would wire a control that can never move).
    expect(call).not.toMatch(/includeCodingSolution\s*:\s*(?:true|false|["'])/);
  });

  it("passes it as the SIXTH positional argument to queue, after codeLanguage", () => {
    // Positional and trailing: codeLanguage stays fifth (its own ordering rule,
    // codeLanguageWiring.test.js), and the toggle is appended after it.
    const args = argumentsOf(callExpression(CLIENT, "sampleAnswer.queue("));
    expect(args).not.toBe(null);
    expect(args).toHaveLength(6);
    expect(args[4]).toMatch(/codeLanguage/);
    expect(args[5]).toMatch(/includeCodingSolution/);
    // By identifier, not a literal.
    expect(args[5]).not.toMatch(/^(?:true|false|["'])/);
  });

  it("lists the toggle in the queue effect's dependency array", () => {
    // Without it the effect never re-runs on a toggle flip, and the queued
    // draft stays in the old toggle state until something unrelated moves.
    const effects = [];
    let from = 0;
    for (;;) {
      const at = CLIENT.indexOf("useEffect(", from);
      if (at === -1) break;
      effects.push(callExpression(CLIENT.slice(at), "useEffect("));
      from = at + 1;
    }
    const queueEffect = effects.find((body) => body && body.includes("sampleAnswer.queue("));
    expect(queueEffect, "no useEffect calls sampleAnswer.queue").toBeTruthy();
    const args = argumentsOf(queueEffect);
    expect(args.length).toBeGreaterThanOrEqual(2);
    const deps = args[args.length - 1];
    expect(deps.startsWith("[")).toBe(true);
    expect(deps).toMatch(/\bincludeCodingSolution\b/);
  });
});
