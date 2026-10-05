// N103 Step 2 (4b) -- the chat current-document selector (AC-2 / design F-1).
//
// ChatPanel holds no document bytes, and chatPinnedContext.content is OVERWRITTEN
// by page.js's sync effect to a COMPOUND "job context + Tailored Resume:" string
// (page.js:1680-1688). Reviewing `content` would review job-context noise and
// attribute the verdict to the resume -- exactly AC-2's banned "reviews a
// substitute". So the selector must resolve the ACTUAL document from structured
// state (documentScope / sourceJobId + tailoringMap), name it from `label`, and
// NEVER read `content`. A resume pin and a hypothetical pin of the SAME job id
// (same sourceJobId) must resolve to DIFFERENT documents, which is only possible
// through `documentScope.scope`.
//
// RED on HEAD: `lib/review/selectReviewDocument.js` does not exist. Every `it`
// carries a real assertion that also bites a stub (a selector that returns the
// résumé for every scope reds the hypothetical case; one that reads `.content`
// reds the no-content case). Satisfiability + the AC-2 mutant are proven against
// the scratchpad reference in the seat report.
//
// Node env: pure module, no React, no IO, no clock.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectChatReviewDocument } from "./selectReviewDocument.js";
import { stripComments } from "../sourceScan/tokenizeSource.js";

const RESUME_LINES = ["PROFESSIONAL EXPERIENCE", "Led the platform team to a steady release cadence.", "Cut p99 latency from 800ms to 200ms."];
const HYPO_LINES = ["PROFESSIONAL EXPERIENCE", "Scaled a 300-person engineering organization as VP."];
const COVER_LINES = ["Dear Hiring Manager,", "I am excited to apply for the Staff Engineer role."];

function tailoringMap() {
  return {
    "job-1": {
      result: RESUME_LINES.join("\n"),
      resultLines: RESUME_LINES,
      coverLetterResultLines: COVER_LINES,
      ideal: {
        hypothetical: { result: HYPO_LINES.join("\n"), resultLines: HYPO_LINES, isHypothetical: true },
      },
    },
  };
}

// The compound string page.js writes over `content`: it contains a sentinel the
// selector must never surface, since it would attribute job-context noise to the
// résumé.
const COMPOUND_CONTENT = "Company: Acme\nRole: Staff Engineer\nCOMPOUND_NOISE_SENTINEL\n\nTailored Resume:\n" + RESUME_LINES.join("\n");

describe("selectChatReviewDocument -- deterministic, named, never a substitute (S2/AC-2)", () => {
  it("documentScope scope=resume -> the application-ready résumé, named from label", () => {
    const pin = { label: "Acme · Staff Engineer — Resume", content: COMPOUND_CONTENT, sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "resume" } };
    const doc = selectChatReviewDocument(pin, tailoringMap());
    expect(doc).not.toBeNull();
    expect(doc.kind).toBe("applicationReady");
    expect(doc.title).toBe("Acme · Staff Engineer — Resume");
    expect(doc.resultLines).toEqual(RESUME_LINES);
  });

  it("DIFFERENTIAL: a resume pin and a hypothetical pin of the SAME job id resolve to DIFFERENT documents (via scope, not job id)", () => {
    const base = { label: "Acme · Staff Engineer", content: COMPOUND_CONTENT, sourceJobId: "job-1" };
    const map = tailoringMap();
    const resume = selectChatReviewDocument({ ...base, documentScope: { jobId: "job-1", scope: "resume" } }, map);
    const hypo = selectChatReviewDocument({ ...base, documentScope: { jobId: "job-1", scope: "hypothetical" } }, map);
    // The AC-2 mutant (select by job id alone / ignore scope) reds here.
    expect(hypo.kind).toBe("hypothetical");
    expect(resume.resultLines).toEqual(RESUME_LINES);
    expect(hypo.resultLines).toEqual(HYPO_LINES);
    expect(hypo.resultLines).not.toEqual(resume.resultLines);
  });

  it("documentScope scope=cover -> the tailored cover letter", () => {
    const pin = { label: "Acme · Staff Engineer — Cover letter", content: COMPOUND_CONTENT, sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "cover" } };
    const doc = selectChatReviewDocument(pin, tailoringMap());
    expect(doc.kind).toBe("applicationReady");
    expect(doc.resultLines).toEqual(COVER_LINES);
  });

  it("NEVER reads pinnedContext.content: the compound-string sentinel never reaches resultLines", () => {
    const pin = { label: "Acme · Staff Engineer — Resume", content: COMPOUND_CONTENT, sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "resume" } };
    const doc = selectChatReviewDocument(pin, tailoringMap());
    // The mutant "selector reads .content" reds here (COMPOUND_NOISE_SENTINEL leaks in).
    expect(doc.resultLines.join("\n")).not.toContain("COMPOUND_NOISE_SENTINEL");
    expect(JSON.stringify(doc)).not.toContain("COMPOUND_NOISE_SENTINEL");
  });

  it("falls back to sourceJobId's application-ready résumé when no documentScope is present", () => {
    const pin = { label: "Acme · Staff Engineer", content: COMPOUND_CONTENT, sourceJobId: "job-1" };
    const doc = selectChatReviewDocument(pin, tailoringMap());
    expect(doc.kind).toBe("applicationReady");
    expect(doc.resultLines).toEqual(RESUME_LINES);
    expect(doc.title).toBe("Acme · Staff Engineer");
  });

  it("refuses (null) on absence: no pinned context, or a pin whose job is not in the map", () => {
    expect(selectChatReviewDocument(null, tailoringMap())).toBeNull();
    expect(selectChatReviewDocument({ label: "x" }, tailoringMap())).toBeNull();
    expect(selectChatReviewDocument({ label: "x", sourceJobId: "job-404" }, tailoringMap())).toBeNull();
  });

  it("SOURCE CENSUS: the module never reads the `.content` field (comment-stripped), but does read documentScope / sourceJobId / label", () => {
    const src = stripComments(readFileSync(fileURLToPath(new URL("./selectReviewDocument.js", import.meta.url)), "utf8"));
    // Canary: the identifiers it SHOULD read are present, so a 0-hit on `.content`
    // means it truly does not read content, not that the sweep is dead.
    expect(src).toMatch(/documentScope/);
    expect(src).toMatch(/sourceJobId/);
    expect(src).toMatch(/\blabel\b/);
    // The teeth: the compound/overwritten `content` field is never dereferenced.
    expect(src.includes(".content")).toBe(false);
  });
});
