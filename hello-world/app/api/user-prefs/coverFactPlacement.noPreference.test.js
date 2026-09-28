// N82: the per-user cover-fact placement default must be able to go BACK to
// "no preference" (let the app decide), not only forward to a pinned id. This
// file drives the REAL GET/PUT handlers (sanitize() is module-private and stays
// that way -- exporting it to call directly would widen the export-reachability
// surface for no product reason and prove nothing about a real round trip), and
// every "did it persist" check reads back through a SEPARATE GET that re-reads
// getCached, never off the PUT's own echo.
//
// CHOSEN REPRESENTATION AND HOW IT MEETS id-MEMBERSHIP VALIDATION.
// No-preference is the empty string "". This is the value the whole consumer
// chain already treats as "none saved": CompanyResearchDialog defaults the prop
// to "" and every reader resolves `defaultPlacement || DEFAULT_PLACEMENT`, so a
// falsy stored value transparently follows DEFAULT_PLACEMENT (and would follow a
// FUTURE change to it), which a pinned "intro" would not. The route's sanitize()
// today keeps a coverFactPlacement only when `PLACEMENTS.some(p => p.id === v)`;
// "" is not a member, so on HEAD it is dropped on both write and read. The fix
// widens that ONE branch ADDITIVELY -- accept `v === ""` OR a real id -- and
// nothing else. The widening therefore does NOT loosen id-membership to a
// type-only check: an invalid-but-string id ("middle") is still rejected, so the
// three shipped fail-closed guards (and the passthrough mutant that kills them)
// are untouched. The guard test below re-proves that through the new code path.
//
// RED ON HEAD:
//  * "the way back" -- pinning a concrete placement then choosing no-preference
//    must clear the pin. On HEAD the "" PUT is dropped, the merge keeps the old
//    pin, and GET still returns it -> RED.
// GREEN-ON-HEAD CONTROLS / GUARDS (disclosed):
//  * a concrete pin persists (positive control; proves the store + handlers work
//    and that "!== the pin" in the way-back test is a real change, not a
//    perpetually-empty read).
//  * an invalid-but-string value is still dropped and the prior pin preserved
//    (fail-closed guard; vacuously green on HEAD, red under a passthrough mutant
//    that accepts any string -- see the 4b notes).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_PLACEMENT, PLACEMENTS } from "@/lib/document/coverLetterWeave.js";

// In-memory KV standing in for the Redis-backed jobCache, exactly as the shipped
// route test does. getCached returns null on a miss, as the real client does.
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

// A concrete id that is NOT the default, so "the pin persisted" and "the pin was
// cleared to default" are observably different states.
const PINNED = PLACEMENTS.map((p) => p.id).find((id) => id !== DEFAULT_PLACEMENT) || "current";

beforeEach(() => {
  h.kv = new Map();
  h.userId = "user-1";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("N82 fixtures / positive control", () => {
  it("a concrete placement pin round-trips PUT -> fresh GET (proves the store + handlers work)", async () => {
    // GREEN on HEAD. Also the anchor for the way-back test: it establishes that
    // a pin genuinely persists, so a later "no longer the pin" is a real clear.
    expect(PINNED).not.toBe(DEFAULT_PLACEMENT);
    const put = await PUT({ coverFactPlacement: PINNED });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(got.status).toBe(200);
    expect(got.json.prefs.coverFactPlacement, "a concrete pin did not survive a PUT -> fresh GET").toBe(PINNED);
  });
});

describe("N82 the way back: no-preference clears a previously pinned placement (RED on HEAD)", () => {
  it('after pinning a concrete placement, a no-preference ("") PUT makes GET stop returning the pin and resolve to the default', async () => {
    // 1. Pin a concrete, non-default placement (works on HEAD).
    await PUT({ coverFactPlacement: PINNED });
    expect((await GET()).json.prefs.coverFactPlacement).toBe(PINNED);

    // 2. Choose no-preference. On HEAD the "" PUT is dropped by sanitize, the
    //    merge preserves the old pin, and GET still returns it -> RED here.
    const put = await PUT({ coverFactPlacement: "" });
    expect(put.status).toBe(200);

    const got = await GET();
    const stored = got.json.prefs.coverFactPlacement;
    // The pin is gone...
    expect(
      stored,
      "choosing no-preference did not clear the pinned placement -- there is no way back to 'let the app decide'",
    ).not.toBe(PINNED);
    // ...and the effective placement now follows the app default (falsy stored
    // value flows through the consumers' `|| DEFAULT_PLACEMENT` fallback). This
    // holds whether the route stores "" or drops the key entirely; what it must
    // NOT do is keep the old pin.
    expect(
      stored || DEFAULT_PLACEMENT,
      "the cleared placement does not resolve to DEFAULT_PLACEMENT",
    ).toBe(DEFAULT_PLACEMENT);
    // ...and it must not have been quietly rewritten to some OTHER concrete id.
    expect([...PLACEMENTS.map((p) => p.id)].includes(stored) ? stored : DEFAULT_PLACEMENT).toBe(DEFAULT_PLACEMENT);
  });
});

describe("N82 fail-closed is NOT weakened by accepting no-preference (guard: vacuously green on HEAD)", () => {
  it('an invalid-but-STRING value ("middle") is still dropped and never overwrites a valid pin (killed by a passthrough mutant)', async () => {
    // The fix widens sanitize to accept "" as well as real ids. This guard pins
    // that the widening is NARROW: it must not become a type-only check, or
    // "middle" would sail through just like "". Store a pin, PUT garbage, read
    // back: the pin must survive.
    await PUT({ coverFactPlacement: PINNED });
    const put = await PUT({ coverFactPlacement: "middle" });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(
      got.json.prefs.coverFactPlacement,
      "an invalid string overwrote the stored pin -- sanitize was loosened to accept any string, not just no-preference",
    ).toBe(PINNED);
  });

  it('an invalid-but-STRING value, alone, leaves NO coverFactPlacement stored (empty store; killed by a passthrough mutant)', async () => {
    const put = await PUT({ coverFactPlacement: "middle" });
    expect(put.status).toBe(200);
    const got = await GET();
    expect(
      got.json.prefs.coverFactPlacement,
      "an invalid string was stored into an empty store instead of being dropped",
    ).toBeUndefined();
  });
});
