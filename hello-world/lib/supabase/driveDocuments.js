// Data access for the per-user Google Drive document identity table
// (public.drive_documents — see supabase/migrations/20260901000000_drive.sql).
// One row per (user_id, position_id, scope): the Drive Doc this app keeps
// updating in place for a given posting's résumé or cover letter.
//
// Mirrors lib/supabase/applicationDigests.js: every function takes the
// caller's own authenticated `supabase` client and `userId` (never resolves
// its own session) and scopes every query by `user_id` explicitly, in
// addition to RLS — defense in depth, not a replacement for it. Nothing here
// throws — every function returns a result object, so a failed call is data
// the caller can branch on rather than an exception that could tear down a
// route (AC-P12).
//
// drive_file_id is NOT NULL at the schema level (see the migration's
// comment): a row is written only after a Drive call for that scope has
// already returned a file id, so upsertDriveDocument is a plain upsert on
// the primary key, never a two-step claim/settle protocol. Concurrency
// between two clients is handled above this module (a `files.list`-by-name
// lookup before create, plus a three-way version compare before update —
// ARCH.md §7.5, §8.2), not by anything in this file.

const TABLE = "drive_documents";

// The third copy of the external-id -> positions.id lookup (the other two
// live in app/hooks/useDocumentPreview.js). Deliberately NOT consolidated —
// see ARCH.md's MAJ-9: positionIdRef there is reset synchronously and filled
// asynchronously, so routing the inline call through a shared helper could
// change timing for an unrelated flow. This copy exists so the Drive save
// route can resolve a position id with its own session client, server-side,
// without reaching into useDocumentPreview's private ref.
export async function resolvePositionId(supabase, jobId) {
  try {
    if (!jobId) return null;
    const { data } = await supabase
      .from("positions")
      .select("id")
      .eq("external_id", String(jobId))
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

// Every drive_documents row for one user's posting, keyed by scope, so a
// caller can look up `documents["resume"]` / `documents["cover"]` directly.
// Missing/falsy `positionId` returns an empty map without querying — a
// posting with no resolvable position id has no durable Drive reference by
// definition (AC-P14).
export async function listDriveDocuments(supabase, userId, positionId) {
  try {
    if (!positionId) return { documents: {}, error: null };

    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("position_id", positionId);
    if (error) return { documents: null, error: error.message || "Could not load Drive documents." };

    const documents = {};
    for (const row of data || []) documents[row.scope] = row;
    return { documents, error: null };
  } catch (err) {
    return { documents: null, error: err?.message || "Could not load Drive documents." };
  }
}

// Creates or overwrites the one drive_documents row for
// (userId, positionId, scope) — a Drive document identity is a "latest
// known" fact about a posting+scope, not a history, so this is always an
// upsert on the primary key (AC-P13), never an insert-then-update pair and
// never a bare `.insert(` (that append-only shape belongs to
// generated_resumes / generated_cover_letters, not here — see the migration
// header).
//
// `driveFileId` is required: drive_file_id is NOT NULL at the schema level,
// and a row must exist only for a Doc that actually exists (AC-P8) — so this
// function refuses to write a row without one rather than letting the
// database reject it as a constraint violation.
export async function upsertDriveDocument(supabase, userId, positionId, scope, fields = {}) {
  try {
    if (!positionId) return { document: null, error: "Missing position id." };
    if (!scope) return { document: null, error: "Missing scope." };
    if (!fields.driveFileId) return { document: null, error: "Missing Drive file id." };

    const row = {
      user_id: userId,
      position_id: positionId,
      scope,
      drive_file_id: fields.driveFileId,
      updated_at: new Date().toISOString(),
    };
    if (typeof fields.driveContentHash === "string" || fields.driveContentHash === null) {
      row.drive_content_hash = fields.driveContentHash;
    }
    if (typeof fields.driveFileVersion === "string" || fields.driveFileVersion === null) {
      row.drive_file_version = fields.driveFileVersion;
    }
    if (typeof fields.driveWebViewLink === "string" || fields.driveWebViewLink === null) {
      row.drive_web_view_link = fields.driveWebViewLink;
    }

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: "user_id,position_id,scope" })
      .select()
      .maybeSingle();
    if (error) return { document: null, error: error.message || "Could not save this Drive document." };
    return { document: data || null, error: null };
  } catch (err) {
    return { document: null, error: err?.message || "Could not save this Drive document." };
  }
}
