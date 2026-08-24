// Data access for project-page attachments
// (public.experience_attachments — see
// supabase/migrations/20260812010000_experience_attachments.sql) and their
// objects in the existing `resumes` storage bucket. Shaped like
// lib/supabase/experiencePages.js, not lib/supabase/practiceAnswers.js: every
// function here takes the caller's own authenticated `supabase` client and
// `userId` (resolved once by the route via lib/experience/apiAuth.js's
// getAuth) and scopes every query by `user_id` explicitly, in addition to
// RLS. Nothing here throws — every function returns a result object, so a
// failed call is data the route can branch on rather than an exception.
//
// The two STORAGE-OBJECT helpers at the bottom — downloadAttachmentBlob and
// signedAttachmentUrl — are the deliberate exception, and always have been:
// neither takes a `userId`, because neither touches the table, and there is
// no `user_id` column on a storage object to filter by. What they take
// instead is a `storage_path` the caller has already read off a row it
// fetched user-scoped, so the ownership check happened before the path ever
// existed as a value. The bucket then enforces it a second time on its own:
// `resumes` is owner-scoped by the storage policy documented at
// lib/supabase/practiceAnswers.js:4-6 (`auth.uid()::text =
// (storage.foldername(name))[1]`), so a path belonging to another user is
// refused by Postgres no matter what this module was handed. Anything NEW
// that reads or writes the TABLE still takes a userId and still filters on
// it — this carve-out covers those two functions, not a general relaxation.

import { storagePathFor } from "@/lib/experience/attachments";

const TABLE = "experience_attachments";
const BUCKET = "resumes";

// How long a preview link stays valid after signedAttachmentUrl mints it —
// the bucket is private, so a public URL is never an option. Matches
// lib/supabase/practiceAnswers.js's SIGNED_URL_TTL_SECONDS.
const SIGNED_URL_TTL_SECONDS = 600;

export async function listAttachments(supabase, userId, pageId) {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("page_id", pageId)
      .order("created_at", { ascending: true });
    if (error) return { attachments: null, error: error.message || "Could not load attachments." };
    return { attachments: data || [], error: null };
  } catch (err) {
    return { attachments: null, error: err?.message || "Could not load attachments." };
  }
}

// Uploads the file to storage FIRST, at the key storagePathFor builds from
// `id` (the client-generated row id — see the migration's own comment), and
// only then inserts the row. If the insert fails, the just-uploaded object
// is removed so it can never be orphaned — reachable by no one and
// deletable by no one — mirroring lib/supabase/practiceAnswers.js's
// savePracticeAnswer. If THAT cleanup itself fails, that failure is folded
// into the returned error too rather than silently discarded.
export async function createAttachment(supabase, userId, { id, pageId, file, name, mime, bytes, notes } = {}) {
  try {
    const storagePath = storagePathFor(userId, pageId, id, name);

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: mime || undefined,
      upsert: false,
    });
    if (uploadError) {
      // stage: "upload" - this failure is about the caller's OWN file (a
      // storage-key or bucket-restriction refusal), never about another
      // tenant's row, so the route is safe to report it verbatim. Distinct
      // from the "insert" stage below, whose message can carry a duplicate-
      // key error that names another user's existing row.
      return { attachment: null, error: uploadError.message || "Could not upload this file.", stage: "upload" };
    }

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        id,
        user_id: userId,
        page_id: pageId,
        name: name || "",
        mime: mime || "",
        bytes: Number.isFinite(bytes) ? Math.round(bytes) : null,
        storage_path: storagePath,
        notes: notes || "",
      })
      .select()
      .single();

    if (error) {
      // stage: "insert" on both branches below - this is the failure that
      // can carry Postgres's "duplicate key value violates unique
      // constraint" text, a cross-tenant existence oracle for attachment
      // ids, so the route must keep genericizing it no matter which of
      // these two shapes it took.
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (cleanupError) {
        return {
          attachment: null,
          error: `${error.message || "Could not save this attachment."} The uploaded file also could not be cleaned up (${cleanupError.message || "storage error"}) and may remain in storage without an entry.`,
          stage: "insert",
        };
      }
      return { attachment: null, error: error.message || "Could not save this attachment.", stage: "insert" };
    }

    return { attachment: data, error: null };
  } catch (err) {
    // stage: "unknown" - could be either exit above (or something neither
    // anticipated, e.g. a network throw), so the route cannot assume this
    // is safe to report verbatim and must keep genericizing it too.
    return { attachment: null, error: err?.message || "Could not save this attachment.", stage: "unknown" };
  }
}

// Updates only the free-text notes field — the one thing about an
// already-uploaded attachment a caller can change without re-uploading it.
export async function updateAttachmentNotes(supabase, userId, id, notes) {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ notes: notes || "" })
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle();
    if (error) return { attachment: null, error: error.message || "Could not update this attachment." };
    return { attachment: data || null, error: null };
  } catch (err) {
    return { attachment: null, error: err?.message || "Could not update this attachment." };
  }
}

// Verifies ownership of the ROW — scoped by both id and user_id — BEFORE
// touching storage at all. `{ deleted: false, error: null }` (a row that
// does not belong to this user, or does not exist) is what lets the DELETE
// route answer 404 rather than 403, and it is also what stops a guessed id
// from ever reaching a storage.remove call for an object this caller does
// not own: removing someone else's object because the id was guessable is
// exactly the failure this ordering prevents.
export async function deleteAttachment(supabase, userId, id) {
  try {
    const { data: row, error: fetchError } = await supabase
      .from(TABLE)
      .select("storage_path")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (fetchError) return { deleted: false, error: fetchError.message || "Could not delete this attachment." };
    if (!row) return { deleted: false, error: null };

    if (row.storage_path) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
      const notFound = removeError && /not.?found/i.test(removeError.message || "");
      if (removeError && !notFound) {
        return { deleted: false, error: removeError.message || "Could not remove the stored file." };
      }
    }

    const { error: deleteError } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", userId);
    if (deleteError) return { deleted: false, error: deleteError.message || "Could not delete this attachment." };

    return { deleted: true, error: null };
  } catch (err) {
    return { deleted: false, error: err?.message || "Could not delete this attachment." };
  }
}

// Reads one attachment's bytes back out of storage, at the row's own
// storage_path. Shaped after lib/supabase/materials.js's downloadMaterialBlob
// — the existing precedent in this repo for reading a file back out of the
// private `resumes` bucket — rather than inventing a second shape here. An
// empty success (`{ data: null, error: null }`, which storage-js can return
// for a missing object) is still reported as a failure: returning
// `{ blob: null, error: null }` would read as success to every caller and
// silently download nothing at all.
export async function downloadAttachmentBlob(supabase, storagePath) {
  try {
    if (!storagePath) return { blob: null, error: "No file is stored for this attachment." };
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) return { blob: null, error: error?.message || "Could not download this file." };
    return { blob: data, error: null };
  } catch (err) {
    return { blob: null, error: err?.message || "Could not download this file." };
  }
}

// A time-limited signed URL for one attachment's inline preview (image
// thumbnail or `<video controls>` source). Minted on demand, never stored —
// matches lib/supabase/practiceAnswers.js's signedVideoUrl.
export async function signedAttachmentUrl(supabase, storagePath) {
  try {
    if (!storagePath) return { url: null, error: "No file is stored for this attachment." };
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return { url: null, error: error?.message || "Could not create a preview link." };
    return { url: data.signedUrl, error: null };
  } catch (err) {
    return { url: null, error: err?.message || "Could not create a preview link." };
  }
}
