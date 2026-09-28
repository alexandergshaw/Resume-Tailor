// ---------------------------------------------------------------------------
// N65 — the pure salary-estimate builder.
//
// THIS FILE IS THE FEATURE'S WHOLE GUARANTEE, in one place: a compensation
// NUMBER is reachable ONLY past a `cites.length === 0` early return, only
// when the model actually searched, and only when a real two-bound range
// parses off the fixed `ESTIMATE:` envelope line. Every other path is a
// WITHHOLD, never a fabricated figure -- that early return is what separates
// this from a chatbot guessing (app-vs-chat REMOVAL test, S13). Do not move
// it, do not duplicate it, do not make it conditional.
//
// EXPORT SURFACE. Only `buildSalaryEstimate` is exported (plan P-R2):
// `parseEstimateRange`, `usableCitations` and `deriveBasisKind` stay
// module-private, reached only through the public builder, so the
// export-reachability census (lib/sourceScan/exportReachability.sweep.test.js)
// gains no test-only export. `postingSalaryStated` is added in a later step,
// with its own production importer, and is deliberately not here yet.
// ---------------------------------------------------------------------------

import { citationHref, citationHost, servesGroundingRedirect } from "../tracking/citationHref.js";
import { citationTitle } from "../tracking/citationLabel.js";
import { parseSalary } from "../feed/salary.js";

// Reads ONLY the first `ESTIMATE:` line the model produced -- scanning the
// whole prose for a stray number is deliberately NOT done, or an incidental
// figure could become "the salary" (S3's failure direction). An explicit
// "ESTIMATE: none" or a missing envelope line both withhold; so does a
// single-bound figure -- a range needs BOTH bounds.
const ESTIMATE_LINE_RE = /^\s*estimate:\s*(.*)$/im;

function parseEstimateRange(outputText) {
  if (typeof outputText !== "string" || outputText.length === 0) return null;
  const match = outputText.match(ESTIMATE_LINE_RE);
  if (!match) return null;
  const rest = match[1].trim();
  if (!rest || /^none\b/i.test(rest)) return null;
  // parseSalary already applies normalizeSalaryPair's band clamp (lib/feed/salary.js).
  const { min, max } = parseSalary(rest);
  if (min == null || max == null) return null;
  return { min, max };
}

// The structured citations that survive the URL control (S5/S6). A
// `vertexaisearch.cloud.google.com` grounding redirect is dropped before it
// can ever become a link or count toward the >=1-citation gate -- the exact
// class of dead-link-labelled-with-a-real-domain this repo has shipped
// before (memory gemini-grounding-redirects).
function usableCitations(sources) {
  if (!Array.isArray(sources)) return [];
  const seen = new Set();
  const out = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const href = citationHref(source.uri);
    if (href === null) continue;
    const host = citationHost(href);
    if (host === null || servesGroundingRedirect(host, href)) continue;
    const key = `${host}\u0000${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: href, title: citationTitle(source.title), host });
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// S7 support-vs-membership: "company" only when a surviving citation's TITLE
// (as a whole word) or HOST (as a whole domain label) actually names the
// company -- never a bare substring match. That is what keeps company
// "Meta" from claiming company-specificity off a citation whose host is
// merely metafilter.com (K8): "meta" is a substring of "metafilter" but is
// never a whole word in its title and never a whole label of its host.
function citationNamesCompany(citation, token) {
  if (!token) return false;
  const titleRe = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
  if (titleRe.test(citation.title || "")) return true;
  const labels = String(citation.host || "").toLowerCase().split(/[.-]/).filter(Boolean);
  return labels.includes(token);
}

function deriveBasisKind(citations, company) {
  if (!Array.isArray(citations) || citations.length === 0) return "none";
  const token = String(company || "").trim().toLowerCase();
  if (token && citations.some((c) => citationNamesCompany(c, token))) return "company";
  return "comparable";
}

/**
 * The one builder the route calls. Pure, total, never throws.
 *
 * @param {{outputText: string, sources: Array, searched: boolean, truncated: boolean, company: string}} params
 * @returns {{status: string, reason: string, range: {min:number,max:number}|null, basisKind: string, sourceCount: number, citations: Array, searched: boolean, truncated: boolean}}
 */
export function buildSalaryEstimate({ outputText, sources, searched, truncated, company }) {
  const cites = usableCitations(sources);
  const isSearched = !!searched;
  const isTruncated = !!truncated;

  // No proof of search means retrieval degraded -- this is a failure the
  // caller renders as "couldn't check", never a negative (S6/S14).
  if (!isSearched) {
    return {
      status: "failed",
      reason: "not_searched",
      range: null,
      basisKind: "none",
      sourceCount: 0,
      citations: [],
      searched: isSearched,
      truncated: isTruncated,
    };
  }

  // THE REMOVAL-TEST GATE (S2/S13). A number is reachable only past this
  // return. Do not move it, do not duplicate it, do not make it conditional.
  if (cites.length === 0) {
    return {
      status: "insufficient_sources",
      reason: "no_sources",
      range: null,
      basisKind: "none",
      sourceCount: 0,
      citations: [],
      searched: isSearched,
      truncated: isTruncated,
    };
  }

  const range = parseEstimateRange(outputText);
  if (!range) {
    return {
      status: "insufficient_sources",
      reason: "no_range",
      range: null,
      basisKind: "none",
      sourceCount: cites.length,
      citations: [],
      searched: isSearched,
      truncated: isTruncated,
    };
  }

  return {
    status: "estimated",
    reason: "ok",
    range,
    basisKind: deriveBasisKind(cites, company),
    sourceCount: cites.length,
    citations: cites,
    searched: isSearched,
    truncated: isTruncated,
  };
}
