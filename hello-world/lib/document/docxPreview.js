// Parse a .docx into a lightweight, style-aware model for an on-screen preview
// that matches the document. We render the SAME .docx the download produces, so
// the preview is faithful by construction (bold, italic, underline, font size,
// alignment, paragraph spacing).
//
// Like lib/llm/engines/tailor-lite/docxModel.js, this uses a regex/string model
// rather than a DOM library so it runs unchanged in the browser AND in the
// node-based test environment (vitest `environment: "node"`, no DOMParser). The
// documents involved are well-formed OOXML we either author or fill, so a
// focused string model is safe and dependency-light.

import JSZip from "jszip";

const PARAGRAPH_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const TEXT_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
const PPR_RE = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/;
const RPR_RE = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/;

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// An on/off run property (<w:b/>, <w:i/>, <w:u w:val="single"/>). A bare tag or a
// truthy w:val is on; w:val of none/0/false/off is explicitly off.
function onOffProp(rPr, tag) {
  const m = rPr.match(new RegExp(`<w:${tag}\\b([^>]*?)/?>`));
  if (!m) return false;
  const val = (m[1].match(/w:val="([^"]*)"/) || [])[1];
  if (val == null) return true;
  return !/^(0|false|off|none)$/i.test(val);
}

function intProp(props, tag) {
  const m = props.match(new RegExp(`<w:${tag}\\b[^>]*\\bw:val="(\\d+)"`));
  return m ? Number.parseInt(m[1], 10) : null;
}

// Decoded text of a run, with line breaks and tabs preserved as plain text.
function runText(runXml) {
  let out = "";
  let m;
  TEXT_RE.lastIndex = 0;
  // Walk the run in order so <w:br/> / <w:tab/> land between the right <w:t>s.
  // AC-C17: matches an ATTRIBUTE-BEARING <w:br w:type="textWrapping"/> and
  // <w:tab w:val="..."/>, not just the bare forms -- without this a cover
  // letter's <w:br w:type="textWrapping"/> sign-off break is silently dropped
  // and "Sincerely," fuses onto "Alex Shaw" on both the screen and the
  // clipboard. Safety is NOT the `\b` (it does not keep a `<w:tab w:val=...
  // w:pos=.../>` tab-STOP out, once one is inside a string this sees) -- it is
  // the CALL GRAPH: tab stops live in <w:pPr>, and runText only ever sees the
  // inside of a matched <w:r>...</w:r>, so a <w:tabs> child is never in a
  // string this regex is run against.
  const TOKEN_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/?>|<w:tab\b[^>]*\/?>/g;
  while ((m = TOKEN_RE.exec(runXml)) !== null) {
    if (m[1] != null) out += decodeXml(m[1]);
    else if (m[0].startsWith("<w:br")) out += "\n";
    else out += "\t";
  }
  return out;
}

function parseRun(runXml) {
  const rPr = (runXml.match(RPR_RE) || [])[1] || "";
  const sizeHalfPt = intProp(rPr, "sz");
  const color = (rPr.match(/<w:color\b[^>]*\bw:val="([0-9A-Fa-f]{6})"/) || [])[1] || null;
  return {
    text: runText(runXml),
    bold: onOffProp(rPr, "b"),
    italic: onOffProp(rPr, "i"),
    underline: onOffProp(rPr, "u"),
    sizePt: sizeHalfPt != null ? sizeHalfPt / 2 : null,
    color: color && color.toLowerCase() !== "auto" ? `#${color}` : null,
  };
}

const ALIGN_MAP = { center: "center", right: "right", both: "justify", left: "left", start: "left", end: "right" };

function parseParagraph(blockXml) {
  const pPr = (blockXml.match(PPR_RE) || [])[1] || "";
  const jc = (pPr.match(/<w:jc\b[^>]*\bw:val="(\w+)"/) || [])[1];
  // w:spacing before/after are in twentieths of a point.
  const beforeTwips = (pPr.match(/<w:spacing\b[^>]*\bw:before="(\d+)"/) || [])[1];
  const afterRaw = (pPr.match(/<w:spacing\b[^>]*\bw:after="(\d+)"/) || [])[1];

  const runs = [];
  RUN_RE.lastIndex = 0;
  let rm;
  while ((rm = RUN_RE.exec(blockXml)) !== null) {
    const run = parseRun(rm[0]);
    if (run.text.length > 0) runs.push(run);
  }

  return {
    runs,
    align: (jc && ALIGN_MAP[jc]) || "left",
    spaceBeforePt: beforeTwips ? Number.parseInt(beforeTwips, 10) / 20 : 0,
    spaceAfterPt: afterRaw ? Number.parseInt(afterRaw, 10) / 20 : 0,
  };
}

// Parse a .docx (ArrayBuffer | Uint8Array | Buffer | Blob) into
// { paragraphs: [{ runs, align, spaceBeforePt, spaceAfterPt }] } in document
// order, including paragraphs nested in tables.
export async function parseDocxToModel(input) {
  const zip = await JSZip.loadAsync(input);
  const xml = (await zip.file("word/document.xml")?.async("string")) || "";
  const paragraphs = [];
  PARAGRAPH_RE.lastIndex = 0;
  let pm;
  while ((pm = PARAGRAPH_RE.exec(xml)) !== null) {
    paragraphs.push(parseParagraph(pm[0]));
  }
  return { paragraphs };
}

// The paragraph text the model would render, trimmed; used to seed the text
// editor and to derive download lines. `includeEmpty` keeps blank paragraphs
// (for round-tripping line positions) — default drops them.
export function modelToLines(model, { includeEmpty = false } = {}) {
  const lines = (model?.paragraphs || []).map((p) =>
    p.runs.map((r) => r.text).join("").replace(/\s+$/g, ""),
  );
  return includeEmpty ? lines : lines.filter((l) => l.trim().length > 0);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Render a parsed model to an HTML string with inline styles, so the preview
// reads like the document. Used both for the read-only view and to seed the
// rich-text editor. Whitespace is preserved (white-space: pre-wrap) so runs of
// spaces and tabs match the document.
export function renderModelToHtml(model) {
  return (model?.paragraphs || [])
    .map((p) => {
      const pStyle = `text-align:${p.align};margin:${p.spaceBeforePt || 0}pt 0 ${p.spaceAfterPt || 0}pt;white-space:pre-wrap;`;
      if (!p.runs.length) return `<p style="${pStyle}min-height:0.9em;"><br></p>`;
      const inner = p.runs
        .map((r) => {
          const style = [
            r.bold ? "font-weight:700" : "",
            r.italic ? "font-style:italic" : "",
            r.underline ? "text-decoration:underline" : "",
            r.sizePt ? `font-size:${r.sizePt}pt` : "",
            r.color ? `color:${r.color}` : "",
            // Version-diff highlight (lib/document/versionDiff.js sets this on
            // added/modified lines). Matches the app's existing highlight
            // treatment (CompanyResearchDialog's inserted-text `mark`).
            r.mark ? "background-color:rgba(255,213,79,0.55)" : "",
          ]
            .filter(Boolean)
            .join(";");
          return `<span${style ? ` style="${style}"` : ""}>${escapeHtml(r.text)}</span>`;
        })
        .join("");
      return `<p style="${pStyle}">${inner}</p>`;
    })
    .join("");
}

// Build a plain-text model from raw lines, for resumes with no .docx template
// (e.g. a .txt upload) so the preview still renders something readable.
export function linesToModel(lines = []) {
  return {
    paragraphs: (Array.isArray(lines) ? lines : String(lines).split("\n")).map((line) => ({
      runs: line ? [{ text: line, bold: false, italic: false, underline: false, sizePt: null, color: null }] : [],
      align: "left",
      spaceBeforePt: 0,
      spaceAfterPt: 4,
    })),
  };
}
