// The falsifier for lib/experience/knowledgeView.js — written from
// 3-plan-knowledge.md's Wave 3b contract BEFORE the module exists, and cross-
// checked against lib/experience/knowledgeScope.js's ACTUAL shipped shapes
// (classifyScopePages / resolveCitedPageIds / buildRetrievalOutcome), which
// this file's fixtures mirror exactly rather than a restatement of the plan.
//
// THE FOUR STATES THIS MODULE MUST NEVER COLLAPSE (AC-8.1/8.2/8.3/8.4, and
// the standing doctrine DigestPanel.js's header names): content present; the
// scope genuinely had nothing; the pipeline received input and produced
// nothing; and a record that predates the feature (retrieval_outcome is SQL
// NULL). This module does not classify which of the four a caller is in --
// that is the panel's job, in a later wave -- but `coverageFor`'s `consistent`
// flag is what lets the panel refuse to assert a coverage claim it cannot
// back up, and `answerShortfallFor` is what lets a *complete* answer over a
// *partial* scope read differently from the same answer over a full one.
//
// PRODUCTION-SHAPED FIXTURES, BESIDE FLAT ONES, NEVER REPLACING THEM. 1f
// measured 29 of 52 page fixtures in this repo missing `parent_id`,
// including every one in knowledgeBase.test.js -- so `pages` fixtures here
// always carry parent_id, updated_at, created_at, user_id, generated_kind
// and generated_at, exactly like a real experience_pages row, and at least
// one fixture is a genuine root -> child -> grandchild subtree. A staleness
// check built on crude JSON.stringify-equality would treat two fixtures that
// are BOTH missing `updated_at` as "the same" for the wrong reason -- both
// serialize the key away -- so every comparison here is on a fixture that
// actually carries the field, which is the only way a "changed" assertion
// can prove the branch fires rather than passing vacuously.

import { describe, it, expect } from "vitest";
import { stalenessFor, coverageFor, citationView, answerShortfallFor } from "./knowledgeView.js";

// ---------------------------------------------------------------------- fixtures

// A source_pages[i] entry, exactly classifyScopePages' shape
// (knowledgeScope.js:157-165, 194-226): id, title, updated_at, parent_id,
// position, included, reason, rank, excerpted. Never user_id/created_at/
// generated_kind -- those never made it into source_pages at all.
function sourceEntry(overrides = {}) {
  return {
    id: "p1",
    title: "Payments platform",
    updated_at: "2026-01-01T00:00:00.000Z",
    parent_id: null,
    position: 0,
    included: true,
    reason: "included",
    rank: 0,
    excerpted: false,
    ...overrides,
  };
}

// A live experience_pages row, PRODUCTION-SHAPED: every column a real row
// carries, not just the ones this module happens to read.
function livePage(overrides = {}) {
  return {
    id: "p1",
    title: "Payments platform",
    parent_id: null,
    position: 0,
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2025-06-01T00:00:00.000Z",
    user_id: "u-1",
    generated_kind: null,
    generated_at: null,
    archived_at: null,
    ...overrides,
  };
}

function retrievalOutcome(overrides = {}) {
  return {
    version: 1,
    counts: {
      pagesFetched: 3,
      pagesInScope: 3,
      pagesEligible: 3,
      pagesWithMaterial: 3,
      pagesRanked: 3,
      pagesIncluded: 3,
    },
    countsViolation: null,
    anomaly: null,
    citations: { counts: {}, countsViolation: null, anomaly: null },
    model: {},
    refused: [],
    truncatedRead: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------- stalenessFor

describe("stalenessFor", () => {
  it("reports nothing when the live tree matches source_pages exactly", () => {
    const source = [sourceEntry({ id: "p1" }), sourceEntry({ id: "p2", position: 1 })];
    const live = [livePage({ id: "p1" }), livePage({ id: "p2", position: 1 })];
    const result = stalenessFor(source, live);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.moved).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("attachmentsNotCovered is always true -- attachments live in a separate table no page comparison can see", () => {
    expect(stalenessFor([], []).attachmentsNotCovered).toBe(true);
    expect(stalenessFor([sourceEntry()], [livePage()]).attachmentsNotCovered).toBe(true);
  });

  it("names a page present in the live tree but absent from source_pages as ADDED, with the live title", () => {
    const source = [sourceEntry({ id: "p1" })];
    const live = [livePage({ id: "p1" }), livePage({ id: "p2", title: "New notes" })];
    const result = stalenessFor(source, live);
    expect(result.added).toEqual([{ id: "p2", title: "New notes" }]);
    expect(result.removed).toEqual([]);
  });

  it("a temp- optimistic row is ADDED, never CHANGED (useExperiencePages.js:90's client-minted id)", () => {
    const source = [sourceEntry({ id: "p1" })];
    const live = [livePage({ id: "p1" }), livePage({ id: "temp-1699999999-ab12cd", title: "Draft page" })];
    const result = stalenessFor(source, live);
    expect(result.added).toEqual([{ id: "temp-1699999999-ab12cd", title: "Draft page" }]);
    expect(result.changed).toEqual([]);
    expect(result.moved).toEqual([]);
  });

  it("names a source_pages entry with no matching live row as REMOVED, using the STORED title (the live tree cannot resolve it)", () => {
    const source = [sourceEntry({ id: "p1" }), sourceEntry({ id: "p2", title: "Deleted page" })];
    const live = [livePage({ id: "p1" })];
    const result = stalenessFor(source, live);
    expect(result.removed).toEqual([{ id: "p2", title: "Deleted page" }]);
  });

  it("MOVE is separated from EDIT exactly: updated_at changed AND parent_id changed => moved, never changed", () => {
    const source = [sourceEntry({ id: "p1", parent_id: null, position: 0, updated_at: "2026-01-01T00:00:00.000Z" })];
    const live = [
      livePage({ id: "p1", parent_id: "root-2", position: 0, updated_at: "2026-02-01T00:00:00.000Z", title: "Payments platform" }),
    ];
    const result = stalenessFor(source, live);
    expect(result.moved).toEqual([{ id: "p1", title: "Payments platform" }]);
    expect(result.changed).toEqual([]);
  });

  it("MOVE also fires on a position-only change within the same parent (a drag reorders siblings)", () => {
    const source = [sourceEntry({ id: "p1", parent_id: "root", position: 0, updated_at: "2026-01-01T00:00:00.000Z" })];
    const live = [livePage({ id: "p1", parent_id: "root", position: 2, updated_at: "2026-02-01T00:00:00.000Z" })];
    const result = stalenessFor(source, live);
    expect(result.moved).toEqual([{ id: "p1", title: "Payments platform" }]);
    expect(result.changed).toEqual([]);
  });

  it("EDIT fires only when updated_at changed AND parent_id/position both held steady -- the genuine 'changed' branch, not a vacuous pass", () => {
    const source = [sourceEntry({ id: "p1", parent_id: "root", position: 0, updated_at: "2026-01-01T00:00:00.000Z" })];
    const live = [
      livePage({ id: "p1", parent_id: "root", position: 0, updated_at: "2026-02-01T00:00:00.000Z", title: "Payments platform (rewritten)" }),
    ];
    const result = stalenessFor(source, live);
    expect(result.changed).toEqual([{ id: "p1", title: "Payments platform (rewritten)" }]);
    expect(result.moved).toEqual([]);
  });

  it("a row whose updated_at did not change produces no signal at all, even if other fields differ", () => {
    const source = [sourceEntry({ id: "p1", updated_at: "2026-01-01T00:00:00.000Z" })];
    const live = [livePage({ id: "p1", updated_at: "2026-01-01T00:00:00.000Z", title: "A different title somehow" })];
    const result = stalenessFor(source, live);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.moved).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("handles a genuine root -> child -> grandchild subtree with all three ids reaching the comparison, unchanged", () => {
    const source = [
      sourceEntry({ id: "root", parent_id: null, position: 0, title: "Root" }),
      sourceEntry({ id: "child", parent_id: "root", position: 0, title: "Child" }),
      sourceEntry({ id: "grandchild", parent_id: "child", position: 0, title: "Grandchild" }),
    ];
    const live = [
      livePage({ id: "root", parent_id: null, position: 0, title: "Root" }),
      livePage({ id: "child", parent_id: "root", position: 0, title: "Child" }),
      livePage({ id: "grandchild", parent_id: "child", position: 0, title: "Grandchild" }),
    ];
    const result = stalenessFor(source, live);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.moved).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("never throws on malformed input and degrades to empty lists", () => {
    expect(() => stalenessFor(null, undefined)).not.toThrow();
    expect(stalenessFor("not an array", 42)).toEqual({
      added: [],
      removed: [],
      moved: [],
      changed: [],
      attachmentsNotCovered: true,
    });
    // A malformed entry inside an otherwise-valid array must not abort the
    // whole comparison (count-first discipline, matching classifyScopePages).
    const source = [sourceEntry({ id: "p1" }), null, "garbage", 42];
    const live = [livePage({ id: "p1" })];
    expect(() => stalenessFor(source, live)).not.toThrow();
  });
});

// ---------------------------------------------------------------------- coverageFor

describe("coverageFor", () => {
  it("complete coverage: every page included, matches the stored count, byReason is empty", () => {
    const source = [sourceEntry({ id: "p1" }), sourceEntry({ id: "p2", rank: 1 })];
    const outcome = retrievalOutcome({ counts: { pagesInScope: 2, pagesIncluded: 2 } });
    const result = coverageFor(source, outcome);
    expect(result).toMatchObject({ total: 2, included: 2, excluded: 0, byReason: {}, consistent: true });
  });

  it("partial coverage: excluded pages are grouped by their AC-3.7 reason, never merged into one bucket", () => {
    const source = [
      sourceEntry({ id: "p1", included: true, reason: "included", rank: 0 }),
      sourceEntry({ id: "p2", included: false, reason: "budget", rank: 1 }),
      sourceEntry({ id: "p3", included: false, reason: "ineligible", rank: null }),
      sourceEntry({ id: "p4", included: false, reason: "budget", rank: 2 }),
    ];
    const outcome = retrievalOutcome({ counts: { pagesInScope: 4, pagesIncluded: 1 } });
    const result = coverageFor(source, outcome);
    expect(result.total).toBe(4);
    expect(result.included).toBe(1);
    expect(result.excluded).toBe(3);
    expect(result.byReason).toEqual({ budget: 2, ineligible: 1 });
  });

  it("consistent is FALSE when the computed included count disagrees with the stored retrieval_outcome -- the column-wise upsert's one runtime binding", () => {
    const source = [sourceEntry({ id: "p1", included: true }), sourceEntry({ id: "p2", included: true, rank: 1 })];
    // A stale/foreign retrieval_outcome claiming only 1 page was included.
    const outcome = retrievalOutcome({ counts: { pagesInScope: 2, pagesIncluded: 1 } });
    const result = coverageFor(source, outcome);
    expect(result.included).toBe(2);
    expect(result.consistent).toBe(false);
  });

  it("consistent is FALSE (never vacuously true) when retrieval_outcome is entirely absent -- a record that predates the feature", () => {
    const source = [sourceEntry({ id: "p1", included: true })];
    expect(coverageFor(source, null).consistent).toBe(false);
    expect(coverageFor(source, undefined).consistent).toBe(false);
  });

  it("an empty scope with a matching zero count is genuinely consistent -- state 2, not state 3", () => {
    const outcome = retrievalOutcome({ counts: { pagesInScope: 0, pagesIncluded: 0 } });
    const result = coverageFor([], outcome);
    expect(result).toMatchObject({ total: 0, included: 0, excluded: 0, consistent: true });
  });

  it("attachmentsSkipped reads retrieval_outcome.counts.attachmentsSkipped defensively, defaulting to 0", () => {
    const outcome = retrievalOutcome({ counts: { pagesInScope: 1, pagesIncluded: 1, attachmentsSkipped: 4 } });
    expect(coverageFor([sourceEntry()], outcome).attachmentsSkipped).toBe(4);
    expect(coverageFor([sourceEntry()], retrievalOutcome()).attachmentsSkipped).toBe(0);
    expect(coverageFor([sourceEntry()], retrievalOutcome({ counts: { attachmentsSkipped: -3 } })).attachmentsSkipped).toBe(0);
    expect(coverageFor([sourceEntry()], retrievalOutcome({ counts: { attachmentsSkipped: "4" } })).attachmentsSkipped).toBe(0);
  });

  it("a page with a missing/blank reason groups under 'unknown' rather than being dropped from the count", () => {
    const source = [sourceEntry({ id: "p1", included: false, reason: undefined, rank: null })];
    const result = coverageFor(source, retrievalOutcome({ counts: { pagesIncluded: 0 } }));
    expect(result.byReason).toEqual({ unknown: 1 });
    expect(result.excluded).toBe(1);
  });

  it("never throws on malformed input", () => {
    expect(() => coverageFor(null, null)).not.toThrow();
    expect(coverageFor(undefined, "garbage")).toMatchObject({ total: 0, included: 0, excluded: 0, byReason: {} });
  });
});

// ---------------------------------------------------------------------- citationView

describe("citationView", () => {
  it("resolves a live page's title from the LIVE tree, never from the citation record itself", () => {
    const citations = [{ pageId: "p1", title: "a hostile stored label" }];
    const pages = [livePage({ id: "p1", title: "Payments platform" })];
    expect(citationView(citations, pages)).toEqual([{ pageId: "p1", title: "Payments platform", state: "live" }]);
  });

  it("an archived page still resolves a title (it exists) but is flagged archived, not live", () => {
    const citations = [{ pageId: "p1" }];
    const pages = [livePage({ id: "p1", archived_at: "2026-01-01T00:00:00.000Z" })];
    expect(citationView(citations, pages)).toEqual([{ pageId: "p1", title: "Payments platform", state: "archived" }]);
  });

  it("a citation whose page no longer exists renders as gone, with NO title at all -- naming it would be worse than the deletion", () => {
    const citations = [{ pageId: "deleted-page" }];
    const pages = [livePage({ id: "p1" })];
    expect(citationView(citations, pages)).toEqual([{ pageId: "deleted-page", title: null, state: "gone" }]);
  });

  it("preserves citation order and handles a mix of all three states in one answer", () => {
    const citations = [{ pageId: "live-1" }, { pageId: "gone-1" }, { pageId: "archived-1" }];
    const pages = [
      livePage({ id: "live-1", title: "Live page" }),
      livePage({ id: "archived-1", title: "Archived page", archived_at: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(citationView(citations, pages)).toEqual([
      { pageId: "live-1", title: "Live page", state: "live" },
      { pageId: "gone-1", title: null, state: "gone" },
      { pageId: "archived-1", title: "Archived page", state: "archived" },
    ]);
  });

  it("drops a citation entry with no usable pageId rather than rendering a blank row", () => {
    const citations = [{ pageId: "" }, { pageId: 42 }, {}, null, { pageId: "p1" }];
    const pages = [livePage({ id: "p1" })];
    expect(citationView(citations, pages)).toEqual([{ pageId: "p1", title: "Payments platform", state: "live" }]);
  });

  it("never throws on malformed input", () => {
    expect(() => citationView(null, null)).not.toThrow();
    expect(citationView("garbage", 42)).toEqual([]);
  });
});

// ---------------------------------------------------------------------- answerShortfallFor

describe("answerShortfallFor", () => {
  it("is non-null when pagesIncluded < pagesWithMaterial -- the page holding the answer may have been left out", () => {
    const outcome = retrievalOutcome({ counts: { pagesWithMaterial: 20, pagesIncluded: 8 } });
    expect(answerShortfallFor(outcome)).toEqual({ shown: 8, withMaterial: 20, shortfall: 12 });
  });

  it("is null when every eligible page with material was shown (shown === withMaterial)", () => {
    const outcome = retrievalOutcome({ counts: { pagesWithMaterial: 5, pagesIncluded: 5 } });
    expect(answerShortfallFor(outcome)).toBeNull();
  });

  it("is null when shown exceeds withMaterial -- should never happen, but this function never repairs, only refuses to assert a shortfall that isn't one", () => {
    const outcome = retrievalOutcome({ counts: { pagesWithMaterial: 3, pagesIncluded: 5 } });
    expect(answerShortfallFor(outcome)).toBeNull();
  });

  it("is null for a missing, malformed, or count-free retrieval_outcome", () => {
    expect(answerShortfallFor(null)).toBeNull();
    expect(answerShortfallFor(undefined)).toBeNull();
    expect(answerShortfallFor({})).toBeNull();
    expect(answerShortfallFor({ counts: "garbage" })).toBeNull();
    expect(answerShortfallFor({ counts: { pagesWithMaterial: 5 } })).toBeNull();
  });
});
