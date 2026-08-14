// ---------------------------------------------------------------------------
// Parses Gemini's response for the AI job-search ingest source, and decides
// whether a fetched page actually reads like a single job posting.
//
// Gemini's googleSearch tool is incompatible with responseMimeType:json (see
// the comment on parseArticles in app/api/company-research/route.js), so the
// model returns prose wrapped around a JSON block and must be parsed
// defensively — never trust it to be valid, well-formed JSON on its own.
// ---------------------------------------------------------------------------

/**
 * Pull job postings out of a model text response that may be prose wrapped
 * around a fenced (or bare) JSON block. Accepts either a bare array or a
 * `{postings:[...]}` envelope. Returns [] rather than throwing on anything
 * unparseable.
 *
 * The model's own `description` field, if present, is intentionally dropped
 * here and never carried forward under any name — see lib/feed/llmSearch.js,
 * which takes the description from the FETCHED page instead. That is the
 * single most dangerous field to trust: it is what a résumé gets tailored
 * against.
 */
export function parsePostings(rawText) {
  const text = String(rawText || "");
  const candidates = [];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) candidates.push(arrMatch[0]);

  for (const raw of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // try the next candidate
    }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.postings)
        ? parsed.postings
        : null;
    if (!list) continue;

    return list
      .map((p) => ({
        title: String(p?.title || "").trim(),
        company: String(p?.company || "").trim(),
        location: String(p?.location || "").trim(),
        url: String(p?.url || "").trim(),
        employmentType: String(p?.employmentType || "").trim(),
        postedText: String(p?.postedText || "").trim(),
      }))
      .filter((p) => p.title && p.url);
  }
  return [];
}

// Marker phrases that show up in a genuine single-posting page but not in a
// careers index, a 404 body, or an unrelated article.
const POSTING_MARKERS = [
  "responsibilities",
  "qualifications",
  "requirements",
  "benefits",
  "what you'll do",
  "experience",
];

// Below this many characters nothing can plausibly be a real posting body,
// even one that happens to contain a marker word (e.g. "Benefits: PTO.").
// Chosen well above the shortest realistic marker-carrying fixture and well
// below any genuine single-posting page, which runs to several paragraphs.
const MIN_POSTING_LENGTH = 200;

// A careers INDEX page (a board listing dozens of openings) is long and
// frequently mentions a marker word in its own chrome ("Filter by ...
// requirements"), so length + marker alone false-positive on it. The
// distinguishing shape is repetition: an index page is built from many
// near-identical, short "title — location — action" list rows, where a
// genuine single posting is prose. Count rows shaped like that; past the
// threshold, treat it as an index rather than a posting.
const INDEX_LIST_LINE_RE = /^.{2,60}—.{2,40}—.{2,40}$/;
const INDEX_LIST_LINE_THRESHOLD = 5;

function looksLikeIndexPage(text) {
  let listLines = 0;
  for (const line of text.split("\n")) {
    if (INDEX_LIST_LINE_RE.test(line.trim())) listLines += 1;
  }
  return listLines > INDEX_LIST_LINE_THRESHOLD;
}

/**
 * Whether a fetched page reads like an individual job posting, as opposed to
 * an unreadable fetch, a too-short stub, an unrelated long page, or a careers
 * index page listing many openings.
 */
export function looksLikeJobPosting(scraped) {
  if (!scraped || typeof scraped !== "object" || scraped.error) return false;

  const description = String(scraped.description || "");
  if (description.length < MIN_POSTING_LENGTH) return false;
  if (looksLikeIndexPage(description)) return false;

  const lower = description.toLowerCase();
  return POSTING_MARKERS.some((marker) => lower.includes(marker));
}
