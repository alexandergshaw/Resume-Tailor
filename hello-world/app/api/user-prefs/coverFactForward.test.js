// N92 Wave 2 (Control C) -- AC-C3 (persistence rides user-prefs additively,
// existing guards not weakened) and AC-C5 (turn-off-able, not one-way).
//
// The forward preference is a single additive boolean key `coverFactForward` on
// /api/user-prefs, sanitized STRICT-boolean: only a real `true`/`false`
// survives; a non-boolean is dropped and never overwrites a prior valid value;
// and the existing sanitize for coverFactPlacement / appliedSort /
// excludedTitleKeywords / the current booleans is byte-unchanged.
//
// WHY A ROUTE TEST, NOT A sanitize() UNIT CALL. `sanitize()` is module-private
// in route.js (GET/PUT are the entry points production calls). Exporting it so a
// test could call it directly would widen the export-reachability sweep surface
// purely to make a test easier and would prove nothing about a real PUT -> GET
// round trip. So every assertion drives the real GET/PUT handlers and reads back
// through a SEPARATE GET (re-reads getCached), never off the PUT's own echo
// (risk R1: a key echoed from the PUT body but never stored reads clean and is
// empty next session). Harness mirrors coverFactPlacement.test.js.
//
// RED ON HEAD (93afb75): ALLOWED_BOOLEAN_KEYS (route.js:9-13) holds only
// referencesOpen / educationOpen / hideAppliedJobs -- there is no
// coverFactForward branch, so a valid boolean is dropped on both write and read.
// The valid-round-trip and turn-off tests fail on HEAD now. The garbage-dropped
// tests are FAIL-CLOSED GUARDS -- vacuously green on HEAD (an unknown key is
// dropped regardless of value) -- made meaningful by the sanitize-passthrough
// mutant in the notes artifact: a build that stores any truthy/loosened value
// reds them.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

describe("AC-C3 harness / positive control", () => {
  it("an already-allowlisted boolean key round-trips PUT -> fresh GET (proves the store and handlers work)", async () => {
    // The vacuity control. If this fails, every RED below is un-interpretable
    // (a broken harness, not a missing feature).
    const put = await PUT({ hideAppliedJobs: true });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(got.status).toBe(200);
    expect(got.json.prefs.hideAppliedJobs).toBe(true);
  });
});

describe("AC-C3 persistence: a valid coverFactForward boolean survives PUT -> fresh GET", () => {
  it("stores and returns true on the WRITE path (RED on HEAD: no coverFactForward branch)", async () => {
    const put = await PUT({ coverFactForward: true });
    expect(put.status).toBe(200);
    const got = await GET(); // SEPARATE GET, re-reads getCached, not the PUT echo
    expect(
      got.json.prefs.coverFactForward,
      "a valid coverFactForward:true did not survive a PUT -> fresh GET round trip",
    ).toBe(true);
  });

  it("returns a stored true on the READ path when the store already holds one (RED on HEAD)", async () => {
    h.kv.set(keyFor("user-1"), { coverFactForward: true, hideAppliedJobs: true });
    const got = await GET();
    expect(got.json.prefs.coverFactForward, "a stored valid coverFactForward was dropped on read").toBe(true);
    // Control: the sibling allowlisted key on the same read still survives, so
    // "dropped" above is specific to this key, not a broken read.
    expect(got.json.prefs.hideAppliedJobs).toBe(true);
  });
});

describe("AC-C5 not one-way: false is settable, persists, and takes effect (RED on HEAD)", () => {
  it("PUT true then PUT false leaves false stored (the N82 turn-off-able lesson)", async () => {
    await PUT({ coverFactForward: true });
    const off = await PUT({ coverFactForward: false });
    expect(off.status).toBe(200);
    const got = await GET();
    expect(
      got.json.prefs.coverFactForward,
      "false was swallowed as 'no preference' -- the toggle is one-way (the N82 defect)",
    ).toBe(false);
  });

  it("a fresh false round-trips as false, never dropped as falsy (RED on HEAD)", async () => {
    // A sanitizer that treats `false` like an absent/empty value (e.g.
    // `if (input[key])`) would drop it; strict-boolean keeps it.
    const put = await PUT({ coverFactForward: false });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(got.json.prefs.coverFactForward, "a legitimate false was dropped instead of stored").toBe(false);
  });
});

describe("AC-C3 fail-closed: a non-boolean coverFactForward is dropped, never stored, never echoed", () => {
  it("a garbage value never overwrites a previously stored valid boolean (WRITE fail-closed)", async () => {
    // Trap: a loosened sanitizer (`typeof v !== 'undefined'`, or a truthiness
    // coercion) would let a non-boolean through. Store a valid value, then PUT
    // garbage, then read back -- the valid value must survive.
    await PUT({ coverFactForward: true });
    const put = await PUT({ coverFactForward: "yes" });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(
      got.json.prefs.coverFactForward,
      "a non-boolean overwrote the stored valid coverFactForward (a loosened sanitizer would do this)",
    ).toBe(true);
  });

  it("a non-boolean, alone, leaves NO coverFactForward stored (WRITE fail-closed, empty store) [GUARD]", async () => {
    // GUARD: vacuously green on HEAD (unknown key dropped regardless). The
    // sanitize-passthrough mutant (stores any value) turns it red.
    for (const garbage of ["true", 1, 0, null, {}, []]) {
      h.kv = new Map();
      const put = await PUT({ coverFactForward: garbage });
      expect(put.status).toBe(200);
      const got = await GET();
      expect(
        got.json.prefs.coverFactForward,
        `a non-boolean coverFactForward (${JSON.stringify(garbage)}) was stored instead of dropped`,
      ).toBeUndefined();
    }
  });

  it("a stored non-boolean is dropped on the READ path so the client falls back to safe-off (READ fail-closed) [GUARD]", async () => {
    // GUARD: vacuously green on HEAD. A read-side passthrough mutant (echoing
    // coverFactForward without a boolean check) turns it red.
    h.kv.set(keyFor("user-1"), { coverFactForward: "yes", hideAppliedJobs: true });
    const got = await GET();
    expect(
      got.json.prefs.coverFactForward,
      "a stored garbage coverFactForward was echoed to the client instead of dropped",
    ).toBeUndefined();
    // Control: a real key in the same stored object still comes back.
    expect(got.json.prefs.hideAppliedJobs).toBe(true);
  });
});

describe("AC-C3 the existing sanitize behaviour is byte-unchanged (guards not weakened)", () => {
  it("coverFactPlacement still id-membership-checked; 'middle' still dropped, a valid id still kept", async () => {
    // If adding coverFactForward loosened the shared sanitizer, the placement
    // guard could regress. Pin both directions of the N62/N82 behaviour here.
    await PUT({ coverFactPlacement: "why" });
    await PUT({ coverFactPlacement: "middle" }); // invalid-but-string
    expect((await GET()).json.prefs.coverFactPlacement, "the invalid placement id was not dropped -- sanitize weakened").toBe("why");
  });

  it("the empty-string no-preference placement still round-trips (N82), unaffected by the new key", async () => {
    await PUT({ coverFactPlacement: "current" });
    await PUT({ coverFactPlacement: "" });
    expect((await GET()).json.prefs.coverFactPlacement).toBe("");
  });

  it("a mixed PUT keeps every valid key: placement id, existing boolean, and the new boolean together", async () => {
    const put = await PUT({ coverFactPlacement: "teaching", hideAppliedJobs: true, coverFactForward: true });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(got.json.prefs.coverFactPlacement).toBe("teaching");
    expect(got.json.prefs.hideAppliedJobs).toBe(true);
    expect(got.json.prefs.coverFactForward, "the new boolean did not persist alongside the existing keys").toBe(true);
  });
});

describe("AC-C3 auth: the route still refuses an unauthenticated caller (the new key opens no hole)", () => {
  it("401s a GET and a PUT with no user", async () => {
    h.userId = null;
    expect((await GET()).status).toBe(401);
    expect((await PUT({ coverFactForward: true })).status).toBe(401);
  });
});
