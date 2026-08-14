// ---------------------------------------------------------------------------
// The AI job-search ingest source: Gemini + Google Search grounding discovers
// candidate postings, and every one is verified by fetching its page before
// it is allowed anywhere near feed_postings.
//
// The governing rule for this whole module: nothing the model says is
// trusted except a URL, and even the URL is only trusted once we have
// fetched it ourselves. In particular the stored job description ALWAYS
// comes from the fetched page, never from the model — that description is
// what a résumé gets tailored against, so a fabricated one produces a résumé
// tailored to a job that does not exist. The one recorded exception is
// `location` (and the `remote_type` derived from it): display metadata that
// never reaches a tailoring prompt, and one a fetched page frequently states
// nowhere parseable.
// ---------------------------------------------------------------------------

import { extractGroundingSources, isGroundedHost } from "@/lib/llm/grounding";
import { canonicalPostingUrl } from "@/lib/feed/canonicalUrl";
import { parsePostings, looksLikeJobPosting } from "@/lib/feed/llmSearchParse";
import {
  matchesNoExcludedTitleKeywords,
  matchesNoExcludedCompany,
} from "@/lib/feed/selectQueueCandidates";
import { snippetFrom, remoteTypeFor, extractMinYearsRequired } from "@/lib/feed/normalize";
import { parseSalary } from "@/lib/feed/salary";

// How many candidate pages a single query may fetch when no caller-supplied
// budget is given. This is a per-query safety net, independent of the
// run-level budget lib/feed/ingestFeed.js enforces across every query due in
// a run — see the comment there for why that second, coarser cap exists.
const DEFAULT_MAX_POSTINGS = 10;

function buildPrompt(query) {
  const excludedTitles = Array.isArray(query?.excludedTitleKeywords) ? query.excludedTitleKeywords : [];
  const excludedCompanies = Array.isArray(query?.excludedCompanies) ? query.excludedCompanies : [];
  return [
    "You are a job search assistant. Using Google Search, find real, currently open job postings that match this request:",
    String(query?.query || ""),
    excludedTitles.length ? `Exclude roles whose title contains any of: ${excludedTitles.join(", ")}.` : "",
    excludedCompanies.length ? `Exclude postings from these companies: ${excludedCompanies.join(", ")}.` : "",
    "",
    "For each posting return:",
    "- title: the job title",
    "- company: the hiring company",
    '- location: the posting\'s stated location (e.g. "Remote", "Austin, TX", "Remote - US")',
    "- url: the direct URL to the posting itself (not a search results page or a careers homepage)",
    '- employmentType: e.g. "Full-time", "Contract" (leave blank if unknown)',
    "- postedText: whatever the page says about when it was posted (leave blank if unknown)",
    "",
    'Output ONLY a JSON object: {"postings": [ {"title":"","company":"","location":"","url":"","employmentType":"","postedText":""} ]}. Find up to 15 DISTINCT postings. No commentary outside the JSON.',
  ]
    .filter(Boolean)
    .join("\n");
}

// A small, dependency-free stable hash (FNV-1a, 32-bit) used only to build a
// short deterministic id from a URL — nothing security-sensitive, so nothing
// stronger is needed. Must be stable across runs: the same posting seen
// twice has to produce the same source_posting_id, or dedupe downstream
// (selectQueueCandidates, applications) breaks.
function stableHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Run one grounded search query end to end: ask Gemini, drop anything not
 * backed by grounding metadata, apply the saved search's exclusions, cap the
 * survivor count, then fetch and verify each one before it becomes a row.
 *
 * @returns {Promise<{ok:boolean, label:string, postings:object[], error:?string}>}
 *   the exact shape lib/feed/ingestFeed.js's runSource() consumes.
 */
export async function fetchLlmSearchPostings({
  query,
  client,
  model,
  fetchUrl,
  maxPostings = DEFAULT_MAX_POSTINGS,
}) {
  // runSource attributes failures via r.label; without one every AI-search
  // failure would report as `source: undefined` in sourceHealth.
  const label = `ai_search:${query?.key || "unknown"}`;

  let response;
  try {
    response = await client.models.generateContent({
      model,
      contents: buildPrompt(query),
      tools: [{ googleSearch: {} }],
    });
  } catch (err) {
    // A model failure must never throw — one bad query can't be allowed to
    // abort the whole ingest run.
    return { ok: false, label, postings: [], error: String(err?.message || err) };
  }

  const grounded = extractGroundingSources(response);
  const candidates = parsePostings(response?.text || "");

  // Drop anything the model didn't actually ground on. Empty grounding means
  // false for every candidate (see isGroundedHost) — no grounding is no
  // evidence the model searched at all.
  const groundedCandidates = candidates.filter((c) => isGroundedHost(c.url, grounded));

  const excludedTitleLower = Array.isArray(query?.excludedTitleKeywords) ? query.excludedTitleKeywords : [];
  const excludedCompaniesLower = Array.isArray(query?.excludedCompanies) ? query.excludedCompanies : [];
  const filtered = groundedCandidates.filter(
    (c) =>
      matchesNoExcludedTitleKeywords(c, excludedTitleLower) &&
      matchesNoExcludedCompany(c, excludedCompaniesLower),
  );

  const capped = filtered.slice(0, Math.max(0, maxPostings));

  const postings = [];
  for (const candidate of capped) {
    let scraped;
    try {
      scraped = await fetchUrl(candidate.url);
    } catch (err) {
      scraped = { error: String(err?.message || err) };
    }
    // An unverifiable result is a normal outcome, not a source failure — the
    // run itself still succeeded even if nothing survives verification.
    if (!scraped || scraped.error) continue;
    if (!looksLikeJobPosting(scraped)) continue;

    const finalUrl = scraped.finalUrl || candidate.url;
    const canonicalUrl = canonicalPostingUrl(finalUrl);
    if (!canonicalUrl) continue; // can't dedupe or safely queue a row with no usable link

    // The fetched text is the ONLY source for the description, the salary
    // parse, and the years-required parse — never the model's own fields.
    const fetchedText = scraped.description || "";
    const salary = parseSalary(fetchedText);

    postings.push({
      source: "ai_search",
      dedup_key: `ai_search:${canonicalUrl}`,
      // Without a stable external id this row can never be picked up by
      // selectQueueCandidates or tailorAndQueueOne — see the CORRECTIONS
      // section of the AC this module was built from.
      source_posting_id: `ai-${stableHash(canonicalUrl)}`,
      title: candidate.title || null,
      company: candidate.company || null,
      // Recorded carve-out (see module header): location/remote_type are the
      // one field trusted from the model, because they're display metadata
      // that never reaches a tailoring prompt.
      location: candidate.location || null,
      remote_type: remoteTypeFor(candidate.location),
      employment_type: candidate.employmentType || null,
      salary_min: salary.min,
      salary_max: salary.max,
      description_snippet: snippetFrom(fetchedText),
      min_years_required: extractMinYearsRequired(fetchedText),
      url: finalUrl,
      tags: [],
      posted_at: scraped.publishedDate || null,
      // Only the full description is kept here, matching every other feed
      // adapter (see normalizeGreenhousePosting in ingestFeed.js) — every
      // other field duplicates a normalized column already on the row.
      raw_data: { description: fetchedText },
    });
  }

  return { ok: true, label, postings, error: null };
}

/**
 * Pure cadence check: is the AI-search source due to run again?
 *
 * `lastRunAt` may be a number (epoch ms) or an ISO string — Redis round-trips
 * it either way depending on serialization — and an unusable or missing
 * value always means "due", never "stalled forever". A future/clock-skewed
 * timestamp is also treated as due rather than as "not due yet", so a bad
 * value written once can't permanently lock the source out.
 */
export function shouldRunLlmSearch({ lastRunAt, now, intervalMinutes }) {
  if (lastRunAt == null) return true; // never run before

  let lastMs;
  if (typeof lastRunAt === "number") {
    lastMs = lastRunAt;
  } else if (typeof lastRunAt === "string") {
    lastMs = Date.parse(lastRunAt);
  } else {
    lastMs = NaN; // not a usable timestamp shape at all
  }

  const nowMs = Number(now);
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return true;

  const elapsedMs = nowMs - lastMs;
  if (elapsedMs < 0) return true; // future timestamp — due, not locked out

  const intervalMs = Math.max(0, Number(intervalMinutes) || 0) * 60_000;
  return elapsedMs >= intervalMs;
}
