import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PRE_APPLY_STATUSES } from "@/lib/applications/statusVocabulary.js";

export const runtime = "nodejs";

// Remove one posting from the auto-apply queue.
//
// The delete is scoped by FOUR filters, not just id + user_id: an ALLOW-LIST
// on status (`PRE_APPLY_STATUSES` — never a deny-list; same discipline as
// `lib/supabase/applicationStatusWriter.js`'s C1, and for the same reason —
// a deny-list is TRUE for any status not yet named, so a status added to
// `applications_status_check` tomorrow would be silently deletable) and
// `applied_at IS NULL`. Both guards exist because the rocket's dedup check
// (`loadAlreadyTrackedExternalIds`) only re-admits a posting whose
// application row is gone, and a hard delete with no status filter at all
// would destroy the user's own application history under a control
// captioned "Remove this posting from the queue?" — see
// test/repro/appliedStatusDataLoss.test.js REPRO D2/D5's "offer → Live Feed
// rocket → queue → remove" case, which is exactly a row that moved to
// "offer" (an applied-or-later status carrying a real `applied_at`) and was
// still hard-deleted by this handler as it stood before this fix.
//
// A refusal is reported, not silently swallowed: the response is always
// HTTP 200 (deletion is not the only successful outcome of asking to
// delete), and `deleted: false` carries the row's current `status` so the
// caller can offer a reachable remedy ("Open in Tracking") instead of a
// dead end — every shape that can produce a queue card in the first place
// is visible in Tracking once refused here (3-plan-dataloss.md PART 4 / F-9
// enumerates the two reachable refusal shapes and shows a NULL-status row
// can never reach this handler as a queue card at all).
//
// The delete runs with the admin (service-role) client — because the older
// applications table may not grant DELETE to the authenticated role, which
// would otherwise make the delete a silent no-op (0 rows, no error) and
// leave the posting stuck in the queue.
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

  // Confirm the row belongs to this user before attempting the guarded
  // delete below (a 404 for "not mine / doesn't exist" is a different
  // outcome from a 200 refusal for "yours, but not safe to delete").
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

  const { data: deletedRows, error: delErr } = await admin
    .from("applications")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .in("status", PRE_APPLY_STATUSES) // ALLOW-LIST — same discipline as the writer's C1. NEVER .not(…, "in", …).
    .is("applied_at", null) // NEVER .eq(col, null) — the date is the second half of the record.
    .select("id");
  if (delErr) {
    return Response.json({ error: delErr.message }, { status: 500 });
  }

  const deleted = (deletedRows || []).length > 0;
  if (deleted) {
    return Response.json({ ok: true, id, deleted: true });
  }

  // Refused. Re-read so the caller can say WHY — from the row's OWN status,
  // never hard-coded, so a future status this guard doesn't yet know about
  // still gets a truthful answer instead of a guessed one.
  const { data: current } = await admin
    .from("applications")
    .select("status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json({
    ok: true,
    id,
    deleted: false,
    reason: "protected",
    status: current?.status ?? null,
  });
}
