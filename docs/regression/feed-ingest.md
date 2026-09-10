### R-202 | area: feed-ingest | parallel-safe: yes | automatable: yes

**Summary:** Area baseline for the Live Feed ingest pipeline, recorded before the LLM search source was added. This area had no case in this document; everything below was observed by reading the source and running the suite on 2026-08-13, not assumed.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/feed/`.
2. Read `hello-world/vercel.json`, `hello-world/lib/feed/ingestFeed.js`, and `hello-world/app/api/cron/feed-ingest/route.js`.

**Expected:** 72 tests pass across 5 files. The pipeline behaves as follows, and each point is a thing a later change must not silently break:

- **Two crons, two cadences.** `vercel.json` schedules `/api/cron/feed-ingest` at `* * * * *` (every minute) and `/api/cron/tailor` at `*/15 * * * *`. Anything wired into the ingest route therefore runs 1440 times a day; a per-run cost belongs behind its own cadence gate, not on the cron tick.
- **Both cron routes authorize the same way** and export `GET = POST`: a bearer token equal to `CRON_SECRET` when that is set, otherwise the `x-vercel-cron: 1` header. Neither accepts an unauthenticated request.
- **Greenhouse rotates, the other sources do not.** `MAX_COMPANIES_PER_RUN = 25` with a Redis cursor at `feed:ingest:cursor` walks `GREENHOUSE_COMPANIES` across runs; Lever, Ashby and the higher-ed RSS feeds are pulled in full every run.
- **Per-source failure isolation.** `runSource` collects failures per source into `sourceHealth` and never throws, so one dead board cannot abort a run or lose the other sources' postings.
- **One Redis lock, released in `finally`.** `feed:ingest:lock` is held for 110s with `nx`; a run that cannot take it returns `{ ok: true, skipped: "locked" }`. With no Redis configured every lock/cursor helper degrades to permissive rather than blocking ingestion.
- **`dedup_key` is the only uniqueness constraint** (`feed_postings.dedup_key text not null unique`), and it is namespaced per source (`greenhouse:gh-123`). Two sources carrying the SAME job therefore produce TWO rows today. Every adapter does store a canonical `url` — Greenhouse `absolute_url`, Lever `hostedUrl || applyUrl`, Ashby `jobUrl || applyUrl` — so a URL is the only cross-source identity available.
- **Retention is enforced by SQL, not by the app.** `prune_feed_postings` is called with `FEED_RETENTION_HOURS` (default 36) and a prune failure is logged and swallowed so it can never fail an otherwise good run.
- **The feed table is global and world-readable.** `feed_postings` has RLS `using (true)` for select and is written only by the service role. There is no per-user partition: anything ingested for one user's saved search is visible to every user.
- **Queue selection is pure keyword AND-matching.** `selectQueueCandidates` requires every `job_keywords` entry to appear in title+description, rejects excluded title keywords and excluded companies by substring, and applies `max_years_exp`. It never calls a model.
- **`positions.source` is inferred from an id prefix, and the inference is wrong for anything new.** `jobToPositionRow` in `lib/feed/tailorAndQueue.js` reads `String(job.id).startsWith("gh-") ? "greenhouse" : "jsearch"`, and `postingToJob` does not carry the feed row's own `source` through. Every non-Greenhouse posting queued for auto-apply is therefore recorded as having come from jsearch, including Lever, Ashby and RSS postings today.
- **The Live Feed card renders the raw source string.** `LiveFeedTab.js` renders `<Chip label={posting.source} />` with no mapping table, so a new source value appears in the UI exactly as stored.

