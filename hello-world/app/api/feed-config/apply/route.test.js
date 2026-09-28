// N60 SECOND CHUNK -- Step B (4b TDD) -- AC2-C3 part (iii) + AUTH + AC2-C5 cap.
//
// SCOPE: the write route POST /api/feed-config/apply. This is the ROUTING half of
// the structural exclusion. The sanitizer (savedSearchFields.chatDerived.test.js)
// proves the returned object omits the flag key; here we prove the route WRITES
// exactly that object and nothing spread from the request -- so a flag-bearing
// request body produces a written row with no flag, and a body-supplied user id is
// never honoured. Source-scan guards (route never calls the permissive sanitizers;
// never names the flag; never reaches a model) are in route.guards.test.js.
//
// REACHABILITY: the real POST handler is driven with a real Request; only the
// Supabase client is mocked (the repo idiom -- savedSearchWrite.test.js). We assert
// the ACTUAL argument handed to `.insert(...)`, not the response body: a route that
// stripped the flag from its RESPONSE while writing it would pass a response check
// and still spend the owner's ceiling (plan R7/R6). The insert spy is the mechanism.
//
// RED ON HEAD: app/api/feed-config/apply/route.js does not exist (MEASURED at HEAD
// f4c03e6). `import { POST } from "./route.js"` fails to resolve, so this file fails
// COLLECTION -- RED for the honest reason (subject absent). Satisfiability is proven
// against an isolated reference build in the notes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { jsonRequest } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { POST } from "./route.js";

const SESSION_USER = { id: "session-user-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

// A Supabase-ish client that (a) reports a saved-search row count for the pre-insert
// cap check and (b) records every insert argument and the table each verb hit.
// makeSupabase cannot return a `count`, and both the count and the insert argument
// are the whole subject here -- so this is a purpose-built recorder, matching the
// idiom in app/api/saved-searches/savedSearchWrite.test.js.
function recordingClient({ existing = 0, user = SESSION_USER } = {}) {
  const inserts = [];
  const tablesTouched = [];
  const client = {
    from(table) {
      tablesTouched.push(table);
      const calls = [];
      const b = {};
      const rec = (n) => (...a) => {
        calls.push([n, ...a]);
        if (n === "insert") inserts.push({ table, arg: a[0] });
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
          opts && opts.count ? { count: existing, data: rows, error: null } : { data: rows, error: null };
        return Promise.resolve(payload).then(res, rej);
      };
      return b;
    },
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  };
  client.__inserts = inserts;
  client.__tablesTouched = tablesTouched;
  return client;
}

describe("AC2-C3 part (iii): a flag-bearing request produces a written row with NO auto_tailor_enabled", () => {
  const flagBearingBody = {
    name: "Senior backend, Boston",
    jobKeywords: ["backend"],
    autoTailorEnabled: true,
    auto_tailor_enabled: true,
    emailOnNewJobs: true,
  };

  it("the actual insert argument has no auto_tailor_enabled key", async () => {
    const client = recordingClient({ existing: 2 });
    createClient.mockResolvedValue(client);
    const res = await POST(jsonRequest(flagBearingBody));
    expect(res.status).toBe(200);
    expect(client.__inserts).toHaveLength(1);
    const written = client.__inserts[0].arg;
    // The structural guarantee at the write boundary: not `=== false`, ABSENT.
    // This is what fails a route that does `insert({ ...body, ...sanitized })`,
    // because `...sanitized` has no key to override the body's flag (brief).
    expect(written).not.toHaveProperty("auto_tailor_enabled");
    expect(written).not.toHaveProperty("autoTailorEnabled");
  });

  it("[non-vacuity control] the same insert DID carry the legitimate fields", async () => {
    // "No flag written" is vacuous if nothing was written. Prove the row is real.
    const client = recordingClient({ existing: 2 });
    createClient.mockResolvedValue(client);
    await POST(jsonRequest(flagBearingBody));
    const written = client.__inserts[0].arg;
    expect(written.name).toBe("Senior backend, Boston");
    expect(written.job_keywords).toContain("backend");
    expect(written.email_on_new_jobs).toBe(true);
  });
});

describe("AUTH: the acting account comes from the session, never the request body", () => {
  it("writes the session user_id and ignores a body-supplied user id", async () => {
    // The exact mutant caught in an earlier chunk: a route writing another account's
    // row. A body claiming user_id/userId must not be honoured.
    const client = recordingClient({ existing: 0, user: { id: "session-user-1" } });
    createClient.mockResolvedValue(client);
    await POST(jsonRequest({ name: "x", user_id: "attacker-999", userId: "attacker-999" }));
    const written = client.__inserts[0].arg;
    expect(written.user_id).toBe("session-user-1");
    expect(written.user_id).not.toBe("attacker-999");
  });

  it("[non-vacuity control] the insert DID set a user_id (so 'not attacker' is not vacuous)", async () => {
    const client = recordingClient({ existing: 0 });
    createClient.mockResolvedValue(client);
    await POST(jsonRequest({ name: "x" }));
    expect(client.__inserts[0].arg.user_id).toBe("session-user-1");
  });

  it("refuses with 401 and writes nothing when there is no session user", async () => {
    const client = recordingClient({ user: null });
    createClient.mockResolvedValue(client);
    const res = await POST(jsonRequest({ name: "x" }));
    expect(res.status).toBe(401);
    expect(client.__inserts).toHaveLength(0);
  });
});

describe("AC2-C5: the write targets saved_searches -- one record, no second pipeline", () => {
  it("inserts into saved_searches and touches no other table on the write path", async () => {
    const client = recordingClient({ existing: 0 });
    createClient.mockResolvedValue(client);
    await POST(jsonRequest({ name: "x" }));
    expect(client.__inserts[0].table).toBe("saved_searches");
    // Every table the route touched is saved_searches (the cap count + the insert).
    expect([...new Set(client.__tablesTouched)]).toEqual(["saved_searches"]);
  });
});

describe("AC2-C5 / owner ruling: the 25-per-account cap is respected, not re-implemented", () => {
  it("refuses to create a 26th saved search and writes nothing", async () => {
    const client = recordingClient({ existing: 25 });
    createClient.mockResolvedValue(client);
    const res = await POST(jsonRequest({ name: "One too many" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(client.__inserts).toHaveLength(0);
  });

  it("[control] allows creation when the account is under the cap", async () => {
    const client = recordingClient({ existing: 3 });
    createClient.mockResolvedValue(client);
    const res = await POST(jsonRequest({ name: "Fine" }));
    expect(res.status).toBe(200);
    expect(client.__inserts).toHaveLength(1);
  });
});

describe("AC2-C5: a nameless body is refused (400), not written", () => {
  it("returns 400 and writes nothing when the sanitizer returns null", async () => {
    const client = recordingClient({ existing: 0 });
    createClient.mockResolvedValue(client);
    const res = await POST(jsonRequest({ jobKeywords: ["x"] }));
    expect(res.status).toBe(400);
    expect(client.__inserts).toHaveLength(0);
  });
});
