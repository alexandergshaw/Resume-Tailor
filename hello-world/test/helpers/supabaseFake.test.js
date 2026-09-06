import { describe, it, expect } from "vitest";
import { makeStatefulSupabase, parseInList } from "./supabaseFake.js";

// The fake's own suite. Every operator here is asserted against what PostgREST
// / PostgreSQL actually do, with the non-obvious cases carrying the citation
// that justifies them (see the numbered notes in supabaseFake.js).
//
// Two of these are `[canary]`s in the strict sense: they are the tests that a
// call-recording mock (`.eq()` that does not filter) or a naive upsert
// (replace instead of merge) FAILS. If this file is ever green against such an
// implementation, the file is broken, not the implementation.

const T_JUNE = "2026-06-01T09:15:00.000Z";
const T_JULY = "2026-07-04T12:00:00.000Z";

function appsFake(rows) {
  return makeStatefulSupabase({ applications: rows });
}

describe("supabaseFake — .eq()", () => {
  it("[canary] filters: a non-matching row is not returned", async () => {
    // A call-recording mock returns BOTH rows here, because its .eq() is a
    // no-op that resolves to a canned result. That is the whole difference.
    const sb = appsFake([
      { id: "a1", user_id: "u1", status: "applied" },
      { id: "a2", user_id: "u2", status: "applied" },
    ]);
    const { data } = await sb.from("applications").select("*").eq("user_id", "u1");
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("a1");
  });

  it("compares scalars as text, the way a PostgREST query string does", async () => {
    const sb = makeStatefulSupabase({ positions: [{ id: 7, external_id: "gh-1" }] });
    const { data } = await sb.from("positions").select("id").eq("id", "7");
    expect(data).toEqual([{ id: 7 }]);
  });

  it("does not match a NULL column (SQL `=` is null-propagating)", async () => {
    const sb = appsFake([{ id: "a1", status: null }]);
    const { data } = await sb.from("applications").select("*").eq("status", "applied");
    expect(data).toEqual([]);
  });

  it("treats an absent column as NULL, not undefined-equals-undefined", async () => {
    const sb = appsFake([{ id: "a1" }]);
    const { data } = await sb.from("applications").select("*").eq("status", "applied");
    expect(data).toEqual([]);
  });
});

describe("supabaseFake — .neq()", () => {
  it("excludes rows whose value matches", async () => {
    const sb = appsFake([
      { id: "a1", status: "tracking" },
      { id: "a2", status: "applied" },
    ]);
    const { data } = await sb.from("applications").select("id").neq("status", "tracking");
    expect(data).toEqual([{ id: "a2" }]);
  });

  it("[3] also excludes a NULL row — `<>` is null-propagating, which is why PostgREST needed a separate `isdistinct`", async () => {
    // https://postgrest.org/en/stable/references/api/tables_views.html —
    // "isdistinct: not equal, treating NULL as a comparable value".
    const sb = appsFake([{ id: "a1", status: null }]);
    const { data } = await sb.from("applications").select("id").neq("status", "tracking");
    expect(data).toEqual([]);
  });
});

describe("supabaseFake — .in() and .is()", () => {
  it("matches membership", async () => {
    const sb = appsFake([
      { id: "a1", status: "applied" },
      { id: "a2", status: "tracking" },
      { id: "a3", status: "offer" },
    ]);
    const { data } = await sb.from("applications").select("id").in("status", ["applied", "offer"]);
    expect(data.map((r) => r.id)).toEqual(["a1", "a3"]);
  });

  it("[1] does not match a NULL row — `NULL IN (...)` is NULL, not false", async () => {
    const sb = appsFake([{ id: "a1", status: null }]);
    const { data } = await sb.from("applications").select("id").in("status", ["applied"]);
    expect(data).toEqual([]);
  });

  it(".is(col, 'null') is two-valued and DOES match a NULL row", async () => {
    const sb = appsFake([
      { id: "a1", status: null },
      { id: "a2", status: "applied" },
    ]);
    const { data } = await sb.from("applications").select("id").is("status", "null");
    expect(data).toEqual([{ id: "a1" }]);
  });
});

describe("supabaseFake — .not(col, 'in', '(…)')", () => {
  // This is the sharpest operator in the fake: `app/page.js`'s status guard is
  // built on it, so a wrong implementation here would make a dead guard look
  // alive. Every branch is asserted.

  const ROWS = [
    { id: "a1", status: "tracking" },
    { id: "a2", status: "applied" },
    { id: "a3", status: "phone_screen" },
    { id: "a4", status: null },
  ];

  it("keeps rows whose value is outside the list", async () => {
    const sb = appsFake(ROWS);
    const { data } = await sb
      .from("applications")
      .select("id")
      .not("status", "in", "(applied,interviewing,offer,rejected,withdrawn)");
    expect(data.map((r) => r.id)).toContain("a1");
    expect(data.map((r) => r.id)).toContain("a3");
  });

  it("drops rows whose value is inside the list", async () => {
    const sb = appsFake(ROWS);
    const { data } = await sb
      .from("applications")
      .select("id")
      .not("status", "in", "(applied,interviewing,offer,rejected,withdrawn)");
    expect(data.map((r) => r.id)).not.toContain("a2");
  });

  it("[1][canary] drops a NULL-status row — `NOT (NULL IN (...))` is NULL, not TRUE", async () => {
    // PostgreSQL, "Row and Array Comparisons": "if the left-hand expression
    // yields null ... the result of the NOT IN construct will be null, not
    // true as one might naively expect."
    // https://www.postgresql.org/docs/current/functions-comparisons.html
    //
    // A naive `!list.includes(value)` implementation returns TRUE here and
    // this test fails. That matters beyond the fake: the comment at
    // app/page.js:2325-2329 claims the NOT-IN filter promotes "any
    // unexpected/stale value — including NULL". It does not.
    const sb = appsFake(ROWS);
    const { data } = await sb
      .from("applications")
      .select("id")
      .not("status", "in", "(applied,interviewing,offer,rejected,withdrawn)");
    expect(data.map((r) => r.id)).not.toContain("a4");
  });

  it("negates .eq with the same null propagation", async () => {
    const sb = appsFake([
      { id: "a1", status: "applied" },
      { id: "a2", status: "tracking" },
      { id: "a3", status: null },
    ]);
    const { data } = await sb.from("applications").select("id").not("status", "eq", "applied");
    expect(data.map((r) => r.id)).toEqual(["a2"]);
  });

  it("negates .is('null') definitely — NOT of a definite boolean stays definite", async () => {
    const sb = appsFake([
      { id: "a1", status: null },
      { id: "a2", status: "applied" },
    ]);
    const { data } = await sb.from("applications").select("id").not("status", "is", "null");
    expect(data).toEqual([{ id: "a2" }]);
  });

  it("rejects a value that is not a PostgREST list literal rather than guessing", async () => {
    const sb = appsFake(ROWS);
    await expect(
      sb.from("applications").select("id").not("status", "in", "applied,offer"),
    ).rejects.toThrow(/list literal/);
  });
});

describe("supabaseFake — parseInList", () => {
  it("splits a plain list", () => {
    expect(parseInList("(applied,interviewing,offer)")).toEqual(["applied", "interviewing", "offer"]);
  });

  it('honours the quoted form the PostgREST docs show: ?a=in.("hi,there","yes,you")', () => {
    expect(parseInList('("hi,there","yes,you")')).toEqual(["hi,there", "yes,you"]);
  });

  it("returns an empty list for ()", () => {
    expect(parseInList("()")).toEqual([]);
  });
});

describe("supabaseFake — .order()", () => {
  const ROWS = [
    { id: "a1", applied_at: T_JUNE },
    { id: "a2", applied_at: null },
    { id: "a3", applied_at: T_JULY },
  ];

  it("[4] descending defaults to NULLS FIRST", async () => {
    // PostgreSQL, "Sorting Rows": "NULLS FIRST is the default for DESC order,
    // and NULLS LAST otherwise."
    // https://www.postgresql.org/docs/current/queries-order.html
    // postgrest-js emits no nullsfirst/nullslast token when nullsFirst is
    // undefined, so the server-side default is what applies. This is exactly
    // the shape loadApplications uses: .order("applied_at", { ascending: false }).
    const sb = appsFake(ROWS);
    const { data } = await sb.from("applications").select("id").order("applied_at", { ascending: false });
    expect(data.map((r) => r.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("[4] ascending defaults to NULLS LAST", async () => {
    const sb = appsFake(ROWS);
    const { data } = await sb.from("applications").select("id").order("applied_at", { ascending: true });
    expect(data.map((r) => r.id)).toEqual(["a1", "a3", "a2"]);
  });

  it("ascending is the default direction when options are omitted", async () => {
    const sb = appsFake(ROWS);
    const { data } = await sb.from("applications").select("id").order("applied_at");
    expect(data.map((r) => r.id)).toEqual(["a1", "a3", "a2"]);
  });

  it("an explicit nullsFirst:false overrides the DESC default", async () => {
    const sb = appsFake(ROWS);
    const { data } = await sb
      .from("applications")
      .select("id")
      .order("applied_at", { ascending: false, nullsFirst: false });
    expect(data.map((r) => r.id)).toEqual(["a3", "a1", "a2"]);
  });

  it("an explicit nullsFirst:true overrides the ASC default", async () => {
    const sb = appsFake(ROWS);
    const { data } = await sb
      .from("applications")
      .select("id")
      .order("applied_at", { ascending: true, nullsFirst: true });
    expect(data.map((r) => r.id)).toEqual(["a2", "a1", "a3"]);
  });

  it("chains multiple .order() calls left-to-right", async () => {
    const sb = appsFake([
      { id: "a1", status: "applied", applied_at: T_JULY },
      { id: "a2", status: "applied", applied_at: T_JUNE },
      { id: "a3", status: "offer", applied_at: T_JULY },
    ]);
    const { data } = await sb
      .from("applications")
      .select("id")
      .order("status", { ascending: true })
      .order("applied_at", { ascending: true });
    expect(data.map((r) => r.id)).toEqual(["a2", "a1", "a3"]);
  });
});

describe("supabaseFake — .limit(), .single(), .maybeSingle()", () => {
  it("limit truncates after filtering and ordering", async () => {
    const sb = appsFake([
      { id: "a1", user_id: "u1", applied_at: T_JUNE },
      { id: "a2", user_id: "u1", applied_at: T_JULY },
      { id: "a3", user_id: "u2", applied_at: T_JULY },
    ]);
    const { data } = await sb
      .from("applications")
      .select("id")
      .eq("user_id", "u1")
      .order("applied_at", { ascending: false })
      .limit(1);
    expect(data).toEqual([{ id: "a2" }]);
  });

  it("single() returns the row when exactly one matches", async () => {
    const sb = appsFake([{ id: "a1", status: "applied" }]);
    const { data, error } = await sb.from("applications").select("id").eq("id", "a1").single();
    expect(error).toBeNull();
    expect(data).toEqual({ id: "a1" });
  });

  it("[6] single() errors with PGRST116 on zero rows", async () => {
    const sb = appsFake([]);
    const { data, error } = await sb.from("applications").select("id").eq("id", "nope").single();
    expect(data).toBeNull();
    expect(error.code).toBe("PGRST116");
  });

  it("[6] single() errors with PGRST116 on more than one row", async () => {
    const sb = appsFake([
      { id: "a1", user_id: "u1" },
      { id: "a2", user_id: "u1" },
    ]);
    const { error } = await sb.from("applications").select("id").eq("user_id", "u1").single();
    expect(error.code).toBe("PGRST116");
  });

  it("[6] maybeSingle() returns null data and no error on zero rows", async () => {
    const sb = appsFake([]);
    const { data, error } = await sb.from("applications").select("id").eq("id", "nope").maybeSingle();
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it("[6] maybeSingle() still errors on more than one row", async () => {
    const sb = appsFake([
      { id: "a1", user_id: "u1" },
      { id: "a2", user_id: "u1" },
    ]);
    const { error } = await sb.from("applications").select("id").eq("user_id", "u1").maybeSingle();
    expect(error.code).toBe("PGRST116");
  });
});

describe("supabaseFake — .insert()", () => {
  it("stores the row and returns it through .select().single()", async () => {
    const sb = appsFake([]);
    const { data } = await sb
      .from("applications")
      .insert({ user_id: "u1", position_id: "p1", status: "tracking" })
      .select("id, status")
      .single();
    expect(data.status).toBe("tracking");
    expect(sb.rows("applications")).toHaveLength(1);
    expect(sb.rows("applications")[0].user_id).toBe("u1");
  });

  it("returns null data when .select() was not chained (PostgREST returns no content)", async () => {
    const sb = appsFake([]);
    const { data, error } = await sb.from("applications").insert({ user_id: "u1" });
    expect(error).toBeNull();
    expect(data).toBeNull();
    expect(sb.rows("applications")).toHaveLength(1);
  });
});

describe("supabaseFake — .upsert() with onConflict", () => {
  it("[canary] MERGES on conflict: a column absent from the payload survives", async () => {
    // [5] Prefer: resolution=merge-duplicates renders as
    // ON CONFLICT (cols) DO UPDATE SET <payload columns> = excluded.<col>.
    // A fake that REPLACES the row instead of merging drops tracked_at and
    // fails right here — which is what makes this the fake's own canary.
    const sb = appsFake([
      {
        id: "a1",
        user_id: "u1",
        position_id: "p1",
        status: "applied",
        applied_at: T_JUNE,
        tracked_at: "2026-05-01T00:00:00.000Z",
        notes: "phone screen Tuesday",
      },
    ]);
    await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p1", status: "tailored", applied_at: null },
        { onConflict: "user_id,position_id" },
      )
      .select("id")
      .single();

    const row = sb.rows("applications")[0];
    expect(sb.rows("applications")).toHaveLength(1);
    expect(row.id).toBe("a1");
    expect(row.tracked_at).toBe("2026-05-01T00:00:00.000Z");
    expect(row.notes).toBe("phone screen Tuesday");
  });

  it("overwrites every column the payload names, including with an explicit null", async () => {
    const sb = appsFake([
      { id: "a1", user_id: "u1", position_id: "p1", status: "applied", applied_at: T_JUNE },
    ]);
    await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p1", status: "tracking", applied_at: null },
        { onConflict: "user_id,position_id" },
      );
    expect(sb.rows("applications")[0]).toMatchObject({ status: "tracking", applied_at: null });
  });

  it("inserts when no row matches the conflict target", async () => {
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }]);
    await sb
      .from("applications")
      .upsert({ user_id: "u1", position_id: "p2", status: "tracking" }, { onConflict: "user_id,position_id" });
    expect(sb.rows("applications")).toHaveLength(2);
  });

  it("matches on the FULL composite key, not the first column", async () => {
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }]);
    await sb
      .from("applications")
      .upsert({ user_id: "u1", position_id: "p9", status: "tracking" }, { onConflict: "user_id,position_id" });
    expect(sb.rows("applications").map((r) => r.status).sort()).toEqual(["applied", "tracking"]);
  });

  it("falls back to the declared primary key when onConflict is omitted", async () => {
    const sb = makeStatefulSupabase(
      { positions: [{ id: "p1", external_id: "gh-1", title: "old" }] },
      { primaryKeys: { positions: ["external_id"] } },
    );
    await sb.from("positions").upsert({ external_id: "gh-1", title: "new" });
    expect(sb.rows("positions")).toHaveLength(1);
    expect(sb.rows("positions")[0].title).toBe("new");
  });

  it("ignoreDuplicates leaves the existing row untouched", async () => {
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }]);
    await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p1", status: "tracking" },
        { onConflict: "user_id,position_id", ignoreDuplicates: true },
      );
    expect(sb.rows("applications")[0].status).toBe("applied");
  });

  it("[canary] ignoreDuplicates returns NO row for a conflicting insert, the way DO NOTHING … RETURNING does", async () => {
    // `INSERT … ON CONFLICT DO NOTHING RETURNING` returns only the rows it
    // actually inserted. The fake used to return the pre-existing row here,
    // which made `.select().single()` on such an upsert look like "the row I
    // just wrote" — green here, PGRST116 in production. A fake that hands the
    // existing row back fails this test.
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }]);
    const { data, error } = await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p1", status: "tracking" },
        { onConflict: "user_id,position_id", ignoreDuplicates: true },
      )
      .select("id, status");

    expect(error).toBeNull();
    expect(data).toEqual([]);
    // Positive control on the same semantic: the row itself is still untouched,
    // so "returns nothing" is about the RETURNING projection and not about the
    // conflict branch having stopped running.
    expect(sb.rows("applications")).toHaveLength(1);
    expect(sb.rows("applications")[0].status).toBe("applied");
  });

  it("[control] ignoreDuplicates still returns the row when there is NO conflict", async () => {
    // The paired direction. Without this, "returns no row" would also be
    // satisfied by a fake whose ignoreDuplicates upsert returns nothing ever.
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }]);
    const { data, error } = await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p2", status: "tracking" },
        { onConflict: "user_id,position_id", ignoreDuplicates: true },
      )
      .select("position_id, status");

    expect(error).toBeNull();
    expect(data).toEqual([{ position_id: "p2", status: "tracking" }]);
  });

  it("handles a bulk (array) payload", async () => {
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }]);
    await sb
      .from("applications")
      .upsert(
        [
          { user_id: "u1", position_id: "p1", status: "offer" },
          { user_id: "u1", position_id: "p2", status: "tracking" },
        ],
        { onConflict: "user_id,position_id" },
      );
    expect(sb.rows("applications")).toHaveLength(2);
    expect(sb.row("applications", (r) => r.position_id === "p1").status).toBe("offer");
  });
});

describe("supabaseFake — .upsert() with onConflict on a GENERATED column", () => {
  // A generated column's value cannot appear in the payload at all — Postgres
  // rejects an INSERT/UPSERT that supplies one ("cannot insert into column
  // ... generated column"). So when the conflict target is a generated
  // column, `payload[k]` is ALWAYS undefined, by construction, for every
  // upsert — correct ones included. A fake that reads the arbiter's value out
  // of the payload can therefore never find the existing row for a generated
  // conflict target, and every "regenerate this row" upsert silently becomes
  // an append. This is the exact defect the fake existed to avoid
  // reproducing in reverse: green here, backwards in what it proves.
  //
  // Modelled via `opts.generatedColumns: { [table]: { [column]: (payload) =>
  // value } }` — the smallest honest stand-in for `GENERATED ALWAYS AS (...)
  // STORED`. Real Postgres computes such a column from an expression over
  // the SAME row's other columns only (no subqueries, no other rows), which
  // is exactly what a JS function over the payload can express without the
  // fake becoming a SQL expression evaluator.
  function summariesFake(rows, generator) {
    return makeStatefulSupabase(
      { digest_summaries: rows },
      { generatedColumns: { digest_summaries: { scope_key: generator } } },
    );
  }
  const scopeKeyOf = (row) => `${row.user_id}:${row.scope}`;

  it("[canary] REPLACES the existing row instead of appending a duplicate", async () => {
    const sb = summariesFake(
      [{ id: "s1", user_id: "u1", scope: "resume", scope_key: "u1:resume", summary: "old" }],
      scopeKeyOf,
    );
    await sb
      .from("digest_summaries")
      .upsert({ user_id: "u1", scope: "resume", summary: "new" }, { onConflict: "scope_key" });

    const rows = sb.rows("digest_summaries");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("s1");
    expect(rows[0].summary).toBe("new");
  });

  it("still inserts when no stored row's generated value matches", async () => {
    const sb = summariesFake(
      [{ id: "s1", user_id: "u1", scope: "resume", scope_key: "u1:resume", summary: "old" }],
      scopeKeyOf,
    );
    await sb
      .from("digest_summaries")
      .upsert({ user_id: "u1", scope: "cover_letter", summary: "new" }, { onConflict: "scope_key" });

    expect(sb.rows("digest_summaries")).toHaveLength(2);
  });

  it("a freshly inserted row's generated value is stored, so a LATER upsert can still match it", async () => {
    const sb = summariesFake([], scopeKeyOf);
    await sb.from("digest_summaries").upsert({ user_id: "u1", scope: "resume", summary: "first" }, { onConflict: "scope_key" });
    await sb.from("digest_summaries").upsert({ user_id: "u1", scope: "resume", summary: "second" }, { onConflict: "scope_key" });

    const rows = sb.rows("digest_summaries");
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("second");
    expect(rows[0].scope_key).toBe("u1:resume");
  });

  it("a conflict target present in the payload keeps matching directly, unaffected by generatedColumns", async () => {
    const sb = summariesFake(
      [{ id: "s1", user_id: "u1", scope: "resume", scope_key: "u1:resume", summary: "old" }],
      scopeKeyOf,
    );
    // The payload supplies scope_key explicitly (a plain, non-generated
    // conflict target on some other row of the same call) — the generator
    // must not override a value the payload actually provided.
    await sb
      .from("digest_summaries")
      .upsert({ scope_key: "u1:resume", user_id: "u1", scope: "resume", summary: "direct" }, { onConflict: "scope_key" });

    const rows = sb.rows("digest_summaries");
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("direct");
  });
});

describe("supabaseFake — .update()", () => {
  it("touches only the filtered rows", async () => {
    const sb = appsFake([
      { id: "a1", user_id: "u1", status: "tracking" },
      { id: "a2", user_id: "u2", status: "tracking" },
    ]);
    await sb.from("applications").update({ status: "tailored" }).eq("user_id", "u1");
    expect(sb.row("applications", (r) => r.id === "a1").status).toBe("tailored");
    expect(sb.row("applications", (r) => r.id === "a2").status).toBe("tracking");
  });

  it("returns the updated rows when .select() is chained, and null when it is not", async () => {
    const sb = appsFake([{ id: "a1", user_id: "u1", status: "tracking" }]);
    const bare = await sb.from("applications").update({ status: "tailored" }).eq("id", "a1");
    expect(bare.data).toBeNull();

    const withSelect = await sb
      .from("applications")
      .update({ status: "auto_tailored" })
      .eq("id", "a1")
      .select("id, status");
    expect(withSelect.data).toEqual([{ id: "a1", status: "auto_tailored" }]);
  });

  it("executes the exact [update.eq.eq.not.select] chain the old mock throws on", async () => {
    // app/page.js:2336. `builder.not is not a function` against supabaseMock.js.
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "tracking" }]);
    const { data, error } = await sb
      .from("applications")
      .update({ status: "tailored" })
      .eq("user_id", "u1")
      .eq("position_id", "p1")
      .not("status", "in", "(applied,interviewing,offer,rejected,withdrawn)")
      .select("id, status");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: "a1", status: "tailored" }]);
  });

  it("executes the exact [select.eq.neq.neq.order] chain the old mock throws on", async () => {
    // app/page.js:1384-1392 (loadApplications).
    const sb = appsFake([
      { id: "a1", user_id: "u1", status: "applied", applied_at: T_JUNE },
      { id: "a2", user_id: "u1", status: "tracking", applied_at: null },
      { id: "a3", user_id: "u1", status: "auto_tailored", applied_at: null },
    ]);
    const { data, error } = await sb
      .from("applications")
      .select("id, status, applied_at")
      .eq("user_id", "u1")
      .neq("status", "tracking")
      .neq("status", "auto_tailored")
      .order("applied_at", { ascending: false });
    expect(error).toBeNull();
    expect(data.map((r) => r.id)).toEqual(["a1"]);
  });
});

describe("supabaseFake — .delete()", () => {
  it("removes only the filtered rows", async () => {
    const sb = appsFake([
      { id: "a1", user_id: "u1", position_id: "p1", status: "tracking" },
      { id: "a2", user_id: "u1", position_id: "p2", status: "applied" },
    ]);
    await sb
      .from("applications")
      .delete()
      .eq("user_id", "u1")
      .eq("position_id", "p1")
      .eq("status", "tracking");
    expect(sb.rows("applications").map((r) => r.id)).toEqual(["a2"]);
  });

  it("[canary] removes nothing when the filter matches nothing", async () => {
    // A call-recording mock cannot tell these two cases apart at all.
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }]);
    await sb
      .from("applications")
      .delete()
      .eq("user_id", "u1")
      .eq("position_id", "p1")
      .eq("status", "tracking");
    expect(sb.rows("applications")).toHaveLength(1);
  });

  it("returns the deleted rows when .select() is chained", async () => {
    const sb = appsFake([{ id: "a1", user_id: "u1", status: "tracking" }]);
    const { data } = await sb.from("applications").delete().eq("id", "a1").select("id");
    expect(data).toEqual([{ id: "a1" }]);
    expect(sb.rows("applications")).toEqual([]);
  });
});

describe("supabaseFake — projection and embeds", () => {
  it("projects the named columns only, and fills a missing one with null", async () => {
    const sb = appsFake([{ id: "a1", status: "applied", applied_at: T_JUNE, notes: "x" }]);
    const { data } = await sb.from("applications").select("id, status, cover_letter_id");
    expect(data).toEqual([{ id: "a1", status: "applied", cover_letter_id: null }]);
  });

  it("supports column aliases", async () => {
    const sb = appsFake([{ id: "a1", applied_at: T_JUNE }]);
    const { data } = await sb.from("applications").select("when:applied_at");
    expect(data).toEqual([{ when: T_JUNE }]);
  });

  it("resolves a declared many-to-one embed", async () => {
    const sb = makeStatefulSupabase(
      {
        applications: [{ id: "a1", user_id: "u1", position_id: "p1", status: "applied" }],
        positions: [{ id: "p1", external_id: "gh-1", title: "Senior Engineer", company: "Acme" }],
      },
      { relationships: { "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" } } },
    );
    const { data } = await sb
      .from("applications")
      .select("id, status, positions ( id, external_id, title )")
      .eq("user_id", "u1");
    expect(data).toEqual([
      { id: "a1", status: "applied", positions: { id: "p1", external_id: "gh-1", title: "Senior Engineer" } },
    ]);
  });

  it("throws rather than guessing when an embed is not declared", async () => {
    const sb = appsFake([{ id: "a1", position_id: "p1" }]);
    await expect(sb.from("applications").select("id, positions ( id )")).rejects.toThrow(
      /no relationship is declared/,
    );
  });

  it("throws on an !inner embed hint rather than silently ignoring it", async () => {
    const sb = makeStatefulSupabase({ positions: [{ id: "p1", external_id: "gh-1" }] });
    await expect(
      sb.from("positions").select("external_id, applications!inner(user_id, status)"),
    ).rejects.toThrow(/!inner/);
  });
});

describe("supabaseFake — calls.options", () => {
  it("records the upsert's conflict options on the recorded statement", async () => {
    const sb = appsFake([]);
    await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p1", status: "tracking" },
        { onConflict: "user_id,position_id", ignoreDuplicates: true },
      );

    expect(sb.calls).toHaveLength(1);
    expect(sb.calls[0].options).toStrictEqual({
      onConflict: "user_id,position_id",
      ignoreDuplicates: true,
    });
  });

  it("[canary] populates options PER STATEMENT, not once per client", async () => {
    // The failure this catches: `options` carried over from a previous
    // statement on the same `calls` array. A field that is always
    // `{ignoreDuplicates:true}` and a field that is correctly `true` on the
    // upsert look identical unless a second, differently-shaped statement is
    // recorded beside it.
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "tracking" }]);
    await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p2", status: "tracking" },
        { onConflict: "user_id,position_id", ignoreDuplicates: true },
      );
    await sb.from("applications").update({ status: "tailored" }).eq("id", "a1");

    expect(sb.calls.map((c) => c.verb)).toEqual(["upsert", "update"]);
    expect(sb.calls[0].options).toStrictEqual({
      onConflict: "user_id,position_id",
      ignoreDuplicates: true,
    });
    expect(sb.calls[1].options).toStrictEqual({ onConflict: undefined, ignoreDuplicates: false });
  });

  it("records options on a plain select too, so a walk never reads undefined", async () => {
    const sb = appsFake([{ id: "a1", user_id: "u1" }]);
    await sb.from("applications").select("*").eq("user_id", "u1");
    expect(sb.calls[0].options).toStrictEqual({ onConflict: undefined, ignoreDuplicates: false });
  });

  it("an rpc record carries NEITHER options NOR select — a walk must tolerate the asymmetry", async () => {
    // The title above ("so a walk never reads undefined") is true of every
    // statement that goes through `from()`, and false of `rpc`, which pushes
    // its own four-key record. That asymmetry is real and is pinned here rather
    // than left for a walk author to discover: `rpc` has no conflict clause and
    // no RETURNING projection, so recording either would be a fiction. A walk
    // that reaches for `c.options.ignoreDuplicates` or `c.select` without
    // filtering on `c.table` first throws on this record.
    const sb = appsFake([]);
    await sb.rpc("some_function", { a: 1 });

    expect(sb.calls).toHaveLength(1);
    const rec = sb.calls[0];
    expect(rec.table).toBeNull();
    expect(rec.verb).toBe("rpc");
    expect(Object.prototype.hasOwnProperty.call(rec, "options")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rec, "select")).toBe(false);
  });
});

describe("supabaseFake — calls.select", () => {
  it("[canary] records the projection PER STATEMENT, and null when no .select() was chained", async () => {
    // The failure this catches, stated as the reason the field exists: without
    // it, `.select(...)` is INVISIBLE in `calls`. A statement that chains a
    // read-back onto itself and one that does not produce byte-identical
    // records, so a guard walk cannot tell them apart — and on an
    // `ON CONFLICT DO NOTHING` upsert that difference decides whether the
    // read-back returns the row or nothing at all.
    //
    // Both directions, on ONE client and one `calls` array: a field that is
    // always the projection and a field that is correctly the projection look
    // identical unless a statement WITHOUT one is recorded beside it.
    const sb = appsFake([{ id: "a1", user_id: "u1", position_id: "p1", status: "tracking" }]);
    await sb.from("applications").update({ status: "tailored" }).eq("id", "a1");
    await sb.from("applications").update({ status: "auto_queued" }).eq("id", "a1").select("id, status");
    await sb
      .from("applications")
      .upsert(
        { user_id: "u1", position_id: "p2", status: "tracking" },
        { onConflict: "user_id,position_id", ignoreDuplicates: true },
      );

    expect(sb.calls.map((c) => c.verb)).toEqual(["update", "update", "upsert"]);
    expect(sb.calls.map((c) => c.select)).toEqual([null, "id, status", null]);
  });

  it("records the projection verbatim on a read, including \"*\"", async () => {
    // Verbatim, not normalised: a walk that wants to refuse a widened
    // projection has to be able to see the difference between "id, status" and
    // "*", and a fake that normalised both to a column list would erase it.
    const sb = appsFake([{ id: "a1", user_id: "u1", status: "applied" }]);
    await sb.from("applications").select("*").eq("user_id", "u1");
    await sb.from("applications").select("id, status, applied_at").eq("user_id", "u1");

    expect(sb.calls.map((c) => c.select)).toEqual(["*", "id, status, applied_at"]);
  });
});

describe("supabaseFake — guard rails", () => {
  it("throws on an operator it does not model instead of answering wrongly", async () => {
    const sb = appsFake([{ id: "a1" }]);
    expect(() => sb.from("applications").select("*").or("status.eq.applied")).toThrow(/not modelled/);
  });

  it("throws on a dotted filter targeting an embedded table", async () => {
    const sb = appsFake([{ id: "a1" }]);
    await expect(sb.from("applications").select("*").eq("positions.id", "p1")).rejects.toThrow(
      /embedded table/,
    );
  });

  it("surfaces an injected per-verb error", async () => {
    const sb = makeStatefulSupabase(
      { applications: [{ id: "a1", user_id: "u1" }] },
      { errors: { applications: { select: { message: "boom" } } } },
    );
    const { data, error } = await sb.from("applications").select("*").eq("user_id", "u1");
    expect(data).toBeNull();
    expect(error).toEqual({ message: "boom" });
  });

  it("hands back clones, so a test cannot corrupt the store by mutating a result", async () => {
    const sb = appsFake([{ id: "a1", status: "applied" }]);
    const { data } = await sb.from("applications").select("*");
    data[0].status = "MUTATED";
    expect(sb.rows("applications")[0].status).toBe("applied");
  });

  it("exposes auth.getUser for route handlers", async () => {
    const sb = makeStatefulSupabase({}, { user: { id: "u1" } });
    const { data } = await sb.auth.getUser();
    expect(data.user).toEqual({ id: "u1" });
  });
});
