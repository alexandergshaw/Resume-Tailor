### R-203 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** Nothing the model says about a posting is trusted except the URL, and even the URL is only trusted once the page behind it has been fetched.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/llmSearch.test.js lib/feed/llmSearchParse.test.js`.

**Expected:** All pass, including each of these independently:

- A candidate whose page `fetchUrlContent` cannot read is DROPPED — not stored with a null description, not stored with the model's. The run itself still reports `ok: true`, because an unverifiable result is a normal outcome and not a source failure.
- A candidate whose host appears nowhere in the response's `groundingMetadata` is dropped. Empty grounding rejects EVERY candidate: no grounding is no evidence the model searched at all, and treating it as permissive is exactly how a fabricated posting reaches a globally-readable table.
- A page that does not read like an individual posting is dropped. The length floor and the marker check are separate rules and are tested separately — a short page fails even carrying a marker, and a long page passes on any ONE marker alone. A long careers INDEX page that mentions "requirements" must still fail; it is the realistic false positive.
- `parsePostings` DISCARDS the model's `description` field outright rather than carrying it under another name. `description_snippet`, `raw_data.description`, `salary_min`/`salary_max` and `min_years_required` all derive from the FETCHED text. This is the load-bearing rule of the whole feature: that description is what a résumé gets tailored against, so a fabricated one produces a résumé tailored to a job that does not exist.
- The three drops above are each paired with a positive control — a mixed batch where the one verifiable posting survives. Without it an implementation returning an empty array unconditionally satisfies every drop assertion.
- **`location` and the `remote_type` derived from it are a deliberate, recorded exception** and come from the model. They are display metadata that never reach a tailoring prompt, and a fetched page frequently states remoteness nowhere parseable. Do not "fix" this by deriving `remote_type` from page text without also revisiting the tests that pin it.

### R-204 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** An AI-found posting is actually usable by the pipeline it was ingested for — the half of the feature that is invisible until it is missing.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/llmSearch.test.js lib/feed/postingProvenance.test.js`.

**Expected:** All pass, including:

- Every row carries a `source_posting_id`, and it is STABLE: the same posting discovered on two separate runs yields the same id, while two different URLs yield different ids. `postingExternalId` reads this column; `selectQueueCandidates` skips any row whose external id is empty and `tailorAndQueueOne` throws on one. A row without it enters `feed_postings` and is then invisible to the entire auto-tailor pipeline — the feature ships looking complete and auto-applies to nothing, with every unit test green. This is asserted end to end by feeding a produced row to the real `selectQueueCandidates`.
- `dedup_key` is `ai_search:<canonical FINAL url>` — the URL the fetch RESOLVED to, not the link the model produced. The fixture proving this uses two URLs that canonicalize DIFFERENTLY; a fixture where both canonicalize the same proves only that canonicalization ran.
- The shared normalizers in `lib/feed/normalize.js` are genuinely called (asserted with module spies, not by matching output values). A private twelve-line reimplementation reproduces every stored value exactly and would otherwise pass.
- `postingToJob` carries the feed row's `source` through and `jobToPositionRow` prefers it, falling back to the `gh-` prefix inference only when absent. Before this, every Lever, Ashby and RSS posting queued for auto-apply was recorded in `positions.source` as `jsearch`.

### R-205 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** The source is wired into the real ingest run, and the cadence gate that keeps it affordable is wired in with it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/ingestLlmSource.test.js`.

**Expected:** All pass. These are asserted through actual `ingestFeed` runs by observable effect — was a model call issued, did the row reach the shared upsert — never by re-testing the pieces:

- Two consecutive `ingestFeed` runs issue exactly ONE grounded model call; the second reports `sourceHealth.ai_search.skipped`. `/api/cron/feed-ingest` fires every minute (R-202), so a source without this gate costs 1440 grounded calls per query per day. `shouldRunLlmSearch` being unit-tested proves nothing unless `ingestFeed` actually calls it — the test mocks Redis in memory for exactly this reason, because with no Redis every cadence path is inert and an implementation that omits the gate entirely passes.
- A SKIPPED run does not consume the cadence window. Otherwise a persistently failing model call burns the window every minute alongside itself.
- Zero model calls when the deployment runs the embedded engine, when no Gemini key is configured, or when no saved search has `auto_tailor_enabled` or `email_on_new_jobs`. Each reports a `skipped` reason rather than a failure — "chose not to run" and "ran and found nothing" must stay distinguishable.
- A model failure leaves `summary.ok` true, still prunes, and still reports the other four sources. A Redis client whose `get`/`set` reject also leaves the run succeeding: a cache hiccup must never take ingestion down.
- AI rows go through the SHARED chunked upsert — one call carrying `{ onConflict: "dedup_key", count: "exact" }` with `updated_at` stamped — not a private one. A source running its own private upsert produces identical rows while skipping chunking, the exact-count tally and the run's health accounting.
- The per-run page-fetch budget is enforced at the ingest call site and split across every query due that run, not only inside the helper's own per-query cap.

### R-206 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** The same job found by two different sources produces one card, not two.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/canonicalUrl.test.js lib/feed/ingestLlmSource.test.js`.

**Expected:** All pass. `feed_postings.dedup_key` is namespaced per source (R-202) and therefore cannot dedupe a Greenhouse row against an AI-search hit for the same job; the canonical URL is the only cross-source identity, and every adapter stores one. So: a posting already in the feed under another source is dropped, paired with a positive control keeping one the feed has never seen; within a batch the first occurrence wins; and a posting whose URL will not canonicalize is dropped rather than bucketed under a shared empty-string key.

`gh_jid` is deliberately NOT treated as a tracking parameter — on a Greenhouse-embedded careers page it IS the posting id, and stripping it collapses every job on that board into one key. `utm_*`, `gh_src`, `ref` and `source` are stripped, the host is lowercased and `www.`-stripped, and surviving parameters are sorted so parameter order cannot fork the key.

**Known limitation, deliberate:** the dedupe reads at most `AI_SEARCH_DEDUPE_URL_SCAN_LIMIT` recent URLs, so it is best-effort above that bound rather than exact. The read is bounded AND ordered by `ingested_at` descending so that any truncation retains the rows most likely to collide with a posting found today. An unbounded read here was a full-table scan inside a serverless function whose silent truncation would have stopped the dedupe doing the one thing it exists for.

### R-207 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** One grounded search serves every user who asked for the same thing, and the query budget is the real cost control.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/llmSearchQueries.test.js lib/config/env.test.js`.

**Expected:** All pass, including: two users whose saved searches carry the same keyword set (in any case or order) collapse to ONE query, paired with a positive control keeping genuinely different searches separate; a search with no usable keywords is skipped, because an empty query returns whatever the web feels like and `feed_postings` is world-readable; only searches with `auto_tailor_enabled` or `email_on_new_jobs` produce queries, since those users already opted into automated work and no second switch was added for them to find; and the cap applies **at its default of 3**, not only when passed explicitly — the default is what production runs.

`getLlmSearchIntervalMinutes` defaults to 60 and falls back to 60 for a non-numeric, zero, or negative `LLM_SEARCH_INTERVAL_MINUTES`.

### R-208 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** `extractGroundingSources` has exactly one definition, and the routes that use it use that one.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/grounding.test.js app/api/company-research/route.test.js`.

**Expected:** All pass. `app/api/company-research/route.js` and `app/api/experience/research/route.js` both expose the SAME function reference as `lib/llm/grounding.js`. The assertion is on identity rather than behaviour deliberately: three byte-identical copies existed, and adding a shared module while leaving the copies in place passes every behavioural test while removing no duplication at all. The experience-research copy was private and is re-exported solely so this can be checked.

### R-209 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** CLOSED. The Live Feed no longer renders a raw source string. Kept as the record of a gap that was declared rather than hidden, and of what closing it actually took.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedWiring.test.js`.

**Expected:** All pass, and in particular `LiveFeedTab.js` contains no `label={posting.source}`. The behaviour that replaced it is covered by R-210 (labels and provenance), R-211 (status readouts), R-212 (accessible names) and R-213 (the wiring and the size limit).

**The original gap, preserved:** when the AI-search source shipped, every posting card rendered `posting.source` through a `Chip` with no mapping, so `greenhouse`, `lever`, `ashby`, `highered_rss` and `ai_search` all appeared exactly as stored in the database. It was left that way deliberately: `LiveFeedTab.js` was 1320 lines, over the 1000-line limit, so any edit to it obliged a split in the same change — and that was scoped as its own work item rather than bolted onto the ingest source.

**What closing it actually cost, worth knowing before the next deferral:** the split ran 1320 to 855 lines, and the three components originally planned were not enough — extracting only the card, the toolbar and the filter summary left the file at 1006 lines, so two further seams (`FeedEmailAlerts.js`, `FeedSearchFields.js`) had to be found. The work also surfaced two defects that had nothing to do with labelling and would not have been found otherwise: the toolbar counted source failures for Greenhouse alone, and feed staleness was signalled only by a coloured dot. Both are now covered by R-211.

