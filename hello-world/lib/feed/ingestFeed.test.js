import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ingestFeed } from "./ingestFeed.js";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";

// ingestFeed pulls from external boards via global fetch and (optionally) a
// Redis client. In tests KV env vars are unset so getRedisClient() returns null
// and the run proceeds best-effort without Redis. We stub fetch so every board
// returns no postings — that isolates the prune step, which is what we assert.

function emptyBoardResponse() {
  return {
    ok: true,
    json: async () => ({ jobs: [] }),
    text: async () => "<rss></rss>",
  };
}

describe("ingestFeed prune step", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyBoardResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls prune_feed_postings with the default retention window and reports the count", async () => {
    const admin = makeSupabase(
      { feed_postings: { data: [] } },
      { rpc: { prune_feed_postings: 7 } },
    );

    const summary = await ingestFeed(admin);

    expect(summary.ok).toBe(true);
    expect(admin.calls.rpc).toContainEqual(["prune_feed_postings", { retention_hours: 36 }]);
    expect(summary.itemsPruned).toBe(7);
  });

  it("does not fail the run when pruning errors", async () => {
    const admin = makeSupabase(
      { feed_postings: { data: [] } },
      { rpc: { prune_feed_postings: new Error("boom") } },
    );

    const summary = await ingestFeed(admin);

    expect(summary.ok).toBe(true);
    expect(summary.itemsPruned).toBe(0);
  });
});
