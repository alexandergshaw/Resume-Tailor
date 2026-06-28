// Non-AI web search behind a single searchPostingUrls() interface. Picks the
// sturdiest configured provider, in order:
//   1. Brave Search API            — env BRAVE_SEARCH_API_KEY
//   2. Google Programmable Search  — env GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID
//   3. DuckDuckGo HTML scrape       — no key (best-effort fallback)
// Falls through to the next provider when a configured one errors or returns
// nothing, so a rate-limited/keyless deploy still degrades gracefully. No LLM.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 10000;

function dedupeUrls(urls, limit) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const url = String(u || "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

// --- Brave Search API ------------------------------------------------------
async function braveSearch(query, key, limit) {
  let res;
  try {
    res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const results = data?.web?.results;
  if (!Array.isArray(results)) return [];
  return dedupeUrls(results.map((r) => r?.url), limit);
}

// --- Google Programmable Search (Custom Search JSON API) -------------------
async function googleSearch(query, key, engineId, limit) {
  let res;
  try {
    res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(engineId)}&num=${Math.min(limit, 10)}&q=${encodeURIComponent(query)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const items = data?.items;
  if (!Array.isArray(items)) return [];
  return dedupeUrls(items.map((i) => i?.link), limit);
}

// --- DuckDuckGo HTML scrape (keyless fallback) -----------------------------

// DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded-url>. Pull
// the real destination out (or accept an already-direct https link).
export function decodeDdgHref(href) {
  if (!href) return "";
  const raw = String(href).replace(/&amp;/g, "&");
  try {
    const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg;
    if (/^https?:$/i.test(u.protocol)) return u.href;
    return "";
  } catch {
    return /^https?:\/\//i.test(raw) ? raw : "";
  }
}

// Pull result destination URLs out of a DuckDuckGo HTML results page.
export function parseDdgResults(html, limit = 5) {
  const text = String(html || "");
  const re = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = decodeDdgHref(m[1]);
    if (url) out.push(url);
  }
  return dedupeUrls(out, limit);
}

async function duckDuckGoSearch(query, limit) {
  let res;
  try {
    res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const html = await res.text();
  return parseDdgResults(html, limit);
}

/**
 * Search the web for posting URLs matching a query, using the best configured
 * provider (Brave → Google CSE → DuckDuckGo). Best-effort.
 * @returns {Promise<string[]>} up to `limit` candidate URLs.
 */
export async function searchPostingUrls({ query, limit = 5, env = process.env } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  if (env.BRAVE_SEARCH_API_KEY) {
    const hits = await braveSearch(q, env.BRAVE_SEARCH_API_KEY, limit);
    if (hits.length) return hits;
  }
  if (env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_ENGINE_ID) {
    const hits = await googleSearch(q, env.GOOGLE_SEARCH_API_KEY, env.GOOGLE_SEARCH_ENGINE_ID, limit);
    if (hits.length) return hits;
  }
  return duckDuckGoSearch(q, limit);
}
