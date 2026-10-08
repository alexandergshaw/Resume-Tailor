// N151a: the per-user, per-kind TEMPLATE LIBRARY over the SHIPPED
// resume_templates table (N64) plus the "resumes" storage bucket. N97 used the
// table degenerately (one row per kind under a reserved name); the unique index
// on (user_id, kind, lower(name)) always allowed many named rows, and this
// store is those ordinary named rows -- no schema change to resume_templates.
//
// A template is a snapshot: registerTemplate COPIES the supplied bytes to a
// per-template object at `${userId}/templates/${id}.docx` (N64's original
// per-id path), never pointing at the source material's own object. Deleting
// or replacing the material therefore never breaks a template, and the
// reserved N97 default's fixed path is never touched.
//
// Every function takes the caller's AUTHED supabase client and an explicit
// userId; RLS and this module's own `.eq("user_id", userId)` both enforce
// ownership. Reads degrade to [] (never throw) when the substrate is missing
// (BL-A); writes refuse with { error } rather than throwing.

import { DOCX_MIME } from "@/lib/drive/driveMime";

const BUCKET = "resumes";
const VALID_KINDS = ["resume", "cover"];

function templatePath(userId, id) {
  return `${userId}/templates/${id}.docx`;
}

// Normalise the supported byte carriers to a Uint8Array; null when the value
// is not one of them.
async function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (bytes && typeof bytes.arrayBuffer === "function") {
    return new Uint8Array(await bytes.arrayBuffer());
  }
  return null;
}

function isUniqueViolation(error) {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /unique|duplicate/i.test(error.message || "");
}

// Best-effort object removal: a leftover object is harmless, a thrown error
// would mask the real outcome the caller is reporting.
async function removeObject(supabase, path) {
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // intentionally ignored -- see above
  }
}

/** @returns {Promise<Array<{id,name,kind,storage_path,updated_at}>>} the
 *  caller's templates for this kind, newest first; [] when none or the
 *  substrate is unavailable. */
export async function listTemplates(supabase, { userId, kind }) {
  if (!VALID_KINDS.includes(kind)) return [];
  try {
    const { data, error } = await supabase
      .from("resume_templates")
      .select("id, name, kind, storage_path, updated_at")
      .eq("user_id", userId)
      .eq("kind", kind)
      .order("updated_at", { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

/** Upload the bytes to a fresh per-id path FIRST, then insert the named row --
 *  ordering is load-bearing: a row never names a path with no bytes behind
 *  it. A name collision (the unique (user_id,kind,lower(name)) index) is
 *  returned as a friendly { error, duplicate: true }, never a raw 23505, and
 *  the object uploaded for the failed insert is removed.
 *  @returns {Promise<{ row } | { error: string, duplicate?: true }>} */
export async function registerTemplate(supabase, { userId, kind, name, bytes }) {
  if (!VALID_KINDS.includes(kind)) return { error: `Unsupported template kind: ${kind}.` };
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) return { error: "A template needs a name." };
  const decoded = await toBytes(bytes);
  if (!decoded || decoded.length === 0) {
    return { error: "No document bytes to save as a template." };
  }

  const id = globalThis.crypto.randomUUID();
  const path = templatePath(userId, id);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, decoded, { contentType: DOCX_MIME, upsert: true });
  if (uploadError) {
    return { error: uploadError.message || "Unable to store the template." };
  }

  const { data, error } = await supabase
    .from("resume_templates")
    .insert({ id, user_id: userId, kind, name: cleanName, storage_path: path })
    .select()
    .single();
  if (!error) return { row: data };

  await removeObject(supabase, path);
  if (isUniqueViolation(error)) {
    return { error: `You already have a template named "${cleanName}".`, duplicate: true };
  }
  return { error: error.message || "Unable to save the template." };
}

/** Row delete (id + user_id gated) plus a best-effort removal of the stored
 *  object. Deleting the selected template nulls the selection pointer
 *  (template_selections.template_id is ON DELETE SET NULL), so consumption
 *  falls back to the reserved default or native rendering.
 *  @returns {Promise<{ ok: true } | { error: string }>} */
export async function deleteTemplate(supabase, { userId, id }) {
  if (!id) return { error: "No template specified." };
  const { data: row } = await supabase
    .from("resume_templates")
    .select("storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  const { error } = await supabase
    .from("resume_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) return { error: error.message || "Unable to delete the template." };
  if (row?.storage_path) await removeObject(supabase, row.storage_path);
  return { ok: true };
}
