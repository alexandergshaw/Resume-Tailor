import { vi } from "vitest";

// ---------------------------------------------------------------------------
// A STATEFUL in-memory PostgREST fake.
//
// Why this exists, and why it is a NEW file rather than an upgrade of
// `supabaseMock.js`:
//
//   `test/helpers/supabaseMock.js` is a *call recorder* with canned per-verb
//   results. `.eq()` does not filter, `.upsert()` does not merge, `.delete()`
//   removes nothing, and it defines no `.not()` / `.neq()` at all. Fourteen
//   test files depend on exactly those canned-result semantics (they assert
//   `sb.calls.<table>.eq` and rely on a fixed `{ data }` coming back however
//   the chain was filtered). Giving that helper real semantics in place would
//   change the answer every one of those chains resolves to, so this is a
//   second helper alongside it. `supabaseMock.js` stays untouched; reach for
//   it when you want to assert *that a query was issued*, and for this one
//   when you need to assert *what the rows look like afterwards*.
//
// What it models: row storage per table, and the subset of PostgREST this
// repo's `applications` chains actually use — `.select() .insert() .upsert()
// (with onConflict merge, including a declared GENERATED conflict column —
// see [8]) .update() .delete() .eq() .neq() .in() .not(col, op, value)
// .order() (incl. nullsFirst) .limit() .single() .maybeSingle()`, plus
// declared many-to-one embeds.
//
// What it does NOT model, and throws loudly on rather than guessing:
// `.or()`, `.filter()`, `!inner` embeds, dotted filters onto an embedded
// table, RPC-side effects, RLS. A fake that silently answers a query it does
// not understand is worse than no fake at all.
//
// -------------------------------- SEMANTICS --------------------------------
//
// The load-bearing part is three-valued logic. PostgREST filters become a SQL
// WHERE clause, and SQL WHERE keeps a row only when the predicate is TRUE —
// not when it is NULL/unknown. Every filter here therefore evaluates to
// `true | false | null`, and `applyFilters` keeps only rows where every filter
// returned `true`. Getting this wrong is not academic: it is the exact axis
// the defect this harness exists to reproduce turns on.
//
// Citations for the behaviours that are not obvious:
//
//  [1] NOT-IN over a NULL column. PostgreSQL, "Row and Array Comparisons":
//      "Note that if the left-hand expression yields null, or if there are no
//      equal right-hand values and at least one right-hand expression yields
//      null, the result of the NOT IN construct will be null, not true as one
//      might naively expect." — https://www.postgresql.org/docs/current/functions-comparisons.html
//      So a row whose `status` IS NULL is NOT matched by
//      `.not("status", "in", "(a,b,c)")`. A naive implementation
//      (`!list.includes(v)`) returns true for NULL and matches it.
//
//  [2] `.not()` is a literal prefix negation, not a separate operator.
//      PostgREST, "Logical operators": "To negate any operator, you can prefix
//      it with `not` like `?a=not.eq.2`"
//      — https://postgrest.org/en/stable/references/api/tables_views.html
//      and postgrest-js `PostgrestFilterBuilder.not()` is literally
//      `this.url.searchParams.append(column, \`not.${operator}.${value}\`)`.
//      Hence: evaluate the inner operator, then negate WITH null propagation.
//
//  [3] `.neq()` is SQL `<>`, so it is null-propagating too — a NULL column
//      does not satisfy `.neq()`. PostgREST documents a *separate* operator,
//      `isdistinct`, as "not equal, treating NULL as a comparable value"
//      (same page as [2]); that operator would not need to exist if `neq`
//      already handled NULL. `.is(col, "null")` is the two-valued form.
//
//  [4] `.order(col, { ascending: false })` defaults to NULLS FIRST.
//      postgrest-js emits no nullsfirst/nullslast token at all when
//      `nullsFirst === undefined` (`PostgrestTransformBuilder.order()`), so
//      PostgreSQL's own default applies. PostgreSQL, "Sorting Rows": "By
//      default, null values sort as if larger than any non-null value; that
//      is, NULLS FIRST is the default for DESC order, and NULLS LAST
//      otherwise." — https://www.postgresql.org/docs/current/queries-order.html
//
//  [5] `upsert(payload, { onConflict })` merges the payload's columns only.
//      postgrest-js sends `Prefer: resolution=merge-duplicates` plus
//      `on_conflict=<cols>` (`PostgrestQueryBuilder.upsert()`), which
//      PostgREST renders as INSERT ... ON CONFLICT (cols) DO UPDATE SET
//      <the payload's columns> = excluded.<col>. Columns absent from the
//      payload keep their existing values; columns present in the payload are
//      overwritten unconditionally — including with an explicit null.
//
//  [6] `.single()` on 0 or >1 rows is an ERROR (PGRST116), not a null.
//      `.maybeSingle()` tolerates 0 but still errors on >1.
//
//  [8] A conflict target CAN be a generated column (`GENERATED ALWAYS AS
//      (...) STORED`) — PostgreSQL allows a unique index, and therefore an
//      `ON CONFLICT` target, on one. The payload can never carry a value for
//      it: supplying any value (even an explicit null) for a generated
//      column is a hard INSERT-time error ("cannot insert a non-DEFAULT
//      value into column ... Column ... is a generated column"), so a
//      *correct* upsert against such a target always omits it. Reading the
//      arbiter's value out of `payload[k]` — which is exactly right for an
//      ordinary column under [5] — is therefore `undefined` for exactly the
//      payloads that are right, the row is never found, and the upsert
//      degrades to append-only. This fake instead resolves each conflict
//      column as: the payload's own value when the payload supplies one
//      (unchanged from before); otherwise, if the caller declared
//      `opts.generatedColumns[table][column]`, the result of calling that
//      function with the payload. This mirrors Postgres exactly for what a
//      STORED generated column is allowed to depend on — the SAME row's
//      other columns only, never another row, a subquery, or a sequence — so
//      a same-row JS function is a faithful stand-in, not a cut corner. The
//      computed value is also written onto the row when it is inserted (by
//      `.insert()` or by `.upsert()`'s insert branch), so a LATER upsert has
//      a real stored value to match against, the way Postgres would. A
//      conflict column that is absent from the payload AND undeclared in
//      `generatedColumns` is NOT treated as generated — it still resolves to
//      `undefined` and never matches, exactly as before this fix.
//
//      What this does NOT model: recomputation on `.update()`. A real STORED
//      generated column recomputes whenever any input column changes, on
//      ANY write — this fake only computes it on `.insert()` / `.upsert()`,
//      never on `.update()`. A test that needs a generated value to react to
//      a plain `.update()` is exercising something this fake cannot answer;
//      reseed or re-upsert the row instead of trusting `.update()` here.
//
// Usage:
//   const sb = makeStatefulSupabase({
//     applications: [{ id: "a1", user_id: "u1", status: "applied", applied_at: T }],
//   });
//   await sb.from("applications").update({ status: "tailored" }).eq("id", "a1");
//   expect(sb.rows("applications")[0].status).toBe("tailored");
// ---------------------------------------------------------------------------

const WRITE_VERBS = ["insert", "update", "delete", "upsert"];

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

// PostgREST filter values travel as text in the query string and are cast by
// Postgres against the column type, so `.eq("id", 1)` matches a row whose id
// is the string "1" and vice versa. Comparing stringified scalars models that
// without pretending to know column types.
function sameScalar(a, b) {
  if (a instanceof Date) a = a.toISOString();
  if (b instanceof Date) b = b.toISOString();
  return String(a) === String(b);
}

function isNull(v) {
  return v === null || v === undefined;
}

// --- three-valued predicate evaluation --------------------------------------

// Returns true | false | null (null == SQL "unknown").
function evalOperator(row, column, operator, value) {
  const v = row[column];
  switch (operator) {
    case "eq":
      return isNull(v) ? null : sameScalar(v, value);
    case "neq":
      // [3] SQL `<>`; null-propagating.
      return isNull(v) ? null : !sameScalar(v, value);
    case "in": {
      // [1] `x IN (...)` over a NULL x is NULL, not false.
      if (isNull(v)) return null;
      const list = Array.isArray(value) ? value : parseInList(value);
      return list.some((candidate) => sameScalar(v, candidate));
    }
    case "is": {
      // `is` is IS NOT DISTINCT FROM: always definite, never unknown.
      const raw = String(value);
      if (raw === "null") return isNull(v);
      if (raw === "true") return v === true;
      if (raw === "false") return v === false;
      throw new Error(`[supabaseFake] .is() supports null/true/false, got "${raw}"`);
    }
    case "gt":
      return isNull(v) ? null : v > value;
    case "gte":
      return isNull(v) ? null : v >= value;
    case "lt":
      return isNull(v) ? null : v < value;
    case "lte":
      return isNull(v) ? null : v <= value;
    default:
      throw new Error(
        `[supabaseFake] unsupported operator "${operator}". Add it deliberately (with a citation) rather than letting the fake guess.`,
      );
  }
}

// PostgREST list literal: "(applied,interviewing,offer)" — also accepts the
// quoted form '("a,b","c")' the docs show for values containing commas.
export function parseInList(literal) {
  const raw = String(literal).trim();
  if (!raw.startsWith("(") || !raw.endsWith(")")) {
    throw new Error(
      `[supabaseFake] .not(col, "in", value) expects a PostgREST list literal like "(a,b,c)", got ${JSON.stringify(literal)}`,
    );
  }
  const body = raw.slice(1, -1);
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "" || out.length > 0) out.push(current.trim());
  return out.filter((s) => s !== "");
}

function evalFilter(row, filter) {
  if (filter.column.includes(".")) {
    throw new Error(
      `[supabaseFake] filters onto an embedded table ("${filter.column}") are not modelled. Assert on the parent table instead.`,
    );
  }
  const inner = evalOperator(row, filter.column, filter.operator, filter.value);
  if (!filter.negated) return inner;
  // [2] negation propagates unknown: NOT NULL is NULL, so the row is dropped.
  return inner === null ? null : !inner;
}

function applyFilters(rows, filters) {
  // SQL WHERE keeps a row only when the predicate is TRUE — unknown drops it.
  return rows.filter((row) => filters.every((f) => evalFilter(row, f) === true));
}

// --- ordering ---------------------------------------------------------------

function applyOrder(rows, orders) {
  if (orders.length === 0) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const { column, ascending, nullsFirst } of orders) {
      const av = a[column];
      const bv = b[column];
      const aNull = isNull(av);
      const bNull = isNull(bv);
      // [4] PostgreSQL default: NULLS FIRST for DESC, NULLS LAST otherwise.
      const nullsGoFirst = nullsFirst === undefined ? !ascending : nullsFirst;
      if (aNull && bNull) continue;
      if (aNull) return nullsGoFirst ? -1 : 1;
      if (bNull) return nullsGoFirst ? 1 : -1;
      let cmp = 0;
      if (av < bv) cmp = -1;
      else if (av > bv) cmp = 1;
      if (cmp !== 0) return ascending ? cmp : -cmp;
    }
    return 0;
  });
  return sorted;
}

// --- select projection ------------------------------------------------------

// Split a select string on top-level commas, keeping `embed ( ... )` blocks
// whole.
function splitSelect(select) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function projectRow(row, select, table, store, relationships) {
  const spec = (select || "*").trim();
  if (spec === "" || spec === "*") return clone(row);

  const out = {};
  for (const token of splitSelect(spec)) {
    if (token === "*") {
      Object.assign(out, clone(row));
      continue;
    }
    const embedMatch = token.match(/^([A-Za-z0-9_!]+)\s*\((.*)\)$/s);
    if (embedMatch) {
      const [, nameRaw, innerSelect] = embedMatch;
      if (nameRaw.includes("!")) {
        throw new Error(
          `[supabaseFake] embed hints such as "${nameRaw}" (!inner / !left) are not modelled.`,
        );
      }
      const rel = relationships[`${table}.${nameRaw}`];
      if (!rel) {
        throw new Error(
          `[supabaseFake] select embeds "${nameRaw}" but no relationship is declared. Pass ` +
            `{ relationships: { "${table}.${nameRaw}": { localKey: "<fk column>", table: "${nameRaw}", foreignKey: "id" } } }.`,
        );
      }
      const target = store.get(rel.table || nameRaw) || [];
      const fk = rel.foreignKey || "id";
      const matches = target.filter((r) => !isNull(row[rel.localKey]) && sameScalar(r[fk], row[rel.localKey]));
      const projected = matches.map((r) => projectRow(r, innerSelect, rel.table || nameRaw, store, relationships));
      out[nameRaw] = rel.many ? projected : projected[0] ?? null;
      continue;
    }
    const aliasMatch = token.match(/^([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)$/);
    if (aliasMatch) {
      out[aliasMatch[1]] = clone(row[aliasMatch[2]] ?? null);
      continue;
    }
    out[token] = clone(row[token] ?? null);
  }
  return out;
}

// --- the client -------------------------------------------------------------

/**
 * @param {Record<string, object[]>} seed  rows per table
 * @param {object} [opts]
 * @param {object} [opts.user]             what auth.getUser() returns
 * @param {object} [opts.claims]           what auth.getClaims() returns
 * @param {Record<string,string[]>} [opts.primaryKeys]  conflict target when upsert
 *                                         is called without onConflict (default ["id"])
 * @param {Record<string,Record<string,(payload:object)=>*>>} [opts.generatedColumns]
 *                                         per-table, per-column functions modelling a
 *                                         `GENERATED ALWAYS AS (...) STORED` column that
 *                                         can be an onConflict target — see [8]. Shape:
 *                                         { [table]: { [column]: (payload) => value } }
 * @param {Record<string,object>} [opts.relationships]  declared embeds, keyed
 *                                         "<table>.<embedName>"
 * @param {Record<string,Record<string,object>>} [opts.errors]  force an error:
 *                                         { applications: { select: { message: "boom" } } }
 * @param {Record<string,*>} [opts.storage] path -> blob-like (or Error)
 * @param {Record<string,*>} [opts.rpc]     fn name -> result
 */
export function makeStatefulSupabase(seed = {}, opts = {}) {
  const store = new Map();
  for (const [table, rows] of Object.entries(seed)) {
    store.set(table, (rows || []).map(clone));
  }
  const relationships = opts.relationships || {};
  const primaryKeys = opts.primaryKeys || {};
  const generatedColumns = opts.generatedColumns || {};
  const errors = opts.errors || {};
  const calls = [];
  let idCounter = 0;

  function tableRows(table) {
    if (!store.has(table)) store.set(table, []);
    return store.get(table);
  }

  function nextId(table) {
    idCounter += 1;
    return `${table}-fake-${idCounter}`;
  }

  function forcedError(table, verb) {
    const spec = errors[table];
    if (!spec) return null;
    const hit = Object.prototype.hasOwnProperty.call(spec, verb) ? spec[verb] : undefined;
    if (hit === undefined || hit === null) return null;
    return hit instanceof Error ? { message: hit.message } : hit;
  }

  function conflictTarget(table, onConflict) {
    if (onConflict) return String(onConflict).split(",").map((s) => s.trim()).filter(Boolean);
    return primaryKeys[table] || ["id"];
  }

  // [8] The value a conflict column resolves to for THIS payload: the
  // payload's own value if it has one, else — when the caller declared this
  // column generated for this table — the declared generator applied to the
  // payload. Undeclared + absent stays `undefined` (never matches), same as
  // before this fix.
  function resolveConflictValue(table, column, payload) {
    if (!isNull(payload[column])) return payload[column];
    const generator = (generatedColumns[table] || {})[column];
    return generator ? generator(payload) : payload[column];
  }

  // Stamp any declared generated columns this row omitted onto the row
  // itself before it is stored, so a LATER upsert has a real stored value to
  // match against — mirroring a STORED generated column's persistence.
  function stampGeneratedColumns(table, columns, row) {
    for (const k of columns) {
      if (isNull(row[k])) {
        const generator = (generatedColumns[table] || {})[k];
        if (generator) row[k] = generator(row);
      }
    }
  }

  function builderFor(table) {
    const state = {
      verb: "select",
      payload: null,
      onConflict: undefined,
      ignoreDuplicates: false,
      filters: [],
      orders: [],
      limit: null,
      select: null,
      returning: false,
      wantCount: false,
    };

    function execute() {
      // `options` is recorded PER STATEMENT, read off this builder's own
      // `state` at execute() time. A guard walk over `calls` has to be able to
      // tell an `ON CONFLICT DO NOTHING` upsert from a merge-duplicates one,
      // and either from a plain UPDATE — the conflict clause is part of what
      // makes C3's insert incapable of demoting, so a walk that cannot see it
      // cannot check it. Non-upsert verbs record `{onConflict: undefined,
      // ignoreDuplicates: false}`, which is the state's own initial value.
      //
      // `select` is recorded for the same reason, and it is NOT cosmetic. In
      // this fake `.select()` does two separable things: it sets the RETURNING
      // projection, and on a write verb it flips `state.returning`. Neither is
      // visible in `{table, verb, filters, payload, options}`, so without this
      // field a `.select()` chained onto a statement is completely unobservable
      // from `calls` — a walk cannot tell an `ON CONFLICT DO NOTHING` upsert
      // that reads its row back on the SAME statement (which returns nothing on
      // the conflict path, and is banned on `applications`) from one that reads
      // it back separately, and cannot tell a narrow projection from `"*"`.
      // `null` is the sentinel for "no `.select()` was chained", which is
      // `state.select`'s own initial value; the projection string is recorded
      // verbatim otherwise.
      calls.push({
        table,
        verb: state.verb,
        filters: state.filters.map((f) => ({ ...f })),
        payload: clone(state.payload),
        options: { onConflict: state.onConflict, ignoreDuplicates: state.ignoreDuplicates },
        select: state.select,
      });

      const forced = forcedError(table, state.verb);
      if (forced) return { data: null, error: forced, count: null };

      const rows = tableRows(table);

      if (state.verb === "select") {
        const matched = applyOrder(applyFilters(rows, state.filters), state.orders);
        const limited = state.limit === null ? matched : matched.slice(0, state.limit);
        return {
          data: limited.map((r) => projectRow(r, state.select, table, store, relationships)),
          error: null,
          count: state.wantCount ? matched.length : null,
        };
      }

      let touched = [];

      if (state.verb === "insert") {
        const incoming = Array.isArray(state.payload) ? state.payload : [state.payload];
        for (const raw of incoming) {
          const row = clone(raw);
          if (row.id === undefined) row.id = nextId(table);
          // A table with a declared generated column (see [8]) computes and
          // stores it on insert, exactly as Postgres would.
          stampGeneratedColumns(table, Object.keys(generatedColumns[table] || {}), row);
          rows.push(row);
          touched.push(row);
        }
      } else if (state.verb === "upsert") {
        const incoming = Array.isArray(state.payload) ? state.payload : [state.payload];
        const keys = conflictTarget(table, state.onConflict);
        for (const raw of incoming) {
          const payload = clone(raw);
          // [8] Resolve each conflict column from the payload, falling back
          // to a declared generator — NOT from `payload[k]` directly, which
          // is `undefined` by construction for a real generated column.
          const keyValues = {};
          for (const k of keys) keyValues[k] = resolveConflictValue(table, k, payload);
          const existing = rows.find((r) => keys.every((k) => !isNull(r[k]) && sameScalar(r[k], keyValues[k])));
          if (existing) {
            if (state.ignoreDuplicates) {
              // [7] `INSERT … ON CONFLICT DO NOTHING RETURNING` returns NO row
              // for a conflicting insert: nothing was inserted, so there is
              // nothing to return. Pushing `existing` here made a `.select()`
              // on an ignoreDuplicates upsert look like "the row I just wrote"
              // — green in the fake, PGRST116 in production. The existing row
              // is still left untouched; only the RETURNING projection changes.
              continue;
            }
            // [5] merge-duplicates: the PAYLOAD's columns are overwritten
            // (including with an explicit null); every other column survives.
            Object.assign(existing, payload);
            touched.push(existing);
          } else {
            if (payload.id === undefined) payload.id = nextId(table);
            // [8] No stored row conflicted, so this becomes an INSERT — stamp
            // any declared generated columns onto it, the same as the plain
            // `.insert()` branch above, so a LATER upsert can match it.
            stampGeneratedColumns(table, Object.keys(generatedColumns[table] || {}), payload);
            rows.push(payload);
            touched.push(payload);
          }
        }
      } else if (state.verb === "update") {
        touched = applyFilters(rows, state.filters);
        for (const row of touched) Object.assign(row, clone(state.payload));
      } else if (state.verb === "delete") {
        touched = applyFilters(rows, state.filters);
        const doomed = new Set(touched);
        store.set(table, rows.filter((r) => !doomed.has(r)));
      }

      if (!state.returning) return { data: null, error: null, count: null };
      const ordered = applyOrder(touched, state.orders);
      return {
        data: ordered.map((r) => projectRow(r, state.select, table, store, relationships)),
        error: null,
        count: state.wantCount ? ordered.length : null,
      };
    }

    function resolveMany() {
      return Promise.resolve(execute());
    }

    function resolveOne(allowZero) {
      const res = execute();
      if (res.error) return Promise.resolve({ data: null, error: res.error, count: null });
      const list = res.data || [];
      if (list.length === 1) return Promise.resolve({ data: list[0], error: null, count: res.count });
      if (list.length === 0 && allowZero) return Promise.resolve({ data: null, error: null, count: res.count });
      // [6] PGRST116 — the shape the real client returns.
      return Promise.resolve({
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: `The result contains ${list.length} rows`,
          hint: null,
        },
        count: null,
      });
    }

    const builder = {};

    const addFilter = (operator, negated) =>
      vi.fn((column, value) => {
        state.filters.push({ column, operator, value, negated: !!negated });
        return builder;
      });

    builder.select = vi.fn((columns = "*", options = {}) => {
      state.select = columns;
      state.wantCount = !!options.count;
      if (WRITE_VERBS.includes(state.verb)) state.returning = true;
      return builder;
    });
    builder.insert = vi.fn((payload) => {
      state.verb = "insert";
      state.payload = payload;
      return builder;
    });
    builder.upsert = vi.fn((payload, options = {}) => {
      state.verb = "upsert";
      state.payload = payload;
      state.onConflict = options.onConflict;
      state.ignoreDuplicates = !!options.ignoreDuplicates;
      return builder;
    });
    builder.update = vi.fn((payload) => {
      state.verb = "update";
      state.payload = payload;
      return builder;
    });
    builder.delete = vi.fn(() => {
      state.verb = "delete";
      return builder;
    });

    builder.eq = addFilter("eq", false);
    builder.neq = addFilter("neq", false);
    builder.in = addFilter("in", false);
    builder.is = addFilter("is", false);
    builder.gt = addFilter("gt", false);
    builder.gte = addFilter("gte", false);
    builder.lt = addFilter("lt", false);
    builder.lte = addFilter("lte", false);

    // Mirrors postgrest-js: `.not(column, operator, value)` appends
    // `column=not.<operator>.<value>` — the operator and value are raw
    // PostgREST syntax, so `"in"` arrives with a `"(a,b,c)"` string.
    builder.not = vi.fn((column, operator, value) => {
      state.filters.push({ column, operator, value, negated: true });
      return builder;
    });

    builder.order = vi.fn((column, options = {}) => {
      if (options.referencedTable || options.foreignTable) {
        throw new Error("[supabaseFake] ordering an embedded table is not modelled.");
      }
      state.orders.push({
        column,
        ascending: options.ascending === undefined ? true : !!options.ascending,
        nullsFirst: options.nullsFirst,
      });
      return builder;
    });
    builder.limit = vi.fn((count) => {
      state.limit = count;
      return builder;
    });

    for (const unsupported of ["or", "filter", "match", "contains", "overlaps", "textSearch", "range"]) {
      builder[unsupported] = vi.fn(() => {
        throw new Error(
          `[supabaseFake] .${unsupported}() is not modelled. Add it deliberately, with a citation for its NULL semantics.`,
        );
      });
    }

    builder.single = vi.fn(() => resolveOne(false));
    builder.maybeSingle = vi.fn(() => resolveOne(true));
    builder.then = (resolve, reject) => resolveMany().then(resolve, reject);

    return builder;
  }

  return {
    from: vi.fn((table) => builderFor(table)),
    // Read the store back. Returns clones: mutating them cannot corrupt state.
    rows: (table) => (store.get(table) || []).map(clone),
    row: (table, predicate) => (store.get(table) || []).map(clone).find(predicate) ?? null,
    seed: (table, rows) => store.set(table, (rows || []).map(clone)),
    calls,
    rpc: vi.fn(async (fn, args) => {
      calls.push({ table: null, verb: "rpc", fn, args });
      const spec = (opts.rpc || {})[fn];
      if (spec instanceof Error) return { data: null, error: spec };
      if (spec && typeof spec === "object" && ("data" in spec || "error" in spec)) {
        return { data: spec.data ?? null, error: spec.error ?? null };
      }
      return { data: spec ?? null, error: null };
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.user ?? null }, error: null })),
      getClaims: vi.fn(async () =>
        opts.claims === undefined
          ? { data: null, error: null }
          : { data: { claims: opts.claims }, error: null }),
    },
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async (path) => {
          const bucket = opts.storage || {};
          if (Object.prototype.hasOwnProperty.call(bucket, path)) {
            const entry = bucket[path];
            if (entry instanceof Error) return { data: null, error: entry };
            return { data: entry, error: null };
          }
          return { data: null, error: { message: "not found" } };
        }),
      })),
    },
  };
}
