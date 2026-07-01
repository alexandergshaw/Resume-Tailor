// Deterministic, offline best-effort extraction of a job title and company name
// from a raw posting. Used to name the generated .docx
// ("<Company> - <Position> - Resume.docx") and to seed the cover letter when no
// structured title/company is available (e.g. the manual paste flow, or a URL
// the engine scraped to plain text).
//
// Real job pages are messy: the scraped text often starts with the browser
// <title> ("Role | Site Name") followed by navigation chrome ("Skip to main
// content", "Search Jobs", social links). We therefore, in priority order:
//   1. honor explicit labels — "Title: …", and the common "Working Title" /
//      "Job Title" / "Company" label-then-value-on-the-next-line layout;
//   2. detect an organization name (University / College / Inc / LLC / …) for
//      the company;
//   3. fall back to the first/second heading-shaped line, after stripping site
//      suffixes ("… | U-M Careers") and skipping navigation boilerplate.
// Heuristics only fire on short, heading-like lines so a plain prose description
// (no header) yields empty rather than a wrong guess.

// Section headers / metadata labels that are never a title or company value.
const LABEL_LINE =
  /^(type|posted|category|location|locations|salary|compensation|pay|job type|employment type|schedule|department|division|industry|seniority|experience|apply|overview|summary|about|responsibilities|qualifications|requirements|req(?:uisition)?\s*(?:id|no|#)?)\b\s*[:\-—]/i;

// Navigation / social / boilerplate lines from a scraped page — never a heading.
const JUNK_LINE = new RegExp(
  "^(?:" +
    [
      "skip to (?:main )?content",
      "(?:main )?navigation",
      "home", "search(?: jobs?)?", "benefits", "choose \\w+",
      "(?:temporary|student) employment", "career development",
      "help(?: and faq)?", "faq", "utility", "log\\s?in", "log\\s?out", "sign in", "sign out",
      "menu", "apply(?: now)?", "how to apply", "share", "print", "email",
      "twitter", "rss", "addthis", "facebook", "linkedin", "instagram", "youtube", "tiktok",
      "footer", "accessibility", "privacy(?: policy)?", "terms(?: of (?:use|service))?",
      "cookies?(?: policy)?", "careers(?: at .*)?", "u-?m careers",
      "back to (?:search|results)", "view all jobs", "all jobs", "job alerts?",
      "extended site maintenance",
    ].join("|") +
    ")$",
  "i",
);

// Title labels whose value is on the SAME line ("Title: …").
const TITLE_INLINE = /^(?:job\s*)?(?:title|position|role)\s*[:\-]\s*(.+)$/i;
const COMPANY_INLINE =
  /^(?:company|employer|organi[sz]ation|hiring\s*organi[sz]ation)(?:\s*name)?\s*[:\-]\s*(.+)$/i;

// Title labels whose value is on the NEXT line, in preference order ("Working
// Title" is the human-friendly title; "Job Title" is often an internal code).
const TITLE_BLOCK_LABELS = [
  /^working\s+title$/i,
  /^(?:job|position|posting)\s+title$/i,
  /^(?:position|role|title)$/i,
];
const COMPANY_BLOCK_LABEL = /^(?:company(?:\s+name)?|employer|organi[sz]ation|hiring\s+organi[sz]ation)$/i;

// Organization-name shapes, tried in order (the employer the posting names).
const ORG_PATTERNS = [
  // "University of Michigan", "University of Southern California" — stop before a
  // sub-unit ("… School of Information").
  /\bUniversity of [A-Z][a-z]+(?:\s(?!School\b|College\b|Department\b|Office\b|Division\b|Center\b|System\b|Health\b|Medical\b)[A-Z][a-z]+){0,2}/,
  // "Stanford University", "Bellevue College", "Acme Institute".
  /\b(?!(?:The|Our|A|An|This|Your)\b)[A-Z][A-Za-z.&''-]+(?:\s[A-Z][A-Za-z.&''-]+){0,3}\s(?:University|College|Institute|Academy|Polytechnic)\b/,
  // "Acme Inc.", "Globex Corporation", "Initech Technologies".
  /\b(?!(?:The|Our|A|An|This|Your)\b)[A-Z][A-Za-z.&''-]+(?:\s[A-Z][A-Za-z.&''-]+){0,3}\s(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Company|Technologies|Solutions|Systems|Group|Holdings|Laboratories|Labs|Healthcare|Bank|Partners)\b/,
];

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// ATS / job-board boilerplate that wraps the real role on a page <title> or
// heading ("Job Application for UX Engineer", "Apply for Staff Engineer",
// "Careers - Data Analyst"). Stripped so the title is just the role — host-
// agnostic (Greenhouse uses "Job Application for …", others "Apply for …" etc.).
// Phrase prefixes are safe to strip on their own (they never begin a real title).
const TITLE_PHRASE_PREFIX =
  /^(?:job application for|application for|apply (?:for|to)|now hiring|we(?:'re| are) hiring)\s+/i;
// Label prefixes only strip when followed by a separator, so a genuine title that
// merely starts with the word ("Hiring Manager", "Position Engineer") is untouched.
const TITLE_LABEL_PREFIX =
  /^(?:careers?|jobs?|job (?:posting|opening|req(?:uisition)?)|posting|position|role|vacancy|opportunity|hiring)\s*[:\-–—]\s*/i;

export function cleanPostingTitle(title) {
  let t = cleanLine(title);
  if (!t) return "";
  let prev;
  // Iterate so stacked prefixes collapse ("Careers: Job Application for X").
  do {
    prev = t;
    t = t.replace(TITLE_PHRASE_PREFIX, "").replace(TITLE_LABEL_PREFIX, "").trim();
  } while (t !== prev && t);
  return t || cleanLine(title);
}

// A line short and punctuation-light enough to be a heading (title/company)
// rather than a sentence of prose.
function looksLikeHeading(line) {
  return line.length > 0 && line.length <= 90 && !/[.!?]$/.test(line);
}

// Boilerplate ATS section headings (bare, no separator) — never a title or company.
// Distinct from LABEL_LINE (which needs a trailing ":"/"-"): these are standalone
// headings like "Job Description", "The Opportunity", "Responsibilities" that pollute
// the heading candidates and get mistaken for the role (the MassMutual bug).
const SECTION_HEADING_RE = new RegExp(
  "^(?:" +
    [
      "job description", "job summary", "position summary", "role summary",
      "the (?:opportunity|team|impact|role|mission|company|position)",
      "(?:role|position|company) overview", "overview", "summary",
      "about(?: us| the (?:role|team|company|position|opportunity|job))?",
      "who (?:you|we) are", "what (?:you'?ll (?:do|bring)|we offer|to expect)",
      "(?:key )?responsibilities", "duties(?: (?:and|&) responsibilities)?",
      "(?:key |minimum |basic |preferred |required |essential )?qualifications",
      "(?:minimum |basic |preferred |required )?requirements",
      "benefits", "perks(?: (?:and|&) benefits)?", "compensation", "salary(?: range)?",
      "how to apply", "equal opportunity employer", "description",
    ].join("|") +
    ")$",
  "i",
);

// A line that is ONLY employment/work-arrangement info ("Full-Time Hybrid (3
// days/week in office)") — never a title. Token-based so a real title that merely
// STARTS with such a word ("Temporary Computer Science Developer") is NOT skipped.
const EMPLOYMENT_WORDS = new Set([
  "full", "part", "time", "fulltime", "parttime", "hybrid", "remote", "onsite",
  "on", "site", "contract", "temporary", "permanent", "freelance", "seasonal",
  "days", "day", "week", "weekly", "office", "in", "per", "the",
]);
const EMPLOYMENT_CORE = new Set([
  "fulltime", "parttime", "hybrid", "remote", "onsite", "contract",
  "temporary", "permanent", "freelance", "seasonal", "full", "part", "time",
]);
function isEmploymentLine(line) {
  const tokens = String(line).toLowerCase().match(/[a-z0-9]+/g) || [];
  if (tokens.length === 0) return false;
  const hasCore = tokens.some((t) => EMPLOYMENT_CORE.has(t));
  return hasCore && tokens.every((t) => EMPLOYMENT_WORDS.has(t) || /^\d+$/.test(t));
}

// Strip a trailing site name off a scraped <title>: "Role | U-M Careers" -> "Role".
// Pipe / middot are almost always site separators; a dash is only treated as one
// when the trailing part actually names a careers site (so real titles like
// "… - LE3 Program" keep their suffix).
const SITE_WORD =
  /\b(careers?|jobs?|job board|hiring|talent|recruit(?:ing|ment)?|workday|greenhouse|lever|taleo|icims|smartrecruiters|opportunities)\b/i;
function stripSiteSuffix(title) {
  let t = title.replace(/\s*[|·]\s+.*$/, "").trim();
  t = t.replace(/\s+[-–—]\s+([^-–—]*)$/, (m, tail) => (SITE_WORD.test(tail) ? "" : m)).trim();
  return t || title;
}

// Drop a trailing location off a company line:
//   "National Louis University in Online/Remote" -> "National Louis University"
function stripLocation(line) {
  const m = line.match(/^(.*?)(?:\s+in\s+|\s*[•·|]\s*|\s+[—–]\s+)\S.*$/i);
  return m ? m[1].trim() : line;
}

// The first heading-shaped, non-junk line after a label line matching `labelRe`.
function valueAfterLabel(lines, labelRe) {
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!labelRe.test(lines[i].replace(/:\s*$/, ""))) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const v = lines[j];
      if (v && !JUNK_LINE.test(v) && !LABEL_LINE.test(v) && looksLikeHeading(v)) return v;
    }
  }
  return "";
}

// Scan line-by-line (never across line breaks) so an org name is matched within a
// single line. Lines are scanned in DOCUMENT ORDER — the employer is named at the
// top (title/header), while other orgs (a consortium, "About …" boilerplate, e.g.
// "Smith College … the University of Massachusetts Amherst") appear lower — so the
// first line that names any org wins; within a line, patterns try in priority order.
function findOrg(lines) {
  for (const line of lines) {
    for (const re of ORG_PATTERNS) {
      const m = line.match(re);
      if (m) return m[0].replace(/^The\s+/i, "").trim();
    }
  }
  return "";
}

export function extractPostingMeta(posting) {
  const lines = String(posting || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  let jobTitle = "";
  let companyName = "";

  // 1) Explicit same-line labels.
  for (const line of lines) {
    if (!jobTitle) {
      const t = line.match(TITLE_INLINE);
      if (t) jobTitle = stripSiteSuffix(t[1].trim());
    }
    if (!companyName) {
      const c = line.match(COMPANY_INLINE);
      if (c) companyName = stripLocation(c[1].trim());
    }
  }

  // 2) Label-then-next-line ("Working Title\n<value>"), in preference order.
  if (!jobTitle) {
    for (const labelRe of TITLE_BLOCK_LABELS) {
      const v = valueAfterLabel(lines, labelRe);
      if (v) {
        jobTitle = stripSiteSuffix(v);
        break;
      }
    }
  }
  if (!companyName) {
    const v = valueAfterLabel(lines, COMPANY_BLOCK_LABEL);
    if (v) companyName = stripLocation(v);
  }

  // Heading candidates = non-metadata, non-junk, non-boilerplate, heading-shaped
  // lines, in order. Bare section headings ("Job Description") and pure
  // employment-arrangement lines are excluded so they can't be mistaken for the role.
  const headings = lines.filter(
    (l) =>
      !LABEL_LINE.test(l) &&
      !JUNK_LINE.test(l) &&
      !SECTION_HEADING_RE.test(l) &&
      !isEmploymentLine(l) &&
      looksLikeHeading(l),
  );

  // 3) "<Title> at <Company>" on the first heading line.
  if ((!jobTitle || !companyName) && headings[0]) {
    const m = headings[0].match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (m) {
      if (!jobTitle) jobTitle = stripSiteSuffix(m[1].trim());
      if (!companyName) companyName = stripLocation(m[2].trim());
    }
  }

  // 4) An organization name the posting mentions (preferred over a guessed
  //    "second heading", which on a scraped page is usually navigation chrome).
  if (!companyName) companyName = findOrg(lines);

  // 5) Fall back to the first/second heading-shaped lines (the app's clean
  //    job-card shape: title, then "Company in Location").
  if (!jobTitle && headings[0]) jobTitle = stripSiteSuffix(headings[0]);
  if (!companyName && headings[1] && headings[1] !== jobTitle) {
    companyName = stripLocation(headings[1]);
  }

  return { jobTitle: cleanPostingTitle(jobTitle) || "", companyName: companyName || "" };
}
