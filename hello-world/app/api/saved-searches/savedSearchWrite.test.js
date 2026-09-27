// N60 S2 (4b) -- AC-S4 (clamp survives the sanitizer move) + AC-E5 tail (<=25
// saved searches per account).
//
// AC-S4 is a NON-REGRESSION GUARD, GREEN ON HEAD: `sanitizeCap` already clamps on
// both routes, and this exists because S2 MOVES that code and a move is exactly when
// a clamp silently disappears. It asserts the clamp HAPPENS (out-of-range in ->
// bounded out) without pinning the ceiling value, which is a later step's call.
//
// AC-E5's count cap is RED ON HEAD: neither route counts a user's saved searches
// before insert (canaried grep -> 0 hits), so a 26th insert succeeds today.
//
// Both handlers are driven for real; only the Supabase client is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase, jsonRequest } from "../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { POST } from "./route.js";
import { PUT } from "./[id]/route.js";

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

// A Supabase-ish client that reports a saved-search row count for the pre-insert
// cap check and records inserts. makeSupabase cannot return a `count`, and the
// count is the whole subject here.
function countingClient({ existing }) {
  const inserts = [];
  const client = {
    from() {
      const calls = [];
      const b = {};
      const rec = (n) => (...a) => {
        calls.push([n, ...a]);
        if (n === "insert") inserts.push(a[0]);
        return b;
      };
      for (const m of ["select", "insert", "update", "delete", "eq", "in", "or", "order", "limit"]) b[m] = rec(m);
      b.single = () => Promise.resolve({ data: { id: "new-id" }, error: null });
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (res, rej) => {
        const sel = calls.find((c) => c[0] === "select");
        const opts = sel && sel[2];
        const rows = Array.from({ length: existing }, (_, i) => ({ id: `row-${i}` }));
        const payload =
          opts && opts.count
            ? { count: existing, data: rows, error: null }
            : { data: rows, error: null };
        return Promise.resolve(payload).then(res, rej);
      };
      return b;
    },
    auth: { getUser: vi.fn(async () => ({ data: { user: USER } })) },
  };
  client.__inserts = inserts;
  return client;
}

describe("AC-S4 (non-regression): the cap clamp survives the sanitizer move", () => {
  it("POST clamps an over-max cap to a bounded integer before insert", async () => {
    const sb = makeSupabase({ saved_searches: { data: { id: "x" } } }, { user: USER });
    createClient.mockResolvedValue(sb);
    const res = await POST(jsonRequest({ name: "Backend", autoTailorDailyCap: 10000 }));
    expect(res.status).toBe(200);
    const stored = sb.calls.saved_searches.insert[0][0].auto_tailor_daily_cap;
    expect(stored).toBeLessThan(10000);
    expect(stored).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(stored)).toBe(true);
  });

  it("POST clamps a below-min cap up to at least 1", async () => {
    const sb = makeSupabase({ saved_searches: { data: { id: "x" } } }, { user: USER });
    createClient.mockResolvedValue(sb);
    await POST(jsonRequest({ name: "Backend", autoTailorDailyCap: -5 }));
    const stored = sb.calls.saved_searches.insert[0][0].auto_tailor_daily_cap;
    expect(stored).toBeGreaterThanOrEqual(1);
  });

  it("PUT clamps an over-max cap on the update path", async () => {
    const sb = makeSupabase({ saved_searches: { data: { id: "ss-1" } } }, { user: USER });
    createClient.mockResolvedValue(sb);
    const res = await PUT(jsonRequest({ autoTailorDailyCap: 10000 }), {
      params: Promise.resolve({ id: "ss-1" }),
    });
    expect(res.status).toBe(200);
    const stored = sb.calls.saved_searches.update[0][0].auto_tailor_daily_cap;
    expect(stored).toBeLessThan(10000);
    expect(stored).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-E5 tail: at most 25 saved searches per account", () => {
  it("refuses to create a 26th saved search and writes nothing", async () => {
    const client = countingClient({ existing: 25 });
    createClient.mockResolvedValue(client);
    const res = await POST(jsonRequest({ name: "One too many" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(client.__inserts).toHaveLength(0);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("[control] allows creation when the account is under the cap", async () => {
    const client = countingClient({ existing: 3 });
    createClient.mockResolvedValue(client);
    const res = await POST(jsonRequest({ name: "Fine" }));
    expect(res.status).toBe(200);
    expect(client.__inserts).toHaveLength(1);
  });
});
