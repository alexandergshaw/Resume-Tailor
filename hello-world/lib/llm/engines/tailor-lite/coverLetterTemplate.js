// The bundled cover-letter template is the user-authored {{placeholder}} .docx
// (embedded as base64 in coverLetterTemplateBase64.js). It is a full-page letter
// that already uses the strategy's {{PLACEHOLDER}} vocabulary, so we load it
// verbatim (with pinned entry dates for deterministic output) and let the same
// scan -> keywords -> strategy -> fill pipeline as the résumé populate it.
//
// To change the wording or formatting, replace coverLetterTemplateBase64.js with
// a new base64-encoded .docx that uses the same {{PLACEHOLDER}} vocabulary.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";
import { COVER_LETTER_TEMPLATE_BASE64 } from "./coverLetterTemplateBase64.js";

let cache = null;

// Small wording tweaks applied to the bundled template at load time, so we don't
// have to regenerate the whole opaque base64 for a phrasing change.
const TEMPLATE_TEXT_PATCHES = [
  // The soft-skills line reads better as "experience in <soft skills>" than
  // "leadership in <soft skills>".
  ["leadership in", "experience in"],
  // Warmer, plainer phrasing for the teaching clause (still professional).
  [
    "alongside the higher-education instruction that maps directly to this role",
    "plus the classroom teaching experience that fits this role well",
  ],
];

// Assemble (once) the cover-letter template as a Node Buffer for loadDocx(),
// with every zip entry's timestamp pinned so the output base64 is deterministic.
export async function getCoverLetterTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(COVER_LETTER_TEMPLATE_BASE64, "base64"));
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
