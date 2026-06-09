import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestFeed } from "@/lib/feed/ingestFeed";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Manual, user-triggered feed refresh. Any authenticated user may trigger one;
 * the underlying ingest holds a Redis lock so concurrent or overlapping refresh
 * requests (and the scheduled cron) never run two ingest cycles at once.
 */
export async function POST() {
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
  } catch (err) {
    return Response.json(
      { error: `admin client unavailable: ${err.message}` },
      { status: 500 },
    );
  }

  try {
    const summary = await ingestFeed(admin);
    return Response.json(summary);
  } catch (err) {
    return Response.json(
      { error: String(err?.message || err) },
      { status: 500 },
    );
  }
}
