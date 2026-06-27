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

// A line short and punctuation-light enough to be a heading (title/company)
// rather than a sentence of prose.
function looksLikeHeading(line) {
  return line.length > 0 && line.length <= 90 && !/[.!?]$/.test(line);
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

// Scan line-by-line (never across line breaks) so an org name is matched within
// a single line; patterns are tried in priority order across all lines.
function findOrg(lines) {
  for (const re of ORG_PATTERNS) {
    for (const line of lines) {
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

  // Heading candidates = non-metadata, non-junk, heading-shaped lines, in order.
  const headings = lines.filter((l) => !LABEL_LINE.test(l) && !JUNK_LINE.test(l) && looksLikeHeading(l));

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

  return { jobTitle: jobTitle || "", companyName: companyName || "" };
}
