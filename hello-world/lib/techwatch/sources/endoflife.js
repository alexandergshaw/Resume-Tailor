// ---------------------------------------------------------------------------
// Lifecycle / decommission data from endoflife.date.
//
// This produces two different things from one payload: `lifecycle`, the
// standing "which of my versions are dead or dying" table (never
// window-scoped — it has to still answer that question on a quiet day with
// no news), and `items`, the subset of lifecycle transitions that actually
// fall inside the requested window (§2's withinWindow, both-sided).
//
// The one property of the real payload that makes this file more than a
// pass-through: endoflife.date's `eol` and `support` fields are EITHER an
// ISO date string OR a boolean. `new Date(false)` is 1970 and `new
// Date(true)` is 1970 plus a millisecond — neither throws, so a parser that
// forgets this quietly reports every supported release as having died at the
// epoch. A boolean here always means "nothing announced yet", never a date.
// ---------------------------------------------------------------------------

import { normalizeItem, withinWindow } from "../item.js";

// See the file banner: booleans mean "nothing announced", not a date, no
// matter which boolean value endoflife.date sent.
function dateFieldOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function hasPassed(dateStr, nowMs) {
  const t = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return !Number.isNaN(t) && t <= nowMs;
}

// endoflife.date makes no ordering guarantee across its 464 products, so the
// sort has to compare cycle numbers explicitly rather than trust payload
// order — plain string comparison would put "3.9" above "3.14".
function compareCyclesDesc(a, b) {
  const as = String(a).split(".");
  const bs = String(b).split(".");
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = Number.parseInt(as[i], 10);
    const bv = Number.parseInt(bs[i], 10);
    const an = Number.isNaN(av) ? -Infinity : av;
    const bn = Number.isNaN(bv) ? -Infinity : bv;
    if (an !== bn) return bn - an;
  }
  return 0;
}

// A detected version marks a cycle only on a dot boundary: "18.2.0" marks
// cycle "18", but "1" must not also mark "19" or "15" just because it is a
// string prefix of them.
function versionMatchesCycle(version, cycle) {
  return version === cycle || version.startsWith(`${cycle}.`);
}

function buildLifecycleRow(row, entry, nowMs) {
  const cycle = typeof row.cycle === "string" ? row.cycle.trim() : String(row.cycle ?? "").trim();
  if (!cycle) return null;

  const eolAt = dateFieldOrNull(row.eol);
  const supportEndsAt = dateFieldOrNull(row.support);

  let state;
  if (eolAt !== null && hasPassed(eolAt, nowMs)) {
    state = "unsupported";
  } else if (supportEndsAt !== null && hasPassed(supportEndsAt, nowMs)) {
    state = "security-only";
  } else {
    state = "supported";
  }

  const detectedVersions = Array.isArray(entry.detectedVersions) ? entry.detectedVersions : [];
  const inUse = detectedVersions.some(
    (v) => typeof v === "string" && versionMatchesCycle(v, cycle),
  );

  return {
    technologyId: entry.id,
    technology: entry.label,
    cycle,
    latest: typeof row.latest === "string" ? row.latest : null,
    releasedAt: dateFieldOrNull(row.releaseDate),
    supportEndsAt,
    eolAt,
    state,
    inUse,
  };
}

function buildLifecycleEventItem(row, entry, field) {
  const at = field === "eol" ? row.eolAt : row.supportEndsAt;
  if (at === null) return null;
  const newestCycle = row._newestCycle;

  return {
    id: `endoflife:${entry.id}:${row.cycle}:${field}`,
    sourceId: "endoflife",
    category: "lifecycle",
    severity: field === "eol" ? "high" : "medium",
    title:
      field === "eol"
        ? `${entry.label} ${row.cycle} reached end of life`
        : `${entry.label} ${row.cycle} reached end of active support`,
    technologyId: entry.id,
    technology: entry.label,
    affected: "",
    occurredAt: `${at}T00:00:00.000Z`,
    timePrecision: "day",
    status: field === "eol" ? "unsupported" : "security-only",
    summary: "",
    rootCause: "",
    remedy: `Upgrade to ${entry.label} ${newestCycle}`,
    workaround: "",
    exploited: false,
    exploitedAt: null,
    cveIds: [],
    sources: [{ label: "endoflife.date", url: `https://endoflife.date/${entry.eol}` }],
  };
}

// -> { items, lifecycle }
export function parseEolCycles(json, { entry, now, windowHours }) {
  if (!Array.isArray(json)) return { items: [], lifecycle: [] };

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  const lifecycle = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const built = buildLifecycleRow(row, entry, nowMs);
    if (built) lifecycle.push(built);
  }
  lifecycle.sort((a, b) => compareCyclesDesc(a.cycle, b.cycle));

  if (lifecycle.length === 0) return { items: [], lifecycle: [] };

  // remedy always points at the newest cycle AFTER the sort above, never
  // whichever row happened to arrive first in the payload.
  const newestCycle = lifecycle[0].cycle;

  const items = [];
  for (const row of lifecycle) {
    for (const field of ["eol", "support"]) {
      const raw = buildLifecycleEventItem({ ...row, _newestCycle: newestCycle }, entry, field);
      if (!raw) continue;
      const item = normalizeItem(raw);
      if (item && withinWindow(item, { now, windowHours })) items.push(item);
    }
  }

  return { items, lifecycle };
}

export async function fetchEolCycles({ entry, fetchImpl = globalThis.fetch, now, windowHours }) {
  // TypeScript is the canonical case: endoflife.date does not carry it at
  // all, and guessing a slug would 404 forever and read on screen as an
  // outage at endoflife.date rather than "we never had this feed".
  if (!entry || entry.eol === null || entry.eol === undefined) {
    return { ok: true, items: [], lifecycle: [], error: null };
  }
  try {
    const res = await fetchImpl(`https://endoflife.date/api/${entry.eol}.json`);
    if (!res.ok) {
      return {
        ok: false,
        items: [],
        lifecycle: [],
        error: `endoflife.date request for ${entry.eol} failed with status ${res.status}`,
      };
    }
    const json = await res.json();
    const { items, lifecycle } = parseEolCycles(json, { entry, now, windowHours });
    return { ok: true, items, lifecycle, error: null };
  } catch (err) {
    return {
      ok: false,
      items: [],
      lifecycle: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
