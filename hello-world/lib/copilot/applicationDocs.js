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

// The job description the candidate applied against, for the ONE thing the
// posting is allowed to feed: the buzzword list beside the answer
// (lib/copilot/postingBuzzwords.js). It is deliberately NOT part of
// fetchApplicationDocs's return value — that function's result is what gets
// interpolated into both prompts, and AC-H7.27 says the posting description
// never reaches either one. Keeping it behind a separate call means a future
// edit cannot fold the description into a prompt by accident: there is no
// code path where a prompt builder is handed an object that happens to carry
// it.
//
// Never throws, exactly like fetchApplicationDocs: every failure mode — no
// applicationId, no userId, no matching row, an application with no joined
// position, a null description, or any query error — degrades to an empty
// string, which the caller renders as "no buzzword section" rather than an
// error.
export async function fetchPostingDescription(supabase, { applicationId, userId } = {}) {
  if (!applicationId || !userId) return "";

  // Same non-optional user_id scoping as above, and for the same reason: a
  // posting description belongs to one user's application, and an
  // application-scoped lookup must never read another user's row even if RLS
  // is ever misconfigured.
  const { data, error } = await supabase
    .from("applications")
    .select("id, positions ( description )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return "";

  // PostgREST returns an embedded one-to-one relation as an object and a
  // one-to-many as an array; accept either rather than depending on which
  // shape the schema's foreign key happens to produce.
  const position = Array.isArray(data.positions) ? data.positions[0] : data.positions;
  return typeof position?.description === "string" ? position.description : "";
}

// AC-V4/C8 (Group V architecture doc): the employer's name and job title for
// the selected application — what V4's company-facts search is built from.
// A separate function for the same reason fetchPostingDescription is
// separate from fetchApplicationDocs: `positions(description)` above is kept
// away from any bag of fields a prompt builder might be handed wholesale
// (AC-H7.27), and widening ITS return to add company/title would erode
// exactly that boundary. This reads the same `positions` row through its own
// query instead.
//
// Never throws, exactly like its two siblings above: every failure mode — no
// applicationId, no userId, no matching row, an application with no joined
// position, a null/non-string field, or any query error — degrades to
// `{ company: "", title: "" }`, which callers treat as "no employer known"
// rather than an error.
export async function fetchPostingEmployer(supabase, { applicationId, userId } = {}) {
  const empty = { company: "", title: "" };
  if (!applicationId || !userId) return empty;

  // Same non-optional user_id scoping as fetchPostingDescription, and for
  // the same reason: an application-scoped lookup must never read another
  // user's posting even if RLS is ever misconfigured.
  const { data, error } = await supabase
    .from("applications")
    .select("id, positions ( company, title )")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return empty;

  // Same either-shape acceptance as fetchPostingDescription: PostgREST
  // returns an embedded one-to-one relation as an object and a one-to-many
  // as an array, and this caller does not depend on which the schema's
  // foreign key happens to produce.
  const position = Array.isArray(data.positions) ? data.positions[0] : data.positions;
  return {
    company: typeof position?.company === "string" ? position.company : "",
    title: typeof position?.title === "string" ? position.title : "",
  };
}
