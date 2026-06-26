// The bundled default résumé template IS the owner's real Resume.docx (embedded
// as base64 in resumeTemplateBase64.js) and is returned verbatim — the embedded
// engine finds no placeholders, so the output is a byte-faithful copy of the
// original document (same styles, theme fonts, headings, and bullets).
//
// To use a different résumé, replace resumeTemplateBase64.js with a new
// base64-encoded .docx.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";
import { RESUME_TEMPLATE_BASE64 } from "./resumeTemplateBase64.js";

let cache = null;

// Assemble (once) the template as a Node Buffer ready for loadDocx(), with
// pinned entry dates so output stays byte-deterministic.
export async function getDefaultTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(RESUME_TEMPLATE_BASE64, "base64"));
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  cache = await zip.generateAsync({ type: "nodebuffer" });
  return cache;
}
