// ---------------------------------------------------------------------------
// Heuristic, LLM-free extraction of employment history from résumé text.
//
// Résumé formats vary wildly, so this is deliberately best-effort: it locates
// an experience/employment section, anchors each entry on a date range, and
// splits the surrounding header text into company / title / location. The
// fields stay editable in the UI, so the goal is to save typing, not to be
// perfect. Pure (no DOM / no I/O) so it is easy to unit-test.
// ---------------------------------------------------------------------------

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// A single date token: "Jan 2020", "January 2020", "01/2020", "2020".
const DATE_TOKEN = `(?:${MONTH}\\.?\\s*'?\\d{2,4}|\\d{1,2}[/.\\-]\\d{4}|\\d{4})`;
const PRESENT = "(?:present|current|now|to\\s*date|ongoing|today)";

// A start–end range. Accepts hyphen, en/em dash, "to", or "until" separators.
const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:-|–|—|to|until|through)\\s*(${DATE_TOKEN}|${PRESENT})`,
  "i",
);

const PRESENT_RE = new RegExp(`^${PRESENT}$`, "i");

// "City, ST", "City, State 12345", or a remote/hybrid keyword.
const LOCATION_RE =
  /\b([A-Z][A-Za-z.'\- ]+,\s*[A-Z]{2}\b(?:\s*\d{5})?|Remote|Hybrid|On-?site)\b/;

// Words that strongly signal a job title (used to disambiguate title vs company).
const TITLE_KEYWORDS =
  /(engineer|developer|manager|director|analyst|designer|scientist|consultant|intern(?:ship)?|lead|architect|administrator|specialist|coordinator|associate|officer|president|founder|owner|technician|teacher|professor|instructor|nurse|accountant|recruiter|strategist|marketer|writer|editor|producer|supervisor|representative|clerk|assistant|advisor|adviser|principal|head|vp|cto|ceo|cfo|coo|programmer|administrative|operations|sales|support)/i;

const SECTION_HEADING_RE =
  /^\s*(?:work\s+|professional\s+|relevant\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career(?:\s+history)?)\s*:?\s*$/i;
const OTHER_SECTION_RE =
  /^\s*(?:education|technical\s+skills|skills|projects?|certifications?|certificates?|awards?|honors?|publications?|interests?|references|summary|profile|objective|volunteer(?:ing)?|languages?|courses?|coursework|activities|achievements|affiliations|leadership)\s*:?\s*$/i;

const BULLET_RE = /^\s*[-*•▪◦‣·‐‑‒–—]\s+/;

function toLines(input) {
  const arr = Array.isArray(input)
    ? input.map((l) => String(l == null ? "" : l))
    : String(input == null ? "" : input).replace(/\r\n/g, "\n").split("\n");
  return arr.map((l) => l.split(String.fromCharCode(160)).join(String.fromCharCode(32)).replace(/\s+$/g, ""));
}

function tidyDate(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^([a-z])/, (c) => c.toUpperCase());
}

// Pull a {start, end} date range out of a line, normalizing "Present".
export function extractDateRange(line) {
  const m = String(line).match(DATE_RANGE_RE);
  if (!m) return null;
  const end = PRESENT_RE.test(m[2].trim()) ? "Present" : tidyDate(m[2]);
  return { start: tidyDate(m[1]), end, matched: m[0] };
}

function isLongProse(line) {
  const trimmed = line.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 8 || /[.!?]$/.test(trimmed);
}

// Restrict to the experience section when a recognizable heading is present;
// otherwise return all lines (best effort for heading-less résumés).
function sliceExperienceSection(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (SECTION_HEADING_RE.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return lines;
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (OTHER_SECTION_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

// Split the accumulated header lines (date already present) into company /
// title / location.
function parseHeader(headerLines) {
  // Drop the date, then split the header into segments on strong separators
  // (pipes, bullets, dashes, "at", "@"). Keeping segments lets us classify each
  // as location / title / company instead of guessing word boundaries.
  const raw = headerLines.map((l) => l.replace(DATE_RANGE_RE, " ")).join(" | ");
  const segments = raw
    .split(/\s*(?:\||•|·|—|–|\bat\b|@)\s*/i)
    .map((s) => s.replace(/\s+/g, " ").replace(/^[\s,\-–—]+|[\s,\-–—]+$/g, "").trim())
    .filter(Boolean);

  let location = "";
  const remaining = [];
  for (const seg of segments) {
    const lm = !location ? seg.match(LOCATION_RE) : null;
    if (lm) {
      location = lm[1].trim();
      const rest = seg
        .replace(LOCATION_RE, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s,\-]+|[\s,\-]+$/g, "")
        .trim();
      if (rest) remaining.push(rest);
    } else {
      remaining.push(seg);
    }
  }

  // A "Title, Company" segment is comma-separated; break those apart too.
  const parts = [];
  for (const seg of remaining) {
    for (const piece of seg.split(/,\s+/)) {
      const token = piece.trim();
      if (token) parts.push(token);
    }
  }

  let title = "";
  let company = "";
  const titleIdx = parts.findIndex((p) => TITLE_KEYWORDS.test(p));
  if (titleIdx >= 0) {
    title = parts[titleIdx];
    company = parts.filter((_, i) => i !== titleIdx)[0] || "";
  } else {
    [title = "", company = ""] = parts;
  }
  return { title, company, location };
}

/**
 * Parse résumé text (a string or array of lines) into employment entries.
 * @returns {Array<{company,title,location,startDate,endDate,notes}>}
 */
export function parseEmploymentHistory(input, { maxEntries = 4 } = {}) {
  const lines = sliceExperienceSection(toLines(input))
    .map((l) => l.trim())
    .filter(Boolean);

  const entries = [];
  let current = null;
  let headerBuffer = [];

  const flushEntry = (range) => {
    const { title, company, location } = parseHeader(headerBuffer);
    headerBuffer = [];
    if (!title && !company) {
      current = null;
      return;
    }
    current = {
      company,
      title,
      location,
      startDate: range.start,
      endDate: range.end,
      notes: [],
    };
    entries.push(current);
  };

  for (const line of lines) {
    if (BULLET_RE.test(line)) {
      if (current) current.notes.push(line.replace(BULLET_RE, "").trim());
      continue;
    }

    const range = extractDateRange(line);
    if (range) {
      headerBuffer.push(line);
      flushEntry(range);
      continue;
    }

    const prose = isLongProse(line);
    if (current && current.notes.length > 0 && !prose) {
      // A short, non-prose line after bullets starts the next entry's header.
      current = null;
      headerBuffer = [line];
    } else if (current && prose) {
      // A wrapped responsibility line without a bullet marker.
      current.notes.push(line);
    } else {
      headerBuffer.push(line);
      if (headerBuffer.length > 3) headerBuffer.shift();
    }
  }

  return entries.slice(0, maxEntries).map((entry) => ({
    company: entry.company,
    title: entry.title,
    location: entry.location,
    startDate: entry.startDate,
    endDate: entry.endDate,
    notes: entry.notes.join("\n").trim(),
  }));
}
