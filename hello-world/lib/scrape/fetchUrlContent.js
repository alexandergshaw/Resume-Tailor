const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DESCRIPTION_CHARS = 12000;
// A browser-like UA so sites that block obvious bots (but allow normal browsers)
// return the page.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Workday job pages are JS-rendered SPAs with no usable server HTML, but each
// tenant exposes the posting as JSON via its Candidate Experience (CXS) API.
const WORKDAY_HOST_RE = /(^|\.)myworkdayjobs\.com$/i;

// ===========================================================================
// SSRF gate
//
// This module fetches URLs that users and LLM output hand it, from the server.
// Everything below exists so that a request is never sent to an address only
// this server can reach — the cloud instance-metadata service above all.
//
// It replaces an exact-string blocklist ("localhost", "127.0.0.1", "::1", …)
// plus a startsWith() prefix list. That was bypassable by every address the
// list didn't spell out literally: the rest of 127.0.0.0/8, the decimal / hex /
// octal / short-form encodings of an IPv4 address, "[::1]" (the brackets a URL
// hostname actually carries), every IPv6 private range, "localhost." with the
// root dot, and metadata.google.internal. It also over-blocked, refusing any
// DNS name that merely began "10." or "192.168.".
//
// KNOWN LIMIT — DNS REBINDING IS NOT CLOSED. This is a URL/hostname-level
// control. It judges literal addresses and the names that always mean "this
// host", and it re-runs on every redirect hop — but it does NOT resolve DNS.
// A public hostname whose A record points at 169.254.169.254 (deliberate
// rebinding, or just an internal record) still passes this gate. Closing that
// requires resolving the name here and pinning the resolved IP for the socket
// that actually connects (a custom undici dispatcher / lookup hook), which is
// a larger change than this module. Treat the gate as defence in depth, not
// as proof the destination is public.
// ===========================================================================

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const BLOCKED_URL_ERROR = "That URL is not allowed.";

/** Redirects we will follow ourselves, re-checking each hop. */
export const MAX_REDIRECT_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Names that always denote the local host, a link-local/mDNS peer, or a cloud
// instance-metadata service. Matched on the whole host or on a dot-delimited
// suffix, so "api.localhost" and "metadata.google.internal." are covered too.
// None of these are publicly resolvable, so nothing legitimate is lost.
const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  "localdomain",
  "local", // mDNS
  "internal", // GCE private zone, incl. metadata.google.internal
  "metadata.goog",
];

// Lowercase and drop the trailing root dot(s) a fully-qualified name may carry
// ("localhost." and "localhost" are the same name).
function normalizeHost(hostname) {
  let host = String(hostname || "").trim().toLowerCase();
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/**
 * Parse an IPv4 literal the way inet_aton (and therefore the URL spec, and
 * therefore the OS resolver) does: 1-4 dot-separated parts, each decimal,
 * octal (leading 0) or hex (leading 0x), with the last part absorbing all the
 * remaining low-order bytes. This is what makes "2130706433", "0x7f000001",
 * "0177.0.0.1" and "127.1" all mean 127.0.0.1.
 * @returns {number|null} the address as a uint32, or null if not an IPv4 literal.
 */
export function parseIPv4(hostname) {
  const parts = String(hostname).split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = [];
  for (const part of parts) {
    let n;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) n = parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part.slice(1), 8);
    else if (/^[0-9]+$/.test(part)) n = parseInt(part, 10);
    else return null;
    if (!Number.isSafeInteger(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums.pop();
  if (nums.some((n) => n > 255)) return null;
  if (last >= 256 ** (4 - nums.length)) return null;
  let value = last;
  for (let i = 0; i < nums.length; i += 1) value += nums[i] * 256 ** (3 - i);
  return value >>> 0;
}

function parseDottedQuad(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
}

/**
 * Parse an IPv6 literal, with or without the brackets a URL hostname carries,
 * handling "::" compression and a trailing dotted quad ("::ffff:127.0.0.1").
 * @returns {number[]|null} eight 16-bit groups, or null if not an IPv6 literal.
 */
export function parseIPv6(hostname) {
  let s = String(hostname).trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%"); // "fe80::1%eth0"
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (chunk) => {
    if (chunk === "") return [];
    const out = [];
    const pieces = chunk.split(":");
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i];
      if (piece.includes(".")) {
        // A dotted quad is legal only as the final piece; it fills two groups.
        if (i !== pieces.length - 1) return null;
        const v4 = parseDottedQuad(piece);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]);
  if (tail === null) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

// Ranges that are loopback, private, link-local, shared, or otherwise not a
// public destination. Deny by RANGE, never by spelled-out address.
function isBlockedIPv4(value) {
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  const c = (value >>> 8) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIPv6(groups) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const low32 = ((((g6 << 16) >>> 0) + g7) >>> 0);
  const topFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated IPv4-compatible,
  // which also covers :: and ::1) — judge the embedded IPv4.
  if (topFiveZero && (g5 === 0xffff || g5 === 0)) return isBlockedIPv4(low32);
  if (g0 === 0x64 && g1 === 0xff9b) return isBlockedIPv4(low32); // 64:ff9b::/96 NAT64
  if (g0 === 0x2002) return isBlockedIPv4(((((g1 << 16) >>> 0) + g2) >>> 0)); // 2002::/16 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}

/**
 * The deny-by-range core: is this hostname an address (or a name) we must not
 * send a request to? Exported so the ranges can be unit-tested directly rather
 * than only through a fetch.
 */
export function isBlockedHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;

  const v6 = parseIPv6(host);
  if (v6) return isBlockedIPv6(v6);

  const v4 = parseIPv4(host);
  if (v4 !== null) return isBlockedIPv4(v4);

  // Not an address literal, so it is a name. Only the names that always mean
  // "this host" or "instance metadata" are refused — a name is otherwise left
  // to DNS, with the rebinding caveat documented above.
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * THE gate. Every outbound request this module makes — the first one and every
 * redirect hop — is decided here, so the rules cannot drift apart.
 * @param {string} rawUrl the URL, absolute or (with `base`) relative.
 * @param {string} [base] the URL a redirect Location was read from.
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
export function checkRequestUrl(rawUrl, base) {
  let parsed;
  try {
    parsed = base ? new URL(rawUrl, base) : new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: "Only HTTP and HTTPS URLs are supported." };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: BLOCKED_URL_ERROR };
  }
  return { ok: true, url: parsed };
}

/**
 * fetch(), walking redirects OURSELVES so `checkRequestUrl` runs on every hop.
 *
 * `redirect: "follow"` hands the chain to the platform, where a perfectly
 * ordinary allowed host can 302 straight into http://169.254.169.254/ and a
 * pre-flight check never sees it. That is precisely the hole this closes, so
 * do not "simplify" this back to redirect: "follow".
 *
 * @returns {Promise<{ response: Response, finalUrl: string } | { error: string }>}
 */
async function safeFetch(startUrl, init) {
  let current = startUrl;
  // One initial request plus at most MAX_REDIRECT_HOPS redirects.
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const check = checkRequestUrl(current);
    if (!check.ok) return { error: check.error };

    let response;
    try {
      response = await fetch(check.url.href, { ...init, redirect: "manual" });
    } catch (err) {
      return { error: err?.message || "Failed to fetch URL." };
    }
    if (!response || !REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: check.url.href };
    }
    const location = response.headers?.get?.("location");
    // A redirect status with no Location is not a redirect we can follow —
    // hand it back and let the caller report the status.
    if (!location) return { response, finalUrl: check.url.href };

    const next = checkRequestUrl(location, check.url.href);
    if (!next.ok) return { error: next.error };
    current = next.url.href;
  }
  return { error: "Too many redirects." };
}

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

// Replace every `<…>` span with `replacement`, in ONE left-to-right scan.
//
// This is a drop-in for /<[^>]+>/g, which is quadratic: at every '<' the engine
// runs `[^>]+` forward to the end of the input, fails to find a '>', and
// backtracks the whole way before advancing one character. Measured on
// 2026-09-05 (Node 22): 504 ms at 25 000 '<', 2.0 s at 50 000, 11.2 s at
// 100 000, 29.5 s at 200 000 — and htmlToText runs it up to twice over bodies
// as large as MAX_BYTES (2 MB), which extrapolates to roughly an hour.
//
// The language is unchanged: a '<', at least one non-'>' character, then a '>'.
// Because `indexOf` finds the FIRST '>' after the '<', and `[^>]+` cannot cross
// a '>', that span is exactly what the greedy regex would have matched.
function removeTagSpans(text, replacement) {
  let out = "";
  let i = 0;
  for (;;) {
    const lt = text.indexOf("<", i);
    if (lt === -1) return out + text.slice(i);
    const gt = text.indexOf(">", lt + 1);
    if (gt === -1) return out + text.slice(i);
    if (gt === lt + 1) {
      // "<>" — the pattern needs at least one character between the brackets,
      // so nothing matches here. Resume scanning just after this '<'.
      out += text.slice(i, lt + 1);
      i = lt + 1;
      continue;
    }
    out += text.slice(i, lt) + replacement;
    i = gt + 1;
  }
}

// Is there still a literal tag in the text? Equivalent to
// /<\/?[a-z][^>]*>/i.test(text), which is quadratic for the same reason as
// above — measured at 14.7 s on 100 000 "<a" pairs.
function hasLiteralTag(text) {
  let i = 0;
  for (;;) {
    const lt = text.indexOf("<", i);
    if (lt === -1) return false;
    const gt = text.indexOf(">", lt + 1);
    if (gt === -1) return false;
    // "<a…>" or "</a…>": a letter must sit right after the '<' (or the '</'),
    // and before the closing '>'.
    const nameAt = text[lt + 1] === "/" ? lt + 2 : lt + 1;
    if (nameAt < gt && /[a-z]/i.test(text[nameAt])) return true;
    i = lt + 1;
  }
}

// Strip tags + map block/line breaks to newlines (one pass).
//
// The <script>/<style> regexes below were MEASURED, not assumed: 0.3 ms and
// 0.2 ms on 200 000 '<', 3.8 ms on "<script" followed by 200 000 '<'. They are
// linear here because `[^<]*` is fenced by the literal '<' that follows it.
// The close-tag and <br> regexes measured at 0.1-0.4 ms. All four are fine and
// deliberately left alone — only the unbounded `[^>]` scan was the problem.
export function stripTags(html) {
  const collapsed = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return removeTagSpans(collapsed, " ");
}

export function htmlToText(html) {
  if (typeof html !== "string") return "";
  // Strip tags, then decode entities. Some sources (e.g. higheredjobs' JSON-LD
  // JobPosting.description) are HTML that's been entity-encoded, so decoding
  // reveals a second layer of literal tags (<strong>, <br>) — strip those too.
  let text = decodeHtmlEntities(stripTags(html));
  if (hasLiteralTag(text)) text = decodeHtmlEntities(stripTags(text));
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
    const parsed = parseJsonLenient(raw);
    if (!parsed) continue;
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

// Parse a JSON blob, tolerating the single most common real-world defect in
// hand-built JSON-LD: a trailing comma before a } or ] (e.g. HigherEdJobs' JobPosting
// node ends "…"$22 per hour",}"). Strict parse first; only the retry strips trailing
// commas, so valid JSON is never altered. Returns the value, or null if still invalid.
export function parseJsonLenient(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(String(raw).replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

// Every JSON blob a page embeds: JSON-LD, framework state (__NEXT_DATA__), and any
// other application/json script. Lets us find posting data host-agnostically.
function collectJsonBlobs(html) {
  const blobs = [];
  const re = /<script\b[^>]*\btype=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (raw) blobs.push(raw);
  }
  return blobs;
}

// A node is a job posting if it is JSON-LD-typed JobPosting or carries an explicit
// job-description field (Workday/ATS shapes) — job-specific signals, so we don't
// mistake an article or product node for a posting.
function isJobPostingNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const type = node["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return true;
  return typeof node.jobDescription === "string" && node.jobDescription.trim().length > 40;
}

// Normalize a posting-shaped node to { title, company, description }.
function postingFromNode(node) {
  const title = String(node.title || node.jobTitle || node.name || "").trim();
  let company = "";
  const org = node.hiringOrganization || node.company;
  if (org && typeof org === "object" && typeof org.name === "string") company = org.name.trim();
  else if (typeof org === "string") company = org.trim();
  const descRaw =
    typeof node.jobDescription === "string"
      ? node.jobDescription
      : typeof node.description === "string"
        ? node.description
        : "";
  return { title, company, description: htmlToText(descRaw) };
}

// Deep-search a page's embedded JSON for a job-posting-shaped node. Host-agnostic:
// any board that embeds JSON-LD JobPosting or its posting JSON (Next.js/ATS state)
// works without a per-site branch. Returns { title, company, description } or null.
export function findEmbeddedJobPosting(html) {
  for (const raw of collectJsonBlobs(html)) {
    const parsed = parseJsonLenient(raw);
    if (!parsed) continue;
    const stack = [parsed];
    let visited = 0;
    while (stack.length && visited < 20000) {
      const node = stack.pop();
      visited += 1;
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const child of node) stack.push(child);
        continue;
      }
      // Workday-style wrapper: { jobPostingInfo: {...}, hiringOrganization: {...} }.
      if (node.jobPostingInfo && typeof node.jobPostingInfo === "object" && typeof node.jobPostingInfo.jobDescription === "string") {
        return postingFromNode({ ...node.jobPostingInfo, hiringOrganization: node.hiringOrganization });
      }
      if (isJobPostingNode(node)) return postingFromNode(node);
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
  }
  return null;
}

// Strip the legal-entity prefix many institutions use as their Workday
// hiringOrganization name ("The Trustees of the Smith College" -> "Smith College";
// "The Regents of the University of California" -> "University of California").
export function cleanOrgName(name) {
  return String(name || "")
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/^(?:board of )?(?:trustees|regents|curators|governors|visitors|directors) of (?:the )?/i, "")
    .replace(/^the\s+/i, "")
    .trim();
}

// Map a public Workday job URL to its CXS JSON endpoint:
//   https://<tenant>.<dc>.myworkdayjobs.com/<locale?>/<site>/job/<path>
//   -> https://<tenant>.<dc>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/job/<path>
export function workdayCxsUrl(parsed) {
  const segments = parsed.pathname.split("/").filter(Boolean);
  const jobIdx = segments.indexOf("job");
  if (jobIdx < 1 || jobIdx >= segments.length - 1) return "";
  const site = segments[jobIdx - 1];
  const jobPath = segments.slice(jobIdx + 1).join("/");
  const tenant = parsed.hostname.split(".")[0];
  if (!tenant || !site || !jobPath) return "";
  return `${parsed.origin}/wday/cxs/${tenant}/${site}/job/${jobPath}`;
}

// Read a Workday posting through the CXS JSON API. Returns the fetchUrlContent
// shape, or null to fall back to the generic HTML path.
async function fetchWorkday(parsed, maxChars) {
  const cxs = workdayCxsUrl(parsed);
  if (!cxs) return null;
  // safeFetch, not fetch: the CXS endpoint can redirect, and every hop has to
  // go back through the SSRF gate.
  const walked = await safeFetch(cxs, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const response = walked.response;
  if (walked.error || !response || !response.ok) return null;
  let data;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  const info = data && data.jobPostingInfo;
  if (!info || typeof info.jobDescription !== "string") return null;
  let description = htmlToText(info.jobDescription);
  if (!description) return null;
  if (description.length > maxChars) description = `${description.slice(0, maxChars)}…`;
  const orgName =
    data.hiringOrganization && typeof data.hiringOrganization.name === "string"
      ? data.hiringOrganization.name
      : "";
  return {
    title: typeof info.title === "string" ? info.title.trim() : "",
    company: cleanOrgName(orgName),
    description,
    publishedDate: formatMonthYear(info.startDate || ""),
    finalUrl: walked.finalUrl || cxs,
  };
}

// SPA job boards with no usable server HTML, read via their public JSON API. To
// support a new board, add an entry { test, fetch } here — no changes to
// fetchUrlContent itself. `test(hostname, parsedUrl)` decides if it applies;
// `fetch(parsedUrl, maxChars)` returns the fetchUrlContent shape, or null to fall
// back to the generic HTML path.
const SPA_PROVIDERS = [
  { name: "workday", test: (host) => WORKDAY_HOST_RE.test(host), fetch: fetchWorkday },
];

/**
 * Fetch a URL and extract plain-text content along with title/company metadata.
 * Returns { title, company, description } or { error }.
 */
export async function fetchUrlContent(rawUrl, options = {}) {
  const maxChars = options.maxChars || DEFAULT_MAX_DESCRIPTION_CHARS;

  // Scheme allow-list + deny-by-range host check. safeFetch runs this again on
  // the request itself and on every redirect hop; doing it here too lets the
  // SPA-provider dispatch below work from an already-validated URL.
  const gate = checkRequestUrl(rawUrl);
  if (!gate.ok) return { error: gate.error };
  const parsed = gate.url;
  const hostname = parsed.hostname.toLowerCase();

  // SPA boards (Workday, …) expose the posting only via a JSON API — use it. Any
  // board not covered here still works through the generic HTML + embedded-JSON
  // path below, so a new SPA board is the only case that needs a provider entry.
  for (const provider of SPA_PROVIDERS) {
    if (!provider.test(hostname, parsed)) continue;
    const viaApi = await provider.fetch(parsed, maxChars);
    if (viaApi) return viaApi;
    break; // matched the provider but its API didn't yield a posting — fall through
  }

  const walked = await safeFetch(rawUrl, {
    // A browser-like UA + headers so the many sites that block obvious bots
    // (but allow normal browsers) return the page. Sites behind a JS/WAF
    // challenge will still 403 — the company-research URL path then falls back
    // to Gemini's own fetcher.
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (walked.error) return { error: walked.error };
  const response = walked.response;

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

  const embedded = findEmbeddedJobPosting(html);
  if (embedded) {
    title = embedded.title || title;
    company = cleanOrgName(embedded.company) || company;
    description = embedded.description || description;
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
    // link to the real article it points at. safeFetch tracked the chain, so
    // its last hop is authoritative even though we no longer let the platform
    // follow redirects for us.
    finalUrl:
      typeof response.url === "string" && response.url ? response.url : walked.finalUrl || rawUrl,
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
