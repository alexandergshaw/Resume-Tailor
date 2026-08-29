// Source-text only. No `vi.mock`, no `POST` import — the property under test
// IS the shape of the source, which a behavioural test cannot see: every
// case in route.test.js/route.knowledgeBase.test.js/etc. exercises the route
// only through its HTTP surface, so an extracted-but-never-imported module
// (the caller still running its own inline copy) would leave that whole
// suite green. This file is what makes that specific failure mode visible.
//
// Written for the split of app/api/copilot/answer/route.js into
// lib/copilot/answerContext.js, lib/copilot/roleTermsFlag.js and
// lib/copilot/answerCompanyFacts.js, done to bring the route back under this
// project's hard 1000-line ceiling. See each module's own header for what it
// took with it and why.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

const src = read("app/api/copilot/answer/route.js");

describe("route.js imports and calls the three extracted modules (not an inert split)", () => {
  it("imports loadAnswerContext and answerContextKey from lib/copilot/answerContext", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*loadAnswerContext[^}]*\}\s*from\s*["']@\/lib\/copilot\/answerContext["']/,
    );
    expect(src).toMatch(
      /import\s*\{[^}]*answerContextKey[^}]*\}\s*from\s*["']@\/lib\/copilot\/answerContext["']/,
    );
  });

  it("imports geminiRoleTermsFlag and embeddedRoleTermsFlag from lib/copilot/roleTermsFlag", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*geminiRoleTermsFlag[^}]*\}\s*from\s*["']@\/lib\/copilot\/roleTermsFlag["']/,
    );
    expect(src).toMatch(
      /import\s*\{[^}]*embeddedRoleTermsFlag[^}]*\}\s*from\s*["']@\/lib\/copilot\/roleTermsFlag["']/,
    );
  });

  it("imports startCompanyFacts and resolveCompanyFacts from lib/copilot/answerCompanyFacts", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*startCompanyFacts[^}]*\}\s*from\s*["']@\/lib\/copilot\/answerCompanyFacts["']/,
    );
    expect(src).toMatch(
      /import\s*\{[^}]*resolveCompanyFacts[^}]*\}\s*from\s*["']@\/lib\/copilot\/answerCompanyFacts["']/,
    );
  });

  // Call counts, not mere presence: a wrong count means one of the route's
  // five response paths (streaming answer, streaming points, embedded
  // answer, embedded points, Gemini answer, Gemini points — six call sites
  // in five response shapes, since the streaming producer serves both modes
  // from one call site) silently reverted to inline code or lost its call
  // entirely, while every OTHER path still imports the module and looks
  // wired.
  it("calls loadAnswerContext exactly once and answerContextKey exactly once", () => {
    expect(src.match(/loadAnswerContext\(/g) || []).toHaveLength(1);
    expect(src.match(/answerContextKey\(/g) || []).toHaveLength(1);
  });

  it("calls startCompanyFacts exactly once and resolveCompanyFacts exactly twice", () => {
    // Once each for streamAnswer's producer (the streaming response) and the
    // non-streaming POST continuation — see answerCompanyFacts.js's own
    // header on why the wait must stay wherever each path already puts it. A
    // count of 1 means one of the two paths lost its facts wait.
    expect(src.match(/startCompanyFacts\(/g) || []).toHaveLength(1);
    expect(src.match(/resolveCompanyFacts\(/g) || []).toHaveLength(2);
  });

  it("calls geminiRoleTermsFlag exactly 3 times and embeddedRoleTermsFlag exactly 2 times", () => {
    // THE CONSTRAINT-#2 GUARD IN SOURCE FORM. Five response paths need the
    // honesty flag (streaming serves both modes from one call site, so this
    // is 5 call sites, not 6): streaming (Gemini only), Gemini answer mode,
    // Gemini points mode — 3 gemini calls — and embedded answer mode,
    // embedded points mode — 2 embedded calls. Swapping either engine's flag
    // at any one of those five sites changes this split 3/2 into something
    // else, which is exactly the false-accusation defect
    // route.roleTermsUnbacked.test.js exists to catch behaviourally — this
    // is the same guarantee, visible in the source before a single request
    // ever runs.
    expect(src.match(/geminiRoleTermsFlag\(/g) || []).toHaveLength(3);
    expect(src.match(/embeddedRoleTermsFlag\(/g) || []).toHaveLength(2);
  });
});

describe("the old inline code is actually gone (an inert split would leave both)", () => {
  it("no longer defines roleTermsUnbackedFlag or storyPageText in the route", () => {
    expect(src).not.toMatch(/function\s+roleTermsUnbackedFlag\s*\(/);
    expect(src).not.toMatch(/function\s+storyPageText\s*\(/);
  });

  it("no longer calls listPages/listAttachmentsByPage directly from the route", () => {
    expect(src).not.toMatch(/listPages\s*\(/);
    expect(src).not.toMatch(/listAttachmentsByPage\s*\(/);
  });

  it("no longer calls buildCompanyFacts or references companyFactsCache directly from the route", () => {
    expect(src).not.toMatch(/buildCompanyFacts\s*\(/);
    expect(src).not.toMatch(/companyFactsCache/);
  });

  it("no longer defines its own FACTS_DEADLINE_MS", () => {
    expect(src).not.toMatch(/FACTS_DEADLINE_MS/);
  });

  it("the withDerivedKind graft really left — not recomputed on a cache hit", () => {
    // Cheap and the only place this ordering guarantee (answerContext.js's
    // own header: the graft runs inside the cached loader, not on every hit)
    // is visible from outside that module.
    expect(src).not.toMatch(/withDerivedKind/);
  });
});

describe("the three new modules exist and export what the route imports", () => {
  it("lib/copilot/answerContext.js exports answerContextKey and loadAnswerContext", () => {
    const modSrc = read("lib/copilot/answerContext.js");
    expect(modSrc).toMatch(/export function answerContextKey/);
    expect(modSrc).toMatch(/export async function loadAnswerContext/);
  });

  it("lib/copilot/roleTermsFlag.js exports geminiRoleTermsFlag and embeddedRoleTermsFlag", () => {
    const modSrc = read("lib/copilot/roleTermsFlag.js");
    expect(modSrc).toMatch(/export function geminiRoleTermsFlag/);
    expect(modSrc).toMatch(/export function embeddedRoleTermsFlag/);
  });

  it("lib/copilot/answerCompanyFacts.js exports FACTS_DEADLINE_MS, startCompanyFacts and resolveCompanyFacts", () => {
    const modSrc = read("lib/copilot/answerCompanyFacts.js");
    expect(modSrc).toMatch(/export const FACTS_DEADLINE_MS/);
    expect(modSrc).toMatch(/export function startCompanyFacts/);
    expect(modSrc).toMatch(/export async function resolveCompanyFacts/);
  });
});

// Chunk C (the code-language control and its per-application resolver, plan
// §D-31): brought this file from 839 to 870 raw lines, against this
// `describe`'s own `<= 900` / `> 600` band. That budget is thin on purpose —
// this is the ONE place in chunk C's design where an overrun has exactly one
// sanctioned move, and it is not an extraction: `startCodeLanguageResolution`
// and `generateCodeLanguage`'s own reasoning lives in
// `lib/copilot/answerCodeLanguage.js`'s module header, not here, precisely so
// growing this route never has to choose between exceeding this band and
// shaving the prose the lower bound below exists to protect. If a future
// change needs more room here, add to that header and leave a one-line
// pointer in this route — do not shave a comment to hit a number, and do not
// extract one of this route's own call sites: the call-count assertions two
// `describe` blocks above pin every one of them by an exact count.
describe("route.js's own line count (the whole point of this split)", () => {
  it("stays within the band this split actually landed in", () => {
    const lines = src.split(/\r?\n/).length;
    // Re-derived against the CURRENT file (838 lines after the split, down
    // from 1023 before it) rather than against the split notes' own
    // estimate: those notes were written against a 980-line snapshot of this
    // file and are stale on line numbers (a later fix round added the
    // roleTermsClaimed sibling field, an escape-hatch clause, and comment
    // corrections — none of it touched by this split, all of it counted
    // here). 900 is a real ceiling with a little slack for incidental future
    // edits, not a number chosen to make this test pass.
    expect(lines).toBeLessThanOrEqual(900);
    // The lower bound matters as much as the upper one: it is what stops a
    // future edit from hitting a small number by deleting load-bearing prose
    // — e.g. the grounding asymmetry history above `groundingWithPages`, or
    // the ITEM 9 comment on MAX_QUESTION_CHARS's reach — rather than by
    // actually moving code.
    expect(lines).toBeGreaterThan(600);
  });

  it("is under this project's hard 1000-line ceiling", () => {
    const lines = src.split(/\r?\n/).length;
    expect(lines).toBeLessThan(1000);
  });
});
