// Deterministic, offline best-effort extraction of a job title and company name
// from a raw posting. Used to name the generated .docx
// ("<Company> - <Position> - Resume.docx") and to seed the cover letter when no
// structured title/company is available (e.g. the manual paste flow, where the
// embedded engine only receives posting text).
//
// Tuned for the app's normalized job-card shape:
//   Subject Matter Expert Course Design - LE3 Program   <- title
//   National Louis University in Online/Remote           <- "Company in Location"
//   Type: Adjunct/Part-Time                              <- metadata label (ignored)
//   Posted: 1 day ago
// with fallbacks for "Title at Company" and explicit "Company:" / "Title:" labels.
// Heuristics only fire on short, heading-like lines so a plain prose description
// (no header) yields empty rather than a wrong guess.

// Metadata label lines that are never a title or company.
const LABEL_LINE =
  /^(type|posted|category|location|locations|salary|compensation|pay|job type|employment type|schedule|department|division|industry|seniority|experience|apply|overview|summary|about|responsibilities|qualifications|requirements|req(?:uisition)?\s*(?:id|no|#)?)\b\s*[:\-—]/i;

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// A line short enough and punctuation-light enough to be a heading (title or
// company) rather than a sentence of prose.
function looksLikeHeading(line) {
  return line.length > 0 && line.length <= 90 && !/[.!?]$/.test(line);
}

// Drop a trailing location off a company line:
//   "National Louis University in Online/Remote" -> "National Louis University"
//   "Acme, Inc. — New York, NY"                  -> "Acme, Inc."
// Only splits on " in " or bullet/pipe/dash separators (not a bare hyphen, which
// is common inside company and title text).
function stripLocation(line) {
  const m = line.match(/^(.*?)(?:\s+in\s+|\s*[•·|]\s*|\s+[—–]\s+)\S.*$/i);
  return m ? m[1].trim() : line;
}

export function extractPostingMeta(posting) {
  const lines = String(posting || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  let jobTitle = "";
  let companyName = "";

  // 1) Explicit labels anywhere win (most reliable).
  for (const line of lines) {
    if (!jobTitle) {
      const t = line.match(/^(?:job\s*)?(?:title|position|role)\s*[:\-]\s*(.+)$/i);
      if (t) jobTitle = t[1].trim();
    }
    if (!companyName) {
      const c = line.match(
        /^(?:company|employer|organization|organisation|hiring\s*organization)(?:\s*name)?\s*[:\-]\s*(.+)$/i,
      );
      if (c) companyName = stripLocation(c[1].trim());
    }
  }

  // Heading candidates = non-metadata, heading-shaped lines, in order.
  const headings = lines.filter((l) => !LABEL_LINE.test(l) && looksLikeHeading(l));

  // 2) "<Title> at <Company>" on the first heading line.
  if ((!jobTitle || !companyName) && headings[0]) {
    const m = headings[0].match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (m) {
      if (!jobTitle) jobTitle = m[1].trim();
      if (!companyName) companyName = stripLocation(m[2].trim());
    }
  }

  // 3) Normalized card: first heading is the title, second is the company
  //    (commonly "Company in Location").
  if (!jobTitle && headings[0]) jobTitle = headings[0];
  if (!companyName && headings[1] && headings[1] !== jobTitle) {
    companyName = stripLocation(headings[1]);
  }

  return { jobTitle: jobTitle || "", companyName: companyName || "" };
}
