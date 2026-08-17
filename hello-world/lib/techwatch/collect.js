// ---------------------------------------------------------------------------
// Tech Watch collection: fan out to every public feed the watchlist implies,
// isolate each source's own failure, then perform the two joins that turn
// "four unrelated feeds" into a briefing worth reading:
//
//   1. the cross-mark - CISA's KEV catalogue tells us an advisory is being
//      actively exploited right now, even for a technology CISA never named
//      (it names "Apache", never "React" or "Next.js");
//   2. the cross-source merge - OSV and CISA frequently describe the exact
//      same CVE under two different ids, and a briefing that reports it
//      twice, in two different hour buckets, has told the reader nothing
//      more than a longer page would.
//
// Every worker below owns its own try/catch. runWithConcurrency swallows a
// worker's throw by design (see that file's own banner) - a worker here that
// didn't catch its own errors would make an entire feed vanish from
// `sources` with no trace, and the briefing would silently claim to be
// complete when it wasn't.
// ---------------------------------------------------------------------------

import { compareItems, severityRank, withinWindow } from "./item.js";
import { cached } from "./cache.js";
import { runWithConcurrency } from "@/lib/tailor/runWithConcurrency";
import { fetchStatuspageIncidents, fetchStatuspageMaintenances } from "./sources/statuspage.js";
import { fetchOsvVulns } from "./sources/osv.js";
import { fetchKevCatalog, parseKevCatalog, kevCveSet } from "./sources/kev.js";
import { fetchEolCycles } from "./sources/endoflife.js";

export const SOURCE_CACHE_TTL_SECONDS = 600;

// CISA typically lists a CVE weeks or months after the advisory describing
// it was first published, and the UI's longest window is 7 days - so a
// plain per-request windowHours on the OSV fetch would mean the advisory is
// already out of range by the time CISA gets around to flagging it, and the
// cross-mark below could essentially never fire in production even though
// its mechanism is fully covered by its own test. The fetch itself is
// widened to three years; the requested window is re-applied only at the
// very end, after the cross-mark has had the chance to re-date a
// newly-exploited old advisory back into range (see applyCrossMark below).
export const OSV_LOOKBACK_HOURS = 24 * 365 * 3;

const CONCURRENCY = 4;

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// The common shape every worker below resolves to: one `sources[]` row plus
// whatever items/lifecycle rows it contributed. `cveSet` is only ever
// populated by the single KEV worker.
function sourceOutcome({ meta, ok, error, items, lifecycle, cveSet }) {
  return {
    row: { ...meta, ok: Boolean(ok), error: error ?? null, itemCount: items.length },
    items,
    lifecycle: lifecycle || [],
    cveSet: cveSet || null,
  };
}

// Runs one task's producer. This is the ONE place that has to assume the
// producer (or the cache sitting in front of it) might throw instead of
// returning its usual { ok: false, error } shape - runWithConcurrency's own
// catch is empty by design, so if this function didn't also catch, a thrown
// cache write would take the whole source down without a trace.
async function runSourceTask(task) {
  try {
    return await task.run();
  } catch (err) {
    return sourceOutcome({ meta: task.meta, ok: false, error: errorMessage(err), items: [] });
  }
}

// Fetched once per collectTechWatch call, globally - never once per
// technology. The parsed payload feeds two different consumers: direct
// vendor matches (parseKevCatalog, scoped to entries whose `kev` matchers
// fire) and the raw CVE -> dateAdded lookup (kevCveSet) the cross-mark needs
// for every other source's items, watchlisted or not.
function buildKevTask({ entries, now, windowHours, fetchImpl, cacheImpl }) {
  const meta = { id: "kev", label: "CISA Known Exploited Vulnerabilities", technologyId: null, note: null };
  return {
    meta,
    run: async () => {
      const result = await cacheImpl("techwatch:kev", SOURCE_CACHE_TTL_SECONDS, () =>
        fetchKevCatalog({ fetchImpl }),
      );
      const ok = Boolean(result && result.ok);
      const json = ok ? result.json : null;
      const items = json ? parseKevCatalog(json, { entries, now, windowHours }) : [];
      const cveSet = json ? kevCveSet(json) : new Map();
      return sourceOutcome({ meta, ok, error: result ? result.error : "no result", items, cveSet });
    },
  };
}

// Statuspage contributes two independent rows per entry - incidents and
// scheduled maintenance are genuinely separate documents (see
// sources/statuspage.js's own banner), so a technology with no status page
// still gets both rows, both carrying the same "no status page" note.
//
// Some vendors on Statuspage serve incidents but never published a
// scheduled-maintenances feed at all (real case: status.hashicorp.com) - the
// endpoint 404s forever, which is a fact about the vendor, not an outage of
// our source. fetchStatuspageMaintenances (sources/statuspage.js) is the one
// that tells a 404 apart from a real failure and reports it as
// `{ ok: true, note: "no maintenance feed" }`; this module just reads that
// answer through rather than recomputing it.
function buildStatuspageTasks(entry, { now, windowHours, fetchImpl, cacheImpl }) {
  const label = entry.label || entry.id;
  const note = entry.statuspage ? null : "no status page";
  const incidentsMeta = { id: `statuspage:${entry.id}`, label: `${label} status page`, technologyId: entry.id, note };
  const maintMeta = {
    id: `statuspage-maint:${entry.id}`,
    label: `${label} scheduled maintenance`,
    technologyId: entry.id,
    note,
  };
  return [
    {
      meta: incidentsMeta,
      run: async () => {
        const result = await cacheImpl(`techwatch:statuspage:${entry.id}`, SOURCE_CACHE_TTL_SECONDS, () =>
          fetchStatuspageIncidents({ entry, fetchImpl, now, windowHours }),
        );
        return sourceOutcome({
          meta: incidentsMeta,
          ok: result && result.ok,
          error: result ? result.error : "no result",
          items: (result && result.items) || [],
        });
      },
    },
    {
      meta: maintMeta,
      run: async () => {
        const result = await cacheImpl(`techwatch:statuspage-maint:${entry.id}`, SOURCE_CACHE_TTL_SECONDS, () =>
          fetchStatuspageMaintenances({ entry, fetchImpl, now, windowHours }),
        );
        const rowMeta = { ...maintMeta, note: (result && result.note) ?? maintMeta.note };
        return sourceOutcome({
          meta: rowMeta,
          ok: Boolean(result && result.ok),
          error: result ? result.error : "no result",
          items: (result && result.items) || [],
        });
      },
    },
  ];
}

// The OSV fetch window is widened here (see OSV_LOOKBACK_HOURS above); the
// requested windowHours is applied only once, globally, at the very end of
// collectTechWatchInner.
function buildOsvTask(entry, { now, windowHours, fetchImpl, cacheImpl }) {
  const label = entry.label || entry.id;
  const meta = {
    id: `osv:${entry.id}`,
    label: `${label} package advisories`,
    technologyId: entry.id,
    note: entry.osv ? null : "no package feed",
  };
  return {
    meta,
    run: async () => {
      const result = await cacheImpl(`techwatch:osv:${entry.id}`, SOURCE_CACHE_TTL_SECONDS, () =>
        fetchOsvVulns({ entry, fetchImpl, now, windowHours: Math.max(windowHours, OSV_LOOKBACK_HOURS) }),
      );
      return sourceOutcome({
        meta,
        ok: result && result.ok,
        error: result ? result.error : "no result",
        items: (result && result.items) || [],
      });
    },
  };
}

function buildEndoflifeTask(entry, { now, windowHours, fetchImpl, cacheImpl }) {
  const label = entry.label || entry.id;
  const note = entry.eol === null || typeof entry.eol === "undefined" ? "no lifecycle feed" : null;
  const meta = { id: `endoflife:${entry.id}`, label: `${label} lifecycle`, technologyId: entry.id, note };
  return {
    meta,
    run: async () => {
      const result = await cacheImpl(`techwatch:endoflife:${entry.id}`, SOURCE_CACHE_TTL_SECONDS, () =>
        fetchEolCycles({ entry, fetchImpl, now, windowHours }),
      );
      return sourceOutcome({
        meta,
        ok: result && result.ok,
        error: result ? result.error : "no result",
        items: (result && result.items) || [],
        lifecycle: (result && result.lifecycle) || [],
      });
    },
  };
}

// Being listed in CISA's KEV catalogue *is* today's news, however old the
// underlying advisory is - so this doesn't just flip a boolean. When the KEV
// date is later than the item's own timestamp, the item is re-dated to the
// day CISA added it, so it actually lands in today's timeline instead of
// quietly sitting in an hour bucket from months ago that nobody is scrolled
// down to.
function applyCrossMark(items, cveMap) {
  if (!cveMap || cveMap.size === 0) return items;
  return items.map((item) => {
    if (!item.cveIds || item.cveIds.length === 0) return item;
    const matchedDates = item.cveIds.map((cve) => cveMap.get(cve)).filter(Boolean);
    if (matchedDates.length === 0) return item;
    // An item can in principle carry more than one CVE that's separately in
    // KEV; the latest date is the one worth surfacing as "today's news".
    const kevDate = matchedDates.reduce((latest, d) => (d > latest ? d : latest));
    const kevOccurredAt = `${kevDate}T00:00:00.000Z`;
    const ownIsAtLeastAsNew = item.occurredAt >= kevOccurredAt;
    return {
      ...item,
      exploited: true,
      // "critical" is already the worst rank in SEVERITIES, so assigning it
      // unconditionally here IS "raise, never lower": there is nowhere
      // higher to go, and an item that was already critical is unchanged.
      severity: "critical",
      exploitedAt: kevDate,
      occurredAt: ownIsAtLeastAsNew ? item.occurredAt : kevOccurredAt,
      timePrecision: ownIsAtLeastAsNew ? item.timePrecision : "day",
    };
  });
}

function isNonEmptySubset(small, big) {
  if (!small || small.length === 0) return false;
  const set = new Set(big || []);
  return small.every((cve) => set.has(cve));
}

function unionCveIds(a, b) {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}

function dedupeSources(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    if (!s || !s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

// Combines two items describing the same CVE under different ids. The
// survivor is whichever has the newer occurredAt (both are always
// normalizeItem-produced "...Z" strings, so plain string comparison sorts
// them correctly); it only "absorbs" fields it doesn't already have, so e.g.
// OSV's workaround text - which CISA never publishes - is never displaced by
// an empty string from the other side.
function combineItems(a, b) {
  const [survivor, other] = a.occurredAt >= b.occurredAt ? [a, b] : [b, a];
  return {
    ...survivor,
    severity: severityRank(other.severity) < severityRank(survivor.severity) ? other.severity : survivor.severity,
    exploited: survivor.exploited || other.exploited,
    exploitedAt: survivor.exploitedAt || other.exploitedAt,
    rootCause: survivor.rootCause || other.rootCause,
    remedy: survivor.remedy || other.remedy,
    workaround: survivor.workaround || other.workaround,
    cveIds: unionCveIds(survivor.cveIds, other.cveIds),
    sources: dedupeSources([...(survivor.sources || []), ...(other.sources || [])]),
  };
}

// An item merges into another when they share a technology and one's CVEs
// are a (possibly equal) subset of the other's - OSV and CISA routinely
// describe the exact same CVE under two different ids, and without this the
// briefing reports its single most severe finding twice, in two different
// hour buckets. Items with no CVEs at all (every outage, every lifecycle
// row) never match here: isNonEmptySubset requires a non-empty array on
// both sides, so this only ever touches vulnerability items.
function mergeCrossSourceItems(items) {
  const remaining = items.slice();
  const merged = [];
  while (remaining.length > 0) {
    let survivor = remaining.shift();
    let mergedSomething = true;
    while (mergedSomething) {
      mergedSomething = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const other = remaining[i];
        if (other.technologyId !== survivor.technologyId) continue;
        if (!isNonEmptySubset(other.cveIds, survivor.cveIds) && !isNonEmptySubset(survivor.cveIds, other.cveIds)) {
          continue;
        }
        survivor = combineItems(survivor, other);
        remaining.splice(i, 1);
        mergedSomething = true;
      }
    }
    merged.push(survivor);
  }
  return merged;
}

// `cacheImpl` defaults to the real `cached` from ./cache.js, and `fetchImpl`
// is left as `undefined` (every source adapter already defaults it to
// `globalThis.fetch` itself - see sources/{kev,osv,endoflife,statuspage}.js).
// These defaults matter because production calls this with exactly
// `{ entries, now, windowHours }` and nothing else (app/api/techwatch/route.js)
// - there is no test double in the real request path. Without a default,
// `cacheImpl` is `undefined`, every task throws "cacheImpl is not a
// function" on its very first line, runSourceTask's catch turns that into an
// ordinary-looking `{ ok: false, error }` row, and the whole thing degrades
// silently into a briefing with 41 failed sources and 0 items - it never
// throws, so nothing ever surfaces the break.
async function collectTechWatchInner({ entries, now, windowHours, fetchImpl, cacheImpl = cached }) {
  const safeNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const safeWindowHours = Number.isFinite(Number(windowHours)) ? Number(windowHours) : 24;
  const safeEntries = Array.isArray(entries) ? entries.filter((e) => e && typeof e.id === "string" && e.id) : [];
  const opts = { now: safeNow, windowHours: safeWindowHours, fetchImpl, cacheImpl };

  const tasks = [buildKevTask({ entries: safeEntries, ...opts })];
  for (const entry of safeEntries) {
    tasks.push(...buildStatuspageTasks(entry, opts));
    tasks.push(buildOsvTask(entry, opts));
    tasks.push(buildEndoflifeTask(entry, opts));
  }

  const outcomes = [];
  await runWithConcurrency(tasks, CONCURRENCY, async (task) => {
    outcomes.push(await runSourceTask(task));
  });

  const sources = [];
  let itemsPool = [];
  let lifecyclePool = [];
  let cveSet = new Map();
  for (const outcome of outcomes) {
    sources.push(outcome.row);
    itemsPool.push(...outcome.items);
    lifecyclePool.push(...outcome.lifecycle);
    if (outcome.cveSet) cveSet = outcome.cveSet;
  }

  itemsPool = applyCrossMark(itemsPool, cveSet);
  itemsPool = mergeCrossSourceItems(itemsPool);

  const byId = new Map();
  for (const item of itemsPool) {
    if (item && item.id) byId.set(item.id, item);
  }
  itemsPool = Array.from(byId.values()).filter((item) =>
    withinWindow(item, { now: safeNow, windowHours: safeWindowHours }),
  );
  itemsPool.sort(compareItems);

  return { items: itemsPool, lifecycle: lifecyclePool, sources };
}

// The collector must never throw and must always return the full
// { items, lifecycle, sources } shape, including for entries of [], null or
// undefined - a briefing page cannot afford to 500 just because the
// watchlist happened to be empty this request. Every source-level failure
// is already isolated by runSourceTask above; this outer try/catch is the
// last line of defense against a bug anywhere else in the pipeline.
export async function collectTechWatch(params = {}) {
  try {
    return await collectTechWatchInner(params);
  } catch {
    return { items: [], lifecycle: [], sources: [] };
  }
}
