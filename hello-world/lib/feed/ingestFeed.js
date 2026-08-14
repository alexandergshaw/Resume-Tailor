import getRedisClient from "@/lib/cache/redisClient";
import { GREENHOUSE_COMPANIES } from "@/lib/greenhouse/companies";
import {
  stripHtml,
  snippetFrom,
  remoteTypeFor,
  extractMinYearsRequired,
} from "@/lib/feed/normalize";
import { parseSalary } from "@/lib/feed/salary";
import { LEVER_COMPANIES } from "@/lib/lever/companies";
import { fetchLeverPostings } from "@/lib/lever/fetchPostings";
import { ASHBY_COMPANIES } from "@/lib/ashby/companies";
import { fetchAshbyPostings } from "@/lib/ashby/fetchPostings";
import { HIGHERED_RSS_FEEDS } from "@/lib/highered/feeds";
import { fetchHigheredRssPostings } from "@/lib/highered/fetchPostings";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv, getLlmSearchIntervalMinutes } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { buildSearchQueries } from "@/lib/feed/llmSearchQueries";
import { fetchLlmSearchPostings, shouldRunLlmSearch } from "@/lib/feed/llmSearch";
import { canonicalPostingUrl, rejectDuplicateUrls } from "@/lib/feed/canonicalUrl";

// ---------------------------------------------------------------------------
// Live Feed ingestion service.
//
// Pulls fresh postings from supported job boards (currently Greenhouse),
// normalizes them into a single shape, deduplicates, and upserts into the
// Supabase `feed_postings` table. Designed to run under a Vercel Cron route
// (serverless), so each invocation processes a *rotating window* of companies
// to stay well within function time limits and persist incremental progress.
//
// Concurrency is guarded by a short-lived Redis lock so overlapping cron runs
// (or a manual refresh firing during a scheduled run) never collide.
// ---------------------------------------------------------------------------

const LOCK_KEY = "feed:ingest:lock";
const LOCK_TTL_SECONDS = 110; // shorter than the cron interval guard
const CURSOR_KEY = "feed:ingest:cursor";
const META_KEY = "feed:meta";
// Named alongside CURSOR_KEY/META_KEY above: when the AI-search source last
// issued a grounded model call, so shouldRunLlmSearch() can gate the next
// one. See lib/feed/llmSearch.js for why this cadence exists at all.
const AI_SEARCH_LAST_RUN_KEY = "feed:ingest:ai-search:last-run";
// Total page-verification fetches (fetchUrlContent calls) the AI-search
// source may spend in a single run, enforced HERE rather than only inside
// fetchLlmSearchPostings's own per-query maxPostings. /api/cron/feed-ingest
// runs every minute (docs/REGRESSION.md R-202); with several saved-search
// queries due in the same run, a per-query-only cap could still add up to an
// unbounded total for the run, so the budget below is split across whatever
// queries are actually due this run instead.
const AI_SEARCH_MAX_FETCHES_PER_RUN = 10;
// Cross-source dedupe (see buildAiSearchTasks below) reads every known
// feed_postings.url so an AI-search candidate can be checked against it.
// Left unbounded that is a full-table read inside a serverless function, and
// if PostgREST's own row ceiling ever truncated it first, the dedupe would
// silently cover an arbitrary subset with no error anywhere. Bounding it
// here — ordered by ingested_at descending — makes the truncation behavior
// predictable instead of arbitrary: when the table is under this size the
// dedupe is exact, and above it the rows kept are the most recently
// ingested, i.e. the ones most likely to collide with a posting found
// today. Cross-source dedupe is therefore best-effort above this bound, not
// a guarantee, by construction.
const AI_SEARCH_DEDUPE_URL_SCAN_LIMIT = 5000;

// How many companies to scan per run. Keeps a single serverless invocation
// fast while the rotating cursor guarantees full coverage over several runs.
const MAX_COMPANIES_PER_RUN = 25;
const UPSERT_CHUNK_SIZE = 200;

// Retention window: postings older than this (by posting date, falling back to
// ingestion date) are pruned at the end of each run so `feed_postings` never
// grows without bound. Expressed in hours; override with FEED_RETENTION_HOURS.
// Default 36h = 1.5 days.
const RETENTION_HOURS = Number.parseInt(process.env.FEED_RETENTION_HOURS, 10) || 36;

function normalizeGreenhousePosting(raw, companyName) {
  const locationName = raw.location?.name || "";
  const sourcePostingId = `gh-${raw.id}`;
  const fullDescription = stripHtml(raw.content || "");
  const salary = parseSalary(`${raw.title || ""} ${fullDescription}`);
  return {
    dedup_key: `greenhouse:${sourcePostingId}`,
    source: "greenhouse",
    source_posting_id: sourcePostingId,
    title: raw.title || null,
    company: companyName || null,
    location: locationName || null,
    remote_type: remoteTypeFor(locationName),
    employment_type: null,
    salary_min: salary.min,
    salary_max: salary.max,
    description_snippet: snippetFrom(raw.content || ""),
    min_years_required: extractMinYearsRequired(`${raw.title || ""} ${fullDescription}`),
    url: raw.absolute_url || null,
    tags: Array.isArray(raw.departments)
      ? raw.departments.map((d) => d?.name).filter(Boolean).slice(0, 8)
      : [],
    posted_at: raw.updated_at || raw.created_at || null,
    // Only the full description is kept here — every other field duplicates a
    // normalized column, so storing them would just bloat the row.
    raw_data: { description: fullDescription },
  };
}

async function fetchCompanyPostings(slug, name) {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
      { headers: { Accept: "application/json" }, next: { revalidate: 0 } },
    );
    if (!res.ok) {
      return { ok: false, postings: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const postings = (data.jobs || []).map((j) =>
      normalizeGreenhousePosting(j, name),
    );
    return { ok: true, postings, error: null };
  } catch (err) {
    return { ok: false, postings: [], error: String(err?.message || err) };
  }
}

function dedupeByKey(postings) {
  const map = new Map();
  for (const p of postings) {
    if (!p?.dedup_key) continue;
    map.set(p.dedup_key, p); // last write wins; all from same run are equivalent
  }
  return [...map.values()];
}

async function upsertPostings(admin, postings) {
  let inserted = 0;
  for (let i = 0; i < postings.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = postings.slice(i, i + UPSERT_CHUNK_SIZE).map((p) => ({
      ...p,
      updated_at: new Date().toISOString(),
    }));
    const { error, count } = await admin
      .from("feed_postings")
      .upsert(chunk, { onConflict: "dedup_key", count: "exact" });
    if (error) {
      console.error("[feed-ingest] upsert chunk failed:", error.message);
      continue;
    }
    inserted += count ?? chunk.length;
  }
  return inserted;
}

// Delete postings older than the retention window. Uses a SQL function so the
// cutoff is computed over coalesce(posted_at, ingested_at) atomically — a
// filter PostgREST can't express directly. Never throws: a prune failure must
// not abort (or fail) an otherwise successful ingest run.
async function prunePostings(admin) {
  try {
    const { data, error } = await admin.rpc("prune_feed_postings", {
      retention_hours: RETENTION_HOURS,
    });
    if (error) {
      console.error("[feed-ingest] prune failed:", error.message);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("[feed-ingest] prune failed:", String(err?.message || err));
    return 0;
  }
}

/**
 * Acquire the ingest lock. Returns true if acquired, false if another run holds it.
 */
async function acquireLock(redis) {
  if (!redis) return true; // no Redis configured → best-effort, allow run
  try {
    const res = await redis.set(LOCK_KEY, Date.now(), {
      nx: true,
      ex: LOCK_TTL_SECONDS,
    });
    return res === "OK";
  } catch {
    return true; // never block ingestion on a cache hiccup
  }
}

async function releaseLock(redis) {
  if (!redis) return;
  try {
    await redis.del(LOCK_KEY);
  } catch {
    // non-fatal
  }
}

async function readCursor(redis) {
  if (!redis) return 0;
  try {
    const value = await redis.get(CURSOR_KEY);
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function writeCursor(redis, value) {
  if (!redis) return;
  try {
    await redis.set(CURSOR_KEY, value);
  } catch {
    // non-fatal
  }
}

async function writeMeta(redis, meta) {
  if (!redis) return;
  try {
    await redis.set(META_KEY, meta);
  } catch {
    // non-fatal
  }
}

async function readAiSearchLastRun(redis) {
  if (!redis) return null; // no Redis configured -> permissive, like every other cadence helper here
  try {
    return await redis.get(AI_SEARCH_LAST_RUN_KEY);
  } catch {
    return null;
  }
}

async function writeAiSearchLastRun(redis, value) {
  if (!redis) return;
  try {
    await redis.set(AI_SEARCH_LAST_RUN_KEY, value);
  } catch {
    // non-fatal
  }
}

// Decide whether the AI-search source runs this cycle, and if so build its
// runSource() tasks. Split out from ingestFeed() itself so its several exit
// points (embedded engine, no key, cadence, no queries) read as a flat list
// of early returns rather than nested conditionals.
async function buildAiSearchTasks({ admin, redis }) {
  // Engine choice governs every AI feature in this app, not just tailoring
  // (see lib/llm/featureEngine.js). No per-request override exists in a cron
  // context, so this reads only the server default / key presence.
  if (wantsEmbedded()) {
    return { tasks: [], skipped: "embedded engine" };
  }

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    client = null; // no Gemini key configured
  }
  if (!client) {
    return { tasks: [], skipped: "no Gemini API key" };
  }

  const intervalMinutes = getLlmSearchIntervalMinutes();
  const lastRunAt = await readAiSearchLastRun(redis);
  if (!shouldRunLlmSearch({ lastRunAt, now: Date.now(), intervalMinutes })) {
    return { tasks: [], skipped: `cadence: not due for ${intervalMinutes}m` };
  }

  const { data: savedSearches, error: searchesErr } = await admin
    .from("saved_searches")
    .select("*");
  if (searchesErr) {
    return { tasks: [], skipped: `saved_searches query failed: ${searchesErr.message}` };
  }

  const queries = buildSearchQueries(savedSearches || []);
  if (queries.length === 0) {
    return { tasks: [], skipped: "no saved search wants automated work" };
  }

  // Cross-source identity: dedup_key is namespaced per source (R-202), so a
  // Greenhouse posting and the same job found by AI search don't collide
  // there. URL is the only shared identity, so postings this source
  // verifies still have to be checked against every URL already ingested.
  const { data: existingRows } = await admin
    .from("feed_postings")
    .select("url")
    .order("ingested_at", { ascending: false })
    .limit(AI_SEARCH_DEDUPE_URL_SCAN_LIMIT);
  const knownUrlKeySet = new Set(
    (existingRows || []).map((r) => canonicalPostingUrl(r?.url)).filter(Boolean),
  );

  const perQueryMaxPostings = Math.max(
    1,
    Math.floor(AI_SEARCH_MAX_FETCHES_PER_RUN / queries.length),
  );

  const tasks = queries.map(async (query) => {
    const result = await fetchLlmSearchPostings({
      query,
      client,
      model,
      fetchUrl: fetchUrlContent,
      maxPostings: perQueryMaxPostings,
    });
    if (!result.ok) return result;
    return { ...result, postings: rejectDuplicateUrls(result.postings, knownUrlKeySet) };
  });

  return { tasks, skipped: null };
}

/**
 * Read the latest ingest metadata (lastIngestedAt + per-source health).
 * Safe to call from read paths; returns null when unavailable.
 */
export async function getFeedMeta() {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    return (await redis.get(META_KEY)) || null;
  } catch {
    return null;
  }
}

/**
 * Run one ingestion cycle over a rotating window of source companies.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin - service-role client
 * @returns {Promise<object>} summary of the run
 */
export async function ingestFeed(admin) {
  const startedAt = Date.now();
  const redis = getRedisClient();

  const locked = await acquireLock(redis);
  if (!locked) {
    return { ok: true, skipped: "locked" };
  }

  try {
    const companies = GREENHOUSE_COMPANIES;
    const total = companies.length;
    const start = (await readCursor(redis)) % Math.max(total, 1);
    const window = [];
    for (let i = 0; i < Math.min(MAX_COMPANIES_PER_RUN, total); i++) {
      window.push(companies[(start + i) % total]);
    }

    let attempted = 0;
    let fetched = 0;
    const failures = [];
    let collected = [];

    // Per-source error isolation: one failing board never aborts the run.
    const results = await Promise.all(
      window.map(({ slug, name }) => fetchCompanyPostings(slug, name)),
    );
    for (let i = 0; i < results.length; i++) {
      attempted += 1;
      const r = results[i];
      if (r.ok) {
        fetched += r.postings.length;
        collected.push(...r.postings);
      } else {
        failures.push({ company: window[i].slug, error: r.error });
      }
    }

    // Additional sources beyond Greenhouse. These lists are small (university
    // OPMs, edtech boards, higher-ed adjunct/faculty RSS feeds), so we pull the
    // full set every run rather than rotating — well within the serverless
    // budget — and isolate failures per source the same way.
    async function runSource(key, tasks) {
      const settled = await Promise.all(tasks);
      let srcFetched = 0;
      const srcFailures = [];
      for (const r of settled) {
        if (r.ok) {
          srcFetched += r.postings.length;
          collected.push(...r.postings);
        } else {
          srcFailures.push({ source: r.label, error: r.error });
        }
      }
      attempted += settled.length;
      fetched += srcFetched;
      return {
        key,
        attempted: settled.length,
        fetched: srcFetched,
        failures: srcFailures,
      };
    }

    const leverHealth = await runSource(
      "lever",
      LEVER_COMPANIES.map(({ slug, name }) => fetchLeverPostings(slug, name)),
    );
    const ashbyHealth = await runSource(
      "ashby",
      ASHBY_COMPANIES.map(({ slug, name }) => fetchAshbyPostings(slug, name)),
    );
    const higheredHealth = await runSource(
      "highered_rss",
      HIGHERED_RSS_FEEDS.map((feed) => fetchHigheredRssPostings(feed)),
    );

    // Unlike the sources above, AI search may issue zero model calls this
    // run (engine choice, missing key, or the cadence gate below) — see
    // buildAiSearchTasks. It still goes through the same runSource() so its
    // rows share the lock/dedupe/upsert/prune/health every other source gets
    // for free, and an empty task list simply reports attempted/fetched: 0.
    const { tasks: aiTasks, skipped: aiSkipReason } = await buildAiSearchTasks({ admin, redis });
    const aiHealth = await runSource("ai_search", aiTasks);
    if (aiTasks.length > 0) {
      // Stamp the cadence window only when a run actually happened (was
      // attempted, whether or not it succeeded) — a skipped run must not
      // consume it, or a persistently failing model call would burn the
      // window every minute right along with it.
      await writeAiSearchLastRun(redis, Date.now());
    }

    const deduped = dedupeByKey(collected);
    const upserted = await upsertPostings(admin, deduped);
    const pruned = await prunePostings(admin);

    const nextCursor = (start + window.length) % Math.max(total, 1);
    await writeCursor(redis, nextCursor);

    const finishedAt = new Date().toISOString();
    const meta = {
      lastIngestedAt: finishedAt,
      durationMs: Date.now() - startedAt,
      companiesAttempted: attempted,
      itemsFetched: fetched,
      itemsUpserted: upserted,
      itemsPruned: pruned,
      windowStart: start,
      nextCursor,
      totalCompanies: total,
      sourceHealth: {
        greenhouse: {
          lastSuccessAt: failures.length < results.length ? finishedAt : null,
          failures: failures.length,
          sampleErrors: failures.slice(0, 5),
        },
        lever: {
          lastSuccessAt:
            leverHealth.failures.length < leverHealth.attempted ? finishedAt : null,
          attempted: leverHealth.attempted,
          fetched: leverHealth.fetched,
          failures: leverHealth.failures.length,
          sampleErrors: leverHealth.failures.slice(0, 5),
        },
        ashby: {
          lastSuccessAt:
            ashbyHealth.failures.length < ashbyHealth.attempted ? finishedAt : null,
          attempted: ashbyHealth.attempted,
          fetched: ashbyHealth.fetched,
          failures: ashbyHealth.failures.length,
          sampleErrors: ashbyHealth.failures.slice(0, 5),
        },
        highered_rss: {
          lastSuccessAt:
            higheredHealth.failures.length < higheredHealth.attempted
              ? finishedAt
              : null,
          attempted: higheredHealth.attempted,
          fetched: higheredHealth.fetched,
          failures: higheredHealth.failures.length,
          sampleErrors: higheredHealth.failures.slice(0, 5),
        },
        ai_search: {
          lastSuccessAt:
            aiHealth.attempted > 0 && aiHealth.failures.length < aiHealth.attempted
              ? finishedAt
              : null,
          attempted: aiHealth.attempted,
          fetched: aiHealth.fetched,
          failures: aiHealth.failures.length,
          sampleErrors: aiHealth.failures.slice(0, 5),
          // A skip (embedded engine, no key, cadence, no queries) is not a
          // failure — reported so callers can tell "chose not to run" apart
          // from "ran and found nothing" without treating either as an error.
          ...(aiSkipReason ? { skipped: aiSkipReason } : {}),
        },
      },
    };
    await writeMeta(redis, meta);

    console.log(
      `[feed-ingest] attempted=${attempted} fetched=${fetched} upserted=${upserted} pruned=${pruned} failures=${failures.length} window=${start}-${nextCursor}`,
    );

    return { ok: true, ...meta };
  } finally {
    await releaseLock(redis);
  }
}
