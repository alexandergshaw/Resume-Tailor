// N60 S4 -- the feature kill switch, read PER KEY with no shared decision
// (AC-R6), and FAILING CLOSED on a read error (owner ruling): a broken switch
// must refuse the feature, distinguishably from a deliberate off-switch, and
// never fall through and read as a live (enabled) feature.

/**
 * @param {object} admin service-role Supabase client
 * @param {string} key e.g. "auto_tailor" or "alert_mail"
 * @returns {Promise<
 *   | {ok:true,  disabled:false}
 *   | {ok:true,  disabled:true}
 *   | {ok:false, disabled:true, reason:"kill_switch_unreadable"}>}
 */
export async function isFeatureDisabled(admin, key) {
  const { data, error } = await admin
    .from("feature_kill_switches")
    .select("disabled")
    .eq("key", key)
    .maybeSingle();

  if (error) return { ok: false, disabled: true, reason: "kill_switch_unreadable" };
  if (!data) return { ok: true, disabled: false };
  return { ok: true, disabled: !!data.disabled };
}
