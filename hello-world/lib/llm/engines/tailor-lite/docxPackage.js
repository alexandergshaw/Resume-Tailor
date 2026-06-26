// Shared OOXML packaging for the bundled templates (résumé + cover letter).
// Templates are arrays of paragraph specs assembled into a minimal, valid .docx
// with pinned entry dates so output is byte-deterministic.
//
// A paragraph spec is either:
//   { text, bold, italic, size, color }                       — a single run, or
//   { runs: [{ text, bold, italic, size, color }, ...] }      — mixed runs
// plus optional layout: { align: "center"|"right", bullet, indent, spaceBefore,
// spaceAfter }. Sizes are half-points; spacing/indent are twentieths of a point.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function runXml(run, base) {
  const bold = run.bold ?? base.bold;
  const italic = run.italic ?? base.italic;
  const size = run.size ?? base.size;
  const color = run.color ?? base.color;
  const props = [];
  if (bold) props.push("<w:b/>");
  if (italic) props.push("<w:i/>");
  if (size) props.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  if (color) props.push(`<w:color w:val="${color}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text ?? "")}</w:t></w:r>`;
}

// One paragraph from a spec (single run, or a `runs` array, with layout).
export function paragraphXml(spec) {
  const base = { bold: spec.bold, italic: spec.italic, size: spec.size, color: spec.color };
  const runs = (Array.isArray(spec.runs) ? spec.runs : [{ text: spec.text ?? "" }]).map((r) => ({
    ...r,
  }));
  if (spec.bullet && runs.length) runs[0] = { ...runs[0], text: `•  ${runs[0].text ?? ""}` };

  const ppr = [];
  if (spec.align === "center") ppr.push('<w:jc w:val="center"/>');
  else if (spec.align === "right") ppr.push('<w:jc w:val="right"/>');
  if (spec.bullet) ppr.push('<w:ind w:left="360" w:hanging="240"/>');
  else if (spec.indent) ppr.push(`<w:ind w:left="${spec.indent}"/>`);
  if (spec.spaceBefore != null || spec.spaceAfter != null) {
    const before = spec.spaceBefore != null ? ` w:before="${spec.spaceBefore}"` : "";
    const after = spec.spaceAfter != null ? ` w:after="${spec.spaceAfter}"` : "";
    ppr.push(`<w:spacing${before}${after}/>`);
  }
  const pPr = ppr.length ? `<w:pPr>${ppr.join("")}</w:pPr>` : "";
  return `<w:p>${pPr}${runs.map((r) => runXml(r, base)).join("")}</w:p>`;
}

// Assemble word/document.xml from an array of paragraph specs.
export function buildDocumentXml(paragraphs) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map(paragraphXml)
    .join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
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
