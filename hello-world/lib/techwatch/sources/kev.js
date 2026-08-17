// ---------------------------------------------------------------------------
// CISA's Known Exploited Vulnerabilities catalogue.
//
// KEV names vendors the way a procurement department does ("Apache",
// "Microsoft") and never names a JavaScript framework, so this file has two
// jobs: direct matches against the infrastructure a watchlist entry names
// (parseKevCatalog), and a raw CVE -> dateAdded lookup (kevCveSet) that lets
// collect.js's cross-mark find out an OSV advisory for `next` is being
// exploited in the wild even though CISA never wrote the word "React".
//
// The feed is fetched once per request, globally — not once per technology —
// which is why the fetcher here hands back the parsed json itself rather than
// items: the collector runs both parsers below against that one payload.
// ---------------------------------------------------------------------------

import { normalizeItem, withinWindow } from "../item.js";

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary, case-insensitive: "ray" must match "Ray-Project Ray" but not
// "Arrayed Xray toolkit", where "ray" only ever appears mid-word.
function matchesEntry(haystack, matchers) {
  return matchers.some((m) => new RegExp(`\\b${escapeRegExp(m)}\\b`, "i").test(haystack));
}

// notes is a loose, human-written field: URLs separated by whitespace and/or
// semicolons, sometimes prefixed with a label ("BOD 26-04: https://..."). We
// only need the URLs themselves — the prefixes are CISA's own commentary, not
// documentation links worth surfacing as a source.
function extractNoteLinks(notes) {
  if (typeof notes !== "string" || !notes) return [];
  const urls = notes.match(/https?:\/\/[^\s;]+/g) || [];
  const out = [];
  const seen = new Set();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    let label;
    try {
      label = new URL(url).hostname;
    } catch {
      continue;
    }
    out.push({ label, url });
    if (out.length >= 4) break;
  }
  return out;
}

function buildKevItem(vuln, entry) {
  const cveID = typeof vuln.cveID === "string" ? vuln.cveID.trim().toUpperCase() : "";
  if (!cveID) return null;
  const dateAdded = typeof vuln.dateAdded === "string" ? vuln.dateAdded : "";
  if (!dateAdded) return null;

  return {
    id: `kev:${entry.id}:${cveID}`,
    sourceId: "kev",
    category: "vulnerability",
    // Being listed at all is already "actively exploited"; a known ransomware
    // campaign is the one signal CISA gives us to rate that worse than a
    // generic KEV entry.
    severity: vuln.knownRansomwareCampaignUse === "Known" ? "critical" : "high",
    title: typeof vuln.vulnerabilityName === "string" ? vuln.vulnerabilityName : "",
    technologyId: entry.id,
    technology: entry.label,
    // The catalogue only ever dates entries to the day, never the hour — a
    // fabricated time-of-day would claim a precision CISA never published.
    occurredAt: `${dateAdded}T00:00:00.000Z`,
    timePrecision: "day",
    status: "exploited",
    rootCause: typeof vuln.shortDescription === "string" ? vuln.shortDescription : "",
    remedy: typeof vuln.requiredAction === "string" ? vuln.requiredAction : "",
    workaround: "",
    exploited: true,
    // Bare "YYYY-MM-DD", not the datetime above — this is the field §6.4's
    // lifecycle events also use, and the collector's cross-mark compares them
    // directly, so the two sources have to agree on shape.
    exploitedAt: dateAdded,
    cveIds: [cveID],
    sources: extractNoteLinks(vuln.notes),
  };
}

export function parseKevCatalog(json, { entries, now, windowHours }) {
  const vulnerabilities = Array.isArray(json?.vulnerabilities) ? json.vulnerabilities : [];
  const items = [];
  for (const entry of entries || []) {
    const matchers = Array.isArray(entry?.kev) ? entry.kev : null;
    if (!matchers || matchers.length === 0) continue; // kev: null never matches

    // The live feed genuinely repeats rows for the same CVE; without this,
    // a re-listed row would render the same card twice in the same hour.
    const seenCveIds = new Set();
    for (const vuln of vulnerabilities) {
      if (!vuln || typeof vuln !== "object") continue;
      const haystack = `${vuln.vendorProject || ""} ${vuln.product || ""}`;
      if (!matchesEntry(haystack, matchers)) continue;

      const raw = buildKevItem(vuln, entry);
      if (!raw) continue;
      const key = raw.cveIds[0];
      if (seenCveIds.has(key)) continue;
      seenCveIds.add(key);

      const item = normalizeItem(raw);
      if (item && withinWindow(item, { now, windowHours })) items.push(item);
    }
  }
  return items;
}

// Every CVE in the feed, mapped to the date CISA catalogued it — unfiltered
// by window or watchlist. Membership alone isn't enough for the cross-mark in
// collect.js: it re-dates an advisory to the day it became known-exploited,
// which means it needs the date even for an advisory added years ago.
export function kevCveSet(json) {
  const map = new Map();
  const vulnerabilities = Array.isArray(json?.vulnerabilities) ? json.vulnerabilities : [];
  for (const vuln of vulnerabilities) {
    if (!vuln || typeof vuln !== "object") continue;
    const cveID = typeof vuln.cveID === "string" ? vuln.cveID.trim().toUpperCase() : "";
    if (!cveID) continue;
    const dateAdded = typeof vuln.dateAdded === "string" ? vuln.dateAdded : "";
    if (!dateAdded) continue;
    map.set(cveID, dateAdded);
  }
  return map;
}

// Returns the raw parsed json, not items: the collector fetches this feed
// once globally and hands the same payload to both parseKevCatalog (per
// watchlist entry) and kevCveSet (for the cross-mark), so re-fetching per
// caller would be wasteful and parsing here would force a shape neither
// caller actually wants.
export async function fetchKevCatalog({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(KEV_URL);
    if (!res.ok) {
      return { ok: false, json: null, error: `CISA KEV request failed with status ${res.status}` };
    }
    const json = await res.json();
    return { ok: true, json, error: null };
  } catch (err) {
    return { ok: false, json: null, error: err instanceof Error ? err.message : String(err) };
  }
}
