// R-339, R-357, R-371 (the lease half), AC-S4, AC-S5, AC-S7, AC-S9 -- the write
// path and the queries the worker runs.
//
// THE SHARED-ROW RULE. `position_glossaries` is keyed on `position_id` and
// `public.positions` has NO user_id, so a row here is readable by EVERY
// authenticated account in the product. No byte derived from a user's own
// private material may ever be written into it -- no resume text, no drafted
// answer, no note, no user id, no hover count. The sweep below is what enforces
// that mechanically, and it must not be described as more than it is: a module
// writing 120 attacker-authored definitions would pass it perfectly. The
// controls for THAT are the prompt fence, the render-as-text rule, and the
// positions-hardening migration that removes the write path altogether.
//
// A DENORMALISED COUNTER IS NOT A CONSTRAINT. The database CHECK for 'ready'
// constrains the terms ARRAY, not `recalled_count`, because a JS miscount writes
// status:'ready' AND recalled_count:0 together, from the same array, and a
// counter-only check passes while `terms` still holds recalled entries. This
// module's own validation is the first line; the CHECK is the last.

import { describe, it, expect, vi } from "vitest";
import {
  GLOSSARY_COLUMNS,
  PRIVATE_FIELD_NAMES,
  termRecordRejection,
  fitTermsToByteBudget,
  buildGlossaryRow,
  computeStatus,
  acquireGlossaryLease,
  releaseGlossaryLease,
  selectWorkQueue,
  readGlossaryForPosition,
} from "./glossaryStore.js";

const recalledTerm = (over = {}) => ({
  term: "idempotency",
  kind: "anticipated",
  category: "terminology",
  parent: "PostgreSQL",
  anchor_quote: "quote",
  definition: "A definition long enough to be plausible for the purposes of this test fixture.",
  provenance: "recalled",
  ...over,
});

const researchedTerm = (over = {}) =>
  recalledTerm({
    provenance: "researched",
    source_url: "https://en.wikipedia.org/wiki/Idempotence",
    source_host: "en.wikipedia.org",
    source_title: "Idempotence",
    ...over,
  });

describe("AC-S7: a term record cannot represent the confusing state (R-357)", () => {
  it("rejects a recalled term carrying any source field", () => {
    expect(termRecordRejection(recalledTerm({ source_url: "https://x.example/" }))).toBe("recalled-with-source");
    expect(termRecordRejection(recalledTerm({ source_host: "x.example" }))).toBe("recalled-with-source");
    expect(termRecordRejection(recalledTerm({ source_title: "T" }))).toBe("recalled-with-source");
  });

  it("rejects a researched term missing source_url or source_host", () => {
    expect(termRecordRejection(researchedTerm({ source_url: undefined }))).toBe("researched-without-source");
    expect(termRecordRejection(researchedTerm({ source_host: undefined }))).toBe("researched-without-source");
  });

  it("rejects any provenance other than the two", () => {
    expect(termRecordRejection(recalledTerm({ provenance: "pending" }))).toBe("bad-provenance");
    expect(termRecordRejection(recalledTerm({ provenance: null }))).toBe("bad-provenance");
    expect(termRecordRejection(recalledTerm({ provenance: undefined }))).toBe("bad-provenance");
  });

  it("rejects an anticipated term with no parent or no anchor quote", () => {
    expect(termRecordRejection(recalledTerm({ parent: undefined }))).toBe("anticipated-without-anchor");
    expect(termRecordRejection(recalledTerm({ anchor_quote: undefined }))).toBe("anticipated-without-anchor");
  });

  it("rejects an explicit term carrying an anchor, or missing its evidence", () => {
    expect(
      termRecordRejection({ ...recalledTerm(), kind: "explicit", evidence: "e", parent: "PostgreSQL" }),
    ).toBe("explicit-with-anchor");
    expect(
      termRecordRejection({
        term: "PostgreSQL",
        kind: "explicit",
        category: "tech",
        definition: recalledTerm().definition,
        provenance: "recalled",
      }),
    ).toBe("explicit-without-evidence");
  });

  it("positive controls: both well-formed variants are accepted", () => {
    expect(termRecordRejection(recalledTerm())).toBe(null);
    expect(termRecordRejection(researchedTerm())).toBe(null);
    expect(
      termRecordRejection({
        term: "PostgreSQL",
        kind: "explicit",
        category: "tech",
        evidence: "You will own our PostgreSQL estate.",
        definition: recalledTerm().definition,
        provenance: "recalled",
      }),
    ).toBe(null);
  });
});

describe("AC-S5: the byte budget is enforced in JS, before the write", () => {
  it("drops trailing anticipated terms until the array fits, and never an explicit one", () => {
    const explicit = Array.from({ length: 5 }, (_, i) => ({
      term: `explicit ${i}`,
      kind: "explicit",
      category: "tech",
      evidence: "e".repeat(200),
      definition: "d".repeat(280),
      provenance: "recalled",
    }));
    const anticipated = Array.from({ length: 700 }, (_, i) =>
      recalledTerm({ term: `anticipated ${i}`, definition: "d".repeat(280), anchor_quote: "q".repeat(160) }),
    );
    const out = fitTermsToByteBudget([...explicit, ...anticipated]);
    expect(Buffer.byteLength(JSON.stringify(out.terms), "utf8")).toBeLessThanOrEqual(262_144);
    expect(out.droppedCount).toBeGreaterThan(0);
    expect(out.truncatedReason).toBe("bytes");
    expect(out.terms.filter((t) => t.kind === "explicit")).toHaveLength(5);
  });

  it("leaves a small array untouched and reports no truncation", () => {
    const out = fitTermsToByteBudget([recalledTerm()]);
    expect(out.terms).toHaveLength(1);
    expect(out.droppedCount).toBe(0);
    expect(out.truncatedReason).toBe(null);
  });
});

describe("AC-S4 / R-339: the written row is an ALLOW-LIST, not a spread", () => {
  it("names every column exactly once and no user-private field at all", () => {
    expect(new Set(GLOSSARY_COLUMNS).size).toBe(GLOSSARY_COLUMNS.length);
    for (const forbidden of PRIVATE_FIELD_NAMES) {
      expect(GLOSSARY_COLUMNS.some((c) => c.includes(forbidden))).toBe(false);
    }
    expect(GLOSSARY_COLUMNS).not.toContain("user_id");
  });

  it("throws on a key that is not a column, rather than writing it", () => {
    // A key no column matches is this repo's signature silent drop, and nothing
    // at runtime catches it. A spread would carry it; an allow-list refuses.
    expect(() => buildGlossaryRow({ status: "partial", user_id: "u1" })).toThrow(/user_id/);
    expect(() => buildGlossaryRow({ status: "partial", citationOutcome: {} })).toThrow(/citationOutcome/);
  });

  it("keeps only the keys it was given, so an omitted column keeps its stored value", () => {
    const row = buildGlossaryRow({ status: "partial", researched_count: 3 });
    expect(Object.keys(row).sort()).toEqual(["researched_count", "status", "updated_at"]);
  });

  it("refuses a status outside the five, and refuses an absent one", () => {
    expect(() => buildGlossaryRow({ status: "queued" })).toThrow(/status/);
    expect(() => buildGlossaryRow({ status: null })).toThrow(/status/);
  });
});

describe("computeStatus (section 7.3)", () => {
  const base = { hasDescription: true, embedded: false, harvestFailed: false, termCount: 12 };
  it("returns unavailable for a posting with no description", () => {
    expect(computeStatus({ ...base, hasDescription: false })).toBe("unavailable");
  });
  it("returns quotes-only for the embedded engine", () => {
    expect(computeStatus({ ...base, embedded: true })).toBe("quotes-only");
  });
  it("returns failed when the harvest failed or nothing survived ingest", () => {
    expect(computeStatus({ ...base, harvestFailed: true })).toBe("failed");
    expect(computeStatus({ ...base, termCount: 0 })).toBe("failed");
  });
  it("returns ready ONLY when nothing is recalled AND the cursor is exhausted", () => {
    expect(computeStatus({ ...base, recalledCount: 0, researchCursor: 10, researchTotal: 10 })).toBe("ready");
    // The clause that makes `ready` mean finished: a row whose worker has not
    // finished is not ready even if every term it has processed was sourced.
    expect(computeStatus({ ...base, recalledCount: 0, researchCursor: 3, researchTotal: 10 })).toBe("partial");
    expect(computeStatus({ ...base, recalledCount: 4, researchCursor: 10, researchTotal: 10 })).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// The queries. A hand-rolled fake stands in for PostgREST, so these assert the
// FILTERS as well as the outcome -- a lease that forgot its `lease_until`
// predicate would still return a row and would still look green.
// ---------------------------------------------------------------------------
function fakeAdmin() {
  const calls = [];
  const chain = {
    update: vi.fn((v) => (calls.push(["update", v]), chain)),
    select: vi.fn((v) => (calls.push(["select", v]), chain)),
    eq: vi.fn((...a) => (calls.push(["eq", ...a]), chain)),
    lt: vi.fn((...a) => (calls.push(["lt", ...a]), chain)),
    or: vi.fn((...a) => (calls.push(["or", ...a]), chain)),
    order: vi.fn((...a) => (calls.push(["order", ...a]), chain)),
    limit: vi.fn((...a) => (calls.push(["limit", ...a]), chain)),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: undefined,
  };
  chain.result = { data: [], error: null };
  // PostgREST builders are thenable; awaiting one runs it.
  chain.then = (res, rej) => Promise.resolve(chain.result).then(res, rej);
  return { admin: { from: vi.fn(() => chain) }, chain, calls };
}

describe("the lease is the only concurrency control (AC-SCH4, R-371)", () => {
  it("filters on BOTH the row and an expired-or-null lease", async () => {
    const { admin, chain, calls } = fakeAdmin();
    chain.result = { data: [{ position_id: "p1" }], error: null };
    const got = await acquireGlossaryLease(admin, "p1", { leaseMs: 330_000, now: 1_000_000 });
    expect(got.row).toEqual({ position_id: "p1" });
    expect(calls.some(([m, a]) => m === "eq" && a === "position_id")).toBe(true);
    const orCall = calls.find(([m]) => m === "or");
    expect(orCall?.[1]).toContain("lease_until.is.null");
    expect(orCall?.[1]).toContain("lease_until.lt.");
  });

  it("returns no row when another invocation already holds the lease", async () => {
    const { admin, chain } = fakeAdmin();
    chain.result = { data: [], error: null };
    const got = await acquireGlossaryLease(admin, "p1", { leaseMs: 330_000, now: 1_000_000 });
    expect(got.row).toBe(null);
  });

  it("clears the lease on release", async () => {
    const { admin, chain, calls } = fakeAdmin();
    chain.result = { data: [{ position_id: "p1" }], error: null };
    await releaseGlossaryLease(admin, "p1");
    const update = calls.find(([m]) => m === "update");
    expect(update?.[1]).toHaveProperty("lease_until", null);
  });
});

describe("the work queue is a query, not a table (AC-SCH6, AC-L4a)", () => {
  it("selects only rows whose research is PENDING, oldest first, under both call caps", async () => {
    const { admin, chain, calls } = fakeAdmin();
    chain.result = { data: [{ position_id: "p1" }], error: null };
    await selectWorkQueue(admin, { limit: 20, now: 1_000_000 });
    // A completed row must never be selectable -- a worker that quietly
    // re-researched finished rows would turn the monthly bill into a
    // subscription, and it is exactly the change someone would make to "keep
    // sources fresh".
    expect(calls.some(([m, a, b]) => m === "eq" && a === "research_pending" && b === true)).toBe(true);
    expect(calls.some(([m, a]) => m === "order" && a === "queued_at")).toBe(true);
    expect(calls.some(([m, a]) => m === "limit" && a === 20)).toBe(true);
    // Both spend ceilings are in the QUERY, not only in the loop: a row already
    // at either cap must never be selected, leased and then discovered to be
    // ineligible, because the lease alone is a write.
    expect(calls.some(([m, a, b]) => m === "lt" && a === "model_calls_fingerprint" && b === 42)).toBe(true);
    expect(calls.some(([m, a, b]) => m === "lt" && a === "model_calls_total" && b === 126)).toBe(true);
  });
});

describe("readGlossaryForPosition", () => {
  it("distinguishes a failed read from a missing row", async () => {
    // A FAILED CACHE READ IS NOT A CACHE MISS. Reading only `data` made the two
    // indistinguishable, and the consequence is a full billed generation on a
    // row that already had one, on every load until the read recovers.
    const { admin, chain } = fakeAdmin();
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const failed = await readGlossaryForPosition(admin, "p1");
    expect(failed.error).toBeTruthy();
    expect(failed.row).toBe(null);

    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const missing = await readGlossaryForPosition(admin, "p1");
    expect(missing.error).toBe(null);
    expect(missing.row).toBe(null);
  });
});
