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
      // Update existing stage
      const { data, error } = await supabase
        .from("interview_stages")
        .update(payload)
        .eq("id", stageId)
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
 * Fetch all interview stages for an application
 * @param {Object} supabase - Supabase client
 * @param {string} applicationId - Application ID
 * @returns {Promise<Array>} - Array of interview stages
 */
export async function getInterviewStages(supabase, applicationId) {
  try {
    const { data, error } = await supabase
      .from("interview_stages")
      .select("*")
      .eq("application_id", applicationId)
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

/**
 * Delete an interview stage
 * @param {Object} supabase - Supabase client
 * @param {string} stageId - Stage ID to delete
 * @returns {Promise<boolean>} - Success
 */
export async function deleteInterviewStage(supabase, stageId) {
  try {
    const { error } = await supabase
      .from("interview_stages")
      .delete()
      .eq("id", stageId);
    if (error) {
      console.error("[deleteInterviewStage] failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[deleteInterviewStage] unexpected error:", err);
    return false;
  }
}
