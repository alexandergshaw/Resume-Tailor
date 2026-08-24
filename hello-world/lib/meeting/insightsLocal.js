// The deterministic, no-LLM half of the meeting copilot's insights feed.
//
// This is the embedded engine's answer to "what happened in the room in the
// last ~20 seconds" — and it is a genuinely narrow answer, on purpose. It has
// no model to compose a discussion point with, so it never tries to: every
// insight it emits is either (a) text that literally already exists — the
// user's own bullet line on one of their own pages — or (b) a mechanical
// fact about the transcript itself — a question nobody followed up on, or
// the transcript's own most frequent terms.
//
// THE LOAD-BEARING RULE, restated because it is the whole reason this file
// is honest rather than merely cheap: it must NEVER emit
// `source.kind: "model"`. That is the claim it categorically cannot back —
// there is no model here to have composed anything, so attributing a line to
// one would be a straight falsehood. Everything this file emits is either the
// user's own words or the room's own words, and it says so.
//
// Note what the rule does NOT forbid: `kind: "point"`. An earlier version of
// this header banned that too, as a proxy for "never compose". It was the
// wrong proxy and it produced a visible lie in the other direction — the
// screen renders `kind` as a chip, so quoting a user's own bullet back to
// them came out labelled "Gap" directly above "From your page: X", for the
// single most relevant thing they own. Quoting is not composing. Surfacing a
// bullet the user already wrote genuinely IS a point they could raise, and
// saying so costs this path none of its honesty — the honesty lives in
// `source`, which is the field that makes a claim about provenance. See "the
// honesty boundary" describe block below for the pinned test.

import { localDetection } from "@/lib/copilot/localDetection.js";
import { normalizeTopic, normalizeInsights } from "./insightContract.js";
import { isEligibleMeetingPage, stripSpeakerLabels } from "./meetingContext.js";

// How many of the transcript's own top terms make up the topic label. Kept
// small on purpose — this is meant to read as "the terms in play", not a
// sentence, and a longer list stops being skimmable mid-meeting.
export const TOPIC_TERM_COUNT = 4;

// Below this many words in the transcript, "medium" confidence would be
// overclaiming what four word-frequency counts can actually tell you. Above
// it, "medium" is still the ceiling — see the module header: this path never
// says "high", because it never read anything, it only counted words.
export const MEDIUM_CONFIDENCE_MIN_WORDS = 30;

// How many turns after a detected question this scans for a substantive
// reply before calling the question unanswered.
export const ANSWER_WINDOW_TURNS = 3;

// A reply only counts as actually addressing a question once it clears this
// many words — a one-word acknowledgement ("Right.", "Sure, yeah.") is not
// an answer just because it happened to come right after the question.
export const SUBSTANTIVE_REPLY_MIN_WORDS = 12;

// How many of the user's own pages get a "covers this" insight per read. A
// live meeting screen that suddenly cites five different pages is not more
// useful, it's unreadable — mirrors insightContract.js's own MAX_INSIGHTS_PER_READ
// reasoning at a smaller scale.
export const TOP_PAGE_COUNT = 2;

// Below this length a "bullet" line is almost always a placeholder rather
// than a sentence someone could speak from. Duplicated from
// lib/copilot/projectStories.js's own MIN_BULLET_LENGTH/BULLET_LINE_RE rather
// than imported: both are module-private there (that file has no reason to
// export them, and importing a copilot-domain internal into the meeting
// domain for four lines of regex is a worse coupling than repeating them).
const MIN_BULLET_LENGTH = 8;
const BULLET_LINE_RE = /^\s*[-*•–—]\s+(.+)$/;

function str(value) {
  return typeof value === "string" ? value : "";
}

function wordsOf(text) {
  return str(text).trim().split(/\s+/).filter(Boolean);
}

function termFrequencies(text) {
  const counts = new Map();
  for (const term of String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []) {
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return counts;
}

// The transcript's own top N terms by frequency, ties broken alphabetically
// so the result is deterministic (a Map's insertion order would otherwise
// leak transcript order into ties, which is not a meaningful tiebreak).
function topTerms(text, n) {
  return [...termFrequencies(text).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term]) => term);
}

function significantTerms(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

function overlapScore(queryTerms, text) {
  let score = 0;
  for (const term of significantTerms(text)) {
    if (queryTerms.has(term)) score += 1;
  }
  return score;
}

function bulletsFromBody(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((line) => {
      const m = BULLET_LINE_RE.exec(line);
      return m ? m[1].trim() : "";
    })
    .filter((line) => line.length >= MIN_BULLET_LENGTH);
}

// The single bullet, among a page's own bullets, that best matches the
// query terms — ties keep the page's own document order (first bullet
// wins), same "first occurrence wins a tie" rule normalizeInsights itself
// uses for de-duplication.
function bestBullet(bullets, queryTerms) {
  let best = bullets[0] || null;
  let bestScore = -1;
  for (const bullet of bullets) {
    const score = overlapScore(queryTerms, bullet);
    if (score > bestScore) {
      bestScore = score;
      best = bullet;
    }
  }
  return best;
}

function topicConfidence(transcript) {
  return wordsOf(transcript).length >= MEDIUM_CONFIDENCE_MIN_WORDS ? "medium" : "low";
}

// The topic insight: never a summary (this heuristic cannot write one), only
// the transcript's own most frequent terms, presented as terms. `previous`
// is the topic the client already has on screen (what the request body's own
// `topic` field carries in) — normalizeTopic compares against it to compute
// `changed` itself, per that function's own contract, never trusting a
// model's (or here, a heuristic's) opinion of whether the topic moved.
function buildTopic(transcript, previous) {
  const raw = topTerms(transcript, TOPIC_TERM_COUNT).join(", ");
  return normalizeTopic(raw, previous, topicConfidence(transcript));
}

// "Your page X covers this": the top TOP_PAGE_COUNT eligible pages that
// actually overlap the transcript at all (zero-overlap pages are never
// surfaced — citing a page that shares not one term with what's being said
// would be noise dressed as insight, not "an insight"), each turned into ONE
// insight whose text is that page's own best-matching bullet line — real,
// user-authored text, never a paraphrase and never invented.
//
// The two branches below deliberately emit DIFFERENT kinds, because they are
// telling the user two different things:
//
//   - Quoted a real bullet -> `kind: "point"`. The text IS a sentence the
//     user already wrote and could speak aloud right now. Calling that a
//     "gap" is simply false: the screen renders kind as a chip, so it would
//     put the word "Gap" over the most directly relevant material the user
//     owns. This heuristic did not compose the point — it found it — and
//     `source` is where that distinction is recorded, not `kind`.
//
//   - No bullet to quote -> `kind: "gap"`, and text that plainly NAMES the
//     page as worth pulling up rather than presenting its bare title as
//     though a title were itself a claim. This one really is a gap: there is
//     relevant material here, and nothing quotable in it yet.
//
// `pinnedPageId` — the page that was open when the meeting was started —
// always sorts first, and is the ONE page exempt from the zero-overlap
// filter, exactly as lib/meeting/meetingContext.js's own ranking treats it.
// The filter exists because term overlap is a guess and a page sharing no
// term with the room is a bad guess; the pin is not a guess at all, it is
// the user having chosen this page by having it open. Dropping it whenever
// the conversation had not yet reached its vocabulary would withhold the
// most relevant thing on screen precisely at the start of a meeting — and
// would make the embedded path (and every degraded fallback, which runs
// through here too) quietly worse than the model path for no reason.
function pageInsights(pages, transcript, pinnedPageId) {
  const eligible = (Array.isArray(pages) ? pages : []).filter(isEligibleMeetingPage);
  const queryTerms = significantTerms(transcript);

  const pinned = pinnedPageId ? eligible.find((page) => page.id === pinnedPageId) || null : null;
  const rest = pinned ? eligible.filter((page) => page.id !== pinned.id) : eligible;

  const scored = rest
    .map((page) => ({ page, score: overlapScore(queryTerms, `${str(page.title)} ${str(page.body)}`) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.page);

  const ordered = pinned ? [pinned, ...scored] : scored;

  return ordered.slice(0, TOP_PAGE_COUNT).map((page) => {
    const title = str(page.title).trim() || "Untitled page";
    const bullets = bulletsFromBody(page.body);
    const quoted = bullets.length > 0 ? bestBullet(bullets, queryTerms) : null;
    return {
      text: quoted || `"${title}" may be worth pulling up here.`,
      kind: quoted ? "point" : "gap",
      source: { kind: "page", pageId: page.id, pageTitle: title },
    };
  });
}

// Splits a transcript into individual turns (one utterance per non-empty
// line) with the speaker label already off the front of each — see
// meetingContext.js's stripSpeakerLabels for why the label must never reach
// a term counter, and why that helper lives there rather than here.
function turnsOf(transcript) {
  const spoken = stripSpeakerLabels(transcript);
  return spoken ? spoken.split("\n") : [];
}

// Unanswered questions raised in the room: run localDetection (the exact
// same primitive the live client and /api/copilot/detect's embedded branch
// use, so "is this a question" is never a second, driftable opinion) over
// each finalized turn. A detected question counts as unanswered when none of
// the following ANSWER_WINDOW_TURNS turns is a substantive reply (more than
// SUBSTANTIVE_REPLY_MIN_WORDS words) — including when the transcript simply
// ends before anyone replies at all.
//
// source is always `{ kind: "transcript" }` and nothing else — never a
// speaker. insightContract.js's SOURCE_KINDS has no field for "who asked
// it" in the first place, so this is enforced by the shape of the contract
// itself, not by a rule this file has to remember to apply.
function unansweredQuestionInsights(transcript) {
  const turns = turnsOf(transcript);
  const insights = [];

  for (let i = 0; i < turns.length; i += 1) {
    const detected = localDetection(turns[i]);
    if (!detected.decided) continue;

    let answered = false;
    for (let j = i + 1; j <= i + ANSWER_WINDOW_TURNS && j < turns.length; j += 1) {
      if (wordsOf(turns[j]).length > SUBSTANTIVE_REPLY_MIN_WORDS) {
        answered = true;
        break;
      }
    }

    if (!answered) {
      insights.push({ text: detected.question, kind: "question", source: { kind: "transcript" } });
    }
  }

  return insights;
}

// localInsights({ pages, transcript, topic, knownInsightIds, pinnedPageId })
// -> { topic, insights }.
//
// Pure, synchronous, no network — safe to call on every ~20-second tick even
// when the embedded engine has nothing to say (or nothing new to say):
// worst case, `insights` comes back empty and `topic` reports low confidence.
//
// THE ATTRIBUTION INVARIANT FOR THIS PATH IS ENFORCED HERE, AND ONLY HERE.
// `localInsights` returns insights that are already normalized; no caller
// re-runs normalizeInsights over them (app/api/meeting/insights/route.js
// deliberately does not — see its own comment).
//
// The two engines are normalized against DIFFERENT page sets, and that
// asymmetry is the whole point rather than an inconsistency to tidy up:
//
//   - The Gemini path normalizes against lib/meeting/meetingContext.js's
//     `includedPageIds` — the budget-constrained set of pages that actually
//     got packed into the prompt. There, "was this page in the set?" is a
//     real question with a real wrong answer: a model can cite a page it was
//     never shown, and that check is the only thing catching it.
//
//   - This path normalizes against `citedPageIds`: the ids of the pages it
//     itself just read out of `pages` and quoted from. It sends no prompt, so
//     there is no prompt budget that means anything here, and its citations
//     are true BY CONSTRUCTION — the text came out of that page, in this
//     call. Checking them against a budget that was never applied would
//     downgrade verifiably-true citations to `source.kind: "model"` purely
//     because a character limit elsewhere dropped the page: it would tell the
//     user the model invented a line they wrote themselves, break this file's
//     one hard invariant, and strip the single thing that makes a no-LLM path
//     worth shipping.
//
// So: same rule ("a page citation must name a page this read actually drew
// on"), applied to each path's own honest notion of "drew on".
export function localInsights({ pages, transcript, topic, knownInsightIds, pinnedPageId } = {}) {
  const transcriptText = str(transcript);
  // Both term counters below see the SPOKEN words only. Left unstripped, the
  // "You: " / "Others: " prefixes the capture layer writes make "others" the
  // most frequent token in any call-mode meeting — so the topic came back
  // literally as "others, …" and a page whose only overlap with the room was
  // the word "others" scored above zero and got surfaced as relevant. See
  // meetingContext.js's stripSpeakerLabels.
  const spokenText = stripSpeakerLabels(transcriptText);
  const topicResult = buildTopic(spokenText, topic);

  const fromPages = pageInsights(pages, spokenText, typeof pinnedPageId === "string" ? pinnedPageId : null);
  const citedPageIds = fromPages.map((insight) => insight.source.pageId);

  const raw = [...fromPages, ...unansweredQuestionInsights(transcriptText)];

  const insights = normalizeInsights(raw, {
    includedPageIds: citedPageIds,
    knownInsightIds,
  });

  return { topic: topicResult, insights };
}
