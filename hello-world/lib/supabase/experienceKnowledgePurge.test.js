// The falsifier for the half of the owner's purge ruling that NO DATABASE CAN
// DO. Written before lib/supabase/experienceKnowledgePurge.js exists.
//
// The ruling: deleting a knowledge page invalidates every stored summary and
// every stored answer whose scope CONTAINED it.
//
// supabase/migrations/20260906010000_experience_knowledge.sql's own header
// ("WHAT DELETING A PAGE PURGES -- AND WHAT THE SCHEMA CANNOT REACH") states
// the boundary in mechanical terms, and it is the authority for every claim
// below:
//
//   * the two composite FKs' `on delete cascade` reach the DELETED PAGE'S OWN
//     scope and, through experience_pages' own self-referencing cascade, every
//     DESCENDANT scope, transitively;
//   * they can NEVER reach an ANCESTOR scope. An ancestor's row carries a
//     scope_page_id naming the ANCESTOR, not the deleted page, so deleting the
//     page touches no column any such row's FK points at, and no cascade,
//     `set null` or trigger declared on the deleted row can ever fire for it.
//     The root scope (scope_page_id IS NULL) is the extreme case: it has no
//     scope_page_id at all, so no page delete at any depth can reach it.
//
// So the assertion this file exists for is the one that goes red the moment
// somebody concludes the FK cascade is the whole implementation: AN ANCESTOR'S
// ROW GOES TOO, INCLUDING THE ROOT SCOPE'S.
//
// Everything is asserted on the RECORDED CALL CHAIN, never on returned rows.
// test/helpers/supabaseFake.js's own header states its `.eq()` does not
// filter, and a sibling pass measured 10 of 10 tenancy tests still passing
// with `.eq("user_id", userId)` deleted - so a test that reads rows back
// cannot tell a scoped delete from an unscoped one.

import { describe, it, expect } from "vitest";
import { SCOPE_SENTINEL, scopeKeyFor } from "@/lib/experience/knowledgeScope.js";
import { SUMMARY_TABLE, QUESTION_TABLE } from "./experienceKnowledge.js";
import { ancestorScopePageIds, purgeAncestorScopes } from "./experienceKnowledgePurge.js";

const USER_ID = "user-1";

// root -> mid -> leaf, plus a sibling of leaf and a child OF leaf, so
// "walks up" and "walks down" produce visibly different sets.
function page(id, parentId, over = {}) {
  return {
    id,
    parent_id: parentId,
    title: `Title ${id}`,
    position: 0,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const PAGES = [
  page("root", null),
  page("mid", "root"),
  page("leaf", "mid"),
  page("leaf-kid", "leaf"),
  page("leaf-sibling", "mid", { position: 1 }),
  page("other-top", null, { position: 1 }),
];

/**
 * Records every statement PostgREST would have been handed: which table, which
 * operation, which filters, in order. Every method returns the same chain, and
 * the chain is thenable, so a statement can terminate wherever the code under
 * test chooses to terminate it.
 *
 * `failFor(statement)` lets one specific table (or scope key) fail while the
 * rest succeed - the shape a real partial outage has, and the shape a
 * best-effort purge has to be measured against.
 */
function recorder({ deleted = 1, failFor = () => null } = {}) {
  const statements = [];
  const client = {
    from(table) {
      const st = { table, op: null, filters: [], projection: null };
      statements.push(st);
      const settle = () => {
        const failure = failFor(st);
        if (failure) return { data: null, error: { message: failure } };
        return { data: Array.from({ length: deleted }, (_, i) => ({ id: `${table}-row-${i}` })), error: null };
      };
      const chain = {
        delete() {
          st.op = "delete";
          return chain;
        },
        select(cols) {
          st.projection = cols === undefined ? "*" : cols;
          return chain;
        },
        eq(col, value) {
          st.filters.push([col, value]);
          return chain;
        },
        then(resolve, reject) {
          return Promise.resolve(settle()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { client, statements };
}

/** Every scope_key a statement against `table` filtered on, in order. */
function scopeKeysHit(statements, table) {
  return statements
    .filter((s) => s.table === table)
    .map((s) => (s.filters.find(([col]) => col === "scope_key") || [])[1])
    .filter((v) => v !== undefined);
}

describe("ancestorScopePageIds - the walk UP, and only up", () => {
  it("[control] a grandchild's ancestors are its parent, its grandparent, and the root scope", () => {
    expect(ancestorScopePageIds(PAGES, "leaf")).toEqual(["mid", "root", null]);
  });

  it("NEVER includes the deleted page itself - that scope is the FK cascade's job, and claiming it here would hide a cascade that stopped working", () => {
    expect(ancestorScopePageIds(PAGES, "leaf")).not.toContain("leaf");
  });

  it("NEVER includes a descendant - a purge that walked DOWN would look identical on a leaf and be wrong on every branch", () => {
    const ids = ancestorScopePageIds(PAGES, "mid");
    expect(ids).not.toContain("leaf");
    expect(ids).not.toContain("leaf-kid");
    expect(ids).not.toContain("leaf-sibling");
  });

  it("never includes an unrelated page's scope", () => {
    expect(ancestorScopePageIds(PAGES, "leaf")).not.toContain("other-top");
  });

  it("a top-level page still has ONE ancestor scope: the whole knowledge base", () => {
    // The root scope is the case no FK can ever reach, at any depth. A walk
    // that returned [] here would leave the one row that is always affected.
    expect(ancestorScopePageIds(PAGES, "root")).toEqual([null]);
  });

  it("the root scope is ALWAYS last, so the purge order runs nearest-ancestor-first", () => {
    const ids = ancestorScopePageIds(PAGES, "leaf-kid");
    expect(ids[ids.length - 1]).toBe(null);
    expect(ids).toEqual(["leaf", "mid", "root", null]);
  });

  it("an id that is not in the page list still purges the root scope rather than nothing", () => {
    // A page the client never saw is still, by construction, inside the root
    // scope. Returning [] would be the silent-no-op shape.
    expect(ancestorScopePageIds(PAGES, "ghost")).toEqual([null]);
  });

  it("terminates on a parent cycle instead of hanging, and never repeats a scope", () => {
    const cyclic = [page("a", "b"), page("b", "a")];
    const ids = ancestorScopePageIds(cyclic, "a");
    expect(ids[ids.length - 1]).toBe(null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tolerates a missing/!Array pages argument without throwing", () => {
    expect(ancestorScopePageIds(undefined, "leaf")).toEqual([null]);
    expect(ancestorScopePageIds(null, null)).toEqual([null]);
  });
});

describe("purgeAncestorScopes - the rows a page delete removes that no cascade can", () => {
  it("[the ruling] deletes the ROOT scope's summary row, which no FK cascade on any page could ever reach", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    const summaryKeys = scopeKeysHit(statements, SUMMARY_TABLE);
    expect(summaryKeys).toContain(SCOPE_SENTINEL);
  });

  it("[the ruling] deletes the ROOT scope's question history too", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    expect(scopeKeysHit(statements, QUESTION_TABLE)).toContain(SCOPE_SENTINEL);
  });

  it("[the ruling] deletes EVERY ancestor's summary and question rows, not only the nearest one", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf-kid" });

    for (const table of [SUMMARY_TABLE, QUESTION_TABLE]) {
      const keys = scopeKeysHit(statements, table);
      expect(keys).toContain(scopeKeyFor("leaf"));
      expect(keys).toContain(scopeKeyFor("mid"));
      expect(keys).toContain(scopeKeyFor("root"));
      expect(keys).toContain(SCOPE_SENTINEL);
      expect(keys).toHaveLength(4);
    }
  });

  it("does NOT re-delete the deleted page's own scope - the cascade owns it, and duplicating it here would mask a cascade that stopped firing", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    for (const table of [SUMMARY_TABLE, QUESTION_TABLE]) {
      expect(scopeKeysHit(statements, table)).not.toContain(scopeKeyFor("leaf"));
    }
  });

  it("does NOT delete a descendant's scope either - same reason, and it is the shape a walk in the wrong direction produces", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "mid" });

    for (const table of [SUMMARY_TABLE, QUESTION_TABLE]) {
      const keys = scopeKeysHit(statements, table);
      expect(keys).not.toContain(scopeKeyFor("leaf"));
      expect(keys).not.toContain(scopeKeyFor("leaf-kid"));
      expect(keys).not.toContain(scopeKeyFor("leaf-sibling"));
    }
  });

  it("does not touch an unrelated top-level page's scope", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    for (const table of [SUMMARY_TABLE, QUESTION_TABLE]) {
      expect(scopeKeysHit(statements, table)).not.toContain(scopeKeyFor("other-top"));
    }
  });

  it("touches BOTH tables - a purge that forgot the question history would leave whole answer transcripts about a deleted page", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    expect(statements.some((s) => s.table === SUMMARY_TABLE)).toBe(true);
    expect(statements.some((s) => s.table === QUESTION_TABLE)).toBe(true);
  });

  it("every statement is a DELETE scoped by user_id EXPLICITLY, on top of RLS", async () => {
    const { client, statements } = recorder();
    await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    expect(statements.length).toBeGreaterThan(0);
    for (const st of statements) {
      expect(st.op).toBe("delete");
      expect(st.filters).toContainEqual(["user_id", USER_ID]);
    }
  });

  it("reports which scopes it purged and how many rows went, so a caller can log it", async () => {
    const { client } = recorder({ deleted: 3 });
    const result = await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    expect(result.scopeKeys).toEqual([scopeKeyFor("mid"), scopeKeyFor("root"), SCOPE_SENTINEL]);
    expect(result.summariesDeleted).toBe(9);
    expect(result.questionsDeleted).toBe(9);
    expect(result.error).toBe(null);
  });

  it("keeps purging the remaining scopes after ONE fails, and returns the failure rather than throwing", async () => {
    // Stopping at the first error would leave MORE stale rows than continuing,
    // and the caller's only lever is to log - so this is best-effort by
    // design, and the design is asserted rather than assumed.
    const { client, statements } = recorder({
      failFor: (st) => (st.table === SUMMARY_TABLE ? "boom" : null),
    });
    const result = await purgeAncestorScopes(client, USER_ID, { pages: PAGES, pageId: "leaf" });

    expect(result.error).toContain("boom");
    expect(scopeKeysHit(statements, SUMMARY_TABLE)).toHaveLength(3);
    expect(scopeKeysHit(statements, QUESTION_TABLE)).toHaveLength(3);
    expect(result.questionsDeleted).toBe(3);
  });

  it("never throws when the client itself throws - a failed purge is data, never an exception that tears down a page delete", async () => {
    const exploding = {
      from() {
        throw new Error("connection lost");
      },
    };
    const result = await purgeAncestorScopes(exploding, USER_ID, { pages: PAGES, pageId: "leaf" });
    expect(result.error).toContain("connection lost");
    expect(result.scopeKeys).toEqual([]);
  });

  it("refuses to run with no userId rather than issuing an unscoped delete", async () => {
    const { client, statements } = recorder();
    const result = await purgeAncestorScopes(client, "", { pages: PAGES, pageId: "leaf" });
    expect(statements).toHaveLength(0);
    expect(result.error).toBeTruthy();
  });
});
