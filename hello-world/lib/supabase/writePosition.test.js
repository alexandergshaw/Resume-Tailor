import { describe, it, expect } from "vitest";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";
import { writePositionMerged, editPositionFields } from "./writePosition.js";

// The read-merge-write that replaces `.upsert(fullRow, { onConflict })`.
// `makeStatefulSupabase` is the right harness here precisely because it models
// PostgREST's merge-duplicates semantics honestly (its note [5]): the old
// upsert really did overwrite every payload column, explicit nulls included,
// so a test written against it would have gone red on the old code for the
// right reason.

// See positionMerge.test.js for why these are short: the merge turns on the
// relation, not on the exact 400/N magnitudes.
const TRUNCATION = "Responsibilities: ship things, own the roadmap, and…";
const FULL =
  "Responsibilities: ship things, own the roadmap, and partner with design. " +
  "Requirements: 5+ years. Benefits: dental, 401k, remote-first. Apply by Friday.";

const row = (over = {}) => ({
  external_id: "url-https://acme.example/jobs/1",
  source: "jsearch",
  title: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  is_remote: true,
  employment_type: "FULLTIME",
  description: FULL,
  url: "https://acme.example/jobs/1",
  salary_min: null,
  salary_max: null,
  posted_at: null,
  raw_data: { id: "url-https://acme.example/jobs/1" },
  ...over,
});

function writesTo(sb, table = "positions") {
  return sb.calls.filter((c) => c.table === table && c.verb !== "select");
}

describe("writePositionMerged — first write", () => {
  it("inserts when no row holds that external_id, and returns its id", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    const res = await writePositionMerged(sb, row());
    expect(res.error).toBeNull();
    expect(res.id).toBeTruthy();
    const stored = sb.rows("positions");
    expect(stored).toHaveLength(1);
    expect(stored[0].company).toBe("Acme");
    expect(stored[0].description).toBe(FULL);
  });

  it("refuses a row with no external_id, and writes nothing", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    const res = await writePositionMerged(sb, row({ external_id: null }));
    expect(res.id).toBeNull();
    expect(res.error).toBeTruthy();
    expect(writesTo(sb)).toHaveLength(0);
  });
});

describe("writePositionMerged — the cross-account write this exists to stop", () => {
  it("a second write with an empty company does NOT blank the stored one", async () => {
    // The headline case. Account A tailored the posting and the engine
    // resolved "Acme". Account B tailors the same URL — same external_id, see
    // app/page.js:2371 — and its run resolves no company, so app/page.js:2438
    // hands over `company: ""`.
    const sb = makeStatefulSupabase({ positions: [] });
    await writePositionMerged(sb, row());

    const res = await writePositionMerged(sb, row({ company: "", url: "", title: "" }));
    expect(res.error).toBeNull();

    const stored = sb.rows("positions")[0];
    expect(stored.company).toBe("Acme");
    expect(stored.url).toBe("https://acme.example/jobs/1");
    expect(stored.title).toBe("Senior Engineer");
  });

  it("a second write with null everywhere does NOT null the stored row", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await writePositionMerged(sb, row());
    await writePositionMerged(
      sb,
      row({
        title: null, company: null, location: null, is_remote: null,
        employment_type: null, description: null, url: null, raw_data: null,
      }),
    );
    const stored = sb.rows("positions")[0];
    expect(stored.company).toBe("Acme");
    expect(stored.description).toBe(FULL);
    expect(stored.location).toBe("Remote");
    expect(stored.employment_type).toBe("FULLTIME");
    expect(stored.is_remote).toBe(true);
  });

  it("does not let another account's differing company replace the stored one", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await writePositionMerged(sb, row());
    await writePositionMerged(sb, row({ company: "Acme Holdings LLC" }));
    expect(sb.rows("positions")[0].company).toBe("Acme");
  });

  it("issues a PATCH, not a full-row overwrite — the statement names only what changed", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await writePositionMerged(sb, row({ description: TRUNCATION, salary_min: null }));
    sb.calls.length = 0;

    await writePositionMerged(sb, row({ description: FULL, salary_min: 150000 }));

    const updates = sb.calls.filter((c) => c.table === "positions" && c.verb === "update");
    expect(updates).toHaveLength(1);
    // If the payload carried every column, an unrelated concurrent change to
    // one of them would still be clobbered — so this is the assertion that
    // makes the merge real rather than cosmetic.
    expect(Object.keys(updates[0].payload).sort()).toEqual(["description", "salary_min"]);
  });

  it("issues NO write at all when the merge changes nothing", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await writePositionMerged(sb, row());
    sb.calls.length = 0;
    const res = await writePositionMerged(sb, row());
    expect(res.error).toBeNull();
    expect(res.id).toBeTruthy();
    expect(writesTo(sb)).toHaveLength(0);
  });
});

describe("writePositionMerged — the description must be able to grow", () => {
  it("replaces a row written before commit aa98b17 with the full text", async () => {
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: row().external_id, company: "Acme", description: TRUNCATION }],
    });
    const res = await writePositionMerged(sb, row({ description: FULL }));
    expect(res.id).toBe("pos-1");
    expect(sb.rows("positions")[0].description).toBe(FULL);
  });

  it("does not let a later truncation overwrite the stored full text", async () => {
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: row().external_id, company: "Acme", description: FULL }],
    });
    await writePositionMerged(sb, row({ description: TRUNCATION }));
    expect(sb.rows("positions")[0].description).toBe(FULL);
  });

  it("updates the row in place — it never creates a second row for the same external_id", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await writePositionMerged(sb, row({ description: TRUNCATION }));
    await writePositionMerged(sb, row({ description: FULL }));
    await writePositionMerged(sb, row({ company: "" }));
    expect(sb.rows("positions")).toHaveLength(1);
  });
});

describe("writePositionMerged — errors surface rather than being guessed at", () => {
  it("returns the lookup error and writes nothing", async () => {
    const sb = makeStatefulSupabase({ positions: [] }, { errors: { positions: { select: { message: "boom" } } } });
    const res = await writePositionMerged(sb, row());
    expect(res.id).toBeNull();
    expect(res.error?.message).toBe("boom");
    expect(writesTo(sb)).toHaveLength(0);
  });

  it("returns the update error", async () => {
    const sb = makeStatefulSupabase(
      { positions: [{ id: "pos-1", external_id: row().external_id }] },
      { errors: { positions: { update: { message: "denied" } } } },
    );
    const res = await writePositionMerged(sb, row());
    expect(res.id).toBeNull();
    expect(res.error?.message).toBe("denied");
  });

  it("recovers from a lost insert race by re-reading and merging", async () => {
    // Two requests both see no row and both insert; Postgres rejects the
    // loser with 23505. A bare throw there would fail a tailor run for a
    // posting that now exists, so the loser re-reads and merges instead.
    let selects = 0;
    const existing = { id: "pos-race", external_id: row().external_id, company: "Acme", description: TRUNCATION };
    const patches = [];
    const client = {
      from: () => {
        const state = { verb: "select", payload: null };
        const b = {
          select: () => b,
          insert: (p) => { state.verb = "insert"; state.payload = p; return b; },
          update: (p) => { state.verb = "update"; state.payload = p; return b; },
          eq: () => b,
          single: async () => resolve(),
          maybeSingle: async () => resolve(),
          then: (r, j) => Promise.resolve(resolve()).then(r, j),
        };
        function resolve() {
          if (state.verb === "select") {
            selects += 1;
            return { data: selects === 1 ? null : existing, error: null };
          }
          if (state.verb === "insert") {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          patches.push(state.payload);
          return { data: null, error: null };
        }
        return b;
      },
    };

    const res = await writePositionMerged(client, row({ description: FULL }));
    expect(res.error).toBeNull();
    expect(res.id).toBe("pos-race");
    expect(patches).toHaveLength(1);
    expect(patches[0].description).toBe(FULL);
  });
});

describe("editPositionFields — the explicit user edit", () => {
  it("applies the user's typed values", async () => {
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: "manual-1", company: "Acme", title: "Eng", description: "old" }],
    });
    const res = await editPositionFields(sb, "pos-1", { company: "Acme Corp", title: "Senior Eng", description: "new" });
    expect(res.error).toBeNull();
    const stored = sb.rows("positions")[0];
    expect(stored.company).toBe("Acme Corp");
    expect(stored.title).toBe("Senior Eng");
    expect(stored.description).toBe("new");
  });

  it("does not blank a stored value from an empty box", async () => {
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: "manual-1", company: "Acme", title: "Eng", description: "kept" }],
    });
    await editPositionFields(sb, "pos-1", { company: "", title: null, description: "  " });
    const stored = sb.rows("positions")[0];
    expect(stored.company).toBe("Acme");
    expect(stored.title).toBe("Eng");
    expect(stored.description).toBe("kept");
  });

  it("issues no write when every box was empty", async () => {
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: "manual-1", company: "Acme" }],
    });
    sb.calls.length = 0;
    const res = await editPositionFields(sb, "pos-1", { company: "", title: "", description: "" });
    expect(res.error).toBeNull();
    expect(writesTo(sb)).toHaveLength(0);
  });

  it("returns an error rather than writing when the row does not exist", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    const res = await editPositionFields(sb, "pos-missing", { company: "Acme" });
    expect(res.error).toBeTruthy();
    expect(writesTo(sb)).toHaveLength(0);
  });

  it("writes only title/company/description, whatever else the caller passes", async () => {
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: "manual-1", company: "Acme" }],
    });
    await editPositionFields(sb, "pos-1", {
      company: "Acme Corp",
      external_id: "gh-hijack",
      url: "https://evil.example",
      source: "greenhouse",
    });
    const stored = sb.rows("positions")[0];
    expect(stored.external_id).toBe("manual-1");
    expect(stored.url).toBeUndefined();
    expect(stored.source).toBeUndefined();
  });
});
