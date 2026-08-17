// Deriving "which technologies does this user actually work with" from their
// own project pages, so the Tech Watch briefing is scoped to the user's real
// stack instead of being generic tech news.
//
// Pure and synchronous by design: this runs once per API request over
// whatever `listPages` already returned, with no network or clock of its own.

import { CATALOG, DEFAULT_WATCHLIST_IDS, MAX_WATCHLIST, catalogEntry } from "./catalog.js";

const VERSION_CAP = 5;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest alias first: for an entry like nextjs (aliases nextjs / next.js /
// next), trying "next" before "next.js" would let the shorter alternative
// win the match at the same start position and never give "next.js" the
// chance to consume the full word. Word boundaries alone don't fix this -
// alternation order does.
function aliasAlternation(aliases) {
  return [...aliases].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
}

function buildAliasRegex(aliases) {
  return new RegExp(`\\b(?:${aliasAlternation(aliases)})\\b`, "gi");
}

// A version is "adjacent" to the name when an optional `v`, `@`, or the
// literal word `version` sits between them - `React 17`, `react v18.2`,
// `React@19`, `Node.js version 20`. The capture is mandatory (no trailing
// `?`) so a bare mention with no number simply produces no match here at
// all; hits/detection are counted separately by buildAliasRegex.
function buildVersionRegex(aliases) {
  const alt = aliasAlternation(aliases);
  return new RegExp(`\\b(?:${alt})\\b[ \\t]*(?:(?:version|v|@)[ \\t]*)?(\\d+(?:\\.\\d+)*)`, "gi");
}

function pageText(page) {
  if (!page || typeof page !== "object") return "";
  const title = typeof page.title === "string" ? page.title : "";
  const body = typeof page.body === "string" ? page.body : "";
  return `${title}\n${body}`;
}

// A deep copy, not `{...catalogEntry(id)}`: a shallow spread still shares the
// nested `osv` object and `aliases` array with the module-level CATALOG, and
// one downstream write (a caller mutating its own watchlist entry) would then
// corrupt that shared catalog for the life of the Node process, for every
// user, not just the one who wrote to it.
function deepCopyEntry(entry) {
  return {
    id: entry.id,
    label: entry.label,
    aliases: [...entry.aliases],
    osv: entry.osv ? { ...entry.osv } : null,
    eol: entry.eol,
    statuspage: entry.statuspage ? { ...entry.statuspage } : null,
    kev: entry.kev ? [...entry.kev] : null,
  };
}

export function deriveWatchlist(pages, options = {}) {
  const catalog = Array.isArray(options.catalog) ? options.catalog : CATALOG;
  const defaults = Array.isArray(options.defaults) ? options.defaults : DEFAULT_WATCHLIST_IDS;
  const max = typeof options.max === "number" ? options.max : MAX_WATCHLIST;

  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const orderIndex = new Map(catalog.map((entry, i) => [entry.id, i]));
  const list = Array.isArray(pages) ? pages : [];

  // id -> { hits, detectedIn: string[], versions: string[] }
  const stats = new Map();

  for (const page of list) {
    if (!page || typeof page !== "object") continue;
    // A page this app generated itself (a research report, a cover letter
    // draft, ...) is evidence the user pressed a button, not evidence they
    // run whatever technology it happens to discuss.
    if (page.generated_kind) continue;

    const text = pageText(page);
    if (!text.trim()) continue;

    for (const entry of catalog) {
      const hitMatches = text.match(buildAliasRegex(entry.aliases));
      if (!hitMatches || hitMatches.length === 0) continue;

      let s = stats.get(entry.id);
      if (!s) {
        s = { hits: 0, detectedIn: [], versions: [] };
        stats.set(entry.id, s);
      }
      s.hits += hitMatches.length;

      if (page.id !== undefined && page.id !== null && !s.detectedIn.includes(page.id)) {
        s.detectedIn.push(page.id);
      }

      if (s.versions.length < VERSION_CAP) {
        const versionRegex = buildVersionRegex(entry.aliases);
        let m = versionRegex.exec(text);
        while (m !== null && s.versions.length < VERSION_CAP) {
          const version = m[1];
          if (version && !s.versions.includes(version)) {
            s.versions.push(version);
          }
          m = versionRegex.exec(text);
        }
      }
    }
  }

  const usedDefaults = stats.size === 0;
  let idsInOrder;
  if (usedDefaults) {
    // The fallback is a common early-stack-building state, not an error -
    // and it comes back in DEFAULT_WATCHLIST_IDS order, never catalog order.
    idsInOrder = defaults;
  } else {
    idsInOrder = [...stats.keys()].sort((a, b) => {
      const hitsDiff = stats.get(b).hits - stats.get(a).hits;
      if (hitsDiff !== 0) return hitsDiff;
      return orderIndex.get(a) - orderIndex.get(b);
    });
  }

  const truncated = idsInOrder.length > max;
  const limitedIds = idsInOrder.slice(0, max);

  const entries = limitedIds
    .map((id) => catalogById.get(id))
    .filter(Boolean)
    .map((entry) => {
      const s = usedDefaults ? null : stats.get(entry.id);
      return {
        ...deepCopyEntry(entry),
        detectedIn: s ? [...s.detectedIn] : [],
        detectedVersions: s ? [...s.versions] : [],
        hits: s ? s.hits : 0,
      };
    });

  return { entries, usedDefaults, truncated };
}
