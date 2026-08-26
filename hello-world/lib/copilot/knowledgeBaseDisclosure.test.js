// The privacy notice must name what is actually sent.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT, and it is one this codebase has
// shipped before and named BUG-H5: a new feature silently falsifying an
// existing disclosure. The notice enumerates what leaves the browser when a
// sample answer is revealed, and its no-posting branch reads "sends that
// question and your prep context to Gemini as well." The answer route now
// also sends, on every non-embedded reveal and regardless of whether a
// posting is selected:
//
//   - up to 12000 characters of the user's own project-page prose, and
//   - an INVENTORY OF THEIR ATTACHMENTS: file name, kind, and saved notes.
//
// The attachment inventory is a new CATEGORY of data, not more of an existing
// one, and file names are frequently sensitive in a way page bodies are not —
// "2024-severance-agreement.pdf", "offer-letter-competitor.pdf". A user
// reading the current sentence would not expect either to be sent.
//
// The clause must be UNCONDITIONAL. Gating it on whether the user has any
// pages would need a count the client does not have until after the first
// send, which is too late to disclose anything — the same reasoning
// practiceRoomQuestionPrivacy.js's own header already gives for its clause.

import { describe, it, expect } from "vitest";
import { COMPANY_FACTS_CLAUSE, buildPrivacyNotice } from "./practiceNotices.js";
import { postingGroundingNotice } from "./groundingNotice.js";
import { roomQuestionPrivacyClause } from "@/app/copilot/practice/practiceRoomQuestionPrivacy.js";

const STATES = [
  { label: "no posting", hasPosting: false, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
  { label: "posting, docs not settled", hasPosting: true, docsSettled: false, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
  { label: "posting with resume", hasPosting: true, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: false },
  { label: "posting, no docs found", hasPosting: true, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
];

describe("the practice privacy notice discloses the knowledge base", () => {
  for (const state of STATES) {
    it(`names project pages and attachment file names — ${state.label}`, () => {
      const notice = buildPrivacyNotice({ isEmbedded: false, ...state });
      const text = JSON.stringify(notice).toLowerCase();
      expect(text).toContain("project page");
      // The genuinely new category. "Pages" alone does not tell a user their
      // file names are going too.
      expect(text).toMatch(/file name|attachment/);
    });
  }

  it("says none of it when no AI provider is involved at all", () => {
    // The embedded engine makes no model call, so disclosing a transfer that
    // does not happen would be its own kind of false.
    const notice = buildPrivacyNotice({
      isEmbedded: true,
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: false,
    });
    const text = JSON.stringify(notice).toLowerCase();
    expect(text).not.toContain("project page");
  });

  it("still says everything it said before about documents and prep context", () => {
    // Positive control: the new clause must be additive. A rewrite that
    // dropped an existing disclosure to make room would pass the cases above.
    const notice = buildPrivacyNotice({
      isEmbedded: false,
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: false,
    });
    const text = JSON.stringify(notice).toLowerCase();
    expect(text).toContain("prep context");
    expect(text).toContain("resume");
  });
});

describe("the room-question clause discloses it too", () => {
  it("names project pages and attachment file names on the Gemini path", () => {
    // Same route, same payload — a question asked aloud in the room drafts
    // through the identical draftAnswer call.
    const clause = roomQuestionPrivacyClause({
      isEmbedded: false,
      hasPosting: false,
      docsSettled: true,
      hasSubmittedResume: false,
      hasSubmittedCoverLetter: false,
    }).toLowerCase();
    expect(clause).toContain("project page");
    expect(clause).toMatch(/file name|attachment/);
  });

  it("says nothing of the sort on the embedded path", () => {
    const clause = roomQuestionPrivacyClause({
      isEmbedded: true,
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: true,
    }).toLowerCase();
    expect(clause).not.toContain("project page");
  });
});

// LIVE mode got none of this, and live mode sends the same payload.
//
// Practice mode's notice was corrected and `postingGroundingNotice` — the one
// live mode renders — was not. That is the "one half of a pair updated" shape:
// two surfaces, one route, one payload, and only one of them told the truth
// about it. Worse than practice's original gap, because this notice returns
// the empty string outright when no posting is selected, which is the ordinary
// live-mode state — so in the common case live mode disclosed nothing at all
// about a transfer it now performs on every single drafted answer.
describe("live mode discloses the knowledge base too", () => {
  it("names project pages and attachment file names even with no posting selected", async () => {
    const { postingGroundingNotice } = await import("./groundingNotice.js");
    const notice = String(
      postingGroundingNotice({ isEmbedded: false, posting: null, docsSettled: true, resume: null, coverLetter: null }) || "",
    ).toLowerCase();
    expect(notice).toContain("project page");
    expect(notice).toMatch(/file name|attachment/);
  });

  it("says nothing of the sort when no AI provider is involved", async () => {
    const { postingGroundingNotice } = await import("./groundingNotice.js");
    const notice = String(
      postingGroundingNotice({ isEmbedded: true, posting: null, docsSettled: true, resume: null, coverLetter: null }) || "",
    ).toLowerCase();
    expect(notice).not.toContain("project page");
  });
});

// ---------------------------------------------------------------------------
// P1 (BUG-H5 a third time): the company-facts search is an outbound transfer
// that nothing disclosed.
//
// app/api/copilot/answer/route.js fires `buildCompanyFacts` whenever
// `mode !== "answer" && !wantsEmbedded(engine) && companyKnown`. Live mode's
// `draftAnswer`/`draftAnswerStreaming` send no `mode` at all, and practice
// mode's room-question and typed-question paths (useRoomQuestions.js) send
// none either, so BOTH surfaces take that branch on every drafted answer for
// a posting whose `positions.company` is non-empty. It sends the company name
// and the job title to Google Gemini with `googleSearch` enabled, and then
// THIS SERVER fetches the resulting third-party pages
// (`resolveGroundedSources` -> `fetchUrlContent`) to check the facts against
// them. It fires automatically, on question one, with nothing clicked.
//
// Practice mode's REVEALED SAMPLE ANSWER is deliberately not in this sweep:
// `useSampleAnswer.js` passes `mode: "answer"`, which is the one value that
// route branch excludes, so no search fires for it and disclosing one there
// would name a destination that receives nothing (R-098).
//
// WHY THE SWEEP IS EXHAUSTIVE RATHER THAN A SPOT CHECK. R-259's third defect
// was a sentence that was true only in the position it happened to land in,
// and the reason it survived review is that it was only ever asserted THERE.
// A disclosure gated on the wrong dimension passes any test that exercises a
// single state. So every state is enumerated below in both directions: the
// clause is asserted PRESENT wherever the search actually fires and ABSENT
// wherever it cannot. The absence half is what catches a clause pinned to the
// documents ternary (P1.5) or hand-copied onto one branch.
//
// `hasCompany` is the exact predicate for "this request fires", not an
// approximation: the client value (CopilotClient.js, PracticeClient.js) and
// the server's `companyKnown` (route.js, via `fetchPostingEmployer`) read the
// SAME `positions.company` column. So R-098's rule — never name a destination
// that receives nothing — is satisfied exactly, and R-098's opposite failure,
// silence about a request that IS issued, is what this block closes.
describe("the company-facts search is disclosed wherever it fires, and nowhere else", () => {
  const posting = { id: "app-1", title: "Staff Engineer", company: "Acme Corp" };
  const FACTS = COMPANY_FACTS_CLAUSE;
  // hasCompany x docs-settled x resume-present x engine, live AND practice.
  // Written as a product rather than a hand-picked list, because a
  // hand-picked list is how every fixture in groundingNotice.test.js came to
  // fix `company: "Acme Corp"` and hide the missing `hasCompany` guard.
  const BOOLS = [true, false];

  describe("live mode (postingGroundingNotice)", () => {
    for (const isEmbedded of BOOLS) {
      for (const hasCompany of BOOLS) {
        for (const docsSettled of BOOLS) {
          for (const hasResume of BOOLS) {
            const fires = !isEmbedded && hasCompany;
            const label = `isEmbedded=${isEmbedded} hasCompany=${hasCompany} docsSettled=${docsSettled} resume=${hasResume}`;
            it(`${fires ? "discloses" : "stays silent about"} the search — ${label}`, () => {
              const notice = postingGroundingNotice({
                posting,
                isEmbedded,
                docsStatus: docsSettled ? "done" : "loading",
                resume: hasResume ? "R" : "",
                coverLetter: "",
                hasCompany,
              });
              if (fires) expect(notice).toContain(FACTS);
              else expect(notice).not.toContain(FACTS);
            });
          }
        }
      }
    }

    it("says nothing about it with no posting selected, on either engine", () => {
      // `hasCompany` is derived from the SELECTED posting's own company
      // (CopilotClient.js), so it is false whenever nothing is selected — and
      // with no application id the route's `fetchPostingEmployer` returns an
      // empty employer, `companyKnown` is false, and no search fires.
      for (const isEmbedded of BOOLS) {
        expect(
          postingGroundingNotice({
            posting: null,
            isEmbedded,
            docsStatus: "done",
            resume: "",
            coverLetter: "",
            hasCompany: false,
          }),
        ).not.toContain(FACTS);
      }
    });

    // P1.5, its own case because it is the failure this arrangement exists to
    // prevent: the SAME posting, the SAME company, the SAME outbound search —
    // the only thing that changes is whether a document was submitted with the
    // application. A clause living inside the documents ternary disappears on
    // one of these and passes every test that only exercised the other.
    it("does not depend on the document dimension at all", () => {
      const base = { posting, isEmbedded: false, hasCompany: true };
      const states = [
        { ...base, docsStatus: "loading" },
        { ...base, docsStatus: "error" },
        { ...base, docsStatus: "idle" },
        { ...base, docsStatus: "done", resume: "R", coverLetter: "C" },
        { ...base, docsStatus: "done", resume: "R" },
        { ...base, docsStatus: "done", coverLetter: "C" },
        { ...base, docsStatus: "done", resume: "", coverLetter: "" },
      ];
      for (const args of states) {
        expect(postingGroundingNotice(args)).toContain(FACTS);
        // Exactly once, in every one of them: a clause appended twice (once
        // alongside, once still inside a branch) reads as two transfers.
        expect(postingGroundingNotice(args).split(FACTS)).toHaveLength(2);
      }
    });

    // P1.2: the cue sentence is KEPT, and it comes after the unconditional
    // one, so a reader meets the transfer that always happens before the one
    // that happens only when they ask. Ordering is the point — the cue
    // sentence being the only place the company transfer was ever named is
    // what made it read as "asking is the only way company data leaves".
    it("puts the unconditional transfer before the voice-cue one", () => {
      const notice = postingGroundingNotice({
        posting,
        isEmbedded: false,
        docsStatus: "done",
        resume: "",
        coverLetter: "",
        hasCompany: true,
      });
      expect(notice).toContain("asking to research the company");
      expect(notice.indexOf(FACTS)).toBeLessThan(notice.indexOf("asking to research the company"));
    });

    // And the cue sentence itself is no longer decided by the documents
    // either: it is the same fact about the same posting whether or not a
    // résumé was attached to the application.
    it("keeps the voice-cue sentence on every document state", () => {
      for (const args of [
        { posting, isEmbedded: false, hasCompany: true, docsStatus: "loading" },
        { posting, isEmbedded: false, hasCompany: true, docsStatus: "done", resume: "R", coverLetter: "C" },
        { posting, isEmbedded: false, hasCompany: true, docsStatus: "done" },
      ]) {
        expect(postingGroundingNotice(args)).toContain("asking to research the company");
      }
    });
  });

  describe("practice mode (roomQuestionPrivacyClause)", () => {
    // P1.6. `useRoomQuestions.js` calls `draftAnswer` with an `applicationId`
    // and no `mode`, so a detected room question and a typed one fire the
    // identical search live mode does.
    for (const isEmbedded of BOOLS) {
      for (const hasCompany of BOOLS) {
        for (const docsSettled of BOOLS) {
          for (const hasResume of BOOLS) {
            const fires = !isEmbedded && hasCompany;
            const label = `isEmbedded=${isEmbedded} hasCompany=${hasCompany} docsSettled=${docsSettled} resume=${hasResume}`;
            it(`${fires ? "discloses" : "stays silent about"} the search — ${label}`, () => {
              const clause = roomQuestionPrivacyClause({
                isEmbedded,
                hasPosting: true,
                docsSettled,
                hasSubmittedResume: hasResume,
                hasSubmittedCoverLetter: false,
                hasCompany,
              });
              if (fires) expect(clause).toContain(FACTS);
              else expect(clause).not.toContain(FACTS);
            });
          }
        }
      }
    }

    it("says nothing about it with no posting selected", () => {
      expect(
        roomQuestionPrivacyClause({
          isEmbedded: false,
          hasPosting: false,
          docsSettled: true,
          hasSubmittedResume: false,
          hasSubmittedCoverLetter: false,
          hasCompany: false,
        }),
      ).not.toContain(FACTS);
    });

    it("does not depend on the document dimension here either", () => {
      const base = { isEmbedded: false, hasPosting: true, hasCompany: true };
      for (const args of [
        { ...base, docsSettled: false, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
        { ...base, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: true },
        { ...base, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: false },
        { ...base, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: true },
        { ...base, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: false },
      ]) {
        expect(roomQuestionPrivacyClause(args)).toContain(FACTS);
        expect(roomQuestionPrivacyClause(args).split(FACTS)).toHaveLength(2);
      }
    });

    // The sample-answer notice is the other half of practice mode's stack and
    // must NOT carry this clause: `mode: "answer"` is excluded at the route,
    // so revealing a sample answer runs no search.
    it("is absent from the sample-answer notice, which runs no search", () => {
      for (const docsSettled of BOOLS) {
        expect(
          buildPrivacyNotice({
            isEmbedded: false,
            framesWillUpload: true,
            hasPosting: true,
            docsSettled,
            hasSubmittedResume: true,
            hasSubmittedCoverLetter: false,
            saveEnabled: true,
          }),
        ).not.toContain(FACTS);
      }
    });
  });

  // ONE constant, two surfaces. A hand-copied second sentence is exactly how
  // half a pair gets fixed (R-259's second defect), and it is why
  // KNOWLEDGE_BASE_CLAUSE exists as a shared export at all.
  it("is one shared sentence, not two hand-copied ones", () => {
    const live = postingGroundingNotice({
      posting,
      isEmbedded: false,
      docsStatus: "done",
      resume: "R",
      coverLetter: "",
      hasCompany: true,
    });
    const practice = roomQuestionPrivacyClause({
      isEmbedded: false,
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: false,
      hasCompany: true,
    });
    expect(live).toContain(COMPANY_FACTS_CLAUSE);
    expect(practice).toContain(COMPANY_FACTS_CLAUSE);
  });

  // The sentence itself, checked against every fact the transfer actually
  // consists of. A disclosure that names the recipient but not the
  // server-side page fetch is the P1.3 failure: the embedded engine's own
  // notice has disclosed its page fetch since BL-1 ruled that a materially
  // different fact, and the Gemini path now does the same thing.
  it("names the company, the title, the recipient, the search, the fetch, and the trigger", () => {
    const c = COMPANY_FACTS_CLAUSE.toLowerCase();
    expect(c).toContain("company name");
    expect(c).toContain("job's title");
    expect(c).toContain("google gemini");
    expect(c).toMatch(/web search/);
    expect(c).toMatch(/this server then fetches/);
    // The trigger: on every drafted answer, not when the user asks for it.
    expect(c).toMatch(/automatically/);
    expect(c).toMatch(/not only when you ask/);
    // A screen reader does not speak an em dash as a pause at default
    // punctuation settings (AC-T2.14/E2), and this sentence is rendered.
    expect(COMPANY_FACTS_CLAUSE).not.toMatch(/[—–]/);
  });
});
