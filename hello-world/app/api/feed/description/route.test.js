import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET } from "./route.js";
import { createAdminClient } from "@/lib/supabase/admin";

const ID = "11111111-2222-3333-4444-555555555555";
const FULL =
  "About the role\n\nWe are hiring a Staff Platform Engineer.\n\nRequirements: 8+ years building distributed systems.";
const SNIPPET = "About the role We are hiring a Staff Platform Engineer.…";

function getRequest(id) {
  const qs = id === undefined ? "" : `?id=${encodeURIComponent(id)}`;
  return new Request(`http://localhost/api/feed/description${qs}`);
}

function withRow(row) {
  createAdminClient.mockReturnValue(makeSupabase({ feed_postings: { data: row } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  withRow({ id: ID, description_snippet: SNIPPET, raw_data: { description: FULL } });
});

describe("GET /api/feed/description", () => {
  it("returns the whole stored description for one posting", async () => {
    const res = await GET(getRequest(ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.full).toBe(true);
    expect(body.description).toBe(FULL);
    expect(body.description).not.toBe(SNIPPET);
  });

  it("reads a single row by id rather than a feed page", async () => {
    const admin = makeSupabase({
      feed_postings: { data: { id: ID, description_snippet: SNIPPET, raw_data: { description: FULL } } },
    });
    createAdminClient.mockReturnValue(admin);

    await GET(getRequest(ID));

    expect(admin.calls.feed_postings.eq).toContainEqual(["id", ID]);
    expect(admin.calls.feed_postings.maybeSingle).toBe(1);
    // Only the columns this endpoint needs -- it must not become a second
    // feed listing.
    const selected = String(admin.calls.feed_postings.select[0][0]);
    expect(selected).toContain("raw_data");
    expect(selected).not.toContain("tags");
  });

  it("falls back to the snippet, and says so, when the row has no raw_data", async () => {
    withRow({ id: ID, description_snippet: SNIPPET, raw_data: null });

    const res = await GET(getRequest(ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.full).toBe(false);
    expect(body.description).toBe(SNIPPET);
    expect(body.reason).toBeTruthy();
  });

  it("rejects a missing id", async () => {
    const res = await GET(getRequest(undefined));
    expect(res.status).toBe(400);
  });

  it("rejects an id that is not a uuid rather than letting Postgres error", async () => {
    const res = await GET(getRequest("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown posting", async () => {
    withRow(null);
    const res = await GET(getRequest(ID));
    expect(res.status).toBe(404);
  });

  it("returns 500 when the admin client is unavailable", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("no service key");
    });
    const res = await GET(getRequest(ID));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/admin client unavailable/i);
  });

  it("returns 500 when the query errors", async () => {
    createAdminClient.mockReturnValue(
      makeSupabase({ feed_postings: { data: null, error: { message: "connection reset" } } }),
    );
    const res = await GET(getRequest(ID));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("connection reset");
  });
});
