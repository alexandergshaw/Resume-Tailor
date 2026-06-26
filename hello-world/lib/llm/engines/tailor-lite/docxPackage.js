// Shared OOXML packaging for the bundled templates (résumé + cover letter).
// Both templates are plain paragraph specs assembled into a minimal, valid
// .docx with pinned entry dates so output is byte-deterministic.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// One paragraph from a { text, bold, size, color } spec, as a single run.
export function paragraphXml(spec) {
  const props = [];
  if (spec.bold) props.push("<w:b/>");
  if (spec.size) props.push(`<w:sz w:val="${spec.size}"/>`);
  if (spec.color) props.push(`<w:color w:val="${spec.color}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(spec.text)}</w:t></w:r></w:p>`;
}

// Assemble word/document.xml from an array of paragraph specs.
export function buildDocumentXml(paragraphs) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map(paragraphXml).join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

// Build a .docx Node Buffer (ready for loadDocx) from a document.xml string.
export async function buildDocxBuffer(documentXml) {
  const zip = new JSZip();
  const date = FIXED_ENTRY_DATE;
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML, { date });
  zip.file("_rels/.rels", RELS_XML, { date });
  zip.file("word/document.xml", documentXml, { date });
  return zip.generateAsync({ type: "nodebuffer" });
}
