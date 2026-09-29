// Pure identity helpers for a researched company article -- the url-keying,
// arrival dedupe, and id-minting that used to live directly in
// app/hooks/useCompanyResearch.js. Moved out under the N92 Wave 1 file-size
// contingency (the same kind of extraction N89 Part 1 already made for
// `coverFactStrategy`/`filterEligibleArticles` into
// lib/acceptedFacts/factInsertion.js): behaviour is byte-identical, only the
// module changed, freeing room in the hook for that wave's new
// `moveInsertedFact` addition.

import { safeExternalHref } from "../url/safeExternalHref";
import { servesGroundingRedirect } from "../tracking/citationHref";
import { hashString } from "../text/phrasing";

// Tracking-only query parameters this app strips when deriving an article's
// dedupe/identity key -- campaign noise that varies per link to the SAME
// story, never content that changes which story the link points at.
const TRACKING_PARAM_NAMES = new Set(["gclid", "fbclid", "mc_cid", "mc_eid"]);

// N35/V1/V3/V3(b): the key two arrived articles are the SAME article by. Null
// for a url `safeExternalHref` refuses (there is no stable string to key on
// -- F4's hardening case, an id-less/url-less article, included) and for a
// grounding-redirect url: `servesGroundingRedirect` (lib/tracking/citationHref.js)
// already knows `vertexaisearch.cloud.google.com/grounding-api-redirect/<token>`
// is minted PER REQUEST, so the string looks stable but is not, and keying on
// it would silently promise a durability the token cannot honour. Everything
// else is normalised only in the four ways the owner ruling names -- host
// case, fragment, tracking parameters, trailing slash -- because normalising
// anything else (path, non-tracking query content) would merge genuinely
// different articles and re-create the same collision with a different
// cause. Scheme (`http:`/`https:`) and the `www.` prefix are deliberately
// left exactly as given: two sites can legitimately differ by scheme, and
// this app takes no position on the prefix either way.
export function articleUrlKey(rawUrl) {
  const href = safeExternalHref(rawUrl);
  if (href === null) return null;
  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (servesGroundingRedirect(host, href)) return null;

  parsed.hostname = host;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAM_NAMES.has(key)) parsed.searchParams.delete(key);
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.href;
}

// N35/V1: dedupe articles by url ON ARRIVAL, before minting (owner ruling,
// 2026-09-23). route.js:164 rewrites every article's url to
// `scraped.finalUrl || candidate`, so a syndicated copy and its canonical --
// or two grounding redirects for one story -- can arrive at the same url;
// left alone, they would mint the SAME id below and collapse into one
// coupled card downstream. An article whose key is null is never treated as
// a duplicate of another null-keyed article: absence of a usable url is not
// evidence of sameness (route.js:170 really returns `url: ""` for an article
// the grounding metadata never matched), and deduping on that would drop
// real research results.
export function dedupeArrivedArticles(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const seenKeys = new Set();
  const out = [];
  for (const a of list) {
    const key = articleUrlKey(a?.url);
    if (key !== null) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    out.push(a);
  }
  return out;
}

// N35/F1+F4: mint a provenance id ON ARRIVAL, at the one seam every research
// article passes through regardless of producer (the Gemini route and the
// embedded engine both mint `art-${i}` BY POSITION -- route.js:76,
// companyResearchLocal.js:78 -- so a run's first card is always `art-0`,
// whatever article it actually is). Two different accepted facts must never
// share an id, so this overrides whatever the producer sent, deriving the id
// from `articleUrlKey` above: stable for the SAME article across sessions (a
// re-run finds the same article at the same url, and it should read back as
// the same fact), yet distinct between different articles because different
// articles carry different urls. An article whose key is null -- an unusable
// or missing url, or a grounding-redirect url with no stable identity of its
// own -- falls back to a per-run component instead: non-durable, per the
// owner ruling, but still distinct and never null.
// Not exported: `withMintedIds` below is the only caller, in this same
// module (a same-module call the export-reachability sweep does not count,
// the same convention `factStore.js#sanitizeStoredFacts` already follows).
function mintArticleId(article, runStamp, index) {
  const key = articleUrlKey(article?.url);
  if (key !== null) return `art-${hashString(key).toString(36)}`;
  return `art-run${runStamp}-${index}`;
}

export function withMintedIds(articles, runStamp) {
  return (Array.isArray(articles) ? articles : []).map((a, i) => ({ ...a, id: mintArticleId(a, runStamp, i) }));
}
