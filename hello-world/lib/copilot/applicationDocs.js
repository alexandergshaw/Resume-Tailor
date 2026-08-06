// Fetches the résumé and cover letter a candidate actually submitted for one
// tracked application — the grounding material for practice mode's "answer"
// mode sample answers (lib/copilot/sampleAnswerLocal.js, and the Gemini path
// in app/api/copilot/answer/route.js). Mirrors the reference query in
// app/page.js's loadApplications (around lines 1398-1433): look up the
// application's resume_used_id / cover_letter_id, then read `content` off
// generated_resumes / generated_cover_letters for those ids. Scoped to ONE
// application instead of the whole list.
//
// Never throws. Every failure mode — no applicationId, no matching row, a
// row that belongs to someone else, a null document id, or any query error —
// degrades to empty strings, so a broken or missing application never breaks
// the sample-answer request that depends on this.

async function fetchDocContent(supabase, table, id) {
  if (!id) return "";
  const { data, error } = await supabase.from(table).select("content").eq("id", id).maybeSingle();
  if (error || !data) return "";
  return typeof data.content === "string" ? data.content : "";
}

export async function fetchApplicationDocs(supabase, { applicationId, userId } = {}) {
  const empty = { resume: "", coverLetter: "" };
  if (!applicationId || !userId) return empty;

  // The user_id filter is not optional and is not redundant with RLS — it is
  // what keeps this application-scoped lookup from ever reading another
  // user's submitted documents even if RLS is ever misconfigured.
  const { data: appRow, error: appErr } = await supabase
    .from("applications")
    .select("id, resume_used_id, cover_letter_id")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (appErr || !appRow) return empty;

  const [resume, coverLetter] = await Promise.all([
    fetchDocContent(supabase, "generated_resumes", appRow.resume_used_id),
    fetchDocContent(supabase, "generated_cover_letters", appRow.cover_letter_id),
  ]);
  return { resume, coverLetter };
}
