import { createClient } from "./server";

/**
 * Upsert a batch of matched Gmail messages for a user.
 * Skips messages already stored (conflict on user_id + gmail_message_id).
 *
 * @param {string} userId
 * @param {Array<{ message: object, application: object|null, score: number }>} matched
 *   - message: { id, threadId, subject, from, date, snippet }
 *   - application: matched application row or null
 *   - score: numeric match score from emailUtils
 */
export async function upsertGmailMessages(userId, matched) {
  if (!matched || matched.length === 0) return;

  const supabase = await createClient();

  const rows = matched.map(({ message, application, score }) => ({
    user_id: userId,
    gmail_message_id: message.id,
    thread_id: message.threadId || null,
    subject: message.subject || null,
    from_address: message.from || null,
    message_date: message.date ? new Date(message.date).toISOString() : null,
    snippet: message.snippet || null,
    match_score: Math.round(score ?? 0),
    application_id: application?.id ?? null,
  }));

  const { error } = await supabase
    .from("gmail_messages")
    .upsert(rows, { onConflict: "user_id,gmail_message_id", ignoreDuplicates: true });

  if (error) {
    console.error("[upsertGmailMessages] failed:", error.message || error);
  }
}
