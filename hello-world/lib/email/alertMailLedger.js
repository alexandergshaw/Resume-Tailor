// N60 S4 -- AC-E2: the durable, ATOMIC per-address (4) and per-account (10)
// per-UTC-day ceilings on outbound alert mail.
//
// Same owner ruling as lib/feed/autoTailorSpendLedger.js: the cap decision is
// ONE atomic reserve on the server (`reserve_alert_mail_slot`, called via the
// admin/service-role client), never a client-side select-then-write. The
// account ceiling is checked first (matching the function's own precedence),
// so `blocked_by: "account"` always wins over `"address"` when both would
// bind. REFUSE WHEN IT CANNOT COUNT: an rpc error returns counter_unreadable,
// never a guessed reserved:true.

/**
 * @param {object} admin service-role Supabase client
 * @param {string} userId
 * @param {string} recipient
 * @param {{perAddressCap:number, perAccountCap:number, now?:() => Date}} opts
 * @returns {Promise<
 *   | {ok:true,  reserved:true}
 *   | {ok:true,  reserved:false, reason:"address_day_ceiling"|"account_day_ceiling"}
 *   | {ok:false, reason:"counter_unreadable"}>}
 */
export async function reserveMailSend(admin, userId, recipient, { perAddressCap, perAccountCap, now = () => new Date() }) {
  // REFUSE WHEN IT CANNOT COUNT covers a rejected/thrown rpc call too, not
  // just an { error } response.
  let data;
  let error;
  try {
    ({ data, error } = await admin.rpc("reserve_alert_mail_slot", {
      p_user_id: userId,
      p_day: utcDayKey(now()),
      p_recipient: recipient,
      p_address_cap: perAddressCap,
      p_account_cap: perAccountCap,
    }));
  } catch (err) {
    error = err;
  }
  if (error) return { ok: false, reason: "counter_unreadable" };

  const row = data?.[0];
  if (row?.reserved) return { ok: true, reserved: true };
  if (row?.blocked_by === "account") return { ok: true, reserved: false, reason: "account_day_ceiling" };
  return { ok: true, reserved: false, reason: "address_day_ceiling" };
}

// UTC calendar day as "YYYY-MM-DD", derived from getUTC* only.
function utcDayKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
