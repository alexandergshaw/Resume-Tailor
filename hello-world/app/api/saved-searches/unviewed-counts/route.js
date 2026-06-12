import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";

export const runtime = "nodejs";

// How many recent postings to scan when counting unviewed matches. The bubble
// caps at "99+", so scanning a few hundred recent rows is more than enough.
const FEED_SCAN_LIMIT = 300;
// Upper bound on the per-search count we bother computing.
const COUNT_CAP = 100;

// For each of the signed-in user's saved searches, count the feed postings that
// were ingested since the search was last viewed and still match its criteria.
// Returns { counts: { [savedSearchId]: number } }.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: searches, error: searchErr } = await supabase
    .from("saved_searches")
    .select(
      "id, last_viewed_at, job_keywords, excluded_title_keywords, excluded_companies, max_years_exp",
    )
    .eq("user_id", user.id);
  if (searchErr) {
    return Response.json({ error: searchErr.message }, { status: 500 });
  }
  if (!Array.isArray(searches) || searches.length === 0) {
    return Response.json({ counts: {} });
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

  // The feed is user-independent, so a single recent scan serves every search.
  const { data: postings, error: feedErr } = await admin
    .from("feed_postings")
    .select(
      "id, source_posting_id, title, company, description_snippet, min_years_required, posted_at",
    )
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(FEED_SCAN_LIMIT);
  if (feedErr) {
    return Response.json({ error: feedErr.message }, { status: 500 });
  }

  let all = Array.isArray(postings) ? postings : [];

  // Only count postings that actually appear in the feed UI: drop any the user
  // has hidden, since those never render in the list.
  if (all.length > 0) {
    const { data: states } = await supabase
      .from("feed_user_state")
      .select("posting_id, hidden")
      .eq("user_id", user.id)
      .eq("hidden", true)
      .in(
        "posting_id",
        all.map((p) => p.id),
      );
    const hiddenIds = new Set((states || []).map((s) => s.posting_id));
    if (hiddenIds.size > 0) {
      all = all.filter((p) => !hiddenIds.has(p.id));
    }
  }

  const counts = {};
  for (const search of searches) {
    const cutoff = search.last_viewed_at ? Date.parse(search.last_viewed_at) : NaN;
    const fresh = Number.isFinite(cutoff)
      ? all.filter((p) => {
          const t = p.posted_at ? Date.parse(p.posted_at) : NaN;
          return Number.isFinite(t) && t > cutoff;
        })
      : all;
    const matched = selectQueueCandidates(fresh, search, new Set(), COUNT_CAP);
    counts[search.id] = matched.length;
  }

  return Response.json({ counts });
}
