import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Returns the current user's auto-apply queue: applications parked by the cron
// with status "auto_queued", joined with their position and the generated
// resume / cover letter content.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("applications")
    .select(
      `
        id, status, auto_saved_at, applied_at, resume_used_id, cover_letter_id, auto_search_id,
        positions ( id, title, company, location, url ),
        generated_resumes:resume_used_id ( id, content, content_lines ),
        generated_cover_letters:cover_letter_id ( id, content, content_lines )
      `,
    )
    .eq("user_id", user.id)
    .eq("status", "auto_queued")
    .order("auto_saved_at", { ascending: false })
    .limit(500);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ items: data || [] });
}
