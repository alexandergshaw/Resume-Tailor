// Non-AI screenshot reader: OCR the image with Tesseract.js, then derive the
// job title / company with the same deterministic parser the tailor route uses.
// Returns the same shape as the AI vision reader so the endpoint can swap them.

import { extractPostingMeta } from "@/lib/llm/postingMeta";

// One worker, reused across requests — creating it downloads the wasm core and
// English language data, which we only want to pay once.
let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng");
    })().catch((err) => {
      workerPromise = null; // let the next call retry a fresh worker
      throw err;
    });
  }
  return workerPromise;
}

// Plain-text OCR of an image buffer. Exposed for testing/seam injection.
export async function ocrImage(buffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);
  return String(data?.text || "").trim();
}

// Site chrome / UI text that OCR picks up from a screenshot but isn't part of
// the posting (nav, buttons, "3 days ago", etc.). Used to skip junk lines so we
// don't mistake "Jobs Home Sign in" for the job title.
const CHROME_RE =
  /^(home|jobs?|sign[ -]?in|log[ -]?in|menu|search|apply( now)?|save[d]?|share|back|next|previous|filter|sort|view all|see all|show more|read more|about|benefits|overview|posted|new|featured|easy apply|skip to|cookies?|accept|settings|notifications?|messages?|profile|my jobs|follow|report job|remote|hybrid|on-?site|full[- ]?time|part[- ]?time|contract|temporary|internship)\b/i;
const TIME_AGO_RE = /\b\d+\+?\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/i;
const ROLE_RE =
  /\b(engineer|engineering|developer|programmer|manager|designer|scientist|analyst|director|lead|architect|consultant|specialist|coordinator|administrator|intern|associate|officer|nurse|teacher|professor|instructor|lecturer|recruiter|accountant|attorney|counsel|marketer|strategist|researcher|technician|operator|representative|advisor|adviser|president|head of|chief|principal|staff|founder|writer|editor|producer|controller|auditor|paralegal|therapist|physician|pharmacist|counselor|supervisor|machinist|electrician|driver|chef|clerk|assistant|fellow|agent)\b/i;

export function isChromeLine(line) {
  const raw = String(line || "").trim();
  // Drop leading icons/bullets (★ ☆ • · | ❤) so "☆ Save Share" is still caught.
  const l = raw.replace(/^[^A-Za-z0-9]+/, "");
  if (!l) return true;
  return CHROME_RE.test(l) || TIME_AGO_RE.test(l) || /https?:\/\/|@/.test(raw) || /^[^A-Za-z]+$/.test(raw);
}

export function ocrLines(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
}

// Best guess at the role title from OCR lines: prefer a line with a role keyword,
// else the first reasonable mixed-case line that isn't site chrome.
function bestRoleLine(lines) {
  const cands = lines.filter((l) => l.length >= 6 && l.length <= 90 && /[a-zA-Z]/.test(l) && !isChromeLine(l));
  return (
    cands.find((l) => ROLE_RE.test(l)) ||
    cands.find((l) => l.length >= 10 && /[a-z]/.test(l) && /[A-Z]/.test(l)) ||
    cands[0] ||
    ""
  );
}

// Conservative company guess: an "at <Company>" mention, or a short proper-noun
// line right next to the title. Empty when unsure (better than a wrong name).
function guessCompany(lines, title) {
  for (const l of lines) {
    const m = l.match(/\bat\s+([A-Z][\w&.\-]+(?:\s+[A-Z][\w&.\-]+){0,3})\b/);
    if (m) {
      const c = m[1].trim();
      if (!isChromeLine(c) && !ROLE_RE.test(c)) return c;
    }
  }
  const ti = lines.indexOf(title);
  if (ti < 0) return "";
  // "Company · Location · 2 days ago" line right under the title (LinkedIn /
  // Indeed / Glassdoor). Take the segment before the first separator.
  for (const raw of [lines[ti + 1], lines[ti + 2], lines[ti - 1]]) {
    if (!raw) continue;
    const m = raw.match(/^([A-Z][\w&.\-]+(?:[ &][\w.\-]+){0,3})\s*[·•|]\s+\S/);
    if (m) {
      const c = m[1].trim();
      if (!isChromeLine(c) && !ROLE_RE.test(c)) return c;
    }
  }
  // Otherwise a short proper-noun line right next to the title.
  for (const l of [lines[ti + 1], lines[ti - 1], lines[ti + 2], lines[ti - 2]]) {
    if (!l) continue;
    const words = l.split(/\s+/);
    if (
      words.length <= 3 &&
      l.length >= 2 &&
      l.length <= 30 &&
      /^[A-Z]/.test(l) &&
      /[a-z]/.test(l) &&
      !isChromeLine(l) &&
      !ROLE_RE.test(l) &&
      !/[.!?,:;]$/.test(l)
    ) {
      return l;
    }
  }
  return "";
}

// "City, ST" (best signal for URL search — disambiguates same-named employers)
// and remote/hybrid work-mode markers. City must look like a proper noun and
// the state must be a real USPS code, so "Inc, CA" noise doesn't match.
const US_STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC";
const STATE_SET = new Set(US_STATES.split(" "));
const CITY_STATE_RE = /\b([A-Z][a-z]+(?:[ .-][A-Z][a-z]+){0,3}),\s*([A-Z]{2})\b/;
const REMOTE_RE = /\b(remote|hybrid|work from home|wfh)\b/i;

// Best-effort location from OCR lines, preferring lines near the title (job
// boards put "Company · City, ST · 2 days ago" right under it). Returns
// "City, ST", else "Remote" when only a work-mode marker is present, else "".
export function extractLocation(lines, title) {
  const ti = lines.indexOf(title);
  const near = ti >= 0 ? [lines[ti], lines[ti + 1], lines[ti + 2], lines[ti - 1]].filter(Boolean) : [];
  const ordered = [...near, ...lines];
  for (const l of ordered) {
    const m = l.match(CITY_STATE_RE);
    if (m && STATE_SET.has(m[2])) return `${m[1]}, ${m[2]}`;
  }
  for (const l of ordered) {
    if (REMOTE_RE.test(l)) return "Remote";
  }
  return "";
}

// Derive the reader contract from already-extracted OCR text (e.g. OCR done in
// the browser): { jobTitle, company, location, postingText, searchQuery }.
// extractPostingMeta is tuned for clean pasted postings and tends to latch onto
// nav chrome on screenshots, so we layer OCR-aware title/company picking on top.
export function fieldsFromText(text) {
  const body = String(text || "");
  const meta = extractPostingMeta(body);
  const lines = ocrLines(body);
  const roleLine = bestRoleLine(lines);

  let jobTitle = meta.jobTitle || "";
  if (!jobTitle || isChromeLine(jobTitle)) {
    jobTitle = roleLine || jobTitle;
  } else if (!ROLE_RE.test(jobTitle) && roleLine && ROLE_RE.test(roleLine)) {
    // meta picked a non-role line (often the company name); prefer a clear role.
    jobTitle = roleLine;
  }

  let company = meta.companyName || "";
  if (!company || isChromeLine(company) || company === jobTitle) {
    company = guessCompany(lines, jobTitle) || (isChromeLine(company) ? "" : company);
  }

  // Location disambiguates same-named employers when searching for the live
  // posting URL (the vision path extracts it; now the OCR path does too).
  const location = extractLocation(lines, jobTitle);

  return {
    jobTitle: jobTitle || "",
    company: company || "",
    location,
    postingText: body,
    searchQuery: [jobTitle, company, location].filter(Boolean).join(" "),
  };
}

// Read a screenshot offline (server-side OCR) into the same reader contract.
export async function readScreenshotOffline(buffer, { ocr = ocrImage } = {}) {
  return fieldsFromText(await ocr(buffer));
}
