// N157 SC-B-schema -- the pure schema/normalizer module's unit suite
// (plan.r1.md Step 3b, §4.2). RED on HEAD: lib/studyPlan/studyPlanSchema.js
// does not exist yet, so the dynamic import in beforeAll throws and every
// test reds with a "cannot find module" error -- the honest greenfield red
// (vi.mock cannot substitute an unresolvable specifier). Each `it` carries a
// real behavioural assertion so that, once the module lands, the suite
// discriminates a correct build from the specific defects named below.
//
// The two load-bearing properties this file exists to pin, each with a mutant
// a correct build survives and a wrong build dies on:
//   * R5 (content-derived item key): resume must survive a plan regen, so an
//     item's key is a function of its CONTENT, never its array index. The
//     reorder/insert test below reds against an index-keyed normalizePlan.
//   * R6/M3 (bounded progress delta): a progress write carries ONE seen entry,
//     never the whole seen map -- the property that makes two devices
//     non-clobbering. The one-key assertions below red against a whole-map
//     emitter.
//
// Import specifier is the one SC-A/SC-B-persist/generation will use.

import { describe, it, expect, beforeAll } from "vitest";

let mod = null;

beforeAll(async () => {
  mod = await import("@/lib/studyPlan/studyPlanSchema.js");
});

// --- shared fixtures ------------------------------------------------------
// Three items with DISTINCT content. Content, not position, is what a key
// must track, so these are referenced by their text below.
const ITEM_A = { topicHint: "system-design", text: "Explain the CAP theorem tradeoffs", kind: "new" };
const ITEM_B = { topicHint: "behavioral", text: "Describe a time you resolved a conflict", kind: "review" };
const ITEM_C = { topicHint: "coding", text: "Implement two-sum in O(n)", kind: "new" };

function planInput(items, overrides = {}) {
  return {
    engine: "embedded",
    provenance: { research: "complete", unsourcedTopicIds: [] },
    modules: [{ id: "m1", topics: [{ id: "t1", items }] }],
    ...overrides,
  };
}

// Flatten a normalized plan's items (modules -> topics -> items) into one
// array, defensively, so a test can find an item by its text regardless of
// the exact nesting the normalizer produces.
function flattenItems(plan) {
  const out = [];
  for (const planModule of plan?.modules ?? []) {
    for (const topic of planModule?.topics ?? []) {
      for (const item of topic?.items ?? []) out.push(item);
    }
  }
  return out;
}

function keyOfText(plan, text) {
  const hit = flattenItems(plan).find((it) => it.text === text);
  return hit ? hit.id : undefined;
}

// --- DEFAULT_KNOBS + normalizeKnobs (AC-N157-S12) -------------------------
describe("DEFAULT_KNOBS + normalizeKnobs", () => {
  it("DEFAULT_KNOBS carries exactly the four D-3 knobs", () => {
    expect(Object.keys(mod.DEFAULT_KNOBS).sort()).toEqual(
      ["newReviewRatio", "pace", "topicScope", "weakTopicIds"].sort(),
    );
    expect(mod.DEFAULT_KNOBS.newReviewRatio).toBe(0.5);
    expect(mod.DEFAULT_KNOBS.weakTopicIds).toEqual([]);
    expect(mod.DEFAULT_KNOBS.pace).toEqual({ daysUntil: 7 });
    expect(mod.DEFAULT_KNOBS.topicScope).toEqual({ excludedAreas: [] });
  });

  it("normalizeKnobs(null) returns a CLONE of the defaults -- equal in value, a distinct object (so a caller cannot mutate the frozen shared default)", () => {
    const got = mod.normalizeKnobs(null);
    expect(got).toEqual(mod.DEFAULT_KNOBS);
    expect(got).not.toBe(mod.DEFAULT_KNOBS);
  });

  it("clamps newReviewRatio into [0,1]", () => {
    expect(mod.normalizeKnobs({ newReviewRatio: 5 }).newReviewRatio).toBe(1);
    expect(mod.normalizeKnobs({ newReviewRatio: -2 }).newReviewRatio).toBe(0);
    expect(mod.normalizeKnobs({ newReviewRatio: 0.3 }).newReviewRatio).toBe(0.3);
  });

  it("coerces weakTopicIds / topicScope.excludedAreas to string arrays; a non-array becomes []", () => {
    const got = mod.normalizeKnobs({ weakTopicIds: ["a", 2], topicScope: { excludedAreas: ["sql", 7] } });
    expect(got.weakTopicIds).toEqual(["a", "2"]);
    expect(got.topicScope.excludedAreas).toEqual(["sql", "7"]);
    expect(mod.normalizeKnobs({ weakTopicIds: "not-an-array" }).weakTopicIds).toEqual([]);
  });

  it("coerces pace.daysUntil to a POSITIVE INTEGER; garbage falls back to the default", () => {
    expect(mod.normalizeKnobs({ pace: { daysUntil: 14 } }).pace.daysUntil).toBe(14);
    const fractional = mod.normalizeKnobs({ pace: { daysUntil: 3.7 } }).pace.daysUntil;
    expect(Number.isInteger(fractional)).toBe(true);
    expect(fractional).toBeGreaterThan(0);
    // 0, negative, and non-numeric are not positive ints -> default (7).
    expect(mod.normalizeKnobs({ pace: { daysUntil: 0 } }).pace.daysUntil).toBe(7);
    expect(mod.normalizeKnobs({ pace: { daysUntil: -5 } }).pace.daysUntil).toBe(7);
    expect(mod.normalizeKnobs({ pace: { daysUntil: "soon" } }).pace.daysUntil).toBe(7);
  });

  it("never throws on null/undefined/garbage -- always a well-formed knobs object", () => {
    for (const bad of [null, undefined, "x", 42, [], true, { pace: null }]) {
      expect(() => mod.normalizeKnobs(bad)).not.toThrow();
      const got = mod.normalizeKnobs(bad);
      expect(typeof got.newReviewRatio).toBe("number");
      expect(Array.isArray(got.weakTopicIds)).toBe(true);
      expect(typeof got.pace.daysUntil).toBe("number");
      expect(Array.isArray(got.topicScope.excludedAreas)).toBe(true);
    }
  });
});

// --- itemKey: content-derived, deterministic (R5, lower level) ------------
describe("itemKey -- deterministic function of item CONTENT", () => {
  it("equal content yields equal keys (determinism across rebuilds -- resume survives a regen)", () => {
    expect(mod.itemKey({ topicHint: "A", text: "X" })).toBe(mod.itemKey({ topicHint: "A", text: "X" }));
  });

  it("different text yields a different key", () => {
    expect(mod.itemKey({ topicHint: "A", text: "X" })).not.toBe(mod.itemKey({ topicHint: "A", text: "Y" }));
  });

  it("different topicHint yields a different key (the hint is part of the identity)", () => {
    expect(mod.itemKey({ topicHint: "A", text: "X" })).not.toBe(mod.itemKey({ topicHint: "B", text: "X" }));
  });

  it("returns a non-empty string", () => {
    const k = mod.itemKey({ topicHint: "A", text: "X" });
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
  });
});

// --- normalizePlan item keys: INDEX-INDEPENDENT (R5, the canary) ----------
describe("normalizePlan -- item keys track CONTENT, not array position (R5 canary)", () => {
  // THE mutant this kills: `item.id = String(index)` (or any positional key)
  // inside normalizePlan. An index-keyed build gives ITEM_A a different id
  // once its position changes, so resume/`seen` would silently point at the
  // wrong card after a plan regen that reordered or inserted items. A
  // content-derived key gives ITEM_A the SAME id in all three plans below.
  it("reordering items does not change an item's key", () => {
    const forward = mod.normalizePlan(planInput([ITEM_A, ITEM_B, ITEM_C]));
    const reordered = mod.normalizePlan(planInput([ITEM_C, ITEM_A, ITEM_B]));
    const kForward = keyOfText(forward, ITEM_A.text);
    const kReordered = keyOfText(reordered, ITEM_A.text);
    expect(kForward, "ITEM_A not found in forward plan").toBeTruthy();
    expect(kReordered).toBe(kForward);
  });

  it("inserting an item at the front (shifting every index) does not change a later item's key", () => {
    const forward = mod.normalizePlan(planInput([ITEM_A, ITEM_B, ITEM_C]));
    const inserted = mod.normalizePlan(
      planInput([{ topicHint: "intro", text: "Warm-up overview", kind: "new" }, ITEM_A, ITEM_B, ITEM_C]),
    );
    expect(keyOfText(inserted, ITEM_C.text)).toBe(keyOfText(forward, ITEM_C.text));
  });

  it("distinct items within one plan have distinct keys (positive control -- keys are not all one constant)", () => {
    const plan = mod.normalizePlan(planInput([ITEM_A, ITEM_B, ITEM_C]));
    const keys = [ITEM_A, ITEM_B, ITEM_C].map((it) => keyOfText(plan, it.text));
    expect(new Set(keys).size).toBe(3);
  });

  it("a caller-supplied item.id is preserved (regen that already carried stable ids keeps them)", () => {
    const plan = mod.normalizePlan(planInput([{ ...ITEM_A, id: "stable-123" }]));
    expect(keyOfText(plan, ITEM_A.text)).toBe("stable-123");
  });
});

// --- buildProgressDelta + isSingleItemSeenDelta (R6/M3, the canary) -------
describe("buildProgressDelta -- a BOUNDED, single-item seen delta (M3 canary)", () => {
  // THE defect this exists to stop: emitting the whole `seen` map, which makes
  // two devices clobber each other on a server-side merge. The delta carries
  // EXACTLY ONE key -- the itemId just revealed/graded.
  it("seenDelta has exactly one key = itemId, and cursor mirrors the coordinates", () => {
    const delta = mod.buildProgressDelta({
      moduleId: "m1",
      topicId: "t1",
      itemId: "item-xyz",
      revealedAt: "2026-10-11T00:00:00.000Z",
      grade: 4,
      dueAt: "2026-10-18T00:00:00.000Z",
    });
    expect(Object.keys(delta.seenDelta)).toEqual(["item-xyz"]);
    expect(delta.cursor).toEqual({ moduleId: "m1", topicId: "t1", itemId: "item-xyz" });
    expect(delta.seenDelta["item-xyz"]).toMatchObject({
      revealedAt: "2026-10-11T00:00:00.000Z",
      grade: 4,
      dueAt: "2026-10-18T00:00:00.000Z",
    });
  });

  it("the seen entry is keyed by itemId -- NOT by topicId or moduleId (kills a mis-keyed delta)", () => {
    const delta = mod.buildProgressDelta({ moduleId: "m9", topicId: "t9", itemId: "the-item" });
    expect(Object.keys(delta.seenDelta)).toEqual(["the-item"]);
    expect(delta.seenDelta).not.toHaveProperty("t9");
    expect(delta.seenDelta).not.toHaveProperty("m9");
  });

  it("a second card produces its OWN single-key delta, carrying nothing about the first (the non-clobber property)", () => {
    const first = mod.buildProgressDelta({ moduleId: "m1", topicId: "t1", itemId: "card-1", grade: 2 });
    const second = mod.buildProgressDelta({ moduleId: "m1", topicId: "t1", itemId: "card-2", grade: 5 });
    expect(Object.keys(first.seenDelta)).toEqual(["card-1"]);
    expect(Object.keys(second.seenDelta)).toEqual(["card-2"]);
    // The second delta must NOT re-carry card-1 (that would be the whole-map clobber).
    expect(second.seenDelta).not.toHaveProperty("card-1");
  });
});

describe("isSingleItemSeenDelta -- the guard the store asserts before the RPC call", () => {
  it("true for a one-key delta whose value has the seen-entry shape (positive control)", () => {
    expect(mod.isSingleItemSeenDelta({ "card-1": { revealedAt: "2026-10-11T00:00:00.000Z" } })).toBe(true);
  });

  it("false for a TWO-key map -- the whole-map clobber (kills an over-permissive guard)", () => {
    expect(
      mod.isSingleItemSeenDelta({
        "card-1": { revealedAt: "a" },
        "card-2": { revealedAt: "b" },
      }),
    ).toBe(false);
  });

  it("false for an empty map, null, and non-objects (kills an under-firing guard that waves everything through)", () => {
    expect(mod.isSingleItemSeenDelta({})).toBe(false);
    expect(mod.isSingleItemSeenDelta(null)).toBe(false);
    expect(mod.isSingleItemSeenDelta(undefined)).toBe(false);
    expect(mod.isSingleItemSeenDelta("card-1")).toBe(false);
    expect(mod.isSingleItemSeenDelta(["card-1"])).toBe(false);
  });

  it("the delta buildProgressDelta produces passes isSingleItemSeenDelta (the join -- producer's real output into the consumer's real guard)", () => {
    const delta = mod.buildProgressDelta({ moduleId: "m1", topicId: "t1", itemId: "card-1", grade: 3 });
    expect(mod.isSingleItemSeenDelta(delta.seenDelta)).toBe(true);
  });
});

// --- normalizePlan provenance / engine (AC-N157-S6 / ARCH-N157-4 / R8) ----
describe("normalizePlan -- provenance + engine honesty (a partial plan can never read as complete)", () => {
  it("carries engine, provenance.research and provenance.unsourcedTopicIds through", () => {
    const plan = mod.normalizePlan(
      planInput([ITEM_A], {
        engine: "gemini",
        provenance: { research: "partial", unsourcedTopicIds: ["t-behavioral"] },
      }),
    );
    expect(plan.engine).toBe("gemini");
    expect(plan.provenance.research).toBe("partial");
    expect(plan.provenance.unsourcedTopicIds).toEqual(["t-behavioral"]);
  });

  it("isPartialPlan is true iff provenance.research !== \"complete\"", () => {
    const complete = mod.normalizePlan(planInput([ITEM_A], { provenance: { research: "complete", unsourcedTopicIds: [] } }));
    const partial = mod.normalizePlan(planInput([ITEM_A], { provenance: { research: "partial", unsourcedTopicIds: ["t1"] } }));
    expect(mod.isPartialPlan(complete)).toBe(false);
    expect(mod.isPartialPlan(partial)).toBe(true);
  });

  it("unsourcedTopicIds(plan) reads the provenance list back", () => {
    const partial = mod.normalizePlan(planInput([ITEM_A], { provenance: { research: "partial", unsourcedTopicIds: ["t-a", "t-b"] } }));
    expect(mod.unsourcedTopicIds(partial)).toEqual(["t-a", "t-b"]);
  });

  it("a missing/garbage provenance defaults to a well-formed EMPTY-but-flagged shape -- never silently \"complete\"", () => {
    // R8 + AC-N157-S3: the dangerous default is treating an unresearched plan
    // as complete. A plan built with no provenance must NOT report complete.
    const plan = mod.normalizePlan({ modules: [{ id: "m1", topics: [{ id: "t1", items: [ITEM_A] }] }] });
    expect(plan.provenance).toBeTruthy();
    expect(Array.isArray(plan.provenance.unsourcedTopicIds)).toBe(true);
    expect(mod.isPartialPlan(plan)).toBe(true);
  });
});

// --- citation pass-through (plan §2.4/§7 -- the OPEN decision) ------------
describe("normalizePlan -- citation internals pass through UNCHANGED (keeps SC-A free to freeze the shape)", () => {
  it("an arbitrary extra field on a citation survives normalization verbatim", () => {
    // The per-citation element shape is deliberately NOT frozen here (arch
    // §13). normalizePlan must not strip fields it does not know, or SC-A
    // would inherit a wrong guess. A title + an arbitrary extra field must
    // survive.
    const citation = { url: "https://example.com/a", title: "Example", publishedAt: "2026-01-01", extra: "keep-me" };
    const plan = mod.normalizePlan(planInput([{ ...ITEM_A, citations: [citation] }]));
    const item = flattenItems(plan).find((it) => it.text === ITEM_A.text);
    expect(item.citations).toEqual([citation]);
    expect(item.citations[0].extra).toBe("keep-me");
  });
});

// --- normalizeProgress + STUDY_PLAN_VERSION -------------------------------
describe("normalizeProgress + STUDY_PLAN_VERSION", () => {
  it("STUDY_PLAN_VERSION is a positive integer", () => {
    expect(Number.isInteger(mod.STUDY_PLAN_VERSION)).toBe(true);
    expect(mod.STUDY_PLAN_VERSION).toBeGreaterThan(0);
  });

  it("normalizeProgress stamps v = STUDY_PLAN_VERSION and keeps seen keyed by itemId at the top level (merge-friendly -- plan §7)", () => {
    const progress = mod.normalizeProgress({
      cursor: { moduleId: "m1", topicId: "t1", itemId: "card-1" },
      seen: { "card-1": { revealedAt: "2026-10-11T00:00:00.000Z", grade: 4 } },
    });
    expect(progress.v).toBe(mod.STUDY_PLAN_VERSION);
    expect(progress.cursor).toEqual({ moduleId: "m1", topicId: "t1", itemId: "card-1" });
    expect(progress.seen["card-1"]).toMatchObject({ revealedAt: "2026-10-11T00:00:00.000Z", grade: 4 });
  });

  it("never throws on null/garbage -- returns a well-formed empty progress", () => {
    for (const bad of [null, undefined, "x", 42, []]) {
      expect(() => mod.normalizeProgress(bad)).not.toThrow();
      const got = mod.normalizeProgress(bad);
      expect(got.v).toBe(mod.STUDY_PLAN_VERSION);
      expect(typeof got.seen).toBe("object");
      expect(got.seen).not.toBeNull();
    }
  });
});

// --- normalizers never throw (R7, consolidated) ---------------------------
describe("every normalizer is total -- a legacy/corrupt row never crashes a read (R7)", () => {
  it("normalizePlan never throws on null/garbage and still yields a modules array + flagged provenance", () => {
    for (const bad of [null, undefined, "x", 42, [], { modules: "nope" }]) {
      expect(() => mod.normalizePlan(bad)).not.toThrow();
      const got = mod.normalizePlan(bad);
      expect(Array.isArray(got.modules)).toBe(true);
      expect(mod.isPartialPlan(got)).toBe(true);
    }
  });
});
