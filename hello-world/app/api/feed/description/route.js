import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/feed/description?id=<feed posting uuid>
//
// One posting's full job description, read on demand.
//
// The feed LIST route (../route.js) deliberately omits `raw_data` from its
// select: it returns up to 50 rows per page and `raw_data` holds whole job
// descriptions, so adding it there would inflate every feed page load for a
// field needed only when a single posting is tailored. This endpoint is the
// on-demand counterpart -- a single-row primary-key read, made only when the
// user clicks Tailor, so the Live Feed path can send the same full text the
// apply / auto-apply-queue / cron paths already tailor from.
//
// Reads through the admin client exactly as the feed listing does. That is not
// a widening of access: `feed_postings` is world-readable by policy
// (supabase/migrations/20260609000000_live_feed.sql, "feed_postings_read_all"),
// the listing already serves these rows to signed-out visitors, and tailoring
// from the Live Feed does not require a session either.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORED_DESCRIPTION =
  "This posting was ingested without a stored full description.";

export async function GET(request) {
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  // `feed_postings.id` is a uuid. Rejecting anything else here turns what would
  // be a Postgres "invalid input syntax for type uuid" 500 into a plain 400.
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "id must be a feed posting uuid" }, { status: 400 });
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

  // Only the columns this endpoint answers with -- it must not turn into a
  // second feed listing.
  const { data, error } = await admin
    .from("feed_postings")
    .select("id, description_snippet, raw_data")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Posting not found" }, { status: 404 });
  }

  const snippet =
    typeof data.description_snippet === "string" ? data.description_snippet : "";
  const full =
    typeof data.raw_data?.description === "string" ? data.raw_data.description.trim() : "";

  if (full) {
    return Response.json({ id: data.id, description: full, full: true });
  }

  // Older rows (and any adapter that never captured a body) have no stored
  // description. Say so rather than handing back a truncation that looks whole.
  return Response.json({
    id: data.id,
    description: snippet,
    full: false,
    reason: NO_STORED_DESCRIPTION,
  });
}
