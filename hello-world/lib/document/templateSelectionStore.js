// N151a: the per-(user,kind) SELECTION of which saved template formats the next
// generation, over the template_selections table (supabase/migrations/
// 20261008010000_n151a_template_selections.sql) and the shipped
// resume_templates library (N64). The PK(user_id, kind) makes "at most one
// active template per kind" structural, and changing the choice is one upsert.
//
// getActiveTemplateBytes is the consumption read the /api/templates/default
// route's bytes path delegates to. Its precedence is load-bearing:
//   the selected template's bytes  ??  the N97 reserved-name default's bytes
//   ??  null
// so a user with no explicit selection (every N97 user) keeps formatting their
// output with the default they already set, and a user with neither gets a
// strict null -- which keeps the doc-build override a no-op (N97 AC-8).
//
// Every function takes the caller's AUTHED supabase client and an explicit
// userId; RLS and this module's own `.eq("user_id", userId)` both enforce
// ownership, and userId is never trusted from anywhere but the route's own
// getUser() call. GRACEFUL DEGRADATION (BL-A): template_selections may not be
// live in every environment, so every read here returns null (never throws)
// on a missing table/bucket or any other query error, and the write refuses
// with { error } -- a caller with no substrate degrades to "no selection",
// which falls through to the reserved default and then to native rendering.

import { getDefaultTemplateBytes } from "@/lib/document/defaultTemplateStore.js";

const BUCKET = "resumes";
const VALID_KINDS = ["resume", "cover"];

/** @returns {Promise<{ template_id: string | null } | null>} the caller's
 *  selection row for this kind, or null when there is none or the substrate
 *  is unavailable. */
export async function getSelection(supabase, { userId, kind }) {
  if (!VALID_KINDS.includes(kind)) return null;
  try {
    const { data, error } = await supabase
      .from("template_selections")
      .select("*")
      .eq("user_id", userId)
      .eq("kind", kind)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

/** Make `templateId` the caller's active template for `kind` -- one upsert on
 *  the (user_id, kind) primary key, so a second call replaces the first. The
 *  template must be one the caller owns: this store never reads another
 *  user's row (getActiveTemplateBytes gates the template read on user_id too).
 *  @returns {Promise<{ ok: true } | { error: string }>} */
export async function setSelection(supabase, { userId, kind, templateId }) {
  if (!VALID_KINDS.includes(kind)) return { error: `Unsupported template kind: ${kind}.` };
  if (!templateId) return { error: "No template to select." };
  try {
    const { error } = await supabase
      .from("template_selections")
      .upsert(
        { user_id: userId, kind, template_id: templateId, updated_at: new Date().toISOString() },
        { onConflict: "user_id,kind" },
      );
    if (error) return { error: error.message || "Unable to select the template." };
    return { ok: true };
  } catch (err) {
    return { error: err?.message || "Unable to select the template." };
  }
}

// The selected template's bytes, or null when there is no selection, the
// template row is gone/foreign, or the stored object cannot be read -- every
// null here is a deliberate fall-through to the reserved default.
async function getSelectedTemplateBytes(supabase, { userId, kind }) {
  const selection = await getSelection(supabase, { userId, kind });
  if (!selection?.template_id) return null;
  try {
    const { data: row } = await supabase
      .from("resume_templates")
      .select("*")
      .eq("id", selection.template_id)
      .eq("user_id", userId)
      .eq("kind", kind)
      .maybeSingle();
    if (!row?.storage_path) return null;
    const { data, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
    if (error || !data) return null;
    const buffer = await data.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) return null;
    return { bytes: new Uint8Array(buffer) };
  } catch {
    return null;
  }
}

/** @returns {Promise<{ bytes: Uint8Array } | null>} the docx bytes that should
 *  format the caller's next `kind` document: selected template ?? reserved
 *  default ?? null. */
export async function getActiveTemplateBytes(supabase, { userId, kind }) {
  if (!VALID_KINDS.includes(kind)) return null;
  const selected = await getSelectedTemplateBytes(supabase, { userId, kind });
  if (selected) return selected;
  return getDefaultTemplateBytes(supabase, { userId, kind });
}
