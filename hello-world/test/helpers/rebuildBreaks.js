// N40 / design.r2.md §5B-§5C: the shared instrument for the soft-line-break
// rebuild regression class. Plain ES, no vitest import.
//
// THE DEFECT. An edited document is rebuilt by pouring its lines back into the
// engine's .docx (lib/document/docx.js, buildDocxFromUploadedTemplate). Lines
// split a paragraph at every soft break (`<w:br/>`, `<w:cr/>`), but the
// rebuild's slots did not, so the embedded cover letter's one-paragraph
// sign-off `Sincerely,<w:br/>Alex Shaw` came back as `Since<w:br/>rely,` plus a
// stray cloned paragraph `Alex <w:br/>Shaw`.
//
// WHY THIS INSTRUMENT AND NOT MAMMOTH. `mammoth.extractRawText` drops `<w:br>`
// entirely: it reads the corrupted file as "Sincerely,\n\nAlex Shaw", which is
// what a correct reader would want to see, and the original as
// "Sincerely,Alex Shaw". A raw-text comparison is therefore blind to the bug
// (design.check.r1.md B1). This helper reads every paragraph's run-level
// tokens itself -- text, and each break BY KIND -- plus its `w:pPr`, and
// compares them paragraph by paragraph. It deliberately does not import the
// production tokenizer (docxModel.paragraphTextWithBreaks): an instrument
// that shares code with the thing it measures inherits its blind spots.
//
// It lives under test/ because lib/sourceScan/exportReachability.sweep.test.js
// classifies everything under test/ as test code (see plantedSecrets.js).

import JSZip from "jszip";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// The four embedded cover-letter variants the engine ships (coverVariant).
export const EMBEDDED_VARIANTS = ["industry", "teaching", "staff", "nontechnical"];

export const POSTING = `Senior Software Engineer at Acme Corp
Acme Corp is hiring a Senior Software Engineer to build cloud services in Python and AWS.
Responsibilities: design APIs, mentor engineers, lead delivery with Agile practices.
Requirements: 5+ years of software engineering, Python, AWS, Kubernetes, CI/CD.`;

// A company fact of the kind a candidate appends to their opening paragraph.
export const FACT = "Acme's 2026 launch of its open telemetry platform is the kind of work I want to help scale.";

// ---------------------------------------------------------------------------
// Bytes in any shape -> ArrayBuffer / base64
// ---------------------------------------------------------------------------

export function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function toZip(source) {
  if (typeof source === "string") return JSZip.loadAsync(source, { base64: true });
  if (source && typeof source.arrayBuffer === "function") return JSZip.loadAsync(await source.arrayBuffer());
  return JSZip.loadAsync(source);
}

export async function documentXmlOf(source) {
  const zip = await toZip(source);
  return zip.file("word/document.xml").async("string");
}

// ---------------------------------------------------------------------------
// The per-paragraph record
// ---------------------------------------------------------------------------

function isW(node, name) {
  return node.nodeType === 1 && node.namespaceURI === W && node.localName === name;
}

function insidePPr(node, paragraph) {
  for (let n = node.parentNode; n && n !== paragraph; n = n.parentNode) {
    if (isW(n, "pPr")) return true;
  }
  return false;
}

// `[br]` for a text-wrapping break (the default type), `[br:page]` etc. for the
// others, `[cr]` for a carriage return, `[tab]` for a run-level tab. A
// rebuild that turned a `w:cr` into a `w:br`, or a line break into a page
// break, changes the signature.
function breakToken(el) {
  if (isW(el, "cr")) return "[cr]";
  const type = el.getAttributeNS(W, "type") || el.getAttribute("w:type") || "";
  return !type || type === "textWrapping" ? "[br]" : `[br:${type}]`;
}

/**
 * Every `w:p` in `word/document.xml`, in document order, as
 * `{ sig, breaks, pPr }`:
 *   sig    -- the paragraph's run content, text with each break as a token;
 *   breaks -- how many `w:br`/`w:cr` it carries;
 *   pPr    -- its serialized `w:pPr` ("" when absent).
 */
export async function paragraphRecords(source) {
  const xml = await documentXmlOf(source);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const out = [];
  for (const p of Array.from(body.getElementsByTagNameNS(W, "p"))) {
    let sig = "";
    let breaks = 0;
    for (const el of Array.from(p.getElementsByTagNameNS(W, "*"))) {
      if (insidePPr(el, p)) continue;
      if (isW(el, "t")) sig += el.textContent || "";
      else if (isW(el, "br") || isW(el, "cr")) {
        sig += breakToken(el);
        breaks += 1;
      } else if (isW(el, "tab") && isW(el.parentNode, "r")) sig += "[tab]";
    }
    const pPrNode = Array.from(p.childNodes).find((n) => isW(n, "pPr"));
    const pPr = pPrNode ? new XMLSerializer().serializeToString(pPrNode) : "";
    out.push({ sig, breaks, pPr });
  }
  return out;
}

/** Every index whose sig or pPr differs, including paragraphs added or lost. */
export function diffRecords(before, after) {
  const out = [];
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.sig !== b.sig || a.pPr !== b.pPr) {
      out.push({ i, was: a ? a.sig : null, now: b ? b.sig : null, pPrSame: !!a && !!b && a.pPr === b.pPr });
    }
  }
  return out;
}

/**
 * The expected rebuild: `changed` maps a paragraph index to its expected new
 * sig; every other paragraph must be untouched. Returns a list of human-
 * readable problems, [] when the rebuild is exactly as expected, so a failing
 * assertion prints what moved.
 */
export function rebuildProblems(before, after, changed = {}, { ignoreTrailingSpace = false } = {}) {
  if (ignoreTrailingSpace) {
    // Opt-in, for the bundled résumé only: its engine paragraphs end in a
    // space that the engine's own lines trimEnd away (docxModel.documentLines),
    // so EVERY rebuild -- on HEAD too -- writes them back one space shorter.
    // Invisible in the rendered page and unrelated to line breaks; trimmed
    // before each break token and at the end so it cannot mask one.
    const trim = (recs) => recs.map((r) => ({ ...r, sig: r.sig.replace(/\s+(?=\[(?:br|cr)[^\]]*\]|$)/g, "") }));
    return rebuildProblems(trim(before), trim(after), changed);
  }
  const problems = [];
  if (after.length !== before.length) {
    problems.push(`paragraph count ${before.length} -> ${after.length}`);
  }
  for (const d of diffRecords(before, after)) {
    const want = Object.prototype.hasOwnProperty.call(changed, d.i) ? changed[d.i] : undefined;
    if (want !== undefined && d.now === want && d.pPrSame) continue;
    problems.push(`p${d.i}: ${JSON.stringify(d.was)} -> ${JSON.stringify(d.now)}${d.pPrSame ? "" : " (pPr changed)"}`);
  }
  for (const [i, want] of Object.entries(changed)) {
    const b = after[Number(i)];
    if (!b || b.sig !== want) {
      if (!problems.some((p) => p.startsWith(`p${i}:`))) problems.push(`p${i}: expected ${JSON.stringify(want)}, got ${JSON.stringify(b ? b.sig : null)}`);
    }
  }
  return problems;
}

/** Index of the first paragraph whose sig satisfies `pred`; throws if none. */
export function findParagraph(records, pred, label) {
  const i = records.findIndex((r) => pred(r.sig));
  if (i < 0) throw new Error(`fixture guard: no paragraph matches ${label}`);
  return i;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The real embedded engine's cover letter for one variant: its lines (what the
 * editor shows, one per soft line) and its finished .docx. `breakKind: "cr"`
 * rewrites every soft break to `<w:cr/>`, the other run-level break element
 * WordprocessingML defines and that documentLines and mammoth both split on.
 */
export async function embeddedCover(variant, { breakKind = "br" } = {}) {
  const r = await embeddedEngine.tailorCoverLetter({
    jobPosting: POSTING,
    jobTitle: "Senior Software Engineer",
    companyName: "Acme Corp",
    coverVariant: variant,
  });
  let docxB64 = r.docxB64;
  if (breakKind === "cr") {
    const zip = await JSZip.loadAsync(docxB64, { base64: true });
    const xml = await zip.file("word/document.xml").async("string");
    const swapped = xml.replace(/<w:br\b[^>]*\/>/g, "<w:cr/>");
    if (swapped === xml) throw new Error("fixture guard: the engine cover letter carries no <w:br/> to swap");
    zip.file("word/document.xml", swapped);
    docxB64 = await zip.generateAsync({ type: "base64" });
  }
  return { variant, breakKind, lines: r.resultLines.slice(), docxB64 };
}

/** The engine's bundled résumé (no soft breaks at all: a no-regression fixture). */
export async function embeddedResume() {
  const r = await embeddedEngine.tailorResume({
    jobPosting: POSTING,
    jobTitle: "Senior Software Engineer",
    companyName: "Acme Corp",
  });
  return { lines: r.resultLines.slice(), docxB64: r.docxB64, text: r.result };
}

// A résumé as candidates really write them in Word: the contact block and the
// role/dates heading are ONE paragraph each, split with Shift+Enter. Unlike
// the engine's cover letter (text and break in one run), the break sits in a
// run of its own, which is how Word itself saves Shift+Enter.
const RESUME_PARAGRAPHS = [
  { runs: ["Alex Shaw"], jc: "center", bold: true },
  { runs: ["Seattle, WA", "BREAK", "alex.shaw@example.com | (555) 010-0100"], jc: "center" },
  { runs: ["EXPERIENCE"], bold: true },
  { runs: ["Senior Software Engineer, Mutual of Omaha", "BREAK", "2019 - Present"] },
  { runs: ["Built an enterprise API integration service used by 40 internal teams."], ind: 360 },
  { runs: ["Led a team of five engineers on data platform initiatives."], ind: 360 },
];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function resumeDocumentXml(breakKind) {
  const br = breakKind === "cr" ? "<w:cr/>" : "<w:br/>";
  const paras = RESUME_PARAGRAPHS.map((p) => {
    const pPr = `<w:pPr>${p.jc ? `<w:jc w:val="${p.jc}"/>` : ""}${p.ind ? `<w:ind w:left="${p.ind}"/>` : ""}<w:spacing w:after="80"/></w:pPr>`;
    const rPr = `<w:rPr>${p.bold ? "<w:b/>" : ""}<w:sz w:val="21"/></w:rPr>`;
    const runs = p.runs
      .map((r) => (r === "BREAK" ? `<w:r>${rPr}${br}</w:r>` : `<w:r>${rPr}<w:t xml:space="preserve">${esc(r)}</w:t></w:r>`))
      .join("");
    return `<w:p>${pPr}${runs}</w:p>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${paras}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
}

/** The lines an engine derives from RESUME_PARAGRAPHS: one per soft line. */
export const RESUME_LINES = RESUME_PARAGRAPHS.flatMap((p) =>
  p.runs.join(" ").split(" BREAK ").map((s) => s.split(" ").join("")),
);

/** A candidate-authored résumé .docx with Shift+Enter breaks, as bytes. */
export async function breakResumeDocx({ breakKind = "br" } = {}) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", resumeDocumentXml(breakKind));
  const buf = await zip.generateAsync({ type: "arraybuffer" });
  return { buf, b64: bytesToBase64(buf), lines: RESUME_LINES.slice() };
}

export function asDocxFile(buf, name = "my-resume.docx") {
  return new File([buf], name, { type: DOCX_MIME });
}

// ---------------------------------------------------------------------------
// Edit shapes (design.r2.md §5B's table), each with the paragraph-level result
// a correct rebuild must produce. `ctx` = { lines, before } for one fixture.
// ---------------------------------------------------------------------------

function coverAnchors({ lines, before }) {
  const intro = lines.findIndex((l, i) => i >= 1 && l.trim().length > 40);
  const signLine = lines.findIndex((l) => /^\s*sincerely,/i.test(l));
  if (intro < 0 || signLine < 0 || lines[signLine + 1] !== "Alex Shaw") {
    throw new Error("fixture guard: the cover letter no longer ends 'Sincerely,' / 'Alex Shaw'");
  }
  const signPara = findParagraph(before, (s) => /^Sincerely,\[(br|cr)\]Alex Shaw$/.test(s), "the sign-off");
  const introPara = findParagraph(before, (s) => s === lines[intro], "the opening body line");
  const brTok = before[signPara].sig.includes("[cr]") ? "[cr]" : "[br]";
  return { intro, signLine, signPara, introPara, brTok };
}

export const COVER_SHAPES = {
  // The edited flag with the lines untouched: a user who typed and undid.
  control: (ctx) => ({ lines: ctx.lines.slice(), changed: {} }),
  // A fact appended to the opening paragraph.
  bodyEdit: (ctx) => {
    const a = coverAnchors(ctx);
    const edited = `${ctx.lines[a.intro].trimEnd()} ${FACT}`;
    return {
      lines: ctx.lines.map((l, i) => (i === a.intro ? edited : l)),
      changed: { [a.introPara]: edited },
    };
  },
  renameSigner: (ctx) => {
    const a = coverAnchors(ctx);
    return {
      lines: ctx.lines.map((l, i) => (i === a.signLine + 1 ? "Alexander Shaw" : l)),
      changed: { [a.signPara]: `Sincerely,${a.brTok}Alexander Shaw` },
    };
  },
  deleteSigner: (ctx) => {
    const a = coverAnchors(ctx);
    return {
      lines: ctx.lines.filter((_, i) => i !== a.signLine + 1),
      changed: { [a.signPara]: "Sincerely," },
    };
  },
  insertBetween: (ctx) => {
    const a = coverAnchors(ctx);
    return {
      lines: ctx.lines.flatMap((l, i) => (i === a.signLine ? [l, "Warm wishes,"] : [l])),
      // The inserted line stays inside the sign-off block, on its own soft
      // line. Run only against `<w:br/>` fixtures: the kind of the NEW break
      // is the fix's choice and is not pinned for a `<w:cr/>` letter.
      changed: { [a.signPara]: "Sincerely,[br]Warm wishes,[br]Alex Shaw" },
    };
  },
  // Gemini-style break-blind lines (extractTemplateLinesFromDocx joins every
  // w:t of a paragraph): the sign-off arrives as ONE line and must still render
  // with its break. Passes on HEAD -- a no-regression control for the fix.
  geminiJoined: (ctx) => {
    const a = coverAnchors(ctx);
    return {
      lines: [...ctx.lines.slice(0, a.signLine), "Sincerely,Alex Shaw", ...ctx.lines.slice(a.signLine + 2)],
      changed: {},
    };
  },
};

export const RESUME_SHAPES = {
  control: (ctx) => ({ lines: ctx.lines.slice(), changed: {} }),
  // One bullet reworded; the two Shift+Enter paragraphs must not move.
  bodyEdit: (ctx) => {
    const i = ctx.lines.findIndex((l) => l.startsWith("Built an enterprise API"));
    const edited = "Built an enterprise API integration service used by 40 internal teams and 2 external partners.";
    const p = findParagraph(ctx.before, (s) => s === ctx.lines[i], "the first bullet");
    return { lines: ctx.lines.map((l, k) => (k === i ? edited : l)), changed: { [p]: edited } };
  },
};

/** The lines as the editor holds them, i.e. what a hand edit round-trips through. */
export function asEditorText(lines) {
  return lines.join("\n");
}
