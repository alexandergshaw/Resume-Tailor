// The falsifier for loadScopeInput — the pages+attachments fan-out this
// feature's plan (3-plan-knowledge.md, Wave 4) says is "absent from the
// criteria entirely": without it, every page's attachment inventory is
// permanently empty and `pageRowCount` would just be `pages.length`, which
// silently throws away the one cheap signal that PostgREST's `db-max-rows`
// truncated the read.
//
// WRITTEN BEFORE THE MODULE EXISTED, against the plan's stated contract.
//
// Only the Supabase client is doubled — `lib/supabase/experiencePages.js`
// and `lib/supabase/experienceAttachments.js` run for REAL against it, the
// same convention `experienceAttachments.byPage.test.js` uses ("Only the
// Supabase client is doubled; the module under test is real"). The double
// resolves at each call's own TERMINAL method, exactly like that file's
// `clientDouble`, never via a bolted-on `.then`.

import { describe, it, expect, vi } from "vitest";
import { loadScopeInput } from "./knowledgeLoad.js";

const USER_ID = "user-1";

// One page for `experience_pages`'s `select("*")...order("position")` path,
// and a second, independent shape for the `select("id", {count, head})`
// path — distinguished by which arguments `.select()` was actually called
// with, because both queries run against the SAME table and this is the one
// place a test can prove `loadScopeInput` does not reuse `pages.length` for
// the count.
function pagesChain({ pagesResult, countResult }) {
  let mode = "list";
  const chain = {
    select: vi.fn((columns, options) => {
      mode = options && options.count ? "count" : "list";
      return chain;
    }),
    eq: vi.fn(() => chain),
    is: vi.fn(() => (mode === "count" ? Promise.resolve(countResult) : chain)),
    order: vi.fn(() => Promise.resolve(pagesResult)),
  };
  return chain;
}

function attachmentsChain(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

function makeClient({
  pagesResult = { data: [], error: null },
  countResult = { count: 0, error: null },
  attachmentsResult = { data: [], error: null },
} = {}) {
  return {
    from: vi.fn((table) => {
      if (table === "experience_attachments") return attachmentsChain(attachmentsResult);
      return pagesChain({ pagesResult, countResult });
    }),
  };
}

const page = (over = {}) => ({
  id: "p1",
  user_id: USER_ID,
  parent_id: null,
  title: "Payments platform",
  body: "some prose",
  position: 0,
  archived_at: null,
  generated_kind: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const attachment = (over = {}) => ({
  id: "a1",
  user_id: USER_ID,
  page_id: "p1",
  name: "spec.pdf",
  mime: "application/pdf",
  notes: "",
  storage_path: "u/experience/p1/a1-spec.pdf",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("loadScopeInput — pageRowCount is an INDEPENDENT read, never pages.length", () => {
  it("[control] pageRowCount equals pages.length when nothing was truncated", async () => {
    const client = makeClient({
      pagesResult: { data: [page(), page({ id: "p2" })], error: null },
      countResult: { count: 2, error: null },
    });
    const result = await loadScopeInput(client, USER_ID);
    expect(result.pages).toHaveLength(2);
    expect(result.pageRowCount).toBe(2);
    expect(result.truncatedRead).toBe(false);
    expect(result.error).toBeNull();
  });

  it("reports a count STRICTLY GREATER than pages.length as a truncated read", async () => {
    // The discriminating case: an implementation that reused `pages.length`
    // as its own count can never produce this. The head-count query here
    // claims 9 rows exist while the list query returned only 3 — a
    // `db-max-rows` cap in miniature.
    const client = makeClient({
      pagesResult: { data: [page({ id: "p1" }), page({ id: "p2" }), page({ id: "p3" })], error: null },
      countResult: { count: 9, error: null },
    });
    const result = await loadScopeInput(client, USER_ID);
    expect(result.pages).toHaveLength(3);
    expect(result.pageRowCount).toBe(9);
    expect(result.truncatedRead).toBe(true);
  });

  it("issues the count query with its own select(\"id\", { count: \"exact\", head: true }) call", async () => {
    // Captures every chain `.from()` ever produced, regardless of call
    // order, so this does not depend on Promise.all's evaluation order the
    // way a single-shared-chain double would.
    const created = [];
    const client = {
      from: vi.fn((table) => {
        const chain =
          table === "experience_attachments"
            ? attachmentsChain({ data: [], error: null })
            : pagesChain({ pagesResult: { data: [], error: null }, countResult: { count: 0, error: null } });
        created.push(chain);
        return chain;
      }),
    };
    await loadScopeInput(client, USER_ID);
    const selectCalls = created.flatMap((c) => c.select.mock.calls);
    const countCall = selectCalls.find(([, options]) => options && options.count);
    expect(countCall).toEqual(["id", { count: "exact", head: true }]);
  });
});

describe("loadScopeInput — a failed read is not an empty knowledge base", () => {
  it("a pages read error is FATAL and is surfaced as `error`, never as zero pages", async () => {
    const client = makeClient({ pagesResult: { data: null, error: { message: "connection reset" } } });
    const result = await loadScopeInput(client, USER_ID);
    expect(result.error).toBe("connection reset");
    expect(result.pages).toEqual([]);
  });

  it("a head-count read error is NOT fatal — falls back to pages.length rather than failing the whole scope", async () => {
    const client = makeClient({
      pagesResult: { data: [page()], error: null },
      countResult: { count: null, error: { message: "count timed out" } },
    });
    const result = await loadScopeInput(client, USER_ID);
    expect(result.error).toBeNull();
    expect(result.pageRowCount).toBe(1);
    expect(result.truncatedRead).toBe(false);
  });

  it("an attachments read error is NOT fatal — pages still load, with no attachments key", async () => {
    const client = makeClient({
      pagesResult: { data: [page()], error: null },
      countResult: { count: 1, error: null },
      attachmentsResult: { data: null, error: { message: "attachments unavailable" } },
    });
    const result = await loadScopeInput(client, USER_ID);
    expect(result.error).toBeNull();
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).not.toHaveProperty("attachments");
  });

  it("never throws even when the client itself throws synchronously", async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error("client exploded");
      }),
    };
    await expect(loadScopeInput(client, USER_ID)).resolves.toMatchObject({
      pages: [],
      pageRowCount: 0,
      truncatedRead: false,
    });
  });
});

describe("loadScopeInput — attachment inventory grafted with withDerivedKind", () => {
  it("attaches ONLY the matching page's attachments, deriving `kind` on each", async () => {
    const client = makeClient({
      pagesResult: { data: [page({ id: "p1" }), page({ id: "p2" })], error: null },
      countResult: { count: 2, error: null },
      attachmentsResult: { data: [attachment({ id: "a1", page_id: "p1" })], error: null },
    });
    const result = await loadScopeInput(client, USER_ID);
    const p1 = result.pages.find((p) => p.id === "p1");
    const p2 = result.pages.find((p) => p.id === "p2");
    expect(p1.attachments).toHaveLength(1);
    expect(p1.attachments[0]).toMatchObject({ id: "a1", kind: "pdf" });
    expect(p2).not.toHaveProperty("attachments");
  });

  it("leaves a page with zero attachments untouched (no empty `attachments: []` key)", async () => {
    const client = makeClient({
      pagesResult: { data: [page()], error: null },
      countResult: { count: 1, error: null },
      attachmentsResult: { data: [], error: null },
    });
    const result = await loadScopeInput(client, USER_ID);
    expect(result.pages[0]).not.toHaveProperty("attachments");
  });
});

describe("loadScopeInput — the empty knowledge base", () => {
  it("zero pages, zero count -> no truncation, no error", async () => {
    const client = makeClient({ pagesResult: { data: [], error: null }, countResult: { count: 0, error: null } });
    const result = await loadScopeInput(client, USER_ID);
    expect(result).toEqual({ pages: [], pageRowCount: 0, truncatedRead: false, error: null });
  });
});
