/**
 * Upsert (create or update) an interview stage
 * @param {Object} supabase - Supabase client
 * @param {Object} params - Parameters
 * @param {string} params.userId - User ID
 * @param {string} params.applicationId - Application ID
 * @param {string} [params.stageId] - Stage ID (if updating)
 * @param {string} params.stageName - Stage name (e.g., "Technical Round 1")
 * @param {string} params.stageType - phone_screen | technical | behavioral | system_design | hiring_manager | panel | offer_call | other
 * @param {Date|string} [params.scheduledAt] - When the interview is/was scheduled
 * @param {number} [params.durationMinutes] - Duration in minutes
 * @param {string} [params.outcome] - pending | passed | failed | cancelled
 * @param {string[]} [params.interviewerNames] - Array of interviewer names
 * @param {string} [params.notes] - Post-interview notes
 * @returns {Promise<string|null>} - Stage ID or null on error
 */
export async function upsertInterviewStage(supabase, {
  userId,
  applicationId,
  stageId,
  stageName,
  stageType,
  scheduledAt,
  durationMinutes,
  outcome,
  interviewerNames,
  notes,
}) {
  try {
    const payload = {
      user_id: userId,
      application_id: applicationId,
      stage_name: stageName,
      stage_type: stageType,
      ...(scheduledAt && { scheduled_at: scheduledAt }),
      ...(durationMinutes && { duration_minutes: durationMinutes }),
      ...(outcome && { outcome }),
      ...(interviewerNames && { interviewer_names: interviewerNames }),
      ...(notes && { notes }),
    };

    if (stageId) {
      // Update existing stage. N37: `.eq("user_id", userId)` is the fix --
      // without it, `payload` (shared with the INSERT branch above and
      // therefore always carrying `user_id`/`application_id`) let a
      // cross-account caller not merely edit someone else's row but
      // REASSIGN its ownership outright, since the UPDATE's own WHERE
      // clause matched on `id` alone. Precedent for this exact tenant-filter
      // retrofit: lib/supabase/applicationStatusWriter.js's
      // deleteApplicationForUser (`.eq("id", ...).eq("user_id", ...)`).
      const { data, error } = await supabase
        .from("interview_stages")
        .update(payload)
        .eq("id", stageId)
        .eq("user_id", userId)
        .select("id")
        .single();
      if (error) {
        console.error("[upsertInterviewStage] update failed:", error);
        return null;
      }
      return data?.id ?? null;
    } else {
      // Insert new stage
      const { data, error } = await supabase
        .from("interview_stages")
        .insert([payload])
        .select("id")
        .single();
      if (error) {
        console.error("[upsertInterviewStage] insert failed:", error);
        return null;
      }
      return data?.id ?? null;
    }
  } catch (err) {
    console.error("[upsertInterviewStage] unexpected error:", err);
    return null;
  }
}

/**
 * Fetch all interview stages for an application. N37: scoped by BOTH
 * application_id AND user_id -- an application_id-only filter let any
 * authenticated caller who guessed an applicationId read another account's
 * stages. Object-param signature, matching this module's own dominant
 * convention (upsertInterviewStage already takes one).
 * @param {Object} supabase - Supabase client
 * @param {{applicationId: string, userId: string}} args
 * @returns {Promise<Array>} - Array of interview stages
 */
export async function getInterviewStages(supabase, { applicationId, userId }) {
  try {
    const { data, error } = await supabase
      .from("interview_stages")
      .select("*")
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: false });
    if (error) {
      console.error("[getInterviewStages] failed:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("[getInterviewStages] unexpected error:", err);
    return [];
  }
}
