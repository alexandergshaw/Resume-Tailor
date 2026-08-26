// AC-3.1/AC-3.2/AC-3.3/§4d (recruiter-vocab design): the per-response honesty
// flags, moved out of app/api/copilot/answer/route.js. Present at all ONLY
// when the question actually named a role term (`terms.length > 0`) — a
// scaffolding-only question (no gate fired) gets exactly the response shape
// it always had, key for key, which is what keeps the FOUR exact-key-set
// assertions this route's test files carry unmoved (AC-6.1):
// route.test.js:172-180, route.test.js:453-461,
// route.knowledgeBase.test.js:561-569, and
// route.roleTermsUnbacked.test.js:375-383. Computed on EVERY branch, both
// engines: both checks are pure, cost no `await`, and the two engines differ
// only in what page text they judge the draft against.
//
// TWO DIFFERENT QUESTIONS, per lib/copilot/questionVocabulary.js's own header
// (design §5c): `roleTermsUnbacked` is topicality — did the draft USE a role
// term the material doesn't back, honest framing included — and
// `roleTermsClaimed` is the narrower, per-point, high-precision screen for
// whether a point actually CLAIMED to have done something with one. Both are
// gated on the identical `terms.length > 0` condition and so always appear or
// disappear together.
//
// THE LOAD-BEARING PART OF THIS SPLIT, per the false-accusation hazard
// route.roleTermsUnbacked.test.js's header describes at length: the embedded
// engine's own "pages actually drafted from" is `story` (selected across
// EVERY page by lib/copilot/projectStories.js's selectBestStory), never
// `kb.block` — `kb.block` is truncated to the route's page budget and the
// embedded branches never read `kb` at all. Handing the embedded engine's
// draft `kb.block` as its material would report the candidate's OWN verbatim
// page text as an unbacked claim.
//
// TWO EXPORTS, NOT ONE WITH A `pageText` PARAMETER, is how that hazard is
// closed structurally rather than left as a rule to remember:
// `embeddedRoleTermsFlag` takes `story` and derives the page text itself
// (the moved `storyPageText`, kept private to this module) — there is no
// parameter on it that `kb.block` could be handed to. `geminiRoleTermsFlag`
// takes `pagesBlock` (always `kb.block` — the pages actually put in that
// engine's prompt) and nothing else. A single shared `pageText` parameter is
// what let a future edit paste the wrong one in at one of five call sites;
// this shape makes that mistake a wrong export name, not a wrong argument.

import { combineMaterial } from "@/lib/copilot/answerLocal";
import { unsupportedRoleTerms, claimedWithoutBacking } from "@/lib/copilot/questionVocabulary";

// The embedded engine's own "pages actually drafted from": `story` is
// selected across EVERY page, while `kb.block` is truncated to the route's
// page budget and the embedded branches never read `kb` at all. Used only to
// build the honesty flag's material on the embedded path — never as a prompt
// source, since the embedded engine has no prompt.
function storyPageText(story) {
  return [story?.title, ...(story?.bullets || [])].filter(Boolean).join("\n");
}

// The body every call site shares, verbatim: the early return when the
// question named no role term, `combineMaterial` joined to whichever page
// text the caller's engine actually used, and the two honesty checks against
// that combined material.
function flagFrom({ terms, points, profile, resume, coverLetter, pageText }) {
  if (!terms.length) return {};
  const material = [combineMaterial(profile, resume, coverLetter), pageText].filter(Boolean).join("\n\n");
  return {
    roleTermsUnbacked: unsupportedRoleTerms(points, material, terms),
    roleTermsClaimed: claimedWithoutBacking(points, { roleTerms: terms, material }),
  };
}

// Gemini path: `pagesBlock` is always `kb.block` — the pages actually put
// into that call's prompt.
export function geminiRoleTermsFlag({ terms, points, profile, resume, coverLetter, pagesBlock }) {
  return flagFrom({ terms, points, profile, resume, coverLetter, pageText: pagesBlock });
}

// Embedded path: `story` is the same selection every embedded drafter used,
// and this derives its own page text from it — see `storyPageText` above and
// this module's header for why nothing here accepts `kb.block`.
export function embeddedRoleTermsFlag({ terms, points, profile, resume, coverLetter, story }) {
  return flagFrom({ terms, points, profile, resume, coverLetter, pageText: storyPageText(story) });
}
