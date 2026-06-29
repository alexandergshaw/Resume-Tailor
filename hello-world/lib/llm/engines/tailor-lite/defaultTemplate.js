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

// Small wording/placeholder tweaks applied to the bundled template at load time,
// so we don't have to regenerate the opaque base64 for a change.
const TEMPLATE_TEXT_PATCHES = [
  // The summary's domain tail is summary-only, so retarget it to a dedicated slot
  // that leads with the subjects taught for an academic posting (e.g. College
  // Algebra) and falls back to engineering domains otherwise. Job bullets use
  // JOB_RELEVANT_SOLUTIONS, not this slot, so they are unaffected.
  ["{{DOMAIN_CAPABILITIES}}", "{{ROLE_RELEVANT_FOCUS}}"],
];

export async function getDefaultTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(RESUME_TEMPLATE_BASE64, "base64"));
  const docFile = zip.file("word/document.xml");
  if (docFile) {
    let xml = await docFile.async("string");
    for (const [from, to] of TEMPLATE_TEXT_PATCHES) xml = xml.split(from).join(to);
    zip.file("word/document.xml", xml, { date: FIXED_ENTRY_DATE });
  }
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  cache = await zip.generateAsync({ type: "nodebuffer" });
  return cache;
}
