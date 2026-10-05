// N103 (4b) -- AC-8 / AC-11 source census over N103's OWN new files and the two
// edited surfaces. One sweep proves: (a) N103 adds NO second analyzer and NO
// second span-minter (AC-8), and (b) both surfaces + the section reach the reviewer
// ONLY through the single chokepoint, never importing reviewDocuments /
// decomposeToSpans / reviewVerdict directly (AC-11).
//
// Comment-stripped before scanning (a prose citation of a module must not read as
// an import -- see loop-traps-tests). Every negative is paired with a canary on a
// file that legitimately DOES carry the pattern, so a dead sweep is visible.
//
// RED on HEAD: the new files do not exist, so reading them throws and the canary
// rows (which require the chokepoint to exist) fail. In the reference the files
// exist and every row holds.
//
// Node env: source-text only.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "../sourceScan/tokenizeSource.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url)); // hello-world/

function read(rel) {
  const path = ROOT + rel;
  expect(existsSync(path), `${rel} must exist`).toBe(true);
  return stripComments(readFileSync(path, "utf8"));
}

// N103's three pure-ish new files that must NOT re-implement the analyzer or the
// span-minter (the chokepoint is the ONLY place decomposeToSpans/reviewDocuments
// are reached).
const NON_CHOKEPOINT_NEW = [
  "lib/review/selectReviewDocument.js",
  "lib/review/reviewPresentation.js",
  "lib/review/resolveFlagExcerpts.js",
  "app/components/preview/DocumentReviewSection.js",
  "app/components/preview/DocumentReviewResult.js",
];

// Files that must not import the primitives directly (AC-11): both surfaces and the
// shared section. The chokepoint is excluded -- it is the one legitimate importer.
const MUST_NOT_IMPORT_PRIMITIVES = [
  "app/components/DocumentPreviewMount.js",
  "app/components/ChatPanel.js",
  "app/components/preview/DocumentReviewSection.js",
];

const PRIMITIVE_IMPORT = /from\s+["'][^"']*\/(reviewDocuments|spanDocument|reviewVerdict)["']/;
const DECOMPOSE_NAME = /\bdecomposeToSpans\b/;
const REVIEW_DOCUMENTS_NAME = /\breviewDocuments\b/;

describe("AC-8 -- no second analyzer / span-minter in N103's new files", () => {
  for (const rel of NON_CHOKEPOINT_NEW) {
    it(`${rel}: no detector import, no local id-minting, no decomposeToSpans/reviewDocuments`, () => {
      const src = read(rel);
      expect(src, "must not import the mechanical detectors").not.toMatch(/mechanicalDetectors/);
      expect(src, "must not reach the span-minter").not.toMatch(DECOMPOSE_NAME);
      expect(src, "must not reach the analyzer").not.toMatch(REVIEW_DOCUMENTS_NAME);
      // No local span-id minting (`s${...}` templates, crypto id assignment).
      expect(src).not.toMatch(/`s\$\{/);
      expect(src).not.toMatch(/randomUUID/);
    });
  }

  it("CANARY: the real detectors DO carry a metric regex and the real minter DOES mint `s${...}` ids (the sweep is live)", () => {
    const detectors = read("lib/review/mechanicalDetectors.js");
    const minter = read("lib/llm/ideal/spanDocument.js");
    expect(detectors).toMatch(/NUMERIC_CLAIM_RE|%/);
    expect(minter).toMatch(/`s\$\{/);
  });
});

describe("AC-11 -- one chokepoint: surfaces + section never import the primitives directly", () => {
  for (const rel of MUST_NOT_IMPORT_PRIMITIVES) {
    it(`${rel}: imports neither reviewDocuments, decomposeToSpans nor reviewVerdict`, () => {
      const src = read(rel);
      expect(src, "no direct primitive import").not.toMatch(PRIMITIVE_IMPORT);
      expect(src).not.toMatch(DECOMPOSE_NAME);
    });
  }

  it("the section reaches the reviewer only through runDocumentReview", () => {
    const src = read("app/components/preview/DocumentReviewSection.js");
    expect(src).toMatch(/runDocumentReview/);
  });

  it("CANARY: the chokepoint DOES import all three primitives (so the AC-11 sweep is not dead)", () => {
    const src = read("lib/review/runDocumentReview.js");
    expect(src).toMatch(DECOMPOSE_NAME);
    expect(src).toMatch(REVIEW_DOCUMENTS_NAME);
    expect(src).toMatch(/reviewVerdict/);
  });
});
