import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STATUS } from "@/lib/applications/statusVocabulary.js";

export const runtime = "nodejs";

// Returns the current user's auto-apply queue: applications parked with status
// "auto_queued", joined with their position and the generated resume / cover
// letter content. Relations are fetched as separate queries (rather than
// PostgREST embedded joins) so a missing/undetected foreign key can't 500 the
// whole endpoint. The generated docs are read with the admin client by their
// ids (which already belong to this user's application rows) so any RLS/grant
// gap or NULL user_id on the older generated_resumes table can't hide them.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: apps, error } = await supabase
    .from("applications")
    .select(
      "id, status, auto_saved_at, applied_at, auto_apply_opened_at, position_id, resume_used_id, cover_letter_id, auto_search_id",
    )
    .eq("user_id", user.id)
    .eq("status", STATUS.AUTO_QUEUED)
    .order("auto_saved_at", { ascending: false })
    .limit(500);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = apps || [];
  if (rows.length === 0) {
    return Response.json({ items: [] });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    admin = supabase; // fall back to the user client if no service role key
  }

  const positionIds = [...new Set(rows.map((r) => r.position_id).filter(Boolean))];
  const resumeIds = [...new Set(rows.map((r) => r.resume_used_id).filter(Boolean))];
  const coverIds = [...new Set(rows.map((r) => r.cover_letter_id).filter(Boolean))];

  const [positionsRes, resumesRes, coversRes] = await Promise.all([
    positionIds.length
      ? supabase.from("positions").select("id, title, company, location, url").in("id", positionIds)
      : Promise.resolve({ data: [] }),
    resumeIds.length
      ? admin
          .from("generated_resumes")
          .select("id, content, content_lines")
          .in("id", resumeIds)
      : Promise.resolve({ data: [] }),
    coverIds.length
      ? admin
          .from("generated_cover_letters")
          .select("id, content, content_lines")
          .in("id", coverIds)
      : Promise.resolve({ data: [] }),
  ]);

  const positionsById = new Map((positionsRes.data || []).map((p) => [p.id, p]));
  const resumesById = new Map((resumesRes.data || []).map((r) => [r.id, r]));
  const coversById = new Map((coversRes.data || []).map((c) => [c.id, c]));

  const items = rows.map((r) => ({
    id: r.id,
    status: r.status,
    auto_saved_at: r.auto_saved_at,
    applied_at: r.applied_at,
    auto_apply_opened_at: r.auto_apply_opened_at,
    resume_used_id: r.resume_used_id,
    cover_letter_id: r.cover_letter_id,
    auto_search_id: r.auto_search_id,
    positions: r.position_id ? positionsById.get(r.position_id) || null : null,
    generated_resumes: r.resume_used_id ? resumesById.get(r.resume_used_id) || null : null,
    generated_cover_letters: r.cover_letter_id ? coversById.get(r.cover_letter_id) || null : null,
  }));

  return Response.json({ items });
}
