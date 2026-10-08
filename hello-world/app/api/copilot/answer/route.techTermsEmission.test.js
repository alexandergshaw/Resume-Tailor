// N150 — T-F3b, the Row-1-EMISSION EQUIVALENCE guard (correction C1).
//
// This test READS app/api/copilot/answer/route.js and never edits it (the design
// keeps the answer route OUT of N150's blast radius; F3 is resolved without
// touching it). It is therefore GREEN ON HEAD by design — it is a REGRESSION
// GUARD over an invariant N150's enablement leans on, not a RED hand-off. The
// 4b notes record this explicitly and prove its teeth by mutation (moving
// ...projectExampleField into an embedded branch, or removing it from a
// streaming branch, reds it).
//
// THE INVARIANT (design §4.5 / I-11, corrected by plan C1 to cover ALL FOUR
// non-embedded spread sites, including the streaming path at :323/:335):
//   every done/return payload that spreads a GEMINI role-terms flag
//   (...roleTermsFlag, the streamAnswer local assigned from geminiRoleTermsFlag,
//   or ...geminiRoleTermsFlag(...)) ALSO spreads ...projectExampleField; and
//   every payload that spreads ...embeddedRoleTermsFlag(...) spreads NONE.
// So `projectExample` present on the answer  <=>  the server ran a non-embedded
// model backend — exactly the signal tech-terms (and Row 2) gate on. A future
// change to WHEN Row 1 is emitted reds here instead of silently disabling the
// feature.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tokenizeSource } from "../../../../lib/sourceScan/tokenizeSource.js";

const ROUTE = "app/api/copilot/answer/route.js";
// codeMask blanks comments, regex AND string/template contents (keeping byte
// offsets), so braces inside a string can never desync the scan below.
const CODE = tokenizeSource(readFileSync(path.resolve(process.cwd(), ROUTE), "utf8"), { label: ROUTE }).codeMask;

// The spread markers, each located at the leading `.` of `...` so the enclosing
// object is the PAYLOAD, not the flag helper's own argument object.
const MARKERS = {
  projectExample: /\.\.\.projectExampleField\b/g,
  geminiLocal: /\.\.\.roleTermsFlag\b/g, // streamAnswer's local, assigned from geminiRoleTermsFlag
  geminiCall: /\.\.\.geminiRoleTermsFlag\s*\(/g,
  embeddedCall: /\.\.\.embeddedRoleTermsFlag\s*\(/g,
};

function matchIndices(re) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(CODE)) !== null) out.push(m.index);
  return out;
}

// The index of the innermost `{` open at `pos` — the object literal that
// encloses the spread marker there.
function enclosingObjectAt(pos) {
  const stack = [];
  for (let i = 0; i < pos; i += 1) {
    const c = CODE[i];
    if (c === "{") stack.push(i);
    else if (c === "}") stack.pop();
  }
  return stack.length ? stack[stack.length - 1] : -1;
}

// Group every marker by the payload object that encloses it.
function payloads() {
  const byObject = new Map();
  const add = (kind, pos) => {
    const obj = enclosingObjectAt(pos);
    if (!byObject.has(obj)) byObject.set(obj, { gemini: false, embedded: false, projectExample: false });
    const g = byObject.get(obj);
    if (kind === "projectExample") g.projectExample = true;
    if (kind === "geminiLocal" || kind === "geminiCall") g.gemini = true;
    if (kind === "embeddedCall") g.embedded = true;
  };
  for (const [kind, re] of Object.entries(MARKERS)) for (const pos of matchIndices(re)) add(kind, pos);
  // Only objects that spread SOME role-terms flag are "done-frame payloads".
  return [...byObject.values()].filter((g) => g.gemini || g.embedded);
}

describe("T-F3b — projectExample rides exactly the non-embedded done frames (C1: all four sites)", () => {
  it("[canary] the scan actually finds the spreads it reasons about", () => {
    // Guards against a silent zero if the route is renamed/refactored: a scan
    // that found nothing would make every co-occurrence below vacuously true.
    expect(matchIndices(MARKERS.projectExample).length).toBe(4); // :323 :335 :796 :914
    expect(matchIndices(MARKERS.embeddedCall).length).toBe(2); // :712 :838
    expect(matchIndices(MARKERS.geminiLocal).length).toBe(2); // :322 :334 (streaming local)
    expect(matchIndices(MARKERS.geminiCall).length).toBe(2); // :787 :912
  });

  it("every GEMINI payload also spreads ...projectExampleField", () => {
    for (const g of payloads()) {
      if (g.gemini) expect(g.projectExample, `a gemini payload is missing projectExampleField`).toBe(true);
    }
  });

  it("every EMBEDDED payload spreads NO projectExampleField", () => {
    for (const g of payloads()) {
      if (g.embedded) expect(g.projectExample, `an embedded payload leaked projectExampleField`).toBe(false);
    }
  });

  it("the counts match: four non-embedded payloads carry it, two embedded carry none", () => {
    const all = payloads();
    const gemini = all.filter((g) => g.gemini && !g.embedded);
    const embedded = all.filter((g) => g.embedded && !g.gemini);
    expect(gemini.length).toBe(4);
    expect(embedded.length).toBe(2);
    expect(gemini.every((g) => g.projectExample)).toBe(true);
    expect(embedded.every((g) => !g.projectExample)).toBe(true);
  });

  it("the answer route stays out of N150's blast radius (canary: no tech-terms symbol)", () => {
    const raw = readFileSync(path.resolve(process.cwd(), ROUTE), "utf8");
    expect(raw).not.toMatch(/tech-terms|techTerms|tech-term-detail/);
  });
});
