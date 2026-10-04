// N105 Step 4 - the REAL material the Ideal pipeline gates against, assembled from
// the uploaded resume's text alone (design D-7: there is no server-side store of
// employers, dates or degrees). PURE.
//
//   => { spans:     [{ id, text, contextKey }],     the resume's own lines; a line
//                                                    under an employer or school
//                                                    carries that name as contextKey
//        chronology: { employers: [{ name, start, end }],
//                      education: [{ institution, degree, start, end }] } }
//
// Both halves matter. The truthfulness gate reads the spans (and their
// contextKey, which is what stops a metric moving from one employer to another);
// the AC-10 chronology check reads the chronology. Without `education` the check
// would treat a real "<School> - <Degree> (<dates>)" line as an invented
// employer and remove it, so the schools and degrees the resume states are
// extracted here too.
//
// Everything is read from the user's own text, so a name or date this module
// registers is by construction one the resume contains. The extraction is
// best-effort; where it misses, the pipeline fails closed (a line it cannot match
// is removed or left out), never open.
import { TITLE_KEYWORDS_RE, extractDateRange, headerDateSpan, parseEmploymentHistory } from "@/lib/resume/parseEmployment";
import { employerKey } from "@/lib/llm/ideal/idealChronology";
import { isSectionHeading, parseEmployerLine } from "@/lib/llm/ideal/spanDocument";

const MAX_ENTRIES = 40;
const EDUCATION_HEADING_RE =
  /^\s*(?:education(?:\s*(?:and|&)\s*(?:training|certifications?))?|academic\s+(?:background|history|qualifications?))\s*:?\s*$/i;
const INSTITUTION_RE = /\b(?:universit(?:y|ies)|college|institute|school|academy|polytechnic|conservatory|seminary)\b/i;
const DEGREE_RE =
  /\b(?:bachelors?|masters?|associates?|doctor(?:ate)?|ph\.?\s?d|mba|diploma|b\.?\s?(?:s|a|sc|eng|tech|ed|fa)|m\.?\s?(?:s|a|sc|eng|ed|fa))\b/i;
const BULLET_RE = /^\s*[-*•▪◦‣·‐‑‒–—]\s+/;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;
const SEGMENT_SPLIT_RE = /\s+[—–-]\s+|\s*[|•·]\s*|,\s*/;

function isHeading(line) {
  return EDUCATION_HEADING_RE.test(line) || isSectionHeading(line.toUpperCase());
}

// One entry per resume line: its trimmed text and whether it sits in the
// education section. A blank line carries `text: ""`.
function classify(resumeText) {
  let inEducation = false;
  return String(resumeText ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw) => {
      const text = raw.replace(/\s+/g, " ").trim();
      const heading = text !== "" && isHeading(text);
      if (heading) inEducation = EDUCATION_HEADING_RE.test(text);
      return { text, heading, inEducation: inEducation && !heading };
    });
}

// "Acme Corp" and "Acme Corporation" share one employerKey; the first spelling
// seen is the canonical name, so every record and every span agree on it.
function nameRegistry() {
  const byKey = new Map();
  return (name) => {
    const key = employerKey(name);
    if (!key) return "";
    if (!byKey.has(key)) byKey.set(key, String(name).trim());
    return byKey.get(key);
  };
}

function dateParts(text) {
  const range = extractDateRange(text);
  if (range) return { start: range.start, end: range.end };
  const year = YEAR_RE.exec(text);
  return { start: "", end: year ? year[1] : "" };
}

function employersFrom(rows, canon) {
  // Education lines are blanked first so a school never reads as an employer.
  const outsideEducation = rows.map((row) => (row.inEducation ? "" : row.text));
  const found = parseEmploymentHistory(outsideEducation, { maxEntries: MAX_ENTRIES })
    .filter((entry) => entry.company)
    .map((entry) => ({ name: entry.company, start: entry.startDate, end: entry.endDate }));
  // A resume already written as "<Name> - <Title> (<dates>)" states its records
  // in the exact shape the candidate document is rebuilt in.
  for (const row of rows) {
    const parsed = row.inEducation ? null : parseEmployerLine(row.text);
    if (parsed) {
      const range = extractDateRange(parsed.dates);
      found.push({ name: parsed.name, start: range ? range.start : parsed.dates, end: range ? range.end : "" });
    }
  }
  const seen = new Set();
  const employers = [];
  for (const e of found) {
    const name = canon(e.name);
    const id = `${employerKey(name)}|${e.start}|${e.end}`;
    if (name && !seen.has(id)) {
      seen.add(id);
      employers.push({ name, start: e.start, end: e.end });
    }
  }
  return employers;
}

// A school line, plus the degree and dates that sit on it or on the (up to) two
// lines below it before the next school.
function educationFrom(rows, canon) {
  const education = [];
  rows.forEach((row, i) => {
    if (!row.inEducation || !INSTITUTION_RE.test(row.text)) return;
    const range = extractDateRange(row.text);
    const stripped = range ? row.text.replace(range.matched, " ") : row.text.replace(YEAR_RE, " ");
    const segments = stripped.split(SEGMENT_SPLIT_RE).map((s) => s.replace(/[()\s]+$|^[()\s]+/g, "")).filter(Boolean);
    const at = segments.findIndex((s) => INSTITUTION_RE.test(s));
    if (at < 0) return;

    let degree = segments.find((s) => DEGREE_RE.test(s)) || "";
    let dates = dateParts(row.text);
    for (let j = i + 1; j <= i + 2 && j < rows.length; j += 1) {
      const next = rows[j];
      if (!next.inEducation || next.text === "" || INSTITUTION_RE.test(next.text)) break;
      if (!degree) degree = next.text.split(SEGMENT_SPLIT_RE).find((s) => DEGREE_RE.test(s))?.trim() || "";
      if (!dates.start && !dates.end) dates = dateParts(next.text);
    }

    // "University of California, Berkeley" splits at the comma; register the
    // joined spelling as well as the head.
    const place = segments[at + 1];
    const placeIsName = place && place.split(" ").length <= 3 && !/\d/.test(place) && !DEGREE_RE.test(place);
    const names = [segments[at], ...(placeIsName ? [`${segments[at]}, ${place}`] : [])];
    for (const raw of names) {
      const institution = canon(raw);
      if (institution) education.push({ institution, degree, start: dates.start, end: dates.end });
    }
  });
  return education;
}

// A line that opens an employer or school entry: not a bullet, not a sentence
// (unless it names a job), and either dated (employer) or in the education
// section and naming the school.
function headerName(row, candidates) {
  const t = row.text;
  if (BULLET_RE.test(t) || (/[.!?]$/.test(t) && !TITLE_KEYWORDS_RE.test(t))) return "";
  if (row.inEducation ? !INSTITUTION_RE.test(t) : !headerDateSpan(t)) return "";
  const padded = ` ${t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
  let best = null;
  for (const c of candidates) {
    if (padded.includes(` ${c.key} `) && (!best || c.key.length > best.key.length)) best = c;
  }
  return best ? best.name : "";
}

export function buildIdealRealMaterial(resumeText) {
  const rows = classify(resumeText);
  const canon = nameRegistry();
  const employers = employersFrom(rows, canon);
  const education = educationFrom(rows, canon);
  const keyed = (list, pick) => list.map((e) => ({ name: pick(e), key: employerKey(pick(e)) })).filter((c) => c.key);
  const employerNames = keyed(employers, (e) => e.name);
  const schoolNames = keyed(education, (e) => e.institution);

  const spans = [];
  let context = "";
  for (const row of rows) {
    if (row.text === "") continue;
    if (row.heading) {
      context = "";
      continue;
    }
    context = headerName(row, row.inEducation ? schoolNames : employerNames) || context;
    spans.push({ id: `r${spans.length + 1}`, text: row.text, contextKey: context });
  }
  return { spans, chronology: { employers, education } };
}
