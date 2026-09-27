import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// N60 S6 (AC-E4) -- the account-level alert-mail pause WRITE. The account is
// derived from the SESSION only (auth.getUser()), never the request body, so a
// body naming another user's id cannot flip a stranger's row -- RLS's own
// with-check is the DB-level backstop; this is the reachable half. Writes
// user_alert_settings and NOTHING ELSE, so pausing then unpausing leaves every
// saved search's own flags untouched (non-destructive round trip).
export async function PUT(request) {
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

  const paused = !!body?.paused;
  const { error } = await supabase.from("user_alert_settings").upsert(
    { user_id: user.id, alerts_paused: paused, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, alertsPaused: paused });
}
