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
