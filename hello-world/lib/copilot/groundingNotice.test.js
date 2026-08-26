import { describe, it, expect } from "vitest";
import {
  submittedDocsClause,
  postingGroundingNotice,
  companyResearchDestination,
  answerCompanyFactsNotice,
} from "./groundingNotice.js";
import { COMPANY_FACTS_CLAUSE, KNOWLEDGE_BASE_CLAUSE } from "./practiceNotices.js";

// AC-X1. `submittedDocsClause` and the `postingGroundingNotice` ternary chain
// MOVE here out of app/copilot/CopilotClient.js, which is at 975 lines and
// cannot absorb group T's wiring while staying under this project's 1000-line
// cap.
//
// This is a privacy notice (BUG-H5/AC-H6.24/AC-H6.25), so the move must be
// behaviour-preserving to the BYTE. Every expected string below is a literal
// oracle lifted from `git show HEAD:app/copilot/CopilotClient.js` — not
// paraphrased, not re-derived from the implementation — so a "tidy-up" during
// the move turns this file red rather than quietly changing what the app
// claims about where a user's documents go.

const RESUME_AND_COVER =
  "the résumé and cover letter you submitted for it are also sent to Google Gemini to ground your talking points";
const RESUME_ONLY =
  "the résumé you submitted for it is also sent to Google Gemini to ground your talking points";
const COVER_ONLY =
  "the cover letter you submitted for it is also sent to Google Gemini to ground your talking points";
// AC-T2.14/E1 (Group T amendment, adversarial review): this oracle is
// DELIBERATELY updated in the same change as the source. The old string
// ("...so nothing about this application is sent to Google.") went from true
// to false once the company-research voice cue shipped: on the embedded
// engine that cue's route (`researchCompanyLocal` -> `searchPostingUrls` in
// lib/scrape/webSearch.js) sends the company name to Google Programmable
// Search when that provider is configured. The claim is now scoped to what
// remains true — no AI provider drafts the talking points themselves — so
// this pinned string was intentionally reworded, not accidentally drifted.
const EMBEDDED =
  " The embedded engine drafts talking points on this server with no AI provider, so nothing is sent to Google to draft them.";
const UNSETTLED =
  " Because you selected a posting, any résumé or cover letter you submitted for it may also be sent to Google Gemini to ground your talking points.";
// AC-T2.14/E3: the branch this used to be silent on (posting selected, docs
// settled, neither found) can still send data on a company-research cue —
// on the non-embedded engine that branch is reached on, the route always
// uses Gemini — so it is no longer "".
const COMPANY_RESEARCH_ONLY =
  " Because you selected a posting, asking to research the company also sends its name, this job's title and the posting text to Google Gemini.";
// Live mode's knowledge-base disclosure. Every oracle below that describes a
// GEMINI-path notice is the old pinned string PLUS this one — the additive
// shape the fix required, so a rewrite that dropped an existing disclosure to
// make room still fails here. The constant is IMPORTED from
// practiceNotices.js rather than re-typed, exactly as the source is: practice
// mode, a room question and a live drafted answer are one payload, and
// lib/copilot/practiceNotices.test.js already pins its bytes.
const KB = KNOWLEDGE_BASE_CLAUSE;
// P1: the company-facts transfer — the company name and job title to Google
// Gemini with search enabled, plus this server's own fetch of the pages that
// search returns, on every drafted answer. IMPORTED for the same reason KB is:
// one payload, one description of it, shared with practice mode, and its bytes
// are pinned by lib/copilot/knowledgeBaseDisclosure.test.js.
const FACTS = COMPANY_FACTS_CLAUSE;
// The sentence that discloses the live draft's own transfer — the question,
// the recent transcript and the prep context — when the posting clause is
// empty and nothing else would say so. Only reachable on the Gemini path.
//
// It used to be described here as the ANTECEDENT of the knowledge-base
// clause's opening "It also sends…". That was the wrong job for it: the same
// clause is appended by practiceNotices.js and practiceRoomQuestionPrivacy.js
// after sentences with entirely different subjects, so the clause names its
// own subject now and this sentence is kept only for the disclosure it makes
// on its own account.
const LIVE_DRAFT =
  " Drafting an answer sends the question, the recent transcript and your prep context to Google Gemini.";

describe("submittedDocsClause — names only the documents that exist (AC-H6.25)", () => {
  it("names both when both exist", () => {
    expect(submittedDocsClause(true, true)).toBe(RESUME_AND_COVER);
  });

  it("names only the résumé when only a résumé exists", () => {
    expect(submittedDocsClause(true, false)).toBe(RESUME_ONLY);
  });

  it("names only the cover letter when only a cover letter exists", () => {
    expect(submittedDocsClause(false, true)).toBe(COVER_ONLY);
  });

  // AC-T2.14/E4 (Group T amendment, adversarial review): the module-private
  // version of this function had exactly one caller, which always checked
  // `hasResume || hasCoverLetter` first, so `(false, false)` was
  // unreachable. AC-X1 made this a public `lib/` export with no such
  // guarantee, and the unguarded final branch silently returned the
  // cover-letter claim for this input — a false statement that a document
  // was sent when neither exists. Pinned here so that trap cannot return.
  it("names nothing when neither document exists", () => {
    expect(submittedDocsClause(false, false)).toBe("");
  });
});

describe("postingGroundingNotice — derived from current state (AC-H6.24)", () => {
  const posting = { id: "app-1", title: "Staff Engineer", company: "Acme Corp" };

  it("says nothing about the APPLICATION when no posting is selected", () => {
    // Updated deliberately, in the same change as the source. This used to
    // assert "" and that was the defect: nothing about an APPLICATION leaves
    // the browser with no posting selected, but the user's project pages and
    // their attachment file names go on every drafted answer either way, and
    // "no posting selected" is the ordinary live-mode state — so the notice
    // that said nothing was disclosing nothing about the transfer it performs
    // most often. What is pinned now is that the application-specific claims
    // are still absent and only the knowledge-base disclosure is present.
    const notice = postingGroundingNotice({
      posting: null,
      isEmbedded: false,
      docsStatus: "done",
      resume: "R",
      coverLetter: "C",
    });
    expect(notice).toBe(`${LIVE_DRAFT}${KB}`);
    expect(notice).not.toContain("Because you selected a posting");
    expect(notice).not.toContain("résumé");
    // Even on the embedded engine, and even mid-load: with nothing selected,
    // nothing about any application can leave the browser, and no model call
    // is made at all on this engine, so there is no claim — true or false —
    // to make.
    expect(postingGroundingNotice({ posting: null, isEmbedded: true, docsStatus: "loading" })).toBe("");
  });

  it("states the embedded engine sends nothing to Google, whatever the load found", () => {
    expect(postingGroundingNotice({ posting, isEmbedded: true, docsStatus: "loading" })).toBe(EMBEDDED);
    expect(postingGroundingNotice({ posting, isEmbedded: true, docsStatus: "done", resume: "R", coverLetter: "C" })).toBe(EMBEDDED);
    expect(postingGroundingNotice({ posting, isEmbedded: true, docsStatus: "done" })).toBe(EMBEDDED);
  });

  it("hedges with 'may' while the document load has not settled", () => {
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "loading" })).toBe(`${UNSETTLED}${KB}`);
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "error" })).toBe(`${UNSETTLED}${KB}`);
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "idle" })).toBe(`${UNSETTLED}${KB}`);
  });

  it("names exactly what was found once the load has settled", () => {
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done", resume: "R", coverLetter: "C" })).toBe(
      ` Because you selected a posting, ${RESUME_AND_COVER}.${KB}`,
    );
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done", resume: "R" })).toBe(
      ` Because you selected a posting, ${RESUME_ONLY}.${KB}`,
    );
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done", coverLetter: "C" })).toBe(
      ` Because you selected a posting, ${COVER_ONLY}.${KB}`,
    );
  });

  // The half of the pair that shipped without its other half. Practice mode's
  // notice already named the project pages and the attachment file names;
  // this one, on the same route and the same payload, named neither — and
  // fell silent entirely in the state live mode is usually in.
  it("discloses the knowledge base on EVERY Gemini branch, including no posting at all", () => {
    for (const args of [
      { posting: null, isEmbedded: false, docsStatus: "done" },
      { posting, isEmbedded: false, docsStatus: "loading" },
      { posting, isEmbedded: false, docsStatus: "done", resume: "R", coverLetter: "C" },
      { posting, isEmbedded: false, docsStatus: "done", hasCompany: true },
      { posting, isEmbedded: false, docsStatus: "done", hasCompany: false },
    ]) {
      expect(postingGroundingNotice(args)).toContain(KB);
    }
    // And never on the embedded path, which makes no model call to draft an
    // answer at all.
    expect(postingGroundingNotice({ posting, isEmbedded: true, docsStatus: "done" })).not.toContain("project pages");
    expect(postingGroundingNotice({ posting: null, isEmbedded: true, docsStatus: "done" })).not.toContain("project pages");
  });

  it("names the company-research destination once the load settles with neither document found (AC-T2.14/E3)", () => {
    // The answer route's own `if (resume || coverLetter)` guard still means
    // nothing document-related is sent in this case, so the "resume/cover
    // letter" claim would still be false here — but a company-research voice
    // cue reaches this same non-embedded branch and always uses Gemini, so
    // this is no longer silent about that. `hasCompany: true` is required to
    // reach this branch at all — see the defect-1 guard test below.
    //
    // P1: this oracle is DELIBERATELY updated in the same change as the
    // source, and the shape of the update is the fix. The cue sentence used
    // to be the terminal branch of the documents ternary, which is why it was
    // once the WHOLE notice here; it is now appended alongside, after the
    // unconditional company-facts sentence, and the documents branch is
    // simply empty in this state — so LIVE_DRAFT_DESTINATION supplies the
    // question/transcript/prep-context disclosure that branch no longer
    // carries. The cue clause's own bytes are unchanged, which is what this
    // case was always for; what changed is that it no longer stands alone,
    // because it is no longer the only company transfer live mode makes.
    const expected = `${LIVE_DRAFT} ${FACTS}${COMPANY_RESEARCH_ONLY}${KB}`;
    expect(
      postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done", resume: "", coverLetter: "", hasCompany: true }),
    ).toBe(expected);
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done", hasCompany: true })).toBe(expected);
    // The cue sentence still says exactly what it said, byte for byte, and is
    // still reached only with a company on file.
    expect(
      postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done", hasCompany: true }),
    ).toContain(COMPANY_RESEARCH_ONLY);
  });

  // P1.5, pinned here as well as in knowledgeBaseDisclosure.test.js's sweep,
  // because this file is where the ternary itself lives: the company clauses
  // are appended ALONGSIDE the documents notice, so the documents dimension
  // cannot decide whether either is stated. Attaching a résumé to the
  // application does not stop the facts search from firing, and must not stop
  // the disclosure from rendering.
  it("states both company clauses whatever the documents load found", () => {
    for (const args of [
      { posting, isEmbedded: false, docsStatus: "loading", hasCompany: true },
      { posting, isEmbedded: false, docsStatus: "done", resume: "R", coverLetter: "C", hasCompany: true },
      { posting, isEmbedded: false, docsStatus: "done", resume: "R", hasCompany: true },
      { posting, isEmbedded: false, docsStatus: "done", hasCompany: true },
    ]) {
      const notice = postingGroundingNotice(args);
      expect(notice).toContain(FACTS);
      expect(notice).toContain(COMPANY_RESEARCH_ONLY);
      // And in that order: the transfer that always happens, then the one
      // that happens only when asked for (P1.2).
      expect(notice.indexOf(FACTS)).toBeLessThan(notice.indexOf(COMPANY_RESEARCH_ONLY));
    }
    // Neither, with no company on file — no request of either kind can fire.
    const noCompany = postingGroundingNotice({
      posting,
      isEmbedded: false,
      docsStatus: "done",
      resume: "R",
      hasCompany: false,
    });
    expect(noCompany).not.toContain(FACTS);
    expect(noCompany).not.toContain(COMPANY_RESEARCH_ONLY);
  });

  it("makes neither company claim on the embedded engine, which runs no search", () => {
    // `answerCompanyFactsNotice`'s own embedded guard, asserted through the
    // notice that composes it: the route checks `wantsEmbedded` before
    // `buildCompanyFacts` is ever constructed.
    const notice = postingGroundingNotice({ posting, isEmbedded: true, docsStatus: "done", hasCompany: true });
    expect(notice).toBe(EMBEDDED);
    expect(answerCompanyFactsNotice({ isEmbedded: true, hasCompany: true })).toBe("");
    expect(answerCompanyFactsNotice({ isEmbedded: false, hasCompany: false })).toBe("");
    expect(answerCompanyFactsNotice({})).toBe("");
    expect(answerCompanyFactsNotice()).toBe("");
    expect(answerCompanyFactsNotice({ isEmbedded: false, hasCompany: true })).toBe(FACTS);
  });

  // Regression pass, defect 1: this branch shipped with NO `hasCompany`
  // guard at all, unlike its sibling `companyResearchDestination` below,
  // whose own `if (!hasCompany) return ""` this file already pins (see
  // "says nothing when there is no company to research" further down). Every
  // fixture above fixes `company: "Acme Corp"` on `posting`, which is
  // exactly why the missing guard was invisible here: nothing ever exercised
  // a titled-but-companyless posting. `normalizePostingRows`
  // (lib/copilot/postings.js) drops a row only when it has NEITHER a title
  // nor a company, so a title-only posting is reachable — and on it, this
  // branch used to assert a company-research request goes to Google Gemini
  // while `companyBriefRequest` (lib/copilot/companyBrief.js) returns null
  // for a companyless posting and useCompanyBrief's fetch never fires at
  // all. That is exactly the "names a destination that receives nothing"
  // failure BUG-H5/R-098 exist to prevent.
  it("makes no company-research claim once the load settles with neither document found AND no company on file (defect 1)", () => {
    // Still the defect-1 guard, restated for a notice that is no longer ever
    // empty on this path: what must not appear is the claim that a
    // company-research request goes to Gemini when `companyBriefRequest`
    // would return null and no request can ever fire. The knowledge-base
    // disclosure is unrelated to that fact and is unconditional, so it
    // remains — with LIVE_DRAFT_DESTINATION in front of it, since with no
    // posting clause left nothing else would disclose that the question, the
    // transcript and the prep context go to Gemini on every draft.
    const noCompany = postingGroundingNotice({
      posting,
      isEmbedded: false,
      docsStatus: "done",
      resume: "",
      coverLetter: "",
      hasCompany: false,
    });
    expect(noCompany).toBe(`${LIVE_DRAFT}${KB}`);
    expect(noCompany).not.toContain("research the company");
    // Same when `hasCompany` is omitted entirely — the guard must default to
    // the SAFE reading, not the false-claim one, exactly like
    // `companyResearchDestination`'s own `hasCompany = undefined` case.
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done" })).toBe(`${LIVE_DRAFT}${KB}`);
  });

  it("contains no em dash in any sentence this module writes — a screen reader does not speak one as a pause", () => {
    // Scoped to this module's OWN prose. KNOWLEDGE_BASE_CLAUSE contains an em
    // dash and is byte-locked by lib/copilot/practiceNotices.test.js, which
    // pins it inside four full-notice oracles — it is one shared sentence
    // describing one shared payload, so it cannot be reworded from this side,
    // and copying it here to avoid the dash would recreate exactly the
    // two-copies-of-one-disclosure drift this import exists to end. The rule
    // still binds everything this file composes.
    const all = [
      postingGroundingNotice({ posting, isEmbedded: true, docsStatus: "done" }),
      postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "loading" }),
      postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done", resume: "R", coverLetter: "C" }),
      postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "done" }),
    ]
      .join(" ")
      .split(KB)
      .join("");
    expect(all).not.toMatch(/[—–]/);
    // Positive control: the split above really did remove something, so this
    // case cannot go vacuous if the clause stops being appended.
    expect(postingGroundingNotice({ posting, isEmbedded: false, docsStatus: "loading" })).toContain(KB);
  });
});

// BL-1 (mutation-harness review, S16 survivor). Replaces the sentence that
// used to be hardcoded inside VoiceCueSidebar.js as COMPANY_DATA_NOTICE --
// "sends the company name, job title and posting text to Google as soon as
// it happens -- to Google Gemini on the Gemini engine, or to Google Search
// on the embedded engine." -- which S16 narrowed to a strictly FALSE claim
// ("sends the company name to Google[.] Nothing else about this posting
// leaves your browser.") with every existing test still green, because the
// old test only regex-matched `/sends the company name.*to google/i`, which
// both the true original and S16's false narrowing satisfy equally. Every
// string below is a literal oracle -- not a regex, not a substring match --
// so narrowing, widening, or re-wording the claim without updating this
// file on purpose fails loudly.
describe("companyResearchDestination — honest per BL-1 (adversarial review, mutation S16)", () => {
  const EMBEDDED_NOTICE =
    "Saying this, or pressing the button, searches the web for the company name using a web search provider, which may be Brave, Google or DuckDuckGo depending on how this deployment is configured, then fetches up to 8 of the resulting pages from this server to read them. The job posting text is not sent.";
  const GEMINI_NOTICE =
    "Saying this, or pressing the button, sends the company name, job title and posting text to Google Gemini as soon as it happens.";

  it("says nothing when there is no company to research (companyBriefRequest would return null; no request ever fires)", () => {
    expect(companyResearchDestination({ isEmbedded: true, hasCompany: false })).toBe("");
    expect(companyResearchDestination({ isEmbedded: false, hasCompany: false })).toBe("");
    // Same for a call with no arguments at all.
    expect(companyResearchDestination({})).toBe("");
    expect(companyResearchDestination()).toBe("");
  });

  // AC/BL-1 verified against lib/research/companyResearchLocal.js and
  // lib/scrape/webSearch.js: the embedded path is called with only
  // { company, jobTitle } (no posting text), its search provider is
  // Brave-then-Google-then-DuckDuckGo (not "Google Search" specifically),
  // and it fetches up to MAX_CANDIDATES (8) result pages afterward.
  it("names the honest, multi-provider destination on the embedded engine, with no posting-text claim", () => {
    const notice = companyResearchDestination({ isEmbedded: true, hasCompany: true });
    expect(notice).toBe(EMBEDDED_NOTICE);
    expect(notice).toMatch(/brave/i);
    expect(notice).toMatch(/duckduckgo/i);
    expect(notice).not.toMatch(/posting text is sent|and posting text to/i);
  });

  // AC/BL-1 verified against app/api/company-research/route.js: `engine:
  // "external"` and `engine: "gemini"` both resolve `wantsEmbedded(...)` to
  // false and share the SAME Gemini branch -- there is no third code path --
  // so "not embedded" is the whole non-embedded surface, not just one of
  // two named engines the way the old hardcoded sentence implied.
  it("names Google Gemini, with all three fields, on every non-embedded engine value", () => {
    expect(companyResearchDestination({ isEmbedded: false, hasCompany: true })).toBe(GEMINI_NOTICE);
  });

  it("contains no em dash", () => {
    expect(EMBEDDED_NOTICE).not.toMatch(/[—–]/);
    expect(GEMINI_NOTICE).not.toMatch(/[—–]/);
  });
});
