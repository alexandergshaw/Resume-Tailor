// DOCX template parsing, line fitting, and download helpers. Pure helpers are
// exported directly; the three download wrappers that need component state
// are exposed through `createDocumentDownloaders(deps)`.

import JSZip from "jszip";
import { createClient } from "../supabase/client";
import { alignLinesToSlots } from "./alignLines";
import { triggerBlobDownload } from "./download.js";

// Re-exported (not re-implemented) so the three modules that still import it
// from docx.js - app/page.js, lib/document/combineDocuments.js and
// app/components/CommunicationsDialog.js - keep working unchanged. See
// lib/document/download.js for the helper itself and why it moved out of
// this file.
export { triggerBlobDownload };

export const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Decode a base64 .docx (e.g. one the external Resume Tailor API returns) into a
// Blob for download.
export function base64ToDocxBlob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: DOCX_MIME });
}

// Wrap a base64 .docx as a File so it can be used as a structural template
// (isDocxResume checks the name/type) — used to rebuild edited documents from
// the engine's finished docx instead of the user's uploaded résumé.
export function docxFileFromBase64(base64) {
  return new File([base64ToDocxBlob(base64)], "engine-template.docx", { type: DOCX_MIME });
}

export function sanitizeFileNamePart(value) {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// N105 (AC-3 / D-8): every file name of the HYPOTHETICAL resume must begin with
// this token so the document can never leave under a submittable-looking name.
// It is a PREFIX, never a suffix: resolveDocumentFileName slices a user override
// to 150 characters, which would cut a trailing marker but never a leading one.
export const HYPOTHETICAL_TOKEN = "HYPOTHETICAL";

const HYPOTHETICAL_PREFIX = `[${HYPOTHETICAL_TOKEN}] `;
// Already marked = the name's first word (after any leading punctuation) is the
// token. A name that merely contains it further in is NOT marked.
const BEGINS_WITH_HYPOTHETICAL = new RegExp(`^[^A-Za-z0-9]*${HYPOTHETICAL_TOKEN}\\b`);

// The single forcing function behind every filename egress. IDEMPOTENT, so the
// egresses can layer it freely: when isHypothetical is false the name is
// returned untouched (every non-N105 caller stays byte-identical); when true
// and the name does not already begin with the token, the token is prefixed.
export function ensureHypotheticalMarker(name, isHypothetical = false) {
  if (!isHypothetical) return name;
  const text = typeof name === "string" ? name : "";
  if (BEGINS_WITH_HYPOTHETICAL.test(text)) return text;
  return text ? `${HYPOTHETICAL_PREFIX}${text}` : `[${HYPOTHETICAL_TOKEN}]`;
}

// Document file names follow "<Company> - <Position> - Resume/CL.docx". Company
// is dropped when unknown so the name never starts with a stray " - ".
// The common base of the getDownload*FileNameForTitle family, so the marker is
// forced here once for all of them.
function buildDocumentFileName(jobTitle, company, kind, isHypothetical = false) {
  const titlePart = sanitizeFileNamePart(jobTitle || "").slice(0, 90) || "Target Role";
  const companyPart = sanitizeFileNamePart(company || "").slice(0, 60);
  return ensureHypotheticalMarker(
    companyPart ? `${companyPart} - ${titlePart} - ${kind}.docx` : `${titlePart} - ${kind}.docx`,
    isHypothetical,
  );
}

export function getDownloadFileNameForTitle(jobTitle, company, isHypothetical = false) {
  return buildDocumentFileName(jobTitle, company, "Resume", isHypothetical);
}

export function getDownloadCoverLetterFileNameForTitle(jobTitle, company, isHypothetical = false) {
  return buildDocumentFileName(jobTitle, company, "CL", isHypothetical);
}

// Resolve the download file name for a document, honoring an optional user
// override. The override is a base name (no extension) the user typed in the
// preview; we sanitize it and append ".docx". Falls back to the derived
// "<Company> - <Position> - <kind>.docx" name when there's no override.
// isHypothetical forces the N105 marker on the FINAL return, so a user-typed
// override (which bypasses buildDocumentFileName) cannot strip it.
export function resolveDocumentFileName(override, jobTitle, company, kind, isHypothetical = false) {
  const base = sanitizeFileNamePart(String(override || "")).slice(0, 150);
  const name = base ? `${base}.docx` : buildDocumentFileName(jobTitle, company, kind, isHypothetical);
  return ensureHypotheticalMarker(name, isHypothetical);
}

export function isDocxResume(file) {
  return file?.name?.toLowerCase().endsWith(".docx");
}

export function isTextResume(file) {
  const lowerName = file?.name?.toLowerCase() || "";
  return [".txt", ".md", ".markdown"].some((extension) =>
    lowerName.endsWith(extension),
  );
}

export function normalizeResultLines(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

export function getDirectChildrenByTag(parentNode, localTagName) {
  return Array.from(parentNode.childNodes).filter(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      node.localName === localTagName &&
      node.namespaceURI === WORDPROCESSINGML_NS,
  );
}

export function getParagraphPlainText(paragraphNode) {
  const textNodes = paragraphNode.getElementsByTagNameNS(
    WORDPROCESSINGML_NS,
    "t",
  );

  return Array.from(textNodes)
    .map((node) => node.textContent || "")
    .join("");
}

export function fitLinesToTemplate(lines, targetCount) {
  if (targetCount <= 0) {
    return [];
  }

  if (lines.length === 0) {
    return new Array(targetCount).fill("");
  }

  if (lines.length <= targetCount) {
    return [...lines, ...new Array(targetCount - lines.length).fill("")];
  }

  const head = lines.slice(0, targetCount - 1);
  const tail = lines.slice(targetCount - 1).join(" ").trim();
  return [...head, tail];
}

export async function extractTemplateLinesFromDocx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXmlPath = "word/document.xml";
  const xmlContent = await zip.file(documentXmlPath)?.async("string");

  if (!xmlContent) {
    throw new Error("Unable to read DOCX template content.");
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
  const bodyNode = xmlDoc.getElementsByTagNameNS(WORDPROCESSINGML_NS, "body")[0];

  if (!bodyNode) {
    throw new Error("Uploaded DOCX template is missing body content.");
  }

  const existingParagraphs = getDirectChildrenByTag(bodyNode, "p");
  const editableParagraphs = existingParagraphs.filter(
    (paragraphNode) => getParagraphPlainText(paragraphNode).length > 0,
  );

  return editableParagraphs.map((paragraphNode) => getParagraphPlainText(paragraphNode));
}

async function readTemplateLinesUncached(file) {
  if (isDocxResume(file)) {
    return extractTemplateLinesFromDocx(file);
  }

  if (isTextResume(file)) {
    const text = await file.text();
    return normalizeResultLines(text).filter((line) => line.trim().length > 0);
  }

  return [];
}

// MEASURED WASTE, not a speculative optimisation. `lib/chat/chatbot.js`'s
// `runChatRequest` calls this on EVERY chat send, which runs
// `JSZip.loadAsync` + `DOMParser.parseFromString` over `word/document.xml`
// (extractTemplateLinesFromDocx, above) on the MAIN THREAD before the request
// leaves the browser. Benchmarked on this tree against a realistic resume
// .docx -- 60 Word-shaped paragraphs, ~10 KB of extracted text, a 100 KB
// `document.xml` -- at 37.5 ms per call, i.e. 37.5 ms of blocked UI on every
// typed message, re-deriving the identical answer from identical bytes. Chat
// is not the only caller: app/page.js, app/hooks/useDocumentPreview.js,
// useManualTailor.js and useApplicationDialogs.js all call it too, several of
// them twice in a row (resume, then cover letter) inside one user action.
//
// WHY THE CACHE LIVES HERE, at module scope, and not at the call site. The
// chat path's handlers are rebuilt by `createChatHandlers` on every React
// render, so anything memoized inside them is discarded about as fast as it is
// created; a `useRef`/`useMemo` would fix chat alone and leave the four other
// callers paying full price. Module scope in the module that owns the parse
// survives re-render, is shared by every caller, and needs no prop threading.
//
// WHY KEYING ON THE FILE IS SOUND, and why this is not a staleness bug waiting
// to happen: a `File`/`Blob` is immutable by specification -- its bytes, `size`
// and `lastModified` are fixed at construction. A user who edits the document
// on disk and re-picks it hands the app a NEW `File` object, which is a new
// key. There is no shape in which the same `File` reference legitimately
// yields two different documents. A `WeakMap` also means an entry dies with
// the File it describes, so replacing an uploaded resume cannot leak the old
// one's lines for the life of the tab.
//
// TWO THINGS THIS DELIBERATELY DOES, both pinned by
// lib/document/docxTemplateCache.test.js:
//
//   * It caches the PROMISE, not the resolved value, so N calls in the same
//     tick (Send pressed twice; a resume and a cover letter requested
//     together) share ONE parse instead of racing N of them.
//   * It never remembers a FAILURE. A `File` whose backing disk file moved
//     throws NotReadableError; caching that would make one transient read
//     error permanent for the life of the tab, with the user re-picking
//     nothing and retrying forever against an empty resume.
//
// And one thing it must never do: hand two callers the same array. Downstream
// (`fitLinesToTemplate`, `alignLinesToSlots`, app/page.js's rebuild paths) the
// returned lines are ordinary mutable arrays, so every caller gets its own
// copy -- a shallow copy of ~60 strings against a 37.5 ms parse.
const templateLineCache = new WeakMap();

function copyLines(lines) {
  return Array.isArray(lines) ? lines.slice() : lines;
}

export async function buildTemplateLinesForUpload(file) {
  // A WeakMap key must be an object. `null`/`undefined`/a string still has to
  // reach the reader below, which answers `[]` for it exactly as before.
  if (!file || (typeof file !== "object" && typeof file !== "function")) {
    return readTemplateLinesUncached(file);
  }

  const cached = templateLineCache.get(file);
  if (cached) return copyLines(await cached);

  const pending = readTemplateLinesUncached(file);
  templateLineCache.set(file, pending);
  try {
    return copyLines(await pending);
  } catch (err) {
    // Guarded on identity so a retry already in flight for this same file is
    // not evicted by an older attempt's failure.
    if (templateLineCache.get(file) === pending) templateLineCache.delete(file);
    throw err;
  }
}

// Extract every non-empty text line from a résumé for parsing (not editing).
// Unlike extractTemplateLinesFromDocx (which only reads top-level paragraphs so
// it can rewrite them), this walks *all* paragraphs in document order —
// including those nested inside tables — so table-based résumé layouts are not
// dropped. Returns a flat array of trimmed, non-empty lines.
export async function extractResumeTextLines(file) {
  if (isTextResume(file)) {
    const text = await file.text();
    return normalizeResultLines(text)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  if (!isDocxResume(file)) return [];

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xmlContent = await zip.file("word/document.xml")?.async("string");
  if (!xmlContent) return [];

  const xmlDoc = new DOMParser().parseFromString(xmlContent, "application/xml");
  const paragraphs = xmlDoc.getElementsByTagNameNS(WORDPROCESSINGML_NS, "p");

  const lines = [];
  for (const paragraph of Array.from(paragraphs)) {
    const text = getParagraphPlainText(paragraph).trim();
    if (text) lines.push(text);
  }
  return lines;
}

export function setParagraphText(paragraphNode, value, xmlDoc) {
  const textNodes = paragraphNode.getElementsByTagNameNS(
    WORDPROCESSINGML_NS,
    "t",
  );

  if (textNodes.length > 0) {
    const currentLengths = Array.from(textNodes).map(
      (node) => (node.textContent || "").length,
    );
    const totalLength = currentLengths.reduce((sum, length) => sum + length, 0);
    const fallbackLength = Math.max(1, Math.ceil((value || "").length / textNodes.length));
    const effectiveLengths = currentLengths.map((length) =>
      length > 0 ? length : fallbackLength,
    );
    const effectiveTotal =
      totalLength > 0
        ? totalLength
        : effectiveLengths.reduce((sum, length) => sum + length, 0);

    let cursor = 0;

    for (let index = 0; index < textNodes.length; index += 1) {
      const isLast = index === textNodes.length - 1;
      const sliceLength = isLast
        ? Math.max(0, (value || "").length - cursor)
        : Math.max(
            0,
            Math.round(((value || "").length * effectiveLengths[index]) / effectiveTotal),
          );
      const nextCursor = Math.min((value || "").length, cursor + sliceLength);
      const chunk = (value || "").slice(cursor, nextCursor);

      textNodes[index].textContent = chunk;

      if (chunk.startsWith(" ") || chunk.endsWith(" ")) {
        textNodes[index].setAttribute("xml:space", "preserve");
      } else {
        textNodes[index].removeAttribute("xml:space");
      }

      cursor = nextCursor;
    }

    if (cursor < (value || "").length) {
      const lastNode = textNodes[textNodes.length - 1];
      const tail = (value || "").slice(cursor);
      lastNode.textContent = `${lastNode.textContent || ""}${tail}`;
    }

    return;
  }

  const runNode = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:r");
  const textNode = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:t");
  textNode.textContent = value || "";
  runNode.appendChild(textNode);
  paragraphNode.appendChild(runNode);
}

export async function buildDocxFromUploadedTemplate(file, generatedText, generatedLines = []) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXmlPath = "word/document.xml";
  const xmlContent = await zip.file(documentXmlPath)?.async("string");

  if (!xmlContent) {
    throw new Error("Unable to read DOCX template content.");
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
  const bodyNode = xmlDoc.getElementsByTagNameNS(WORDPROCESSINGML_NS, "body")[0];

  if (!bodyNode) {
    throw new Error("Uploaded DOCX template is missing body content.");
  }

  const lines =
    generatedLines.length > 0 ? generatedLines : normalizeResultLines(generatedText);
  const existingParagraphs = getDirectChildrenByTag(bodyNode, "p");

  if (existingParagraphs.length === 0) {
    throw new Error("Uploaded DOCX template has no editable paragraphs.");
  }

  const editableParagraphs = existingParagraphs.filter(
    (paragraphNode) => getParagraphPlainText(paragraphNode).length > 0,
  );

  if (editableParagraphs.length === 0) {
    throw new Error("Uploaded DOCX template has no text paragraphs to update.");
  }

  // Align edited lines to slots by content so an inserted/deleted line never
  // shifts the formatting of the lines around it.
  const templateTexts = editableParagraphs.map((p) => getParagraphPlainText(p));
  const ops = alignLinesToSlots(templateTexts, lines);

  // Track the DOM node each insert should follow: the node of the previous
  // fill/insert in document order (inserts after removed slots must attach to
  // the surviving node before them).
  let lastNode = null;
  const toRemove = [];
  for (const op of ops) {
    if (op.type === "fill") {
      setParagraphText(editableParagraphs[op.slot], op.text, xmlDoc);
      lastNode = editableParagraphs[op.slot];
    } else if (op.type === "remove") {
      toRemove.push(editableParagraphs[op.slot]);
    } else if (op.type === "insert") {
      // Clone the nearest surviving slot's paragraph for formatting: prefer the
      // node this insert follows, else the first editable paragraph.
      const templateNode = lastNode || editableParagraphs[0];
      const clone = templateNode.cloneNode(true);
      setParagraphText(clone, op.text, xmlDoc);
      const anchorNode = lastNode;
      if (anchorNode && anchorNode.parentNode) {
        anchorNode.parentNode.insertBefore(clone, anchorNode.nextSibling);
      } else {
        const first = editableParagraphs[0];
        first.parentNode.insertBefore(clone, first);
      }
      lastNode = clone;
    }
  }
  for (const node of toRemove) {
    if (node.parentNode) node.parentNode.removeChild(node);
  }

  const serializedXml = new XMLSerializer().serializeToString(xmlDoc);
  zip.file(documentXmlPath, serializedXml);

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraphXml(text, options = {}) {
  const value = String(text || "");
  const spacing = options.spacingAfter ?? 120;
  const justify = options.center ? "<w:jc w:val=\"center\"/>" : "";
  const bold = options.bold ? "<w:b/>" : "";
  const size = options.size ? `<w:sz w:val=\"${options.size}\"/>` : "";
  const color = options.color ? `<w:color w:val=\"${options.color}\"/>` : "";
  const fonts = options.font
    ? `<w:rFonts w:ascii=\"${options.font}\" w:hAnsi=\"${options.font}\" w:cs=\"${options.font}\"/>`
    : "";
  const runProps = `${fonts}${bold}${size}${color}`;
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";

  return `<w:p><w:pPr>${justify}<w:spacing w:after=\"${spacing}\"/></w:pPr><w:r>${runProps ? `<w:rPr>${runProps}</w:rPr>` : ""}<w:t${preserve}>${escapeXml(value)}</w:t></w:r></w:p>`;
}

function buildMinimalistDocumentXml(title, entries = [], options = {}) {
  const subtitle = String(options.subtitle || "").trim();
  const paragraphs = [
    paragraphXml(title, { bold: true, size: 32, spacingAfter: 100, font: "Calibri" }),
  ];

  if (subtitle) {
    paragraphs.push(paragraphXml(subtitle, { size: 18, color: "6B7280", spacingAfter: 200, font: "Calibri" }));
  }

  entries.forEach((entry, index) => {
    if (entry.primaryLine) {
      paragraphs.push(paragraphXml(entry.primaryLine, { bold: true, size: 24, spacingAfter: 40, font: "Calibri" }));
    }
    if (entry.secondaryLine) {
      paragraphs.push(paragraphXml(entry.secondaryLine, { size: 21, color: "4A5568", spacingAfter: 80, font: "Calibri" }));
    }
    (entry.details || []).forEach((line) => {
      if (line) paragraphs.push(paragraphXml(line, { size: 21, spacingAfter: 80, font: "Calibri" }));
    });

    if (index < entries.length - 1) {
      paragraphs.push(paragraphXml("", { spacingAfter: 170 }));
    }
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">
  <w:body>
    ${paragraphs.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

export async function buildMinimalistDocx(entries, title, options = {}) {
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

  zip.file("word/document.xml", buildMinimalistDocumentXml(title, entries, options));

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function downloadMinimalistDocx({ title, fileName, entries, subtitle }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return "Nothing to download yet.";
  }

  try {
    const blob = await buildMinimalistDocx(entries, title, { subtitle });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return null;
  } catch (err) {
    return err.message || "Unable to download DOCX.";
  }
}

// Fetch a persisted .docx from Supabase storage (documents generated in a prior
// session live there rather than in memory). Returns a Blob, or null on failure.
async function fetchStoredDocxBlob(docxPath) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("resumes").download(docxPath);
    if (!error && data) return data;
  } catch {
    // fall through
  }
  return null;
}

// N69 (SPACING): whole-document line/paragraph spacing override applied as a
// POST-PASS on the finished .docx's paragraph properties -- structurally
// unable to touch setParagraphText/the line-to-slot text rebuild above
// (docx.js:268, the live N54 break-corruption seam), because it never reads
// or writes a <w:t>/<w:r>/<w:br> node at all. Deliberately module-private:
// its only caller is resolveDocumentBlob, below, in this same file.
//
// Schema-order rules (F1/F2 in docx.spacing.download.test.js, CT_PPR/ISO
// 29500): <w:spacing> must be the FIRST of {pStyle, ind, contextualSpacing,
// jc, rPr, sectPr, ...} to already exist in pPr that it needs to precede --
// AFTER_SPACING_TAGS names the ones this sweep actually has to worry about
// (an existing pStyle stays where it is automatically, since we only search
// for the tags spacing must come BEFORE). An existing <w:spacing> is edited
// IN PLACE -- found, then mutated -- never removed/re-appended, so its
// position and any attribute this override doesn't touch both survive.
const AFTER_SPACING_TAGS = ["ind", "contextualSpacing", "jc", "rPr", "sectPr"];

// Set only the attributes this override actually specifies, independently
// per dimension, so a partial override (e.g. line spacing only) never
// clobbers a paragraph-spacing value -- or vice versa -- that the caller
// didn't ask to change. An explicit paragraph-spacing value clears the
// automatic-spacing flags (F4): Word silently IGNORES an explicit
// w:before/w:after while w:beforeAutospacing/w:afterAutospacing="1" is set,
// so leaving those flags in place would make the write a silent no-op.
function applySpacingAttrs(spacingEl, override) {
  const { lineSpacing, paragraphSpacingPt } = override || {};
  if (paragraphSpacingPt != null) {
    spacingEl.setAttribute("w:before", "0");
    spacingEl.setAttribute("w:after", String(Math.round(paragraphSpacingPt * 20)));
    spacingEl.removeAttribute("w:beforeAutospacing");
    spacingEl.removeAttribute("w:afterAutospacing");
    spacingEl.removeAttribute("w:beforeLines");
    spacingEl.removeAttribute("w:afterLines");
  }
  if (lineSpacing != null) {
    spacingEl.setAttribute("w:line", String(Math.round(lineSpacing * 240)));
    spacingEl.setAttribute("w:lineRule", "auto");
  }
}

function applySpacingToDocxXml(documentXml, override) {
  const prologMatch = documentXml.match(/^<\?xml[^>]*\?>/);
  const xmlDoc = new DOMParser().parseFromString(documentXml, "application/xml");
  const paragraphs = xmlDoc.getElementsByTagNameNS(WORDPROCESSINGML_NS, "p");
  for (const p of Array.from(paragraphs)) {
    let pPr = getDirectChildrenByTag(p, "pPr")[0];
    if (!pPr) {
      pPr = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:pPr");
      p.insertBefore(pPr, p.firstChild);
    }
    let spacing = getDirectChildrenByTag(pPr, "spacing")[0];
    if (!spacing) {
      spacing = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:spacing");
      const before = Array.from(pPr.childNodes).find(
        (n) => n.nodeType === Node.ELEMENT_NODE && AFTER_SPACING_TAGS.includes(n.localName),
      );
      pPr.insertBefore(spacing, before || null);
    }
    applySpacingAttrs(spacing, override);
  }
  const serialized = new XMLSerializer().serializeToString(xmlDoc);
  // XMLSerializer drops the <?xml?> prolog even when the parsed source had
  // one -- restore it so a spacing-only pass doesn't silently strip it from
  // every document it touches.
  return prologMatch && !serialized.startsWith("<?xml") ? `${prologMatch[0]}${serialized}` : serialized;
}

async function applySpacingToDocxBlob(blob, override) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return blob;
  zip.file("word/document.xml", applySpacingToDocxXml(xml, override));
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME });
}

// THE single source of truth for turning a document (résumé or cover letter)
// into its final .docx blob. Every preview render, drag, and download funnels
// through here so there is exactly one code path.
//
// Preference order — the engine's own finished doc is ALWAYS the structural
// template so formatting (bullets, sizes, sections) is correct; the user's
// uploaded résumé is only a last resort when no engine doc exists at all:
//   1. unedited + in-session engine doc  -> serve verbatim
//   2. unedited + persisted storage doc  -> fetch and serve verbatim
//   3. edited   + in-session engine doc  -> apply edited text onto it
//   4. edited   + persisted storage doc  -> fetch, apply edited text onto it
//   5. uploaded template                 -> apply edited text onto it (legacy)
//
// `spacing` (N69) is applied as a POST-PASS AFTER any of the five branches
// above produce a blob -- so a spacing-only download of an unedited document
// still takes the verbatim-serve branch (never buildDocxFromUploadedTemplate/
// setParagraphText) and only then gets its pPr swept.
export async function resolveDocumentBlob({
  engineDocxB64 = "",
  docxPath = "",
  edited = false,
  text = "",
  lines = [],
  uploadedTemplate = null,
  spacing = null,
  // N97: the per-type DEFAULT TEMPLATE override (a .docx File), or null when
  // none is set -- see resolveDocumentBlobBytes below for the precedence.
  formattingTemplate = null,
}) {
  const blob = await resolveDocumentBlobBytes({
    engineDocxB64,
    docxPath,
    edited,
    text,
    lines,
    uploadedTemplate,
    formattingTemplate,
  });
  if (!blob || !spacing) return blob;
  return applySpacingToDocxBlob(blob, spacing);
}

async function resolveDocumentBlobBytes({
  engineDocxB64 = "",
  docxPath = "",
  edited = false,
  text = "",
  lines = [],
  uploadedTemplate = null,
  formattingTemplate = null,
}) {
  const hasText = typeof text === "string" && text.trim().length > 0;

  // N97 (plan C2): a set DEFAULT TEMPLATE takes precedence over every branch
  // below -- the engine's own finished doc, verbatim or rebuilt, and the
  // user's uploaded template. Rebuilt the same way the edited path already
  // rebuilds onto engineDocxB64 (buildDocxFromUploadedTemplate swaps text,
  // preserves styling), so the DEFAULT's formatting -- not the engine's --
  // reaches the output. Guarded by isDocxResume so a null/non-docx value
  // (the overwhelming common case: no default set) can never fire this
  // branch or produce an empty document -- byte-identical to today (AC-8).
  if (formattingTemplate && isDocxResume(formattingTemplate) && (hasText || lines.length > 0)) {
    return buildDocxFromUploadedTemplate(formattingTemplate, text, lines);
  }

  // Unedited: serve the finished doc verbatim.
  if (!edited && engineDocxB64) return base64ToDocxBlob(engineDocxB64);
  if (!edited && docxPath) {
    const blob = await fetchStoredDocxBlob(docxPath);
    if (blob) return blob;
  }

  // Nothing edited to apply — serve any finished doc we have.
  if (!hasText) {
    if (engineDocxB64) return base64ToDocxBlob(engineDocxB64);
    if (docxPath) return (await fetchStoredDocxBlob(docxPath)) || null;
    return null;
  }

  // Edited: rebuild the edited text onto the engine doc (correct formatting).
  if (engineDocxB64) {
    return buildDocxFromUploadedTemplate(docxFileFromBase64(engineDocxB64), text, lines);
  }
  if (docxPath) {
    const blob = await fetchStoredDocxBlob(docxPath);
    if (blob) {
      const file = new File([blob], "engine-template.docx", { type: DOCX_MIME });
      return buildDocxFromUploadedTemplate(file, text, lines);
    }
  }

  // Last resort: the user's uploaded résumé/cover-letter template.
  if (uploadedTemplate && isDocxResume(uploadedTemplate)) {
    return buildDocxFromUploadedTemplate(uploadedTemplate, text, lines);
  }
  return null;
}

// edited/*: a tailoring entry's hand-edit flag, per scope ({ resume, cover }),
// mirroring the helper in app/hooks/useDocumentPreview.js. An object is
// ALWAYS truthy, so every read must go through this — never `if
// (entry.edited)` / `!entry.edited`. Tolerates a missing field (treated as
// not edited) and a legacy plain boolean from before this migration — a
// legacy `true` reads as edited on BOTH scopes (the safe direction: it still
// forces a rebuild instead of risking a stale verbatim-serve).
function editedForScope(entry, scope) {
  const e = entry?.edited;
  if (e && typeof e === "object") return !!e[scope];
  return !!e;
}

export function createDocumentDownloaders(deps) {
  const { resumeFile, coverLetterFile, tailoringMap, applicationData } = deps;

  async function downloadDocxFiles({
    jobTitle,
    company,
    result,
    resultLines,
    coverLetterResultLines,
    docxB64,
    coverLetterDocxB64,
    docxPath,
    resumeFileName,
    coverLetterFileName,
    templateDocxB64,
    templateDocxPath,
    coverLetterTemplateDocxB64,
    // N97 (plan C1): the per-type default-template override. TWO params, not
    // one -- a combined download (page.js's post-generation call) builds
    // both documents in one call, so résumé and cover each need their own.
    formattingTemplate = null,
    coverFormattingTemplate = null,
    // N69: whole-document { lineSpacing, paragraphSpacingPt } | null, applied
    // as resolveDocumentBlob's post-pass sweep to BOTH documents below.
    spacing = null,
    // N105 (D-9b): set only by buildDownloadArgs's hypothetical branch, whose
    // args already carry the hypothetical's OWN bytes in the résumé-shaped
    // fields -- the same single blob path below -- so all that differs is the
    // HYPOTHETICAL file-name marker on the résumé download.
    isHypothetical = false,
  }) {
    // Download names honor an optional user override typed in the preview.
    const resumeName = resolveDocumentFileName(resumeFileName, jobTitle, company, "Resume", isHypothetical);
    const coverName = resolveDocumentFileName(coverLetterFileName, jobTitle, company, "CL");

    const hasResume = !!result?.trim();
    const hasCover = Array.isArray(coverLetterResultLines) && coverLetterResultLines.length > 0;
    if (!hasResume && !hasCover && !coverLetterDocxB64 && !docxB64 && !docxPath) {
      return "Nothing to download yet.";
    }

    try {
      // Résumé — one path via resolveDocumentBlob. docxB64/docxPath are supplied
      // only for an UNEDITED finished doc (served verbatim); templateDocxB64/
      // templateDocxPath are the engine doc (in-session bytes, or its storage
      // pointer) that edited text is rebuilt onto. templateDocxPath matters
      // even when docxB64 has been cleared by a version switch (D-1) — that
      // switch only repoints the PREVIEW's byte source, not this rebuild
      // template, so it must be threaded through regardless of edited state.
      if (hasResume || docxB64 || docxPath) {
        const resumeBlob = await resolveDocumentBlob({
          engineDocxB64: docxB64 || templateDocxB64 || "",
          docxPath: docxPath || templateDocxPath || "",
          edited: !docxB64 && !docxPath,
          text: result || "",
          lines: resultLines || [],
          uploadedTemplate: resumeFile,
          formattingTemplate,
          spacing,
        });
        if (hasResume && !resumeBlob) return "Upload the source resume as .docx to download.";
        if (resumeBlob) triggerBlobDownload(resumeBlob, resumeName);
      }

      // Cover letter — same single path.
      if (hasCover || coverLetterDocxB64) {
        const coverBlob = await resolveDocumentBlob({
          engineDocxB64: coverLetterDocxB64 || coverLetterTemplateDocxB64 || "",
          docxPath: "",
          edited: !coverLetterDocxB64,
          text: hasCover ? coverLetterResultLines.join("\n") : "",
          lines: coverLetterResultLines || [],
          uploadedTemplate: coverLetterFile,
          formattingTemplate: coverFormattingTemplate,
          spacing,
        });
        if (coverBlob) triggerBlobDownload(coverBlob, coverName);
        else if (!hasResume && hasCover) {
          return "Upload your cover letter template (.docx) to download it.";
        }
      }

      return null;
    } catch (err) {
      return err.message || "Unable to download DOCX.";
    }
  }

  // Re-download a previously generated auto-tailored resume from Supabase by
  // its application row. Pulls generated_resumes.content/content_lines for
  // the linked resume_used_id and renders it through the user's uploaded
  // resume template. Returns null on success, or an error message string.
  async function downloadAutoTailoredResume(row) {
    if (!row?.resume_used_id) return "No generated resume linked to this posting.";
    if (!isDocxResume(resumeFile)) return "Upload your source resume as .docx first.";
    try {
      const supabase = createClient();
      const { data: gen, error } = await supabase
        .from("generated_resumes")
        .select("content, content_lines, docx_path")
        .eq("id", row.resume_used_id)
        .maybeSingle();
      if (error) return error.message || "Unable to load generated resume.";
      if (!gen) return "Generated resume not found.";
      const lines = Array.isArray(gen.content_lines) ? gen.content_lines : [];
      const text = typeof gen.content === "string" ? gen.content : lines.join("\n");
      return await downloadDocxFiles({
        jobTitle: row.positions?.title,
        company: row.positions?.company,
        result: text,
        resultLines: lines,
        coverLetterResultLines: [],
        docxPath: gen.docx_path || "",
      });
    } catch (err) {
      return err.message || "Unable to download.";
    }
  }

  // Download the tailored resume for a tracked job (chip in the floating
  // status bar). Prefers the in-memory tailoring result, otherwise falls back
  // to the saved generated_resumes row attached to the application that was
  // loaded for this position. Fire-and-forget: returns null on success or an
  // error message string. Errors are logged but not surfaced (the chip's
  // posting link should still open even if the download can't run).
  async function downloadResumeForChipJob(job) {
    if (!job) return "No job.";

    const tailoring = tailoringMap[job.id] || {};
    // External engine: an unedited finished doc can be served directly without
    // a .docx source resume. Edited resumes fall through to template fill.
    // AC-2: résumé and cover letter each consult their own scope, so hand
    // editing one never forces a rebuild of the other's finished doc.
    const docxB64 =
      !editedForScope(tailoring, "resume") && typeof tailoring.docxB64 === "string" ? tailoring.docxB64 : "";
    const coverLetterDocxB64 =
      !editedForScope(tailoring, "cover") && typeof tailoring.coverLetterDocxB64 === "string"
        ? tailoring.coverLetterDocxB64
        : "";

    let text = typeof tailoring.result === "string" ? tailoring.result : "";
    let lines = Array.isArray(tailoring.resultLines) ? tailoring.resultLines : [];
    const coverLines = Array.isArray(tailoring.coverLetterResultLines)
      ? tailoring.coverLetterResultLines
      : [];
    let jobTitle = tailoring.generatedJobTitle || job.title || "";
    let company = job.company || "";
    // A rehydrated chip (post-reload) carries the saved docx storage path so we
    // can serve the faithful document even without a re-uploaded template.
    let docxPath =
      !editedForScope(tailoring, "resume") && typeof tailoring.docxPath === "string" ? tailoring.docxPath : "";

    if (!docxB64 && !text) {
      // Fall back to the saved application row (post-reload case).
      const app = (applicationData || []).find(
        (a) => String(a?.positions?.external_id || "") === String(job.id),
      );
      const gen = app?.generated_resumes;
      if (!gen?.content) return "No saved resume found for this posting.";
      text = gen.content;
      lines = Array.isArray(gen.content_lines) ? gen.content_lines : [];
      jobTitle = jobTitle || app?.positions?.title || "";
      company = company || app?.positions?.company || "";
      if (!editedForScope(tailoring, "resume") && gen.docx_path) docxPath = gen.docx_path;
    }

    // Need a finished doc (in-session, or persisted) or a .docx source resume.
    if (!docxB64 && !docxPath && !isDocxResume(resumeFile)) {
      return "Upload your source resume as .docx first.";
    }

    return await downloadDocxFiles({
      jobTitle,
      company,
      result: text,
      resultLines: lines,
      coverLetterResultLines: coverLines,
      docxB64,
      coverLetterDocxB64,
      docxPath,
      resumeFileName: tailoring.resumeFileName || "",
      coverLetterFileName: tailoring.coverLetterFileName || "",
      templateDocxB64: typeof tailoring.docxB64 === "string" ? tailoring.docxB64 : "",
      // Unconditional, same reasoning as useDocumentPreview.js's downloadDocumentPreview:
      // this is the rebuild TEMPLATE for an edited chip, not the verbatim-serve
      // pointer above (which is gated on !editedForScope).
      templateDocxPath: typeof tailoring.docxPath === "string" ? tailoring.docxPath : "",
      coverLetterTemplateDocxB64:
        typeof tailoring.coverLetterDocxB64 === "string" ? tailoring.coverLetterDocxB64 : "",
    });
  }

  return { downloadDocxFiles, downloadAutoTailoredResume, downloadResumeForChipJob };
}
