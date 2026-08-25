// The user's own "Professional Experience" project pages, offered to the
// interview copilot as material for "tell me about a time..." questions (see
// lib/copilot/projectStories.test.js for the full contract this file must
// satisfy — its comments explain WHY each rule exists). Pure: no fetch, no
// Supabase — the caller (app/api/copilot/answer/route.js) fetches the pages
// server-side, scoped to the signed-in user via lib/supabase/experiencePages.js's
// listPages, and hands the raw rows in here.
//
// Two rules are about honesty rather than correctness, both already learned
// the hard way elsewhere in this codebase:
//
//  - A generated page (any `generated_kind` set — the research-report writer
//    is the first, not the only, producer of one) is a model's claims about
//    the industry. Spoken aloud in an interview as the candidate's own
//    experience, that is a lie the user did not know they were telling. The
//    check below matches on the COLUMN BEING SET, never a specific string —
//    the same defense lib/experience/tailorSources.js's isGeneratedPage uses
//    — so a future generator is excluded automatically.
//  - The answer route's resumeAnchor aid labels its material with where it
//    came from, and that label was a two-value enum ("resume" or "prep")
//    before this file existed. Page material must never borrow either value
//    — being told a claim is "on your resume" when it is not is worse than no
//    aid at all, because the user will say it with confidence in front of an
//    interviewer. PROJECT_PAGE_SOURCE exists so the route can attribute page
//    material honestly instead.
//
// This file used to also build the ranked, budgeted prompt block itself
// (buildProjectStoriesBlock) — that responsibility moved to
// lib/experience/knowledgeBase.js's buildKnowledgeBaseBlock (ARCH §5/§7.9),
// which ranks by relevance and excerpts an oversized page instead of only
// ever admitting whole pages in position order. What's left here is what
// still belongs to THIS file: page eligibility (isEligiblePage) and the
// embedded (no-LLM) engine's own selection helper (selectBestStory /
// starPointsFromStory), which has no model to hand a whole page to and
// instead needs ONE concrete story picked out. knowledgeBase.js imports
// significantTerms/overlapScore/isEligiblePage from here rather than the
// reverse — see that module's header.
//
// WHAT IMPORTS THIS, ACCURATELY (the old note here was stale on both counts):
//   - lib/meeting/insightsLocal.js imports significantTerms/overlapScore
//     DIRECTLY, and still does.
//   - lib/meeting/meetingContext.js NO LONGER DOES. It takes
//     rankPagesByRelevance from lib/experience/knowledgeBase.js, which is
//     what imports significantTerms/overlapScore from here — so meeting's
//     dependency on this file is now TRANSITIVE through knowledgeBase.js on
//     that path, not direct.
//   - app/copilot/AnswerAids.js, a CLIENT component, imports
//     PROJECT_PAGE_SOURCE from here.
// This file therefore no longer has "no imports of its own" — the safety
// argument that phrase used to carry is now the narrower one stated on the
// stopword import below: whatever this file imports lands in the meeting
// domain and in the browser bundle, so it imports the smallest thing that
// does the job and nothing else.

// The repo's existing general-purpose stopword list, the SAME one
// lib/copilot/resumeAnchor.js filters its own question terms with for
// exactly this purpose — see its comment on the "C3 regression", where a
// Barista role matched a systems-design question. Established precedent, not
// a new invention.
//
// Read straight from the bundled JSON rather than through
// `defaultLibraryData` (lib/llm/engines/tailor-lite/library/defaults.js):
// that frozen object also holds the skills taxonomy, profile, skill groups
// and content library — roughly 60KB of JSON — and AnswerAids.js imports
// THIS module into the browser, so going through the bundle would drag all
// five data files into the client. It is the same list byte for byte:
// defaults.js's own `stopwords` field is this exact import.
import stopwords from "@/lib/llm/engines/tailor-lite/data/stopwords.json";

// Consulted by the MATCH DECISION in selectBestStory only — never by
// significantTerms or overlapScore, which lib/meeting/** shares (R-257).
const STOPWORDS = new Set(stopwords);

// Never "resume" and never "prep" — see this file's header comment. A plain
// constant (not derived per call) so every caller that needs to attribute
// page-derived material — lib/experience/knowledgeBase.js's prompt block and
// the route's own page-derived resumeAnchor/answer fallbacks — agrees on the
// exact same string.
export const PROJECT_PAGE_SOURCE = "project page";

// The name a page-derived CITATION falls back to when the page itself has no
// title.
//
// THE BUG THIS PREVENTS: a page needs a title OR a body to be eligible, so a
// real body under a blank title is legitimate and common (the tree creates
// pages titled "", and people write the body before naming it). selectBestStory
// returned `title: ""`, the deterministic builders passed it straight into
// `pageSources`, answerPoints.js's resolvePageSource validates only the `id`,
// and AnswerLines.js rendered "From your  page." — a sentence with its subject
// missing, double space and all, read out loud mid-interview by someone
// trusting it.
//
// The asymmetry was the tell: lib/experience/knowledgeBase.js's
// buildKnowledgeBaseBlock already defends the identical field with exactly this
// fallback, so the Gemini path never had the defect and the deterministic one
// always did. Same string, so the two paths cannot drift on what an unnamed
// page is called.
export const UNTITLED_PROJECT_TITLE = "Untitled project";

// Below this many characters, a "bullet" line is almost always a placeholder
// rather than a sentence someone could tell a story with.
const MIN_BULLET_LENGTH = 8;

// A markdown-style bullet line only — never a bare paragraph. Pages are
// free-form prose plus lists; only the lists read as discrete claims a
// candidate could speak as one beat of a story (the same "only list items are
// discrete claims" reasoning lib/experience/tailorSources.js applies to
// résumé mining).
const BULLET_LINE_RE = /^\s*[-*•–—]\s+(.+)$/;

function str(value) {
  return typeof value === "string" ? value : "";
}

function isGeneratedPage(page) {
  const kind = page?.generated_kind;
  return kind !== null && kind !== undefined && String(kind).trim() !== "";
}

// Server-side-enforced eligibility: a generated page or an archived one
// (any non-null archived_at) never becomes interview material, no matter
// what the caller passes in — this function is the only place that decides
// it, mirroring tailorContext.js's isEligible.
//
// Exported so lib/experience/knowledgeBase.js's own tests can import the
// REAL rule rather than restating it (ARCH §7.9): buildProjectStoriesBlock's
// describe block used to be the repo's only coverage of the generated-page
// exclusion, and wave 2A deletes that block. A private copy imported into a
// test would prove the test's PARAMETER is wired up but nothing about
// whether the rule the route actually passes is correct.
export function isEligiblePage(page) {
  if (!page || typeof page !== "object") return false;
  if (isGeneratedPage(page)) return false;
  if (page.archived_at !== null && page.archived_at !== undefined) return false;
  return true;
}

// Markdown-bullet lines out of a page body, in document order, each trimmed
// and stripped of its marker. Never mines a bare paragraph — see this file's
// header comment on BULLET_LINE_RE.
function bulletsFromBody(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((line) => {
      const m = BULLET_LINE_RE.exec(line);
      return m ? m[1].trim() : "";
    })
    .filter((line) => line.length >= MIN_BULLET_LENGTH);
}

// Generic text-overlap helpers, exported from this feature module because
// this is where they were first established rather than because they belong
// to project stories specifically — lib/meeting/insightsLocal.js imports them
// from here directly, and lib/experience/knowledgeBase.js does too (which is
// how lib/meeting/meetingContext.js reaches them, transitively, since it now
// takes rankPagesByRelevance from that module rather than tokenising here
// itself). See this file's header for what that means for what this file may
// import.
//
// lib/copilot/resumeAnchor.js keeps a deliberately different, private
// significantTerms and is NOT a fourth caller of this one — see the comment
// on its own copy for why.
export function significantTerms(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

export function overlapScore(questionTerms, text) {
  let score = 0;
  for (const term of significantTerms(text)) {
    if (questionTerms.has(term)) score += 1;
  }
  return score;
}

// The general-purpose stopword list above answers "is this an ordinary
// English/résumé word". It does NOT answer "is this a word every interview
// question contains" — and it should not, because it is shared with
// tailor-lite's keyword extractor, where "project" and "worked" carry real
// signal on a résumé. So this is a SECOND list, for a different domain: the
// scaffolding a behavioural question is built out of. It is consulted by the
// MATCH DECISION in selectBestStory only — never by significantTerms, never
// by overlapScore, and never by any ranking, all of which are a shared
// contract with lib/meeting/** whose behaviour must not move here (R-257).
//
// THE RULE FOR ADDING A WORD HERE: it belongs only if a candidate could be
// asked it about ANY page they have ever written. "time", "project" and
// "worked" qualify — "tell me about a time you worked on a project" is
// askable against a beekeeping journal and a Kafka runbook alike, so the word
// carries no evidence about WHICH page is meant. "settlement" or "kafka" do
// not qualify and must never be added; a word that names a subject is exactly
// the evidence this gate exists to look for.
//
// THE BUG THIS PREVENTS: the previous gate excluded neither "time" nor
// {"worked", "project"} from the count, so "Tell me about a time you failed."
// matched a page titled "Settlement pipeline" (which says "settlement time"),
// and "Tell me about a time you worked on a project that did not go to plan."
// matched "Community garden rota" on two terms the question had supplied for
// free. Each was then spoken as the candidate's own experience and cited by
// name.
const INTERVIEW_SCAFFOLDING = new Set([
  "time", "times", "tell", "told", "telling", "describe", "walk", "example", "story",
  "situation", "challenge", "challenging", "difficult", "problem", "problems", "project",
  "projects", "worked", "handle", "handled", "recent", "recently", "biggest", "learned",
]);

// THE HONESTY GATE, asked about ONE page. `matched` decides whether the
// deterministic engine may speak this page as the candidate's own experience,
// and whether the app prints a citation naming it. That is a different
// question from "which page ranked highest" — selectBestStory's loop always
// returns its best guess.
//
// THE BUG THIS PREVENTS: `matched` used to be `bestScore > 0` over bare
// set-overlap on /[a-z0-9]{4,}/, so "Tell me about a time you disagreed with
// your manager." matched a page of beekeeping club minutes on the words
// "time", "with" and "about", and the candidate was handed "Situation:
// Beekeeping club minutes. Action: We spent time each spring checking the
// hives" as their own answer. Ordinary interview phrasing clears a
// four-character floor against essentially any prose page a person has
// written; a gate that is near-always open is not a gate.
//
// A term counts toward the decision only when it could DISTINGUISH one page
// from another: it is not an ordinary English/résumé word (STOPWORDS) and it
// is not interview scaffolding (INTERVIEW_SCAFFOLDING). Two such terms in
// common is no longer a coincidence of wording.
//
// THE DOCUMENT-FREQUENCY MAP THAT USED TO BE HERE IS GONE, deliberately. It
// called a term "generic" when more than half of the eligible pages carried
// it — a rule borrowed from corpora of millions of documents, which over a
// personal knowledge base of a few dozen pages carries no information at all
// and actively inverts. Verified: a candidate with pages titled "Kafka
// ingestion" and "Kafka retention tuning" asking "Tell me about your Kafka
// experience" was refused their own material, because both pages say Kafka so
// the map called Kafka common. Someone who writes about one subject a lot is
// the LEAST likely person to be told they have nothing to say about it.
//
// THE TITLE CLAUSE is what keeps the rule safe in the other direction. One
// strong term is enough when it NAMES the page — "Tell me about your Kafka
// experience" against a page titled "Kafka ingestion" is exactly what the
// candidate meant. One strong term appearing only in the BODY is not enough:
// "We evaluated Kafka and decided against it", on a page titled "Quarterly
// planning notes", is a mention, not a story.
//
// KNOWN AND ACCEPTED, so the next reader does not think it was missed: a
// codenamed page — "Project Northstar", with Kubernetes named only in the
// body — still fails a one-term question ("Tell me about your Kubernetes
// work"), because the single-distinctive-term branch requires the term to be
// in the TITLE. That is the conservative direction: declining to speak beats
// speaking the wrong page in front of an interviewer. The real answer is the
// deferred ranking work (R-257), not a loosening here.
//
// Scoped deliberately: significantTerms, overlapScore and selectBestStory's
// ranking loop are untouched. They are a shared contract imported by
// lib/meeting/insightsLocal.js and lib/experience/knowledgeBase.js, and
// ranking quality is its own chunk (R-257).
function clearsHonestyGate(page, questionTerms) {
  const titleTerms = significantTerms(str(page.title));
  const bodyTerms = significantTerms(str(page.body));
  let distinctiveCount = 0;
  let distinctiveOnTitle = 0;
  for (const term of questionTerms) {
    if (STOPWORDS.has(term) || INTERVIEW_SCAFFOLDING.has(term)) continue;
    const onTitle = titleTerms.has(term);
    if (!onTitle && !bodyTerms.has(term)) continue;
    distinctiveCount += 1;
    if (onTitle) distinctiveOnTitle += 1;
  }
  return distinctiveCount >= 2 || (distinctiveCount === 1 && distinctiveOnTitle === 1);
}

// The single project page that best fits what is being answered — the same
// "score every eligible candidate against the question (and, once drafted,
// the answer's own points), keep the strictly-higher scorer, ties keep
// document order" shape lib/copilot/resumeAnchor.js's resumeAnchor() uses for
// résumé roles. Returns null when there is no eligible page at all.
//
// `pageId` is `str(best.id).trim() || null` — the deterministic (no-LLM)
// engine now has to report which page a drafted point came from, and this
// is the only thing on that path that knows. `null`, never a broken empty
// string, when the winning page has no usable id (mirrors this file's own
// "a page needs a real id to be cited" posture elsewhere in the feature).
//
// `bullets` are this page's own markdown-bullet lines — real user-authored
// text, never invented or reworded — RANKED by overlap against the same
// question+points context that picked the page, ties kept in document
// order (a stable sort on a tied score, same shape as the page-picking loop
// above). This used to be document order unconditionally: starPointsFromStory
// takes bullets[0] as the STAR "Action" beat, so a page whose first bullet
// was boilerplate ("Kicked off in Q1 with a kickoff meeting") answered every
// question with that boilerplate line, no matter what was actually asked.
// Reordering (not filtering) means every bullet the page has is still
// available to a caller that wants more than one, just headed by the one
// that actually answers the question. `bulletPositions` rides alongside it,
// carrying each entry's index in the page as written — see resultBeatFor.
//
// `matched` reports honestly whether the PAGE was picked because it
// overlaps the question/points or merely because it was the highest-scoring
// one on file, so a caller can label it truthfully. It is the HONESTY GATE,
// not a relevance score — see clearsHonestyGate above, which is now asked
// about every candidate rather than only about the raw argmax.
export function selectBestStory(pagesInput, { question = "", points = [] } = {}) {
  const pages = Array.isArray(pagesInput) ? pagesInput : [];
  const eligible = pages.filter(isEligiblePage).filter((page) => str(page.title).trim() || str(page.body).trim());
  if (eligible.length === 0) return null;

  const context = [String(question || ""), ...(Array.isArray(points) ? points : []).map((p) => String(p || ""))]
    .join(" ")
    .trim();
  const questionTerms = significantTerms(context);

  // THE BUG THIS PREVENTS: the gate was being asked about the WRONG PAGE.
  // This loop used to keep only the raw-overlap argmax — scaffolding and
  // stopwords included — and clearsHonestyGate was then applied to that one
  // winner. So a page full of interview boilerplate took the argmax on words
  // like "time", "difficult" and "problem", failed the gate, and the
  // genuinely relevant page was never considered at all. Verified:
  //
  //   Q: "Tell me about a time you had to debug a difficult Terraform problem."
  //      "Interview prep"      raw score 5, would not clear the gate
  //      "Terraform migration" raw score 1, WOULD clear it
  //   -> picked "Interview prep", matched: false, and the candidate was told
  //      they had nothing to say about a subject they have a whole page about.
  //
  // "Interview prep" is not a contrived fixture; it is a page real users of
  // this product keep. So the gate is evaluated per CANDIDATE here, and the
  // highest-scoring page that CLEARS it wins. When none does, the raw argmax
  // is still returned — callers rely on getting a best guess back — with
  // `matched: false`, which is what keeps it honest.
  //
  // Ranking itself is untouched: both running maxima use the same
  // overlapScore and the same strictly-greater comparison, so ties still keep
  // document order and significantTerms/overlapScore/rankPagesByRelevance —
  // the contract lib/meeting/** shares — are exactly as they were (R-257).
  let best = null;
  let bestScore = -1;
  let bestEligible = null;
  let bestEligibleScore = -1;
  for (const page of eligible) {
    const score = overlapScore(questionTerms, `${str(page.title)} ${str(page.body)}`);
    if (score > bestScore) {
      bestScore = score;
      best = page;
    }
    if (score > bestEligibleScore && clearsHonestyGate(page, questionTerms)) {
      bestEligibleScore = score;
      bestEligible = page;
    }
  }
  if (!best) return null;

  const matched = bestEligible !== null;
  const chosen = bestEligible || best;

  const rankedBullets = bulletsFromBody(chosen.body)
    .map((text, index) => ({ text, index, score: overlapScore(questionTerms, text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return {
    pageId: str(chosen.id).trim() || null,
    // Never "" — see UNTITLED_PROJECT_TITLE for the nameless citation this
    // exists to prevent.
    title: str(chosen.title).trim() || UNTITLED_PROJECT_TITLE,
    bullets: rankedBullets.map((entry) => entry.text),
    // Where each entry of `bullets` sits in the PAGE AS WRITTEN, parallel to
    // it. `bullets` is relevance-ordered, so without this there is no way
    // left to tell which beat happened first — see resultBeatFor below for
    // the answer that used to precede its own action.
    bulletPositions: rankedBullets.map((entry) => entry.index),
    matched,
  };
}

function toSentence(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

// The narrow, honest STAR answer the embedded (no-LLM) engine can build out
// of ONE selected page: its own TITLE as the Situation beat, its own bullets
// as Action and (when a second one exists) Result. Every word here is text
// that literally occurs on the page — no invented Task beat, no synthesized
// metric — because the embedded engine has no model to phrase a connective
// sentence with. Requires at least a title AND one bullet; a title alone is
// not a story, so that case (along with no story at all) returns null and
// the caller falls back to its own existing draft.
export function starPointsFromStory(story) {
  // UNTITLED_PROJECT_TITLE is refused here exactly as a blank title always
  // was. It is a NAME for a citation — "From your Untitled project page." is
  // a true sentence — but it is not a Situation beat: "Situation: Untitled
  // project." is a line the candidate would have to say out loud, and it says
  // nothing. Giving the citation a readable name must not put words in the
  // candidate's mouth, so the two uses part company here.
  if (!story || !story.title || story.title === UNTITLED_PROJECT_TITLE) return null;
  if (!Array.isArray(story.bullets) || story.bullets.length === 0) return null;
  const points = [`Situation: ${toSentence(story.title)}`, `Action: ${toSentence(story.bullets[0])}`];
  const result = resultBeatFor(story);
  if (result) points.push(`Result: ${toSentence(result)}`);
  return points;
}

// The Result beat: the MOST RELEVANT bullet that follows the chosen Action in
// the page as written. `bullets` is relevance-ordered and this walks it in
// that order, taking the first entry whose `bulletPositions` index is greater
// than the Action's — so of two bullets that both follow the Action, the
// higher-ranked one wins, not the earlier one. (This comment used to say "the
// first bullet that FOLLOWS the chosen Action", which describes a document-
// order scan this function has never performed. No inversion could result
// from either reading, but a future "correction" toward the documented rule
// would have been a silent behaviour change, so the doc is corrected to the
// real rule and starBeatOrder.test.js now pins which of two following bullets
// is chosen.)
//
// THE BUG THIS PREVENTS: `bullets` is ordered by relevance, so bullets[0] is
// the bullet that answers the question — and this used to take bullets[1],
// the second-most relevant one, which is frequently EARLIER in the page than
// the action it is being reported as the outcome of. Verified on a real
// page: "Action: Cut settlement time from three days to one. Result: Added a
// nightly reconciliation job." The candidate says, out loud, that a thing
// which happened first was caused by a thing that happened second.
//
// When nothing follows the Action, there is no Result beat at all. Two honest
// beats beat three with a false one — starPointsFromStory has never promised
// a fixed number of them (a page with one bullet always produced two).
//
// `bulletPositions` is selectBestStory's own document-order index for each
// entry of `bullets`. A story object assembled by hand — a caller's test
// double, or an entry cached before that field existed — carries none, and
// there is then no position information to do better with, so the old
// bullets[1] reading is kept rather than silently dropping the beat from
// every such answer.
function resultBeatFor(story) {
  const positions = story.bulletPositions;
  if (!Array.isArray(positions) || positions.length !== story.bullets.length) {
    return story.bullets[1] || "";
  }
  const actionPosition = positions[0];
  for (let i = 1; i < story.bullets.length; i += 1) {
    if (positions[i] > actionPosition) return story.bullets[i];
  }
  return "";
}
