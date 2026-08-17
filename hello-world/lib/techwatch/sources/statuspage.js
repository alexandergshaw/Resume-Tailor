// ---------------------------------------------------------------------------
// Outages and planned maintenance, from Atlassian Statuspage's public feeds.
//
// Every vendor on Statuspage serves the same two endpoints under its own
// host: incidents.json for what is (or was) actually broken, and
// scheduled-maintenances.json for what the vendor is telling customers is
// coming. They are genuinely separate documents — reading the wrong one
// would either miss planned work entirely or double-report every outage
// as a "maintenance" too, so the two parsers below never share a fetch.
// ---------------------------------------------------------------------------

import { normalizeItem, withinWindow } from "../item.js";

function toTime(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

// Statuspage does not promise incident_updates arrive in any particular
// order, so "the newest update" is always resolved by comparing created_at
// — never by array position, and never by assuming index 0 is latest.
function newestUpdate(updates, filterFn) {
  let best = null;
  let bestTime = -Infinity;
  for (const update of updates) {
    if (!update || typeof update !== "object") continue;
    if (filterFn && !filterFn(update)) continue;
    const t = toTime(update.created_at);
    if (t > bestTime) {
      bestTime = t;
      best = update;
    }
  }
  return best;
}

function isPostmortemUpdate(update) {
  return update.status === "postmortem";
}

function isIdentifiedUpdate(update) {
  return update.status === "identified";
}

function isResolvedUpdate(update) {
  return update.status === "resolved";
}

function impactToSeverity(impact) {
  if (impact === "critical") return "critical";
  if (impact === "major") return "high";
  if (impact === "minor") return "medium";
  return "info";
}

// Shared shape between an incident and a scheduled maintenance — Statuspage
// gives both the same fields (id, name, status, impact, updates, shortlink,
// components), and the only real differences are the id prefix and, for a
// maintenance, that status/severity are fixed rather than read from the
// payload (a maintenance's own `impact` is usually the literal string
// "maintenance", which is not a severity).
function buildStatuspageItem(incident, { entry, prefix, forceSeverity, forceStatus }) {
  if (!incident || typeof incident !== "object") return null;
  const id = typeof incident.id === "string" ? incident.id.trim() : "";
  if (!id) return null;

  const updates = Array.isArray(incident.incident_updates) ? incident.incident_updates : [];
  const newest = newestUpdate(updates, null);
  // This fallback chain is load-bearing, not defensive filler: real feeds
  // serve incidents with an empty incident_updates array. Without falling
  // back through updated_at to created_at, occurredAt would be undefined,
  // normalizeItem would drop the item, and the outage would vanish from the
  // briefing with nothing in `sources` to say why.
  const occurredAt = (newest && newest.created_at) || incident.updated_at || incident.created_at;

  const rootCauseUpdate =
    newestUpdate(updates, isPostmortemUpdate) || newestUpdate(updates, isIdentifiedUpdate);
  const resolvedUpdate = newestUpdate(updates, isResolvedUpdate);

  const components = Array.isArray(incident.components) ? incident.components : [];
  const affected = components
    .map((c) => (c && typeof c.name === "string" ? c.name : ""))
    .filter(Boolean)
    .join(", ");

  const shortlink = typeof incident.shortlink === "string" ? incident.shortlink : "";
  const vendor = entry?.statuspage?.vendor || entry?.label || "";

  return {
    id: `${prefix}:${entry.id}:${id}`,
    sourceId: "statuspage",
    category: "outage",
    severity: forceSeverity || impactToSeverity(incident.impact),
    title: typeof incident.name === "string" ? incident.name : "",
    technologyId: entry.id,
    technology: entry.label,
    affected,
    occurredAt,
    timePrecision: "minute",
    status: forceStatus || (typeof incident.status === "string" ? incident.status : ""),
    summary: newest ? newest.body : "",
    // Never the generic "we are continuing to investigate" text — a blank
    // rootCause is the honest state until the vendor names a cause or ships
    // a postmortem, and the UI is expected to say so rather than paraphrase
    // the investigating update as if it were an explanation.
    rootCause: rootCauseUpdate ? rootCauseUpdate.body : "",
    remedy: resolvedUpdate ? resolvedUpdate.body : "",
    workaround: "",
    exploited: false,
    exploitedAt: null,
    cveIds: [],
    sources: shortlink ? [{ label: `${vendor} status`, url: shortlink }] : [],
  };
}

export function parseStatuspageIncidents(json, { entry, now, windowHours }) {
  const incidents = Array.isArray(json?.incidents) ? json.incidents : [];
  const items = [];
  for (const incident of incidents) {
    const raw = buildStatuspageItem(incident, { entry, prefix: "statuspage" });
    const item = raw && normalizeItem(raw);
    if (item && withinWindow(item, { now, windowHours })) items.push(item);
  }
  return items;
}

// Reads scheduled_maintenances, never incidents — a fallback to the incidents
// array here would silently double-report every outage as a maintenance too,
// since both endpoints share a host and a rough shape.
export function parseStatuspageMaintenances(json, { entry, now, windowHours }) {
  const maintenances = Array.isArray(json?.scheduled_maintenances) ? json.scheduled_maintenances : [];
  const items = [];
  for (const maintenance of maintenances) {
    const raw = buildStatuspageItem(maintenance, {
      entry,
      prefix: "statuspage-maint",
      forceSeverity: "info",
      forceStatus: "scheduled",
    });
    const item = raw && normalizeItem(raw);
    if (item && withinWindow(item, { now, windowHours })) items.push(item);
  }
  return items;
}

// `missingFeedNote` is only ever passed by fetchStatuspageMaintenances (see
// below) — it is the one Statuspage endpoint some vendors never publish at
// all (real case: status.hashicorp.com 404s on scheduled-maintenances.json
// forever while serving incidents.json normally). A 404 there is a fact
// about the vendor, not an outage of ours, so it is reported as a success
// carrying an explanatory note rather than as a failed source. Any other
// non-ok status (500, 503, …) is left alone: only 404 means "no such feed",
// or the rule becomes a blanket excuse for the vendor actually being down.
async function fetchStatuspageFeed({ entry, path, fetchImpl, parse, now, windowHours, missingFeedNote }) {
  // No status page configured for this technology (e.g. React) is not a
  // failure to report — it is a coordinate the entry never had, so no
  // request is made and the fetcher succeeds with nothing.
  if (!entry?.statuspage) return { ok: true, items: [], error: null, note: null };
  const url = `https://${entry.statuspage.host}${path}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      if (missingFeedNote && res.status === 404) {
        return { ok: true, items: [], error: null, note: missingFeedNote };
      }
      return {
        ok: false,
        items: [],
        error: `Statuspage request to ${url} failed with status ${res.status}`,
        note: null,
      };
    }
    const json = await res.json();
    return { ok: true, items: parse(json, { entry, now, windowHours }), error: null, note: null };
  } catch (err) {
    // A network throw (DNS failure, timeout, abort) is exactly as much a
    // "source unreachable" as a non-ok response — both must surface as a
    // failed source row, never as an unhandled rejection.
    return { ok: false, items: [], error: err instanceof Error ? err.message : String(err), note: null };
  }
}

export async function fetchStatuspageIncidents({ entry, fetchImpl = globalThis.fetch, now, windowHours }) {
  return fetchStatuspageFeed({
    entry,
    path: "/api/v2/incidents.json",
    fetchImpl,
    parse: parseStatuspageIncidents,
    now,
    windowHours,
  });
}

export async function fetchStatuspageMaintenances({ entry, fetchImpl = globalThis.fetch, now, windowHours }) {
  return fetchStatuspageFeed({
    entry,
    path: "/api/v2/scheduled-maintenances.json",
    fetchImpl,
    parse: parseStatuspageMaintenances,
    now,
    windowHours,
    missingFeedNote: "no maintenance feed",
  });
}
