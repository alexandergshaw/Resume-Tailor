// N151a: the browser-side glue for the template LIBRARY. Two halves:
//  - registerTemplateFromBytes, the write the materials section's "Add to
//    template library" control reaches through useMaterialsLocker. It posts to
//    the route (app/api/templates/library), not a direct browser Supabase
//    call, so it reuses the route's session auth, its .docx validation, and the
//    register + make-active step the route performs in one request.
//  - N151b, the switcher's reads and writes (useTemplateLibrary):
//    listLibraryTemplates, selectLibraryTemplate (activate an existing
//    template) and deleteLibraryTemplate, over the same route.
//
// Every failure mode (signed out, the network, a refusal, the substrate not
// deployed -- BL-A) resolves to { ok: false, error } rather than throwing, so
// a caller can show the message without a try/catch of its own.

const ROUTE = "/api/templates/library";

// One round trip to the library route for the three switcher helpers: the
// shared credentials, timeout and failure shape. Resolves to { ok: true, body }
// or { ok: false, error }; never throws.
async function callLibraryRoute(url, init, fallbackError) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "include",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error || fallbackError };
  return { ok: true, body };
}

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

/** The caller's saved templates for `kind` plus which one is the active
 *  selection (null when none is selected).
 *  @returns {Promise<{ ok: true, templates: object[], selectedId: string | null } | { ok: false, error: string }>} */
export async function listLibraryTemplates(kind) {
  const out = await callLibraryRoute(
    `${ROUTE}?kind=${encodeURIComponent(kind)}`,
    { method: "GET" },
    "Couldn't load your templates.",
  );
  if (!out.ok) return out;
  return {
    ok: true,
    templates: Array.isArray(out.body?.templates) ? out.body.templates : [],
    selectedId: out.body?.selectedId ?? null,
  };
}

/** Make an EXISTING saved template the active one for `kind`.
 *  @returns {Promise<{ ok: true } | { ok: false, error: string }>} */
export async function selectLibraryTemplate({ kind, templateId }) {
  if (!templateId) return { ok: false, error: "No template selected." };
  const out = await callLibraryRoute(
    ROUTE,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, templateId }),
    },
    "Couldn't switch templates.",
  );
  return out.ok ? { ok: true } : out;
}

/** Delete one saved template by id. Deleting the ACTIVE one leaves no selection
 *  (the pointer's ON DELETE SET NULL), so a caller re-reads the list afterwards.
 *  @returns {Promise<{ ok: true } | { ok: false, error: string }>} */
export async function deleteLibraryTemplate(id) {
  if (!id) return { ok: false, error: "No template specified." };
  const out = await callLibraryRoute(
    `${ROUTE}?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Couldn't delete the template.",
  );
  return out.ok ? { ok: true } : out;
}
