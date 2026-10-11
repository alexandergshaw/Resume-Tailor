// Pure, no-IO walkthrough model for the study plan (N157 SC-C): flatten a
// normalized plan into an ordered list of cards, decide which cards are done,
// pick the next one to show, and count progress. No React, no DB, no clock;
// the walkthrough component feeds it `record.plan` and `progress.seen` and
// renders what comes back. NEVER throws: null or garbage input degrades to an
// empty result, the same stance as the schema this module reads.
//
// THE PROPERTIES THIS FILE EXISTS TO HOLD:
//
//  * A card's id is the schema's CONTENT-DERIVED itemKey, never its array
//    position. The cursor and the `seen` map are both addressed by that key,
//    so a plan rebuild that reorders or inserts cards leaves every surviving
//    key alone, and resume follows the key to its NEW position.
//
//  * `nextCard` returns either a PENDING card id or `complete`, never a done
//    card, and always terminates (two bounded passes over the cards).
//
//  * Every count iterates the PLAN's cards. A `seen` map can hold keys for
//    cards a rebuild dropped; those are ignored, so `done` never exceeds
//    `total`.
//
// A progress write is NOT built here: the component assembles
// { moduleId, topicId, itemId: card.id, revealedAt, grade? } and hands it to
// the shipped recordProgress -> buildProgressDelta, which is what keeps a write
// to ONE seen entry.

import { itemKey } from "./studyPlanSchema.js";

/**
 * The grade vocabulary: the one writer/reader contract for `seen[id].grade`.
 * The walkthrough writes it and the later scheduling work reads it, so a new
 * grade is a ruling, not an edit.
 */
export const GRADE = Object.freeze({ AGAIN: "again", GOT_IT: "got-it" });

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** The plain objects of an array; anything else (including a non-array) is []. */
function objectsOf(value) {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

// The reveal text rides the item through the schema's `...item` spread (it is
// not a declared field), so it is read defensively: only a non-blank string
// makes a card a quiz card.
function hasRevealText(item) {
  return typeof item.reveal === "string" && item.reveal.trim() !== "";
}

/**
 * Flattens a NORMALIZED plan (the `plan` of a study-plan record) into cards in
 * module -> topic -> item order. Each card is { id, item, moduleId, topicId,
 * moduleTitle, topicTitle, indexInTopic, topicSize, hasReveal }. `id` is the
 * content-derived itemKey, `indexInTopic` / `topicSize` are for the "Card i of
 * n in this topic" line only (never an address), and `hasReveal` is the one
 * signal that splits the quiz loop from the read-through loop.
 */
export function flattenPlan(plan) {
  const cards = [];
  for (const entry of objectsOf(plan?.modules)) {
    for (const topic of objectsOf(entry.topics)) {
      const items = objectsOf(topic.items);
      items.forEach((item, indexInTopic) => {
        cards.push({
          id: itemKey(item),
          item,
          moduleId: entry.id,
          topicId: topic.id,
          moduleTitle: typeof entry.title === "string" ? entry.title : "",
          topicTitle: typeof topic.title === "string" ? topic.title : "",
          indexInTopic,
          topicSize: items.length,
          hasReveal: hasRevealText(item),
        });
      });
    }
  }
  return cards;
}

/**
 * Whether a card needs no more asking. A quiz card is done only once graded
 * GOT_IT (a reveal without a grade is not done, and neither is AGAIN, which
 * returns it). A read-through card is done once it carries a reveal timestamp.
 */
export function isDone(card, entry) {
  if (card?.hasReveal) return entry?.grade === GRADE.GOT_IT;
  return typeof entry?.revealedAt === "string";
}

/**
 * The card to show after `afterId`. Returns { id, wrapped, complete }:
 *  - no pending card -> { id: null, wrapped: false, complete: true };
 *  - else the first pending card AFTER `afterId` in plan order, wrapped:false;
 *  - else (nothing pending after it) the first pending card overall, with
 *    wrapped:true. That may be `afterId`'s own card, when it is the one left.
 * A null, absent, or unknown `afterId` (a rebuilt plan) is "before the start",
 * so it lands on the first pending card, not wrapped.
 *
 * With `reviewAll`, "done" means `sessionDone.has(id)` instead, so a review
 * pass re-asks everything without a persisted reset and ignores stored grades.
 */
export function nextCard(cards, seen, afterId, opts) {
  const list = objectsOf(cards);
  const reviewAll = opts?.reviewAll === true;
  const sessionDone = opts?.sessionDone instanceof Set ? opts.sessionDone : new Set();
  const isPending = (card) => (reviewAll ? !sessionDone.has(card.id) : !isDone(card, seen?.[card.id]));

  const from = typeof afterId === "string" ? list.findIndex((card) => card.id === afterId) : -1;
  const after = list.find((card, index) => index > from && isPending(card));
  if (after) return { id: after.id, wrapped: false, complete: false };

  const first = list.find(isPending);
  if (first) return { id: first.id, wrapped: from >= 0, complete: false };
  return { id: null, wrapped: false, complete: true };
}

/**
 * Progress over the PLAN's cards: { total, done, missed, perTopic: { [topicId]:
 * { done, total } } }. `missed` is the count of cards whose stored grade is
 * AGAIN. Orphan `seen` keys (cards a rebuild dropped) are never visited.
 */
export function summarize(cards, seen) {
  const list = objectsOf(cards);
  const perTopic = {};
  let done = 0;
  let missed = 0;
  for (const card of list) {
    const entry = seen?.[card.id];
    const finished = isDone(card, entry);
    if (finished) done += 1;
    if (entry?.grade === GRADE.AGAIN) missed += 1;
    const slot = perTopic[card.topicId] ?? { done: 0, total: 0 };
    slot.total += 1;
    if (finished) slot.done += 1;
    perTopic[card.topicId] = slot;
  }
  return { total: list.length, done, missed, perTopic };
}

/**
 * The ordered card ids joined: the remount key. Stable across an identical
 * reload (same plan, same string), changes when the plan is rebuilt or its
 * order moves, so a reorder remounts instead of resuming mid-card.
 */
export function planSignature(cards) {
  return objectsOf(cards).map((card) => card.id).join("|");
}
