import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writePositionMerged, editPositionFields } from "@/lib/supabase/writePosition";
import { positionRowFromJob } from "@/lib/supabase/positionRow";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// The single server-side entry point for writing `public.positions`.
//
// WHY IT EXISTS
// `positions` is a shared catalogue with no user_id column
// (supabase/migrations/20260901000000_drive.sql:28). Because the write used to
// be issued from the browser, its live RLS policies have to be permissive:
//
//   positions_select_all             SELECT  true
//   positions_insert_authenticated   INSERT  auth.role() = 'authenticated'
//   positions_update_authenticated   UPDATE  auth.role() = 'authenticated'
//
// i.e. any authenticated user may update any row. Combined with a full-row
// upsert, one account re-tailoring a posting overwrote — and blanked — the
// company / url / description another account's application points at. Moving
// the write here is what makes the UPDATE/INSERT policies droppable.
//
// DEPLOYMENT ORDERING — THIS CODE SHIPS FIRST, THE POLICY CHANGE COMES LATER.
// This is the INVERSE of the ordering used when a migration adds a column
// (schema first, then the code that uses it). Here the code must be live, and
// old browser sessions must have DRAINED, before the policy is tightened: a
// client still running the previous bundle writes to `positions` directly, and
// a tightened policy denies it. Getting the order backwards breaks tailoring
// for anyone sitting on a stale tab. Sequence:
//   1. Ship this route + the client rewiring.
//   2. Wait out the old sessions (a full session-expiry window).
//   3. Only then drop positions_insert_authenticated /
//      positions_update_authenticated and replace them with service-role-only.
//
// AUTHENTICATION, AND WHY A USER ID IN THE BODY WOULD BE WRONG.
// The write runs under the SERVICE-ROLE client, which bypasses RLS entirely.
// This handler's own auth check is therefore the only thing between a request
// and the catalogue, and the caller's identity is taken from the session
// cookie via supabase.auth.getUser() — never from the request body. A body
// field is attacker-controlled: PATCH's ownership check would become
// "applications.user_id = <whatever the caller typed>", which is not a check
// at all. Nothing below reads a user id out of `body`.
// ---------------------------------------------------------------------------

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function readJson(request) {
  try {
    return { body: await request.json(), error: null };
  } catch {
    return { body: null, error: Response.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

/**
 * POST — merge a job into the shared catalogue.
 *
 * Body: { job }  — a normalized job object; `job.id` is the external id.
 * Returns: { positionId }
 *
 * Authentication is the only gate, and that is the whole design: `positions`
 * is a catalogue nobody owns, so there is no principal to authorize against.
 * What makes an authenticated write safe is the MERGE — lib/supabase/
 * positionMerge.js — which cannot blank a stored value, cannot replace a
 * stored identity with a different one, and cannot shorten a description.
 */
export async function POST(request) {
  const { user } = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { body, error: badJson } = await readJson(request);
  if (badJson) return badJson;

  const job = body?.job;
  if (!job || typeof job !== "object" || Array.isArray(job) || !job.id) {
    return Response.json({ error: "job.id required" }, { status: 400 });
  }

  const { id, error } = await writePositionMerged(createAdminClient(), positionRowFromJob(job));
  if (error || !id) {
    console.error("[api/positions] POST failed:", error?.message || "no id returned");
    return Response.json({ error: "Failed to save position" }, { status: 500 });
  }

  return Response.json({ positionId: id });
}

/**
 * PATCH — apply the Edit Application dialog's typed title/company/description.
 *
 * Body: { positionId, title?, company?, description? }
 *
 * Unlike POST this one AUTHORIZES as well as authenticates: the caller must
 * hold an application on that position. Today's RLS authorizes nothing here
 * (`auth.role() = 'authenticated'` lets any signed-in account edit any
 * catalogue row), so this check is new protection, not a re-implementation of
 * one. It runs on the USER-scoped client so `applications`' own RLS applies to
 * the lookup too.
 */
export async function PATCH(request) {
  const { supabase, user } = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { body, error: badJson } = await readJson(request);
  if (badJson) return badJson;

  const positionId = typeof body?.positionId === "string" ? body.positionId.trim() : "";
  if (!positionId) return Response.json({ error: "positionId required" }, { status: 400 });

  // `user.id` comes from the verified session, never from `body`.
  const { data: owned, error: ownershipError } = await supabase
    .from("applications")
    .select("id")
    .eq("position_id", positionId)
    .eq("user_id", user.id)
    .limit(1);

  if (ownershipError) {
    console.error("[api/positions] PATCH ownership lookup failed:", ownershipError.message);
    return Response.json({ error: "Failed to save position changes" }, { status: 500 });
  }
  if (!owned || owned.length === 0) {
    return Response.json({ error: "No application of yours points at this position" }, { status: 403 });
  }

  const { error } = await editPositionFields(createAdminClient(), positionId, {
    title: body?.title,
    company: body?.company,
    description: body?.description,
  });

  if (error) {
    console.error("[api/positions] PATCH failed:", error.message);
    return Response.json({ error: "Failed to save position changes" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
