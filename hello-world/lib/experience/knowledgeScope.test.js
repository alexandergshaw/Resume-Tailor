import { describe, it, expect } from "vitest";
import {
  SCOPE_SENTINEL,
  scopeKeyFor,
  orderPagesPreOrder,
  collectScopePages,
  KNOWLEDGE_REASONS,
  isScopePageEligible,
  classifyScopePages,
  KNOWLEDGE_RETRIEVAL_STAGES,
  KNOWLEDGE_CITATION_STAGES,
  resolveCitedPageIds,
  buildRetrievalOutcome,
} from "./knowledgeScope.js";

// WRITTEN BEFORE THE MODULE EXISTED, from the plan's stated contract (Wave 3a,
// `3-plan-knowledge.md`). Every fixture below is deliberately production-shaped
// -- every page declares its own `parent_id`, never omits it -- because 29 of
// this repo's 52 page fixtures omit `parent_id`, `tree.js` coerces the missing
// key to `null`, every page becomes top-level, and a scope-collection function
// that silently returned only the selected page would pass a whole suite built
// on those fixtures. See knowledgeBase.test.js for the shape this one refuses
// to copy.

// ---------------------------------------------------------------------------
// The 9-page, 3-level fixture measured in 1d-data-knowledge.md (D-7.1): a
// root with three children (A, B, C), where A and B each have two children
// and C has one. `position` is SIBLING rank (0..n-1 per parent), never a
// global ordinal -- that is the whole point of this fixture.
//
// The array below is built in the FLAT "sort by position ascending" order 1d
// actually measured a real `.order("position")` query producing:
//   root A A1 B1 C1 A2 B B2 C
// (every page whose sibling rank is 0 sorts before every page whose sibling
// rank is 1, regardless of depth). Using that order as the INPUT is the
// discriminating choice: an implementation that merely returns its input
// unchanged, or re-sorts by `position` alone, passes a test built on genuine
// pre-order input by accident. It cannot pass one built on this order.
// ---------------------------------------------------------------------------
const PREORDER_PAGES = [
  { id: "root", title: "Root", parent_id: null, position: 0, created_at: "2024-01-01T00:00:00Z" },
  { id: "A", title: "A", parent_id: "root", position: 0, created_at: "2024-01-01T00:00:01Z" },
  { id: "A1", title: "A1", parent_id: "A", position: 0, created_at: "2024-01-01T00:00:02Z" },
  { id: "B1", title: "B1", parent_id: "B", position: 0, created_at: "2024-01-01T00:00:03Z" },
  { id: "C1", title: "C1", parent_id: "C", position: 0, created_at: "2024-01-01T00:00:04Z" },
  { id: "A2", title: "A2", parent_id: "A", position: 1, created_at: "2024-01-01T00:00:05Z" },
  { id: "B", title: "B", parent_id: "root", position: 1, created_at: "2024-01-01T00:00:06Z" },
  { id: "B2", title: "B2", parent_id: "B", position: 1, created_at: "2024-01-01T00:00:07Z" },
  { id: "C", title: "C", parent_id: "root", position: 2, created_at: "2024-01-01T00:00:08Z" },
];
const TRUE_PREORDER_IDS = ["root", "A", "A1", "A2", "B", "B1", "B2", "C", "C1"];

const CYCLE_PAGES = [
  { id: "x", title: "X", parent_id: "y", position: 0, created_at: "2024-01-01T00:00:00Z" },
  { id: "y", title: "Y", parent_id: "x", position: 0, created_at: "2024-01-01T00:00:01Z" },
];

describe("the 9-page fixture itself", () => {
  it("is genuinely three levels deep -- every row declares its own parent_id, none omitted", () => {
    for (const page of PREORDER_PAGES) {
      expect(Object.prototype.hasOwnProperty.call(page, "parent_id")).toBe(true);
    }
    const byId = new Map(PREORDER_PAGES.map((p) => [p.id, p]));
    const depthOf = (id) => {
      let depth = 0;
      let cur = byId.get(id);
      while (cur && cur.parent_id) {
        depth += 1;
        cur = byId.get(cur.parent_id);
      }
      return depth;
    };
    expect(depthOf("root")).toBe(0);
    expect(depthOf("A")).toBe(1);
    expect(depthOf("B")).toBe(1);
    expect(depthOf("C")).toBe(1);
    expect(depthOf("A1")).toBe(2);
    expect(depthOf("A2")).toBe(2);
    expect(depthOf("B1")).toBe(2);
    expect(depthOf("B2")).toBe(2);
    expect(depthOf("C1")).toBe(2);
    expect(Math.max(...PREORDER_PAGES.map((p) => depthOf(p.id)))).toBe(2);
  });

  it("its own input order is NOT pre-order -- 6 of 9 pages sit at a different index (1d D-7.1)", () => {
    const inputIds = PREORDER_PAGES.map((p) => p.id);
    let differing = 0;
    for (let i = 0; i < inputIds.length; i += 1) {
      if (inputIds[i] !== TRUE_PREORDER_IDS[i]) differing += 1;
    }
    expect(differing).toBe(6);
  });
});

describe("scopeKeyFor", () => {
  it("is the nil UUID for null, undefined, blank or non-string input", () => {
    expect(scopeKeyFor(null)).toBe(SCOPE_SENTINEL);
    expect(scopeKeyFor(undefined)).toBe(SCOPE_SENTINEL);
    expect(scopeKeyFor("")).toBe(SCOPE_SENTINEL);
    expect(scopeKeyFor("   ")).toBe(SCOPE_SENTINEL);
    expect(scopeKeyFor(42)).toBe(SCOPE_SENTINEL);
    expect(scopeKeyFor({})).toBe(SCOPE_SENTINEL);
  });

  it("is the trimmed page id otherwise", () => {
    expect(scopeKeyFor("  abc-123  ")).toBe("abc-123");
    expect(scopeKeyFor("p1")).toBe("p1");
  });

  it("the sentinel is the nil UUID, which a v4 page id can never collide with", () => {
    expect(SCOPE_SENTINEL).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("orderPagesPreOrder", () => {
  it("orders the whole forest in genuine pre-order when rootId is null, never the flat position-sorted input order", () => {
    const ids = orderPagesPreOrder(PREORDER_PAGES, null).map((p) => p.id);
    expect(ids).toEqual(TRUE_PREORDER_IDS);
  });

  it("returns actual page objects, not stripped copies", () => {
    const ordered = orderPagesPreOrder(PREORDER_PAGES, null);
    expect(ordered[1]).toMatchObject({ id: "A", title: "A", parent_id: "root", position: 0 });
  });

  it("a page scope is [self, ...descendants] in pre-order", () => {
    expect(orderPagesPreOrder(PREORDER_PAGES, "A").map((p) => p.id)).toEqual(["A", "A1", "A2"]);
    expect(orderPagesPreOrder(PREORDER_PAGES, "B").map((p) => p.id)).toEqual(["B", "B1", "B2"]);
    expect(orderPagesPreOrder(PREORDER_PAGES, "C").map((p) => p.id)).toEqual(["C", "C1"]);
  });

  it("a leaf page's scope is just itself", () => {
    expect(orderPagesPreOrder(PREORDER_PAGES, "A1").map((p) => p.id)).toEqual(["A1"]);
  });

  it("returns an empty array for a scope id absent from pages, never throws", () => {
    expect(orderPagesPreOrder(PREORDER_PAGES, "ghost-page")).toEqual([]);
  });

  it("terminates on a parent cycle and returns each cycle member exactly once (AC-4.2)", () => {
    const ids = orderPagesPreOrder(CYCLE_PAGES, null)
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(["x", "y"]);
  });

  it("never throws on a non-array pages argument", () => {
    expect(orderPagesPreOrder(null, null)).toEqual([]);
    expect(orderPagesPreOrder(undefined, "p1")).toEqual([]);
  });
});

describe("collectScopePages", () => {
  it("the root scope (null) always exists and is the whole forest in pre-order", () => {
    const { scopePages, scopeExists } = collectScopePages(PREORDER_PAGES, null);
    expect(scopeExists).toBe(true);
    expect(scopePages.map((p) => p.id)).toEqual(TRUE_PREORDER_IDS);
  });

  it("a page scope for a real page id exists and is [self, ...descendants]", () => {
    const { scopePages, scopeExists } = collectScopePages(PREORDER_PAGES, "B");
    expect(scopeExists).toBe(true);
    expect(scopePages.map((p) => p.id)).toEqual(["B", "B1", "B2"]);
  });

  it("scopeExists is false for a page id absent from pages -- a 404, never a silently empty scope", () => {
    const { scopePages, scopeExists } = collectScopePages(PREORDER_PAGES, "ghost-page");
    expect(scopeExists).toBe(false);
    expect(scopePages).toEqual([]);
  });

  it("never throws on a non-array pages argument", () => {
    expect(collectScopePages(null, null)).toEqual({ scopePages: [], scopeExists: true });
    expect(collectScopePages(null, "p1")).toEqual({ scopePages: [], scopeExists: false });
  });
});

describe("isScopePageEligible", () => {
  it("is true for an ordinary, non-archived, non-generated page", () => {
    expect(isScopePageEligible({ id: "p1", archived_at: null, generated_kind: null })).toBe(true);
  });

  it("is false for an archived page", () => {
    expect(isScopePageEligible({ id: "p1", archived_at: "2024-06-01T00:00:00Z" })).toBe(false);
  });

  it("is false for a generated page, keyed on the column being set, never on a specific value (AC-4.3)", () => {
    expect(isScopePageEligible({ id: "p1", archived_at: null, generated_kind: "research" })).toBe(false);
    expect(isScopePageEligible({ id: "p1", archived_at: null, generated_kind: "future-generator-name" })).toBe(
      false
    );
  });

  it("a blank generated_kind does not exclude -- only a real, non-blank value does", () => {
    expect(isScopePageEligible({ id: "p1", archived_at: null, generated_kind: "" })).toBe(true);
  });

  it("throws on a page that is not an object -- the classifier's job is to catch this, not this predicate's", () => {
    expect(() => isScopePageEligible(null)).toThrow();
    expect(() => isScopePageEligible(undefined)).toThrow();
  });
});

describe("KNOWLEDGE_REASONS", () => {
  it("is the closed, frozen reason vocabulary, six values including the eligibility-threw addition (1h S-5)", () => {
    expect(KNOWLEDGE_REASONS).toEqual([
      "included",
      "budget",
      "ineligible",
      "eligibility-threw",
      "no-material",
      "no-id",
    ]);
    expect(Object.isFrozen(KNOWLEDGE_REASONS)).toBe(true);
  });
});

describe("classifyScopePages", () => {
  // One hand-built array producing every KNOWLEDGE_REASONS value. The
  // "ineligible"-archived arm is unreachable through the real data path
  // (listPages filters .is("archived_at", null)), so this is deliberately a
  // classifier unit case, not a claim about a data-path test (1b/1f, C14).
  const scopePages = [
    {
      id: "included-1",
      title: "Included page",
      updated_at: "t1",
      parent_id: null,
      position: 0,
      body: "Real prose about the project that is definitely long enough to be material.",
    },
    {
      id: "budget-1",
      title: "Left out by budget",
      updated_at: "t2",
      parent_id: null,
      position: 1,
      body: "Also real prose, but the packer had no budget left for this one.",
    },
    {
      id: "archived-1",
      title: "Archived page",
      updated_at: "t3",
      parent_id: null,
      position: 2,
      body: "Prose that is never reached because the page is archived.",
      archived_at: "2024-06-01T00:00:00Z",
    },
    {
      id: "generated-1",
      title: "Generated page",
      updated_at: "t4",
      parent_id: null,
      position: 3,
      body: "Prose that is never reached because the page is generated.",
      generated_kind: "research",
    },
    {
      id: "empty-1",
      title: "Empty stub",
      updated_at: "t5",
      parent_id: null,
      position: 4,
      body: "",
    },
    {
      id: "",
      title: "No id",
      updated_at: "t6",
      parent_id: null,
      position: 5,
      body: "Prose with no usable id attached to it at all.",
    },
    null,
  ];
  const includedPages = [{ id: "included-1", title: "Included page", excerpted: true }];

  it("produces every KNOWLEDGE_REASONS value from one hand-built array, in order", () => {
    const { sourcePages } = classifyScopePages({ scopePages, includedPages });
    expect(sourcePages).toHaveLength(scopePages.length);
    expect(sourcePages.map((p) => p.reason)).toEqual([
      "included",
      "budget",
      "ineligible",
      "ineligible",
      "no-material",
      "no-id",
      "eligibility-threw",
    ]);
    const reasonsSeen = new Set(sourcePages.map((p) => p.reason));
    for (const reason of KNOWLEDGE_REASONS) {
      expect(reasonsSeen.has(reason)).toBe(true);
    }
  });

  it("marks `included` true only for the page actually present in includedPages", () => {
    const { sourcePages } = classifyScopePages({ scopePages, includedPages });
    expect(sourcePages.map((p) => p.included)).toEqual([true, false, false, false, false, false, false]);
  });

  it("carries `excerpted` from the includedPages entry, never invents it", () => {
    const { sourcePages } = classifyScopePages({ scopePages, includedPages });
    expect(sourcePages[0].excerpted).toBe(true);
    expect(sourcePages[1].excerpted).toBe(false);
  });

  it("assigns `rank` only to pages that reached ranking (eligible + usable id + material), null otherwise", () => {
    const { sourcePages } = classifyScopePages({ scopePages, includedPages });
    expect(sourcePages[0].rank).toBe(0); // included-1
    expect(sourcePages[1].rank).toBe(1); // budget-1
    expect(sourcePages[2].rank).toBe(null); // archived-1 -- ineligible
    expect(sourcePages[3].rank).toBe(null); // generated-1 -- ineligible
    expect(sourcePages[4].rank).toBe(null); // empty-1 -- no-material
    expect(sourcePages[5].rank).toBe(null); // "" -- no-id
    expect(sourcePages[6].rank).toBe(null); // null -- eligibility-threw
  });

  it("carries id, title, updated_at, parent_id and position through untouched", () => {
    const { sourcePages } = classifyScopePages({ scopePages, includedPages });
    expect(sourcePages[0]).toMatchObject({
      id: "included-1",
      title: "Included page",
      updated_at: "t1",
      parent_id: null,
      position: 0,
    });
  });

  it("computes the five-stage counts (pagesInScope through pagesIncluded)", () => {
    const { counts } = classifyScopePages({ scopePages, includedPages });
    expect(counts).toEqual({
      pagesInScope: 7,
      pagesEligible: 4,
      pagesWithMaterial: 2,
      pagesRanked: 2,
      pagesIncluded: 1,
    });
  });

  it("classifies with knowledgeBase.js's OWN hasUsableId/contributesMaterial -- never a re-implementation", () => {
    // A page whose body is nothing but its own section heading is not
    // material (hasProseContent), which only knowledgeBase.js's real
    // contributesMaterial enforces. A local re-implementation using a bare
    // `!!page.body` truth check would wrongly admit it.
    const headingOnly = [
      {
        id: "heading-only",
        title: "Heading only",
        updated_at: "t1",
        parent_id: null,
        position: 0,
        body: "## Overview",
      },
    ];
    const { sourcePages } = classifyScopePages({ scopePages: headingOnly, includedPages: [] });
    expect(sourcePages[0].reason).toBe("no-material");
  });

  it("count-first: keeps classifying every later page after a hand-built row throws mid-scan, never short-circuits", () => {
    const withThrowInMiddle = [
      { id: "p1", title: "P1", parent_id: null, position: 0, body: "Real prose here for p1, long enough." },
      null,
      { id: "p2", title: "P2", parent_id: null, position: 1, body: "Real prose here for p2, long enough." },
    ];
    const included = [
      { id: "p1", title: "P1", excerpted: false },
      { id: "p2", title: "P2", excerpted: false },
    ];
    const { sourcePages, counts } = classifyScopePages({ scopePages: withThrowInMiddle, includedPages: included });
    expect(sourcePages.map((p) => p.reason)).toEqual(["included", "eligibility-threw", "included"]);
    expect(counts.pagesInScope).toBe(3);
    expect(counts.pagesIncluded).toBe(2);
  });

  it("never throws on a non-array scopePages or includedPages", () => {
    const { sourcePages, counts } = classifyScopePages({ scopePages: null, includedPages: null });
    expect(sourcePages).toEqual([]);
    expect(counts).toEqual({
      pagesInScope: 0,
      pagesEligible: 0,
      pagesWithMaterial: 0,
      pagesRanked: 0,
      pagesIncluded: 0,
    });
  });
});

describe("stage constants", () => {
  it("the retrieval chain begins at pagesFetched, a count this module never itself produces (C13)", () => {
    expect(KNOWLEDGE_RETRIEVAL_STAGES).toEqual([
      "pagesFetched",
      "pagesInScope",
      "pagesEligible",
      "pagesWithMaterial",
      "pagesRanked",
      "pagesIncluded",
    ]);
    expect(Object.isFrozen(KNOWLEDGE_RETRIEVAL_STAGES)).toBe(true);
  });

  it("the citation chain is its own, three stages, never spliced onto the retrieval chain", () => {
    expect(KNOWLEDGE_CITATION_STAGES).toEqual(["citationsClaimed", "citationsResolved", "citationsRendered"]);
    expect(Object.isFrozen(KNOWLEDGE_CITATION_STAGES)).toBe(true);
  });
});

describe("resolveCitedPageIds", () => {
  const includedPageIds = ["p1", "p2"];

  it("resolves an in-scope id to a bare {pageId} -- no title, ever (§7 C3)", () => {
    const result = resolveCitedPageIds(["p1"], includedPageIds);
    expect(result.citations).toEqual([{ pageId: "p1" }]);
    expect(result.claimed).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.refused).toEqual([]);
  });

  it("S-4.2: an ineligible page's id -- never sent to the model -- refuses closed, never resolved by source_pages", () => {
    // A scope of pages where "ineligible-1" was recorded in source_pages with
    // reason "ineligible" but was never in includedPageIds because it was
    // never sent to the model. The model naming it anyway (for instance by
    // reading it out of a forged page-boundary heading in another page's
    // body) must fail CLOSED: it is dropped, not resolved against the wrong
    // whitelist. Mutation gate: swap `includedPageIds` for a `source_pages`-
    // shaped id list here -- this case must go red.
    const result = resolveCitedPageIds(["p1", "ineligible-1"], includedPageIds);
    expect(result.citations).toEqual([{ pageId: "p1" }]);
    expect(result.claimed).toBe(2);
    expect(result.resolved).toBe(1);
    expect(result.refused).toEqual([{ reason: "not-in-scope", count: 1 }]);
  });

  it("refuses a non-string/empty id without ever using it as an array subscript", () => {
    const result = resolveCitedPageIds([42, "", null, undefined, {}], includedPageIds);
    expect(result.citations).toEqual([]);
    expect(result.claimed).toBe(5);
    expect(result.resolved).toBe(0);
    expect(result.refused).toEqual([{ reason: "not-a-string", count: 5 }]);
  });

  it("refuses a duplicate id after its first resolution", () => {
    const result = resolveCitedPageIds(["p1", "p1", "p1"], includedPageIds);
    expect(result.citations).toEqual([{ pageId: "p1" }]);
    expect(result.claimed).toBe(3);
    expect(result.resolved).toBe(1);
    expect(result.refused).toEqual([{ reason: "duplicate", count: 2 }]);
  });

  it("a refused entry never carries the model-authored value -- {reason, count} only, never {reason, value}", () => {
    const result = resolveCitedPageIds(["not-a-real-page", "also-not-real"], includedPageIds);
    expect(result.refused).toEqual([{ reason: "not-in-scope", count: 2 }]);
    for (const entry of result.refused) {
      expect(Object.keys(entry).sort()).toEqual(["count", "reason"]);
    }
  });

  it("resolves several distinct in-scope ids, preserving the model's claimed order", () => {
    const result = resolveCitedPageIds(["p2", "p1"], includedPageIds);
    expect(result.citations).toEqual([{ pageId: "p2" }, { pageId: "p1" }]);
  });

  it("never throws on a non-array rawIds or includedPageIds", () => {
    expect(resolveCitedPageIds(null, includedPageIds)).toEqual({
      citations: [],
      claimed: 0,
      resolved: 0,
      refused: [],
    });
    expect(resolveCitedPageIds(["p1"], null)).toEqual({
      citations: [],
      claimed: 1,
      resolved: 0,
      refused: [{ reason: "not-in-scope", count: 1 }],
    });
  });
});

describe("buildRetrievalOutcome", () => {
  it("builds the documented shape: version 1, three independent chain records, model, refused, truncatedRead", () => {
    const counts = {
      pagesFetched: 9,
      pagesInScope: 9,
      pagesEligible: 7,
      pagesWithMaterial: 5,
      pagesRanked: 5,
      pagesIncluded: 3,
    };
    const citationCounts = { citationsClaimed: 5, citationsResolved: 3, citationsRendered: 3 };
    const model = {
      called: true,
      responseTextKind: "present",
      finishReason: "STOP",
      envelopeParsed: true,
      answerChars: 120,
    };
    const outcome = buildRetrievalOutcome({
      counts,
      citationCounts,
      model,
      refused: [{ reason: "not-in-scope", count: 2 }],
      truncatedRead: false,
    });
    expect(outcome).toEqual({
      version: 1,
      counts,
      countsViolation: null,
      anomaly: null,
      citations: { counts: citationCounts, countsViolation: null, anomaly: null },
      model,
      refused: [{ reason: "not-in-scope", count: 2 }],
      truncatedRead: false,
    });
  });

  it("does NOT splice citationsClaimed onto the retrieval chain -- a model over-claiming ids must not manufacture a retrieval countsViolation (C13)", () => {
    const counts = {
      pagesFetched: 3,
      pagesInScope: 3,
      pagesEligible: 3,
      pagesWithMaterial: 3,
      pagesRanked: 3,
      pagesIncluded: 1,
    };
    // The model claimed 9 citations though only 1 page was ever included --
    // citationsClaimed (9) > pagesIncluded (1) is expected, not a defect, and
    // must never leak into `counts`/`countsViolation` above.
    const citationCounts = { citationsClaimed: 9, citationsResolved: 1, citationsRendered: 1 };
    const outcome = buildRetrievalOutcome({ counts, citationCounts, model: {}, refused: [], truncatedRead: false });
    expect(outcome.counts).toEqual(counts);
    expect(outcome.countsViolation).toBe(null);
    expect(outcome.citations.countsViolation).toBe(null);
  });

  it("the retrieval anomaly names the isEligible-omitted zero-out (AC-4.7), distinguishing it from a genuinely empty scope", () => {
    const counts = {
      pagesFetched: 5,
      pagesInScope: 5,
      pagesEligible: 0,
      pagesWithMaterial: 0,
      pagesRanked: 0,
      pagesIncluded: 0,
    };
    const outcome = buildRetrievalOutcome({
      counts,
      citationCounts: { citationsClaimed: 0, citationsResolved: 0, citationsRendered: 0 },
      model: {},
      refused: [],
      truncatedRead: false,
    });
    expect(outcome.anomaly).toEqual({
      stage: "pagesEligible",
      from: "pagesInScope",
      to: "pagesEligible",
      inputCount: 5,
      outputCount: 0,
    });
  });

  it("the citation chain reports its OWN anomaly independently of the retrieval chain's", () => {
    const counts = {
      pagesFetched: 3,
      pagesInScope: 3,
      pagesEligible: 3,
      pagesWithMaterial: 3,
      pagesRanked: 3,
      pagesIncluded: 2,
    };
    const citationCounts = { citationsClaimed: 4, citationsResolved: 0, citationsRendered: 0 };
    const outcome = buildRetrievalOutcome({ counts, citationCounts, model: {}, refused: [], truncatedRead: false });
    expect(outcome.anomaly).toBe(null);
    expect(outcome.citations.anomaly).toEqual({
      stage: "citationsResolved",
      from: "citationsClaimed",
      to: "citationsResolved",
      inputCount: 4,
      outputCount: 0,
    });
  });

  it("defaults refused to [] and truncatedRead to false, and counts/citationCounts to {} -- never undefined, so no jsonb key is silently dropped", () => {
    const outcome = buildRetrievalOutcome({});
    expect(outcome.refused).toEqual([]);
    expect(outcome.truncatedRead).toBe(false);
    expect(outcome.counts).toEqual({});
    expect(outcome.citations.counts).toEqual({});
    expect(outcome.model).toEqual({});
  });
});
