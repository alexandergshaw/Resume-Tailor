// ---------------------------------------------------------------------------
// Shared Google-Search-grounding helpers.
//
// Google's grounding metadata lists the pages the model ACTUALLY searched. It
// is the only evidence available that a result was not invented, so every
// grounded feature (company research, experience research, AI job search)
// extracts it here instead of keeping its own copy.
// ---------------------------------------------------------------------------

// Real source links Gemini grounded on (proof it actually searched). Returns the
// grounded web URIs/titles, used to gate hallucination and enrich missing URLs.
export function extractGroundingSources(response) {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const out = [];
  for (const c of chunks) {
    const web = c?.web;
    if (web?.uri) out.push({ uri: String(web.uri), title: String(web.title || "") });
  }
  return out;
}

/** Lowercased, `www.`-stripped hostnames the model actually grounded on. */
export function groundedHostnames(grounded) {
  const hosts = new Set();
  for (const g of Array.isArray(grounded) ? grounded : []) {
    const uri = g?.uri;
    if (!uri) continue;
    try {
      const host = new URL(uri).hostname.toLowerCase().replace(/^www\./, "");
      if (host) hosts.add(host);
    } catch {
      // not a parseable URL — ignore rather than let it poison the set
    }
  }
  return hosts;
}

// Whether `url`'s host is one the model actually searched. Empty grounding
// means false, never true: no grounding is no evidence the model searched at
// all, and treating an empty list as "allow" is precisely how a fabricated
// posting would reach the feed.
export function isGroundedHost(url, grounded) {
  const hosts = groundedHostnames(grounded);
  if (hosts.size === 0) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return hosts.has(host);
  } catch {
    return false;
  }
}

// http(s) only, on both sides — a dangerous scheme (javascript:, data:, …)
// must not pass merely because it happened to appear in grounding metadata.
function safeUrl(raw) {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

// Parameters that are provably about ATTRIBUTION, never about which page you
// land on. Only these are folded away; everything else in a query string is
// treated as part of the page's identity, because for a query-addressed site
// it literally is (en.wikipedia.org/w/index.php?title=X, youtube.com/watch?v=X
// — same host, same path, completely different page). Folding the whole query
// out, as an earlier version did, meant ?title=Totally_Invented_Page passed on
// the strength of a grounded ?title=Kubernetes.
function isTrackingParam(name) {
  const n = String(name).toLowerCase();
  return n.startsWith("utm_") || n === "gclid" || n === "fbclid" || n === "ref";
}

/**
 * The identity of a WEB PAGE, as a comparable string, or null if `raw` is not
 * a page at all (unparseable, or a non-http(s) scheme).
 *
 * What is part of the identity, and therefore in the key:
 *   protocol, hostname, port, path, and every non-tracking query parameter.
 * Dropping any of those lets a DIFFERENT page compare equal to a real one:
 * a port or scheme change points at a different server, and userinfo
 * (https://react.dev@evil.example/x) exists mainly to make a hostile host
 * read as a trusted one — that one is refused outright rather than folded,
 * since no real documentation page carries credentials.
 *
 * What is folded, because it is spelling rather than identity: "www.", host
 * case, a trailing dot on the host (the DNS root), repeated and trailing
 * slashes in the path, query parameter ORDER, tracking parameters, and the
 * fragment. Every one of those is the SAME resource by specification — a
 * hostname is case-insensitive and dot-terminated is the same name, and
 * //learn/state and /learn/state resolve identically — so folding them only
 * stops a REAL citation from comparing unequal to itself.
 *
 * Path CASE is deliberately NOT in that group, though it looks like it
 * belongs. A path is case-sensitive by specification; only the host is not.
 * /Learn/state and /learn/state are genuinely different resources, and on
 * most documentation sites the wrong case 404s rather than redirecting. So
 * folding it would let a model citing /Learn/X pass on the strength of a
 * grounded /learn/X, and the user opens a dead link in front of colleagues
 * having been told it was verified — the exact harm this whole design exists
 * to prevent, just arriving via a 404 instead of a fabrication. Keeping it
 * significant costs the opposite failure: a real citation differing only in
 * case is dropped and the card honestly says one suggestion could not be
 * verified. That is strictly the smaller harm, and it is the direction every
 * other decision in this module already leans — refuse by default, never
 * show anything not known good. A dropped-but-honest result is recoverable;
 * a confidently-wrong one is not.
 */
export function pageIdentityKey(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  if (u.username || u.password) return null;

  const host = u.hostname.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  if (!host) return null;

  // Case is preserved: a path is case-sensitive by spec (see above). Only
  // the slash noise is folded, because //a/b and /a/b are the same resource.
  const path = u.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";

  // Values keep their case: a query value is frequently an opaque,
  // case-sensitive id (youtube's ?v=, a doc anchor id), so lowercasing it
  // would collide two genuinely different pages.
  const params = [];
  for (const [name, value] of u.searchParams) {
    if (isTrackingParam(name)) continue;
    params.push(`${name.toLowerCase()}=${value}`);
  }
  params.sort();
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const port = u.port ? `:${u.port}` : "";

  return `${u.protocol}//${host}${port}${path}${query}`;
}

// Whether `url` is the SAME PAGE as one the model actually searched — host
// AND path, not just host. isGroundedHost is deliberately looser: it exists
// for callers that only need to know "did the model touch this site", and
// six features already depend on that exact permissiveness. This function is
// for the one caller (the meeting copilot's spoken-aloud reference links)
// where that looseness is the bug: a model that genuinely searched
// react.dev will happily invent react.dev/learn/a-page-that-never-existed,
// and a host-only check blesses it. So this compares whole pageIdentityKey
// values (never startsWith — a walkthrough page under the same path prefix
// as a real page is still a different, unverified page) and requires an
// exact match once both sides are folded to the same form.
//
// lib/experience/researchReport.js has its own private normalizeKey/safeUrl
// pair doing the same folding for reconcileCitations. That copy is not
// reused here on purpose: it DEMOTES an uncorroborated citation to plain
// text, while this function's callers DROP the reference outright — same
// idea of "same page", different consequence when a page doesn't match, so
// this is the shared, exported home for the strict host+path variant rather
// than a third private copy or a forced merge of two different semantics.
// Accepts `{ uri }` entries (extractGroundingSources' shape) or bare URL
// strings, so a caller that has already resolved grounding redirects to their
// real destinations can pass the resolved list straight in.
export function isGroundedUrl(url, grounded) {
  const list = Array.isArray(grounded) ? grounded : [];
  const groundedKeys = new Set();
  for (const g of list) {
    const key = pageIdentityKey(typeof g === "string" ? g : g?.uri);
    if (key) groundedKeys.add(key);
  }
  if (groundedKeys.size === 0) return false;
  const key = pageIdentityKey(url);
  return key ? groundedKeys.has(key) : false;
}
