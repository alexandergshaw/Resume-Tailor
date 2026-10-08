// N143 seam 1 (T2). Falsifier for lib/supabase/applicationProjectPool.js, the
// storage layer for the pre-warmed project pool — RED at the import line until
// the module lands. Modeled function-for-function on applicationDigests.test.js.
//
// This is the one place in Row 1 where a field can be dropped with nothing
// going red: upsertProjectPool builds an EXPLICIT row from a column-wise
// whitelist, so a field the whitelist does not name is silently discarded (a
// 200, a NULL column forever — this repo's signature failure, R-D). So every
// test is about a key reaching, or not reaching, the row that goes to
// PostgREST, and the unknown-field case is the positive control that pins the
// whitelist as the reason the known fields get through.
//
// CONTRACT (design r2 §1.3, plan S2):
//   getProjectPool(supabase, userId, applicationId) -> { pool, error }  (PK read, maybeSingle)
//   listProjectPools(supabase, userId, applicationIds) -> { pools, error }  (keyed by application_id)
//   upsertProjectPool(supabase, userId, applicationId, fields) -> { pool, error }
//     whitelist: projects(array), status(string), error(string|null), engine(string|null); stamps updated_at
//   never throws.

import { describe, it, expect, vi } from "vitest";
import {
  getProjectPool,
  listProjectPools,
  upsertProjectPool,
} from "./applicationProjectPool.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-1";

function supabaseDouble({ data = { application_id: APP_ID }, error = null } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(async () => ({ data: Array.isArray(data) ? data : [data], error })),
    upsert: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  const client = { from: vi.fn(() => chain) };
  return { client, chain };
}

async function rowFrom(fields) {
  const { client, chain } = supabaseDouble();
  await upsertProjectPool(client, USER_ID, APP_ID, fields);
  expect(chain.upsert).toHaveBeenCalledTimes(1);
  return chain.upsert.mock.calls[0][0];
}

const PROJECTS = [{ competency: "incident response", domain: "SRE", title: "t", bullets: ["a", "b"], hypothetical: true }];

describe("upsertProjectPool — the column-wise whitelist (R-D)", () => {
  it("carries the whitelisted columns through to the row", async () => {
    const row = await rowFrom({ projects: PROJECTS, status: "ready", error: null, engine: "gemini" });
    expect(row).toMatchObject({
      application_id: APP_ID,
      user_id: USER_ID,
      projects: PROJECTS,
      status: "ready",
      error: null,
      engine: "gemini",
    });
  });

  it("[positive control] drops a field the whitelist does not name", async () => {
    // Without this the test above proves nothing: a row that spread `fields`
    // would satisfy it. This pins the whitelist as the reason the known
    // columns arrive. `projectsJson`/`project` are the plausible typos.
    const row = await rowFrom({ status: "ready", projectsJson: PROJECTS, project: PROJECTS, garbage: 1 });
    expect(row.projectsJson).toBeUndefined();
    expect(row.project).toBeUndefined();
    expect(row.garbage).toBeUndefined();
  });

  it("writes an EXPLICIT null error, because a failure path clears the prior error", async () => {
    const row = await rowFrom({ status: "failed", error: null });
    expect(Object.prototype.hasOwnProperty.call(row, "error")).toBe(true);
    expect(row.error).toBe(null);
  });

  it("stamps updated_at on every write", async () => {
    const ready = await rowFrom({ status: "ready", projects: PROJECTS });
    const failed = await rowFrom({ status: "failed" });
    expect(typeof ready.updated_at).toBe("string");
    expect(typeof failed.updated_at).toBe("string");
  });

  it("refuses a non-array projects rather than storing a scalar", async () => {
    for (const bad of ["[]", 7, true, { a: 1 }]) {
      const row = await rowFrom({ status: "ready", projects: bad });
      expect(Object.prototype.hasOwnProperty.call(row, "projects")).toBe(false);
    }
  });

  it("upserts on application_id", async () => {
    const { client, chain } = supabaseDouble();
    await upsertProjectPool(client, USER_ID, APP_ID, { status: "pending" });
    expect(chain.upsert.mock.calls[0][1]).toEqual({ onConflict: "application_id" });
  });

  it("returns the error rather than throwing", async () => {
    const { client } = supabaseDouble({ data: null, error: { message: "nope" } });
    const res = await upsertProjectPool(client, USER_ID, APP_ID, { status: "ready" });
    expect(res.error).toBe("nope");
    expect(res.pool).toBeNull();
  });

  it("refuses a missing application id without throwing", async () => {
    const { client } = supabaseDouble();
    const res = await upsertProjectPool(client, USER_ID, "", { status: "ready" });
    expect(res.pool).toBeNull();
    expect(typeof res.error).toBe("string");
  });
});

describe("getProjectPool — single-row PK read, tenant-scoped", () => {
  it("scopes the read to the caller's own user_id AND the application_id", async () => {
    const { client, chain } = supabaseDouble({ data: { application_id: APP_ID, status: "ready" } });
    await getProjectPool(client, USER_ID, APP_ID);
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(chain.eq).toHaveBeenCalledWith("application_id", APP_ID);
    expect(chain.maybeSingle).toHaveBeenCalled();
  });

  it("returns { pool, error } and never throws on a transient error", async () => {
    const { client } = supabaseDouble({ data: null, error: { message: "boom" } });
    const res = await getProjectPool(client, USER_ID, APP_ID);
    expect(res.pool).toBeNull();
    expect(res.error).toBe("boom");
  });
});

describe("listProjectPools — the cost-gate read, keyed by application_id", () => {
  it("scopes to user_id and keys the result by application_id", async () => {
    const { client, chain } = supabaseDouble({ data: [{ application_id: APP_ID, status: "ready" }] });
    const res = await listProjectPools(client, USER_ID, [APP_ID]);
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(chain.in).toHaveBeenCalledWith("application_id", [APP_ID]);
    expect(res.pools).toEqual({ [APP_ID]: { application_id: APP_ID, status: "ready" } });
    expect(res.error).toBeNull();
  });

  it("returns an empty map for empty ids without querying with an empty in()", async () => {
    const { client, chain } = supabaseDouble();
    const res = await listProjectPools(client, USER_ID, []);
    expect(res.pools).toEqual({});
    expect(chain.in).not.toHaveBeenCalled();
  });
});
