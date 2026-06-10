import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Advance one item in the auto-apply queue.
//   body { action: "apply" }  -> mark applied (status "applied", applied_at now)
//   body { action: "skip"  }  -> dismiss to "tracking" (stays in pipeline, out of queue)
// Returns the updated row id and the next queued item (if any) so the UI can
// walk the list one job at a time.
export async function POST(request, { params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const action = body?.action === "skip" ? "skip" : "apply";

  // Confirm the row belongs to this user and is currently queued.
  const { data: existing, error: fetchErr } = await supabase
    .from("applications")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const update =
    action === "apply"
      ? { status: "applied", applied_at: new Date().toISOString() }
      : { status: "tracking" };

  const { error: updErr } = await supabase
    .from("applications")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);
  if (updErr) {
    return Response.json({ error: updErr.message }, { status: 500 });
  }

  // Fetch the next queued item id to advance to (the client reloads full
  // details from /api/auto-apply-queue, so plain columns are enough here and
  // avoid relying on PostgREST relationship detection).
  const { data: next } = await supabase
    .from("applications")
    .select("id, status, auto_saved_at, position_id, resume_used_id, cover_letter_id, auto_search_id")
    .eq("user_id", user.id)
    .eq("status", "auto_queued")
    .order("auto_saved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ ok: true, id, action, next: next || null });
}
