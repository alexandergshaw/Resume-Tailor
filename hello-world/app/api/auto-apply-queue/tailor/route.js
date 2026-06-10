import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { postingExternalId } from "@/lib/feed/selectQueueCandidates";
import {
  loadStorageBuffer,
  loadAlreadyTrackedExternalIds,
  tailorAndQueueOne,
} from "@/lib/feed/tailorAndQueue";

export const runtime = "nodejs";
export const maxDuration = 300;

const FEED_SELECT =
  "id, dedup_key, source, source_posting_id, title, company, location, remote_type, employment_type, salary_min, salary_max, description_snippet, min_years_required, url, tags, posted_at, raw_data";

// Manually run the cron's tailor-and-queue pipeline for a single feed posting,
// triggered by the "Auto-apply" button on a Live Feed card. Authenticates the
// user via the SSR client, then performs privileged writes with the admin
// client — always scoped to the authenticated user's id (never trusting a body
// user id).
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
    body = {};
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

  // Resolve the posting: prefer a feed_postings id, else accept inline fields.
  let posting = null;
  if (body?.postingId) {
    const { data, error } = await admin
      .from("feed_postings")
      .select(FEED_SELECT)
      .eq("id", body.postingId)
      .maybeSingle();
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    posting = data || null;
  } else if (body?.posting && typeof body.posting === "object") {
    posting = body.posting;
  }

  if (!posting) {
    return Response.json(
      { error: "Could not resolve the posting to auto-apply." },
      { status: 400 },
    );
  }

  // Don't create duplicates — if this posting is already queued or already
  // applied, report it as such. A row left at an earlier status (e.g.
  // "tracking" from a half-finished run) is intentionally NOT treated as a
  // duplicate so re-running recovers it into the queue.
  const externalId = postingExternalId(posting);
  if (externalId) {
    const tracked = await loadAlreadyTrackedExternalIds(admin, user.id, [externalId], [
      "auto_queued",
      "applied",
    ]);
    if (tracked.has(externalId)) {
      return Response.json(
        { ok: true, alreadyQueued: true, message: "This job is already in your pipeline." },
        { status: 200 },
      );
    }
  }

  // Resume is required; cover letter is best-effort.
  const resumeBuffer = await loadStorageBuffer(admin, `${user.id}/resume`);
  if (!resumeBuffer) {
    return Response.json(
      { error: "No resume found. Upload a resume before auto-applying." },
      { status: 400 },
    );
  }
  const coverLetterBuffer = await loadStorageBuffer(admin, `${user.id}/cover-letter`);

  try {
    const result = await tailorAndQueueOne({
      admin,
      userId: user.id,
      posting,
      resumeBuffer,
      coverLetterBuffer,
      savedSearchId: null,
      sourceLabel: "the Live Feed",
    });
    if (!result) {
      return Response.json(
        { error: "Failed to tailor and queue this posting." },
        { status: 500 },
      );
    }
    return Response.json({
      ok: true,
      applicationId: result.applicationId,
      positionId: result.positionId,
      generatedResumeId: result.generatedResumeId,
      coverLetterId: result.coverLetterId,
    });
  } catch (err) {
    return Response.json(
      { error: String(err?.message || err) },
      { status: 500 },
    );
  }
}
