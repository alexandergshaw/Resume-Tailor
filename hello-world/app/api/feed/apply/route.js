import { createClient } from "@/lib/supabase/server";
import { upsertPosition } from "@/lib/supabase/upsertPosition";
import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { STATUS } from "@/lib/applications/statusVocabulary.js";

export const runtime = "nodejs";

/**
 * Move a feed posting into the user's Applying pipeline.
 * Creates/updates a `positions` row from the stored posting, then upserts an
 * application with status "tracking" (the same entry state the rest of the app
 * uses before a resume is tailored / submitted).
 *
 * Body: { postingId: string }
 */
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
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const postingId = typeof body?.postingId === "string" ? body.postingId : "";
  if (!postingId) {
    return Response.json({ error: "postingId required" }, { status: 400 });
  }

  const { data: posting, error: postingErr } = await supabase
    .from("feed_postings")
    .select(
      "id, source_posting_id, title, company, location, remote_type, employment_type, salary_min, salary_max, description_snippet, url, posted_at, raw_data",
    )
    .eq("id", postingId)
    .maybeSingle();

  if (postingErr || !posting) {
    return Response.json({ error: "Posting not found" }, { status: 404 });
  }

  // Reconstruct the normalized job shape upsertPosition expects.
  const raw = posting.raw_data || {};
  const job = {
    id: posting.source_posting_id || raw.id,
    title: posting.title || raw.title || "",
    company: posting.company || raw.company || "",
    location: posting.location || raw.location || "",
    isRemote: posting.remote_type === "remote",
    employmentType: posting.employment_type || null,
    description: raw.description || posting.description_snippet || "",
    url: posting.url || raw.url || "",
    salaryMin: posting.salary_min ?? null,
    salaryMax: posting.salary_max ?? null,
    postedAt: posting.posted_at || raw.postedAt || null,
  };

  if (!job.id) {
    return Response.json({ error: "Posting missing external id" }, { status: 422 });
  }

  const positionId = await upsertPosition(supabase, job);
  if (!positionId) {
    return Response.json({ error: "Failed to save position" }, { status: 500 });
  }

  const applicationId = await upsertApplication(supabase, {
    userId: user.id,
    positionId,
    status: STATUS.TRACKING,
  });
  if (!applicationId) {
    return Response.json({ error: "Failed to add application" }, { status: 500 });
  }

  return Response.json({ ok: true, applicationId, positionId });
}
