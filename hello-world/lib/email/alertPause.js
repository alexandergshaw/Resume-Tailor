// N60 S6 (AC-E4) -- the account-level alert-mail pause READER.
//
// A single per-account row (public.user_alert_settings.alerts_paused, S4
// migration) is read by the cron (as service_role) and by the status route (as
// the user's own client) to decide whether to send any alert mail. This
// mirrors lib/feed/killSwitch.js's settled posture exactly, because the
// failure directions are the same:
//
//   * a MISSING row reads as NOT paused -- RLS select-own returns zero rows
//     for a user who never wrote one, and that must not be treated as a
//     refusal.
//   * a READ ERROR FAILS CLOSED -- treat the account as paused rather than
//     sending, distinguishable from a genuine not-paused via `ok:false`.
//
// @param {object} client any Supabase client (admin for the cron, the user's
//   own session client for the status route) -- the read is filtered on
//   userId either way, so a global (unfiltered) decision is never possible.
// @param {string} userId
// @returns {Promise<
//   | {ok:true,  paused:false}
//   | {ok:true,  paused:true}
//   | {ok:false, paused:true, reason:"alert_settings_unreadable"}>}
export async function readAlertsPaused(client, userId) {
  const { data, error } = await client
    .from("user_alert_settings")
    .select("alerts_paused")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false, paused: true, reason: "alert_settings_unreadable" };
  if (!data) return { ok: true, paused: false };
  return { ok: true, paused: !!data.alerts_paused };
}
