// The bundled default résumé template is the user-authored {{placeholder}} .docx
// (embedded as base64 in resumeTemplateBase64.js). It already contains every
// placeholder, so we just load it verbatim (with pinned entry dates for
// deterministic output) — the strategy mapper fills the placeholders.
//
// To use a different template, replace resumeTemplateBase64.js with a new
// base64-encoded .docx that uses the same {{PLACEHOLDER}} vocabulary.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";
import { RESUME_TEMPLATE_BASE64 } from "./resumeTemplateBase64.js";

let cache = null;

export async function getDefaultTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(RESUME_TEMPLATE_BASE64, "base64"));
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  cache = await zip.generateAsync({ type: "nodebuffer" });
  return cache;
}
