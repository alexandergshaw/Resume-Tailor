// Self-contained .docx scan + fill, tolerant of Word splitting a placeholder
// across runs. The embedded engine only ever processes its OWN bundled template
// (well-formed OOXML we control), so a focused string model of paragraphs/runs
// is safer and lighter than pulling in a full DOM library — and it keeps the
// whole module deletable in one folder with no extra dependency.
//
// A .docx is a zip; text lives in word/document.xml plus any word/header*.xml /
// word/footer*.xml parts. Each part holds paragraphs <w:p>, each paragraph holds
// runs <w:r>, each run holds a text node <w:t>. Word frequently splits a token
// like {{NAME}} across three runs ("{{", "NAME", "}}"), so we must join a
// paragraph's run texts before matching and write values back across runs while
// preserving the first run's formatting.

import JSZip from "jszip";
import { normalizeName, slotKey } from "./normalize.js";

// A fixed entry timestamp so the same inputs serialize to byte-identical .docx
// output. JSZip otherwise stamps each entry with new Date(), which would make
// the base64 non-deterministic.
export const FIXED_ENTRY_DATE = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

// --- XML text (de)serialization for <w:t> inner content -------------------

export function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function encodeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Paragraph / run parsing ----------------------------------------------

// Match a whole paragraph block. <w:p> never nests inside <w:p>, so a
// non-greedy match is unambiguous even for paragraphs nested in table cells.
const PARAGRAPH_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
// Match a text node and capture its attributes + inner (encoded) text.
const TEXT_RUN_RE = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;

// Parse the <w:t> runs of a single paragraph block into an ordered model with
// each run's span in the block and its decoded text.
function parseRuns(block) {
  const runs = [];
  TEXT_RUN_RE.lastIndex = 0;
  let m;
  while ((m = TEXT_RUN_RE.exec(block)) !== null) {
    runs.push({
      fullStart: m.index,
      fullEnd: m.index + m[0].length,
      innerEncoded: m[2],
      text: decodeXml(m[2]),
    });
  }
  return runs;
}

// Concatenated decoded text of a paragraph (what the user sees), used for
// placeholder matching across run boundaries.
export function paragraphText(block) {
  return parseRuns(block)
    .map((r) => r.text)
    .join("");
}

// Like paragraphText, but renders soft line breaks (<w:br/>, <w:cr/>) as
// newlines. A single paragraph can hold several visual lines — e.g. a
// "Sincerely,<w:br/>Alex Shaw" sign-off — which paragraphText would otherwise
// collapse into "Sincerely,Alex Shaw".
export function paragraphTextWithBreaks(block) {
  const TOKEN_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(?:br|cr)\b[^>]*>/g;
  let out = "";
  let m;
  while ((m = TOKEN_RE.exec(block)) !== null) {
    out += m[1] !== undefined ? decodeXml(m[1]) : "\n";
  }
  return out;
}

// --- Placeholder matching --------------------------------------------------

// {{ ... }} with no inner braces (the primary, explicit placeholder form).
const DOUBLE_BRACE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
// Cautious single-brace { Title Case Words } that is NOT part of {{ }}. Requires
// the content to start uppercase and read as Title Case so prose like {n} or
// {0} is ignored.
const SINGLE_BRACE_RE =
  /(?<!\{)\{\s*([A-Z][A-Za-z]*(?:\s+[A-Za-z][A-Za-z]*)*)\s*\}(?!\})/g;

function contextWindow(text, start, end, pad = 24) {
  const from = Math.max(0, start - pad);
  const to = Math.min(text.length, end + pad);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to)}${suffix}`;
}

// Find every placeholder in a single paragraph's text, sorted by position,
// double-brace first so single-brace matching never overlaps a {{ }} span.
export function findPlaceholders(text) {
  const spans = [];
  const taken = [];

  DOUBLE_BRACE_RE.lastIndex = 0;
  let m;
  while ((m = DOUBLE_BRACE_RE.exec(text)) !== null) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      inner: m[1],
      singleBrace: false,
    });
    taken.push([m.index, m.index + m[0].length]);
  }

  SINGLE_BRACE_RE.lastIndex = 0;
  while ((m = SINGLE_BRACE_RE.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    const overlaps = taken.some(([a, b]) => start < b && end > a);
    if (overlaps) continue;
    spans.push({ start, end, raw: m[0], inner: m[1], singleBrace: true });
  }

  return spans.sort((a, b) => a.start - b.start);
}

// --- Document model --------------------------------------------------------

// Order in which parts are scanned/filled. document.xml carries body and table
// paragraphs in their natural document order (a stable, deterministic order);
// headers and footers follow, sorted by file name. Occurrence indices are
// assigned across this whole sequence.
function partOrder(zip) {
  const names = Object.keys(zip.files);
  const headers = names
    .filter((n) => /^word\/header\d*\.xml$/.test(n))
    .sort();
  const footers = names
    .filter((n) => /^word\/footer\d*\.xml$/.test(n))
    .sort();
  return ["word/document.xml", ...headers, ...footers].filter((n) =>
    zip.file(n),
  );
}

// Load a .docx buffer into an in-memory model: the zip plus, per part, the raw
// xml and its paragraph blocks (with positions) so we can rewrite in place.
export async function loadDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = [];
  for (const name of partOrder(zip)) {
    const xml = await zip.file(name).async("string");
    parts.push({ name, xml });
  }
  return { zip, parts };
}

// Walk every paragraph of every part in order, yielding each placeholder with a
// stable occurrence index per normalized name.
export function scanPlaceholders(doc) {
  const occurrenceByName = new Map();
  const slots = [];
  for (const part of doc.parts) {
    PARAGRAPH_RE.lastIndex = 0;
    let pm;
    while ((pm = PARAGRAPH_RE.exec(part.xml)) !== null) {
      const block = pm[0];
      const text = paragraphText(block);
      for (const span of findPlaceholders(text)) {
        const name = normalizeName(span.inner);
        const occurrence = occurrenceByName.get(name) || 0;
        occurrenceByName.set(name, occurrence + 1);
        slots.push({
          key: slotKey(name, occurrence),
          name,
          occurrence,
          raw: span.raw,
          context: contextWindow(text, span.start, span.end),
          single_brace: span.singleBrace,
        });
      }
    }
  }
  return slots;
}

// Build the <w:t> inner XML for an inserted value, turning "\n" into line breaks
// inside the run while keeping leading/trailing spaces (xml:space="preserve" is
// applied by the caller on the surrounding tag).
function valueToInnerXml(value) {
  return String(value)
    .split("\n")
    .map(encodeXml)
    .join('</w:t><w:br/><w:t xml:space="preserve">');
}

// Replace one placeholder span (in concatenated-text coordinates) inside a
// paragraph block, spanning runs i..j: run i keeps its formatting and receives
// prefix + value, middle runs are blanked, run j keeps suffix. Returns the new
// block. Caller applies matches right-to-left so earlier spans stay valid.
function replaceSpanInBlock(block, start, end, value) {
  const runs = parseRuns(block);
  if (runs.length === 0) return block;

  // Locate the start/end runs by cumulative offset.
  let cursor = 0;
  let startRun = -1;
  let endRun = -1;
  let localStart = 0;
  let localEnd = 0;
  for (let i = 0; i < runs.length; i += 1) {
    const runStart = cursor;
    const runEnd = cursor + runs[i].text.length;
    if (startRun === -1 && start >= runStart && start < runEnd) {
      startRun = i;
      localStart = start - runStart;
    }
    if (end > runStart && end <= runEnd) {
      endRun = i;
      localEnd = end - runStart;
    }
    cursor = runEnd;
  }
  if (startRun === -1 || endRun === -1) return block;

  const valueXml = valueToInnerXml(value);
  const newRunXml = (text) => `<w:t xml:space="preserve">${text}</w:t>`;

  // Build the replacement for each affected run, applied right-to-left so the
  // pre-computed run spans remain valid as we splice.
  const edits = [];
  if (startRun === endRun) {
    const t = runs[startRun].text;
    const inner = encodeXml(t.slice(0, localStart)) + valueXml + encodeXml(t.slice(localEnd));
    edits.push({ run: runs[startRun], xml: newRunXml(inner) });
  } else {
    const sText = runs[startRun].text;
    edits.push({
      run: runs[startRun],
      xml: newRunXml(encodeXml(sText.slice(0, localStart)) + valueXml),
    });
    for (let i = startRun + 1; i < endRun; i += 1) {
      edits.push({ run: runs[i], xml: newRunXml("") });
    }
    const eText = runs[endRun].text;
    edits.push({ run: runs[endRun], xml: newRunXml(encodeXml(eText.slice(localEnd))) });
  }

  let out = block;
  edits
    .sort((a, b) => b.run.fullStart - a.run.fullStart)
    .forEach(({ run, xml }) => {
      out = out.slice(0, run.fullStart) + xml + out.slice(run.fullEnd);
    });
  return out;
}

// Fill placeholders by exact (name, occurrence) -> value. `values` maps slot
// keys to final text; only non-empty values are written, so empty/unfilled
// slots keep their {{placeholder}} visible. Mutates `doc.parts[].xml`.
export function fillDocx(doc, values) {
  const occurrenceByName = new Map();
  for (const part of doc.parts) {
    // Rebuild the part by walking paragraphs; rewrite each block as needed.
    let result = "";
    let lastIndex = 0;
    PARAGRAPH_RE.lastIndex = 0;
    let pm;
    while ((pm = PARAGRAPH_RE.exec(part.xml)) !== null) {
      result += part.xml.slice(lastIndex, pm.index);
      let block = pm[0];
      const text = paragraphText(block);
      const matches = findPlaceholders(text).map((span) => {
        const name = normalizeName(span.inner);
        const occurrence = occurrenceByName.get(name) || 0;
        occurrenceByName.set(name, occurrence + 1);
        return { ...span, key: slotKey(name, occurrence) };
      });
      // Apply right-to-left so each span's offsets stay valid after edits.
      for (const span of matches.slice().sort((a, b) => b.start - a.start)) {
        const value = values[span.key];
        if (typeof value === "string" && value.length > 0) {
          block = replaceSpanInBlock(block, span.start, span.end, value);
        }
      }
      result += block;
      lastIndex = pm.index + pm[0].length;
    }
    result += part.xml.slice(lastIndex);
    part.xml = result;
  }
}

// The plain-text lines of the (filled) document body, in order, non-empty —
// used to populate the app's preview/result fields without a mammoth round-trip.
export function documentLines(doc) {
  const body = doc.parts.find((p) => p.name === "word/document.xml");
  if (!body) return [];
  const lines = [];
  PARAGRAPH_RE.lastIndex = 0;
  let pm;
  while ((pm = PARAGRAPH_RE.exec(body.xml)) !== null) {
    // Soft line breaks within a paragraph each start their own line, so a
    // "Sincerely,<w:br/>Alex Shaw" sign-off stays on two lines.
    for (const piece of paragraphTextWithBreaks(pm[0]).split("\n")) {
      const text = piece.replace(/\s+$/g, "");
      if (text.trim().length > 0) lines.push(text);
    }
  }
  return lines;
}

// Serialize the (possibly filled) model back to a .docx as a base64 string.
export async function serializeDocx(doc) {
  for (const part of doc.parts) {
    doc.zip.file(part.name, part.xml, { date: FIXED_ENTRY_DATE });
  }
  return doc.zip.generateAsync({ type: "base64" });
}
