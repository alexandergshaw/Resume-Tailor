// Zero-cost company research — the embedded engine's alternative to the Gemini +
// grounded-search researcher. It finds recent articles about a company with a
// keyless web search (searchPostingUrls), reads each page (fetchUrlContent), and
// builds the same source-card shape from the scraped title/date and the first
// couple of sentences. Suggestions are templated (a sincere starting line the
// user personalizes) since there's no LLM to write the positive angle.

import { searchPostingUrls } from "@/lib/scrape/webSearch";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";

const WANT = 3;
const MAX_CANDIDATES = 8;
const SUMMARY_CHARS = 240;

// Hosts that aren't news: job boards, ATS, social, and search engines. We want
// press/coverage, and these either gate content or aren't articles.
const NON_NEWS_HOSTS = [
  "linkedin.com", "lnkd.in", "indeed.com", "glassdoor.com", "ziprecruiter.com",
  "monster.com", "simplyhired.com", "greenhouse.io", "lever.co", "ashbyhq.com",
  "myworkdayjobs.com", "workday.com", "smartrecruiters.com", "governmentjobs.com",
  "google.com", "bing.com", "duckduckgo.com", "youtube.com", "facebook.com",
  "twitter.com", "x.com", "reddit.com", "wikipedia.org",
];

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isNewsUrl(url) {
  const host = hostOf(url).toLowerCase();
  if (!host) return false;
  return !NON_NEWS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// First 1-2 sentences of a scraped page body, clamped, for the card summary.
export function firstSentences(text, maxChars = SUMMARY_CHARS, maxSentences = 2) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let out = "";
  for (const s of sentences.slice(0, maxSentences)) {
    if (out && (out + s).length > maxChars) break;
    out += s;
  }
  out = out.trim() || clean.slice(0, maxChars);
  return out.length > maxChars ? `${out.slice(0, maxChars).trim()}…` : out;
}

// A sincere first-person opener the user can drop into a cover letter and adjust.
export function suggestionFor({ company, title }) {
  const co = String(company || "").trim() || "your team";
  return title
    ? `I noticed ${co}'s recent news — "${title}" — and it's part of what draws me to this role.`
    : `I've been following ${co}'s recent progress, and it's part of what draws me to this role.`;
}

function card({ url, title, date, summary, company, idx }) {
  const source = hostOf(url);
  const finalTitle = title || source || "Article";
  return {
    id: `art-${idx}`,
    title: finalTitle,
    source,
    date: date || "",
    url,
    summary,
    suggestion: suggestionFor({ company, title: finalTitle }),
  };
}

function buildQueries({ company, jobTitle }) {
  const c = `"${company}"`;
  const queries = [
    `${c} (funding OR raises OR launch OR award OR expansion OR growth OR milestone OR hiring) news`,
    `${c} news`,
  ];
  if (jobTitle) queries.push(`${c} ${jobTitle}`);
  return queries;
}

function dedupe(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const url = String(u || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

// Company mode: search for recent coverage, read the pages, and assemble up to
// WANT cards. Dependencies are injectable for testing.
export async function researchCompanyLocal(
  { company, jobTitle = "" } = {},
  { searchImpl = searchPostingUrls, fetchImpl = fetchUrlContent, env = process.env } = {},
) {
  const co = String(company || "").trim();
  if (!co) return { articles: [], grounded: [], warnings: [] };

  let urls = [];
  for (const query of buildQueries({ company: co, jobTitle })) {
    try {
      const hits = await searchImpl({ query, limit: MAX_CANDIDATES, env });
      urls.push(...(Array.isArray(hits) ? hits : []));
    } catch {
      // try the next query
    }
    if (dedupe(urls).length >= MAX_CANDIDATES) break;
  }
  urls = dedupe(urls).filter(isNewsUrl).slice(0, MAX_CANDIDATES);

  const articles = [];
  for (const url of urls) {
    if (articles.length >= WANT) break;
    let scraped;
    try {
      scraped = await fetchImpl(url);
    } catch {
      scraped = { error: "unreadable" };
    }
    if (!scraped || scraped.error) continue;
    const summary = firstSentences(scraped.description);
    if (!summary) continue;
    articles.push(
      card({
        url: scraped.finalUrl || url,
        title: scraped.title || "",
        date: scraped.publishedDate || "",
        summary,
        company: co,
        idx: articles.length,
      }),
    );
  }

  const warnings =
    articles.length > 0
      ? ["Gathered by web search without AI — skim each source and personalize the suggestion before using it."]
      : [];
  return {
    articles,
    grounded: articles.map((a) => ({ uri: a.url, title: a.title })),
    warnings,
  };
}

// Custom-URL mode: read one pasted article into a single card. Returns an
// `{ error, status }` object when the page can't be read (no LLM fallback here).
export async function researchUrlLocal(
  { url, company = "" } = {},
  { fetchImpl = fetchUrlContent } = {},
) {
  let scraped;
  try {
    scraped = await fetchImpl(url);
  } catch {
    scraped = { error: "unreadable" };
  }
  if (!scraped || scraped.error) {
    return { error: `Couldn't read that URL (${scraped?.error || "unreadable"}).`, status: 502 };
  }
  const title = scraped.title || hostOf(url) || "Article";
  const summary = firstSentences(scraped.description);
  const article = card({
    url,
    title,
    date: scraped.publishedDate || "",
    summary,
    company,
    idx: 0,
  });
  return {
    articles: [article],
    grounded: [{ uri: url, title }],
    warnings: summary
      ? ["Summary was extracted from the page (no AI) — personalize the suggestion before using it."]
      : ["Added without a summary — write the summary and suggestion yourself."],
  };
}
