// P1.6. The practice-mode half of the company-facts disclosure, and — the
// part a behavioural test cannot see — whether the caller actually passes the
// fact it is gated on.
//
// WHY A SOURCE-TEXT CHECK BELONGS HERE, which is normally a poor kind of
// test. `roomQuestionPrivacyClause` is a pure function of its arguments, so
// lib/copilot/knowledgeBaseDisclosure.test.js can and does sweep every state
// of it exhaustively. What that sweep cannot observe is a caller that never
// passes `hasCompany` at all: the clause would then be permanently absent in
// the running app while every behavioural assertion stayed green — the exact
// shape this repo has already shipped (twenty-seven passing tests against an
// extraction whose caller imported none of it, see
// app/copilot/useLiveSession.split.test.js's own header). A disclosure that is
// correct in the module and missing on the screen is not a disclosure.
//
// The live half needs no equivalent: CopilotClient.js has threaded
// `hasCompany` into `postingGroundingNotice` and VoiceCueSidebar since R-098's
// defect-1 amendment, and groundingNotice.test.js pins that.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { roomQuestionPrivacyClause } from "./practiceRoomQuestionPrivacy.js";
import { COMPANY_FACTS_CLAUSE, KNOWLEDGE_BASE_CLAUSE } from "@/lib/copilot/practiceNotices";

const PRACTICE_CLIENT = readFileSync(fileURLToPath(new URL("./PracticeClient.js", import.meta.url)), "utf8");

describe("the practice notice's company-facts clause is actually wired up (P1.6)", () => {
  it("PracticeClient derives hasCompany from the selected posting's own company", () => {
    // The same derivation CopilotClient.js uses for live mode, and the same
    // fact the answer route reads as `companyKnown` — trimmed, so a posting
    // row carrying only whitespace is not treated as having a company.
    expect(PRACTICE_CLIENT).toMatch(/const hasCompany = !!String\(posting\?\.company \|\| ""\)\.trim\(\)/);
  });

  it("and passes it to roomQuestionPrivacyClause", () => {
    const call = PRACTICE_CLIENT.match(/roomQuestionPrivacyClause\(\{[^}]*\}\)/);
    expect(call).not.toBeNull();
    expect(call[0]).toContain("hasCompany");
  });
});

describe("roomQuestionPrivacyClause — the shape of the Gemini branches", () => {
  const base = {
    isEmbedded: false,
    hasPosting: true,
    docsSettled: true,
    hasSubmittedResume: false,
    hasSubmittedCoverLetter: false,
  };

  it("ends every branch with the same shared tail, in the same order", () => {
    // Both shared sentences are appended through ONE tail rather than per
    // branch, which is what makes it structurally impossible for a documents
    // branch to decide whether either is stated (P1.5). Asserted as a suffix
    // so a fourth branch added later cannot quietly drop one of them.
    const tail = ` ${COMPANY_FACTS_CLAUSE}${KNOWLEDGE_BASE_CLAUSE}`;
    for (const args of [
      { ...base, hasCompany: true, hasPosting: false },
      { ...base, hasCompany: true, docsSettled: false },
      { ...base, hasCompany: true, hasSubmittedResume: true },
      { ...base, hasCompany: true },
    ]) {
      expect(roomQuestionPrivacyClause(args).endsWith(tail)).toBe(true);
    }
  });

  it("still says everything it said before about documents and typed questions", () => {
    // Positive control: the new clause is additive. A rewrite that dropped an
    // existing disclosure to make room would pass every presence assertion.
    const clause = roomQuestionPrivacyClause({ ...base, hasCompany: true, hasSubmittedResume: true });
    expect(clause).toContain("resume you submitted for the selected posting");
    expect(clause).toContain("A question you type yourself");
    expect(clause).toContain("your prep context");
  });

  it("says none of it on the embedded engine, company or no company", () => {
    for (const hasCompany of [true, false]) {
      const clause = roomQuestionPrivacyClause({ ...base, isEmbedded: true, hasCompany });
      expect(clause).not.toContain(COMPANY_FACTS_CLAUSE);
      expect(clause).toContain("no AI provider involved");
    }
  });
});
