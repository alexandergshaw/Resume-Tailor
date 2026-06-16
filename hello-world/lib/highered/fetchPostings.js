// ---------------------------------------------------------------------------
// Higher-education RSS source adapter for the Live Feed.
//
// Parses standard RSS 2.0 <item> elements from higher-ed job feeds (Inside
// Higher Ed careers). No per-employer slug list — each feed is a keyword query.
// Items look like:
//   <title>Company Name: Job Title</title>
//   <description>...salary / blurb / location...</description>
//   <link>https://careers.insidehighered.com/job/3514461/.../</link>
//   <pubDate>Sat, 06 Jun 2026 00:00:00 -0500</pubDate>
//   <guid isPermaLink="true">...</guid>
//
// A deliberately small, dependency-free parser keeps this consistent with the
// rest of the codebase. One failing/garbled feed never aborts the run.
// ---------------------------------------------------------------------------

import {
  stripHtml,
  snippetFrom,
  remoteTypeFor,
  extractMinYearsRequired,
} from "@/lib/feed/normalize";
import { parseSalary } from "@/lib/feed/salary";

/** Pull the inner text of the first <tag>…</tag>, handling CDATA + entities. */
function tagText(itemXml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = itemXml.match(re);
  if (!m) return "";
  let inner = m[1];
  const cdata = inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) inner = cdata[1];
  return stripHtml(inner);
}

/** Best-effort job id from an Inside Higher Ed job URL: /job/3514461/... */
function jobIdFromUrl(url) {
  const m = (url || "").match(/\/job\/(\d+)/);
  return m ? m[1] : null;
}

/** Stable fallback id when no numeric job id is present in the link. */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/** Best-effort location: last non-empty line of the description block. */
function locationFromDescription(description) {
  const lines = description
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] || "";
  // Looks like "City, ST" or "City, State (US)" — keep short location-ish lines.
  if (last && last.length <= 80 && /[,(]/.test(last)) return last;
  return "";
}

function normalizeRssItem(itemXml, feedLabel) {
  const rawTitle = tagText(itemXml, "title");
  const description = tagText(itemXml, "description");
  const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
  const guidMatch = itemXml.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
  const url = stripHtml((linkMatch && linkMatch[1]) || (guidMatch && guidMatch[1]) || "");
  const pubDate = tagText(itemXml, "pubDate");

  // Title format is "Company: Role". Split on the first colon.
  let company = null;
  let title = rawTitle;
  const colon = rawTitle.indexOf(":");
  if (colon > 0) {
    company = rawTitle.slice(0, colon).trim();
    title = rawTitle.slice(colon + 1).trim();
  }

  const jobId = jobIdFromUrl(url);
  const sourcePostingId = `ihe-${jobId || hashString(url || rawTitle)}`;
  const location = locationFromDescription(description);
  const postedAt = pubDate ? new Date(pubDate).toISOString() : null;
  const salary = parseSalary(`${title} ${description}`);

  return {
    dedup_key: `highered:${sourcePostingId}`,
    source: "highered_rss",
    source_posting_id: sourcePostingId,
    title: title || null,
    company: company || null,
    location: location || null,
    remote_type: remoteTypeFor(location),
    employment_type: null,
    salary_min: salary.min,
    salary_max: salary.max,
    description_snippet: snippetFrom(description),
    min_years_required: extractMinYearsRequired(`${title} ${description}`),
    url: url || null,
    tags: feedLabel ? [feedLabel] : [],
    posted_at: Number.isNaN(Date.parse(postedAt)) ? null : postedAt,
    // Only the full description is kept here — every other field duplicates a
    // normalized column, so storing them would just bloat the row.
    raw_data: { description },
  };
}

export async function fetchHigheredRssPostings(feed) {
  const { url, label } = feed || {};
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": "ResumeTailorFeedBot/1.0",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return { ok: false, postings: [], error: `HTTP ${res.status}`, label: label || url };
    }
    const xml = await res.text();
    const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    const postings = itemMatches
      .map((item) => normalizeRssItem(item, label))
      .filter((p) => p.url && p.title);
    return { ok: true, postings, error: null, label: label || url };
  } catch (err) {
    return { ok: false, postings: [], error: String(err?.message || err), label: label || url };
  }
}
