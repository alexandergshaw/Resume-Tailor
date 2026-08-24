// listAttachmentsByPage's contract: the whole account's attachments in ONE
// query, grouped by page, never throwing.
//
// A sibling of experienceAttachments.test.js (createAttachment's error
// stages) and experienceAttachments.download.test.js, for the reason that
// second file's own header gives: each covers one contract, so a reader of
// either does not have to read the others.
//
// The caller this exists for is app/api/meeting/insights/route.js, which
// reads the user's entire knowledge base on every ~20-second read of a live
// meeting. The two properties that matter there — one query rather than one
// per page, and a result object rather than a throw — are pinned here rather
// than left to that route to hope for.
//
// Only the Supabase client is doubled; the module under test is real.

import { describe, it, expect, vi } from "vitest";
import { listAttachmentsByPage } from "./experienceAttachments.js";

// A double for exactly the call listAttachmentsByPage makes:
// from(TABLE).select("*").eq("user_id", ...).order("created_at", ...), which
// resolves at the `.order(...)` the way PostgREST's thenable builder does.
function clientDouble(result) {
  const calls = { from: [], eq: [], order: [] };
  const builder = {
    select: () => builder,
    eq: (...args) => {
      calls.eq.push(args);
      return builder;
    },
    order: (...args) => {
      calls.order.push(args);
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    from: vi.fn((table) => {
      calls.from.push(table);
      return builder;
    }),
  };
}

const row = (over = {}) => ({
  id: "a1",
  user_id: "u1",
  page_id: "p1",
  name: "spec.pdf",
  mime: "application/pdf",
  notes: "",
  storage_path: "u1/experience/p1/a1-spec.pdf",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("listAttachmentsByPage", () => {
  it("issues ONE query for the whole account, scoped by user_id", async () => {
    // The reason this function exists at all: listAttachments takes a
    // pageId, so grouping with it would mean one round trip per page, every
    // read, for the length of a meeting. Mutation caught: looping
    // listAttachments per page, or dropping the explicit user_id filter and
    // leaning on RLS alone (this module scopes both ways — see its header).
    const supabase = clientDouble({ data: [row()], error: null });

    await listAttachmentsByPage(supabase, "u1");

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.calls.from).toEqual(["experience_attachments"]);
    expect(supabase.calls.eq).toEqual([["user_id", "u1"]]);
  });

  it("groups rows by page id, keeping upload order within a page", async () => {
    const supabase = clientDouble({
      data: [
        row({ id: "a1", page_id: "p1", name: "first.pdf" }),
        row({ id: "a2", page_id: "p2", name: "other.pdf" }),
        row({ id: "a3", page_id: "p1", name: "second.pdf" }),
      ],
      error: null,
    });

    const { byPageId, error } = await listAttachmentsByPage(supabase, "u1");

    expect(error).toBeNull();
    expect(byPageId.get("p1").map((r) => r.name)).toEqual(["first.pdf", "second.pdf"]);
    expect(byPageId.get("p2").map((r) => r.name)).toEqual(["other.pdf"]);
    // A page with no attachments is simply absent; the caller reads this as
    // `byPageId.get(id) || []`.
    expect(byPageId.get("p3")).toBeUndefined();
    // Upload order is the panel's own order, so it is asked for explicitly
    // rather than left to whatever the planner returns.
    expect(supabase.calls.order).toEqual([["created_at", { ascending: true }]]);
  });

  it("skips a row with no usable page id rather than minting a junk key", async () => {
    const supabase = clientDouble({
      data: [row({ page_id: null }), row({ page_id: "" }), row({ id: "a9", page_id: "p1" })],
      error: null,
    });

    const { byPageId } = await listAttachmentsByPage(supabase, "u1");

    expect([...byPageId.keys()]).toEqual(["p1"]);
  });

  it("returns an error result instead of throwing, on either failure shape", async () => {
    // Nothing in this module throws: a failed call must be data the caller
    // can branch on, because the meeting route carries on without an
    // inventory rather than losing the whole read. Mutation caught: letting
    // a rejected query or a PostgREST `error` escape as an exception.
    const failed = await listAttachmentsByPage(clientDouble({ data: null, error: { message: "boom" } }), "u1");
    expect(failed.error).toBe("boom");
    expect(failed.byPageId.size).toBe(0);

    const throws = {
      from: () => {
        throw new Error("network down");
      },
    };
    await expect(listAttachmentsByPage(throws, "u1")).resolves.toEqual({
      byPageId: new Map(),
      error: "network down",
    });
  });
});
