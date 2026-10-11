// N157 SC-C sub-chunk C-a -- the PURE walkthrough model (step 4b TDD).
//
// Binds to docs/loop/N157.SC-C.design.r2.md §3.3 (the pure model
// `lib/studyPlan/studyWalkthroughModel.js`: GRADE, flattenPlan, isDone,
// nextCard, summarize, planSignature; the oracle table rows 1-10) and §5.5
// (the StudyWalkthrough props/state contract C-b and C-c build on). This file
// FREEZES that contract as code so the later waves cannot race it.
//
// RED ON HEAD, and WHY: `lib/studyPlan/studyWalkthroughModel.js` does not exist
// yet, so the dynamic import in beforeAll throws "cannot find module" and every
// `it` reds at the point it first touches `mod.*`. This is the honest greenfield
// red (vi.mock cannot substitute an unresolvable specifier -- loop-traps-tests).
// None of these reds is vacuous: every assertion below is a real behavioural
// claim that, once the module lands, discriminates a correct build from the
// specific defects each test names.
//
// THE TWO LOAD-BEARING CANARIES (the design's named mutants):
//
//   * CONTENT-DERIVED KEY, NOT INDEX (§3.3 oracle 5, R6/R5). A flattened card's
//     `id` is the schema's content-derived itemKey, never its array position.
//     The reorder test below gives nextCard the SAME content key before and
//     after a plan rebuild and asserts resume follows the key's new position,
//     not a frozen index. An index-keyed flatten reds the explicit
//     `card.id === itemKey(raw)` assertion directly.
//
//   * ONE-ITEM SEEN DELTA, NOT THE WHOLE MAP (§3.4, matching
//     studyPlanSchema.buildProgressDelta). A flattened card carries exactly the
//     fields (moduleId, topicId, id) that, fed to the SHIPPED buildProgressDelta,
//     produce a single-key, content-keyed seenDelta. A whole-map producer fails
//     the shipped isSingleItemSeenDelta guard and the single-key assertion.
//
// The schema side (itemKey / buildProgressDelta / isSingleItemSeenDelta /
// normalizePlan / normalizeProgress) is SHIPPED, so it is imported statically
// and used as the INDEPENDENT oracle for expected keys -- the expected values do
// not come from the module under test (loop-traps-tests: a canary built from the
// same source proves consistency, not correctness).

import { describe, it, expect, beforeAll } from "vitest";
import {
  itemKey,
  normalizePlan,
  normalizeProgress,
  buildProgressDelta,
  isSingleItemSeenDelta,
} from "@/lib/studyPlan/studyPlanSchema.js";

let mod = null;

beforeAll(async () => {
  mod = await import("@/lib/studyPlan/studyWalkthroughModel.js");
});

// --- fixtures -------------------------------------------------------------
// Four items of DISTINCT content so every itemKey differs. Two quiz cards in
// one topic (carry a non-empty `reveal`), one read-through card (no `reveal`),
// one quiz card in a second module. `reveal` is NOT declared by normalizeItem
// (design F5) -- it rides the `...item` spread, which is exactly why the
// walkthrough must read it defensively. The fixtures prove it survives.

const ISO = "2026-10-11T12:00:00.000Z";

const RAW_Q1 = { topicHint: "Topic A", text: "What is a closure?", reveal: "A function plus its captured scope.", kind: "new" };
const RAW_Q2 = { topicHint: "Topic A", text: "What is hoisting?", reveal: "Declarations are processed before execution.", kind: "new" };
const RAW_R1 = { topicHint: "Topic B", text: "Skim the company engineering blog.", kind: "new" }; // read-through: no reveal
const RAW_Q3 = { topicHint: "Topic C", text: "Define idempotency.", reveal: "Same result however many times applied.", kind: "review" };

// Independent oracle for the expected keys (SHIPPED itemKey over the RAW item;
// normalization leaves topicHint/text untouched, so the normalized id equals
// this). If these collide the fixture is wrong, so assert distinctness first.
const ID_Q1 = itemKey(RAW_Q1);
const ID_Q2 = itemKey(RAW_Q2);
const ID_R1 = itemKey(RAW_R1);
const ID_Q3 = itemKey(RAW_Q3);

function basePlanInput() {
  return {
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [
      { id: "m1", title: "Fundamentals", topics: [
        { id: "t1", title: "Topic A", items: [RAW_Q1, RAW_Q2] },
        { id: "t2", title: "Topic B", items: [RAW_R1] },
      ] },
      { id: "m2", title: "Systems", topics: [
        { id: "t3", title: "Topic C", items: [RAW_Q3] },
      ] },
    ],
  };
}

// Same items, reordered across modules/topics AND Q2 placed before Q1. Keys are
// content-derived, so ID_Q1/ID_Q2/ID_R1/ID_Q3 are UNCHANGED; only positions
// move. Flattened order: [Q3, R1, Q2, Q1].
function reorderedPlanInput() {
  return {
    engine: "gemini",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [
      { id: "m2", title: "Systems", topics: [
        { id: "t3", title: "Topic C", items: [RAW_Q3] },
      ] },
      { id: "m1", title: "Fundamentals", topics: [
        { id: "t2", title: "Topic B", items: [RAW_R1] },
        { id: "t1", title: "Topic A", items: [RAW_Q2, RAW_Q1] },
      ] },
    ],
  };
}

const basePlan = () => normalizePlan(basePlanInput());
const reorderedPlan = () => normalizePlan(reorderedPlanInput());

// seen-map helpers (the shape normalizeProgress produces at progress.seen).
const got = () => ({ revealedAt: ISO, grade: "got-it" });
const again = () => ({ revealedAt: ISO, grade: "again" });
const readSeen = () => ({ revealedAt: ISO });
const revealedNoGrade = () => ({ revealedAt: ISO });

describe("fixture sanity (independent of the module under test)", () => {
  it("every item key is distinct, so content -- not position -- is what a key tracks", () => {
    const ids = [ID_Q1, ID_Q2, ID_R1, ID_Q3];
    expect(new Set(ids).size).toBe(4);
  });
});

describe("GRADE vocabulary (frozen; SC-D reads it)", () => {
  it("is exactly { AGAIN: 'again', GOT_IT: 'got-it' } -- closed in both directions", () => {
    // toEqual pins the set closed: an added or renamed grade reds here (a lower
    // bound or a membership check would not catch a widened vocabulary).
    expect(mod.GRADE).toEqual({ AGAIN: "again", GOT_IT: "got-it" });
  });
});

describe("flattenPlan: module -> topic -> item order, content-keyed cards", () => {
  it("emits one card per item in reading order with the pinned descriptor fields", () => {
    const cards = mod.flattenPlan(basePlan());
    expect(cards.map((c) => c.id)).toEqual([ID_Q1, ID_Q2, ID_R1, ID_Q3]);

    const [q1, q2, r1, q3] = cards;
    // CONTENT-KEY CANARY: each id is the schema's content-derived itemKey, never
    // the array index. An index-keyed flatten makes these ["0","1","2","3"] and
    // reds here -- and silently breaks resume across a rebuild (oracle 5).
    expect(q1.id).toBe(ID_Q1);
    expect(q3.id).toBe(ID_Q3);
    expect(cards.map((c) => c.id)).not.toContain("0");

    expect(q1).toMatchObject({ moduleId: "m1", topicId: "t1", moduleTitle: "Fundamentals", topicTitle: "Topic A", indexInTopic: 0, topicSize: 2, hasReveal: true });
    expect(q2).toMatchObject({ moduleId: "m1", topicId: "t1", indexInTopic: 1, topicSize: 2, hasReveal: true });
    expect(r1).toMatchObject({ moduleId: "m1", topicId: "t2", indexInTopic: 0, topicSize: 1, hasReveal: false });
    expect(q3).toMatchObject({ moduleId: "m2", topicId: "t3", indexInTopic: 0, topicSize: 1, hasReveal: true });
  });

  it("marks a card with a non-empty reveal as a quiz (hasReveal) and one without as read-through", () => {
    // hasReveal is the ONLY signal that splits the quiz loop (Show answer -> Got
    // it / Missed it) from the read-through loop (Next). A build that keys off
    // anything else (kind, citations) mis-classifies R1 and reds.
    const cards = mod.flattenPlan(basePlan());
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(byId[ID_R1].hasReveal).toBe(false);
    expect(byId[ID_Q1].hasReveal).toBe(true);
  });

  it("the same content keeps the same id after a plan reorder (resume survives a rebuild)", () => {
    const baseIds = new Set(mod.flattenPlan(basePlan()).map((c) => c.id));
    const reorderedIds = new Set(mod.flattenPlan(reorderedPlan()).map((c) => c.id));
    expect(baseIds).toEqual(reorderedIds);
    expect(reorderedIds.has(ID_Q1)).toBe(true);
  });
});

describe("isDone: quiz needs got-it, read needs a reveal timestamp (oracle 7, 8)", () => {
  it("a quiz card is done only when graded got-it", () => {
    const [q1] = mod.flattenPlan(basePlan());
    expect(mod.isDone(q1, got())).toBe(true);
    expect(mod.isDone(q1, again())).toBe(false);
    // oracle 7: revealed but not graded is NOT done.
    expect(mod.isDone(q1, revealedNoGrade())).toBe(false);
    expect(mod.isDone(q1, undefined)).toBe(false);
  });

  it("a read-through card is done once it carries a revealedAt (oracle 8)", () => {
    const r1 = mod.flattenPlan(basePlan()).find((c) => c.id === ID_R1);
    expect(mod.isDone(r1, readSeen())).toBe(true);
    expect(mod.isDone(r1, {})).toBe(false);
    expect(mod.isDone(r1, undefined)).toBe(false);
  });
});

describe("nextCard: the resume/next oracle (never returns a done card)", () => {
  // Each row is the design's §3.3 oracle. Built from the SHIPPED keys, so the
  // expectation is independent of the module under test.
  it("oracle 1: null cursor, nothing seen -> the first card, not wrapped", () => {
    const cards = mod.flattenPlan(basePlan());
    expect(mod.nextCard(cards, {}, null)).toMatchObject({ id: ID_Q1, wrapped: false, complete: false });
  });

  it("oracle 2: cursor mid-plan, later cards pending -> next pending after the cursor", () => {
    const cards = mod.flattenPlan(basePlan());
    const seen = { [ID_Q1]: got() };
    expect(mod.nextCard(cards, seen, ID_Q1)).toMatchObject({ id: ID_Q2, wrapped: false });
  });

  it("oracle 3: cursor at the last card, an earlier card missed -> that earlier card, wrapped", () => {
    const cards = mod.flattenPlan(basePlan());
    const seen = { [ID_Q1]: got(), [ID_Q2]: again(), [ID_R1]: readSeen(), [ID_Q3]: got() };
    expect(mod.nextCard(cards, seen, ID_Q3)).toMatchObject({ id: ID_Q2, wrapped: true });
  });

  it("oracle 4: cursor card itself missed, nothing else pending -> the same card, wrapped", () => {
    const cards = mod.flattenPlan(basePlan());
    const seen = { [ID_Q1]: got(), [ID_Q2]: got(), [ID_R1]: readSeen(), [ID_Q3]: again() };
    expect(mod.nextCard(cards, seen, ID_Q3)).toMatchObject({ id: ID_Q3, wrapped: true });
  });

  it("oracle 5: cursor id absent from the plan (rebuilt) -> first pending, not wrapped", () => {
    const cards = mod.flattenPlan(basePlan());
    // A content key from a card no longer present (e.g. reworded on rebuild).
    const orphan = itemKey({ topicHint: "Topic A", text: "A reworded question that no longer exists" });
    expect(cards.map((c) => c.id)).not.toContain(orphan);
    expect(mod.nextCard(cards, {}, orphan)).toMatchObject({ id: ID_Q1, wrapped: false });
  });

  it("oracle 6: every card done -> { id: null, complete: true }", () => {
    const cards = mod.flattenPlan(basePlan());
    const seen = { [ID_Q1]: got(), [ID_Q2]: got(), [ID_R1]: readSeen(), [ID_Q3]: got() };
    const res = mod.nextCard(cards, seen, ID_Q3);
    expect(res.id).toBeNull();
    expect(res.complete).toBe(true);
  });

  it("never returns a done card id (the property over the oracle fixtures)", () => {
    const cards = mod.flattenPlan(basePlan());
    const seen = { [ID_Q1]: got(), [ID_R1]: readSeen() }; // Q1, R1 done; Q2, Q3 pending
    for (const afterId of [null, ID_Q1, ID_Q2, ID_R1, ID_Q3, "i_nope"]) {
      const { id } = mod.nextCard(cards, seen, afterId);
      if (id === null) continue;
      const card = cards.find((c) => c.id === id);
      expect(mod.isDone(card, seen[id])).toBe(false);
    }
  });

  it("CONTENT-KEY RESUME CANARY: the same cursor key resumes by its NEW position after a reorder", () => {
    // Q1 done, everything else pending. The ONLY input that differs between the
    // two calls is the plan's order; the cursor key (ID_Q1) is identical.
    const seen = { [ID_Q1]: got() };

    // base order [Q1, Q2, R1, Q3]: Q1 is first, so the next pending is Q2.
    const base = mod.nextCard(mod.flattenPlan(basePlan()), seen, ID_Q1);
    expect(base).toMatchObject({ id: ID_Q2, wrapped: false });

    // reordered order [Q3, R1, Q2, Q1]: Q1 is LAST, so there is nothing pending
    // after it -> wrap to the first pending overall, Q3.
    const reordered = mod.nextCard(mod.flattenPlan(reorderedPlan()), seen, ID_Q1);
    expect(reordered).toMatchObject({ id: ID_Q3, wrapped: true });

    // The two answers MUST differ: an index-based resume (ignore the key, step
    // from a frozen position) cannot produce both from the same cursor.
    expect(base.id).not.toBe(reordered.id);
  });

  it("oracle 10: reviewAll re-asks everything until sessionDone fills, ignoring persisted grades", () => {
    const cards = mod.flattenPlan(basePlan());
    const allPersistedDone = { [ID_Q1]: got(), [ID_Q2]: got(), [ID_R1]: readSeen(), [ID_Q3]: got() };

    // Empty sessionDone: despite every persisted entry being done, review mode
    // treats all as pending and starts at the first card.
    const start = mod.nextCard(cards, allPersistedDone, null, { reviewAll: true, sessionDone: new Set() });
    expect(start).toMatchObject({ id: ID_Q1, complete: false });

    // sessionDone holding every id: the review pass is complete.
    const full = new Set([ID_Q1, ID_Q2, ID_R1, ID_Q3]);
    const done = mod.nextCard(cards, allPersistedDone, ID_Q3, { reviewAll: true, sessionDone: full });
    expect(done.id).toBeNull();
    expect(done.complete).toBe(true);
  });
});

describe("summarize: counts iterate the PLAN's cards, never the keys of seen", () => {
  it("counts done and missed from the plan cards and groups per topic", () => {
    const cards = mod.flattenPlan(basePlan());
    // Q1 got-it (done), Q2 again (missed, pending), R1 revealed (done), Q3 untouched.
    const seen = { [ID_Q1]: got(), [ID_Q2]: again(), [ID_R1]: readSeen() };
    const s = mod.summarize(cards, seen);
    expect(s.total).toBe(4);
    expect(s.done).toBe(2); // Q1, R1
    expect(s.missed).toBe(1); // Q2 (graded again)
    expect(s.perTopic.t1).toEqual({ done: 1, total: 2 }); // Q1 done, Q2 not
    expect(s.perTopic.t2).toEqual({ done: 1, total: 1 }); // R1
    expect(s.perTopic.t3).toEqual({ done: 0, total: 1 }); // Q3
  });

  it("oracle 9: orphan seen keys (cards no longer in the plan) are ignored; done <= total always", () => {
    const cards = mod.flattenPlan(basePlan());
    // One real done card plus two keys for cards that are NOT in this plan.
    const seen = {
      [ID_Q1]: got(),
      i_orphan_one: got(),
      i_orphan_two: got(),
    };
    const s = mod.summarize(cards, seen);
    expect(s.total).toBe(4);
    expect(s.done).toBe(1); // only Q1, NOT the two orphans
    expect(s.done).toBeLessThanOrEqual(s.total);
  });
});

describe("planSignature: a remount key stable across identical reloads", () => {
  it("is a non-empty string that names every card id and is deterministic", () => {
    const cards = mod.flattenPlan(basePlan());
    const sig = mod.planSignature(cards);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
    for (const id of [ID_Q1, ID_Q2, ID_R1, ID_Q3]) expect(sig).toContain(id);
    // Deterministic: the same cards produce the same signature (so a reconcile
    // that re-flattens an identical plan does not change the remount key).
    expect(mod.planSignature(mod.flattenPlan(basePlan()))).toBe(sig);
  });

  it("changes when the order changes (a reorder must remount, not resume mid-card)", () => {
    const base = mod.planSignature(mod.flattenPlan(basePlan()));
    const reordered = mod.planSignature(mod.flattenPlan(reorderedPlan()));
    expect(reordered).not.toBe(base);
  });
});

describe("one-item seen delta: a flattened card feeds the SHIPPED buildProgressDelta to ONE key", () => {
  it("advancing a card produces a single-key, content-keyed delta (never the whole seen map)", () => {
    // This is the JOIN test (loop-traps-tests: test the join with the REAL
    // consumer). The REAL consumer is the shipped recordProgress ->
    // buildProgressDelta path; the producer is flattenPlan. The card must carry
    // exactly moduleId / topicId / id so the recordProgress argument the
    // walkthrough assembles yields one seen entry.
    const card = mod.flattenPlan(basePlan())[0]; // Q1
    const arg = { moduleId: card.moduleId, topicId: card.topicId, itemId: card.id, revealedAt: ISO, grade: mod.GRADE.GOT_IT };

    const { cursor, seenDelta } = buildProgressDelta(arg);

    // WHOLE-MAP CANARY: isSingleItemSeenDelta is false for a 2+ key map, an
    // empty map, or a non-object. A card whose id were missing/empty would
    // produce an empty delta and red here.
    expect(isSingleItemSeenDelta(seenDelta)).toBe(true);
    expect(Object.keys(seenDelta)).toEqual([card.id]);
    expect(card.id).toBe(ID_Q1); // content key, not an index
    expect(cursor).toEqual({ moduleId: "m1", topicId: "t1", itemId: ID_Q1 });
    expect(seenDelta[card.id]).toMatchObject({ revealedAt: ISO, grade: "got-it" });
  });

  it("a read-through advance carries revealedAt and no grade, still one key", () => {
    const r1 = mod.flattenPlan(basePlan()).find((c) => c.id === ID_R1);
    const arg = { moduleId: r1.moduleId, topicId: r1.topicId, itemId: r1.id, revealedAt: ISO };
    const { seenDelta } = buildProgressDelta(arg);
    expect(isSingleItemSeenDelta(seenDelta)).toBe(true);
    expect(Object.keys(seenDelta)).toEqual([ID_R1]);
    expect(seenDelta[ID_R1].grade).toBeUndefined();
  });
});

describe("status-driven gating via flattenPlan (no steps when unavailable; partial shows what exists)", () => {
  it("an unavailable plan (zero modules) flattens to no cards; nextCard is complete and summarize is empty", () => {
    const unavailable = normalizePlan({ engine: "gemini", provenance: { research: "partial" }, modules: [] });
    const cards = mod.flattenPlan(unavailable);
    expect(cards).toEqual([]);
    const res = mod.nextCard(cards, {}, null);
    expect(res.id).toBeNull();
    expect(res.complete).toBe(true);
    expect(mod.summarize(cards, {})).toEqual({ total: 0, done: 0, missed: 0, perTopic: {} });
  });

  it("a partial plan shows every card it has -- same cards a ready plan with the same modules would", () => {
    // Partial means provenance.research !== "complete"; it must NOT drop cards.
    const partialInput = { ...basePlanInput(), provenance: { research: "partial", unsourcedTopicIds: ["t2"] } };
    const partial = normalizePlan(partialInput);
    const ready = basePlan();
    const partialCards = mod.flattenPlan(partial);
    expect(partialCards.map((c) => c.id)).toEqual(mod.flattenPlan(ready).map((c) => c.id));
    // the read-through card (no reveal) is still present in a partial plan
    expect(partialCards.some((c) => c.id === ID_R1 && c.hasReveal === false)).toBe(true);
  });
});

describe("empty / malformed input never throws (the schema's never-throw stance)", () => {
  it("flattenPlan, nextCard, summarize, planSignature tolerate null/garbage", () => {
    expect(() => mod.flattenPlan(null)).not.toThrow();
    expect(mod.flattenPlan(null)).toEqual([]);
    expect(() => mod.nextCard(null, null, null)).not.toThrow();
    expect(() => mod.summarize(null, null)).not.toThrow();
    expect(() => mod.planSignature(null)).not.toThrow();
  });
});
