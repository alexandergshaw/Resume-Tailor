// AC-X1: split out of app/copilot/CopilotClient.js purely to keep that file
// under this project's 1000-line cap (the same reason useLiveSession.js,
// useSessionLogRecorder.js and TranscriptDisclosure.js were themselves split
// out of it — see CopilotClient.js's own module doc). Pure text logic only —
// no DOM, no React, no network — so it can be unit-tested directly against
// the literal oracles in groundingNotice.test.js.
//
// This is a privacy notice (BUG-H5/AC-H6.24/AC-H6.25): it tells the user
// where their submitted documents actually go, so the move here had to be
// byte-for-byte, not a paraphrase.

// BUG-H5 again, and this time only half of a pair shipped. Practice mode's
// notice (lib/copilot/practiceNotices.js) was corrected when drafting an
// answer started sending the user's project pages and their attachment file
// names; `postingGroundingNotice` below — the one LIVE mode renders — was
// not. Same route, same payload, and live mode's notice was the WORSE of the
// two, because it returned "" outright whenever no posting was selected,
// which is the ordinary live-mode state: in the common case it disclosed
// nothing at all about a transfer performed on every drafted answer.
//
// The sentence is IMPORTED rather than restated. Practice mode, a room
// question and a live drafted answer all go through the identical
// /api/copilot/answer call, so all three notices are describing ONE payload,
// and one description of it in one place is the only arrangement in which
// they cannot drift. app/copilot/practice/practiceRoomQuestionPrivacy.js
// already imports the same constant for the same reason.
import { KNOWLEDGE_BASE_CLAUSE } from "./practiceNotices.js";

// The live draft's own destination, stated for its own sake. This is NOT the
// antecedent of anything: KNOWLEDGE_BASE_CLAUSE used to open "It also sends…"
// and this sentence was introduced to give that "It" something to refer to,
// which was the wrong fix — the clause is appended to four other branches
// whose preceding sentence is about something else entirely, and on one of
// them the dangling pronoun made the notice false (see that constant's own
// comment). The clause names its own subject now, so nothing depends on what
// sits in front of it.
//
// What this sentence is still needed FOR: when the posting clause below is
// empty, it is the only thing that discloses the transfer performed on every
// single drafted answer. Unconditionally true on this path — the non-embedded
// engine always drafts through Gemini (app/api/copilot/answer/route.js), and
// lib/copilot/answerClient.js's draftAnswer sends exactly these three fields
// (question, transcript context, prep profile) on every request, posting or no
// posting. Dropping it would leave live mode's ordinary state — no posting
// selected — silent about that, which is the BUG-H5 shape this whole notice
// exists to prevent.
//
// It is NOT a second description of the knowledge base. That payload is
// described once, by the imported clause, and nowhere else in this file.
const LIVE_DRAFT_DESTINATION =
  " Drafting an answer sends the question, the recent transcript and your prep context to Google Gemini.";

// BUG-H5/AC-H6.25: names only the document(s) actually found for the
// selected application — never both when only one exists — the same
// discipline SubmittedDocs.js's statusSuffix and
// practice/SampleAnswer.js's sourceCaption already apply to the read-only
// panel and the sample-answer caption respectively. Only called once at
// least one of the two is known to be present; callers decide what to say
// when neither is.
//
// Guard fix (AC-T2.14/E4, adversarial review): `submittedDocsClause` used to
// be module-private inside app/copilot/CopilotClient.js with exactly one
// caller, which always checked `hasSubmittedResume || hasSubmittedCoverLetter`
// before calling it — so `(false, false)` was unreachable and the missing
// `hasCoverLetter` check on the final branch was harmless. AC-X1 made this a
// public `lib/` export, and a public export has no way to enforce that its
// one careful caller stays its only caller. Without this guard,
// `submittedDocsClause(false, false)` silently returned the cover-letter
// clause — a false claim that a document was sent when neither exists — so
// the case is now checked explicitly and returns "" instead.
export function submittedDocsClause(hasResume, hasCoverLetter) {
  if (hasResume && hasCoverLetter) {
    return "the résumé and cover letter you submitted for it are also sent to Google Gemini to ground your talking points";
  }
  if (hasResume) {
    return "the résumé you submitted for it is also sent to Google Gemini to ground your talking points";
  }
  if (hasCoverLetter) {
    return "the cover letter you submitted for it is also sent to Google Gemini to ground your talking points";
  }
  return "";
}

// AC-H6.24/AC-H6.25 (BUG-H5): derived from CURRENT state, not hard-coded,
// so it can never name a destination that isn't actually receiving data
// right now. Nothing about a selected posting's documents leaves the
// browser at all unless a posting is actually selected, so this is empty
// in that case — no claim, true or false, needs making. Once one is
// selected: on the embedded engine (`isEmbedded`, from useEngine — the same
// source of truth PracticeClient's own notice reads), the route's
// embedded path never calls Gemini at all (see
// app/api/copilot/answer/route.js), so this says so explicitly regardless
// of what the document load (`docsStatus`/`resume`/`coverLetter`) finds. On
// every other engine value, whether anything is actually sent depends on
// that same load — the one backing the "Submitted for this application"
// panel: while it is still loading (or has errored), whether a résumé/cover
// letter even exists for this application is genuinely unknown, so the
// notice hedges with "may" rather than asserting either way — staying
// silent instead, while documents might be about to be sent, would be the
// worse failure. Once the load settles (`docsStatus === "done"`) with
// something found, this names only the document(s) that actually exist,
// never both when only one does.
//
// AC-T2.14/E1 (adversarial review, Group T amendment): the embedded branch
// used to claim "nothing about this application is sent to Google" — true
// the day it was written, but the company-research voice cue (`POST
// /api/company-research`, `researchCompanyLocal` in
// lib/research/companyResearchLocal.js) changed that. That route's embedded
// path calls `searchPostingUrls` (lib/scrape/webSearch.js), whose SECOND
// configured provider is Google Programmable Search
// (`https://www.googleapis.com/customsearch/v1?...&q=<company>`) — so with
// `GOOGLE_SEARCH_API_KEY`/`GOOGLE_SEARCH_ENGINE_ID` configured and no Brave
// key ahead of it, the company name IS sent to Google on the embedded
// engine. The blanket claim would now be false. What is still TRUE, and
// worth keeping, is that no AI provider drafts the talking points
// themselves on this engine — so the sentence is scoped to that specific
// claim ("nothing is sent to Google to draft them") instead of the whole
// application. This is a correction, not a rewording: `groundingNotice.
// test.js` pins the exact string and was updated in the same change, with
// the same reasoning recorded there.
//
// AC-T2.14/E3: the branch below that used to return "" once the document
// load settled with neither a résumé nor a cover letter found (BUG-H5's
// fix, still correct for documents — the route's own
// `if (resume || coverLetter)` guard means nothing document-related is
// sent) is no longer a state where nothing can leave the browser. The same
// company-research cue reaches this branch too (posting selected, non-
// embedded engine), and on that engine the route always uses Gemini (see
// app/api/copilot/answer/route.js's non-embedded branch), so this now names
// that destination explicitly instead of staying silent.
//
// Guard fix (regression pass, defect 1): that branch shipped with NO
// `hasCompany` check at all, unlike its sibling `companyResearchDestination`
// below, whose own `if (!hasCompany) return ""` exists for exactly this
// reason — `companyBriefRequest` (lib/copilot/companyBrief.js) returns null
// for a posting with no company on file, and useCompanyBrief.js's own fetch
// never fires in that case, so no request is ever issued. A titled posting
// with a blank company is reachable: postings.js's `normalizePostingRows`
// drops a row only when it has NEITHER a title nor a company, so a
// title-only posting survives. On that posting, non-embedded engine, with
// the document load settled and neither document found, this branch used
// to assert data goes to Google Gemini while no request could ever be
// issued for it — exactly the "names a destination that receives nothing"
// failure BUG-H5 and R-098 exist to prevent. `hasCompany` is now threaded
// in from the caller (CopilotClient already computes it for
// VoiceCueSidebar/CompanyBriefPanel) rather than derived from
// `posting.company` here, matching `companyResearchDestination`'s own
// contract below exactly — the two are the same fact, read once and passed
// to both.
// BL-1 (mutation-harness review of VoiceCueSidebar.js/CompanyBriefPanel.js).
// The live-interview "company" voice cue's destination disclosure USED TO be
// a single hardcoded sentence baked into VoiceCueSidebar.js: "sends the
// company name, job title and posting text to Google as soon as it happens
// -- to Google Gemini on the Gemini engine, or to Google Search on the
// embedded engine." That sentence is false in most states a candidate can
// actually reach, verified against the real code paths, not assumed:
//   - Embedded engine, posting text: `researchCompanyLocal({ company,
//     jobTitle })` (lib/research/companyResearchLocal.js) is called with
//     only those two fields -- app/api/company-research/route.js's embedded
//     branch never passes `posting` through. The posting text is NEVER
//     sent on this engine. The old sentence claimed otherwise.
//   - Embedded engine, recipient: `researchCompanyLocal` calls
//     `searchPostingUrls` (lib/scrape/webSearch.js), which tries Brave
//     first, Google Programmable Search second, and falls through to a
//     keyless DuckDuckGo scrape when NEITHER key is configured -- the
//     default deploy shape. "Google Search" was one of three possible
//     recipients, not the recipient, and often not even reachable at all
//     (a keyless deploy sends nothing to Google here).
//   - Embedded engine, undisclosed step: after search, `researchCompanyLocal`
//     fetches up to `MAX_CANDIDATES` (8) of the resulting pages
//     (`fetchUrlContent`) from this server to read them. The old sentence
//     never mentioned this at all.
//   - `engine: "external"` (see lib/llm/featureEngine.js's `wantsEmbedded`)
//     routes down the exact same Gemini branch as `engine: "gemini"` at the
//     route -- there is no third code path -- so this notice only ever
//     needs an embedded/not-embedded split, matching `postingGroundingNotice`
//     above.
//   - A blank company: `companyBriefRequest` (lib/copilot/companyBrief.js)
//     returns null for a posting with no company on file, and
//     useCompanyBrief.js's `runFetch` never calls `fetch` at all in that
//     case (see its own `if (!requestFields)` guard) -- no request fires,
//     so nothing should be claimed.
//
// Presentational components (VoiceCueSidebar.js, CompanyBriefPanel.js) no
// longer hardcode this prose -- they derive it here, from the two facts
// they already have as props: `isEmbedded` (from useEngine, the same source
// `postingGroundingNotice` above reads) and `hasCompany` (whether the
// selected posting has one on file). Every string below is pinned as a
// literal oracle in groundingNotice.test.js so a "weaken the claim without
// making the tests notice" edit -- exactly what the mutation harness's S16
// found once already -- turns this file's own tests red.
export function companyResearchDestination({ isEmbedded, hasCompany } = {}) {
  if (!hasCompany) return "";
  return isEmbedded
    ? "Saying this, or pressing the button, searches the web for the company name using a web search provider, which may be Brave, Google or DuckDuckGo depending on how this deployment is configured, then fetches up to 8 of the resulting pages from this server to read them. The job posting text is not sent."
    : "Saying this, or pressing the button, sends the company name, job title and posting text to Google Gemini as soon as it happens.";
}

// Everything this notice says about the SELECTED POSTING — unchanged, byte
// for byte, from the ternary chain that used to be the whole function, minus
// its embedded branch (lifted into the caller below, since the embedded path
// is the one place the knowledge-base clause must NOT be appended). "" here
// means only "there is nothing more to say about the posting", never "there
// is nothing to disclose".
function postingDocsNotice({ posting, docsStatus, resume, coverLetter, hasCompany }) {
  const hasSubmittedResume = !!resume;
  const hasSubmittedCoverLetter = !!coverLetter;
  const docsSettled = docsStatus === "done";
  return !posting
    ? ""
    : !docsSettled
      ? " Because you selected a posting, any résumé or cover letter you submitted for it may also be sent to Google Gemini to ground your talking points."
      : hasSubmittedResume || hasSubmittedCoverLetter
        ? ` Because you selected a posting, ${submittedDocsClause(hasSubmittedResume, hasSubmittedCoverLetter)}.`
        : hasCompany
          ? " Because you selected a posting, asking to research the company also sends its name, this job's title and the posting text to Google Gemini."
          : "";
}

export function postingGroundingNotice({ posting, isEmbedded, docsStatus, resume, coverLetter, hasCompany }) {
  // The embedded engine makes no model call to draft an answer at all, so
  // the knowledge base does not leave the browser on this path and must not
  // be disclosed as if it did — disclosing a transfer that does not happen is
  // its own kind of false, the same rule practiceNotices.js applies to its
  // own embedded branch. With nothing selected there is still nothing to say
  // here, which is why this branch alone can still be "".
  if (isEmbedded) {
    return posting
      ? " The embedded engine drafts talking points on this server with no AI provider, so nothing is sent to Google to draft them."
      : "";
  }
  // Never "" on the Gemini path, with or without a posting: the pages and
  // attachment file names go on every drafted answer, so there is always
  // something to disclose. An empty posting clause is REPLACED, not simply
  // omitted, so the question/transcript/prep-context transfer is still
  // disclosed in the state live mode is usually in — see
  // LIVE_DRAFT_DESTINATION.
  const docsNotice = postingDocsNotice({ posting, docsStatus, resume, coverLetter, hasCompany });
  return `${docsNotice || LIVE_DRAFT_DESTINATION}${KNOWLEDGE_BASE_CLAUSE}`;
}
