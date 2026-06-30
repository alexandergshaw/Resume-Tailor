const BLOCKED_HOSTNAMES = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"];
const BLOCKED_IP_PREFIXES = [
  "10.", "192.168.",
  "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
];
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DESCRIPTION_CHARS = 12000;

export function decodeHtmlEntities(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ""; }
    });
}

// Strip tags + map block/line breaks to newlines (one pass).
function stripTags(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function htmlToText(html) {
  if (typeof html !== "string") return "";
  // Strip tags, then decode entities. Some sources (e.g. higheredjobs' JSON-LD
  // JobPosting.description) are HTML that's been entity-encoded, so decoding
  // reveals a second layer of literal tags (<strong>, <br>) — strip those too.
  let text = decodeHtmlEntities(stripTags(html));
  if (/<\/?[a-z][^>]*>/i.test(text)) text = decodeHtmlEntities(stripTags(text));
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractMetaContent(html, attr, value) {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${value}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${value}["']`,
    "i",
  );
  const m = html.match(re) || html.match(re2);
  return m ? decodeHtmlEntities(m[1]).trim() : "";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Format a raw date string (ISO, RFC, or "2026") as "Month YYYY" so article
// cards read consistently. Parses YYYY-MM directly to avoid timezone drift.
export function formatMonthYear(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const iso = value.match(/(\d{4})-(\d{2})/);
  if (iso) {
    const month = Number(iso[2]);
    return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${iso[1]}` : iso[1];
  }
  // A lone year with no month/day signal — don't let Date invent "January".
  const yearOnly = value.match(/^\D*((?:19|20)\d{2})\D*$/);
  if (yearOnly) return yearOnly[1];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
  }
  const anyYear = value.match(/\b(?:19|20)\d{2}\b/);
  return anyYear ? anyYear[0] : "";
}

function datePublishedFromJsonLd(html) {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const child of node) stack.push(child);
        continue;
      }
      const d = node.datePublished || node.dateCreated || node.dateModified;
      if (typeof d === "string" && d.trim()) return d.trim();
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
  }
  return "";
}

// Best-effort article publication date as "Month YYYY". Prefers structured
// JSON-LD, then the common published-time meta tags, then a <time datetime>.
export function extractPublishedDate(html) {
  if (typeof html !== "string" || !html) return "";
  const fromLd = datePublishedFromJsonLd(html);
  if (fromLd) return formatMonthYear(fromLd);
  const meta =
    extractMetaContent(html, "property", "article:published_time") ||
    extractMetaContent(html, "property", "og:article:published_time") ||
    extractMetaContent(html, "name", "article:published_time") ||
    extractMetaContent(html, "itemprop", "datePublished") ||
    extractMetaContent(html, "name", "datePublished") ||
    extractMetaContent(html, "name", "publish-date") ||
    extractMetaContent(html, "name", "publishdate") ||
    extractMetaContent(html, "name", "pubdate") ||
    extractMetaContent(html, "name", "date");
  if (meta) return formatMonthYear(meta);
  const timeTag = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (timeTag) return formatMonthYear(timeTag[1]);
  return "";
}

function findJsonLdJobPosting(html) {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = [];
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const child of node) stack.push(child);
        continue;
      }
      const type = node["@type"];
      if (
        type === "JobPosting" ||
        (Array.isArray(type) && type.includes("JobPosting"))
      ) {
        candidates.push(node);
      }
      if (Array.isArray(node["@graph"])) {
        for (const child of node["@graph"]) stack.push(child);
      }
    }
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

/**
 * Fetch a URL and extract plain-text content along with title/company metadata.
 * Returns { title, company, description } or { error }.
 */
export async function fetchUrlContent(rawUrl, options = {}) {
  const maxChars = options.maxChars || DEFAULT_MAX_DESCRIPTION_CHARS;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: "Invalid URL." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Only HTTP and HTTPS URLs are supported." };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.includes(hostname) ||
    BLOCKED_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))
  ) {
    return { error: "That URL is not allowed." };
  }

  let response;
  try {
    response = await fetch(rawUrl, {
      // A browser-like UA + headers so the many sites that block obvious bots
      // (but allow normal browsers) return the page. Sites behind a JS/WAF
      // challenge will still 403 — the company-research URL path then falls back
      // to Gemini's own fetcher.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { error: err?.message || "Failed to fetch URL." };
  }

  if (!response.ok) {
    return { error: `Failed to fetch URL (status ${response.status}).` };
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return { error: "URL did not return an HTML page." };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BYTES) {
      reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = chunks.reduce((acc, chunk) => {
    const out = new Uint8Array(acc.byteLength + chunk.byteLength);
    out.set(acc);
    out.set(chunk, acc.byteLength);
    return out;
  }, new Uint8Array(0));
  const html = new TextDecoder().decode(merged);

  let title = "";
  let company = "";
  let description = "";

  const jobPosting = findJsonLdJobPosting(html);
  if (jobPosting) {
    if (typeof jobPosting.title === "string") title = jobPosting.title.trim();
    const org = jobPosting.hiringOrganization;
    if (org && typeof org === "object" && typeof org.name === "string") {
      company = org.name.trim();
    } else if (typeof org === "string") {
      company = org.trim();
    }
    if (typeof jobPosting.description === "string") {
      description = htmlToText(jobPosting.description);
    }
  }

  if (!title) {
    title =
      extractMetaContent(html, "property", "og:title") ||
      extractMetaContent(html, "name", "twitter:title") ||
      "";
  }
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = decodeHtmlEntities(titleMatch[1]).trim();
  }
  // A browser <title> / og:title usually appends the site name after a pipe or
  // middot ("Role | U-M Careers"); drop it so the title is just the role.
  if (title) title = title.replace(/\s*[|·]\s+.*$/, "").trim() || title;
  if (!company) {
    const siteName = extractMetaContent(html, "property", "og:site_name") || "";
    // og:site_name is frequently the careers SITE, not the employer — skip those
    // so a JSON-LD/heuristic employer name can win instead.
    if (siteName && !/\b(careers?|jobs?|job board|talent|hiring|recruit)\b/i.test(siteName)) {
      company = siteName;
    }
  }

  if (!description) {
    description = htmlToText(html);
  }

  const publishedDate = extractPublishedDate(html);

  if (description.length > maxChars) {
    description = `${description.slice(0, maxChars)}…`;
  }

  return {
    title,
    company,
    description,
    publishedDate,
    // The URL after any redirects — lets callers resolve a grounding-redirect
    // link to the real article it points at.
    finalUrl: typeof response.url === "string" && response.url ? response.url : rawUrl,
  };
}

const URL_REGEX = /https?:\/\/[^\s<>"'`)]+/gi;

/**
 * Extract up to `limit` unique http(s) URLs from a string.
 * Trims trailing punctuation that is commonly part of prose rather than the URL.
 */
export function extractUrls(text, limit = 3) {
  if (typeof text !== "string" || !text) return [];
  const matches = text.match(URL_REGEX) || [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?)\]}"']+$/g, "");
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}
