// N60 S4 -- AC-S1: the durable, ATOMIC per-user, per-UTC-day tailor ceiling.
//
// OWNER RULING this module is built to (see autoTailorSpendLedger.test.js's
// header for the full reasoning): the cap decision is ONE atomic conditional
// increment, delegated to the server-side `reserve_auto_tailor_slot` rpc via
// the admin (service-role) client -- never a client-side select-then-write.
// The increment is durable the moment the rpc resolves, so a run that dies
// immediately after reserving cannot let a later run over-spend, and two
// overlapping runs racing the same user/day cannot both spend against one
// stale read (Postgres's row-lock guarantee on the reserve statement itself;
// see n60SpendLedgerMigrationShape.test.js for the text witness that the
// function it calls is cap-guarded).
//
// REFUSE WHEN IT CANNOT COUNT: an rpc error returns counter_unreadable, never
// a guessed usedToday:0 -- a broken counter must not be indistinguishable
// from a genuinely idle day.

/**
 * @param {object} admin service-role Supabase client
 * @param {string} userId
 * @param {{cap:number, now?:() => Date}} opts
 * @returns {Promise<
 *   | {ok:true,  reserved:true,  usedToday:number}
 *   | {ok:true,  reserved:false, reason:"per_day_ceiling_reached", usedToday:number}
 *   | {ok:false, reason:"counter_unreadable"}>}
 */
export async function reserveDailyTailor(admin, userId, { cap, now = () => new Date() }) {
  // REFUSE WHEN IT CANNOT COUNT covers a rejected/thrown rpc call too, not
  // just an { error } response -- either way the counter could not be read,
  // and this must never be mistaken for an idle day.
  let data;
  let error;
  try {
    ({ data, error } = await admin.rpc("reserve_auto_tailor_slot", {
      p_user_id: userId,
      p_day: utcDayKey(now()),
      p_cap: cap,
    }));
  } catch (err) {
    error = err;
  }
  if (error) return { ok: false, reason: "counter_unreadable" };

  const row = data?.[0];
  if (row?.reserved) {
    return { ok: true, reserved: true, usedToday: row.used_today };
  }
  return { ok: true, reserved: false, reason: "per_day_ceiling_reached", usedToday: row?.used_today ?? 0 };
}

// UTC calendar day as "YYYY-MM-DD", derived from getUTC* only -- a local-time
// boundary would shift a late-day reservation onto the wrong day.
function utcDayKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
