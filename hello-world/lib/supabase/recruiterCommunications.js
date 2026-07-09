export async function listRecruiterCommunications(supabase, applicationId) {
  try {
    const { data, error } = await supabase
      .from("recruiter_communications")
      .select(`
        id,
        application_id,
        stage_id,
        direction,
        type,
        subject,
        body,
        sender_name,
        sender_email,
        sender_title,
        attachments,
        communicated_at,
        created_at
      `)
      .eq("application_id", applicationId)
      .order("communicated_at", { ascending: false });

    if (error) {
      console.error("[listRecruiterCommunications] failed:", error);
      return { data: [], error };
    }

    return { data: data || [], error: null };
  } catch (error) {
    console.error("[listRecruiterCommunications] unexpected error:", error);
    return { data: [], error };
  }
}

export async function createRecruiterCommunication(supabase, {
  userId,
  applicationId,
  body,
  direction = "inbound",
  type = "email",
  communicatedAt,
  attachments = [],
}) {
  try {
    const payload = {
      user_id: userId,
      application_id: applicationId,
      body,
      direction,
      type,
      attachments,
      communicated_at: communicatedAt || new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("recruiter_communications")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("[createRecruiterCommunication] failed:", error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error("[createRecruiterCommunication] unexpected error:", error);
    return { data: null, error };
  }
}
