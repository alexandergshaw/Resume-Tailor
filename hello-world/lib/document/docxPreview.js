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

// numFmt values that count rather than bullet. Anything else (bullet, none,
// or an unrecognized/absent numFmt) resolves to unordered -- the safer
// default when a list's format can't be determined (see parseListInfo).
const ORDERED_NUM_FMTS = new Set([
  "decimal", "decimalZero", "lowerRoman", "upperRoman", "lowerLetter", "upperLetter",
]);

const ABSTRACT_NUM_RE = /<w:abstractNum\b[^>]*\bw:abstractNumId="(\w+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g;
const LVL_RE = /<w:lvl\b[^>]*\bw:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
const NUM_RE = /<w:num\b[^>]*\bw:numId="(\w+)"[^>]*>([\s\S]*?)<\/w:num>/g;
const NUMPR_RE = /<w:numPr\b[^>]*>([\s\S]*?)<\/w:numPr>/;

// Parse a .docx's word/numbering.xml part (or "" if the part is absent) into
// a lookup from "<numId>:<ilvl>" to whether that level is an ORDERED list.
// Pure; never throws; empty/malformed input returns an empty Map. Ignores
// <w:lvlOverride> and <w:numStart>/<w:startOverride> -- this design always
// uses the abstractNum's own base level definition and always starts an
// ordered run's count at 1.
function parseNumberingFormats(numberingXml) {
  const formats = new Map();
  if (!numberingXml) return formats;

  const abstractFormats = new Map(); // "<abstractNumId>:<ilvl>" -> ordered
  let am;
  ABSTRACT_NUM_RE.lastIndex = 0;
  while ((am = ABSTRACT_NUM_RE.exec(numberingXml)) !== null) {
    const abstractId = am[1];
    const body = am[2];
    let lm;
    LVL_RE.lastIndex = 0;
    while ((lm = LVL_RE.exec(body)) !== null) {
      const ilvl = lm[1];
      const fmt = (lm[2].match(/<w:numFmt\b[^>]*\bw:val="(\w+)"/) || [])[1];
      abstractFormats.set(`${abstractId}:${ilvl}`, ORDERED_NUM_FMTS.has(fmt));
    }
  }

  let nm;
  NUM_RE.lastIndex = 0;
  while ((nm = NUM_RE.exec(numberingXml)) !== null) {
    const numId = nm[1];
    const abstractId = (nm[2].match(/<w:abstractNumId\b[^>]*\bw:val="(\w+)"/) || [])[1];
    if (abstractId == null) continue;
    for (const [key, ordered] of abstractFormats) {
      if (key.startsWith(`${abstractId}:`)) {
        formats.set(`${numId}:${key.slice(abstractId.length + 1)}`, ordered);
      }
    }
  }
  return formats;
}

// Extract this paragraph's list membership from its already-sliced <w:pPr>
// inner XML. Returns null for "no <w:numPr>" AND for the OOXML
// "<w:numId w:val="0"/>" explicit no-list override. `ilvl` defaults to 0 when
// <w:ilvl> is absent (OOXML's own default). `ordered` defaults to `false`
// when the (numId, ilvl) pair is not found in `numberingFormats` (numbering.xml
// absent, malformed, or the numId simply not declared there) -- membership and
// ilvl always survive from <w:numPr> alone; only ordered-vs-unordered needs
// numbering.xml, so its absence costs the ordering, never the bullet.
function parseListInfo(pPrXml, numberingFormats) {
  const m = pPrXml.match(NUMPR_RE);
  if (!m) return null;
  const body = m[1];
  const numId = (body.match(/<w:numId\b[^>]*\bw:val="(\w+)"/) || [])[1];
  if (numId == null || numId === "0") return null;
  const ilvlRaw = (body.match(/<w:ilvl\b[^>]*\bw:val="(\d+)"/) || [])[1];
  const ilvl = ilvlRaw != null ? Number.parseInt(ilvlRaw, 10) : 0;
  const ordered = numberingFormats.get(`${numId}:${ilvl}`) === true;
  return { numId, ilvl, ordered };
}

function parseParagraph(blockXml, numberingFormats) {
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
    list: parseListInfo(pPr, numberingFormats),
  };
}

// Parse a .docx (ArrayBuffer | Uint8Array | Buffer | Blob) into
// { paragraphs: [{ runs, align, spaceBeforePt, spaceAfterPt, list }] } in
// document order, including paragraphs nested in tables. `list` is `null` or
// `{ numId, ilvl, ordered }`, resolved by also reading word/numbering.xml from
// the same zip.
export async function parseDocxToModel(input) {
  const zip = await JSZip.loadAsync(input);
  const xml = (await zip.file("word/document.xml")?.async("string")) || "";
  const numberingXml = (await zip.file("word/numbering.xml")?.async("string")) || "";
  const numberingFormats = parseNumberingFormats(numberingXml);
  const paragraphs = [];
  PARAGRAPH_RE.lastIndex = 0;
  let pm;
  while ((pm = PARAGRAPH_RE.exec(xml)) !== null) {
    paragraphs.push(parseParagraph(pm[0], numberingFormats));
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

// Inner run markup shared by a plain paragraph and a list item, so bold/
// italic/underline/size/color/mark rendering is never duplicated between the
// two.
function renderRunsHtml(runs) {
  return runs
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
}

function renderParagraphHtml(p) {
  const pStyle = `text-align:${p.align};margin:${p.spaceBeforePt || 0}pt 0 ${p.spaceAfterPt || 0}pt;white-space:pre-wrap;`;
  if (!p.runs.length) return `<p style="${pStyle}min-height:0.9em;"><br></p>`;
  return `<p style="${pStyle}">${renderRunsHtml(p.runs)}</p>`;
}

// A list paragraph's own <li>. ilvl becomes indentation on a flat <li>, never
// a nested <ul>/<ol> -- deliberately, so this fix can never produce the
// <ul>-inside-<li> shape that triggers htmlToPlainText's separately-filed
// nested-list fusion defect. A paragraph with no runs (an empty native
// bullet -- unspecified by the design) renders exactly as an empty ordinary
// paragraph would, a <br> placeholder, so the item stays visible and the
// list's item count is preserved rather than silently dropping the line.
function renderListItemHtml(p) {
  // `margin:0` first, so a later `margin-left` (the ilvl indent below) can
  // still override just that one side -- CSS resolves same-property inline
  // declarations in order, so the shorthand's other three sides stay zero.
  const style = `margin:0;white-space:pre-wrap;${p.list.ilvl > 0 ? `margin-left:${p.list.ilvl * 1.5}em;` : ""}`;
  const inner = p.runs.length ? renderRunsHtml(p.runs) : "<br>";
  return `<li style="${style}">${inner}</li>`;
}

// Every ordinary paragraph sets its vertical margin explicitly (see
// renderParagraphHtml below), so a <ul>/<ol> with no style of its own was the
// one gap: it fell back to the browser/Word/Google-Docs default `margin: 1em
// 0`, which is exactly the unwanted gap a user sees between a position header
// and its bullets. `padding-left:40px` reproduces the browser UA stylesheet's
// own default indent (Chrome/Firefox both default <ul>/<ol> to
// `padding-inline-start: 40px`), so zeroing the margin does not also flatten
// the marker indent.
const LIST_WRAPPER_STYLE = "margin:0;padding-left:40px;";

// Render a parsed model to an HTML string with inline styles, so the preview
// reads like the document. Used both for the read-only view and to seed the
// rich-text editor. Whitespace is preserved (white-space: pre-wrap) so runs of
// spaces and tabs match the document. A maximal run of ADJACENT paragraphs
// sharing the same non-null `list.numId` is wrapped in one <ul>/<ol> of flat
// <li>s; a paragraph with `list: null`, or a different numId, closes the
// current group (if any) and is/starts unaffected -- so document order is
// always preserved and two non-adjacent uses of the same numId never merge.
export function renderModelToHtml(model) {
  const paragraphs = model?.paragraphs || [];
  const parts = [];
  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];
    if (p.list) {
      const numId = p.list.numId;
      const tag = p.list.ordered ? "ol" : "ul";
      const items = [];
      while (i < paragraphs.length && paragraphs[i].list && paragraphs[i].list.numId === numId) {
        items.push(renderListItemHtml(paragraphs[i]));
        i += 1;
      }
      parts.push(`<${tag} style="${LIST_WRAPPER_STYLE}">${items.join("")}</${tag}>`);
    } else {
      parts.push(renderParagraphHtml(p));
      i += 1;
    }
  }
  return parts.join("");
}

// Build a plain-text model from raw lines, for resumes with no .docx template
// (e.g. a .txt upload) so the preview still renders something readable.
// `list` is always null -- a .txt/no-template upload never carries native
// Word numbering -- which is what keeps the model shape uniform across both
// producers.
export function linesToModel(lines = []) {
  return {
    paragraphs: (Array.isArray(lines) ? lines : String(lines).split("\n")).map((line) => ({
      runs: line ? [{ text: line, bold: false, italic: false, underline: false, sizePt: null, color: null }] : [],
      align: "left",
      spaceBeforePt: 0,
      spaceAfterPt: 4,
      list: null,
    })),
  };
}
