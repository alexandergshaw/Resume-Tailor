import { describe, it, expect } from "vitest";
import { critiqueAnswerLocal } from "./critiqueLocal.js";

// AC-H5.22: when the route found a submitted résumé/cover letter for this
// application (app/api/copilot/critique/route.js), critiqueAnswerLocal
// appends exactly one extra `missing` item when the answer never names any
// of their distinctive terms — never touching SCORE, and never firing at
// all when resume/coverLetter are both empty (the default, and every call
// site in critiqueLocal.test.js). Split into its own file rather than added
// to critiqueLocal.test.js, which was already close to the project's
// 1000-line-per-file cap.
describe("critiqueAnswerLocal — submitted-documents grounding note (AC-H5.22)", () => {
  const QUESTION = "Tell me about yourself.";
  const ANSWER = "I have five years of experience building backend systems.";
  const RESUME = "Led the Kubernetes migration at Acme Corp, reducing latency by 30%.";

  it("adds no item, and no behavior change at all, when resume and coverLetter are both omitted", () => {
    const withoutParams = critiqueAnswerLocal({ question: QUESTION, type: "general", answer: ANSWER });
    const withEmptyParams = critiqueAnswerLocal({
      question: QUESTION,
      type: "general",
      answer: ANSWER,
      resume: "",
      coverLetter: "",
    });
    expect(withEmptyParams).toEqual(withoutParams);
  });

  it("appends exactly one missing item naming the submitted resume when the answer cites none of its distinctive terms", () => {
    const withDocs = critiqueAnswerLocal({ question: QUESTION, type: "general", answer: ANSWER, resume: RESUME });
    const withoutDocs = critiqueAnswerLocal({ question: QUESTION, type: "general", answer: ANSWER });

    expect(withDocs.missing.length).toBe(withoutDocs.missing.length + 1);
    const added = withDocs.missing.find((m) => !withoutDocs.missing.includes(m));
    expect(added).toMatch(/resume you submitted for this posting/);
    expect(added).toMatch(/Kubernetes|Acme/);
  });

  it("never changes SCORE, whether or not the note fires", () => {
    const withDocsUncited = critiqueAnswerLocal({
      question: QUESTION,
      type: "general",
      answer: ANSWER,
      resume: RESUME,
    });
    const withoutDocs = critiqueAnswerLocal({ question: QUESTION, type: "general", answer: ANSWER });
    expect(withDocsUncited.score).toBe(withoutDocs.score);

    const withDocsCited = critiqueAnswerLocal({
      question: QUESTION,
      type: "general",
      answer: "I led the Kubernetes migration and reduced latency significantly.",
      resume: RESUME,
    });
    const withoutDocsCited = critiqueAnswerLocal({
      question: QUESTION,
      type: "general",
      answer: "I led the Kubernetes migration and reduced latency significantly.",
    });
    expect(withDocsCited.score).toBe(withoutDocsCited.score);
  });

  it("adds no item when the answer DOES cite one of the submitted documents' distinctive terms", () => {
    const result = critiqueAnswerLocal({
      question: QUESTION,
      type: "general",
      answer: "I led the Kubernetes migration and reduced latency significantly.",
      resume: RESUME,
    });
    expect(result.missing.join(" ")).not.toMatch(/never brings any of it up/);
  });

  it("names the cover letter (not 'resume') when only a cover letter was found", () => {
    const result = critiqueAnswerLocal({
      question: QUESTION,
      type: "general",
      answer: ANSWER,
      coverLetter: "I am excited to bring my Terraform experience to this role.",
    });
    const added = result.missing.find((m) => m.includes("never brings any of it up"));
    expect(added).toMatch(/cover letter you submitted for this posting/);
    expect(added).not.toMatch(/resume and cover letter/);
  });

  it("never credits a taxonomy canonicalization the candidate didn't literally write (the 'team' -> 'Microsoft Teams' defect)", () => {
    // Contains "team"/"teams" but never the literal phrase "Microsoft
    // Teams" — the skills taxonomy canonicalizes "teams" to that product
    // name (see lib/copilot/sampleAnswerLocal.js's own regression fixture
    // for the same defect), and this note must never cite a product the
    // candidate never mentioned.
    const resume = "Collaborated closely with teams across the org on shared tooling.";
    const result = critiqueAnswerLocal({
      question: QUESTION,
      type: "general",
      answer: ANSWER,
      resume,
    });
    expect(result.missing.join(" ")).not.toContain("Microsoft Teams");
  });

  it("does not fire when the submitted documents mine no distinctive terms at all", () => {
    const resume = "I worked there for a while and did a lot of things.";
    const withDocs = critiqueAnswerLocal({ question: QUESTION, type: "general", answer: ANSWER, resume });
    const withoutDocs = critiqueAnswerLocal({ question: QUESTION, type: "general", answer: ANSWER });
    expect(withDocs).toEqual(withoutDocs);
  });

  // BUG-H3: the submitted-documents note used to be appended LAST, after
  // structure gaps, posting gaps, AND interview-type expectation notes —
  // so on exactly the weak answer that produces the most structure and
  // expectation gaps (the case where this signal matters most), MAX_LIST
  // (4) sliced it off before it ever reached the caller. This answer never
  // restates the problem, never names an approach, and never acknowledges
  // a trade-off (3 technical-structure gaps), and the "technical"
  // interview type's own two expectations (approach, trade-off) go unmet
  // too — five candidate items before the documents note is even
  // considered, all ahead of it under the old (structure, posting,
  // expectations, docs) ordering, which pushed the docs note past the cap.
  it("keeps the submitted-documents note even when structure and interview-type expectation gaps alone would fill MAX_LIST (BUG-H3)", () => {
    const answer = "I have worked on backend systems for several years.";
    const resume = "Led the Kubernetes migration at Acme Corp, reducing latency by 30%.";

    const result = critiqueAnswerLocal({
      question: "Walk me through how you'd design this.",
      type: "technical",
      interviewType: "technical",
      answer,
      resume,
    });

    const docsNote = result.missing.find((m) => m.includes("never brings any of it up"));
    expect(docsNote).toBeDefined();
    expect(docsNote).toMatch(/resume you submitted for this posting/);
    expect(result.missing.length).toBeLessThanOrEqual(4);
  });
});
