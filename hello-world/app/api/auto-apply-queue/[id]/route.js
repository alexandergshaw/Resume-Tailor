import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Remove one posting from the auto-apply queue.
//
// We hard-delete the application row so the posting is fully released: the
// rocket's dedup check (loadAlreadyTrackedExternalIds with the
// ["auto_queued","applied"] filter) only blocks postings whose application is
// still in one of those statuses, so deleting the row lets the user re-tailor
// and re-queue the same posting from the Live Feed. The generated resume /
// cover letter rows are left in place (they're harmless history and may be
// referenced elsewhere); only the queue membership is removed.
//
// The delete runs with the admin (service-role) client — scoped to the
// authenticated user's id — because the older applications table may not grant
// DELETE to the authenticated role, which would otherwise make the delete a
// silent no-op (0 rows, no error) and leave the posting stuck in the queue.
export async function DELETE(_request, { params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    admin = supabase; // fall back to the user client if no service role key
  }

  // Confirm the row belongs to this user before deleting.
  const { data: existing, error: fetchErr } = await admin
    .from("applications")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { error: delErr } = await admin
    .from("applications")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (delErr) {
    return Response.json({ error: delErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, id });
}
