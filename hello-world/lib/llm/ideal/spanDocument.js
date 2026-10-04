// N105 Step 3a - the decompose / recompose seam, PURE.
//
// A tailored resume is split into app-minted SPANS (one per content line), the
// truthfulness gate classifies each span, and the document is rebuilt from the
// spans the gate KEPT. This module owns both halves of that seam so no single
// caller sees the split and the re-join separately.
//
// The safety property is by construction: `recomposeFromSpans` emits only the
// spans it is HANDED. The layout it receives holds structure (headings,
// employer/dates lines, blank lines) and, for every content line, only a span
// id, never its text. It never sees the candidate document, so a dropped or
// flagged claim cannot reappear; the only way one reaches the output is for a
// caller to hand it that span (or to skip recompose, which the orchestrator
// tests turn red).
//
// What is a structural line (emitted without a gate, so deliberately narrow and
// fail-closed: anything that does not fit is a CONTENT span and gets gated):
//   - section heading: an ALL-CAPS line whose every word is in the section
//     vocabulary below. The vocabulary is closed on purpose; a free all-caps
//     line ("AWS SOLUTIONS ARCHITECT, PMP") could otherwise smuggle a claim in
//     as a "heading".
//   - employer/dates line: "<Name> - <Title> (<dates>)" with an em dash, en dash
//     or pipe separator, short plain labels and a parenthesised date range.
//   The orchestrator MUST still check every employer entry (`layout.entries`
//   items of kind "employer", which carry the parsed name/title/dates) against
//   the user's real chronology before it ships them (AC-10).
//   Everything else that is non-blank is a content span.

const SECTION_WORDS = new Set([
  "professional", "work", "relevant", "employment", "experience", "history", "career",
  "education", "training", "academic", "skills", "technical", "core", "key",
  "competencies", "summary", "profile", "objective", "certifications", "certificates",
  "licenses", "awards", "honors", "publications", "projects", "volunteer", "leadership",
  "languages", "interests", "activities", "additional", "information", "achievements",
  "accomplishments", "highlights", "qualifications", "affiliations", "references",
  "research", "teaching", "courses", "coursework", "and", "of", "&", "selected",
]);

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_POINT = `(?:${MONTH}\\s+)?\\d{4}`;
const DATES_RE = new RegExp(
  `^${DATE_POINT}(?:\\s*(?:[-\\u2013\\u2014]|to)\\s*(?:${DATE_POINT}|present|current))?$`,
  "i",
);
const EMPLOYER_RE = /^(.+?)\s+[—–|]\s+(.+?)\s*\(([^()]+)\)\s*$/;

function isPlainLabel(text, maxWords) {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9 &.,'’/-]*$/.test(t)) return false;
  if (/\d{2,}/.test(t)) return false;
  return t.split(/\s+/).length <= maxWords;
}

// A section heading: ALL-CAPS (no lowercase letter), at least one letter, and
// every word drawn from the closed section vocabulary.
export function isSectionHeading(line) {
  const t = String(line ?? "").trim();
  if (t.length < 2 || t.length > 48) return false;
  if (!/[A-Z]/.test(t) || /[a-z]/.test(t)) return false;
  const words = t.toLowerCase().split(/[\s/]+/).filter(Boolean);
  return words.length > 0 && words.length <= 5 && words.every((w) => SECTION_WORDS.has(w));
}

// "<Name> - <Title> (<dates>)" => { name, title, dates }, else null.
export function parseEmployerLine(line) {
  const t = String(line ?? "").trim();
  if (!t || t.length > 200) return null;
  const m = EMPLOYER_RE.exec(t);
  if (!m) return null;
  const [, name, title, dates] = m;
  if (!isPlainLabel(name, 6) || !isPlainLabel(title, 8)) return null;
  if (!DATES_RE.test(dates.trim())) return null;
  return { name: name.trim(), title: title.trim(), dates: dates.trim() };
}

function toLines(result, resultLines) {
  if (Array.isArray(resultLines) && resultLines.length > 0) {
    return resultLines.map((l) => (l === null || l === undefined ? "" : String(l)));
  }
  return String(result ?? "").replace(/\r\n?/g, "\n").split("\n");
}

function normalizeKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Splits a tailored document into spans plus the layout needed to rebuild it
// from a subset.
//
//   contextKeyOf({ text, index, section, employer }) => string
//     names the employer/project a content line belongs to. `employer` is the
//     parsed nearest preceding employer line ({ name, title, dates }) or null.
//     Defaults to that employer's name ("" before any employer).
//
// => { spans: [{ id, text, section, contextKey, order }], layout: { entries } }
//
// A span's `text` is the raw line, untouched, so recomposing every span
// reproduces the original lines exactly. Ids are minted here, distinct within
// the call, and never derived from the text.
export function decomposeToSpans(result, resultLines, { contextKeyOf } = {}) {
  const lines = toLines(result, resultLines);
  const spans = [];
  const entries = [];
  let section = "";
  let employer = null;

  lines.forEach((line, index) => {
    if (line.trim() === "") {
      entries.push({ kind: "blank", text: line });
      return;
    }
    if (isSectionHeading(line)) {
      section = line.trim();
      employer = null;
      entries.push({ kind: "heading", text: line, section });
      return;
    }
    const parsed = parseEmployerLine(line);
    if (parsed) {
      employer = parsed;
      entries.push({ kind: "employer", text: line, section, employer: parsed });
      return;
    }
    const contextKey = normalizeKey(
      typeof contextKeyOf === "function"
        ? contextKeyOf({ text: line, index, section, employer })
        : employer?.name,
    );
    const id = `s${spans.length + 1}`;
    spans.push({ id, text: line, section, contextKey, order: spans.length });
    entries.push({ kind: "span", spanId: id, section });
  });

  return { spans, layout: { entries } };
}

// Rebuilds the document from the RETAINED spans only (the gate's `kept`).
//
//   retained  [{ id, text }]  every span the caller chooses to emit
//
// Content lines come from the retained spans handed in here, never from the
// layout. A layout slot whose span is not retained emits nothing. A heading is
// emitted only when something sits beneath it (a retained span or an employer
// line); an employer/dates line is always emitted, even with all its bullets
// removed, because the real chronology must survive (AC-10). Blank lines are
// kept as separators but never lead the document or double up where a block
// was removed. With every span retained the lines are reproduced exactly.
export function recomposeFromSpans(layout, retained) {
  const entries = Array.isArray(layout?.entries) ? layout.entries : [];
  const textById = new Map();
  for (const span of Array.isArray(retained) ? retained : []) {
    if (span && typeof span.id === "string" && typeof span.text === "string") {
      textById.set(span.id, span.text);
    }
  }

  const emit = entries.map((entry) => {
    if (entry.kind === "span") return textById.has(entry.spanId);
    return entry.kind !== "heading";
  });

  // A heading survives iff its section (up to the next heading) has an
  // employer line or a retained span.
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].kind !== "heading") continue;
    let populated = false;
    for (let j = i + 1; j < entries.length && entries[j].kind !== "heading"; j += 1) {
      if (entries[j].kind === "employer" || (entries[j].kind === "span" && emit[j])) {
        populated = true;
        break;
      }
    }
    emit[i] = populated;
  }

  const textOf = (entry) => (entry.kind === "span" ? textById.get(entry.spanId) : entry.text);
  const droppedAny = entries.some((entry, i) => entry.kind !== "blank" && !emit[i]);

  if (!droppedAny) {
    const lines = entries.map(textOf);
    return { result: lines.join("\n"), resultLines: lines };
  }

  const out = [];
  let pending = [];
  let skipped = false;
  entries.forEach((entry, i) => {
    if (entry.kind === "blank") {
      // A removed block already sits between two blank runs: keep one of them.
      if (!(skipped && pending.length > 0)) pending.push(entry.text);
      return;
    }
    if (!emit[i]) {
      skipped = true;
      return;
    }
    if (out.length > 0) out.push(...pending);
    pending = [];
    skipped = false;
    out.push(textOf(entry));
  });

  return { result: out.join("\n"), resultLines: out };
}
