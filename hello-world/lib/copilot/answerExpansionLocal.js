// THE DETERMINISTIC EXPANSION DRAFTER. No model, no network, no egress.
//
// Engine choice governs every AI feature in this app, so this is not a
// fallback: it is the path a user who has chosen the embedded engine gets, and
// it is the privacy-preferred one, because every sentence it emits is a line
// the candidate wrote on one of their own pages, quoted whole.
//
// WHAT MAKES THIS THE FEATURE RATHER THAN A LIST OF SENTENCES. A sub-bullet
// has to be about ITS OWN parent bullet. The obvious implementation, ranking
// the page's bullets against the QUESTION, produces the same three sub-bullets
// under all six parents: it satisfies every shape rule in the chunk and is
// worthless, because the reader clicked one bullet and got the answer again.
// So two things happen here that a plain re-rank does not do:
//
//   1. RANKING IS AGAINST THE PARENT POINT, not the question.
//   2. A bullet is ASSIGNED to exactly one parent: the point of the answer it
//      scores highest against, ties going to the earlier point. That is what
//      makes two expansions of one answer provably disjoint rather than
//      hopefully different, and it costs nothing, because the request already
//      carries the answer's own points for the index self-check.
//
// NOTHING IS INVENTED AND NOTHING IS RE-DECLARED. `significantTerms` and
// `overlapScore` are the repo's shared relevance rule; `selectBestStory` owns
// the honesty gate and the bullet mining; `toSentence` owns the casing;
// `pointWordCount`, `standsAlone` and `isEmploymentHeaderLine` (reached through
// the contract's shape filter) own the "is this speakable?" question. This
// module declares no metric, no word counter, no date pattern and no job
// vocabulary of its own.
//
// MODULE-CYCLE DISCIPLINE: projectStories.js and answerPoints.js sit next to a
// live import cycle, so every reference to an imported binding below is inside
// a function body.

import { selectBestStory, significantTerms, overlapScore, toSentence } from "./projectStories.js";
import { normalizeForComparison, stripStarLabel } from "./answerPoints.js";
import { filterSubBulletEntries } from "./expansionContract.js";

function emptyResult() {
  return { subBullets: [], sources: [] };
}

// The answer's own points, label-stripped and blanks removed, with the parent
// guaranteed to be in the list. The parent's position in it is what the
// assignment rule below compares against.
function answerPointList(points, parent) {
  const cleaned = (Array.isArray(points) ? points : [])
    .filter((p) => typeof p === "string")
    .map((p) => stripStarLabel(p).trim())
    .filter(Boolean);
  const parentKey = normalizeForComparison(parent);
  if (cleaned.some((p) => normalizeForComparison(p) === parentKey)) return cleaned;
  // A caller that did not send the siblings still gets a correct expansion,
  // just without the cross-parent disjointness the assignment rule buys.
  return [parent, ...cleaned];
}

/**
 * Sub-bullets for ONE parent bullet, mined from the candidate's own project
 * pages, with zero model calls.
 *
 * Returns `{ subBullets, sources }`. `subBullets` entries are
 * `{ text, pageId, source }` where `source` names the single unit the sentence
 * was quoted from: `{ kind: "page", pageId, bulletIndex }`, the bulletIndex
 * being the line's position in the page AS WRITTEN. `sources` is what the
 * caption is allowed to name, and it lists only pages actually mined, so the
 * caption cannot claim a source this expansion did not use.
 *
 * The honest-empty result, `{ subBullets: [], sources: [] }`, is a SUCCESS and
 * not a failure. It is what the reader gets told plainly, rather than being
 * handed three sentences about a different subject.
 *
 * Total by construction: never throws, whatever it is handed.
 */
export function draftExpansionLocal({ question = "", parentPoint = "", points = [], pages = [] } = {}) {
  const parent = stripStarLabel(typeof parentPoint === "string" ? parentPoint : "").trim();
  if (!parent) return emptyResult();

  // THE SAME CALL THE ANSWER ITSELF MADE. `points: []` is deliberate: passing
  // the drafted points here would re-rank the PAGE choice against the answer,
  // and this expansion has to come from the page the parent bullet was cited
  // from, not from whichever page the answer as a whole leans toward.
  const story = selectBestStory(pages, { question: String(question || ""), points: [] });

  // THE HONESTY GATE. `matched` is false when no page cleared it and the
  // argmax was returned as a best guess. Mining sub-bullets out of that page
  // and citing it by name is the app speaking one of the candidate's documents
  // as an answer to a question it has nothing to do with. There are already
  // two identical copies of this composition in the tree
  // (sampleAnswerLocal.js and answerLocal.js, both `story && story.matched ?
  // story : null`); a third would be a third thing to drift, so the gate is
  // asked inline here and both copies are named so the duplication is at least
  // visible.
  if (!story || story.matched !== true) return emptyResult();

  const bullets = Array.isArray(story.bullets) ? story.bullets : [];
  const positions = Array.isArray(story.bulletPositions) ? story.bulletPositions : [];
  // The same all-or-nothing rule every positional pairing in this feature
  // applies: a bulletPositions array that does not line up with bullets cannot
  // be trusted to reorder them, and emitting relevance order silently is the
  // defect this whole step exists to prevent.
  if (bullets.length === 0 || bullets.length !== positions.length) return emptyResult();

  const allPoints = answerPointList(points, parent);
  const parentIndex = allPoints.findIndex((p) => normalizeForComparison(p) === normalizeForComparison(parent));
  const termsByPoint = allPoints.map((p) => significantTerms(p));
  const pointKeys = new Set(allPoints.map((p) => normalizeForComparison(p)));

  const candidates = [];
  for (let i = 0; i < bullets.length; i += 1) {
    const raw = bullets[i];
    const text = toSentence(raw);
    if (!text) continue;

    // EXCLUDE THE BULLET A POINT WAS BUILT FROM. The embedded answer drafter
    // quotes a page bullet verbatim as its Action beat, so the parent point IS
    // one of these lines. Handing it back as "further detail" hands the reader
    // the sentence they just read and clicked to get past.
    if (pointKeys.has(normalizeForComparison(text))) continue;

    const ownScore = overlapScore(termsByPoint[parentIndex], raw);
    // ZERO SCORE MEANS NOTHING TO SAY. Not "three bullets about another
    // subject" (AC-R5): a page can be genuinely the right page and still have
    // nothing further about this particular beat.
    if (ownScore <= 0) continue;

    // ASSIGNMENT. The bullet belongs to whichever point of the answer it is
    // most about; ties go to the earlier point, matching the document-order
    // tie-break selectBestStory itself uses. A bullet that is really about a
    // sibling beat is that sibling's detail, not this one's.
    let bestIndex = 0;
    let bestScore = -1;
    for (let k = 0; k < allPoints.length; k += 1) {
      const score = overlapScore(termsByPoint[k], raw);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = k;
      }
    }
    if (bestIndex !== parentIndex) continue;

    candidates.push({ text, position: positions[i], score: ownScore });
  }

  if (candidates.length === 0) return emptyResult();

  // DOCUMENT ORDER, NEVER RELEVANCE ORDER. `story.bullets` arrives sorted by
  // overlap with the question, and emitting it in that order reproduces, one
  // nesting level down, the reversed-STAR defect resultBeatFor was written to
  // fix: a result printed before the action that produced it.
  candidates.sort((a, b) => a.position - b.position);

  const entries = candidates.map((c) => ({
    text: c.text,
    pageId: story.pageId,
    source: { kind: "page", pageId: story.pageId, bulletIndex: c.position },
  }));

  const subBullets = filterSubBulletEntries(entries, { parentPoint: parent });
  if (subBullets.length === 0) return emptyResult();

  return {
    subBullets,
    sources: [{ kind: "page", pageId: story.pageId, pageTitle: story.title }],
  };
}
