// Read side of the append-only generation history. Every tailoring run
// (initial generate, revise, focus change) already inserts a new row into
// generated_resumes / generated_cover_letters — see saveGeneratedResume.js,
// saveGeneratedCoverLetter.js, and persistGeneration.js, none of which
// dedupe or delete — so a full version trail accumulates per position with
// no schema change. This module is the only piece needed to read it back:
// query the same table by position_id instead of by a single row id.

const TABLE_BY_SCOPE = {
  resume: "generated_resumes",
  cover: "generated_cover_letters",
};

// D-1 fix (ARCH.md Wave 1): the résumé branch needs docx_path so
// selectDocumentVersion (app/hooks/useDocumentPreview.js) can point the
// preview/download at the SELECTED version's own stored docx instead of
// leaving stale bytes in place. N59: generated_cover_letters now ALSO has a
// docx_path column (migration 20260928000000_n59_cover_letter_docx_path.sql,
// F-11 resolved) -- the cover branch selects it too, so switching a cover
// version can resolve its own stored engine document instead of falling back
// to today's honest "no stored bytes" refusal. Kept per-scope (not merged
// into one shared string) so a future divergence between the two tables'
// columns stays easy to express.
const COLUMNS_BY_SCOPE = {
  resume: "id, content, content_lines, created_at, docx_path",
  cover: "id, content, content_lines, created_at, docx_path",
};

// A generous but finite cap. A single posting accumulates one row per
// generate, per revise, and per focus change (which regenerates both
// documents), so an unbounded fetch here would make an oft-revised
// posting's preview open pull an ever-growing history every time. 25
// comfortably covers realistic revision activity on one posting without
// needing pagination in the version control.
const MAX_VERSIONS = 25;

/**
 * Returns one scope's generation history for a position, newest first:
 * id, content, content_lines, created_at, docx_path (D-1 fix for résumé,
 * N59 for cover). Never throws — a signed-out client, an RLS-denied row, or
 * a transient query failure all resolve to an empty array, and the version
 * control (AC-7) treats that the same as "no history" rather than surfacing
 * an error.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {"resume"|"cover"} scope
 * @param {string} positionId
 * @returns {Promise<Array<{ id: string, content: string, content_lines: any[], created_at: string, docx_path?: string }>>}
 */
export async function fetchDocumentVersions(supabase, scope, positionId) {
  const table = TABLE_BY_SCOPE[scope];
  if (!supabase || !table || !positionId) return [];

  try {
    const { data, error } = await supabase
      .from(table)
      .select(COLUMNS_BY_SCOPE[scope])
      .eq("position_id", positionId)
      .order("created_at", { ascending: false })
      .limit(MAX_VERSIONS);

    if (error) {
      console.warn(`[fetchDocumentVersions] ${table} query failed:`, error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn(`[fetchDocumentVersions] ${table} query threw:`, err?.message || err);
    return [];
  }
}

/**
 * Best-effort pointer update (AC-6): after the user picks an older/newer
 * version to display, repoint the application row's resume_used_id /
 * cover_letter_id at that version so a page reload restores the version the
 * user chose instead of snapping back to the newest generation. Same
 * user_id + position_id targeting as the pointer update half of
 * persistGeneratedDocuments (lib/supabase/persistGeneration.js), just
 * aimed at a version the user picked rather than one that call just wrote.
 *
 * Never throws, and never blocks the UI on failure — the version is
 * already shown correctly in-session by the time this is called; a failed
 * pointer update only means a later reload would show the newest version
 * again, not that anything breaks now.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ scope: "resume"|"cover", versionId: string, userId: string, positionId: string }} params
 * @returns {Promise<boolean>} whether the pointer update succeeded
 */
export async function pointApplicationAtVersion(supabase, { scope, versionId, userId, positionId }) {
  if (!supabase || !versionId || !userId || !positionId) return false;
  const column = scope === "cover" ? "cover_letter_id" : "resume_used_id";
  try {
    const { error } = await supabase
      .from("applications")
      .update({ [column]: versionId })
      .eq("user_id", userId)
      .eq("position_id", positionId);
    if (error) {
      console.warn("[pointApplicationAtVersion] update failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[pointApplicationAtVersion] threw:", err?.message || err);
    return false;
  }
}
