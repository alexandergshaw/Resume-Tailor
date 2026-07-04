import {
  getAuth,
  unauthorized,
  ensureSeeded,
} from "@/lib/llm/engines/tailor-lite/library/apiSupport";
import { TAXONOMY_CATEGORIES } from "@/lib/llm/engines/tailor-lite/library/validate";

export const runtime = "nodejs";

// The signed-in user's library, as editable rows (with ids), seeded from the
// bundled defaults on first access. The editor renders these; the Preview tab
// tailors against the same data via the loader.
export async function GET() {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();
  await ensureSeeded(supabase, userId);

  const [taxonomy, focusAreas, skillGroups, contentLibrary, profile] = await Promise.all([
    supabase.from("tailor_taxonomy").select("*").eq("user_id", userId).order("sort_order"),
    supabase.from("tailor_focus_areas").select("*").eq("user_id", userId).order("sort_order"),
    supabase.from("tailor_skill_groups").select("*").eq("user_id", userId).order("sort_order"),
    supabase.from("tailor_content_library").select("*").eq("user_id", userId).order("sort_order"),
    supabase.from("tailor_profile").select("*").eq("user_id", userId).maybeSingle(),
  ]);

  const firstError = [taxonomy, focusAreas, skillGroups, contentLibrary, profile].find((r) => r.error);
  if (firstError?.error) {
    return Response.json({ error: firstError.error.message }, { status: 500 });
  }

  // Fetch personas tolerantly: if the table doesn't exist or has an error, degrade to [].
  let personas = [];
  try {
    const res = await supabase.from("tailor_personas").select("*").eq("user_id", userId).order("sort_order");
    if (res.error && res.error.code === "PGRST116") {
      // Table doesn't exist yet (migration pending)
      personas = [];
    } else if (res.error) {
      // Log the error but don't fail the whole request
      console.warn("Failed to fetch personas:", res.error.message);
      personas = [];
    } else if (Array.isArray(res.data)) {
      personas = res.data;
    }
  } catch (err) {
    // Network or other error during fetch attempt
    console.warn("Exception fetching personas:", err.message);
    personas = [];
  }

  return Response.json({
    taxonomy: taxonomy.data || [],
    focusAreas: focusAreas.data || [],
    skillGroups: skillGroups.data || [],
    contentLibrary: contentLibrary.data || [],
    profile: profile.data || { values: {}, default_teaching_subjects: [] },
    personas,
    categories: TAXONOMY_CATEGORIES,
  });
}
