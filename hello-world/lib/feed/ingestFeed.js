import getRedisClient from "@/lib/cache/redisClient";
import { GREENHOUSE_COMPANIES } from "@/lib/greenhouse/companies";
import {
  stripHtml,
  snippetFrom,
  remoteTypeFor,
  extractMinYearsRequired,
} from "@/lib/feed/normalize";
import { LEVER_COMPANIES } from "@/lib/lever/companies";
import { fetchLeverPostings } from "@/lib/lever/fetchPostings";
import { ASHBY_COMPANIES } from "@/lib/ashby/companies";
import { fetchAshbyPostings } from "@/lib/ashby/fetchPostings";
import { HIGHERED_RSS_FEEDS } from "@/lib/highered/feeds";
import { fetchHigheredRssPostings } from "@/lib/highered/fetchPostings";

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

// How many companies to scan per run. Keeps a single serverless invocation
// fast while the rotating cursor guarantees full coverage over several runs.
const MAX_COMPANIES_PER_RUN = 25;
const UPSERT_CHUNK_SIZE = 200;

function normalizeGreenhousePosting(raw, companyName) {
  const locationName = raw.location?.name || "";
  const sourcePostingId = `gh-${raw.id}`;
  const fullDescription = stripHtml(raw.content || "");
  return {
    dedup_key: `greenhouse:${sourcePostingId}`,
    source: "greenhouse",
    source_posting_id: sourcePostingId,
    title: raw.title || null,
    company: companyName || null,
    location: locationName || null,
    remote_type: remoteTypeFor(locationName),
    employment_type: null,
    salary_min: null,
    salary_max: null,
    description_snippet: snippetFrom(raw.content || ""),
    min_years_required: extractMinYearsRequired(`${raw.title || ""} ${fullDescription}`),
    url: raw.absolute_url || null,
    tags: Array.isArray(raw.departments)
      ? raw.departments.map((d) => d?.name).filter(Boolean).slice(0, 8)
      : [],
    posted_at: raw.updated_at || raw.created_at || null,
    raw_data: {
      id: sourcePostingId,
      title: raw.title || "",
      company: companyName || "",
      location: locationName,
      url: raw.absolute_url || "",
      isRemote: remoteTypeFor(locationName) === "remote",
      description: fullDescription,
      postedAt: raw.updated_at || raw.created_at || null,
    },
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

    const deduped = dedupeByKey(collected);
    const upserted = await upsertPostings(admin, deduped);

    const nextCursor = (start + window.length) % Math.max(total, 1);
    await writeCursor(redis, nextCursor);

    const finishedAt = new Date().toISOString();
    const meta = {
      lastIngestedAt: finishedAt,
      durationMs: Date.now() - startedAt,
      companiesAttempted: attempted,
      itemsFetched: fetched,
      itemsUpserted: upserted,
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
      },
    };
    await writeMeta(redis, meta);

    console.log(
      `[feed-ingest] attempted=${attempted} fetched=${fetched} upserted=${upserted} failures=${failures.length} window=${start}-${nextCursor}`,
    );

    return { ok: true, ...meta };
  } finally {
    await releaseLock(redis);
  }
}
