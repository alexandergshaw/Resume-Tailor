import { createClient } from "@/lib/supabase/server";
import { loadRecentRuns } from "@/lib/feed/autoTailorRunStore";

export const runtime = "nodejs";

// N60 S7 (AC-R5): the signed-in owner reads their own persisted auto-tailor
// runs back. The cron writes auto_tailor_runs as service_role
// (design-structure.r1.md §4); this GET is the read surface for the
// automation panel and the queue tab's compact run log.
//
// Own-rows is belt-and-braces: the table is select-own by RLS, and
// loadRecentRuns ALSO filters on the authenticated user's id -- the same
// pattern app/api/auto-apply-queue/route.js uses for its own `.eq("user_id",
// user.id)` -- so a mis-scoped query can never return another account's
// rows even if RLS were mis-provisioned. An empty history is a 200 with an
// empty list, never an error (loadRecentRuns's own fail-soft contract).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runs = await loadRecentRuns(supabase, user.id);
  return Response.json({ runs });
}
