// N105 Step 3c - AC-10, the real-chronology check the truthfulness gate
// deliberately does not make. PURE.
//
// The gate (applicationReadyGate.js) judges CONTENT spans. An employer or
// education line ("Acme Corp - Senior Engineer (2020-2024)") is structure: the
// decompose step leaves it out of the span list, recompose always emits it, and
// the gate never sees it. So the one place that can stop an invented employer,
// a moved date or a different degree from shipping is the orchestrator, which
// calls this module on `layout.entries` (the items of kind "employer") before it
// recomposes.
//
//   NAME      must be a real employer / institution of the user (corporate
//             suffixes are ignored: "Acme Corporation" is "Acme Corp"). A line
//             whose name is not real is REMOVED, together with the content under
//             it; it cannot be corrected into something real.
//   DATES     must match the real record for each endpoint the record states.
//             A different date is CORRECTED to the real one (the real value is
//             the user's own text, so it is always truthful). Less precision
//             than the record ("2020" for "Jan 2020") is not a contradiction.
//   DEGREE    when the matching record is an education entry that states a
//             degree, the line's degree is the real one.
//   TITLE     employer titles may be truthfully reframed (AC-10) and are left
//             alone here; inflation of seniority or scope belongs to the review.
//
// What counts as real is the chronology the caller supplies
// ({ employers, education }) plus the employer names carried by the real
// material spans' contextKey (names only, no dates). With nothing real to match
// against, every employer line is removed: the check fails closed, like the
// gate, rather than waving through what it cannot verify.
import { extractDateRange } from "@/lib/resume/parseEmployment";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const PRESENT_RE = /^(?:present|current|now|to\s*date|ongoing|today)$/;
const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company",
  "plc", "gmbh", "lp", "llp",
]);
// "<Name> <sep> <Title> (<dates>)", the shape spanDocument's parseEmployerLine
// accepts, with the separators and the brackets captured so a corrected line
// keeps the original punctuation.
const LINE_RE = /^(.+?)(\s+[—–|]\s+)(.+?)(\s*\()([^()]+)(\)\s*)$/;
const DASH_RE = /\s*[–—-]\s*/;

function clean(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function compact(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// "Acme Corp." / "ACME Corporation" / "Acme" share one key.
export function employerKey(name) {
  const words = clean(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

// One date token => { present } | { year, month|null } | null (unreadable).
function parseDate(text) {
  const t = clean(text).toLowerCase();
  if (!t) return null;
  if (PRESENT_RE.test(t)) return { present: true };
  let m = /^([a-z]+)\.?\s*'?(\d{4})$/.exec(t);
  if (m && MONTHS[m[1].slice(0, 3)]) return { year: Number(m[2]), month: MONTHS[m[1].slice(0, 3)] };
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { year: Number(m[2]), month: Number(m[1]) };
  m = /^(\d{4})$/.exec(t);
  return m ? { year: Number(m[1]), month: null } : null;
}

// The candidate may be LESS precise than the record (year only) but never
// contradict it or claim a month the record does not state. An unreadable token
// on either side can only be equal verbatim.
function sameDate(candidate, real) {
  const a = parseDate(candidate);
  const b = parseDate(real);
  if (a && b) {
    if (a.present || b.present) return Boolean(a.present) === Boolean(b.present);
    return a.year === b.year && (a.month === null || a.month === b.month);
  }
  return compact(candidate) === compact(real);
}

function splitDates(datesText) {
  const range = extractDateRange(datesText);
  return range ? { start: range.start, end: range.end } : { start: clean(datesText), end: "" };
}

// Only an endpoint BOTH sides state can disagree.
function disagreements(cand, real) {
  return {
    start: Boolean(cand.start && real.start && !sameDate(cand.start, real.start)),
    end: Boolean(cand.end && real.end && !sameDate(cand.end, real.end)),
  };
}

// The line's dates with the real endpoints swapped in where they disagree, or
// null when nothing needs to change.
function correctedDates(datesText, real) {
  const cand = splitDates(datesText);
  const bad = disagreements(cand, real);
  if (!bad.start && !bad.end) return null;
  const sep = DASH_RE.exec(datesText)?.[0] ?? " - ";
  const start = bad.start ? real.start : cand.start;
  const end = bad.end ? real.end : cand.end;
  return end ? `${start}${sep}${end}` : start;
}

/**
 * Everything the user really has, as [{ name, key, start, end, degree?, kind }].
 *   realMaterial.chronology.employers  [{ name, start|startDate, end|endDate }]
 *   realMaterial.chronology.education  [{ institution|school|name, degree?, start, end }]
 *   realMaterial.spans                 contextKey = a real employer/project name
 * Chronology records come first so a dateless name taken from a span never
 * shadows a dated record of the same employer.
 */
export function buildRealEmployers(realMaterial) {
  const list = [];
  const add = (kind, name, start, end, degree) => {
    const key = employerKey(name);
    if (key) list.push({ kind, name: clean(name), key, start: clean(start), end: clean(end), degree: clean(degree) });
  };
  const chronology = realMaterial?.chronology;
  for (const e of Array.isArray(chronology?.employers) ? chronology.employers : []) {
    add("employer", e?.name ?? e?.company, e?.start ?? e?.startDate, e?.end ?? e?.endDate);
  }
  for (const e of Array.isArray(chronology?.education) ? chronology.education : []) {
    add("education", e?.institution ?? e?.school ?? e?.name, e?.start ?? e?.startDate, e?.end ?? e?.endDate, e?.degree);
  }
  const named = new Set(list.map((e) => e.key));
  for (const span of Array.isArray(realMaterial?.spans) ? realMaterial.spans : []) {
    const key = employerKey(span?.contextKey);
    if (key && !named.has(key)) {
      named.add(key);
      add("span", span.contextKey);
    }
  }
  return list;
}

/**
 * The real record a parsed employer line refers to, or null when the name is
 * not one of the user's. Several stints at one employer pick the record whose
 * dates the line agrees with best.
 */
export function findRealEmployer(realEmployers, name, datesText = "") {
  const key = employerKey(name);
  const matches = key ? realEmployers.filter((e) => e.key === key) : [];
  if (matches.length <= 1) return matches[0] ?? null;
  const cand = splitDates(datesText);
  let best = matches[0];
  let bestScore = Infinity;
  for (const record of matches) {
    const bad = disagreements(cand, record);
    const score = Number(bad.start) + Number(bad.end);
    if (score < bestScore) {
      best = record;
      bestScore = score;
    }
  }
  return best;
}

// The employer layout entry with its name, degree and dates made exact; the
// same object when the line is already exact.
function correctEntry(entry, real) {
  const parts = LINE_RE.exec(String(entry.text ?? "").trim());
  if (!parts) return entry;
  const [, name, sep, title, open, dates, close] = parts;
  const nameOut = compact(name) === compact(real.name) ? name : real.name;
  const titleOut = real.degree && compact(title) !== compact(real.degree) ? real.degree : title;
  const datesOut = correctedDates(dates, real) ?? dates;
  const text = `${nameOut}${sep}${titleOut}${open}${datesOut}${close}`;
  if (text === String(entry.text).trim()) return entry;
  return { ...entry, text, employer: { name: nameOut, title: titleOut, dates: datesOut } };
}

/**
 * Checks every employer entry of `layout` against the real records.
 *
 * => { layout,             a copy: corrected lines; an invented employer's slot
 *                          becomes an unretained content slot, so recompose
 *                          leaves a gap exactly like any other removed span
 *      invalidSpanIds,     Set of span ids that sat under an invented employer
 *      removedEmployers }  [{ id, text, section }] the lines taken out
 */
export function reconcileChronology(layout, realEmployers) {
  const source = Array.isArray(layout?.entries) ? layout.entries : [];
  const entries = [];
  const invalidSpanIds = new Set();
  const removedEmployers = [];
  let underInvented = false;

  for (const entry of source) {
    if (entry.kind === "heading") {
      underInvented = false;
      entries.push(entry);
    } else if (entry.kind === "span") {
      if (underInvented) invalidSpanIds.add(entry.spanId);
      entries.push(entry);
    } else if (entry.kind !== "employer") {
      entries.push(entry);
    } else {
      const real = findRealEmployer(realEmployers, entry.employer?.name, entry.employer?.dates);
      underInvented = !real;
      if (real) {
        entries.push(correctEntry(entry, real));
      } else {
        const id = `employer-removed-${removedEmployers.length + 1}`;
        removedEmployers.push({ id, text: entry.text, section: entry.section });
        entries.push({ kind: "span", spanId: id, section: entry.section });
      }
    }
  }
  return { layout: { ...layout, entries }, invalidSpanIds, removedEmployers };
}
