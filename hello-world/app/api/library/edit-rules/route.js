// Persistent "template" edit rules (the recurring hand-edits the client promotes).
// POST upserts a { before, after } rule for the signed-in user; DELETE removes one
// (by id, or by matching before/after — the client knows the pair, not the row id,
// when self-healing an undone edit). Every write bumps the library version so the
// next tailor request reads the fresh set. Not the generic crudRoute: POST needs
// upsert (promotion is idempotent) and there is no PATCH (a rule is immutable —
// changing it means delete + add).

import { getAuth, unauthorized, badRequest, ensureSeeded, bumpVersion } from "@/lib/llm/engines/tailor-lite/library/apiSupport";
import { validateEditRule } from "@/lib/llm/engines/tailor-lite/library/validate";

export const runtime = "nodejs";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();
  const body = await readJson(request);
  if (!body) return badRequest(["Invalid JSON body."]);
  const v = validateEditRule(body);
  if (!v.ok) return badRequest(v.errors);
  await ensureSeeded(supabase, userId);
  const { data, error } = await supabase
    .from("tailor_edit_rules")
    .upsert(
      { user_id: userId, sort_order: Math.floor(Date.now() / 1000), ...v.value },
      { onConflict: "user_id,before,after" },
    )
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await bumpVersion(supabase, userId);
  return Response.json({ row: data });
}

export async function DELETE(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const before = url.searchParams.get("before");
  const after = url.searchParams.get("after");
  let query = supabase.from("tailor_edit_rules").delete().eq("user_id", userId);
  if (id) {
    query = query.eq("id", id);
  } else if (before !== null) {
    query = query.eq("before", before).eq("after", after ?? "");
  } else {
    return badRequest(["id or before is required."]);
  }
  const { error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await bumpVersion(supabase, userId);
  return Response.json({ ok: true });
}
