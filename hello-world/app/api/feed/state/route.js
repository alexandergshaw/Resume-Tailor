import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = new Set(["save", "unsave", "hide", "unhide"]);

/**
 * Persist per-user feed state for a posting.
 * Body: { postingId: string, action: "save"|"unsave"|"hide"|"unhide" }
 */
export async function POST(request) {
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
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const postingId = typeof body?.postingId === "string" ? body.postingId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!postingId || !ALLOWED_ACTIONS.has(action)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const patch = { updated_at: new Date().toISOString() };
  if (action === "save") patch.saved = true;
  if (action === "unsave") patch.saved = false;
  if (action === "hide") patch.hidden = true;
  if (action === "unhide") patch.hidden = false;

  const { error } = await supabase.from("feed_user_state").upsert(
    {
      user_id: user.id,
      posting_id: postingId,
      ...patch,
    },
    { onConflict: "user_id,posting_id" },
  );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
