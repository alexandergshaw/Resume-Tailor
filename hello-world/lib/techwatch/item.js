// The normalized briefing-item contract every Tech Watch source produces.
//
// Every source adapter (statuspage, osv, kev, endoflife) builds a raw object
// in its own shape and hands it to normalizeItem before it ever reaches a
// bucket, a cache, or the UI. Keeping that one narrow waist here means a
// source can be sloppy (missing arrays, an offset timestamp, a javascript:
// link) without corrupting sort order or opening an XSS vector downstream.

export const CATEGORIES = ["outage", "vulnerability", "lifecycle"];
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const TIME_PRECISIONS = ["minute", "day"];

// CISA's KEV feed dates entries up to roughly a day ahead of when the rest of
// the feed catches up, so a hard `<= now` in withinWindow would hide the
// newest exploit on the day it matters most. 48h gives that slack without
// letting a months-out lifecycle date (which belongs in the support table,
// not the timeline) sneak into the window.
export const FUTURE_TOLERANCE_HOURS = 48;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function toIsoStringOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeSources(rawSources) {
  if (!Array.isArray(rawSources)) return [];
  const out = [];
  for (const entry of rawSources) {
    if (!entry || typeof entry !== "object") continue;
    const url = typeof entry.url === "string" ? entry.url : "";
    if (!url) continue;
    // Reject anything that isn't http(s) - a `javascript:` or `data:` URL
    // handed through unchanged would execute if a card ever rendered it as a
    // real link.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    out.push({ label: isNonEmptyString(entry.label) ? entry.label : "", url });
  }
  return out;
}

function normalizeCveIds(rawCveIds) {
  if (!Array.isArray(rawCveIds)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawCveIds) {
    if (typeof raw !== "string") continue;
    const upper = raw.toUpperCase();
    if (seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
  }
  return out;
}

// Returns a fully-shaped item or null. Never throws, never returns a partial
// object - a source that hands back a bad occurredAt or a blank title gets
// the whole item silently dropped rather than shipping a broken card.
export function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = isNonEmptyString(raw.id) ? raw.id.trim() : "";
  if (!id) return null;

  const title = isNonEmptyString(raw.title) ? raw.title.trim() : "";
  if (!title) return null;

  if (!CATEGORIES.includes(raw.category)) return null;

  const occurredAt = toIsoStringOrNull(raw.occurredAt);
  if (!occurredAt) return null;

  const severity = SEVERITIES.includes(raw.severity) ? raw.severity : "info";
  const timePrecision = TIME_PRECISIONS.includes(raw.timePrecision)
    ? raw.timePrecision
    : "minute";

  return {
    id,
    sourceId: isNonEmptyString(raw.sourceId) ? raw.sourceId : "",
    category: raw.category,
    severity,
    title,
    technologyId: isNonEmptyString(raw.technologyId) ? raw.technologyId : "",
    technology: isNonEmptyString(raw.technology) ? raw.technology : "",
    affected: isNonEmptyString(raw.affected) ? raw.affected : "",
    occurredAt,
    timePrecision,
    status: isNonEmptyString(raw.status) ? raw.status : "",
    summary: isNonEmptyString(raw.summary) ? raw.summary : "",
    rootCause: isNonEmptyString(raw.rootCause) ? raw.rootCause : "",
    remedy: isNonEmptyString(raw.remedy) ? raw.remedy : "",
    workaround: isNonEmptyString(raw.workaround) ? raw.workaround : "",
    exploited: Boolean(raw.exploited),
    exploitedAt: isNonEmptyString(raw.exploitedAt) ? raw.exploitedAt : null,
    cveIds: normalizeCveIds(raw.cveIds),
    sources: normalizeSources(raw.sources),
  };
}

export function severityRank(severity) {
  const idx = SEVERITIES.indexOf(severity);
  return idx === -1 ? SEVERITIES.length - 1 : idx;
}

// Newest first, worst severity first, then title, then id. The id fallback is
// what makes this a TOTAL order: without it, two items alike in every visible
// field compare equal and Array.prototype.sort is free to leave their
// relative order to engine whim, which would make the briefing reshuffle on
// every reload for no reason a user could see.
export function compareItems(a, b) {
  if (a.occurredAt !== b.occurredAt) {
    return a.occurredAt < b.occurredAt ? 1 : -1;
  }
  const rankDiff = severityRank(a.severity) - severityRank(b.severity);
  if (rankDiff !== 0) return rankDiff;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

// Bounded on both sides: recent enough to belong in the timeline, and not so
// far in the future that a months-out lifecycle date crowds out what actually
// happened this hour. See FUTURE_TOLERANCE_HOURS above for why the upper
// bound exists at all.
export function withinWindow(item, { now, windowHours }) {
  if (!item || !item.occurredAt) return false;
  const occurred = new Date(item.occurredAt).getTime();
  if (Number.isNaN(occurred)) return false;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const lower = nowMs - windowHours * 3600e3;
  const upper = nowMs + FUTURE_TOLERANCE_HOURS * 3600e3;
  return occurred >= lower && occurred <= upper;
}
