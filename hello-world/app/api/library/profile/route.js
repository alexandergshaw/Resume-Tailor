import {
  getAuth,
  unauthorized,
  badRequest,
  ensureSeeded,
  bumpVersion,
} from "@/lib/llm/engines/tailor-lite/library/apiSupport";
import { validateProfile } from "@/lib/llm/engines/tailor-lite/library/validate";

export const runtime = "nodejs";

// Upsert the profile placeholder values + default teaching subjects (one row/user).
export async function PUT(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest(["Invalid JSON body."]);
  }
  const v = validateProfile(body);
  await ensureSeeded(supabase, userId);
  const { error } = await supabase
    .from("tailor_profile")
    .update({
      values: v.value.values,
      default_teaching_subjects: v.value.default_teaching_subjects,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await bumpVersion(supabase, userId);
  return Response.json({ ok: true });
}
