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
// Deliberately NOT lib/experience/tailorContext.js's buildTailorContextBlock,
// even though the budgeted-whole-page shape below mirrors it closely — that
// module feeds a résumé-tailoring prompt, this one feeds a live, mid-question
// interview prompt with its own budget and its own selection helper
// (selectBestStory) for the embedded (no-LLM) engine, which has no model to
// hand a whole page to and instead needs ONE concrete story picked out.

export const MAX_STORIES_CHARS = 6000;

// Never "resume" and never "prep" — see this file's header comment. A plain
// constant (not derived per call) so every caller that needs to attribute
// page-derived material — buildProjectStoriesBlock's `sourceLabel` and the
// route's own page-derived resumeAnchor fallback — agrees on the exact same
// string.
export const PROJECT_PAGE_SOURCE = "project page";

// Reserved out of the budget for the "N pages not included" notice, assembled
// last (after we already know how many pages were dropped) — sized generously
// above the worst realistic notice string so the notice itself is never what
// has to be cut. Mirrors lib/experience/tailorContext.js's own reserve.
const NOTICE_RESERVE_CHARS = 300;

// Joins two whole-page entries inside the block.
const SEPARATOR = "\n\n---\n\n";

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
function isEligiblePage(page) {
  if (!page || typeof page !== "object") return false;
  if (isGeneratedPage(page)) return false;
  if (page.archived_at !== null && page.archived_at !== undefined) return false;
  return true;
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// One page's whole-page text: its title as a label line, then its whole raw
// body (unparsed prose — a model reads a real narrative better than mined
// fragments). A page with neither a usable title nor a usable body
// contributes nothing and is dropped before the budget loop ever sees it.
function formatStory(page) {
  const title = str(page.title).trim();
  const body = str(page.body).trim();
  const heading = title || "Untitled project";
  return body ? `${heading}\n${body}` : heading;
}

// buildProjectStoriesBlock(pages) -> { block, truncated, includedCount, sourceLabel }.
//
// `block` is "" whenever there is nothing eligible to say — never a header
// with nothing under it — so a caller with no eligible pages can splice this
// into a prompt and get a byte-identical result to one that never called
// this function.
//
// `truncated` is true the moment any eligible page had to be left out to stay
// within MAX_STORIES_CHARS; `includedCount` is how many pages actually made
// it in. Whole pages only — never a page cut mid-sentence, for the same
// reason tailorContext.js gives: a page trimmed midway reads as a claim that
// stops partway through, and a whole project dropped and announced as
// dropped is more honest than half a project presented as complete.
//
// `sourceLabel` is always PROJECT_PAGE_SOURCE — a constant, not derived from
// the input — so a caller can attribute page-derived material honestly
// whether or not this particular call found anything to include.
//
// Never throws: junk input (null/undefined/malformed rows) is simply skipped.
export function buildProjectStoriesBlock(pagesInput) {
  const pages = Array.isArray(pagesInput) ? pagesInput : [];

  const pieces = pages
    .filter(isEligiblePage)
    .map((page) => ({ title: str(page.title).trim(), body: str(page.body).trim(), text: formatStory(page) }))
    .filter((p) => p.title || p.body);

  if (pieces.length === 0) {
    return { block: "", truncated: false, includedCount: 0, sourceLabel: PROJECT_PAGE_SOURCE };
  }

  const budgetForStories = Math.max(0, MAX_STORIES_CHARS - NOTICE_RESERVE_CHARS);

  const included = [];
  let used = 0;
  let droppedCount = 0;

  for (const piece of pieces) {
    const addLen = piece.text.length + (included.length > 0 ? SEPARATOR.length : 0);
    if (used + addLen > budgetForStories) {
      droppedCount += 1;
      continue;
    }
    included.push(piece.text);
    used += addLen;
  }

  const truncated = droppedCount > 0;
  const noticeBlock = truncated
    ? `[Note: ${pluralize(droppedCount, "project page")} not included to fit the interview copilot's context budget.]`
    : "";

  let block = [included.join(SEPARATOR), noticeBlock].filter(Boolean).join("\n\n");

  // Defensive final clamp, mirroring tailorContext.js's own: the budgeting
  // above is designed to always hold, but if a future change ever overshoots
  // it anyway, the hard contract (block never exceeds MAX_STORIES_CHARS) must
  // still hold. The included pages are always the earlier part of `block` and
  // the notice always the tail, so a cut here can only ever remove notice
  // text, never a page already promised to be whole.
  if (block.length > MAX_STORIES_CHARS) {
    block = block.slice(0, MAX_STORIES_CHARS);
  }

  return { block, truncated, includedCount: included.length, sourceLabel: PROJECT_PAGE_SOURCE };
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

function significantTerms(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

function overlapScore(questionTerms, text) {
  let score = 0;
  for (const term of significantTerms(text)) {
    if (questionTerms.has(term)) score += 1;
  }
  return score;
}

// The single project page that best fits what is being answered — the same
// "score every eligible candidate against the question (and, once drafted,
// the answer's own points), keep the strictly-higher scorer, ties keep
// document order" shape lib/copilot/resumeAnchor.js's resumeAnchor() uses for
// résumé roles. Returns null when there is no eligible page at all.
//
// `bullets` are this page's own markdown-bullet lines — real user-authored
// text, never invented or reworded — for a caller to build a structurally
// grounded story out of. `matched` reports honestly whether the page was
// picked because it overlaps the question/points or merely because it was
// the first eligible one on file, so a caller can label it truthfully.
export function selectBestStory(pagesInput, { question = "", points = [] } = {}) {
  const pages = Array.isArray(pagesInput) ? pagesInput : [];
  const eligible = pages.filter(isEligiblePage).filter((page) => str(page.title).trim() || str(page.body).trim());
  if (eligible.length === 0) return null;

  const context = [String(question || ""), ...(Array.isArray(points) ? points : []).map((p) => String(p || ""))]
    .join(" ")
    .trim();
  const questionTerms = significantTerms(context);

  let best = null;
  let bestScore = -1;
  for (const page of eligible) {
    const score = overlapScore(questionTerms, `${str(page.title)} ${str(page.body)}`);
    if (score > bestScore) {
      bestScore = score;
      best = page;
    }
  }
  if (!best) return null;

  return {
    title: str(best.title).trim(),
    bullets: bulletsFromBody(best.body),
    matched: bestScore > 0,
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
  if (!story || !story.title || !Array.isArray(story.bullets) || story.bullets.length === 0) return null;
  const points = [`Situation: ${toSentence(story.title)}`, `Action: ${toSentence(story.bullets[0])}`];
  if (story.bullets[1]) points.push(`Result: ${toSentence(story.bullets[1])}`);
  return points;
}
