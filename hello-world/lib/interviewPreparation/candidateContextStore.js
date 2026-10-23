import { createHash } from "node:crypto";

const origin = "generated-application-ready";
function document(kind, state = "missing", error = null) {
  return { kind, state, origin, documentId: null, contentIdentity: null, text: "", createdAt: null, error };
}
function fingerprint(doc) {
  return JSON.stringify([doc.state, doc.documentId, doc.contentIdentity]);
}
async function pointers(supabase, userId, applicationId) {
  try {
    const result = await supabase.from("applications").select("id,resume_used_id,cover_letter_id")
      .eq("id", applicationId).eq("user_id", userId).maybeSingle();
    if (result.error) return { error: "Application source lookup failed." };
    return { row: result.data || null };
  } catch { return { error: "Application source lookup failed." }; }
}
async function readDocument(supabase, userId, kind, id) {
  if (!id) return document(kind);
  try {
    const { data, error } = await supabase.from(kind === "resume" ? "generated_resumes" : "generated_cover_letters")
      .select("id,user_id,content,created_at").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) return document(kind, "error", `The selected ${kind} could not be loaded. Reload sources.`);
    if (!data) return document(kind);
    if (data.id !== id || data.user_id !== userId || typeof data.content !== "string") {
      return document(kind, "error", `The selected ${kind} returned invalid source data.`);
    }
    if (!data.content.trim()) return document(kind);
    return { kind, state: "ready", origin, documentId: id,
      contentIdentity: `sha256:${createHash("sha256").update(data.content, "utf8").digest("hex")}`,
      text: data.content, createdAt: typeof data.created_at === "string" ? data.created_at : null, error: null };
  } catch { return document(kind, "error", `The selected ${kind} could not be loaded. Reload sources.`); }
}

// A bounded observation, not a transaction. No retry hides changing source data.
export async function loadCandidateSources(supabase, { userId, applicationId } = {}) {
  const base = () => ({ accountId: userId, applicationId, mode: "application", status: "error",
    resume: document("resume"), cover: document("cover"), observedAt: new Date().toISOString(),
    consistency: "stable-double-read", historicalStrength: { resume: null, cover: null } });
  if (!userId || !applicationId) return { ...base(), error: "An authenticated application is required.", code: "invalid" };
  const first = await pointers(supabase, userId, applicationId);
  if (first.error) return { ...base(), error: first.error, code: "source-error" };
  if (!first.row) return { ...base(), error: "Application not found.", code: "not-found" };
  const readPair = () => Promise.all([
    readDocument(supabase, userId, "resume", first.row.resume_used_id),
    readDocument(supabase, userId, "cover", first.row.cover_letter_id),
  ]);
  const [resume, cover] = await readPair();
  const [resumeAgain, coverAgain] = await readPair();
  const last = await pointers(supabase, userId, applicationId);
  if (last.error) return { ...base(), error: last.error, code: "source-error" };
  if (!last.row || first.row.resume_used_id !== last.row.resume_used_id || first.row.cover_letter_id !== last.row.cover_letter_id ||
      fingerprint(resume) !== fingerprint(resumeAgain) || fingerprint(cover) !== fingerprint(coverAgain)) {
    return { ...base(), status: "stale", error: "Application documents changed while loading. Reload sources.", code: "stale-context" };
  }
  if (resume.state === "error" || cover.state === "error") {
    return { ...base(), resume, cover, error: "Selected application documents could not be loaded. Reload sources.", code: "source-error" };
  }
  return { ...base(), resume, cover, status: resume.state === "ready" && cover.state === "ready" ? "ready" : "partial" };
}
