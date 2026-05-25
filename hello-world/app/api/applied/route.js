import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/applied — fetch all applied jobs for the signed-in user
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("applied_jobs")
    .select("*")
    .eq("user_id", user.id)
    .order("applied_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ jobs: data });
}

// POST /api/applied — mark a job as applied
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId, jobTitle, company, jobUrl, jobDescription } = await request.json();

  if (!jobId) {
    return Response.json({ error: "jobId is required" }, { status: 400 });
  }

  const { error } = await supabase.from("applied_jobs").upsert(
    { user_id: user.id, job_id: jobId, job_title: jobTitle, company, job_url: jobUrl, job_description: jobDescription },
    { onConflict: "user_id,job_id" },
  );

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

// DELETE /api/applied — un-mark a job as applied
export async function DELETE(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await request.json();

  if (!jobId) {
    return Response.json({ error: "jobId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("applied_jobs")
    .delete()
    .eq("user_id", user.id)
    .eq("job_id", jobId);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
