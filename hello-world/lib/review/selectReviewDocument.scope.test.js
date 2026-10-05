// N103 Step 2 (implementer additions) -- what the selector does at the edges the
// landed selectReviewDocument.test.js does not reach:
//   * a pin that names a documentScope is AUTHORITATIVE: when that scope has no text
//     the answer is null, never "the resume instead" (the label the user sees names
//     the scope they pinned, so a substitute would be a verdict on the wrong subject);
//   * an unknown scope (the email tab) and an unknown job are null;
//   * the posting requirements ride along for a resume-type document only, and only
//     when the Ideal run produced some;
//   * the modal's per-scope entry point (reviewDocumentFor) agrees with the chat's.
//
// Node env: pure module.

import { describe, it, expect } from "vitest";
import { reviewDocumentFor, selectChatReviewDocument } from "./selectReviewDocument.js";

const REQS = [{ id: "q1", text: "Kubernetes" }];

function map(entry) {
  return { "job-1": entry };
}

describe("selectChatReviewDocument -- a named scope is authoritative", () => {
  it("documentScope=cover on a job with no cover letter is null, NOT the resume", () => {
    const pin = { label: "Acme — Cover letter", sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "cover" } };
    const tailoring = map({ result: "Led the platform team.", resultLines: ["Led the platform team."] });
    expect(selectChatReviewDocument(pin, tailoring)).toBeNull();
  });

  it("documentScope=hypothetical on an ordinary job (no Ideal run) is null", () => {
    const pin = { label: "Acme — HYPOTHETICAL", sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "hypothetical" } };
    expect(selectChatReviewDocument(pin, map({ result: "Led the platform team." }))).toBeNull();
  });

  it("an unknown scope (the email tab) is null even when the job has a resume", () => {
    const pin = { label: "Acme — Email", sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "email" } };
    expect(selectChatReviewDocument(pin, map({ result: "Led the platform team." }))).toBeNull();
  });

  it("a blank résumé is null (the strip must not mount over nothing)", () => {
    expect(reviewDocumentFor(map({ result: "  \n ", resultLines: ["", "  "] }), "job-1", "resume", "x")).toBeNull();
  });
});

describe("reviewDocumentFor -- the per-scope request", () => {
  it("falls back to the result string when the entry carries no lines", () => {
    const doc = reviewDocumentFor(map({ result: "Line one.\nLine two." }), "job-1", "resume", "Acme — Resume");
    expect(doc.resultLines).toEqual(["Line one.", "Line two."]);
    expect(doc.title).toBe("Acme — Resume");
    expect(doc.scope).toBe("resume");
    expect(doc.realMaterial).toBeNull();
  });

  it("carries the Ideal run's posting requirements on a resume, never on a cover letter", () => {
    const entry = { result: "Line one.", coverLetterResultLines: ["Dear team,"], ideal: { postingAnalysis: { requirements: REQS } } };
    expect(reviewDocumentFor(map(entry), "job-1", "resume", "x").posting).toEqual({ requirements: REQS });
    expect(reviewDocumentFor(map(entry), "job-1", "cover", "x").posting).toBeNull();
  });

  it("posting is null when the Ideal run produced no requirements", () => {
    const entry = { result: "Line one.", ideal: { postingAnalysis: { requirements: [] } } };
    expect(reviewDocumentFor(map(entry), "job-1", "resume", "x").posting).toBeNull();
  });

  it("the hypothetical is a hypothetical kind and reads the hypothetical's own lines", () => {
    const entry = { result: "Real line.", ideal: { hypothetical: { result: "Best case line.", resultLines: ["Best case line."] } } };
    const doc = reviewDocumentFor(map(entry), "job-1", "hypothetical", "x");
    expect(doc.kind).toBe("hypothetical");
    expect(doc.resultLines).toEqual(["Best case line."]);
  });

  it("an unknown job is null", () => {
    expect(reviewDocumentFor(map({ result: "x" }), "job-404", "resume", "t")).toBeNull();
    expect(reviewDocumentFor(null, "job-1", "resume", "t")).toBeNull();
  });
});
