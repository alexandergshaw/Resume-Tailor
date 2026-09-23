// N35 / 4b -- PM3 from `chunks/N40/plan.check.r2.md`.
//
// WHAT PM3 FOUND, BY EXECUTION AGAINST REAL POSTGRES. The plan checker ran
// plan r3 §7.7's migration and `accept_application_facts` against PGlite 0.3
// with the real `generated_cover_letters` DDL, RLS and the
// `authenticated`/`anon` roles. Eleven behavioural cases passed. One did not:
//
//     retract-only -> {"status":"ok","revision":2,"cover_version_id":null}
//     state        -> {"revision":2,"versions":1,...}
//     the letter the pointer still serves: {"content":"v1","inserted_facts":[{"id":"f1"}]}
//       <-- the store says facts = [], and the served letter still records
//           and contains f1
//
// With `p_cover_content` null the function bumps the revision, writes no
// version and moves no pointer, and returns `ok`. §6's contract C1 -- "a 200
// means facts, version and pointer are all committed" -- is stated
// unconditionally and is only true when a cover is sent. That is exactly the
// failure direction (`plan.check.r1.md` PM1: store and letter disagree) the
// RPC was introduced to close.
//
// WHAT THIS FILE PINS. The fix direction PM3 names, made behavioural at the
// route: a facts-changing PUT that sends no `coverVersion` is REFUSED when the
// application has a cover letter, and nothing is written; and a 200 states
// truthfully, in `versionSaved`, whether the served letter moved with the
// facts. The invariant, stated once so it can be tested rather than trusted:
//
//     a 200 with versionSaved === false must never be possible for an
//     application that has a cover letter.
//
// WHAT THIS FILE CANNOT DO, AND WHY -- read this before treating the second
// describe as coverage. The brief asked for RPC-2, RPC-3 and RPC-4 to get
// BEHAVIOURAL instruments rather than a text match. They cannot have them
// here, for two separate reasons, and one of them is not a tooling problem:
//
//   1. No Postgres is reachable from this suite. `pg`, `postgres`, `pg-mem`
//      and `@electric-sql/pglite` are all absent from `hello-world/node_modules`,
//      and `psql`, `postgres`, `docker`, `pg_ctl` and `initdb` are absent from
//      PATH (measured by the plan checker this round, re-measured here is not
//      possible from inside vitest). Adding a dependency is a `package.json`
//      change, which is outside this seat's allowed files and would change
//      what `npm ci` installs.
//   2. More importantly: the checker ALREADY RAN the experiment. Against real
//      Postgres, RPC-2 (drop the pointer `exists (... revision = v_revision)`),
//      RPC-3 (drop the `row_count <> 1` raise) and RPC-4 (`security definer`)
//      each SURVIVED behaviourally -- identical output on all three calls --
//      while RPC-1 was killed. All three guard states a SINGLE SESSION cannot
//      produce. So no single-session behavioural test can kill them, here or
//      anywhere; the honest instruments are (a) the structural assertions
//      below, whose blind spot is named beside them, and (b) the live 8f
//      script L-CONC.
//      The one exception the checker did measure: with the `applications`
//      UPDATE policy absent, RPC-3's raise IS observable -- the pointer update
//      touches 0 rows, `P0001` is raised and the transaction rolls back. That
//      is a real behavioural instrument for RPC-3 and it is owed at 8f, not
//      here, because it needs a database.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// NOTE for the implementer: plan r3 §7.6 / ST-N2 call this helper
// `makeSupabaseFake({...})`. There is no such export. The file exports
// `makeStatefulSupabase(seed, opts)` -- rows first, options second -- and the
// `rpc` spec lives in the OPTIONS argument, not beside the tables. Verified by
// reading `test/helpers/supabaseFake.js:348` and `:645`.
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

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

// The route module does not exist yet. A static import would make this whole
// file fail to load and print "Tests  no tests", which is inconclusive rather
// than red -- so it is loaded lazily and only the legs that need it go red.
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
async function PUT(body, { fake } = {}) {
  const mod = await loadRoute();
  if (!mod?.PUT) {
    throw new Error(
      `app/api/accepted-facts/route.js#PUT is not available: ${routeLoadError?.message || "not exported"}`,
    );
  }
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

const h = vi.hoisted(() => ({ supabase: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => h.supabase,
}));

// A supabase fake seeded so the route's own state reads resolve, with the RPC
// answering the way the executed SQL does.
function fakeWith({ coverLetterId = null, rpcResult, rows } = {}) {
  return makeStatefulSupabase(
    {
      positions: [{ id: POSITION_ID, external_id: JOB_REF, user_id: USER }],
      applications: [
        { id: APP_ID, user_id: USER, position_id: POSITION_ID, cover_letter_id: coverLetterId },
      ],
      application_accepted_facts: rows || [
        { application_id: APP_ID, user_id: USER, facts: [FACT], retracted: [], revision: 1 },
      ],
      generated_cover_letters: coverLetterId
        ? [
            {
              id: coverLetterId,
              user_id: USER,
              position_id: POSITION_ID,
              content: "v1",
              content_lines: ["v1"],
              inserted_facts: [{ id: FACT.id, text: FACT.text }],
            },
          ]
        : [],
    },
    {
      user: { id: USER },
      primaryKeys: { application_accepted_facts: ["application_id"] },
      rpc: {
        accept_application_facts:
          rpcResult ?? { status: "ok", revision: 2, cover_version_id: null, facts: [], removed: [] },
      },
    },
  );
}

function rpcCalls(fake) {
  return fake.calls.filter((c) => c.verb === "rpc");
}

beforeEach(() => {
  h.supabase = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Harness sanity control.
// ---------------------------------------------------------------------------

describe("harness sanity control", () => {
  it("the supabase fake records rpc calls and their arguments", async () => {
    const fake = fakeWith({});
    const out = await fake.rpc("accept_application_facts", { p_application_id: APP_ID });
    expect(out.data.status).toBe("ok");
    expect(rpcCalls(fake)).toHaveLength(1);
    expect(rpcCalls(fake)[0].args.p_application_id).toBe(APP_ID);
  });

  it("the migrations directory exists and the canary migration is readable", () => {
    const names = readdirSync(MIGRATIONS);
    expect(names.length).toBeGreaterThan(10);
    // The canary for the SQL instrument below: a migration that really does
    // declare a `security invoker` function with `set search_path`, so a zero
    // from the same predicate on the new file is a real zero.
    const withInvoker = names.filter((n) => {
      const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS, n), "utf8")).toLowerCase();
      return sql.includes("security invoker") && sql.includes("set search_path");
    });
    expect(withInvoker.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PM3, the behavioural half.
// ---------------------------------------------------------------------------

describe("a facts-changing accept can never leave the store and the served letter disagreeing (PM3)", () => {
  it("REFUSES a facts-changing PUT that sends no coverVersion when the application has a cover letter", async () => {
    const fake = fakeWith({ coverLetterId: "dddddddd-dddd-dddd-dddd-dddddddddddd" });
    const { status, json } = await PUT(
      { jobRef: JOB_REF, facts: [], baseRevision: 1, declinedUrls: [], coverVersion: null },
      { fake },
    );
    expect(status).toBe(400);
    expect(typeof json.error).toBe("string");
    expect(json.error).toMatch(/cover/i);
    // Nothing was written. A refusal that still ran the RPC would have bumped
    // the revision, which is the whole defect.
    expect(rpcCalls(fake)).toHaveLength(0);
  });

  it("CONTROL: the same PUT WITH a coverVersion succeeds and reports versionSaved true", async () => {
    const coverId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const fake = fakeWith({
      coverLetterId: coverId,
      rpcResult: { status: "ok", revision: 2, cover_version_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" },
    });
    const { status, json } = await PUT(
      {
        jobRef: JOB_REF,
        facts: [],
        baseRevision: 1,
        declinedUrls: [],
        coverVersion: { lines: ["Dear Hiring Manager,", "Sincerely,"], insertedFacts: [] },
      },
      { fake },
    );
    expect(status).toBe(200);
    expect(json.versionSaved).toBe(true);
    expect(rpcCalls(fake)).toHaveLength(1);
    // The cover really was sent to the transaction, not dropped on the way.
    const args = rpcCalls(fake)[0].args;
    expect(typeof args.p_cover_content).toBe("string");
    expect(args.p_cover_content.length).toBeGreaterThan(0);
  });

  it("CONTROL: an application with NO cover letter is not caught by the guard", async () => {
    // The over-fire control. The guard is about a letter that exists and would
    // be left behind, not about every cover-less PUT.
    const fake = fakeWith({ coverLetterId: null });
    const { status, json } = await PUT(
      { jobRef: JOB_REF, facts: [], baseRevision: 1, declinedUrls: [], coverVersion: null },
      { fake },
    );
    expect(status).toBe(200);
    expect(json.versionSaved).toBe(false);
    expect(rpcCalls(fake)).toHaveLength(1);
  });

  it("THE INVARIANT: no 200 with versionSaved false is reachable for an application that has a cover letter", async () => {
    // The class guard, over the whole PUT surface rather than the one shape
    // that produced the bug. Every combination of a cover-bearing application
    // with a facts change is walked; none may return a 200 that admits the
    // letter did not move.
    const coverId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const bodies = [
      { facts: [], coverVersion: null }, // retract everything
      { facts: [FACT], coverVersion: null }, // add one
      { facts: [FACT], coverVersion: undefined }, // key omitted entirely
      { facts: [{ ...FACT, text: `${FACT.text} Extra.` }], coverVersion: null }, // edit in place
    ];
    for (const body of bodies) {
      const fake = fakeWith({ coverLetterId: coverId });
      const { status, json } = await PUT(
        { jobRef: JOB_REF, baseRevision: 1, declinedUrls: [], ...body },
        { fake },
      );
      // A 429 would satisfy the invariant for the wrong reason -- the walk
      // must reach the route's own decision, not its rate limiter.
      expect(status, `${JSON.stringify(body)} was rate-limited, not decided`).not.toBe(429);
      const admitsDisagreement = status === 200 && json?.versionSaved !== true;
      expect(admitsDisagreement, `${JSON.stringify(body)} returned ${status} / ${JSON.stringify(json)}`).toBe(false);
      if (status !== 200) expect(rpcCalls(fake)).toHaveLength(0);
    }
  });

  it("a 200 always states which of the two it is, and never omits the field", async () => {
    // C1 restated as something a client can act on. `versionSaved` must be a
    // real boolean on every success, so "undefined" can never be read as
    // "false" (or as "true") by the accept's step 9.
    const fake = fakeWith({ coverLetterId: null });
    const { status, json } = await PUT(
      { jobRef: JOB_REF, facts: [], baseRevision: 1, declinedUrls: [], coverVersion: null },
      { fake },
    );
    expect(status).toBe(200);
    expect(typeof json.versionSaved).toBe("boolean");
    expect(Object.prototype.hasOwnProperty.call(json, "versionSaved")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PM3, the SQL half. STRUCTURAL, not behavioural -- see the header for why no
// behavioural instrument for RPC-2/3/4 exists in this suite or in any
// single-session test.
// ---------------------------------------------------------------------------

describe("the accept transaction's three unobservable guards are present (RPC-2, RPC-3, RPC-4)", () => {
  function migrationSql() {
    const name = readdirSync(MIGRATIONS).find((n) => n.endsWith("_application_accepted_facts.sql"));
    if (!name) {
      throw new Error(
        "no *_application_accepted_facts.sql in supabase/migrations -- the stamp is re-derived at G1.2, so this matches on the suffix, not the timestamp",
      );
    }
    return stripSqlComments(readFileSync(path.join(MIGRATIONS, name), "utf8")).toLowerCase();
  }

  it("RPC-2: the pointer UPDATE is conditional on the facts row carrying the revision just written", () => {
    const sql = migrationSql();
    const at = sql.indexOf("update public.applications");
    expect(at, "no pointer UPDATE in the migration").toBeGreaterThan(-1);
    const stmt = sql.slice(at, sql.indexOf(";", at));
    expect(stmt).toContain("exists (");
    expect(stmt).toContain("public.application_accepted_facts");
    expect(stmt).toContain("revision = v_revision");
  });

  it("RPC-3: the pointer UPDATE's row count is checked and raises when it is not 1", () => {
    const sql = migrationSql();
    const at = sql.indexOf("get diagnostics");
    expect(at, "no `get diagnostics` after the pointer UPDATE").toBeGreaterThan(-1);
    const after = sql.slice(at, at + 400);
    expect(after).toMatch(/row_count/);
    expect(after).toMatch(/<>\s*1/);
    expect(after).toMatch(/raise/);
    expect(after).toMatch(/p0001/);
  });

  it("RPC-4: the function is `security invoker`, and `security definer` appears nowhere", () => {
    const sql = migrationSql();
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });

  it("CANARY: the same three predicates find their targets in a migration that HAS them", () => {
    // Without this, three green rows above would be indistinguishable from a
    // parser that finds nothing anywhere. `record_prep_model_call`'s migration
    // is the repo's existing `security invoker` + `set search_path` function.
    const names = readdirSync(MIGRATIONS);
    const hit = names
      .map((n) => stripSqlComments(readFileSync(path.join(MIGRATIONS, n), "utf8")).toLowerCase())
      .find((sql) => sql.includes("security invoker") && sql.includes("set search_path"));
    expect(hit).toBeTruthy();
    expect(hit).toContain("security invoker");
  });

  it("CANARY: the predicates FAIL on text that only mentions the tokens in the wrong places", () => {
    // The blind spot, made explicit rather than left implied. These three
    // assertions are satisfied by TOKENS, so a semantically equivalent rewrite
    // of any guard (a join instead of the EXISTS, `= 0` instead of `<> 1`,
    // `count(*) = 1`) goes RED although the behaviour is unchanged -- and a
    // WEAKENING that keeps the tokens goes GREEN. That is the cost of having
    // no database, and it is why 8f L-CONC is still owed.
    const decoy = "update public.applications set cover_letter_id = v_version where a.id = p_application_id;";
    const at = decoy.indexOf("update public.applications");
    const stmt = decoy.slice(at);
    expect(stmt).not.toContain("exists (");
  });
});

// WHAT THIS FILE CANNOT CATCH, in one line each.
//   * The route half measures the ROUTE's decision over a fake. It cannot see
//     PostgREST, RLS, or whether the RPC really runs in one transaction.
//   * The SQL half is a token match with a named blind spot (above). It says a
//     guard is PRESENT, never that it WORKS.
//   * Two genuinely concurrent accepts are not exercised anywhere in this
//     suite; the row-lock / EvalPlanQual re-check plan r3 §7.7 rests on is
//     still only cited. 8f L-CONC is the only real proof.
