// Per-user storage for the ONE PowerPoint template BulkActionsBar's
// "PowerPoint" action remembers and reuses silently (this project's own
// minimize-clicks directive: uploading a template is a secondary control,
// never a step the generate flow makes the user repeat). Same `resumes`
// bucket and `${user_id}/...` convention as lib/supabase/materials.js, but
// deliberately NOT a materials.js-style named locker (list/upload/download/
// remove by file name): there is only ever ONE template per user, so it
// lives at a FIXED path regardless of what the uploaded file was called.
// That fixed path is what makes re-uploading a plain overwrite - there is
// never a stale older template left behind to reconcile or list.
//
// pptxTemplate.js's inspectPptxTemplate validates a template by its OOXML
// CONTENT, never by file extension, so the stored bytes are kept under a
// generic "template.pptx" name irrespective of whether the upload was
// actually a .pptx or a .potx. The uploaded file's own name is kept
// separately, in a tiny JSON sidecar, purely so a later read failure
// (buildDeck rejecting the stored bytes - see pptxWriter.js) can name the
// right file in the message shown to the user; losing that sidecar (a
// half-failed upload, say) degrades to a generic name rather than losing
// the template itself.
//
// Resolves the signed-in user itself from the browser Supabase client,
// mirroring lib/copilot/applicationDocsClient.js's own loadApplicationDocs -
// BulkActionsBar.js is nested well below ExperienceTab.js (out of scope for
// this chunk, and it owns no userId today), so this has no prop path to
// receive one through and asks the client SDK directly instead.

import { createClient } from "../supabase/client.js";

const BUCKET = "resumes";
const SUBFOLDER = "deck-template";
const TEMPLATE_FILE = "template.pptx";
const META_FILE = "template.meta.json";

function folder(userId) {
  return `${userId}/${SUBFOLDER}`;
}

async function currentUserId(supabase) {
  const { data: { user } = {}, error } = await supabase.auth.getUser();
  if (error || !user?.id) return null;
  return user.id;
}

// uploadDeckTemplate(file) -> Promise<{ error: string|null, name?: string }>
//
// Overwrites whatever template this user had stored before (upsert on a
// fixed path - see this file's header). The file's own name is saved
// alongside it so a future unreadable-template error can name it; a failure
// writing THAT sidecar is logged and swallowed rather than failing the
// whole upload, since the template bytes (what generation actually needs)
// already saved successfully.
export async function uploadDeckTemplate(file) {
  if (!file) return { error: "Missing file." };

  const supabase = createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Sign in to save a PowerPoint template." };

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${folder(userId)}/${TEMPLATE_FILE}`, file, {
      upsert: true,
      contentType:
        file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  if (error) return { error: error.message || "Upload failed." };

  const name = file.name || "template.pptx";
  const metaBlob = new Blob([JSON.stringify({ name })], { type: "application/json" });
  const { error: metaError } = await supabase.storage
    .from(BUCKET)
    .upload(`${folder(userId)}/${META_FILE}`, metaBlob, { upsert: true, contentType: "application/json" });
  if (metaError) {
    console.warn("[deckTemplateStore] template name sidecar failed to save:", metaError.message);
  }

  return { error: null, name };
}

// fetchDeckTemplate() -> Promise<{ blob: Blob|null, name: string|null }>
//
// `blob` is null both when this user has never uploaded a template AND when
// the download itself fails for any other reason (signed out, storage
// error) - "no template ever uploaded" is meant to be indistinguishable
// from "can't currently get at it" from the caller's point of view, because
// EITHER way the right thing is the same: fall back to generating without
// one (pptxWriter.js's own built-in skeleton), never block the user's
// click. This is a different failure than buildDeck's own rejection of
// BYTES it successfully received but could not parse as a usable
// PowerPoint file - that one IS surfaced, by the caller catching buildDeck's
// thrown Error, not by this function.
export async function fetchDeckTemplate() {
  const supabase = createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { blob: null, name: null };

  const { data, error } = await supabase.storage.from(BUCKET).download(`${folder(userId)}/${TEMPLATE_FILE}`);
  if (error || !data) return { blob: null, name: null };

  let name = "template.pptx";
  try {
    const { data: metaBlob, error: metaError } = await supabase.storage
      .from(BUCKET)
      .download(`${folder(userId)}/${META_FILE}`);
    if (!metaError && metaBlob) {
      const parsed = JSON.parse(await metaBlob.text());
      if (parsed && typeof parsed.name === "string" && parsed.name) name = parsed.name;
    }
  } catch {
    // Sidecar missing or corrupt - fall back to the generic name above
    // rather than failing the whole fetch over a cosmetic detail.
  }

  return { blob: data, name };
}
