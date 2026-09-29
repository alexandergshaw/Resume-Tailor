// N97: the browser-side glue for the per-type default template (plan Step 3
// / Step 4). Two halves:
//   * resolveDefaultTemplateFile -- the CONSUMPTION read, called at every
//     current-session egress surface (useDocumentPreview.js,
//     useDriveDocuments.js, app/page.js) to resolve the `formattingTemplate`
//     override docx.js's resolveDocumentBlob accepts.
//   * promoteAsDefaultTemplate -- the CAPTURE write, called by the preview
//     modal's "Set as default template" control.
//
// Both go through the route (app/api/templates/default), not a direct
// browser Supabase call: the route already holds the authed, RLS-scoped
// server client and the getDefaultTemplateBytes/saveDefaultTemplate
// primitives, so this module stays a thin fetch wrapper. Every failure mode
// (signed out, no default set, the substrate not deployed -- BL-A) resolves
// to null/a refusal rather than throwing, so a caller with nothing to
// consume degrades to today's behaviour (AC-8).

import { DOCX_MIME } from "@/lib/drive/driveMime";

const ROUTE = "/api/templates/default";

/** Resolve the caller's default formatting template for a docx scope
 *  ("resume" | "cover") as a File, or null when signed out, no default is
 *  set, or the object can't be fetched.
 *  @returns {Promise<File | null>} */
export async function resolveDefaultTemplateFile(userId, kind) {
  if (!userId || (kind !== "resume" && kind !== "cover")) return null;
  try {
    const res = await fetch(`${ROUTE}?kind=${encodeURIComponent(kind)}&bytes=1`, {
      credentials: "include",
      // A stalled network must never hang a download/save indefinitely for a
      // feature the user never opted into (no default set) -- degrades to
      // "no default" exactly like every other failure mode here (AC-8).
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    // Defensive: only trust a response that actually declares itself a docx.
    // An unrelated 200 (an error page, a JSON body some other layer
    // returned) must never be handed to resolveDocumentBlob's override as if
    // it were the default template -- that would rebuild onto garbage bytes.
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("wordprocessingml")) return null;
    const buffer = await res.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) return null;
    return new File([buffer], `default-${kind}.docx`, { type: DOCX_MIME });
  } catch {
    return null;
  }
}

/** Promote a captured document as the default template for `kind`. Not
 *  exported -- promoteDefaultTemplateBlob (below) is the module's one public
 *  write entry point; nothing else needs this half on its own.
 *  @returns {Promise<{ ok: true, row, replaced } | { ok: false, error }>} */
async function promoteAsDefaultTemplate({ blob, kind, fileName }) {
  if (!blob) return { ok: false, error: "Nothing to save as a template." };
  const form = new FormData();
  form.append("file", blob, fileName || `default-${kind}.docx`);
  form.append("kind", kind);
  let res;
  try {
    res = await fetch(ROUTE, { method: "POST", body: form, credentials: "include" });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error || "Couldn't save the default template." };
  return { ok: true, row: body?.row, replaced: !!body?.replaced };
}

/** Turn an ALREADY-CAPTURED blob (or null) into the scope-flags patch the
 *  promote handler applies as-is. Split out of the handler so the hook that
 *  calls buildPreviewBlob (AC-2/R2: no formattingTemplate override -- the
 *  capture is always engine-native) stays the only place that does, without
 *  growing past its own line cap. `blob` is null exactly when AC-3c's
 *  refuse-when-uncapturable case applies (email, or a reloaded Gemini doc
 *  whose uploaded File is gone) -- refuses, writing nothing.
 *  @returns {Promise<{ error: string, notice: string }>} */
export async function promoteDefaultTemplateBlob(blob, kind) {
  if (!blob) {
    return {
      error: "Can't set a default template from this document — reopen and regenerate it, then try again.",
      notice: "",
    };
  }
  const outcome = await promoteAsDefaultTemplate({ blob, kind, fileName: `${kind}-template.docx` });
  if (!outcome.ok) return { error: outcome.error || "Couldn't set the default template.", notice: "" };
  return {
    error: "",
    notice: outcome.replaced
      ? "Replaced your default template for future documents."
      : "Set as your default template for future documents.",
  };
}
