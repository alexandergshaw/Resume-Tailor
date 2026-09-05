import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import {
  writeApplicationStatus,
  setApplicationStatusByUser,
  loadAppliedOrLaterExternalIds,
  deleteUntrackedApplication,
  deleteApplicationForUser,
} from "@/lib/supabase/applicationStatusWriter.js";
import {
  APPLICATION_STATUSES,
  APPLIED_OR_LATER_STATUSES,
  PRE_APPLY_STATUSES,
} from "@/lib/applications/statusVocabulary.js";

// ---------------------------------------------------------------------------
// THE WRITER'S FULL OUTCOME TABLE.
//
// Read these three notes before changing an assertion here.
//
// 1. C3's payload names `applied_at` on BOTH branches, and the branches are
//    distinguished by the VALUE, never by the key set. Both are
//    ["applied_at","position_id","status","user_id"]; the pre-apply branch
//    carries `null` and the applied-or-later branch carries the clock's ISO
//    string. This is deliberate and it is the stronger assertion: a key-set
//    `toEqual` cannot tell `null` from a column default of `now()`, and a
//    value assertion can. `supabaseFake` models no column defaults at all and
//    its `isNull()` treats a missing key and an explicit `null` identically,
//    so the key set alone could never have carried this branch. Anyone
//    "restoring" the asymmetry between the two payloads is removing coverage.
//
// 2. Every `applied_at` assertion is an IDENTITY against a literal or against
//    the injected clock — never `toBeTruthy()`, `not.toBeNull()` or
//    `expect.any(String)`. The defect this module exists to stop writes a
//    fresh, non-null, WRONG timestamp, and every truthiness assertion passes
//    against it. The clock is pinned with `vi.setSystemTime`, so `nowIso` is a
//    literal here too.
//
// 3. Statement CARDINALITY is asserted next to every outcome, both as a verb
//    SEQUENCE (`toEqual`, never `indexOf` comparisons — `indexOf` is -1 for a
//    step that never ran, which makes the usual ordering assertion degenerate)
//    and as a total `calls.length`. The total is the only assertion that
//    catches an unexpected EXTRA statement: a retry firing twice, a read-back
//    issued three times.
//
// 4. Cardinality does NOT catch a `.select()` added to an existing statement,
//    and no reader should believe it does. `.select()` is a chained modifier,
//    not a statement: it adds no entry to `calls` and changes no verb. What
//    catches it is `calls[n].select`, which records the projection per
//    statement (`null` when none was chained). That field is why the
//    `ON CONFLICT DO NOTHING` case below can assert the read-back is a separate
//    statement rather than merely asserting that a fourth statement exists.
//
// Harness limits, stated once so a later reader does not rediscover them:
//   - `makeSupabase` (`test/helpers/supabaseMock.js`) has no `.is()` and no
//     `.not()`, so the stamp can never run under it and a deny-list guard
//     would throw there. That is why every test here uses
//     `makeStatefulSupabase`, and it is why the guard is an allow-list.
//   - The compare-and-set's WIRE format is unprovable in this repo:
//     `supabaseFake.sameScalar` is `String(a) === String(b)` while Postgres
//     compares typed timestamps, so a CAS carrying `Z` against a stored
//     `+00:00` is green here and wrong in production. Recorded as a residual;
//     the `.is()`-vs-`.eq()` NULL rule below IS provable and is proven.
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const POSITION_ID = "pos-1";
const APP_ID = "app-1";
const EXTERNAL_ID = "gh-1";

// The user applied on 4 July. Identity, everywhere.
const APPLIED_AT = "2026-07-04T15:32:11.000Z";
const NOW = "2026-09-05T12:00:00.000Z";

function appRow(over = {}) {
  return {
    id: APP_ID,
    user_id: USER_ID,
    position_id: POSITION_ID,
    status: "tracking",
    applied_at: null,
    tracked_at: "2026-06-28T08:00:00.000Z",
    application_url: "https://acme.example/careers/1",
    notes: "recruiter said Thursday",
    ...over,
  };
}

function client(rows, opts = {}) {
  return makeStatefulSupabase(
    {
      applications: rows,
      positions: [{ id: POSITION_ID, external_id: EXTERNAL_ID, title: "Senior Engineer", company: "Acme" }],
    },
    {
      user: { id: USER_ID },
      relationships: {
        "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" },
      },
      ...opts,
    },
  );
}

const stored = (sb) => sb.row("applications", (r) => r.position_id === POSITION_ID);
const verbs = (sb) => sb.calls.map((c) => c.verb);
const appWrites = (sb) =>
  sb.calls.filter((c) => c.table === "applications" && c.verb !== "select");

// A thin script layer over the fake, for the interleavings the outcome table
// specifies and a single-threaded fake cannot otherwise produce: a row
// arriving between two statements, a row vanishing between two statements, and
// an error on ONE statement of a verb the writer issues twice.
//
// `match(rec, index)` sees the statement about to run (`{table, verb, payload,
// filters, options, select}`) and its zero-based ordinal. `error` short-circuits
// that statement WITHOUT touching the store — but still records it, so the
// cardinality assertions stay honest. `after` runs once the statement has
// executed, which is exactly "between this statement and the next".
//
// The error path is the one place in this file that writes a `sb.calls` record
// by hand rather than letting the fake write it, so it is a SECOND copy of the
// record's shape. That duplication is unavoidable — the statement never reaches
// `execute()` — but it is not left uncovered: "[control] the script layer
// records the SAME statement shape the fake does", below, deep-compares the two
// key sets, so a future field added to `supabaseFake`'s `calls.push` cannot
// leave this copy silently behind.
function scripted(sb, script = []) {
  let index = -1;

  function wrap(table) {
    const real = sb.from(table);
    const rec = { table, verb: "select", payload: null, filters: [], options: {}, select: null };
    const b = {};
    const fwd = (name, record) => {
      b[name] = (...args) => {
        record(...args);
        real[name](...args);
        return b;
      };
    };

    fwd("select", (columns) => { rec.select = columns; });
    fwd("insert", (payload) => { rec.verb = "insert"; rec.payload = payload; });
    fwd("update", (payload) => { rec.verb = "update"; rec.payload = payload; });
    fwd("upsert", (payload, options = {}) => {
      rec.verb = "upsert";
      rec.payload = payload;
      rec.options = options;
    });
    fwd("delete", () => { rec.verb = "delete"; });
    for (const op of ["eq", "neq", "in", "is", "gt", "gte", "lt", "lte"]) {
      fwd(op, (column, value) => rec.filters.push({ column, operator: op, value, negated: false }));
    }
    fwd("not", (column, operator, value) =>
      rec.filters.push({ column, operator, value, negated: true }));
    fwd("order", () => {});
    fwd("limit", () => {});

    async function run(kind) {
      index += 1;
      const step = script.find((s) => s.match(rec, index));
      let res;
      if (step && step.error) {
        sb.calls.push({
          table: rec.table,
          verb: rec.verb,
          filters: rec.filters.map((f) => ({ ...f })),
          payload: rec.payload,
          options: {
            onConflict: rec.options.onConflict,
            ignoreDuplicates: !!rec.options.ignoreDuplicates,
          },
          select: rec.select,
        });
        res = { data: null, error: step.error, count: null };
      } else if (kind === "then") {
        res = await new Promise((resolve, reject) => real.then(resolve, reject));
      } else {
        res = await real[kind]();
      }
      if (step && step.after) step.after(sb);
      return res;
    }

    b.then = (resolve, reject) => run("then").then(resolve, reject);
    b.single = () => run("single");
    b.maybeSingle = () => run("maybeSingle");
    return b;
  }

  return {
    from: (table) => wrap(table),
    rows: sb.rows,
    row: sb.row,
    seed: sb.seed,
    calls: sb.calls,
    rpc: sb.rpc,
    auth: sb.auth,
    storage: sb.storage,
  };
}

beforeEach(() => {
  // Only `Date` — faking timers wholesale can also fake the microtask queue
  // these awaits depend on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The script layer's own control
// ---------------------------------------------------------------------------

describe("[control] the scripted harness", () => {
  it("records the SAME statement shape the fake does", async () => {
    // `scripted`'s error path pushes a `sb.calls` record by hand, because the
    // statement it is short-circuiting never reaches the fake's `execute()`.
    // That is a second implementation of the record's shape, and every
    // cardinality and filter assertion in this file reads records from BOTH.
    // Without this control, a field added to `supabaseFake.js`'s `calls.push`
    // — `options` was one, `select` is another — lands in one shape and not the
    // other, and the tests that happen to route through the script layer go
    // quietly blind to it while staying green.
    //
    // Compared as key SETS against a record the fake itself wrote, so the
    // comparison moves with the fake rather than restating it.
    const real = client([appRow({ status: "tracking" })]);
    await real.from("applications").update({ status: "tailored" }).eq("id", APP_ID).select("id");
    expect(real.calls).toHaveLength(1);

    const sb = client([appRow({ status: "tracking" })]);
    const sc = scripted(sb, [{ match: () => true, error: { message: "short-circuited" } }]);
    const res = await sc.from("applications").update({ status: "tailored" }).eq("id", APP_ID).select("id");

    expect(res.error).toEqual({ message: "short-circuited" });
    expect(sb.calls).toHaveLength(1);
    expect(Object.keys(sb.calls[0]).sort()).toEqual(Object.keys(real.calls[0]).sort());
    // And the short-circuited statement really was recorded, with its own
    // values — a shape that matches because both are empty proves nothing.
    expect(sb.calls[0]).toEqual(real.calls[0]);
    // The store is untouched: `error` short-circuits WITHOUT executing.
    expect(stored(sb).status).toBe("tracking");
  });
});

// ---------------------------------------------------------------------------
// C0 — refuse before any IO
// ---------------------------------------------------------------------------

describe("writeApplicationStatus — C0, refusal before any IO", () => {
  it("refuses a target status outside the eleven, and issues no statement at all", async () => {
    const sb = client([appRow({ status: "tailored" })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "screening",
    });

    expect(out).toEqual({
      id: null,
      changed: false,
      reason: "unknown-status",
      currentStatus: null,
      stamped: false,
    });
    // Exact zero, not "no applications writes": a refusal that costs a round
    // trip is not a refusal before IO.
    expect(sb.calls).toHaveLength(0);
    expect(stored(sb).status).toBe("tailored");
  });

  it("refuses a missing userId or positionId with 'no-key', not 'error'", async () => {
    // Five of the nine callers can produce a null position id. Collapsing that
    // into "error" is how a wiring miss reads as a transient failure.
    for (const args of [
      { userId: null, positionId: POSITION_ID, status: "applied" },
      { userId: USER_ID, positionId: null, status: "applied" },
      { userId: "", positionId: "", status: "applied" },
    ]) {
      const sb = client([appRow()]);
      const out = await writeApplicationStatus(sb, args);
      expect(out.reason).toBe("no-key");
      expect(out.changed).toBe(false);
      expect(out.id).toBeNull();
      expect(sb.calls).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// C1 — the guarded UPDATE, and its allow-list
// ---------------------------------------------------------------------------

describe("writeApplicationStatus — C1, the guarded UPDATE", () => {
  it("promotes a pre-apply row to a pre-apply status in ONE statement", async () => {
    const sb = client([appRow({ status: "tracking" })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    expect(out).toEqual({
      id: APP_ID,
      changed: true,
      reason: "promoted",
      currentStatus: "tailored",
      stamped: false,
    });
    expect(verbs(sb)).toEqual(["update"]);
    expect(stored(sb).status).toBe("tailored");
    // The row's other columns are the point of AC-1d: a status write is about
    // status.
    expect(stored(sb).applied_at).toBeNull();
    expect(stored(sb).notes).toBe("recruiter said Thursday");
    expect(stored(sb).tracked_at).toBe("2026-06-28T08:00:00.000Z");
  });

  it("names ONLY status in the UPDATE payload", async () => {
    const sb = client([appRow({ status: "tracking" })]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });
    expect(Object.keys(sb.calls[0].payload).sort()).toEqual(["status"]);
    expect(sb.calls[0].payload.status).toBe("tailored");
  });

  it("reads back a NARROW projection on the same statement, never '*'", async () => {
    // The RETURNING projection is how C1 learns whether it matched, and it is
    // recorded on the statement (`calls[n].select`) rather than inferable from
    // the verb sequence — widening it to `"*"` adds no call and changes no
    // verb, so nothing else in this file can see it. Asserted as a column SET
    // so the exact spacing is not pinned; `"*"` is what is refused.
    const sb = client([appRow({ status: "tracking" })]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    expect(sb.calls[0].select).not.toBe("*");
    expect(sb.calls[0].select.split(",").map((c) => c.trim()).sort()).toEqual(["id", "status"]);
  });

  it("carries the guard as an ALLOW-LIST on the same statement", async () => {
    const sb = client([appRow({ status: "tracking" })]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    // The whole four-key record, not `.some(f => f.column === "status")`.
    // `negated: false` is the field that distinguishes the allow-list from the
    // deny-list this plan forbids; omitting it is how a `.not(...)` slips
    // through a walk that "checks the column".
    expect(sb.calls[0].filters).toContainEqual({
      column: "status",
      operator: "in",
      value: PRE_APPLY_STATUSES,
      negated: false,
    });
    expect(sb.calls[0].filters).toContainEqual({
      column: "user_id",
      operator: "eq",
      value: USER_ID,
      negated: false,
    });
    expect(sb.calls[0].filters).toContainEqual({
      column: "position_id",
      operator: "eq",
      value: POSITION_ID,
      negated: false,
    });
    // No deny-list anywhere on the statement.
    expect(sb.calls[0].filters.filter((f) => f.negated)).toEqual([]);
  });

  it("promotes from each of the four pre-apply statuses", async () => {
    for (const from of PRE_APPLY_STATUSES) {
      const sb = client([appRow({ status: from })]);
      const out = await writeApplicationStatus(sb, {
        userId: USER_ID,
        positionId: POSITION_ID,
        status: "tailored",
      });
      expect({ from, changed: out.changed, reason: out.reason }).toEqual({
        from,
        changed: true,
        reason: "promoted",
      });
    }
  });

  it("reports changed:true for a SAME-VALUE promotion, because the statement matched", async () => {
    // `changed` means "the guarded statement matched a row and wrote it", not
    // "the stored value is different from what it was". The looser reading is
    // tempting and it makes a downstream field a lie: `tailorAndQueue`'s
    // summary sets `queued: changed`, so an `auto_queued` row re-queued by a
    // second cron pass would report `queued: false` — the caller then believes
    // the placement was refused and either retries it or tells the user the job
    // is not in the queue while it is sitting in it.
    //
    // The row is already at the target, so a fake that reported "no bytes
    // changed" would be reporting something true and useless.
    const sb = client([appRow({ status: "auto_queued" })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "auto_queued",
    });

    expect(out).toEqual({
      id: APP_ID,
      changed: true,
      reason: "promoted",
      currentStatus: "auto_queued",
      stamped: false,
    });
    expect(verbs(sb)).toEqual(["update"]);
    expect(stored(sb).status).toBe("auto_queued");
    expect(stored(sb).applied_at).toBeNull();
  });

  it("reports 'error' and no id when the UPDATE itself fails", async () => {
    const sb = client([appRow({ status: "tracking" })], {
      errors: { applications: { update: { message: "boom" } } },
    });
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });
    expect(out.reason).toBe("error");
    expect(out.changed).toBe(false);
    expect(out.id).toBeNull();
    expect(stored(sb).status).toBe("tracking");
  });
});

// ---------------------------------------------------------------------------
// C4 — the stamp, write-once by WHERE
// ---------------------------------------------------------------------------

describe("writeApplicationStatus — C4, the write-once stamp", () => {
  it("stamps the clock's ISO string on a first transition into applied", async () => {
    const sb = client([appRow({ status: "tracking", applied_at: null })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "applied",
    });

    expect(out).toEqual({
      id: APP_ID,
      changed: true,
      reason: "promoted",
      currentStatus: "applied",
      stamped: true,
    });
    expect(verbs(sb)).toEqual(["update", "update"]);
    expect(stored(sb).applied_at).toBe(NOW);
    expect(stored(sb).status).toBe("applied");
  });

  it("names ONLY applied_at in the stamp's payload, guarded by applied_at IS NULL", async () => {
    const sb = client([appRow({ status: "tracking", applied_at: null })]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "applied",
    });

    const stamp = sb.calls[1];
    expect(Object.keys(stamp.payload).sort()).toEqual(["applied_at"]);
    expect(stamp.payload.applied_at).toBe(NOW);
    // `.is(col, null)`, never `.eq(col, null)` — `= NULL` matches nothing, so
    // an `.eq` here would refuse every stamp on exactly the rows that need one.
    expect(stamp.filters).toContainEqual({
      column: "applied_at",
      operator: "is",
      value: null,
      negated: false,
    });
  });

  it("does NOT re-stamp a row that already carries a date", async () => {
    // The write-once property, honoured by the WHERE and not by a read.
    const sb = client([appRow({ status: "tracking", applied_at: APPLIED_AT })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "applied",
    });

    expect(out.changed).toBe(true);
    expect(out.reason).toBe("promoted");
    expect(out.stamped).toBe(false);
    // Identity against the seeded value. A truthiness assertion here passes
    // against the re-stamp defect.
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
    expect(stored(sb).applied_at).not.toBe(NOW);
    // Still two statements: the refusal is the WHERE matching zero rows, not
    // a read that decided to skip the write.
    expect(verbs(sb)).toEqual(["update", "update"]);
  });

  it("skips the stamp entirely for a pre-apply target", async () => {
    const sb = client([appRow({ status: "tracking" })]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "auto_queued",
    });
    expect(verbs(sb)).toEqual(["update"]);
    expect(stored(sb).applied_at).toBeNull();
  });

  it("RETURNS THE ID when the stamp errors — a null id here is a permanent skip", async () => {
    // `tailorAndQueueOne` throws "Could not create the application row" on a
    // falsy id, AFTER two LLM calls have been paid for, and the cron's
    // already-tracked check then blocks that posting forever. The stamp
    // failing is a missing date; it is not a missing application.
    const sb = client([appRow({ status: "tracking", applied_at: null })]);
    const sc = scripted(sb, [
      {
        match: (rec) =>
          rec.verb === "update" &&
          rec.payload &&
          Object.keys(rec.payload).join() === "applied_at",
        error: { message: "stamp boom" },
      },
    ]);

    const out = await writeApplicationStatus(sc, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "applied",
    });

    expect(out.id).toBe(APP_ID);
    expect(out.changed).toBe(true);
    expect(out.reason).toBe("stamped-failed");
    expect(out.stamped).toBe(false);
    // The promotion itself landed; only the date did not.
    expect(stored(sb).status).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// C2 — the disambiguating read-back, three-valued
// ---------------------------------------------------------------------------

describe("writeApplicationStatus — C2, protection", () => {
  it.each(APPLIED_OR_LATER_STATUSES)(
    "refuses to touch a row at '%s', and returns its id so the caller can still link its documents",
    async (protectedStatus) => {
      const sb = client([appRow({ status: protectedStatus, applied_at: APPLIED_AT })]);
      const out = await writeApplicationStatus(sb, {
        userId: USER_ID,
        positionId: POSITION_ID,
        status: "tracking",
      });

      expect(out).toEqual({
        id: APP_ID,
        changed: false,
        reason: "protected",
        currentStatus: protectedStatus,
        stamped: false,
      });
      expect(stored(sb).status).toBe(protectedStatus);
      expect(stored(sb).applied_at).toBe(APPLIED_AT);
      // Two statements: the guarded UPDATE that matched nothing, then the read
      // that says why. Not three — a refusal must not retry.
      expect(verbs(sb)).toEqual(["update", "select"]);
      expect(sb.calls).toHaveLength(2);
    },
  );

  it("refuses an applied row even when the target is also applied-or-later", async () => {
    const sb = client([appRow({ status: "offer", applied_at: APPLIED_AT })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "applied",
    });
    expect(out.reason).toBe("protected");
    expect(out.currentStatus).toBe("offer");
    expect(stored(sb).status).toBe("offer");
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("classifies a row whose stored status is outside the eleven as unknown, and does NOT retry", async () => {
    // The pair defect: under an allow-list, the complement of "protected"
    // contains a THIRD class. A two-valued C2 would retry C1 here — and the
    // retry can never match, because the allow-list excludes the value. The
    // cardinality is what catches that: exactly two statements, not three.
    const sb = client([appRow({ status: "screening", applied_at: null })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    expect(out.id).toBe(APP_ID);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("unknown-status");
    expect(out.currentStatus).toBe("screening");
    expect(verbs(sb)).toEqual(["update", "select"]);
    expect(sb.calls).toHaveLength(2);
    expect(stored(sb).status).toBe("screening");
  });

  it("treats a NULL stored status the same way, and never demotes it silently", async () => {
    const sb = client([appRow({ status: null, applied_at: APPLIED_AT })]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    expect(out.reason).toBe("unknown-status");
    expect(out.currentStatus).toBeNull();
    expect(stored(sb).status).toBeNull();
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
    expect(sb.calls).toHaveLength(2);
  });

  it("reports 'error' when the read-back itself fails", async () => {
    // `errors.applications.select` cannot touch C1: the fake resolves a forced
    // error against the statement's VERB, and C1's verb is `update` even with
    // a `.select()` chained on it.
    const sb = client([], { errors: { applications: { select: { message: "read boom" } } } });
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });
    expect(out.reason).toBe("error");
    expect(out.changed).toBe(false);
    expect(out.id).toBeNull();
  });
});

describe("writeApplicationStatus — C2, the concurrent-insert retry", () => {
  it("retries C1 exactly once when the row arrived after C1's snapshot", async () => {
    const sb = client([]);
    const sc = scripted(sb, [
      {
        // After the first statement (C1, which matched nothing) a
        // service-role inserter lands the row at a pre-apply status.
        match: (rec, index) => index === 0 && rec.verb === "update",
        after: (s) => s.seed("applications", [appRow({ status: "tracking" })]),
      },
    ]);

    const out = await writeApplicationStatus(sc, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    expect(out.changed).toBe(true);
    expect(out.reason).toBe("promoted");
    expect(out.id).toBe(APP_ID);
    // C1, C2, C1-again. Exactly once more — a loop would show four.
    expect(verbs(sb)).toEqual(["update", "select", "update"]);
    expect(sb.calls).toHaveLength(3);
    expect(stored(sb).status).toBe("tailored");
  });

  it("reports 'lost-race' when the retry also matches nothing", async () => {
    const sb = client([]);
    const sc = scripted(sb, [
      {
        match: (rec, index) => index === 0 && rec.verb === "update",
        after: (s) => s.seed("applications", [appRow({ status: "tracking" })]),
      },
      {
        // Between C2 and the retry the row is promoted past the allow-list by
        // somebody else, so the retry cannot match.
        match: (rec, index) => index === 1 && rec.verb === "select",
        after: (s) => s.seed("applications", [appRow({ status: "offer", applied_at: APPLIED_AT })]),
      },
    ]);

    const out = await writeApplicationStatus(sc, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    expect(out.changed).toBe(false);
    expect(out.reason).toBe("lost-race");
    expect(out.id).toBe(APP_ID);
    expect(out.currentStatus).toBe("offer");
    // C1, C2, C1-retry, one re-read. Four, and no more.
    expect(verbs(sb)).toEqual(["update", "select", "update", "select"]);
    expect(sb.calls).toHaveLength(4);
    expect(stored(sb).status).toBe("offer");
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });
});

// ---------------------------------------------------------------------------
// C3 — the insert that cannot demote
// ---------------------------------------------------------------------------

describe("writeApplicationStatus — C3, the insert", () => {
  it("inserts a pre-apply row naming applied_at EXPLICITLY as null", async () => {
    const sb = client([]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    expect(out.changed).toBe(true);
    expect(out.reason).toBe("inserted");
    expect(out.stamped).toBe(false);
    expect(typeof out.id).toBe("string");
    expect(out.id.length).toBeGreaterThan(0);

    const upsert = sb.calls.find((c) => c.verb === "upsert");
    expect(Object.keys(upsert.payload).sort()).toEqual([
      "applied_at",
      "position_id",
      "status",
      "user_id",
    ]);
    // THE branch assertion. Naming the column `null` is what stops the row
    // being born with a fabricated date from an unreadable column default —
    // which C4's `applied_at IS NULL` guard would then protect forever, the
    // queue DELETE would refuse to release, and NULLS-FIRST would pin to the
    // top of Tracking. `toBeNull` and not `toBeFalsy`: an omitted key is also
    // falsy.
    expect(upsert.payload.applied_at).toBeNull();
    expect(upsert.payload.status).toBe("tracking");
    expect(stored(sb).applied_at).toBeNull();
  });

  it("inserts an applied-or-later row naming applied_at as the clock's value", async () => {
    const sb = client([]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "applied",
    });

    expect(out.changed).toBe(true);
    expect(out.reason).toBe("inserted");
    expect(out.stamped).toBe(true);

    const upsert = sb.calls.find((c) => c.verb === "upsert");
    // The SAME key set as the pre-apply branch — deliberately. The two
    // branches are told apart by the value below, which is a strictly stronger
    // assertion than a key-set difference.
    expect(Object.keys(upsert.payload).sort()).toEqual([
      "applied_at",
      "position_id",
      "status",
      "user_id",
    ]);
    expect(upsert.payload.applied_at).toBe(NOW);
    expect(stored(sb).applied_at).toBe(NOW);
  });

  it("uses ON CONFLICT DO NOTHING, and reads the row back as a SEPARATE statement", async () => {
    const sb = client([]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    // Four statements, in this order. Asserted as a sequence with `toEqual`:
    // an ordering assertion written with `indexOf` is degenerate, because
    // `indexOf` is -1 for a step that never ran.
    expect(verbs(sb)).toEqual(["update", "select", "upsert", "select"]);
    expect(sb.calls).toHaveLength(4);

    const upsert = sb.calls[2];
    expect(upsert.options).toStrictEqual({
      onConflict: "user_id,position_id",
      ignoreDuplicates: true,
    });
    // THE ban, asserted directly. `select: null` is `calls`' sentinel for "no
    // `.select()` was chained onto this statement" (`supabaseFake.js`'s
    // `state.select` initial value), so this is the assertion that refuses
    // T-b's shape: a `.select()` here would make the read-back part of the
    // SAME statement, and `DO NOTHING … RETURNING` returns nothing on the
    // conflict path — so it would silently read as "the row I just wrote" and
    // hand back nothing at all.
    //
    // The verb sequence alone cannot carry this. Chaining `.select("id,
    // status")` onto the upsert adds NO call to `calls` and changes no verb;
    // before `select` was recorded, the count and the sequence below were both
    // still exactly four and the mutation was invisible. The fourth call being
    // a separate `select` is a necessary condition, not a sufficient one.
    expect(upsert.select).toBeNull();
    expect(sb.calls[3].verb).toBe("select");
    expect(sb.calls[3].payload).toBeNull();
    // And the read-back is the separate statement, still narrow. Compared as a
    // column SET so whitespace is not pinned, but `"*"` is refused: a widened
    // projection pulls the whole row — notes, urls, every future column — into
    // a decision that is about three of them.
    expect(sb.calls[3].select).not.toBe("*");
    expect(sb.calls[3].select.split(",").map((c) => c.trim()).sort()).toEqual([
      "applied_at",
      "id",
      "status",
    ]);
  });

  it("attaches NO filter to the upsert — a WHERE on an INSERT reaches the wire and never the statement", async () => {
    const sb = client([]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });
    const upsert = sb.calls.find((c) => c.verb === "upsert");
    expect(upsert.filters).toEqual([]);
  });

  it("cannot demote an existing protected row even if C3 is somehow reached", async () => {
    // The structural claim behind C3: ON CONFLICT DO NOTHING has no UPDATE
    // branch to mis-filter. Here the row appears between C2 and C3, at a
    // protected status — the worst interleaving available.
    const sb = client([]);
    const sc = scripted(sb, [
      {
        match: (rec, index) => index === 1 && rec.verb === "select",
        after: (s) => s.seed("applications", [appRow({ status: "offer", applied_at: APPLIED_AT })]),
      },
    ]);

    const out = await writeApplicationStatus(sc, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    expect(out.changed).toBe(false);
    expect(out.reason).toBe("lost-race");
    expect(out.currentStatus).toBe("offer");
    expect(out.id).toBe(APP_ID);
    expect(stored(sb).status).toBe("offer");
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("reports 'no-row' when the row is deleted under it before the read-back", async () => {
    const sb = client([]);
    const sc = scripted(sb, [
      {
        match: (rec) => rec.verb === "upsert",
        after: (s) => s.seed("applications", []),
      },
    ]);

    const out = await writeApplicationStatus(sc, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    // The WHOLE outcome, not `toMatchObject`. `currentStatus` and `stamped`
    // are the two fields a partial matcher leaves unchecked, and they are the
    // two a caller reads to decide what to render — a `stamped: true` on a row
    // that does not exist is a claim that a date was written.
    expect(out).toEqual({
      id: null,
      changed: false,
      reason: "no-row",
      currentStatus: null,
      stamped: false,
    });
  });

  it("retries the read-back once, and succeeds", async () => {
    const sb = client([]);
    let readsAfterInsert = 0;
    const sc = scripted(sb, [
      {
        match: (rec, index) => {
          if (index < 2 || rec.verb !== "select") return false;
          readsAfterInsert += 1;
          return readsAfterInsert === 1;
        },
        error: { message: "transient" },
      },
    ]);

    const out = await writeApplicationStatus(sc, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    expect(out.changed).toBe(true);
    expect(out.reason).toBe("inserted");
    expect(typeof out.id).toBe("string");
    // C1, C2, upsert, failed read, retried read.
    expect(sb.calls).toHaveLength(5);
  });

  it("reports 'id-unread' when the read-back errors twice", async () => {
    const sb = client([]);
    const sc = scripted(sb, [
      {
        match: (rec, index) => index >= 2 && rec.verb === "select",
        error: { message: "still down" },
      },
    ]);

    const out = await writeApplicationStatus(sc, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    expect(out).toEqual({
      id: null,
      changed: false,
      reason: "id-unread",
      currentStatus: null,
      stamped: false,
    });
    // Exactly two attempts at the read-back, not a loop.
    expect(sb.calls).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// The whole table, swept
// ---------------------------------------------------------------------------

describe("writeApplicationStatus — swept over the whole vocabulary", () => {
  it("promotes exactly the pre-apply rows and protects exactly the applied-or-later rows", async () => {
    // One row per status, one client each. A `toEqual` over the resulting
    // table, so both a missing refusal and a spurious one fail.
    const table = {};
    for (const from of APPLICATION_STATUSES) {
      const sb = client([appRow({ status: from, applied_at: APPLIED_AT })]);
      const out = await writeApplicationStatus(sb, {
        userId: USER_ID,
        positionId: POSITION_ID,
        status: "tailored",
      });
      table[from] = { changed: out.changed, reason: out.reason, status: stored(sb).status };
    }

    expect(table).toEqual({
      tracking: { changed: true, reason: "promoted", status: "tailored" },
      tailored: { changed: true, reason: "promoted", status: "tailored" },
      auto_tailored: { changed: true, reason: "promoted", status: "tailored" },
      auto_queued: { changed: true, reason: "promoted", status: "tailored" },
      applied: { changed: false, reason: "protected", status: "applied" },
      phone_screen: { changed: false, reason: "protected", status: "phone_screen" },
      interviewing: { changed: false, reason: "protected", status: "interviewing" },
      offer: { changed: false, reason: "protected", status: "offer" },
      accepted: { changed: false, reason: "protected", status: "accepted" },
      rejected: { changed: false, reason: "protected", status: "rejected" },
      withdrawn: { changed: false, reason: "protected", status: "withdrawn" },
    });
  });

  it("never nulls a stored applied_at, whatever the target status", async () => {
    // D1's exact shape, swept in both directions. Identity against the seeded
    // string every time.
    const dates = {};
    for (const from of APPLICATION_STATUSES) {
      for (const target of ["tracking", "tailored", "auto_queued", "applied"]) {
        const sb = client([appRow({ status: from, applied_at: APPLIED_AT })]);
        await writeApplicationStatus(sb, {
          userId: USER_ID,
          positionId: POSITION_ID,
          status: target,
        });
        dates[`${from}->${target}`] = stored(sb).applied_at;
      }
    }
    const wrong = Object.entries(dates).filter(([, v]) => v !== APPLIED_AT);
    expect(wrong).toEqual([]);
  });

  it("leaves a different user's row alone", async () => {
    const sb = client([
      appRow({ id: "app-other", user_id: "user-2", status: "tracking" }),
    ]);
    const out = await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });
    // Not found for THIS user, so it is an insert — and the other user's row
    // is untouched.
    expect(out.reason).toBe("inserted");
    expect(sb.row("applications", (r) => r.id === "app-other").status).toBe("tracking");
    expect(sb.rows("applications")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// setApplicationStatusByUser — the named user-intent door
// ---------------------------------------------------------------------------

describe("setApplicationStatusByUser — the confirmation contract", () => {
  const door = (over = {}) => ({
    applicationId: APP_ID,
    userId: USER_ID,
    status: "tailored",
    appliedAt: null,
    appliedAtStored: APPLIED_AT,
    confirm: () => true,
    ...over,
  });

  it("throws when confirm is not supplied — a wiring miss must crash, not no-op", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const { confirm, ...withoutConfirm } = door();
    expect(confirm).toBeTypeOf("function");
    await expect(setApplicationStatusByUser(sb, withoutConfirm)).rejects.toThrow(TypeError);
    expect(sb.calls).toHaveLength(0);
  });

  it("throws when confirm is not a function", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    await expect(setApplicationStatusByUser(sb, door({ confirm: true }))).rejects.toThrow(TypeError);
    expect(sb.calls).toHaveLength(0);
  });

  it("issues ZERO statements when the user declines, and the spy proves it was asked", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const confirm = vi.fn(() => false);

    const out = await setApplicationStatusByUser(sb, door({ confirm }));

    // The positive control comes FIRST. "Nothing happened" is satisfied by a
    // door that never ran at all.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("declined");
    expect(sb.calls).toHaveLength(0);
    expect(stored(sb).status).toBe("applied");
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("names the date being destroyed in what it asks", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const confirm = vi.fn(() => false);
    await setApplicationStatusByUser(sb, door({ confirm }));

    expect(confirm).toHaveBeenCalledTimes(1);
    const asked = confirm.mock.calls[0][0];
    expect(typeof asked).toBe("string");
    expect(asked.length).toBeGreaterThan(0);
    // "4 July 2026" in some human form — assert the year and the day are both
    // present rather than pinning a locale-specific rendering.
    expect(asked).toMatch(/2026/);
    expect(asked).toMatch(/\b4\b/);
  });

  it("does NOT ask when the write cannot destroy a date", async () => {
    // `confirm` is invoked iff the write would change a non-NULL `applied_at`.
    // The positive control is the declined test above, which proves the spy
    // shape works; this one is the other direction.
    const sb = client([appRow({ status: "tailored", applied_at: null })]);
    const confirm = vi.fn(() => true);

    const out = await setApplicationStatusByUser(
      sb,
      door({ status: "applied", appliedAtStored: null, appliedAt: undefined, confirm }),
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(out.changed).toBe(true);
    // EXACTLY one statement, not `> 0`. A `> 0` here cannot separate "the door
    // wrote the row" from "some statement ran": it passes against a door that
    // issued a read it did not need, and against one that issued the write
    // twice. The whole point of this case is that skipping the confirmation
    // does not skip — or duplicate — the write.
    expect(verbs(sb)).toEqual(["update"]);
    expect(stored(sb).status).toBe("applied");
  });

  it("does NOT ask when the supplied date is the SAME date already stored", async () => {
    // The other half of the biconditional. `confirm` is invoked iff the write
    // would change a NON-NULL `applied_at`, and "would change" has three ways
    // to be false: the payload names no date (above), the stored date is null
    // (nothing to destroy), and the named date equals the stored one. Only the
    // first was covered, so a door that asked whenever the payload merely
    // MENTIONED a date — prompting "Remove the record that you applied on
    // 4 July?" on an ordinary status edit that re-sends the date unchanged —
    // was green. That prompt is worse than useless: it trains the user to
    // dismiss the one dialog standing between them and a lost date.
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const confirm = vi.fn(() => true);

    const out = await setApplicationStatusByUser(
      sb,
      door({ status: "offer", appliedAt: APPLIED_AT, appliedAtStored: APPLIED_AT, confirm }),
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(out.changed).toBe(true);
    expect(stored(sb).status).toBe("offer");
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("DOES ask when the stored date is non-null and the write moves it", async () => {
    // The positive direction of the same biconditional, on the same shape as
    // the two negatives above, so the three differ in exactly one input.
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const confirm = vi.fn(() => true);

    await setApplicationStatusByUser(
      sb,
      door({
        status: "applied",
        appliedAt: "2026-08-01T00:00:00.000Z",
        appliedAtStored: APPLIED_AT,
        confirm,
      }),
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(stored(sb).applied_at).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("setApplicationStatusByUser — the statement it issues", () => {
  const door = (over = {}) => ({
    applicationId: APP_ID,
    userId: USER_ID,
    status: "tailored",
    appliedAtStored: APPLIED_AT,
    confirm: () => true,
    ...over,
  });

  it("refuses a target status outside the eleven, and issues no statement at all", async () => {
    // FAIL-CLOSED ON THE DOOR A HUMAN DRIVES. C0 enforces this on the machine
    // door; without it here the principle is enforced on the writer nobody
    // types into and nowhere on the writer that exists to take typed intent.
    //
    // It is reachable. `EditAppDialog`'s `Select` is sourced from
    // `USER_SELECTABLE_STATUSES` PLUS one appended entry carrying whatever the
    // row currently holds when that value is outside the subset — so the door's
    // `status` is not bounded by the eight the dialog lists, and a twelfth
    // status added to the live CHECK by a future integration reaches it. The
    // eleven are a CHECK constraint, so a write of a twelfth is rejected by
    // Postgres anyway: refusing before IO turns a round trip that fails into a
    // refusal that says why, and — because this door has no allow-list on its
    // WHERE — it is the ONLY thing standing between an unknown value and the
    // row.
    //
    // Exact zero statements, not "no applications writes": a refusal that costs
    // a round trip is not a refusal before IO.
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const out = await setApplicationStatusByUser(sb, door({ status: "screening" }));

    expect(out.changed).toBe(false);
    expect(out.id).toBeNull();
    expect(out.reason).toBe("unknown-status");
    expect(sb.calls).toHaveLength(0);
    // The row is untouched — including the date, which this door is the only
    // one allowed to clear.
    expect(stored(sb).status).toBe("applied");
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("refuses a null or missing target status the same way", async () => {
    // The other shapes `classifyStatus` calls unknown, so the refusal cannot be
    // a hand-written equality against one literal.
    for (const status of [null, undefined, "", "APPLIED", "tracking "]) {
      const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
      const out = await setApplicationStatusByUser(sb, door({ status }));
      expect({ status, reason: out.reason, changed: out.changed }).toEqual({
        status,
        reason: "unknown-status",
        changed: false,
      });
      expect(sb.calls).toHaveLength(0);
    }
  });

  it("clears the date and demotes, together, on a confirmed un-apply", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const out = await setApplicationStatusByUser(sb, door({ appliedAt: null }));

    expect(out.changed).toBe(true);
    expect(out.id).toBe(APP_ID);
    // The VALUE, not membership in the Reason union. `toContain(out.reason)`
    // over the twelve reasons passes when this door reports `"inserted"`,
    // `"declined"` or `"error"` — every outcome this test exists to distinguish
    // is inside the set it was checking against, so the assertion could not
    // fail for any reachable return.
    expect(out.reason).toBe("promoted");
    expect(stored(sb).status).toBe("tailored");
    expect(stored(sb).applied_at).toBeNull();
    // ONE statement. The date and the status move together or not at all: two
    // statements would leave a window in which the row is demoted and still
    // dated, which is D1's shape arriving through the door that is allowed to
    // demote.
    expect(verbs(sb)).toEqual(["update"]);
  });

  it("carries the tenant filter, so the door cannot reach another user's row", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    await setApplicationStatusByUser(sb, door({ appliedAt: null }));

    const write = appWrites(sb)[0];
    expect(write.filters).toContainEqual({
      column: "user_id",
      operator: "eq",
      value: USER_ID,
      negated: false,
    });
    expect(write.filters).toContainEqual({
      column: "id",
      operator: "eq",
      value: APP_ID,
      negated: false,
    });
  });

  it("refuses another user's row rather than writing it", async () => {
    const sb = client([appRow({ id: APP_ID, user_id: "user-2", status: "applied", applied_at: APPLIED_AT })]);
    const out = await setApplicationStatusByUser(sb, door({ appliedAt: null }));

    expect(out.changed).toBe(false);
    expect(stored(sb).status).toBe("applied");
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("omits applied_at from the payload when appliedAt is not supplied at all", async () => {
    // Omitted must be distinguishable from `null`: omitted means "this save is
    // not about the date", and it is what stops an ordinary URL edit
    // round-tripping the column.
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const out = await setApplicationStatusByUser(sb, door({ status: "offer" }));

    const write = appWrites(sb)[0];
    expect(Object.keys(write.payload).sort()).toEqual(["status"]);
    expect(out.changed).toBe(true);
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("names applied_at with the supplied value when one is supplied", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    const later = "2026-08-01T00:00:00.000Z";
    await setApplicationStatusByUser(sb, door({ status: "applied", appliedAt: later }));

    const write = appWrites(sb)[0];
    expect(Object.keys(write.payload).sort()).toEqual(["applied_at", "status"]);
    expect(write.payload.applied_at).toBe(later);
    expect(stored(sb).applied_at).toBe(later);
  });

  it("compare-and-sets on a NULL stored date with .is(), so a dateless row is still savable", async () => {
    // `.eq(col, null)` serialises as `= NULL` and matches nothing, so a
    // single-form CAS would refuse EVERY save on a dateless row — the most
    // common row in the table — reporting a conflict for a row nobody touched.
    // This is the strongest available form of that check: the save must
    // SUCCEED, which it cannot under an `.eq`.
    const sb = client([appRow({ status: "tailored", applied_at: null })]);
    const out = await setApplicationStatusByUser(
      sb,
      door({ status: "applied", appliedAt: APPLIED_AT, appliedAtStored: null }),
    );

    expect(out.reason).not.toBe("stale");
    expect(out.changed).toBe(true);
    expect(stored(sb).applied_at).toBe(APPLIED_AT);

    const write = appWrites(sb)[0];
    expect(write.filters).toContainEqual({
      column: "applied_at",
      operator: "is",
      value: null,
      negated: false,
    });
  });

  it("compare-and-sets on a stored date with .eq() carrying the byte-for-byte stored string", async () => {
    const sb = client([appRow({ status: "applied", applied_at: APPLIED_AT })]);
    await setApplicationStatusByUser(sb, door({ appliedAt: null }));

    const write = appWrites(sb)[0];
    expect(write.filters).toContainEqual({
      column: "applied_at",
      operator: "eq",
      value: APPLIED_AT,
      negated: false,
    });
  });

  it("reports 'stale' when the row moved between the read and the write", async () => {
    // The CAS operand is the value the dialog was opened with; the row now
    // carries a different one.
    const sb = client([appRow({ status: "applied", applied_at: "2026-08-20T10:00:00.000Z" })]);
    const out = await setApplicationStatusByUser(sb, door({ appliedAt: null }));

    expect(out.changed).toBe(false);
    expect(out.reason).toBe("stale");
    // Nothing was written, so the newer date survives.
    expect(stored(sb).applied_at).toBe("2026-08-20T10:00:00.000Z");
    expect(stored(sb).status).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// loadAppliedOrLaterExternalIds
// ---------------------------------------------------------------------------

describe("loadAppliedOrLaterExternalIds", () => {
  function manyClient(rows) {
    return makeStatefulSupabase(
      {
        applications: rows,
        positions: APPLICATION_STATUSES.map((s, i) => ({
          id: `pos-${i}`,
          external_id: `gh-${i}`,
          title: "Senior Engineer",
          company: "Acme",
        })).concat([{ id: "pos-x", external_id: "gh-x", title: "T", company: "C" }]),
      },
      {
        user: { id: USER_ID },
        relationships: {
          "applications.positions": { localKey: "position_id", table: "positions", foreignKey: "id" },
        },
      },
    );
  }

  const oneRowPerStatus = () =>
    APPLICATION_STATUSES.map((status, i) => ({
      id: `app-${i}`,
      user_id: USER_ID,
      position_id: `pos-${i}`,
      status,
      applied_at: null,
    }));

  it("returns exactly the seven applied-or-later external ids", async () => {
    const sb = manyClient(oneRowPerStatus());
    const { ids } = await loadAppliedOrLaterExternalIds(sb, USER_ID);

    const expected = APPLICATION_STATUSES.map((s, i) => [s, `gh-${i}`])
      .filter(([s]) => APPLIED_OR_LATER_STATUSES.includes(s))
      .map(([, ext]) => ext)
      .sort();
    expect([...ids].sort()).toEqual(expected);
  });

  it("also picks up a pre-apply row that still carries a date", async () => {
    // The disjunct exists to SURFACE D1's victims rather than leave them
    // invisible. A row at `tracking` with a real date is exactly that shape.
    const sb = manyClient([
      { id: "app-d", user_id: USER_ID, position_id: "pos-x", status: "tracking", applied_at: APPLIED_AT },
    ]);
    const { ids, byExternalId } = await loadAppliedOrLaterExternalIds(sb, USER_ID);

    expect([...ids]).toEqual(["gh-x"]);
    expect(byExternalId.get("gh-x")).toEqual({
      status: "tracking",
      appliedAt: APPLIED_AT,
      applicationId: "app-d",
    });
  });

  it("carries status, appliedAt and applicationId for each entry", async () => {
    const sb = manyClient([
      { id: "app-o", user_id: USER_ID, position_id: "pos-x", status: "offer", applied_at: APPLIED_AT },
    ]);
    const { byExternalId } = await loadAppliedOrLaterExternalIds(sb, USER_ID);
    expect(byExternalId.get("gh-x")).toEqual({
      status: "offer",
      appliedAt: APPLIED_AT,
      applicationId: "app-o",
    });
  });

  it("de-duplicates a row that satisfies BOTH halves of the union", async () => {
    const sb = manyClient([
      { id: "app-b", user_id: USER_ID, position_id: "pos-x", status: "applied", applied_at: APPLIED_AT },
    ]);
    const { ids, byExternalId } = await loadAppliedOrLaterExternalIds(sb, USER_ID);

    expect(ids.size).toBe(1);
    expect(byExternalId.size).toBe(1);
    expect(byExternalId.get("gh-x").status).toBe("applied");
  });

  it("excludes another user's rows — from BOTH halves of the union", async () => {
    // The other user's row carries a REAL DATE, and that is the whole point of
    // the fixture. This loader is two queries unioned in JS; the second is the
    // date disjunct `.not("applied_at", "is", null)`. Give every fixture row
    // `applied_at: null` and that query returns `[]` whatever its filters are —
    // so its `.eq("user_id", …)` has ZERO coverage and can be deleted with the
    // whole file still green. A dateless probe returns another user's status,
    // their real `applied_at` and their `applicationId` straight into this
    // user's map, which feeds the applied badge and the toggle's branch.
    //
    // `offer` + a date means the row is reachable by BOTH queries, so BOTH
    // tenant filters are load-bearing here. This user's row is deliberately
    // DATELESS, so the date query's only possible answer is the other user's
    // row: nothing else can mask a missing filter.
    const sb = manyClient([
      { id: "app-mine", user_id: USER_ID, position_id: "pos-x", status: "offer", applied_at: null },
      { id: "app-theirs", user_id: "user-2", position_id: "pos-0", status: "offer", applied_at: APPLIED_AT },
    ]);
    const { ids, byExternalId } = await loadAppliedOrLaterExternalIds(sb, USER_ID);

    expect([...ids]).toEqual(["gh-x"]);
    // And the map, not just the id set: the leak the id set catches is the
    // visible half, but `byExternalId` is what carries the other user's status,
    // date and application id into this user's session.
    expect(byExternalId.size).toBe(1);
    expect(byExternalId.has("gh-0")).toBe(false);
    expect(byExternalId.get("gh-x")).toEqual({
      status: "offer",
      appliedAt: null,
      applicationId: "app-mine",
    });
  });

  it("issues two queries and unions them in JS — never .or()", async () => {
    // Not a style rule. `supabaseFake` throws on `.or()` by construction, so an
    // `.or()` here fails loudly; this assertion is what says the two-query
    // shape was the intent rather than an accident.
    const sb = manyClient(oneRowPerStatus());
    await loadAppliedOrLaterExternalIds(sb, USER_ID);

    const selects = sb.calls.filter((c) => c.table === "applications" && c.verb === "select");
    expect(selects).toHaveLength(2);
    const operators = selects.map((c) =>
      c.filters.filter((f) => f.column !== "user_id").map((f) => `${f.negated ? "not." : ""}${f.operator}`),
    );
    expect(operators).toEqual([["in"], ["not.is"]]);
  });

  it("returns empty structures, not null, when the user has no rows", async () => {
    const sb = manyClient([]);
    const { ids, byExternalId } = await loadAppliedOrLaterExternalIds(sb, USER_ID);
    expect(ids.size).toBe(0);
    expect(byExternalId.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteUntrackedApplication
// ---------------------------------------------------------------------------

describe("deleteUntrackedApplication", () => {
  it("deletes a tracking row with no date, and says it did", async () => {
    const sb = client([appRow({ status: "tracking", applied_at: null })]);
    const out = await deleteUntrackedApplication(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
    });
    expect(out).toEqual({ deleted: true });
    expect(sb.rows("applications")).toEqual([]);
  });

  it("refuses a tracking row that still carries a date, and says it did NOT delete", async () => {
    // The one part of this fix that helps damage already in the database: a
    // row D1 demoted to `tracking` whose real application date is still
    // attached. Reporting `deleted:false` is what lets the caller keep the
    // chip rather than optimistically dropping it.
    const sb = client([appRow({ status: "tracking", applied_at: APPLIED_AT })]);
    const out = await deleteUntrackedApplication(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
    });
    expect(out).toEqual({ deleted: false });
    expect(sb.rows("applications")).toHaveLength(1);
    expect(stored(sb).applied_at).toBe(APPLIED_AT);
  });

  it("expresses both refusals as filters on the DELETE itself", async () => {
    const sb = client([appRow({ status: "tracking", applied_at: null })]);
    await deleteUntrackedApplication(sb, { userId: USER_ID, positionId: POSITION_ID });

    const del = sb.calls.find((c) => c.verb === "delete");
    expect(del.filters).toContainEqual({
      column: "status",
      operator: "eq",
      value: "tracking",
      negated: false,
    });
    expect(del.filters).toContainEqual({
      column: "applied_at",
      operator: "is",
      value: null,
      negated: false,
    });
    expect(del.filters).toContainEqual({
      column: "user_id",
      operator: "eq",
      value: USER_ID,
      negated: false,
    });
    expect(del.filters).toContainEqual({
      column: "position_id",
      operator: "eq",
      value: POSITION_ID,
      negated: false,
    });
  });

  it("deletes nothing at any status other than tracking", async () => {
    // Deliberately NOT widened to PRE_APPLY_STATUSES: a row at `tailored` is
    // not deletable by untrack today, and widening it is a feature change
    // rather than a data-loss fix.
    const table = {};
    for (const status of APPLICATION_STATUSES.filter((s) => s !== "tracking")) {
      const sb = client([appRow({ status, applied_at: null })]);
      const out = await deleteUntrackedApplication(sb, {
        userId: USER_ID,
        positionId: POSITION_ID,
      });
      table[status] = { deleted: out.deleted, survives: sb.rows("applications").length };
    }
    const expected = Object.fromEntries(
      APPLICATION_STATUSES.filter((s) => s !== "tracking").map((s) => [
        s,
        { deleted: false, survives: 1 },
      ]),
    );
    expect(table).toEqual(expected);
  });

  it("cannot reach another user's row", async () => {
    const sb = client([appRow({ user_id: "user-2", status: "tracking", applied_at: null })]);
    const out = await deleteUntrackedApplication(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
    });
    expect(out).toEqual({ deleted: false });
    expect(sb.rows("applications")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deleteApplicationForUser — the general "Delete" button's guarded statement
// (app/hooks/useApplicationDialogs.js's handleDeleteApplication). Unlike
// deleteUntrackedApplication above (narrow: only a dateless `tracking` row,
// for the "remove from queue" action), this is the delete reachable on a row
// at ANY status, and today it carries NO tenant filter and NO status guard at
// all: `supabase.from("applications").delete().eq("id", app.id)`. Whether the
// missing tenant filter is exploitable depends on RLS state on `applications`,
// which is unknown and must not be assumed either way — which is exactly why
// the filter belongs on the statement.
//
// Refuse, not "confirm harder": once a hard DELETE lands, nothing downstream
// can catch it, so the guard here is the SAME allow-list discipline as C1
// (`.in("status", PRE_APPLY_STATUSES)`, un-negated, never a deny-list) rather
// than merely another dialog in front of the same unfiltered statement.
// ---------------------------------------------------------------------------

describe("deleteApplicationForUser", () => {
  it("deletes a pre-apply row, carrying BOTH the tenant filter and the status allow-list on the DELETE itself", async () => {
    const sb = client([appRow({ status: "tracking" })]);
    const out = await deleteApplicationForUser(sb, {
      userId: USER_ID,
      applicationId: APP_ID,
    });

    expect(out).toEqual({ deleted: true, reason: "deleted", id: APP_ID, currentStatus: null });
    expect(sb.rows("applications")).toEqual([]);

    const del = sb.calls.find((c) => c.verb === "delete");
    // The whole four-key filter records, not `.some(f => f.column === "id")` —
    // `negated: false` is what distinguishes the allow-list from a deny-list a
    // walk-by glance would also call "a guard".
    expect(del.filters).toContainEqual({ column: "id", operator: "eq", value: APP_ID, negated: false });
    expect(del.filters).toContainEqual({ column: "user_id", operator: "eq", value: USER_ID, negated: false });
    expect(del.filters).toContainEqual({
      column: "status",
      operator: "in",
      value: PRE_APPLY_STATUSES,
      negated: false,
    });
    expect(del.filters.filter((f) => f.negated)).toEqual([]);
  });

  it("deletes from each of the four pre-apply statuses — the common case, unchanged", async () => {
    for (const status of PRE_APPLY_STATUSES) {
      const sb = client([appRow({ status })]);
      const out = await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: APP_ID });
      expect({ status, deleted: out.deleted, reason: out.reason }).toEqual({
        status,
        deleted: true,
        reason: "deleted",
      });
      expect(sb.rows("applications")).toEqual([]);
    }
  });

  it("refuses to delete a row at EACH applied-or-later status, and it survives untouched", async () => {
    for (const status of APPLIED_OR_LATER_STATUSES) {
      const sb = client([appRow({ status, applied_at: APPLIED_AT })]);
      const out = await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: APP_ID });
      expect({ status, deleted: out.deleted, reason: out.reason, currentStatus: out.currentStatus }).toEqual({
        status,
        deleted: false,
        reason: "protected",
        currentStatus: status,
      });
      // The refusal is on the DELETE's WHERE, not a read that decided to skip
      // it: exactly two statements (the delete that matched nothing, then the
      // read that says why), never zero and never a retry.
      expect(verbs(sb)).toEqual(["delete", "select"]);
      expect(sb.rows("applications")).toHaveLength(1);
      expect(stored(sb).status).toBe(status);
      expect(stored(sb).applied_at).toBe(APPLIED_AT);
    }
  });

  it("refuses a row whose stored status is outside the eleven, and does not delete it", async () => {
    const sb = client([appRow({ status: "screening" })]);
    const out = await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: APP_ID });
    expect(out.deleted).toBe(false);
    expect(out.reason).toBe("unknown-status");
    expect(out.currentStatus).toBe("screening");
    expect(sb.rows("applications")).toHaveLength(1);
  });

  it("cannot reach another user's row, even though the id matches — reported as not-found, not protected", async () => {
    // Reported the same as "no such row" rather than disclosing the OTHER
    // user's status: this user's read-back is tenant-scoped too.
    const sb = client([appRow({ id: APP_ID, user_id: "user-2", status: "tracking" })]);
    const out = await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: APP_ID });
    expect(out).toEqual({ deleted: false, reason: "not-found", id: null, currentStatus: null });
    expect(sb.rows("applications")).toHaveLength(1);
    expect(sb.row("applications", (r) => r.id === APP_ID).status).toBe("tracking");
  });

  it("reports 'not-found' when the id does not exist at all", async () => {
    const sb = client([]);
    const out = await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: "nope" });
    expect(out).toEqual({ deleted: false, reason: "not-found", id: null, currentStatus: null });
  });

  it("refuses with 'no-key' before any IO when userId or applicationId is missing", async () => {
    for (const args of [
      { userId: null, applicationId: APP_ID },
      { userId: USER_ID, applicationId: null },
      { userId: "", applicationId: "" },
    ]) {
      const sb = client([appRow({ status: "tracking" })]);
      const out = await deleteApplicationForUser(sb, args);
      expect(out).toEqual({ deleted: false, reason: "no-key", id: null, currentStatus: null });
      // Exact zero, not "no applications writes": a refusal that costs a round
      // trip is not a refusal before IO.
      expect(sb.calls).toHaveLength(0);
      expect(sb.rows("applications")).toHaveLength(1);
    }
  });

  it("reports 'error' when the DELETE itself fails, and deletes nothing", async () => {
    const sb = client([appRow({ status: "tracking" })], {
      errors: { applications: { delete: { message: "boom" } } },
    });
    const out = await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: APP_ID });
    expect(out).toEqual({ deleted: false, reason: "error", id: null, currentStatus: null });
    expect(sb.rows("applications")).toHaveLength(1);
  });

  it("reports 'error' when the disambiguating read-back fails", async () => {
    const sb = client([appRow({ status: "offer", applied_at: APPLIED_AT })], {
      errors: { applications: { select: { message: "read boom" } } },
    });
    const out = await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: APP_ID });
    expect(out).toEqual({ deleted: false, reason: "error", id: null, currentStatus: null });
    expect(sb.rows("applications")).toHaveLength(1);
  });

  it("issues exactly ONE statement on success — no unnecessary read-back", async () => {
    const sb = client([appRow({ status: "tracking" })]);
    await deleteApplicationForUser(sb, { userId: USER_ID, applicationId: APP_ID });
    expect(verbs(sb)).toEqual(["delete"]);
    expect(sb.calls).toHaveLength(1);
  });
});
