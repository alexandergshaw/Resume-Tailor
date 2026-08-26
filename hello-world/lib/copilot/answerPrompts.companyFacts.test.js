import { describe, expect, it } from "vitest";
import { buildPointsPrompt, buildAnswerPrompt } from "./answerPrompts";
import { interviewType } from "./interviewTypes";

// AC-V4.3/V4.4/V4.7. What the live points prompt says about the employer.
//
// In the session the user recorded on 2026-08-25, asked "What do you know
// about Purple Wave?", the copilot produced "My research indicates a strong
// focus on continuous improvement and operating as a data-driven, evolving
// organization" — about an online heavy-equipment auction company. Not one
// sentence was a fact about the employer; all of it was job-description
// vocabulary reflected back, and "my research indicates" asserted research
// that never happened, for the candidate to read out loud.
//
// The cause is in this module: buildPointsPrompt has no company source of any
// kind. Its inputs are the question, the transcript, the prep notes, the
// project pages and the submitted documents.
//
// The hard constraint this change works inside: AC-H4.17's BYTE-IDENTITY
// guarantee. With no résumé, no cover letter and no pages block, this builder
// must produce exactly what it produced before any of those sources existed —
// which is what answerPrompts.test.js's FROZEN_POINTS_PROMPT_NO_PAGES pins
// with a full-string `toBe`. Every case below is written so that guarantee is
// checked in BOTH directions: nothing may be added when the employer is
// unknown, and something specific must be added when it is.

const DESCRIPTOR = interviewType("general");

const FACTS = [
  {
    id: "fact-0",
    claim:
      "Purple Wave is an online auction marketplace for used heavy equipment and farm machinery.",
    url: "https://www.purplewave.com/about",
    kind: "what",
  },
  {
    id: "fact-1",
    claim: "Purple Wave has run online-only auctions from Manhattan, Kansas since 2000.",
    url: "https://www.purplewave.com/company",
    kind: "size",
  },
];

const BLOCK = FACTS.map((f) => `(fact id: ${f.id}) ${f.claim}`).join("\n");

function minimalArgs(companyFacts) {
  // The exact minimal input the frozen test uses: question, no context, no
  // profile, no résumé, no cover letter, no pages.
  return ["What do you know about Purple Wave?", "", "", DESCRIPTOR, "", "", "", companyFacts];
}

describe("no employer is known — the prompt is untouched (AC-V4.3)", () => {
  it("produces byte-identical output whether the parameter is absent or undefined", () => {
    // The guarantee stated as an equality rather than as a frozen literal, so
    // this case cannot drift out of sync with the frozen one: adding an
    // unconditional line breaks BOTH, and adding a line gated on the new
    // parameter breaks neither.
    const without = buildPointsPrompt(...minimalArgs().slice(0, 7));
    const withUndefined = buildPointsPrompt(...minimalArgs(undefined));
    expect(withUndefined).toBe(without);
  });

  it("mentions nothing about company facts", () => {
    const prompt = buildPointsPrompt(...minimalArgs(undefined));
    expect(prompt).not.toContain("VERIFIED COMPANY FACTS");
    expect(prompt).not.toContain("factIds");
    expect(prompt).not.toContain("fact id");
    expect(prompt).not.toContain("employer");
  });
});

describe("the employer is known and facts survived (AC-V4.3/V4.4)", () => {
  const prompt = () =>
    buildPointsPrompt(...minimalArgs({ companyKnown: true, block: BLOCK }));

  it("carries the facts under their own heading", () => {
    const out = prompt();
    expect(out).toContain("VERIFIED COMPANY FACTS");
    expect(out).toContain(FACTS[0].claim);
    expect(out).toContain(FACTS[1].claim);
    expect(out).toContain("(fact id: fact-0)");
  });

  it("does not put the source URLs in the prompt", () => {
    // The route already holds the real URL and hands it to the candidate
    // through the whitelist. Putting it in the prompt only creates a second
    // copy for the model to paraphrase, and invites it to emit a URL of its
    // own — the same rule pageCitations.js states for page titles.
    const out = prompt();
    expect(out).not.toContain("https://www.purplewave.com");
  });

  it("forbids asserting anything about the employer that is not in the block", () => {
    const out = prompt();
    expect(out).toMatch(/only from VERIFIED COMPANY FACTS/i);
  });

  it("names the fabricated-research phrasings explicitly", () => {
    // AC-V4.4. A general "do not invent" instruction is what the prompt
    // already had for experience, and the model still wrote "My research
    // indicates". Naming the specific phrasings is the difference between a
    // rule and a hope.
    const out = prompt();
    expect(out.toLowerCase()).toContain("my research indicates");
  });

  it("asks for factIds, declared after points in the JSON shape", () => {
    // Declared AFTER `points` for the same reason `pageIds` is: the streaming
    // path's pointsFromPartialJson anchors on /"points"\s*:\s*\[/ and stops at
    // that array's close, so an earlier field delays the first streamed
    // bullet for no benefit. This is a LATENCY property expressed in a string,
    // which is why it is asserted on the order rather than on presence.
    const out = prompt();
    const shapeLine = out.split("\n").find((line) => line.includes("Return ONLY JSON"));
    expect(shapeLine).toBeTruthy();
    expect(shapeLine).toContain("factIds");
    expect(shapeLine.indexOf('"points"')).toBeLessThan(shapeLine.indexOf("factIds"));
  });

  it("tells the model never to cite a fact it was not shown", () => {
    expect(prompt()).toMatch(/never (invent|cite)/i);
  });
});

describe("the employer is known and NO facts survived (AC-V4.7)", () => {
  const prompt = () => buildPointsPrompt(...minimalArgs({ companyKnown: true, block: "" }));

  it("adds no heading and no empty block", () => {
    // An empty heading is worse than silence: it tells the model a section of
    // verified facts exists and happens to be blank, which is an invitation
    // to fill it. The same reasoning that made a heading-only page block a
    // defect in this repo before.
    const out = prompt();
    expect(out).not.toContain("VERIFIED COMPANY FACTS");
    expect(out).not.toContain("fact id");
  });

  it("does not ask for factIds it could never validate", () => {
    expect(prompt()).not.toContain("factIds");
  });

  it("instructs the model to assert nothing about the employer", () => {
    // The honest-refusal case, and the boundary that makes the positive case
    // above mean something: this is what the copilot should have done for
    // "What do you know about Purple Wave?" instead of inventing four
    // sentences of platitude.
    const out = prompt();
    expect(out).toMatch(/no verified facts about the employer/i);
    expect(out).toMatch(/do not assert anything about the employer/i);
  });

  it("is not byte-identical to the unknown-employer prompt", () => {
    // The two states are different facts and must produce different prompts.
    // Collapsing them is the easy way to satisfy the byte-identity guarantee
    // and it silently removes the only instruction that stops the model from
    // inventing.
    expect(prompt()).not.toBe(buildPointsPrompt(...minimalArgs(undefined)));
  });
});

describe("practice mode's prompt is out of scope and untouched", () => {
  it("takes no company facts and mentions none", () => {
    // V4 is scoped to the live path — the one that fires mid-interview. The
    // answer prompt's own byte-identity tests must stay untouched by
    // construction rather than by care.
    const out = buildAnswerPrompt({
      question: "What do you know about Purple Wave?",
      context: "",
      profile: "",
      resume: "",
      coverLetter: "",
      descriptor: DESCRIPTOR,
      pagesBlock: "",
      companyFacts: { companyKnown: true, block: BLOCK },
    });
    expect(out).not.toContain("VERIFIED COMPANY FACTS");
    expect(out).not.toContain("factIds");
  });
});
