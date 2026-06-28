// Deterministic (no-AI) lookup of a job posting's canonical URL by querying the
// public ATS board APIs directly. Given a company + role title, resolve the
// company to a Greenhouse/Lever/Ashby board (via the curated lists the feed
// already maintains, or a guessed slug) and title-match a posting on it.
//
// Returns the posting's own URL — the original source, never LinkedIn — or null.

import { GREENHOUSE_COMPANIES } from "@/lib/greenhouse/companies";
import { LEVER_COMPANIES } from "@/lib/lever/companies";
import { ASHBY_COMPANIES } from "@/lib/ashby/companies";

const MAX_BOARDS = 5;
const FETCH_TIMEOUT_MS = 8000;
// Known boards are trusted, so a moderate title overlap is enough; a guessed
// slug might be a different company's board, so demand a strong title match.
const KNOWN_THRESHOLD = 0.5;
const GUESSED_THRESHOLD = 0.75;

export function normalizeCompanyKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|ltd|corp|co|company|technologies|labs|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function titleTokens(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean),
  );
}

// Token overlap normalized by the shorter title.
export function titleMatchScore(a, b) {
  const at = titleTokens(a);
  const bt = titleTokens(b);
  if (at.size === 0 || bt.size === 0) return 0;
  let common = 0;
  for (const t of at) if (bt.has(t)) common += 1;
  return common / Math.min(at.size, bt.size);
}

// Curated boards whose company name (or slug) matches the target.
function knownBoardsFor(company) {
  const target = normalizeCompanyKey(company);
  if (!target) return [];
  const out = [];
  const scan = (list, ats) => {
    for (const c of list || []) {
      if (normalizeCompanyKey(c.name) === target || c.slug === target) {
        out.push({ ats, slug: c.slug, guessed: false });
      }
    }
  };
  scan(GREENHOUSE_COMPANIES, "greenhouse");
  scan(LEVER_COMPANIES, "lever");
  scan(ASHBY_COMPANIES, "ashby");
  return out;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Normalize each ATS board response to { title, url } postings.
async function fetchBoardPostings(ats, slug) {
  if (ats === "greenhouse") {
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    return (data?.jobs || []).map((j) => ({ title: j.title || "", url: j.absolute_url || "" }));
  }
  if (ats === "lever") {
    const data = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => ({ title: j.text || "", url: j.hostedUrl || j.applyUrl || "" }));
  }
  if (ats === "ashby") {
    const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    return (data?.jobs || []).map((j) => ({ title: j.title || "", url: j.jobUrl || j.applyUrl || "" }));
  }
  return [];
}

/**
 * Resolve a posting's canonical URL from its ATS board.
 * @returns {Promise<{ url, title, source } | null>}
 */
export async function lookupAtsPostingUrl({ company, jobTitle } = {}) {
  const co = String(company || "").trim();
  const title = String(jobTitle || "").trim();
  if (!co || !title) return null;

  // Known curated boards first, then a guessed slug per ATS for everyone else.
  const boards = knownBoardsFor(co);
  const guess = normalizeCompanyKey(co);
  if (guess) {
    for (const ats of ["greenhouse", "lever", "ashby"]) {
      if (!boards.some((b) => b.ats === ats && b.slug === guess)) {
        boards.push({ ats, slug: guess, guessed: true });
      }
    }
  }

  // Fetch the boards concurrently so a slow/dead board can't stall the request
  // (sequential worst case was MAX_BOARDS × the per-fetch timeout).
  const selected = boards.slice(0, MAX_BOARDS);
  const results = await Promise.all(
    selected.map(async (board) => ({ board, postings: await fetchBoardPostings(board.ats, board.slug) })),
  );

  let best = null;
  for (const { board, postings } of results) {
    const threshold = board.guessed ? GUESSED_THRESHOLD : KNOWN_THRESHOLD;
    for (const posting of postings) {
      if (!posting.url) continue;
      const score = titleMatchScore(title, posting.title);
      // Strict > keeps the first board (known boards are listed first) on ties.
      if (score >= threshold && (!best || score > best.score)) {
        best = { score, url: posting.url, title: posting.title, source: board.ats };
      }
    }
  }

  return best ? { url: best.url, title: best.title, source: best.source } : null;
}
