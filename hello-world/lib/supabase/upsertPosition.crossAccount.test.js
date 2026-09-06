import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeStatefulSupabase } from "../../test/helpers/supabaseFake.js";
import { upsertPosition } from "./upsertPosition.js";

// ---------------------------------------------------------------------------
// The confirmed cross-account write, expressed against the PUBLIC entry point
// every browser caller uses, with a Supabase fake that models PostgREST's
// merge-duplicates semantics honestly (test/helpers/supabaseFake.js note [5]:
// "columns present in the payload are overwritten unconditionally — including
// with an explicit null").
//
// These run in the `node` environment, i.e. `typeof window === "undefined"`,
// so they exercise the server-side branch and keep asserting the merge after
// the browser branch moved behind /api/positions.
//
// Two accounts collide on one row by construction: app/page.js:2371 builds the
// external id as `url-${trimmedUrl}`, and `positions` has no user_id column
// (supabase/migrations/20260901000000_drive.sql:28).
// ---------------------------------------------------------------------------

const EXTERNAL_ID = "url-https://acme.example/jobs/1";
// See positionMerge.test.js for why these are short: the merge turns on the
// relation, not on the exact 400/N magnitudes. The real ones are exercised by
// the "at production magnitudes" test at the bottom of this file.
const TRUNCATION = "Responsibilities: ship things, own the roadmap, and…";
const FULL =
  "Responsibilities: ship things, own the roadmap, and partner with design. " +
  "Requirements: 5+ years. Benefits: dental, 401k, remote-first. Apply by Friday.";

const job = (over = {}) => ({
  id: EXTERNAL_ID,
  title: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  isRemote: true,
  employmentType: "FULLTIME",
  description: FULL,
  url: "https://acme.example/jobs/1",
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsertPosition — one account must not destroy another's row", () => {
  it("does not blank company/url/title when a later run resolved none", async () => {
    // Account A tailors the posting; the engine resolves "Acme".
    const sb = makeStatefulSupabase({ positions: [] });
    const first = await upsertPosition(sb, job());
    expect(first).toBeTruthy();

    // Account B tailors the SAME url. app/page.js:2438 writes
    // `company: nextCompany`, which is "" when that run resolved no company.
    await upsertPosition(sb, job({ company: "", url: "", title: "" }));

    const stored = sb.rows("positions")[0];
    expect(stored.company).toBe("Acme");
    expect(stored.url).toBe("https://acme.example/jobs/1");
    expect(stored.title).toBe("Senior Engineer");
  });

  it("does not null the row when a later run carries no optional fields at all", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await upsertPosition(sb, job());

    // useApplicationDialogs.js:532's manual-add shape: id/title/company only.
    await upsertPosition(sb, { id: EXTERNAL_ID, title: "Senior Engineer", company: "Acme" });

    const stored = sb.rows("positions")[0];
    expect(stored.description).toBe(FULL);
    expect(stored.location).toBe("Remote");
    expect(stored.employment_type).toBe("FULLTIME");
  });

  it("does not let a differing company from another account replace the stored one", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await upsertPosition(sb, job());
    await upsertPosition(sb, job({ company: "Acme Holdings LLC" }));
    expect(sb.rows("positions")[0].company).toBe("Acme");
  });
});

describe("upsertPosition — the truncation fix must keep working", () => {
  it("lets the full description replace a row stored before commit aa98b17", async () => {
    // A naive fill-empty-only merge would freeze every pre-aa98b17 row at 400
    // characters, which is the exact regression that fix exists to prevent.
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: EXTERNAL_ID, company: "Acme", description: TRUNCATION }],
    });

    const id = await upsertPosition(sb, job({ description: FULL }));

    expect(id).toBe("pos-1");
    expect(sb.rows("positions")[0].description).toBe(FULL);
  });

  it("does not let a later truncation overwrite the stored full text", async () => {
    // app/page.js:2683 still writes the truncation when the full-text lookup
    // AND the server's own scrape both come back empty, so both arrival
    // orders really happen.
    const sb = makeStatefulSupabase({ positions: [] });
    await upsertPosition(sb, job({ description: FULL }));
    await upsertPosition(sb, job({ description: TRUNCATION }));
    expect(sb.rows("positions")[0].description).toBe(FULL);
  });

  it("does the same at production magnitudes — snippetFrom's 400-char cut vs a whole posting", async () => {
    // Asserted by length so a failure prints a number, not four kilobytes.
    const realTruncation = `${"x".repeat(399)}…`;
    const realFull = "y".repeat(4000);
    const sb = makeStatefulSupabase({
      positions: [{ id: "pos-1", external_id: EXTERNAL_ID, company: "Acme", description: realTruncation }],
    });

    await upsertPosition(sb, job({ description: realFull }));
    expect(sb.rows("positions")[0].description).toHaveLength(4000);

    await upsertPosition(sb, job({ description: realTruncation }));
    expect(sb.rows("positions")[0].description).toHaveLength(4000);
  });

  it("keeps exactly one row per external_id across every one of those writes", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await upsertPosition(sb, job({ description: TRUNCATION }));
    await upsertPosition(sb, job({ description: FULL }));
    await upsertPosition(sb, job({ company: "" }));
    expect(sb.rows("positions")).toHaveLength(1);
  });
});

describe("upsertPosition — unchanged contract", () => {
  it("still returns null for a job with no id, without writing", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    expect(await upsertPosition(sb, null)).toBeNull();
    expect(await upsertPosition(sb, {})).toBeNull();
    expect(sb.rows("positions")).toHaveLength(0);
  });

  it("still infers source from the id prefix", async () => {
    const sb = makeStatefulSupabase({ positions: [] });
    await upsertPosition(sb, { id: "gh-1", title: "A" });
    await upsertPosition(sb, { id: "JSEARCH-2", title: "B" });
    expect(sb.row("positions", (r) => r.external_id === "gh-1").source).toBe("greenhouse");
    expect(sb.row("positions", (r) => r.external_id === "JSEARCH-2").source).toBe("jsearch");
  });

  it("still returns null rather than throwing when the write fails", async () => {
    const sb = makeStatefulSupabase(
      { positions: [] },
      { errors: { positions: { insert: { message: "boom" }, upsert: { message: "boom" } } } },
    );
    await expect(upsertPosition(sb, job())).resolves.toBeNull();
  });
});
