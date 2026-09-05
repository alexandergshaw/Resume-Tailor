import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import {
  setApplicationStatusByUser,
  writeApplicationStatus,
} from "@/lib/supabase/applicationStatusWriter.js";
import { PRE_APPLY_STATUSES } from "@/lib/applications/statusVocabulary.js";

// ---------------------------------------------------------------------------
// THE GUARD WALK, AND THE FIVE CONTROLS THAT MAKE ITS CLEAN RESULT BELIEVABLE.
//
// The walk's claim is "every `applications` status write issued by
// `writeApplicationStatus` — THE MACHINE DOOR — carries its guard on the same
// statement".
//
// It is NOT "every `applications` write in this chunk", and the difference is
// not pedantry. AC-3b carries exactly one named exemption:
// `setApplicationStatusByUser` "exists precisely to write status without the
// AC-1a guard, under AC-2a's confirmation. It is exempt, by name, and it is the
// only exemption." Run this walk byte-for-byte over that door and it reports an
// unguarded write — CORRECTLY, because the door really does write `status` with
// no allow-list on the statement. A header claiming the universal therefore
// describes an instrument whose own subject falsifies it, and control 6 below
// EXERCISES that case rather than leaving a reader to discover it: the
// exemption is asserted, with the walk's exact verdict, so "the guard walk
// passes" can never be read as "nothing in this chunk writes status
// unguarded".
//
// The claim that remains is still a UNIVERSAL NEGATIVE over a collection the
// instrument builds itself, which is the single easiest kind of test to make
// permanently, silently green:
//
//   - `[].every(predicate)` is `true`. A walk that records nothing reports
//     total compliance.
//   - `calls.push` writes `table: null` for `rpc`, so a naive
//     `c.table.startsWith(...)` throws where `c.table === "applications"`
//     merely skips.
//   - The filter record is `{column, operator, value, negated}`. ANY future
//     change to that shape — a rename, a nesting, an added wrapper — turns
//     every `f.operator === "in"` check into a permanent `false`, and the
//     whole walk into a silent no-op that still passes.
//
// And `sb.calls` had ZERO consumers repo-wide before this chunk, so none of
// that is hypothetical: this walk is brand-new, never-executed instrument
// code, not an extension of established coverage.
//
// All six controls live in THIS file, beside the walk they control.
// Splitting them across files is how a control gets deleted without anyone
// noticing the walk it was protecting. The reporting rule that goes with them:
// this walk's result may be cited as evidence ONLY alongside controls 1-6 by
// name and outcome, AND alongside the scope sentence above. A bare "the guard
// walk passes" is the claim these controls exist to stop anyone making, and
// "every status write in this chunk is guarded" is the claim control 6 exists
// to stop anyone making.
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const POSITION_ID = "pos-1";
const NOW = "2026-09-05T12:00:00.000Z";

const WRITE_VERBS = new Set(["insert", "update", "upsert", "delete"]);

/**
 * Walks a `makeStatefulSupabase` `calls` array and reports every statement
 * that writes `applications.status` WITHOUT carrying its guard on the same
 * statement.
 *
 * Guarded means one of exactly two things:
 *   - an UPDATE carrying the allow-list `.in("status", PRE_APPLY_STATUSES)`,
 *     un-negated. A `.not(...)` deny-list is NOT a guard here: a status added
 *     to the live CHECK by a future integration evaluates TRUE against it and
 *     is silently demoted.
 *   - an upsert whose options carry `ignoreDuplicates: true`, i.e.
 *     `ON CONFLICT DO NOTHING`. That statement has no UPDATE branch to
 *     mis-filter, so it is structurally incapable of demoting. A
 *     merge-duplicates upsert is exactly D1 and is reported.
 *
 * `table` is `null` for an `rpc` record, so every comparison here is written
 * to tolerate it rather than to throw on it.
 */
function walkStatusWrites(calls) {
  const writes = (calls || []).filter(
    (c) => c && c.table === "applications" && WRITE_VERBS.has(c.verb),
  );
  const payloadNamesStatus = (p) =>
    !!p && typeof p === "object" && !Array.isArray(p) &&
    Object.prototype.hasOwnProperty.call(p, "status");
  const statusWrites = writes.filter((c) => payloadNamesStatus(c.payload));

  const unguarded = [];
  for (const c of statusWrites) {
    if (c.verb === "upsert") {
      if (!(c.options && c.options.ignoreDuplicates === true)) {
        unguarded.push({ verb: c.verb, missing: "ON CONFLICT DO NOTHING (ignoreDuplicates: true)" });
      }
      continue;
    }
    const allowList = (c.filters || []).find(
      (f) => f.column === "status" && f.operator === "in" && f.negated === false,
    );
    if (!allowList) {
      unguarded.push({ verb: c.verb, missing: 'an un-negated .in("status", PRE_APPLY_STATUSES)' });
    }
  }
  return { writes, statusWrites, unguarded };
}

function client(rows = []) {
  return makeStatefulSupabase(
    {
      applications: rows,
      positions: [{ id: POSITION_ID, external_id: "gh-1", title: "Senior Engineer", company: "Acme" }],
    },
    { user: { id: USER_ID } },
  );
}

const preApplyRow = () => ({
  id: "app-1",
  user_id: USER_ID,
  position_id: POSITION_ID,
  status: "tracking",
  applied_at: null,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// CONTROL 1 — CARDINALITY. An exact expected count, never `> 0`.
// ---------------------------------------------------------------------------

describe("guard walk — control 1: cardinality", () => {
  it("the C1-miss → C3-insert path records exactly 2 writes and exactly 4 statements", async () => {
    const sb = client([]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    const { writes, statusWrites, unguarded } = walkStatusWrites(sb.calls);

    // The exact count comes FIRST. `writes.every(isGuarded)` without a count
    // beside it is satisfied by an empty `writes`.
    expect(writes).toHaveLength(2);
    expect(statusWrites).toHaveLength(2);
    expect(unguarded).toEqual([]);

    // And the TOTAL, because `calls` accumulates across every `from()` on one
    // client. A per-verb count alone swallows an unexpected extra statement —
    // a retry firing twice, a read-back issued three times, a stray
    // `.select()`. Both numbers, both exact.
    expect(sb.calls).toHaveLength(4);
    expect(sb.calls.map((c) => c.verb)).toEqual(["update", "select", "upsert", "select"]);
  });

  it("a C1 hit that skips the stamp records exactly 1 write and exactly 1 statement", async () => {
    const sb = client([preApplyRow()]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    const { writes, statusWrites, unguarded } = walkStatusWrites(sb.calls);
    expect(writes).toHaveLength(1);
    expect(statusWrites).toHaveLength(1);
    expect(unguarded).toEqual([]);
    expect(sb.calls).toHaveLength(1);
  });

  it("the protected path records exactly 1 write, 2 statements, and changes nothing", async () => {
    const sb = client([{ ...preApplyRow(), status: "offer", applied_at: "2026-07-04T15:32:11.000Z" }]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    const { writes, unguarded } = walkStatusWrites(sb.calls);
    expect(writes).toHaveLength(1);
    expect(unguarded).toEqual([]);
    expect(sb.calls).toHaveLength(2);
    expect(sb.row("applications", (r) => r.id === "app-1").status).toBe("offer");
  });

  it("[the empty-collection hazard, stated as a test] an empty walk reports compliance — which is why the counts above exist", async () => {
    // `[].every(...)` is `true`, so this is what a broken instrument looks
    // like. The assertion is not that this is wrong; it is that "no unguarded
    // writes" and "no writes at all" are the same output, and only a
    // cardinality assertion tells them apart.
    const empty = walkStatusWrites([]);
    expect(empty.unguarded).toEqual([]);
    expect(empty.statusWrites).toHaveLength(0);
  });

  it("tolerates an rpc record, whose table is null", async () => {
    const sb = client([preApplyRow()]);
    await sb.rpc("some_function", { a: 1 });
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    expect(sb.calls.some((c) => c.table === null)).toBe(true);
    const { writes, unguarded } = walkStatusWrites(sb.calls);
    expect(writes).toHaveLength(1);
    expect(unguarded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 2 — A NEGATIVE CONTROL IN THE SAME FILE. One write the walk must
// REJECT. Without it, "every write is guarded" and "the walk cannot detect an
// unguarded write" produce identical output.
// ---------------------------------------------------------------------------

describe("guard walk — control 2: it can say no", () => {
  it("rejects an unguarded applications UPDATE, and names the missing filter", async () => {
    const sb = client([preApplyRow()]);

    // CONTROL, NOT PRODUCTION CODE. This statement is deliberately unguarded:
    // it writes `status` with no `.in("status", ...)` on the same chain, which
    // is D1's exact shape. It lives inside the test body on its own throwaway
    // client so no source sweep can mistake it for a real call site.
    await sb.from("applications").update({ status: "tailored" }).eq("user_id", USER_ID);

    const { writes, statusWrites, unguarded } = walkStatusWrites(sb.calls);
    expect(writes).toHaveLength(1);
    expect(statusWrites).toHaveLength(1);
    expect(unguarded).toEqual([
      { verb: "update", missing: 'an un-negated .in("status", PRE_APPLY_STATUSES)' },
    ]);
  });

  it("rejects a DENY-LIST guard, which is the shape that looks right in a diff", async () => {
    // CONTROL. `.not("status", "in", "(...)")` reads like a guard and is one
    // for the eleven values we know about — but a twelfth status added to the
    // live CHECK evaluates TRUE against it and is silently demoted. The walk
    // must not accept it.
    const sb = client([preApplyRow()]);
    await sb
      .from("applications")
      .update({ status: "tailored" })
      .eq("user_id", USER_ID)
      .not("status", "in", "(applied,offer)");

    const { unguarded } = walkStatusWrites(sb.calls);
    expect(unguarded).toHaveLength(1);
    expect(unguarded[0].missing).toMatch(/un-negated/);
  });

  it("rejects a merge-duplicates upsert that names status — D1 itself", async () => {
    // CONTROL. This is `upsertApplication` as it stands today.
    const sb = client([preApplyRow()]);
    await sb
      .from("applications")
      .upsert(
        { user_id: USER_ID, position_id: POSITION_ID, status: "tracking", applied_at: null },
        { onConflict: "user_id,position_id" },
      );

    const { unguarded } = walkStatusWrites(sb.calls);
    expect(unguarded).toEqual([
      { verb: "upsert", missing: "ON CONFLICT DO NOTHING (ignoreDuplicates: true)" },
    ]);
  });

  it("does NOT reject a write that names no status at all", async () => {
    // The other direction: `tailorAndQueueOne`'s metadata update and the
    // apply route's `auto_apply_opened_at` write are not status writes, and a
    // walk that flagged them would be un-actionable noise.
    const sb = client([preApplyRow()]);
    await sb
      .from("applications")
      .update({ auto_apply_opened_at: NOW })
      .eq("user_id", USER_ID);

    const { writes, statusWrites, unguarded } = walkStatusWrites(sb.calls);
    expect(writes).toHaveLength(1);
    expect(statusWrites).toEqual([]);
    expect(unguarded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 3 — SHAPE. Deep-equal one recorded filter against the literal
// record. This is the control that survives a refactor of `supabaseFake.js`.
// ---------------------------------------------------------------------------

describe("guard walk — control 3: the filter record's shape", () => {
  it("records the guard as the whole four-key object, with negated pinned false", async () => {
    const sb = client([preApplyRow()]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });

    const guardedUpdate = sb.calls.find((c) => c.verb === "update");

    // A `toContainEqual` on the whole record, not `.some(f => f.column ===
    // "status")`. If the record ever stops being
    // `{column, operator, value, negated}` this goes RED — whereas every
    // operator check elsewhere in the walk would silently go `false` and the
    // walk would become a no-op that still reports success.
    //
    // `negated: false` is pinned explicitly: it is the field that
    // distinguishes the allow-list from the deny-list, and omitting it is how
    // a `.not(...)` slips through a walk that "checks the column".
    expect(guardedUpdate.filters).toContainEqual({
      column: "status",
      operator: "in",
      value: PRE_APPLY_STATUSES,
      negated: false,
    });
  });

  it("the recorded value IS the vocabulary's array, not a hand-typed copy", async () => {
    const sb = client([preApplyRow()]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });
    const guard = sb.calls
      .find((c) => c.verb === "update")
      .filters.find((f) => f.column === "status");

    // REFERENTIAL identity, with `toBe`. The structural form
    // (`expect([...guard.value]).toEqual([...PRE_APPLY_STATUSES])`) spreads
    // BOTH sides into fresh arrays and then compares their contents, so a
    // hand-typed `["auto_queued","auto_tailored","tailored","tracking"]` in the
    // writer passes it — which is precisely the drift this assertion exists to
    // stop. This is the only assertion in the chunk that enforces the
    // one-home-no-drift property at the statement: everything else compares
    // values, and two arrays with equal values are exactly what a second copy
    // of the vocabulary looks like on the day it is written, before it starts
    // to diverge.
    //
    // It is provable here because the fake shallow-clones each filter record
    // (`filters.map(f => ({...f}))`), so `f.value` is the SAME array object the
    // caller passed to `.in()` — not a copy of it. If that ever changes, this
    // goes red rather than silently weakening, and control 3 above is the
    // assertion that says why.
    expect(guard.value).toBe(PRE_APPLY_STATUSES);
    // Four, and exactly four. A guard widened by hand to include an
    // applied-or-later status is a demotion waiting to happen. Kept beside the
    // identity check: `toBe` alone would still pass if the vocabulary module
    // itself were widened, and that is the other way this guard grows.
    expect(guard.value).toHaveLength(4);
  });

  it("[control] the shape assertion can fail — a renamed key is not deep-equal", () => {
    // Proves control 3's matcher is doing real work rather than passing on a
    // subset. `toContainEqual` is exact on the whole object.
    const renamed = [{ col: "status", operator: "in", value: PRE_APPLY_STATUSES, negated: false }];
    expect(renamed).not.toContainEqual({
      column: "status",
      operator: "in",
      value: PRE_APPLY_STATUSES,
      negated: false,
    });
  });
});

// ---------------------------------------------------------------------------
// CONTROL 4 — PER-STATEMENT, on the `options` field. Both directions in ONE
// scenario, on one client and one `calls` array.
// ---------------------------------------------------------------------------

describe("guard walk — control 4: options is populated per statement", () => {
  it("records the upsert's conflict clause and the update's absence of one, on the same client", async () => {
    const sb = client([]);
    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tracking",
    });

    const update = sb.calls.find((c) => c.verb === "update");
    const upsert = sb.calls.find((c) => c.verb === "upsert");

    // One assertion alone proves nothing here: a field that is always `true`
    // and a field that is correctly `true` look the same. The PAIR is what
    // proves `options` is read from each builder's own state rather than
    // carried stale across statements.
    expect(upsert.options).toStrictEqual({
      onConflict: "user_id,position_id",
      ignoreDuplicates: true,
    });
    expect(update.options).toStrictEqual({ onConflict: undefined, ignoreDuplicates: false });

    // And they came from ONE client, in this order, so "per statement" is the
    // only explanation available. Asserted as a sequence rather than with
    // `indexOf` comparisons: `indexOf` is -1 for a statement that never ran,
    // which makes the usual ordering assertion pass on a missing step.
    expect(sb.calls.map((c) => c.verb)).toEqual(["update", "select", "upsert", "select"]);
    expect(sb.calls.filter((c) => c.options !== undefined)).toHaveLength(sb.calls.length);
  });

  it("the walk's upsert branch actually reads options, not just the verb", async () => {
    // Paired with control 2's merge-duplicates rejection: the same verb, the
    // same payload, the same filters — only `options.ignoreDuplicates` differs,
    // and the verdicts differ.
    const sb = client([preApplyRow()]);
    const payload = { user_id: USER_ID, position_id: POSITION_ID, status: "tracking", applied_at: null };
    await sb.from("applications").upsert(payload, { onConflict: "user_id,position_id" });
    await sb
      .from("applications")
      .upsert(payload, { onConflict: "user_id,position_id", ignoreDuplicates: true });

    const { statusWrites, unguarded } = walkStatusWrites(sb.calls);
    expect(statusWrites).toHaveLength(2);
    expect(unguarded).toEqual([
      { verb: "upsert", missing: "ON CONFLICT DO NOTHING (ignoreDuplicates: true)" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 5 — MUTATION PROOF.
//
// A walk that has never been observed failing has never been observed working.
// The mutation is run OUTSIDE the working tree: `applicationStatusWriter.js`
// is copied to the scratchpad, ONE `.in("status", PRE_APPLY_STATUSES)` is
// deleted from C1, a scratch vitest config is pointed at the copy, and this
// file is run against it. The result — vitest's own
// `Test Files N failed | M passed` line, and which assertion failed — is
// recorded in the step's report alongside controls 1-4.
//
// Recorded at authoring time, against a complete scratchpad reference:
//     Test Files  1 failed (1)
//          Tests  6 failed | 9 passed (15)
// and the first failure was the WALK saying no, not merely a count moving:
//     "a C1 hit that skips the stamp records exactly 1 write and exactly 1
//      statement" — expected [] to deeply equal
//      [{ verb: "update", missing: 'an un-negated .in("status",
//       PRE_APPLY_STATUSES)' }]
// Both control-3 assertions went red in the same run, which is the other half:
// the guard is gone from the record, not merely from the outcome.
//
// It is recorded there rather than asserted here because a test cannot delete
// a line from its own subject and stay a test. What IS asserted here is the
// walk's response to the same statement shape the mutation produces: control
// 2's first case is byte-for-byte what C1 becomes when its allow-list is
// removed — an `applications` UPDATE naming `status`, filtered only on
// `user_id`. Control 2 is therefore the in-file half of control 5, and the
// scratch run is the half that proves the real module reaches it.
// ---------------------------------------------------------------------------

describe("guard walk — control 5: the mutation's shape, asserted in-file", () => {
  it("an unguarded C1 is exactly the statement control 2 rejects", async () => {
    const sb = client([preApplyRow()]);

    // C1 with its allow-list deleted, and nothing else changed.
    await sb
      .from("applications")
      .update({ status: "tailored" })
      .eq("user_id", USER_ID)
      .eq("position_id", POSITION_ID)
      .select("id, status");

    const { statusWrites, unguarded } = walkStatusWrites(sb.calls);
    expect(statusWrites).toHaveLength(1);
    expect(unguarded).toEqual([
      { verb: "update", missing: 'an un-negated .in("status", PRE_APPLY_STATUSES)' },
    ]);

    // And the mutation is only detectable because the guard is on the
    // STATEMENT: the row was pre-apply, so the write succeeds either way. A
    // walk that checked outcomes instead of filters would see nothing.
    expect(sb.row("applications", (r) => r.id === "app-1").status).toBe("tailored");
  });
});

// ---------------------------------------------------------------------------
// CONTROL 6 — THE EXEMPTION, EXERCISED.
//
// The walk's subject is the MACHINE door. AC-3b names exactly one exemption —
// `setApplicationStatusByUser`, which "exists precisely to write status without
// the AC-1a guard, under AC-2a's confirmation … and it is the only exemption".
//
// Run the walk over that door and it says `unguarded`. That is the correct
// answer and it is asserted here, for two reasons that only hold together:
//
//   - It stops the header's scope sentence from being an unbacked claim. A file
//     that SAYS "the machine door only" and never runs the other door has not
//     shown that the other door is the thing it excluded; it has only avoided
//     the question. Control 2's unguarded UPDATE is hand-built inside a test
//     body, so it proves the walk can say no about a statement nobody ships.
//     This one proves it says no about a statement this chunk DOES ship.
//   - It makes the exemption falsifiable in the other direction. If the user
//     door ever grows an allow-list — or is quietly re-routed through
//     `writeApplicationStatus` — this test goes red, and someone has to decide
//     whether the exemption still exists rather than discovering months later
//     that a door documented as exempt is not.
//
// What the exemption is NOT: a hole. The user door's guards are on the same
// statement too, they are just different guards — a tenant `.eq("user_id", …)`,
// a compare-and-set on `applied_at`, and an explicit typed confirmation before
// any of it. That is asserted in `applicationStatusWriter.test.js`, not here;
// this walk is deliberately blind to them, which is exactly why its verdict on
// this door must never be read as a defect report.
// ---------------------------------------------------------------------------

describe("guard walk — control 6: the ONE named exemption, exercised", () => {
  const APPLIED_AT = "2026-07-04T15:32:11.000Z";

  it("reports setApplicationStatusByUser as unguarded — the AC-3b exemption, by name", async () => {
    const sb = client([{ ...preApplyRow(), status: "applied", applied_at: APPLIED_AT }]);

    const out = await setApplicationStatusByUser(sb, {
      applicationId: "app-1",
      userId: USER_ID,
      status: "tailored",
      appliedAt: null,
      appliedAtStored: APPLIED_AT,
      confirm: () => true,
    });

    // POSITIVE CONTROL FIRST. A door that refused, threw, or never ran also
    // produces "no unguarded writes" — and would make the verdict below vacuous
    // rather than exempt.
    expect(out.changed).toBe(true);
    expect(sb.row("applications", (r) => r.id === "app-1").status).toBe("tailored");
    expect(sb.row("applications", (r) => r.id === "app-1").applied_at).toBeNull();

    const { writes, statusWrites, unguarded } = walkStatusWrites(sb.calls);
    expect(writes).toHaveLength(1);
    expect(statusWrites).toHaveLength(1);
    // The walk's verdict, in full. This is the sentence the header's scope
    // exists to explain: it is EXPECTED, it is NOT a finding, and a reader who
    // cites "the guard walk reports zero unguarded writes" without this case
    // beside it is citing a result that was never run over this door.
    expect(unguarded).toEqual([
      { verb: "update", missing: 'an un-negated .in("status", PRE_APPLY_STATUSES)' },
    ]);
  });

  it("and the machine door in the SAME run is still guarded — one client, both doors", async () => {
    // The pair. One `calls` array holding one exempt write and one guarded
    // write, so "the walk reports exactly one unguarded write" cannot be
    // satisfied by a walk that reports everything, and the exemption cannot be
    // confused with a walk that has stopped working.
    const sb = client([preApplyRow()]);

    await writeApplicationStatus(sb, {
      userId: USER_ID,
      positionId: POSITION_ID,
      status: "tailored",
    });
    await setApplicationStatusByUser(sb, {
      applicationId: "app-1",
      userId: USER_ID,
      status: "offer",
      confirm: () => true,
    });

    const { statusWrites, unguarded } = walkStatusWrites(sb.calls);
    expect(statusWrites).toHaveLength(2);
    expect(unguarded).toEqual([
      { verb: "update", missing: 'an un-negated .in("status", PRE_APPLY_STATUSES)' },
    ]);
    expect(sb.row("applications", (r) => r.id === "app-1").status).toBe("offer");
  });
});
