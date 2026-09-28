// N62 Capability A — AC-A1: the per-user cover-fact placement default
// persists through the user-prefs route, and only a VALID placement id
// survives -- on BOTH write and read -- so the client always falls back to
// the hardcoded default rather than resolving a garbage id.
//
// WHY A ROUTE TEST, NOT A sanitize() UNIT CALL. `sanitize()` is module-private
// in route.js (correct: GET/PUT are the entry points production calls).
// Exporting it so a test could call it directly would widen the surface the
// export-reachability sweep measures purely to make a test easier, and would
// prove nothing about the value a real PUT->GET round trip keeps. So every
// assertion below drives the real GET/PUT handlers, and the "did it persist"
// checks read back through a SEPARATE GET (which re-reads getCached), never off
// the PUT's own echo (risk R1: a key echoed from the PUT body but never stored
// reads clean and is empty next session).
//
// THE INVALID-VALUE CANARY IS AN INVALID-BUT-STRING VALUE ("middle"), NOT A
// WRONG TYPE. A degenerate sanitizer that merely copies the key through when it
// is a string -- `if (key === "coverFactPlacement" && typeof v === "string")` --
// would pass a type-only check and ship a garbage placement id to every letter.
// Only an id-membership check (PLACEMENTS.some(p => p.id === value)) rejects
// "middle". The existing allowlisted control key here is a boolean, so it never
// exercises the string branch; this file adds the one that does.
//
// RED ON HEAD: route.js:58-73 `sanitize()` has no `coverFactPlacement` branch,
// so a valid value is dropped on both write and read. The valid-round-trip and
// read-echo tests fail on HEAD now. The invalid-drop tests are FAIL-CLOSED
// GUARDS -- vacuously green on HEAD (an unknown key is dropped regardless of
// value) and made meaningful by the mutant control in the 4b report: a build
// that stores/echoes any string fails them.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// In-memory KV standing in for the Redis-backed jobCache. The route stores the
// merged prefs object under `user:<id>:uiPrefs`; getCached returns null on a
// miss exactly as the real client does.
const h = vi.hoisted(() => ({ kv: new Map(), userId: "user-1" }));

vi.mock("@/lib/cache/jobCache", () => ({
  getCached: async (key) => (h.kv.has(key) ? h.kv.get(key) : null),
  setCached: async (key, value) => {
    h.kv.set(key, value);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null } }) },
  }),
}));

let routeModule = null;
let routeLoadError = null;
async function loadRoute() {
  if (routeModule || routeLoadError) return routeModule;
  try {
    routeModule = await import("./route.js");
  } catch (err) {
    routeLoadError = err;
  }
  return routeModule;
}

function keyFor(userId) {
  return `user:${userId}:uiPrefs`;
}

async function GET() {
  const mod = await loadRoute();
  if (!mod?.GET) throw new Error(`user-prefs route GET unavailable: ${routeLoadError?.message || "not exported"}`);
  const res = await mod.GET();
  return { status: res.status, json: await res.clone().json() };
}

async function PUT(prefs) {
  const mod = await loadRoute();
  if (!mod?.PUT) throw new Error(`user-prefs route PUT unavailable: ${routeLoadError?.message || "not exported"}`);
  const req = new Request("http://localhost/api/user-prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefs }),
  });
  const res = await mod.PUT(req);
  return { status: res.status, json: await res.clone().json() };
}

beforeEach(() => {
  h.kv = new Map();
  h.userId = "user-1";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("AC-A1 harness / positive control", () => {
  it("an already-allowlisted key round-trips PUT -> fresh GET (proves the store and handlers work)", async () => {
    // Not the feature under test -- this is the vacuity control. If it fails,
    // every RED below would be un-interpretable (a broken harness, not a
    // missing feature).
    const put = await PUT({ hideAppliedJobs: true });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(got.status).toBe(200);
    expect(got.json.prefs.hideAppliedJobs).toBe(true);
  });
});

describe("AC-A1 persistence: a valid placement default survives a PUT -> fresh GET round trip", () => {
  it("stores and returns a valid id on the WRITE path (RED on HEAD: no coverFactPlacement branch)", async () => {
    const put = await PUT({ coverFactPlacement: "current" });
    expect(put.status).toBe(200);
    // The proof is a SEPARATE GET that re-reads getCached, not the PUT echo.
    const got = await GET();
    expect(
      got.json.prefs.coverFactPlacement,
      "a valid coverFactPlacement did not survive a PUT -> fresh GET round trip",
    ).toBe("current");
  });

  it("stores and returns a valid id on the READ path when the store already holds one (RED on HEAD)", async () => {
    // A value put there by an earlier session: GET must recognise and return
    // it. On HEAD, GET's sanitize() drops it as an unknown key -> RED.
    h.kv.set(keyFor("user-1"), { coverFactPlacement: "teaching", hideAppliedJobs: true });
    const got = await GET();
    expect(got.json.prefs.coverFactPlacement, "a stored valid coverFactPlacement was dropped on read").toBe("teaching");
    // Control: the sibling allowlisted key on the same read still survives, so
    // "dropped" above is specific to this key, not a broken read.
    expect(got.json.prefs.hideAppliedJobs).toBe(true);
  });
});

describe("AC-A1 fail-closed: an invalid placement id is dropped, not stored, not echoed", () => {
  it("an invalid-but-STRING value never overwrites a previously stored valid one (WRITE fail-closed)", async () => {
    // Trap #1: "middle" is a string, so a type-only sanitizer accepts it; only
    // an id-membership check rejects it. First store a valid value, then PUT a
    // string that is not a placement id, then read back.
    await PUT({ coverFactPlacement: "why" });
    const put = await PUT({ coverFactPlacement: "middle" });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(
      got.json.prefs.coverFactPlacement,
      "an invalid string overwrote the stored valid placement (a degenerate string-passthrough sanitizer would do this)",
    ).toBe("why");
  });

  it("an invalid-but-STRING value, alone, leaves NO coverFactPlacement stored (WRITE fail-closed, empty store)", async () => {
    // GUARD: vacuously green on HEAD (unknown key dropped regardless). The
    // mutant control (a build that stores any string) turns it red.
    const put = await PUT({ coverFactPlacement: "middle" });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(
      got.json.prefs.coverFactPlacement,
      "an invalid string was stored into an empty store instead of being dropped",
    ).toBeUndefined();
  });

  it("a wrong TYPE (number / object) is also dropped (fail-closed on non-string)", async () => {
    await PUT({ coverFactPlacement: 3 });
    expect((await GET()).json.prefs.coverFactPlacement).toBeUndefined();
    await PUT({ coverFactPlacement: { id: "current" } });
    expect((await GET()).json.prefs.coverFactPlacement).toBeUndefined();
  });

  it("a stored invalid id is dropped on the READ path so the client falls back to the default (READ fail-closed)", async () => {
    // GUARD: vacuously green on HEAD. A read-side passthrough mutant (echoing
    // coverFactPlacement without validating) turns it red.
    h.kv.set(keyFor("user-1"), { coverFactPlacement: "middle", hideAppliedJobs: true });
    const got = await GET();
    expect(
      got.json.prefs.coverFactPlacement,
      "a stored garbage placement id was echoed to the client instead of dropped",
    ).toBeUndefined();
    // Control: a real key in the same stored object still comes back, so the
    // read did happen -- the drop is specific to the invalid placement.
    expect(got.json.prefs.hideAppliedJobs).toBe(true);
  });
});

describe("AC-A1 auth: the route still refuses an unauthenticated caller", () => {
  it("401s a GET and a PUT with no user (the new key does not open a hole)", async () => {
    h.userId = null;
    expect((await GET()).status).toBe(401);
    expect((await PUT({ coverFactPlacement: "current" })).status).toBe(401);
  });
});
