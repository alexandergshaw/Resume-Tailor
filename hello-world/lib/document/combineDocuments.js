// Combine the résumé and cover letter into ONE document — a single .docx or a
// print-to-PDF — from the same style-aware render models the preview builds
// (docxPreview.parseDocxToModel / linesToModel). Because it works off those
// models, it is engine-agnostic: embedded, Gemini, and external all produce the
// same model shape, so combining behaves identically for every engine.
//
// The .docx is rebuilt fresh from the model (paragraph text + run bold/italic/
// underline/size/color + alignment/spacing, on a Calibri base to match the
// preview) with a page break between the two documents. The .pdf reuses the
// preview's own HTML renderer and the browser's print pipeline, so the PDF looks
// exactly like the on-screen preview.

import JSZip from "jszip";
import { renderModelToHtml } from "./docxPreview.js";
import { triggerBlobDownload } from "./docx.js";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const ALIGN_TO_JC = { left: "left", center: "center", right: "right", justify: "both" };

// A run's inner content: <w:t> chunks with <w:br/> for newlines and <w:tab/> for
// tabs, so soft breaks and tabs captured in the model survive into the .docx.
function runInnerXml(run) {
  const parts = [];
  for (const token of String(run?.text || "").split(/(\n|\t)/)) {
    if (token === "\n") parts.push("<w:br/>");
    else if (token === "\t") parts.push("<w:tab/>");
    else if (token.length) parts.push(`<w:t xml:space="preserve">${escapeXml(token)}</w:t>`);
  }
  return parts.join("");
}

function runPropsXml(run) {
  const color = typeof run?.color === "string" ? run.color.replace(/^#/, "") : "";
  const props = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    run?.bold ? "<w:b/>" : "",
    run?.italic ? "<w:i/>" : "",
    run?.underline ? '<w:u w:val="single"/>' : "",
    run?.sizePt ? `<w:sz w:val="${Math.round(run.sizePt * 2)}"/>` : "",
    /^[0-9A-Fa-f]{6}$/.test(color) ? `<w:color w:val="${color}"/>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `<w:rPr>${props}</w:rPr>`;
}

function paragraphXml(paragraph) {
  const jc = ALIGN_TO_JC[paragraph?.align] || "left";
  const before = Math.round((paragraph?.spaceBeforePt || 0) * 20);
  const after = Math.round((paragraph?.spaceAfterPt || 0) * 20);
  const pPr = `<w:pPr><w:jc w:val="${jc}"/><w:spacing w:before="${before}" w:after="${after}"/></w:pPr>`;
  const runs = (paragraph?.runs || [])
    .map((run) => `<w:r>${runPropsXml(run)}${runInnerXml(run)}</w:r>`)
    .join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

// A page break as its own paragraph, inserted between documents.
const PAGE_BREAK_PARAGRAPH = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// The combined word/document.xml for the given models, in order, page-broken.
export function combinedDocumentXml(models = []) {
  const blocks = [];
  models.forEach((model, index) => {
    if (index > 0) blocks.push(PAGE_BREAK_PARAGRAPH);
    for (const paragraph of model?.paragraphs || []) blocks.push(paragraphXml(paragraph));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">
  <w:body>
    ${blocks.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// Assemble the combined .docx as a Blob (browser). The zip scaffolding mirrors
// buildMinimalistDocx in docx.js.
export async function buildCombinedDocxBlob(models = []) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file("word/document.xml", combinedDocumentXml(models));
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// A standalone, print-ready HTML page for the combined document — the same
// per-paragraph inline styling the preview uses, one page-broken section per
// document, on a Letter page with 1in margins.
export function combinedHtml(models = [], { title = "Application" } = {}) {
  const sections = models
    .map((model) => `<section class="doc">${renderModelToHtml(model)}</section>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: Letter; margin: 1in; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.3; color: #000; }
    p { margin: 0; }
    .doc + .doc { page-break-before: always; break-before: page; }
  </style></head><body>${sections}</body></html>`;
}

// Print the combined HTML via a hidden iframe so the user can "Save as PDF" — a
// real, faithful PDF with no extra dependency. Browser-only. Resolves once the
// print dialog has been dismissed (or after a safety timeout).
export function printCombinedHtml(html) {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      setTimeout(() => iframe.remove(), 500);
      resolve();
    };
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      win.onafterprint = cleanup;
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
      }
      // Fallback: some browsers never fire onafterprint.
      setTimeout(cleanup, 60000);
    };
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

// Orchestrator used by the preview: combine the given models into `format`
// ("docx" | "pdf") named `fileBase`. Returns null on success or an error string.
export async function downloadCombinedDocuments({ models = [], format = "docx", fileBase = "Application" } = {}) {
  const usable = (models || []).filter((model) => (model?.paragraphs || []).some((p) => (p?.runs || []).length > 0));
  if (usable.length === 0) return "Nothing to combine yet.";
  try {
    if (format === "pdf") {
      await printCombinedHtml(combinedHtml(usable, { title: fileBase }));
    } else {
      triggerBlobDownload(await buildCombinedDocxBlob(usable), `${fileBase}.docx`);
    }
    return null;
  } catch (err) {
    return err?.message || "Unable to build the combined document.";
  }
}
