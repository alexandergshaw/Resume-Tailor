// Non-AI web search: query DuckDuckGo's HTML endpoint and parse the result
// links. Used by the offline screenshot path to locate a posting URL when the
// company isn't on a known ATS board. No API key, no LLM.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null && out.length < limit) {
    const url = decodeDdgHref(m[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Search the web for posting URLs matching a query.
 * @returns {Promise<string[]>} up to `limit` candidate URLs (best-effort).
 */
export async function searchPostingUrls({ query, limit = 5 } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  let res;
  try {
    res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const html = await res.text();
  return parseDdgResults(html, limit);
}
