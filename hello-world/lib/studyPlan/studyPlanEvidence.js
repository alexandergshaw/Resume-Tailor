// N157 SC-A: the research REUSE SEAM. Adapts the already-persisted, already-
// grounded `application_digests` row into the EvidenceSet the study-plan
// generator consumes. This module issues NO grounded call of its own and does
// no IO of its own: its grounded evidence is the digest the existing
// /api/application-digest route (an Interactions-API call, wire-tested in
// app/api/application-digest/route.wire.test.js) already wrote. Pure,
// browser-safe, and every export here NEVER throws.
//
// The EvidenceSet this module hands the generator:
//
//   {
//     complete:           boolean,        // true ONLY when ready AND >=1 usable citation
//     researchedAt:       string | null,  // digest.researched_at, else null
//     postingFingerprint: string,         // the caller's string, verbatim; "" if absent
//     items: [{ topicHint: string, text: string, citations: [{ url }], sourced: boolean }],
//     reason:             null | "no-research" | "unsourced",
//   }
//
// THE CITATION ELEMENT IS FROZEN TO { url } AND NOTHING ELSE. `url` is taken
// verbatim from application_digests.sources[].url -- the persisted column
// element built by digestCitations.js's buildCitedDigest ({ url, title?,
// start?, end? }) -- and NOT from extractCitationSources's { uri }, which is
// the route's input and never the stored shape. title/start/end are left off:
// the generator consumes evidence as grounding context, and the render surface
// re-derives its host and label from the href itself (SEC-F2).
//
// REFUSAL-HONEST, NEVER TRUSTED-BY-DEFAULT. An absent, not-ready or empty
// digest is { complete:false, items:[], reason:"no-research" }. A ready digest
// whose every source was filtered away is { complete:false, reason:"unsourced",
// sourced:false } -- never a "researched" plan built on a citation that was
// not there.
//
// The adapter is deliberately fingerprint-agnostic: postingFingerprint is
// stored as the caller supplied it. The route that builds the plan computes it
// once (lib/copilot/glossaryStore.js's postingFingerprint); a second copy here
// would make every staleness comparison silently never (or always) match.

import { safeExternalHref } from "../url/safeExternalHref.js";
import { citationHost, servesGroundingRedirect } from "../tracking/citationHref.js";

/**
 * The citations a digest's `sources` column yields for the generator.
 *
 * Per entry, in this order (each step load-bearing):
 *   1. not a plain object                         -> dropped
 *   2. safeExternalHref(url) === null             -> dropped (javascript:, data:,
 *      userinfo, padding, non-string ...)
 *   3. host = citationHost(href)                  -> the FOLDED host (lower-cased,
 *      www-stripped), which servesGroundingRedirect REQUIRES; handing it the raw
 *      url as `host` makes the vendor-host comparison silently miss and a
 *      redirect slips through as a live-looking citation
 *   4. servesGroundingRedirect(host, href)        -> dropped
 * Survivors are deduped by url, first-seen order, url VERBATIM (never
 * new URL(url).href). The digest column is already href-safe at write time and
 * fresh Interactions rows carry real publisher URLs, so on this path the
 * redirect step is defence in depth; it stays so any path reading the column
 * directly is safe.
 *
 * @param {unknown} sources
 * @returns {Array<{url: string}>}
 */
export function evidenceCitations(sources) {
  if (!Array.isArray(sources)) return [];
  const seen = new Set();
  const out = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const href = safeExternalHref(source.url);
    if (href === null) continue;
    const host = citationHost(href);
    // A safe href always yields a host; if one ever did not, "cannot prove it
    // is not a redirect" is a drop, never a keep.
    if (host === null || servesGroundingRedirect(host, href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ url: href });
  }
  return out;
}

function fingerprintOf(opts) {
  return opts && typeof opts === "object" && typeof opts.postingFingerprint === "string"
    ? opts.postingFingerprint
    : "";
}

function noResearch(postingFingerprint) {
  return { complete: false, researchedAt: null, postingFingerprint, items: [], reason: "no-research" };
}

/**
 * The three-way branch: no-research / unsourced / complete. Sync, pure, never
 * throws (any unexpected shape lands on the no-research refusal).
 *
 * @param {unknown} digest  an application_digests row, or null/absent
 * @param {{ postingFingerprint?: string }} [opts]
 */
export function adaptDigestToEvidence(digest, opts) {
  const postingFingerprint = fingerprintOf(opts);
  try {
    if (
      !digest ||
      typeof digest !== "object" ||
      digest.status !== "ready" ||
      typeof digest.markdown !== "string" ||
      digest.markdown.trim() === ""
    ) {
      return noResearch(postingFingerprint);
    }
    const citations = evidenceCitations(digest.sources);
    const sourced = citations.length > 0;
    return {
      complete: sourced,
      researchedAt: typeof digest.researched_at === "string" ? digest.researched_at : null,
      postingFingerprint,
      items: [{ topicHint: "", text: digest.markdown, citations, sourced }],
      reason: sourced ? null : "unsourced",
    };
  } catch {
    return noResearch(postingFingerprint);
  }
}

/**
 * Read the digest through the injected reader and adapt it. The reader may
 * throw synchronously or reject later (a database that is down); either way
 * this RESOLVES to the no-research refusal rather than rejecting, because a
 * propagated rejection becomes a 500 at the route instead of an honest "could
 * not research".
 *
 * The items list is deliberately a list: the digest-primary path emits one
 * item today, and per-section items (or pack enrichment) are a later chunk's
 * concern -- callers must iterate, not assume length 1.
 *
 * @param {{ readDigest: (applicationId: string, userId: string) => unknown }} deps
 * @param {{ applicationId: string, userId: string, postingFingerprint?: string }} args
 * @returns {Promise<ReturnType<typeof adaptDigestToEvidence>>}
 */
export async function gatherEvidence(deps, args) {
  const opts = { postingFingerprint: args?.postingFingerprint };
  try {
    const row = await deps.readDigest(args?.applicationId, args?.userId);
    return adaptDigestToEvidence(row ?? null, opts);
  } catch {
    return adaptDigestToEvidence(null, opts);
  }
}
