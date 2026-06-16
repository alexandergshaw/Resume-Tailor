// ---------------------------------------------------------------------------
// Salary extraction + formatting for the Live Feed.
//
// Two entry points feed the same goal — surfacing a salary on each feed card:
//   • Ingestion (server): source adapters call parseSalary()/salaryFrom*() to
//     populate feed_postings.salary_min / salary_max when a board exposes pay.
//   • Rendering (client): LiveFeedTab falls back to parseSalary() on the
//     description snippet for any posting whose structured columns are empty.
//
// Everything here is pure (no I/O, no React), so it is safe to import from both
// the ingestion pipeline and a client component.
// ---------------------------------------------------------------------------

// Sanity band for an *annualized* figure. Anything outside this is almost
// certainly a false positive (a $50 fee, a $120M funding round, etc.).
const MIN_ANNUAL = 10000;
const MAX_ANNUAL = 2000000;

function clampAnnual(n) {
  return Number.isFinite(n) && n >= MIN_ANNUAL && n <= MAX_ANNUAL ? Math.round(n) : null;
}

// Multiplier to annualize a figure given a pay interval (hourly/weekly/etc.).
function annualMultiplier(interval) {
  const s = String(interval || "").toLowerCase();
  if (/hour|hr/.test(s)) return 2080; // 40h * 52w
  if (/week/.test(s)) return 52;
  if (/month|\bmo\b/.test(s)) return 12;
  if (/day/.test(s)) return 260; // ~52 * 5
  return 1; // year / annual / unknown
}

// Normalize a raw {min,max} pair into annual USD, applying interval scaling,
// clamping to the sane band, and ordering the bounds. Either bound may be null.
export function normalizeSalaryPair(min, max, interval) {
  const mult = annualMultiplier(interval);
  let lo = Number.isFinite(min) && min > 0 ? min * mult : null;
  let hi = Number.isFinite(max) && max > 0 ? max * mult : null;
  lo = clampAnnual(lo);
  hi = clampAnnual(hi);
  if (lo != null && hi != null && lo > hi) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }
  return { min: lo, max: hi };
}

// Resolve a captured number string + optional "k" flag into a plain number.
function resolveNumber(numStr, kFlag) {
  if (numStr == null) return null;
  const n = parseFloat(String(numStr).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return kFlag ? n * 1000 : n;
}

function detectInterval(text) {
  if (/(?:per\s*hour|\/\s*hr\b|hourly|an\s*hour|\bphr\b)/i.test(text)) return "hour";
  if (/(?:per\s*week|weekly)/i.test(text)) return "week";
  if (/(?:per\s*month|\/\s*mo\b|monthly)/i.test(text)) return "month";
  return "year";
}

// A dollar amount: $120,000 | $120000 | $120k | $120.5K. The leading "$" is
// required so we don't latch onto arbitrary numbers in the text.
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)";
const RANGE_RE = new RegExp(
  `\\$\\s*${NUM}\\s*([kK])?\\s*(?:-|to)\\s*\\$?\\s*${NUM}\\s*([kK])?`,
  "gi",
);
const SINGLE_RE = new RegExp(`\\$\\s*${NUM}\\s*([kK])?`, "gi");

// Best-effort salary parse from free text (a job description or a board's
// compensation summary string). Returns { min, max } annualized USD; either or
// both may be null when nothing confident is found.
export function parseSalary(text) {
  if (!text || typeof text !== "string") return { min: null, max: null };
  // Normalize unicode dashes/minus to a plain hyphen so ranges match.
  const t = text.replace(/[‒-―−]/g, "-");
  const interval = detectInterval(t);

  // Prefer an explicit "$X – $Y" range — almost always a salary band.
  for (const m of t.matchAll(RANGE_RE)) {
    const pair = normalizeSalaryPair(
      resolveNumber(m[1], m[2]),
      resolveNumber(m[3], m[4]),
      interval,
    );
    if (pair.min != null || pair.max != null) return pair;
  }
  // Otherwise the first dollar figure that annualizes into the sane band,
  // treated as a floor ("From $X").
  for (const m of t.matchAll(SINGLE_RE)) {
    const { min } = normalizeSalaryPair(resolveNumber(m[1], m[2]), null, interval);
    if (min != null) return { min, max: null };
  }
  return { min: null, max: null };
}

// Lever postings carry a structured salaryRange: { min, max, currency, interval }.
export function salaryFromLever(raw) {
  const sr = raw?.salaryRange;
  if (sr && (Number.isFinite(sr.min) || Number.isFinite(sr.max))) {
    const currency = String(sr.currency || "USD").toUpperCase();
    if (currency === "USD") {
      return normalizeSalaryPair(sr.min, sr.max, sr.interval || "");
    }
  }
  return { min: null, max: null };
}

// Ashby postings carry a structured compensation object with numeric
// summaryComponents plus human-readable summary strings as a fallback.
export function salaryFromAshby(raw) {
  const comp = raw?.compensation;
  if (!comp || comp.shouldDisplayCompensationOnJobBoard === false) {
    return { min: null, max: null };
  }
  const components = Array.isArray(comp.summaryComponents) ? comp.summaryComponents : [];
  const salaryComponent =
    components.find((c) => /salary/i.test(c?.compensationType || "")) || components[0];
  if (
    salaryComponent &&
    (Number.isFinite(salaryComponent.minValue) || Number.isFinite(salaryComponent.maxValue))
  ) {
    const currency = String(salaryComponent.currencyCode || "USD").toUpperCase();
    if (currency === "USD") {
      const pair = normalizeSalaryPair(
        salaryComponent.minValue,
        salaryComponent.maxValue,
        salaryComponent.interval || "",
      );
      if (pair.min != null || pair.max != null) return pair;
    }
  }
  const summary =
    comp.scrapeableCompensationSalarySummary || comp.compensationTierSummary || "";
  return summary ? parseSalary(summary) : { min: null, max: null };
}

// Prefer a structured pair; fall back to parsing the description text.
export function resolvePostingSalary(structured, text) {
  if (structured && (structured.min != null || structured.max != null)) {
    return structured;
  }
  return parseSalary(text || "");
}

// Render a salary range, matching the Job Search cards: "$120k–$150k",
// "From $120k", or "Up to $150k". Returns "" when there is nothing to show.
export function formatSalary(min, max) {
  const k = (n) => `$${Math.round(n / 1000)}k`;
  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;
  if (hasMin && hasMax) return `${k(min)}–${k(max)}`;
  if (hasMin) return `From ${k(min)}`;
  if (hasMax) return `Up to ${k(max)}`;
  return "";
}
