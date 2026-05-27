/**
 * Inserts a row into `chat_message_logs` capturing what the user asked the
 * in-app AI chat and what tab/section of the UI they were on. Best-effort:
 * never throws, always returns void.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   userId: string,
 *   message: string,
 *   tab?: string | null,
 *   section?: string | null,
 *   hasPinnedContext?: boolean,
 *   pinnedLabel?: string | null,
 *   attachedFileCount?: number,
 * }} params
 */
export async function logChatMessage(supabase, params) {
  try {
    if (!supabase || !params) return;
    const { userId, message } = params;
    if (!userId || typeof message !== "string" || !message.trim()) return;

    const { error } = await supabase.from("chat_message_logs").insert({
      user_id: userId,
      message: message.trim(),
      tab: params.tab || null,
      section: params.section || null,
      has_pinned_context: !!params.hasPinnedContext,
      pinned_label: params.pinnedLabel || null,
      attached_file_count: Number.isFinite(params.attachedFileCount)
        ? params.attachedFileCount
        : 0,
    });
    if (error) {
      // Logging is best-effort, but surface the reason so missing rows are
      // diagnosable (RLS rejection, missing table, bad column, etc.).
      console.error("[logChatMessage] insert failed:", error.message || error);
    }
  } catch (err) {
    console.error("[logChatMessage] unexpected error:", err);
  }
}
