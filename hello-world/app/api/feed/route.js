import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCached, setCached } from "@/lib/cache/jobCache";
import { getFeedMeta } from "@/lib/feed/ingestFeed";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const CACHE_TTL_SECONDS = 20; // short TTL keeps reads fast without serving stale data
const ALLOWED_REMOTE = new Set(["remote", "hybrid", "onsite"]);
const ALLOWED_SORT = new Set(["newest", "company", "relevance"]);

function clampLimit(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

function parseOffset(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// PostgREST ilike pattern escaping: neutralize wildcards in user input.
function sanitizeLike(value) {
  return String(value).replace(/[%_,()]/g, " ").trim().slice(0, 120);
}

function parseSince(value) {
  if (!value) return null;
  // Accept a number of days (e.g. "7") or an ISO date string.
  const days = Number.parseInt(value, 10);
  if (String(days) === String(value) && days > 0 && days <= 365) {
    return new Date(Date.now() - days * 86400000).toISOString();
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const q = searchParams.get("q") ? sanitizeLike(searchParams.get("q")) : "";
  const location = searchParams.get("location")
    ? sanitizeLike(searchParams.get("location"))
    : "";
  const remoteRaw = (searchParams.get("remote") || "").toLowerCase();
  const remote = ALLOWED_REMOTE.has(remoteRaw) ? remoteRaw : "";
  const source = searchParams.get("source")
    ? sanitizeLike(searchParams.get("source"))
    : "";
  const since = parseSince(searchParams.get("since"));
  const sortRaw = (searchParams.get("sort") || "newest").toLowerCase();
  const sort = ALLOWED_SORT.has(sortRaw) ? sortRaw : "newest";
  const limit = clampLimit(searchParams.get("limit"));
  const offset = parseOffset(searchParams.get("cursor"));
  const includeHidden = searchParams.get("includeHidden") === "true";

  // Resolve the current user (optional — feed is readable when signed out).
  let userId = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id || null;
  } catch {
    userId = null;
  }

  // The postings page itself is user-independent, so it can be cached.
  const cacheKey = `feed:page:v1:${JSON.stringify({
    q,
    location,
    remote,
    source,
    since,
    sort,
    limit,
    offset,
  })}`;

  let page = await getCached(cacheKey);
  if (!page) {
    let admin;
    try {
      admin = createAdminClient();
    } catch (err) {
      return Response.json(
        { error: `admin client unavailable: ${err.message}` },
        { status: 500 },
      );
    }

    let query = admin
      .from("feed_postings")
      .select(
        "id, source, source_posting_id, title, company, location, remote_type, employment_type, salary_min, salary_max, description_snippet, url, tags, posted_at",
      );

    if (q) {
      query = query.or(`title.ilike.%${q}%,company.ilike.%${q}%`);
    }
    if (location) query = query.ilike("location", `%${location}%`);
    if (remote) query = query.eq("remote_type", remote);
    if (source) query = query.eq("source", source);
    if (since) query = query.gte("posted_at", since);

    if (sort === "company") {
      query = query
        .order("company", { ascending: true, nullsFirst: false })
        .order("posted_at", { ascending: false, nullsFirst: false });
    } else {
      // "newest" and "relevance" both fall back to recency ordering.
      query = query
        .order("posted_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const items = data || [];
    page = {
      items,
      nextCursor: items.length === limit ? offset + limit : null,
    };
    await setCached(cacheKey, page, CACHE_TTL_SECONDS);
  }

  // Merge per-user saved/hidden state (never cached, always live).
  let items = page.items;
  if (userId && items.length > 0) {
    try {
      const supabase = await createClient();
      const ids = items.map((i) => i.id);
      const { data: states } = await supabase
        .from("feed_user_state")
        .select("posting_id, saved, hidden")
        .in("posting_id", ids);
      const byId = new Map((states || []).map((s) => [s.posting_id, s]));
      items = items.map((i) => {
        const s = byId.get(i.id);
        return { ...i, saved: !!s?.saved, hidden: !!s?.hidden };
      });
      if (!includeHidden) {
        items = items.filter((i) => !i.hidden);
      }
    } catch {
      // If state lookup fails, return postings without flags rather than erroring.
      items = items.map((i) => ({ ...i, saved: false, hidden: false }));
    }
  } else {
    items = items.map((i) => ({ ...i, saved: false, hidden: false }));
  }

  const meta = await getFeedMeta();

  return Response.json({
    items,
    nextCursor: page.nextCursor,
    lastUpdatedAt: meta?.lastIngestedAt || null,
    sourceHealth: meta?.sourceHealth || null,
  });
}
