import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Advance one item in the auto-apply queue. Queued postings stay at status
// "auto_queued" until the user manually changes their status elsewhere (the
// Tracking / Edit UI), so neither action ejects a row from the queue.
//   body { action: "apply" } -> record auto_apply_opened_at (status unchanged)
//   body { action: "skip"  } -> no-op on the DB (client-side dismissal only)
// Returns the updated row id so the UI can reflect the "opened" state.
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

  // "skip" leaves the row untouched; it stays in the queue.
  if (action === "skip") {
    return Response.json({ ok: true, id, action, openedAt: null });
  }

  // "apply": record that the user opened/worked this posting, but keep the row
  // at status "auto_queued" so it remains in the queue.
  const openedAt = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("applications")
    .update({ auto_apply_opened_at: openedAt })
    .eq("id", id)
    .eq("user_id", user.id);
  if (updErr) {
    return Response.json({ error: updErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, id, action, openedAt });
}
