// N35 fix round -- verify.r1.md B5 and M6.
//
// B5. There was no GET on this route. `useCompanyResearch.js`'s `baseRevision`
// comes only from `acceptedFactsByJob[jobId]?.revision`, which lives in React
// state and starts `undefined` in every fresh session/tab. The RPC reads a
// null base revision as "no row exists yet"; when a row DOES exist, the
// insert's `on conflict (application_id) do nothing` loses and the function
// returns `conflict` -- the 409 the route already maps to "Reload and try
// again." Without a GET, reloading changes nothing: the next session sends
// `baseRevision: null` again and gets the identical 409. This file pins the
// missing read side.
//
// M6. `factStore.js`'s "cover-required" refusal used to become "This
// application has a cover letter, so accepting facts must include the
// updated cover letter text." -- API-contract vocabulary with no action a
// candidate can take. This file pins the reworded, actionable message.
//
// Same harness shape as ./coverlessAccept.test.js: `makeStatefulSupabase`
// (not the `makeSupabaseFake` plan r3 names, which does not exist -- see
// that file's own header) and a lazily-imported route module so a missing
// export goes red instead of "no tests".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";

const USER = "11111111-1111-1111-1111-111111111111";
const APP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const POSITION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const JOB_REF = "gh-1";

const FACT = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  text: "Acme opened a Dublin telemetry lab in 2026.",
  url: "https://acme.example.com/newsroom/dublin-lab",
  title: "Acme opens Dublin telemetry lab",
  source: "Acme Newsroom",
  placement: "current",
  textOrigin: "template",
};

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

const h = vi.hoisted(() => ({ supabase: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => h.supabase,
}));

async function GET(jobRef, { fake } = {}) {
  const mod = await loadRoute();
  if (!mod?.GET) {
    throw new Error(`app/api/accepted-facts/route.js#GET is not available: ${routeLoadError?.message || "not exported"}`);
  }
  h.supabase = fake;
  const url = jobRef == null ? "http://localhost/api/accepted-facts" : `http://localhost/api/accepted-facts?jobRef=${encodeURIComponent(jobRef)}`;
  const res = await mod.GET(new Request(url));
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function PUT(body, { fake } = {}) {
  const mod = await loadRoute();
  h.supabase = fake;
  const req = new Request("http://localhost/api/accepted-facts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.PUT(req);
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function fakeWith({ coverLetterId = null, rows, rpcResult } = {}) {
  return makeStatefulSupabase(
    {
      positions: [{ id: POSITION_ID, external_id: JOB_REF, user_id: USER }],
      applications: [{ id: APP_ID, user_id: USER, position_id: POSITION_ID, cover_letter_id: coverLetterId }],
      application_accepted_facts:
        rows === undefined
          ? [{ application_id: APP_ID, user_id: USER, facts: [FACT], retracted: ["https://declined.example.com/x"], revision: 3 }]
          : rows,
    },
    {
      user: { id: USER },
      primaryKeys: { application_accepted_facts: ["application_id"] },
      rpc: { accept_application_facts: rpcResult ?? { status: "ok", revision: 1, cover_version_id: null, facts: [], removed: [] } },
    },
  );
}

beforeEach(() => {
  h.supabase = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/accepted-facts reads back the current facts/removed/revision (B5)", () => {
  it("returns the stored row's facts, removed and revision for an owned application", async () => {
    const { status, json } = await GET(JOB_REF, { fake: fakeWith({}) });
    expect(status).toBe(200);
    expect(json.revision).toBe(3);
    expect(json.facts).toEqual([FACT]);
    expect(json.removed).toEqual(["https://declined.example.com/x"]);
  });

  it("returns revision: null and empty arrays when no row exists yet -- not a 404", async () => {
    const { status, json } = await GET(JOB_REF, { fake: fakeWith({ rows: [] }) });
    expect(status).toBe(200);
    expect(json.revision).toBeNull();
    expect(json.facts).toEqual([]);
    expect(json.removed).toEqual([]);
  });

  it("404s when the application cannot be found for this user", async () => {
    const fake = makeStatefulSupabase(
      { positions: [], applications: [], application_accepted_facts: [] },
      { user: { id: USER }, primaryKeys: { application_accepted_facts: ["application_id"] } },
    );
    const { status } = await GET(JOB_REF, { fake });
    expect(status).toBe(404);
  });

  it("400s when jobRef is missing", async () => {
    const { status } = await GET(null, { fake: fakeWith({}) });
    expect(status).toBe(400);
  });

  it("THE POINT: the revision this GET returns is exactly the value a fresh session's next PUT needs as baseRevision to avoid the conflict a null base produces", async () => {
    const { json: getJson } = await GET(JOB_REF, { fake: fakeWith({}) });
    expect(getJson.revision).toBe(3);
    // A PUT sent with baseRevision: null (today's only option pre-GET)
    // conflicts against an existing row -- the shipped RPC's own documented
    // behaviour (its `on conflict (application_id) do nothing` loses the
    // race and `v_revision` stays null), reproduced here as the fake's
    // canned RPC result rather than executed against real Postgres (no
    // engine reachable from this suite -- see coverlessAccept.test.js's own
    // header for why, and verify.r1.md's PGlite run for where it WAS
    // executed).
    const { status: nullStatus, json: nullJson } = await PUT(
      { jobRef: JOB_REF, facts: [FACT], baseRevision: null, declinedUrls: [] },
      { fake: fakeWith({ rpcResult: { status: "conflict", revision: 3, facts: [FACT], removed: [] } }) },
    );
    expect(nullStatus).toBe(409);
    expect(nullJson.revision).toBe(3);
    // The SAME revision the GET reported. A client that seeds baseRevision
    // from this GET instead of null sends the right value, and this exact
    // conflict does not happen for the very next accept.
    expect(getJson.revision).toBe(nullJson.revision);
  });
});

describe("the cover-required 400 names an action, not an API contract (M6)", () => {
  it("does not use API-contract vocabulary, and tells the candidate what to do", async () => {
    const fake = fakeWith({ coverLetterId: "dddddddd-dddd-dddd-dddd-dddddddddddd" });
    const { status, json } = await PUT(
      { jobRef: JOB_REF, facts: [], baseRevision: 1, declinedUrls: [], coverVersion: null },
      { fake },
    );
    expect(status).toBe(400);
    expect(typeof json.error).toBe("string");
    // The old wording, explicitly refused.
    expect(json.error).not.toMatch(/must include the updated cover letter text/i);
    // An action the candidate can actually take.
    expect(json.error).toMatch(/open|reopen/i);
    expect(json.error).toMatch(/cover letter/i);
  });
});
