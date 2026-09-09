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
// The alternation is held as a string so the anchored TITLE_KEYWORDS_RE below
// can be built from the SAME vocabulary rather than a second copy of it — a
// re-typed job-noun list one module over is exactly what drifts.
const TITLE_KEYWORDS_BODY =
  "engineer|developer|manager|director|analyst|designer|scientist|consultant|intern(?:ship)?|lead|architect|administrator|specialist|coordinator|associate|officer|president|founder|owner|technician|teacher|professor|instructor|nurse|accountant|recruiter|strategist|marketer|writer|editor|producer|supervisor|representative|clerk|assistant|advisor|adviser|principal|head|vp|cto|ceo|cfo|coo|programmer|administrative|operations|sales|support";
// The vocabulary, WORD-ANCHORED, for asking "does this text NAME a job?".
//
// There used to be an unanchored twin beside this, and parseHeader used it to
// pick the title on the stated grounds that a substring match was good enough
// "inside an already-parsed segment". That justification was wrong and is
// deleted with it: unanchored, `intern` matches inside "International", so the
// header
//     Northwind International
//     Senior Engineer
//     2019 - 2022
// reported the COMPANY as the job title. The same substring hazard misreads
// "Overhead" as `head` and "Headcount" as `Head`. Anchored is correct for both
// questions this module asks, so there is now one regex and no choice to get
// wrong.
//
// The `(?:s|ing)?` tail is load-bearing, not decoration: a bare \b…\b would
// stop matching *Engineering*, *Engineers*, *Managers* and *Designers* — the
// ordinary plural and gerund forms of the same nouns — and would cost real
// employment headers. Exported for lib/copilot/materialQuote.js, which owns
// the header predicate and deliberately declares no vocabulary of its own.
export const TITLE_KEYWORDS_RE = new RegExp(`\\b(?:${TITLE_KEYWORDS_BODY})(?:s|ing)?\\b`, "i");

// A single date token sitting at the END of a line, set off from the text in
// front of it the way a résumé header sets one off: a pipe, an opening bracket,
// a comma/semicolon/colon, a tab, an en/em dash surrounded by spaces, or a run
// of two or more spaces. A trailing bracket is allowed to close it.
//
// This is the SAME DATE_TOKEN / PRESENT vocabulary as DATE_RANGE_RE above — no
// new date pattern is declared anywhere for it. It exists because a real header
// may carry one date rather than a range ("Backend Developer, Tyrell — 2020"),
// which no range regex can reach.
const TERMINAL_DATE_TOKEN_RE = new RegExp(
  `(?:[|(\\[,;:\\t]|\\s[–—]\\s|\\s{2,})\\s*(${DATE_TOKEN}|${PRESENT})\\s*[)\\]]?\\s*$`,
  "i",
);

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

// WHERE a line's date sits, as CHARACTER OFFSETS into that line — the thing
// extractDateRange above deliberately does not report, because its five
// callers all want the date STRINGS and nothing else.
//
// Why this is a separate export rather than a widened return. A caller asking
// "is the date TERMINAL?" has to slice the line around the date, and
// extractDateRange's shape cannot answer that: it carries no `index`, and its
// `end` is a STRING. `line.slice(range.end)` therefore coerces via
// ToIntegerOrInfinity — "2021" becomes the integer 2021, which is past the end
// of any ordinary line, so the slice silently returns "" and a "the date is
// terminal" test passes for free on every bare-year end date; "Present"
// becomes NaN -> 0 and the same slice returns the WHOLE line. Both readings
// are nonsense and neither fails loudly, so the offsets are exported instead
// of being recovered by the caller.
//
// Returns { start, end, matched, via } or null. `via` is "range" when
// DATE_RANGE_RE found it and "token" when the terminal single-date branch did,
// so a caller reasoning about terminality knows which rule applied.
//
// A RESIDUAL, recorded rather than hidden: when a line carries TWO date
// ranges, the leftmost is located, so "the date is terminal" is judged against
// the wrong one. DATE_RANGE_RE is non-global, so `match` returns the leftmost
// occurrence and `m.index` is exact.
export function headerDateSpan(line) {
  const s = String(line == null ? "" : line);
  if (!s.trim()) return null;

  const range = s.match(DATE_RANGE_RE);
  if (range && typeof range.index === "number") {
    return { start: range.index, end: range.index + range[0].length, matched: range[0], via: "range" };
  }

  const token = s.match(TERMINAL_DATE_TOKEN_RE);
  if (token && typeof token.index === "number") {
    // The capture is the date itself; the match also spans its set-off
    // punctuation and any closing bracket, so locate the capture inside it
    // rather than reporting the wider match as the date.
    const start = s.indexOf(token[1], token.index);
    if (start < 0) return null;
    return { start, end: start + token[1].length, matched: token[1], via: "token" };
  }

  return null;
}

function isLongProse(line) {
  const trimmed = line.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 8 || /[.!?]$/.test(trimmed);
}

// Does a line that CARRIES A DATE open an employment entry, or is it merely a
// sentence that mentions when something happened?
//
// Every dated line used to open one, which is how
//   "At Northwind I led the payments migration from 2019 - 2022, cutting
//    deployment time by 40%."
// became an employment entry -- and, with the salutation above it in the header
// buffer, an entry at the WRONG company entirely.
//
// The discriminator is sentence-final punctuation, with one exception that
// matters: a date-first header can legitimately end in a legal suffix
// ("2019 - 2022 | Senior Engineer, Northwind Inc."), so a line that ends in a
// period is still a header when it NAMES A JOB. `isLongProse`'s word-count arm
// is deliberately NOT used here -- a real header runs long ("Senior Staff
// Software Engineer, Developer Platform and Release Infrastructure, Northwind
// International Logistics Holdings Limited" is 14 words before its date) and
// gating on length would throw away exactly the headers this parser exists for.
function opensEntry(line) {
  const trimmed = String(line).trim();
  if (!/[.!?]$/.test(trimmed)) return true;
  return TITLE_KEYWORDS_RE.test(trimmed);
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
  const titleIdx = parts.findIndex((p) => TITLE_KEYWORDS_RE.test(p));
  if (titleIdx >= 0) {
    title = parts[titleIdx];
    // The employer is the first remaining part that does NOT itself name a job.
    //
    // Taking the first remaining part outright was a real defect: a header very
    // commonly reads "Title, Department, Company", so that part is the
    // DEPARTMENT, and callers go on to state it as the employer -- measured on
    // the longHeadline corpus material, 24 practice cells told the candidate to
    // say "I was at Developer Platform and Release Infrastructure" when the
    // employer was Northwind. Saying a false employer out loud is the worst
    // error this product can make; the interviewer is the one person certain to
    // know better.
    //
    // TITLE_KEYWORDS_RE, not TITLE_KEYWORDS, and the difference is load-bearing
    // in BOTH directions. Anchored, it rejects "Developer Platform and Release
    // Infrastructure" (a whole-word `Developer`) while keeping "Overhead Door
    // Company", which the unanchored form would throw away for the `head` inside
    // "Overhead" -- costing a candidate a real employer. The unanchored form is
    // still correct for titleIdx above, which asks "does a job word occur in
    // here?" rather than "does this NAME a job?".
    //
    // When every remaining part names a job, the header carries no employer, so
    // company stays "". That is deliberate: roleClause then omits the employer
    // clause entirely, and naming nothing is strictly better than naming a team.
    const rest = parts.filter((_, i) => i !== titleIdx);
    company = rest.find((p) => !TITLE_KEYWORDS_RE.test(p)) || "";
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
  // BLANK LINES ARE KEPT ON PURPOSE. They used to be filtered out here, which
  // silently made every line adjacent to every other: a salutation three
  // paragraphs above a dated sentence landed in that sentence's header buffer,
  // and a cover letter parsed as employment at the company being APPLIED TO.
  // A blank line is the one reliable block separator both resumes and letters
  // actually use, so the loop below treats it as the end of a header block.
  const lines = sliceExperienceSection(toLines(input)).map((l) => l.trim());

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
    // A blank line ends the current header block. Without this, unrelated lines
    // separated by whole paragraphs are absorbed into the next dated line's
    // header. `current` is deliberately left alone: a bullet list may be broken
    // by a blank and still belong to the entry above it.
    if (!line) {
      headerBuffer = [];
      continue;
    }

    if (BULLET_RE.test(line)) {
      if (current) current.notes.push(line.replace(BULLET_RE, "").trim());
      continue;
    }

    const range = extractDateRange(line);
    if (range && opensEntry(line)) {
      headerBuffer.push(line);
      flushEntry(range);
      continue;
    }
    if (range) {
      // A dated SENTENCE. It is never header material -- at most it is a note on
      // the entry already open.
      if (current) current.notes.push(line);
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
