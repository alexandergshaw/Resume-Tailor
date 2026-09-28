// N69 (SPACING) — CB-R-2: the combine path must carry line spacing
// consistently with the single-doc download (plan Step 6 = EXTEND branch),
// against the REAL combinedDocumentXml.
//
// Env: default "node" (string model, no DOMParser needed).
//
// combineDocuments.paragraphXml (:62-70) rebuilds each paragraph from the model
// and today emits <w:jc/> + <w:spacing w:before/after> but NO <w:line>. So a
// combined document silently drops line spacing that the single-doc download
// (docx.js sweep) carries — the two download paths disagree. This pins the
// EXTEND branch: combine emits line spacing from model.lineSpacing.
//
// If the checker rules the EXTEND branch out of budget, the AC's EXCLUDE branch
// (combine declared out of scope for line spacing + an unchanged-guard) is the
// documented alternative — that would retire THIS test, not weaken it.

import { describe, it, expect } from "vitest";
import { combinedDocumentXml } from "./combineDocuments.js";

const para = (text, extra = {}) => ({
  runs: [{ text, bold: false, italic: false, underline: false, sizePt: null, color: null }],
  align: "left",
  spaceBeforePt: 0,
  spaceAfterPt: 6,
  list: null,
  ...extra,
});

describe("CB-R-2 — combinedDocumentXml carries line spacing from the model", () => {
  it("emits w:line/w:lineRule for a paragraph whose model carries lineSpacing (RED on HEAD: no w:line emitted)", () => {
    const model = { paragraphs: [para("Body", { lineSpacing: 1.5, lineRule: "auto" })] };
    const xml = combinedDocumentXml([model]);
    // 1.5x auto = w:line 360. The combine path must not drop it.
    expect(xml).toMatch(/w:line="360"/);
    expect(xml).toMatch(/w:lineRule="auto"/);
  });

  it("still emits paragraph spacing (before/after) — the anti-vacuity guard (green today)", () => {
    // Proves the assertion above is about the NEW w:line, not about w:spacing
    // as a whole: paragraph spacing already round-trips through combine and
    // must keep doing so.
    const model = { paragraphs: [para("Body", { spaceAfterPt: 6 })] };
    const xml = combinedDocumentXml([model]);
    expect(xml).toMatch(/w:after="120"/); // 6pt * 20 = 120 twips
  });

  it("a paragraph with no line spacing does NOT gain a spurious w:line (no-op control)", () => {
    // A combine that hardcoded w:line would pass the first test for the wrong
    // reason; a model without lineSpacing must not sprout one.
    const xml = combinedDocumentXml([{ paragraphs: [para("Body")] }]);
    expect(xml).not.toMatch(/w:line=/);
  });
});
