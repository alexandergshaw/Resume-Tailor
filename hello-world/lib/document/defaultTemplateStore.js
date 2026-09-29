// N97: the per-(user,kind) DEFAULT TEMPLATE store, over the SHIPPED
// resume_templates table (N64's migration, no new migration -- design §2)
// plus the "resumes" storage bucket. There is no named collection and no
// separate default-pointer column: the default for a kind IS the one row
// reserved for it, under a FIXED (never user-typed) name, at a FIXED
// per-kind storage path. The shipped unique index on
// (user_id, kind, lower(name)) is what makes "two defaults for one kind"
// structurally impossible, not merely avoided (AC-9/design §2).
//
// Every function here takes the caller's AUTHED supabase client and an
// explicit userId -- RLS and this module's own `.eq("user_id", userId)`
// both enforce ownership (AC-6); userId is never trusted from anywhere but
// the route's own getUser() call (route.js).
//
// GRACEFUL DEGRADATION (BL-A): resume_templates/"resumes" may not be live in
// every environment. Every read here returns null (never throws) when the
// table/bucket is missing or the query otherwise errors, and the write
// refuses with { error } rather than throwing -- so a caller with no
// substrate degrades to "no default set", not a crash (AC-8 depends on this:
// a null default is a strict no-op at the doc-build override).

import { DOCX_MIME } from "@/lib/drive/driveMime";

const BUCKET = "resumes";
const VALID_KINDS = ["resume", "cover"];

// Fixed per kind, never derived from the uploaded file's own name (AC-9): a
// user-typed name is exactly what would let the unique index collide on a
// repeated promote and surface a raw constraint error.
const RESERVED_NAME = {
  resume: "Default résumé template",
  cover: "Default cover-letter template",
};

function templatePath(userId, kind) {
  return `${userId}/templates/default-${kind}.docx`;
}

function isEmptyBytes(bytes) {
  if (!bytes) return true;
  if (bytes instanceof Uint8Array) return bytes.length === 0;
  if (bytes instanceof ArrayBuffer) return bytes.byteLength === 0;
  if (typeof bytes.size === "number") return bytes.size === 0; // Blob/File
  return false;
}

async function toUint8Array(bytes) {
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

/** Upload the captured bytes to the fixed per-kind path (upsert:true) FIRST,
 *  then upsert the reserved-name row -- ordering is load-bearing (R10): a row
 *  never names a path with no bytes behind it. `fileName` is accepted for
 *  parity with the upload's own file but is deliberately unused for the
 *  row's name -- the reserved name (above) is what a repeated promote must
 *  keep hitting, not whatever the user's document happened to be called.
 *  @returns {Promise<{ row, replaced: boolean } | { error: string }>} */
export async function saveDefaultTemplate(supabase, { userId, kind, bytes }) {
  if (!VALID_KINDS.includes(kind)) {
    return { error: `Unsupported template kind: ${kind}.` };
  }
  if (isEmptyBytes(bytes)) {
    return { error: "No document bytes to save as a template." };
  }
  const decoded = await toUint8Array(bytes);
  if (!decoded || decoded.length === 0) {
    return { error: "No document bytes to save as a template." };
  }

  const path = templatePath(userId, kind);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, decoded, { contentType: DOCX_MIME, upsert: true });
  if (uploadError) {
    return { error: uploadError.message || "Unable to store the template." };
  }

  const name = RESERVED_NAME[kind];
  const { data: existing } = await supabase
    .from("resume_templates")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("name", name)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("resume_templates")
      .update({ storage_path: path, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) return { error: error.message };
    return { row: data, replaced: true };
  }

  const { data, error } = await supabase
    .from("resume_templates")
    .insert({ user_id: userId, kind, name, storage_path: path })
    .select()
    .single();
  if (!error) return { row: data, replaced: false };

  // R8/AC-9: a concurrent double-promote can lose the race against the
  // select above -- the unique (user_id,kind,lower(name)) index then rejects
  // this insert. Caught here and resolved as an update, never surfaced to
  // the caller as a raw 23505.
  if (isUniqueViolation(error)) {
    const { data: retried, error: retryError } = await supabase
      .from("resume_templates")
      .update({ storage_path: path, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("name", name)
      .select()
      .single();
    if (retryError) return { error: retryError.message };
    return { row: retried, replaced: true };
  }
  return { error: error.message };
}

/** @returns {Promise<{id,name,kind,storage_path,updated_at}|null>} the
 *  reserved-name default row for this kind, or null when absent or the
 *  substrate is unavailable. */
export async function getDefaultTemplate(supabase, { userId, kind }) {
  if (!VALID_KINDS.includes(kind)) return null;
  const { data } = await supabase
    .from("resume_templates")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("name", RESERVED_NAME[kind])
    .maybeSingle();
  return data || null;
}

/** @returns {Promise<{ bytes: Uint8Array } | null>} the default template's
 *  docx bytes, or null when no default is set or the stored object is gone. */
export async function getDefaultTemplateBytes(supabase, { userId, kind }) {
  const row = await getDefaultTemplate(supabase, { userId, kind });
  if (!row?.storage_path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
  if (error || !data) return null;
  const buffer = await data.arrayBuffer();
  return { bytes: new Uint8Array(buffer) };
}

/** Row delete (id+user_id gated) + best-effort storage remove. Shipped even
 *  without a UI control yet (plan §7 OPEN) so a future "clear default"
 *  affordance needs no backend change.
 *  @returns {Promise<{ ok: true } | { error: string }>} */
export async function clearDefaultTemplate(supabase, { userId, kind }) {
  if (!VALID_KINDS.includes(kind)) return { error: `Unsupported template kind: ${kind}.` };
  const { error } = await supabase
    .from("resume_templates")
    .delete()
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("name", RESERVED_NAME[kind]);
  if (error) return { error: error.message };
  await supabase.storage.from(BUCKET).remove([templatePath(userId, kind)]);
  return { ok: true };
}
