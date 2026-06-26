// The bundled default résumé template IS the owner's real Resume.docx (embedded
// as base64 in resumeTemplateBase64.js), so the embedded engine's output matches
// the original document exactly — same styles, theme fonts, centered headings,
// and bullets. We only inject ONE tailorable line into it:
//
//   "Most relevant to this role: {{CORE_COMPETENCIES}}"
//
// inserted right after the Summary paragraph and cloned to the Summary's own
// body formatting (8pt). {{CORE_COMPETENCIES}} is filled with the owner's own
// skills that the posting asks for (see strategy.js), with a fallback so it
// always fills and never leaks raw braces.
//
// To use a different résumé, replace resumeTemplateBase64.js with a new
// base64-encoded .docx. If the "Summary" heading isn't found, injection is
// skipped gracefully and the résumé still renders verbatim.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";
import { RESUME_TEMPLATE_BASE64 } from "./resumeTemplateBase64.js";

// The injected paragraph, matching the Summary body run formatting (sz 16 = 8pt)
// with a bold lead-in label.
const COMPETENCIES_PARAGRAPH =
  '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>' +
  '<w:r><w:rPr><w:b w:val="1"/><w:bCs w:val="1"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:rtl w:val="0"/></w:rPr>' +
  '<w:t xml:space="preserve">Most relevant to this role: </w:t></w:r>' +
  '<w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:rtl w:val="0"/></w:rPr>' +
  '<w:t xml:space="preserve">{{CORE_COMPETENCIES}}</w:t></w:r></w:p>';

// Insert the competencies paragraph after the Summary body paragraph (the
// paragraph following the "Summary" heading). No-op if the heading isn't found.
function injectCompetencies(documentXml) {
  const headingEnd = documentXml.indexOf("Summary</w:t>");
  if (headingEnd === -1) return documentXml;
  const closeHeading = documentXml.indexOf("</w:p>", headingEnd);
  if (closeHeading === -1) return documentXml;
  const closeBody = documentXml.indexOf("</w:p>", closeHeading + 6);
  if (closeBody === -1) return documentXml;
  const at = closeBody + "</w:p>".length;
  return documentXml.slice(0, at) + COMPETENCIES_PARAGRAPH + documentXml.slice(at);
}

let cache = null;

// Assemble (once) the template as a Node Buffer ready for loadDocx(): the real
// résumé with the competencies placeholder injected, re-zipped with pinned entry
// dates so output stays byte-deterministic.
export async function getDefaultTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(RESUME_TEMPLATE_BASE64, "base64"));
  const documentXml = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", injectCompetencies(documentXml), { date: FIXED_ENTRY_DATE });
  // Pin every entry's date for deterministic output.
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  cache = await zip.generateAsync({ type: "nodebuffer" });
  return cache;
}
