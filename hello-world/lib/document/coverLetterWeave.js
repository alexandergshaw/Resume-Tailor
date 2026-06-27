// Weave company-research references into the cover letter at a chosen paragraph,
// with a placement-aware connector so each excerpt reads as part of the prose
// rather than a dropped-in tangent. Pure + deterministic so the same logic backs
// both the live preview (CompanyResearchDialog) and the final apply (page.js).
//
// `lines` are the cover letter's paragraphs (coverLetterResultLines): greeting,
// intro, current role, teaching, why-this-company, close, sign-off.

// Each target: where it lives, how the excerpt is inserted, and the lead-in that
// connects it to the surrounding text. `anchor` is matched against a paragraph;
// when it isn't found we fall back to the intro so nothing is lost.
export const PLACEMENTS = [
  { id: "intro", label: "Opening paragraph", anchor: null, position: "after-first-sentence", leadIn: "In fact, " },
  { id: "current", label: "Current role", anchor: /in my current role/i, position: "end", leadIn: "Beyond my day-to-day work, " },
  { id: "teaching", label: "Teaching", anchor: /adjunct professor|i also teach/i, position: "end", leadIn: "Outside the classroom, " },
  { id: "why", label: "Why this company", anchor: /draws me to|drawn to/i, position: "after-first-sentence", leadIn: "Beyond that, " },
];

export const DEFAULT_PLACEMENT = "intro";

export function placementOptions() {
  return PLACEMENTS.map(({ id, label }) => ({ id, label }));
}

// First substantive paragraph after the greeting (line 0).
function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}

function findParagraphIndex(lines, placement) {
  if (placement.anchor) {
    const i = lines.findIndex((l) => placement.anchor.test(String(l)));
    if (i >= 0) return i;
  }
  return introIndex(lines); // fallback covers Gemini / edited letters
}

function insertIntoParagraph(paragraph, text, position) {
  const p = String(paragraph || "");
  if (!text) return p;
  if (position === "end") return `${p} ${text}`.replace(/\s{2,}/g, " ").trim();
  // after the first sentence
  const m = p.match(/^(.*?[.!?])(\s+)([\s\S]*)$/);
  return (m ? `${m[1]} ${text} ${m[3]}` : `${p} ${text}`).replace(/\s{2,}/g, " ").trim();
}

// `placements`: [{ target, suggestion }]. Groups by target (in PLACEMENTS order)
// and weaves each group's suggestions into its paragraph with the lead-in. Edits
// paragraph text in place (never adds/removes lines), so indices stay valid.
export function weaveSources(lines, placements) {
  const out = Array.isArray(lines) ? lines.map((l) => String(l)) : [];
  if (out.length === 0 || !Array.isArray(placements) || placements.length === 0) return out;
  for (const placement of PLACEMENTS) {
    const group = placements.filter(
      (p) => (p?.target || DEFAULT_PLACEMENT) === placement.id && String(p?.suggestion || "").trim(),
    );
    if (group.length === 0) continue;
    const idx = findParagraphIndex(out, placement);
    if (idx < 0 || idx >= out.length) continue;
    const text = (placement.leadIn || "") + group.map((p) => p.suggestion.trim()).join(" ");
    out[idx] = insertIntoParagraph(out[idx], text, placement.position);
  }
  return out;
}

// The lead-in + suggestions text that each placement weaves in, keyed by the
// paragraph index it lands on. Mirrors weaveSources' grouping so the two agree.
function insertedTextByLine(woven, placements) {
  const byLine = {};
  if (!Array.isArray(placements) || placements.length === 0 || woven.length === 0) return byLine;
  for (const placement of PLACEMENTS) {
    const group = placements.filter(
      (p) => (p?.target || DEFAULT_PLACEMENT) === placement.id && String(p?.suggestion || "").trim(),
    );
    if (group.length === 0) continue;
    const idx = findParagraphIndex(woven, placement);
    if (idx < 0 || idx >= woven.length) continue;
    const text = (placement.leadIn || "") + group.map((p) => p.suggestion.trim()).join(" ");
    (byLine[idx] ||= []).push(text);
  }
  return byLine;
}

// Split a woven line into ordered segments around each inserted chunk, flagging
// the inserted ones so the preview can highlight exactly what was added.
function splitHighlights(line, inserts) {
  const segs = [];
  let rest = String(line);
  for (const ins of inserts) {
    const at = rest.indexOf(ins);
    if (at < 0) continue; // whitespace collapse shifted it — skip rather than mis-mark
    if (at > 0) segs.push({ text: rest.slice(0, at), insert: false });
    segs.push({ text: ins, insert: true });
    rest = rest.slice(at + ins.length);
  }
  if (rest) segs.push({ text: rest, insert: false });
  return segs.length ? segs : [{ text: String(line), insert: false }];
}

// Like weaveSources, but returns each paragraph as an array of
// { text, insert } segments (insert === true for the woven-in references) so the
// live preview can highlight exactly where each researched line landed. The
// joined text matches weaveSources' output verbatim.
export function weaveSourcesAnnotated(lines, placements) {
  const woven = weaveSources(lines, placements);
  const byLine = insertedTextByLine(woven, placements);
  return woven.map((line, idx) =>
    byLine[idx] ? splitHighlights(line, byLine[idx]) : [{ text: line, insert: false }],
  );
}
