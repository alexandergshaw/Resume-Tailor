// N60 S6 (4b/TDD) -- AC-E4: the account-level pause WRITE route, driven through
// the real exported PUT the settings control calls.
//
// Two properties only exist at this boundary:
//
//  (1) RLS reachability / "cannot write another account's row": the pause is a
//      per-user write. The handler must derive the account from the SESSION
//      (auth.getUser()), never from the request body, so a body naming another
//      user cannot flip a stranger's setting. (RLS with-check is the DB-level
//      backstop, text-witnessed by n60SpendLedgerMigrationShape.test.js; this
//      pins the handler half, which is what a request can actually reach.)
//
//  (2) NON-DESTRUCTIVE: pausing then unpausing leaves every saved search's own
//      flags byte-identical -- the pause writes user_alert_settings and NOTHING
//      ELSE, so unpausing restores the user's per-search choices exactly. This
//      is asserted on the actual stored rows, not on any UI state.
//
// RED on HEAD: app/api/alerts/pause/route.js does not exist -> collection
// failure (a real Cannot-find-module import error, never a vacuous assertion).
//
// NON-VACUITY: the 401 control proves the surface is gated; the "user_alert_
// settings WAS written" assertion proves the round-trip ran, so "saved_searches
// untouched" is a real absence, not a route that did nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabase } from "@/test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { PUT } from "./route.js";
import { createClient } from "@/lib/supabase/server";

const USER = { id: "user-1", email: "me@example.com" };

function pauseReq(body) {
  return new Request("http://localhost/api/alerts/pause", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PUT /api/alerts/pause -- gated to the signed-in owner (AC-E4)", () => {
  it("401 when not signed in (the pause is the account's, not public)", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    const res = await PUT(pauseReq({ paused: true }));
    expect(res.status).toBe(401);
  });

  it("writes the SESSION user's pause row and nothing else", async () => {
    const client = makeSupabase({ user_alert_settings: { data: null } }, { user: USER });
    createClient.mockResolvedValue(client);

    const res = await PUT(pauseReq({ paused: true }));
    expect(res.status).toBe(200);

    // It wrote user_alert_settings for the session user, alerts_paused=true.
    const writes = client.calls.user_alert_settings || { upsert: [], update: [], insert: [] };
    const rows = [...(writes.upsert || []), ...(writes.update || []), ...(writes.insert || [])].map(
      (args) => args[0],
    );
    expect(rows.length).toBeGreaterThan(0);
    const wrote = rows.find((r) => r && (r.alerts_paused === true || r.alerts_paused === false));
    expect(wrote, "no alerts_paused value written").toBeTruthy();
    expect(wrote.alerts_paused).toBe(true);
    expect(wrote.user_id).toBe(USER.id);

    // Non-destructive: the write path never touched saved_searches at all.
    expect(client.calls.saved_searches, "the pause wrote saved_searches -- destructive").toBeUndefined();
  });
});

describe("PUT /api/alerts/pause -- cannot write another account's row (RLS reachability)", () => {
  it("ignores a user_id in the body and writes only the authenticated account", async () => {
    const client = makeSupabase({ user_alert_settings: { data: null } }, { user: USER });
    createClient.mockResolvedValue(client);

    // An attacker-shaped body naming someone else's account.
    await PUT(pauseReq({ paused: true, user_id: "victim-999", userId: "victim-999" }));

    const writes = client.calls.user_alert_settings || { upsert: [], update: [], insert: [] };
    const rows = [...(writes.upsert || []), ...(writes.update || []), ...(writes.insert || [])].map(
      (args) => args[0],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // The row's account is the SESSION user, never the body's claim.
      expect(r.user_id).toBe(USER.id);
      expect(r.user_id).not.toBe("victim-999");
    }
  });
});

// A tiny STATEFUL fake so the non-destructive property is asserted on the actual
// stored rows -- pause, unpause, then read the saved_searches store back.
function statefulClient({ user, savedSearches }) {
  const store = {
    saved_searches: savedSearches.map((r) => ({ ...r })),
    user_alert_settings: new Map(),
  };
  const writeCount = { saved_searches: 0, user_alert_settings: 0 };

  function from(table) {
    let filters = {};
    const b = {
      select() {
        return b;
      },
      eq(col, val) {
        filters[col] = val;
        return b;
      },
      upsert(row) {
        writeCount[table] += 1;
        if (table === "user_alert_settings") store.user_alert_settings.set(row.user_id, { ...row });
        else store[table] = store[table].map((r) => (r.id === row.id ? { ...r, ...row } : r));
        return b;
      },
      update(patch) {
        writeCount[table] += 1;
        if (table === "user_alert_settings") {
          const key = filters.user_id;
          store.user_alert_settings.set(key, { ...(store.user_alert_settings.get(key) || { user_id: key }), ...patch });
        } else {
          store[table] = store[table].map((r) => (r.id === filters.id ? { ...r, ...patch } : r));
        }
        return b;
      },
      insert(row) {
        writeCount[table] += 1;
        if (table === "user_alert_settings") store.user_alert_settings.set(row.user_id, { ...row });
        else store[table] = [...store[table], { ...row }];
        return b;
      },
      delete() {
        writeCount[table] += 1;
        return b;
      },
      maybeSingle() {
        return Promise.resolve(resolve());
      },
      single() {
        return Promise.resolve(resolve());
      },
      then(res, rej) {
        return Promise.resolve(resolve()).then(res, rej);
      },
    };
    function resolve() {
      if (table === "user_alert_settings") {
        return { data: store.user_alert_settings.get(filters.user_id) || null, error: null };
      }
      return { data: null, error: null };
    }
    return b;
  }

  return {
    client: { from, auth: { getUser: async () => ({ data: { user } }) } },
    store,
    writeCount,
  };
}

describe("PUT /api/alerts/pause -- non-destructive round trip (AC-E4)", () => {
  it("pause then unpause leaves every saved search's flags byte-identical", async () => {
    const seed = [
      {
        id: "ss-1",
        user_id: USER.id,
        name: "Backend roles",
        email_on_new_jobs: true,
        auto_tailor_enabled: true,
        auto_tailor_daily_cap: 7,
        auto_tailor_min_interval_minutes: 60,
      },
      {
        id: "ss-2",
        user_id: USER.id,
        name: "Remote only",
        email_on_new_jobs: false,
        auto_tailor_enabled: false,
        auto_tailor_daily_cap: 3,
        auto_tailor_min_interval_minutes: 120,
      },
    ];
    const before = JSON.parse(JSON.stringify(seed));
    const { client, store, writeCount } = statefulClient({ user: USER, savedSearches: seed });
    createClient.mockResolvedValue(client);

    await PUT(pauseReq({ paused: true }));
    await PUT(pauseReq({ paused: false }));

    // The user's per-search configuration is byte-identical after the round trip.
    expect(store.saved_searches).toEqual(before);
    // ...because the pause never wrote saved_searches at all.
    expect(writeCount.saved_searches).toBe(0);
    // Non-vacuity: the round trip actually ran and settled on unpaused.
    expect(writeCount.user_alert_settings).toBeGreaterThan(0);
    expect(store.user_alert_settings.get(USER.id).alerts_paused).toBe(false);
  });
});
