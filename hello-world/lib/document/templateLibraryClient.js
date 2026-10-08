// N151a: the browser-side glue for the template LIBRARY. Today one half:
// registerTemplateFromBytes, the write the materials section's "Add to
// template library" control reaches through useMaterialsLocker. It posts to the
// route (app/api/templates/library), not a direct browser Supabase call, so it
// reuses the route's session auth, its .docx validation, and the register +
// make-active step the route performs in one request.
//
// Every failure mode (signed out, the network, a refusal, the substrate not
// deployed -- BL-A) resolves to { ok: false, error } rather than throwing, so
// a caller can show the message without a try/catch of its own.

const ROUTE = "/api/templates/library";

/** Add `blob` (a .docx File/Blob) to the caller's template library as `name`
 *  and make it the active template for `kind`.
 *  @returns {Promise<{ ok: true, row, selected: boolean } | { ok: false, error: string }>} */
export async function registerTemplateFromBytes({ kind, name, blob }) {
  if (!blob) return { ok: false, error: "Nothing to save as a template." };
  const form = new FormData();
  form.append("file", blob, `${name || kind}.docx`);
  form.append("kind", kind);
  form.append("name", name || "");
  let res;
  try {
    res = await fetch(ROUTE, {
      method: "POST",
      body: form,
      credentials: "include",
      // A stalled network must not leave the control waiting forever.
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error || "Couldn't add the template to your library." };
  return { ok: true, row: body?.row, selected: body?.selected !== false };
}
