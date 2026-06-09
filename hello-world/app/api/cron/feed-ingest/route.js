import { createAdminClient } from "@/lib/supabase/admin";
import { ingestFeed } from "@/lib/feed/ingestFeed";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds; Vercel cap for the ingest cycle

/**
 * Returns true if the request is authorized for cron access.
 * Mirrors /api/cron/tailor:
 *   - `Authorization: Bearer ${CRON_SECRET}` (manual / Vercel cron with secret)
 *   - Vercel cron auto-header `x-vercel-cron: 1` when CRON_SECRET is unset
 */
function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") || "";
    return header === `Bearer ${secret}`;
  }
  return request.headers.get("x-vercel-cron") === "1";
}

export async function POST(request) {
  if (!isAuthorized(request)) {
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

// Vercel cron sends GETs in some configurations; accept both verbs.
export const GET = POST;
