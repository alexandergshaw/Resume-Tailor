import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { postingExternalId } from "@/lib/feed/selectQueueCandidates";
import {
  loadStorageBuffer,
  loadAlreadyTrackedExternalIds,
  tailorAndQueueOne,
} from "@/lib/feed/tailorAndQueue";
import { STATUS, APPLIED_OR_LATER_STATUSES } from "@/lib/applications/statusVocabulary.js";

// `auto_queued` plus every applied-or-later status — a row already queued OR
// already at any of interviewing/offer/accepted/etc. is "already in the
// pipeline" and must not be re-tailored and re-queued. The set used to be
// `["auto_queued", "applied"]` — two of eleven statuses — so a row at
// "interviewing" or "offer" was NOT treated as tracked, and a caller of this
// route would re-tailor and re-queue a job the user already has an offer on.
// (The caller then was the Live Feed's rocket button; see the note on POST.)
const DEDUP_STATUSES = [STATUS.AUTO_QUEUED, ...APPLIED_OR_LATER_STATUSES];

export const runtime = "nodejs";
export const maxDuration = 300;

const FEED_SELECT =
  "id, dedup_key, source, source_posting_id, title, company, location, remote_type, employment_type, salary_min, salary_max, description_snippet, min_years_required, url, tags, posted_at, raw_data";

// Run the cron's tailor-and-queue pipeline for a SINGLE posting: tailor a
// resume and a cover letter for it and park the result in the auto-apply
// queue, through the same `tailorAndQueueOne` helper the cron itself uses
// (app/api/cron/tailor/route.js) — so a job queued here is indistinguishable
// from one the cron queued.
//
// NO IN-APP CALLER TODAY. This was the Live Feed card's "Auto-apply" button
// (`handleAutoApply` in app/components/LiveFeedTab.js) until commit 572b77c
// replaced that button with "Auto-fill", which copies an autofill bookmarklet
// and never touches this route. Nothing under app/, extension/ or vercel.json
// posts here now; it is reachable only by a direct authenticated request. Left
// in place rather than deleted because it is the only single-posting entry
// point into the queue pipeline, and its behaviour is pinned by route.test.js.
//
// Authenticates the user via the SSR client (401 otherwise), then performs the
// privileged reads and writes with the admin client — always scoped to the
// authenticated user's id, never a user id taken from the body.
//
// The posting is resolved from `body.postingId` (read back out of
// `feed_postings`) or, failing that, an inline `body.posting` object; neither
// is a 400. A stored resume at `${user.id}/resume` is required (400 without
// one); the cover letter is best-effort.
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

  // Don't create duplicates — if this posting is already queued or at any
  // applied-or-later status (the full set is DEDUP_STATUSES above, not just
  // "applied"), report it as such. A row left at an earlier, pre-apply status
  // (e.g. "tracking" from a half-finished run) is intentionally NOT treated as
  // a duplicate so re-running recovers it into the queue.
  const externalId = postingExternalId(posting);
  if (externalId) {
    const tracked = await loadAlreadyTrackedExternalIds(admin, user.id, [externalId], DEDUP_STATUSES);
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
