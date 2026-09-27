// N60 S4 test fixture -- a Supabase-admin fake that models the ONE property
// the owner ruling turns on: an atomic conditional increment is a single
// server-side critical section, and read-modify-write is not.
//
// WHAT THIS FAKE FAITHFULLY MODELS
// -------------------------------
// * `.rpc(fn, args)` runs its handler SYNCHRONOUSLY -- it reads and mutates the
//   shared store in one uninterrupted step before the awaited promise resolves.
//   That is exactly Postgres's guarantee for a single
//   `insert ... on conflict do update set n = n + 1 where n < cap returning`
//   statement (the row lock serialises concurrent writers). A module that
//   delegates its cap decision to one such rpc cannot be split by any
//   interleaving reachable from JavaScript, because there is only one await and
//   nothing runs between the read and the write.
// * `.from(t).select(...)...maybeSingle()` then `.from(t).upsert(...)` is the
//   read-modify-write shape. It has TWO awaits, and `selectBarrier(n)` below
//   makes the reads of `n` concurrent callers all resolve against the SAME
//   pre-increment value -- the lost-update the owner's "two overlapping cron
//   runs must not both spend against one read count" describes.
//
// WHAT THIS FAKE CANNOT AND DOES NOT PROVE (stated so no reader over-claims)
// -------------------------------------------------------------------------
// It cannot prove Postgres actually serialises the real reserve statement --
// that is a database guarantee, executable only against real Postgres or
// PGlite, and PGlite is NOT installed in this checkout (not in package.json,
// no node_modules entry, no instantiation anywhere in the repo; migration
// tests here are SQL-text parses, see n60SpendLedgerMigrationShape.test.js).
// This fake proves the APPLICATION CODE relies on a single atomic operation
// rather than read-then-write. The migration-shape test is the separate
// witness that the reserve FUNCTION the code calls is itself cap-guarded.

import { vi } from "vitest";

/** A promise that resolves on the next macrotask, so two concurrent callers'
 *  awaits genuinely interleave rather than running to completion in issue
 *  order. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {object} [opts]
 * @param {object} [opts.seed]        initial counts, see fields below
 * @param {Set<string>} [opts.failRpc]        rpc fn names that reject
 * @param {boolean} [opts.failSelect]         every table select rejects
 * @param {Set<string>} [opts.failTable]      table names whose reads reject
 * @param {Record<string,{disabled:boolean}>} [opts.killSwitches]
 */
export function makeAtomicLedgerFake(opts = {}) {
  const {
    failRpc = new Set(),
    failSelect = false,
    failTable = new Set(),
    killSwitches = {},
  } = opts;

  // Shared, mutable "database".
  const store = {
    autoTailor: new Map(), // `${user}|${day}` -> count
    mailAddress: new Map(), // `${user}|${day}|${recipient}` -> count
    mailAccount: new Map(), // `${user}|${day}` -> count
    kill: new Map(Object.entries(killSwitches)),
    ...(opts.seed || {}),
  };

  const calls = [];

  // A barrier that holds the first `n` select reads until all `n` are pending,
  // then releases them together -- deterministically producing the stale-read
  // interleave that a read-modify-write implementation loses updates on.
  let barrierN = 0;
  let barrierWaiters = [];
  function selectBarrier(n) {
    barrierN = n;
    barrierWaiters = [];
  }
  function passBarrier() {
    if (barrierN <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      barrierWaiters.push(resolve);
      if (barrierWaiters.length >= barrierN) {
        const waiters = barrierWaiters;
        barrierWaiters = [];
        barrierN = 0;
        for (const w of waiters) w();
      }
    });
  }

  const autoKey = (u, d) => `${u}|${d}`;
  const addrKey = (u, d, r) => `${u}|${d}|${r}`;

  function rpc(fn, args) {
    calls.push({ verb: "rpc", fn, args });
    if (failRpc.has(fn)) {
      return Promise.resolve({ data: null, error: { message: `rpc ${fn} failed` } });
    }
    // Synchronous critical section: read + mutate before returning.
    if (fn === "reserve_auto_tailor_slot") {
      const { p_user_id, p_day, p_cap } = args;
      const k = autoKey(p_user_id, p_day);
      const cur = store.autoTailor.get(k) || 0;
      if (cur < p_cap) {
        store.autoTailor.set(k, cur + 1);
        return Promise.resolve({ data: [{ reserved: true, used_today: cur + 1 }], error: null });
      }
      return Promise.resolve({ data: [{ reserved: false, used_today: cur }], error: null });
    }
    if (fn === "reserve_alert_mail_slot") {
      const { p_user_id, p_day, p_recipient, p_address_cap, p_account_cap } = args;
      const ak = autoKey(p_user_id, p_day);
      const rk = addrKey(p_user_id, p_day, p_recipient);
      const acct = store.mailAccount.get(ak) || 0;
      const addr = store.mailAddress.get(rk) || 0;
      if (acct >= p_account_cap) {
        return Promise.resolve({ data: [{ reserved: false, blocked_by: "account" }], error: null });
      }
      if (addr >= p_address_cap) {
        return Promise.resolve({ data: [{ reserved: false, blocked_by: "address" }], error: null });
      }
      store.mailAccount.set(ak, acct + 1);
      store.mailAddress.set(rk, addr + 1);
      return Promise.resolve({ data: [{ reserved: true, blocked_by: null }], error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
  }

  // Query builder supporting the read-modify-write path (select/upsert) and the
  // kill-switch read. Deliberately minimal.
  function from(table) {
    const state = { table, filters: {}, op: "select", columns: null };
    const builder = {
      select(columns) {
        state.op = "select";
        state.columns = columns;
        return builder;
      },
      eq(col, val) {
        state.filters[col] = val;
        return builder;
      },
      async maybeSingle() {
        calls.push({ verb: "select", table, filters: { ...state.filters } });
        if (failSelect || failTable.has(table)) {
          return { data: null, error: { message: `select on ${table} failed` } };
        }
        if (table === "feature_kill_switches") {
          const row = store.kill.get(state.filters.key);
          return { data: row ? { disabled: row.disabled } : null, error: null };
        }
        if (table === "auto_tailor_spend_daily") {
          await passBarrier();
          const k = autoKey(state.filters.user_id, state.filters.day);
          const cur = store.autoTailor.get(k);
          return { data: cur == null ? null : { tailored_count: cur }, error: null };
        }
        return { data: null, error: null };
      },
      async upsert(row) {
        calls.push({ verb: "upsert", table, row });
        await tick();
        if (table === "auto_tailor_spend_daily") {
          store.autoTailor.set(autoKey(row.user_id, row.day), row.tailored_count);
        }
        return { data: null, error: null };
      },
    };
    return builder;
  }

  return {
    admin: { rpc: vi.fn(rpc), from: vi.fn(from) },
    store,
    calls,
    selectBarrier,
    autoKey,
    addrKey,
  };
}
