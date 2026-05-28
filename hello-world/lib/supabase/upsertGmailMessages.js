import { createClient } from "./server";

/**
 * Upsert a batch of Gmail messages for a user.
 * Skips messages already stored (conflict on user_id + gmail_message_id).
 *
 * @param {string} userId
 * @param {Array<{ id, threadId, subject, from, date, snippet }>} messages
 */
export async function upsertGmailMessages(userId, messages) {
  if (!messages || messages.length === 0) return;

  const supabase = await createClient();

  const rows = messages.map((message) => ({
    user_id: userId,
    gmail_message_id: message.id,
    thread_id: message.threadId || null,
    subject: message.subject || null,
    from_address: message.from || null,
    message_date: message.date ? new Date(message.date).toISOString() : null,
    snippet: message.snippet || null,
  }));

  const { data, error } = await supabase
    .from("gmail_messages")
    .upsert(rows, { onConflict: "user_id,gmail_message_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("[upsertGmailMessages] failed:", error.message, error.details, error.hint);
    throw error;
  }

  console.log(`[upsertGmailMessages] inserted ${data?.length ?? 0} of ${rows.length} messages for user ${userId}`);
}
