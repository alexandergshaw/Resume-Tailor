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
import { shouldTreatAsRoomQuestion } from "@/lib/copilot/roomQuestions";
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

// The clause promised a transfer "If someone else in the room asks a question"
// while shouldTreatAsRoomQuestion sent the CANDIDATE'S OWN tagged speech for
// the whole window before their first answer completed. Two of these bind the
// wording to the rule by EXECUTING it rather than restating it, so a later
// loosening of the rule breaks the disclosure's test rather than silently
// falsifying the disclosure. The wire trace of the same fix — which routes,
// which fields, which engines — is
// app/copilot/practice/useRoomQuestions.ownSpeech.test.js.
describe("the room-question clause describes the gate the code actually applies", () => {
  const ALL = [
    { isEmbedded: true, hasPosting: true, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: false, hasCompany: true },
    { isEmbedded: false, hasPosting: false, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: false, hasCompany: false },
    { isEmbedded: false, hasPosting: true, docsSettled: false, hasSubmittedResume: false, hasSubmittedCoverLetter: false, hasCompany: true },
    { isEmbedded: false, hasPosting: true, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: true, hasCompany: false },
  ];

  it("states the voice gate on every branch, once, in the same words", () => {
    // One shared constant, both engines. A hand-copied second sentence is how
    // half a pair gets fixed — the same reason KNOWLEDGE_BASE_CLAUSE is shared.
    const gate = roomQuestionPrivacyClause(ALL[0]).split(" After that,")[0];
    expect(gate).toMatch(/until the app can tell your voice from theirs/);
    for (const args of ALL) {
      const clause = roomQuestionPrivacyClause(args);
      expect(clause.startsWith(`${gate} After that,`)).toBe(true);
      expect(clause.split(gate)).toHaveLength(2);
    }
  });

  it("names both preconditions the rule really has, and the rule really has them", () => {
    // Executed, not asserted from memory. `myTag` is null until an answer with
    // a tagged final completes (usePracticeAnswer.js), and it can only ever
    // become non-null if the provider labels speakers at all — so a session
    // with neither sends nothing, which is what the sentence claims.
    expect(shouldTreatAsRoomQuestion({ speakerTag: 1, myTag: null, collecting: false })).toBe(false);
    expect(shouldTreatAsRoomQuestion({ speakerTag: undefined, myTag: 1, collecting: false })).toBe(false);
    // And once both hold, it does fire — or the sentence would be describing a
    // feature that never runs.
    expect(shouldTreatAsRoomQuestion({ speakerTag: 0, myTag: 1, collecting: false })).toBe(true);

    const clause = roomQuestionPrivacyClause(ALL[1]);
    expect(clause).toMatch(/labels speakers/);
    expect(clause).toMatch(/one completed answer from you/);
  });

  it("never promises detection unconditionally, on either engine", () => {
    // The exact wording that was false: an unqualified "If someone else in the
    // room asks a question, …" leading the clause, with no gate before it.
    for (const args of ALL) {
      expect(roomQuestionPrivacyClause(args)).not.toMatch(/^If someone else in the room asks a question/);
    }
  });

  it("does not claim the embedded engine detects on the server", () => {
    // detectClient.js short-circuits to localDetection in the browser for this
    // engine; /api/copilot/detect is never called. Only the draft is a request.
    const clause = roomQuestionPrivacyClause(ALL[0]);
    expect(clause).toContain("detected in your browser and answered on this server");
    expect(clause).not.toContain("detected and answered on this server");
  });

  it("says a typed question is exempt from the gate, because it is", () => {
    // addManualQuestion (useRoomQuestions.js) never calls
    // shouldTreatAsRoomQuestion at all, so it drafts before any answer has
    // completed. That is the escape hatch the gate's cost is paid with, and a
    // clause that omitted it would leave the gate reading as a dead end.
    for (const args of ALL) {
      expect(roomQuestionPrivacyClause(args)).toContain("not subject to that gate");
    }
  });
});
