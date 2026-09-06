// The falsifier for the digest storage layer. This module had NO test file at
// all until this change, and it is the one place in the feature where a field
// can be dropped without anything going red: `upsertDigest` builds an EXPLICIT
// `row` and copies across only the keys its whitelist names, so a field the
// route passes and the whitelist does not name is silently discarded — the
// route still returns 200, the digest still renders, and the column stays NULL
// forever. That is this repo's signature failure mode (an earlier design draft
// for this very feature wrote `row.citations` for a column named
// `citation_outcome`), and there is no runtime check anywhere that catches it.
//
// So every test below is about a key reaching, or not reaching, the row that
// goes to PostgREST. The unknown-field case is the positive control: it proves
// the whitelist is what let the known fields through, rather than the row being
// a pass-through of `fields`.
//
// THE UPSERT IS COLUMN-WISE, NOT ROW-WISE, whatever this module's own header
// comment used to claim. `.upsert(row, { onConflict })` sends only the keys
// present in `row`, so on the update branch an omitted column keeps its
// EXISTING value. That is what makes `researched_at`'s omission on the failure
// path a feature rather than an oversight, and it is asserted directly.

import { describe, it, expect, vi } from "vitest";
import { listDigests, upsertDigest } from "./applicationDigests.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-1";

// A Supabase double that records the arguments of every builder call. The
// digest table is queried two ways (select+eq+in, upsert+select+maybeSingle),
// so one chainable object serves both.
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

// The row object actually handed to PostgREST.
async function rowFrom(fields) {
  const { client, chain } = supabaseDouble();
  await upsertDigest(client, USER_ID, APP_ID, fields);
  expect(chain.upsert).toHaveBeenCalledTimes(1);
  return chain.upsert.mock.calls[0][0];
}

const OUTCOME = {
  version: 1,
  surface: "interactions",
  searched: true,
  counts: { annotations: 3, urlsUsable: 3, spansUsable: 2, splicesSafe: 2, placed: 2 },
  len: 42,
  hash: "abc123",
};

describe("upsertDigest — the citation_outcome whitelist", () => {
  it("carries a citation_outcome object through to the row", async () => {
    const row = await rowFrom({ status: "ready", citation_outcome: OUTCOME });
    expect(row.citation_outcome).toEqual(OUTCOME);
  });

  it("writes an EXPLICIT null, because null and absent mean different things", async () => {
    // `citation_outcome is null` is the only signal separating "this row was
    // written before the citation pipeline existed" from "the pipeline ran and
    // found nothing". The failure path carries the previous run's outcome
    // forward, which is `null` for a legacy row — and it has to be WRITTEN as
    // null rather than omitted, so the meaning travels with the markdown it
    // describes. `typeof null === "object"`, so a whitelist written with only
    // the typeof arm lets null through by accident and cannot say it meant to.
    const row = await rowFrom({ status: "failed", citation_outcome: null });
    expect(Object.prototype.hasOwnProperty.call(row, "citation_outcome")).toBe(true);
    expect(row.citation_outcome).toBe(null);
  });

  it("refuses a citation_outcome that is not an object, rather than storing a scalar", async () => {
    for (const bad of ["{}", 7, true, undefined]) {
      const row = await rowFrom({ status: "ready", citation_outcome: bad });
      expect(Object.prototype.hasOwnProperty.call(row, "citation_outcome")).toBe(false);
    }
  });

  it("[positive control] drops a field the whitelist does not name", async () => {
    // Without this the test above proves nothing: a `row` that simply spread
    // `fields` would satisfy it. This is what pins the whitelist as the reason
    // citation_outcome arrives.
    const row = await rowFrom({ status: "ready", citations: OUTCOME, citationOutcome: OUTCOME });
    expect(row.citations).toBeUndefined();
    expect(row.citationOutcome).toBeUndefined();
  });
});

describe("upsertDigest — researched_at is research recency, not row recency", () => {
  it("carries an ISO timestamp through to the row", async () => {
    const row = await rowFrom({ status: "ready", researched_at: "2026-09-05T18:04:11.219Z" });
    expect(row.researched_at).toBe("2026-09-05T18:04:11.219Z");
  });

  it("NEVER writes the key when it is absent, so an omitted write keeps the stored value", async () => {
    // The upsert is column-wise: an omitted key keeps its existing value on the
    // update branch. That is precisely how a failed run leaves the last
    // SUCCESSFUL research time standing instead of refreshing it.
    const row = await rowFrom({ status: "failed", markdown: "stale", error: "boom" });
    expect(Object.prototype.hasOwnProperty.call(row, "researched_at")).toBe(false);
  });

  it("refuses null and every non-string, because erasing research recency is never intended", async () => {
    for (const bad of [null, 0, Date.parse("2026-09-05"), new Date(), ""]) {
      const row = await rowFrom({ status: "failed", researched_at: bad });
      expect(Object.prototype.hasOwnProperty.call(row, "researched_at")).toBe(false);
    }
  });

  it("still stamps updated_at on every write, which keeps meaning `row last written`", async () => {
    // updated_at is NOT bent into a research timestamp — that is the whole
    // reason researched_at exists. Both paths stamp it.
    const ready = await rowFrom({ status: "ready", researched_at: "2026-09-05T18:04:11.219Z" });
    const failed = await rowFrom({ status: "failed" });
    expect(typeof ready.updated_at).toBe("string");
    expect(typeof failed.updated_at).toBe("string");
  });
});

describe("upsertDigest — the fields that already shipped", () => {
  it("keeps carrying markdown, status, error, sources and engine", async () => {
    const row = await rowFrom({
      markdown: "# hi",
      status: "ready",
      error: null,
      sources: [{ url: "https://example.com/a" }],
      engine: "gemini",
    });
    expect(row).toMatchObject({
      application_id: APP_ID,
      user_id: USER_ID,
      markdown: "# hi",
      status: "ready",
      error: null,
      sources: [{ url: "https://example.com/a" }],
      engine: "gemini",
    });
  });

  it("upserts on application_id", async () => {
    const { client, chain } = supabaseDouble();
    await upsertDigest(client, USER_ID, APP_ID, { status: "ready" });
    expect(chain.upsert.mock.calls[0][1]).toEqual({ onConflict: "application_id" });
  });

  it("returns the error rather than throwing", async () => {
    const { client } = supabaseDouble({ data: null, error: { message: "nope" } });
    await expect(upsertDigest(client, USER_ID, APP_ID, { status: "ready" })).resolves.toEqual({
      digest: null,
      error: "nope",
    });
  });
});

describe("listDigests — the tenant filter", () => {
  it("scopes the read to the caller's own user_id", async () => {
    // Deleting this filter leaves every route test green, which is why it is
    // asserted here rather than only there.
    const { client, chain } = supabaseDouble({ data: [{ application_id: APP_ID }] });
    await listDigests(client, USER_ID, [APP_ID]);
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(chain.in).toHaveBeenCalledWith("application_id", [APP_ID]);
  });

  it("selects every column, so a newly added one is picked up without a deploy order", async () => {
    const { client, chain } = supabaseDouble({ data: [{ application_id: APP_ID }] });
    await listDigests(client, USER_ID, [APP_ID]);
    expect(chain.select).toHaveBeenCalledWith("*");
  });

  it("keys the result by application_id and reports an error instead of throwing", async () => {
    const { client } = supabaseDouble({ data: [{ application_id: APP_ID, status: "ready" }] });
    await expect(listDigests(client, USER_ID, [APP_ID])).resolves.toEqual({
      digests: { [APP_ID]: { application_id: APP_ID, status: "ready" } },
      error: null,
    });
  });
});
