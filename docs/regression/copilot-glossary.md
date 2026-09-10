### R-338 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** `position_glossaries` is a SHARED table with no owner column, and the denial of user writes IS THE ABSENCE OF ANY WRITE POLICY. This mirrors the positions hardening: a row-ownership predicate needs a column naming the owner, this table deliberately has none, so no predicate over its columns can mean "this row is yours" and a permissive policy constrained only by the caller's role would say nothing about the row's content. The `ready` CHECK constrains the terms ARRAY, not a counter, because a counter-only check is defeated by exactly the bug it names.

**Steps:**
1. Open `hello-world/supabase/migrations/20260908010000_position_glossaries.sql`.
2. Run `lib/copilot/glossaryMigrationShape.test.js`.

**Expected:** EXACTLY ONE `create policy`, and it is `for select to authenticated using (true)`. ZERO insert/update/delete/all policies and ZERO occurrences of `with check`. No `create policy ... to service_role` (service_role bypasses RLS, so one would never be consulted). `revoke all` from both `anon` and `authenticated`, then `grant select` to `authenticated` and `grant all` to `service_role`, and nothing granted to `anon`. NO `user_id` column. `status text not null` with NO DEFAULT (a default would let an insert that omitted the column produce a `ready` row over zero terms that satisfies every constraint). The five-value status CHECK; the three-value `truncated_reason` CHECK; the THREE-CLAUSE ready CHECK including `not (terms @> '[{"provenance": "recalled"}]'::jsonb)`; `model_calls_fingerprint <= 42`; `model_calls_total <= 126`; `model_calls_fingerprint <= model_calls_total`; the cursor CHECK bounding `research_total <= 10`; the 120-term CHECK written with `case` (PostgreSQL does not guarantee left-to-right `and` evaluation inside a CHECK, so a non-array `terms` could reach `jsonb_array_length` and raise a TYPE ERROR instead of a constraint violation); `research_pending` as a STORED generated column; the partial index on `queued_at where research_pending`; and NO `pg_column_size` anywhere (it is not IMMUTABLE and a CHECK containing it is a dump/restore hazard). Every absence assertion is paired with a positive control on a sibling migration that has the thing.

### R-339 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** The glossary MUST NOT be enabled in production until `20260908000000_positions_policy_hardening.sql` has been APPLIED. Until it is, any authenticated account can rewrite `positions.description`, and this feature reads that text as its primary input and writes a row EVERY OTHER APPLICANT reads on hover, from a row none of them can correct. Nothing in this repository can prove the migration was applied; what IS checkable is that it has not been reverted or weakened.

**Steps:**
1. Run `lib/copilot/glossaryMigrationShape.test.js` and `lib/supabase/positionsPolicyMigrationShape.test.js`.
2. Separately, confirm with the database owner that the hardening migration is applied.

**Expected:** The hardening migration is on disk and still contains `revoke insert, update, delete on table public.positions from authenticated`, with no UPDATE or ALL policy on positions. The glossary migration touches `public.positions` ONLY through an `on delete cascade` foreign key reference: it grants no write privilege on positions and declares no write policy on it, which is what `positionsPolicyMigrationShape.test.js`'s substantive tripwire checks. Its companion assertion ("is currently the newest migration touching public.positions") FIRES BY DESIGN, and its own comment says why: "If a later migration legitimately needs to touch this table, this test is where the author is made to state why." Registering the glossary migration there is a required, deliberate one-line step, not a loosening.

### R-340 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** WIRE. The research call must ask the Interactions API for search ON THE WIRE. The two request shapes in this repo are INVERTED and both are live: `models.generateContent` takes `tools` INSIDE `config` with a camelCase key, while `interactions.create` takes `tools` at the TOP LEVEL with a `type` discriminant, `input` rather than `contents`, and `system_instruction` rather than `config.systemInstruction`. NEITHER WRONG FORM THROWS - the SDK's parameter transformer reads only the keys it knows and silently discards the rest, so the failure is no search, no citations, every term falling back to `recalled`, and a full grounded bill anyway. No non-wire test can see it.

**Steps:**
1. Run `app/api/cron/position-glossary/route.wire.test.js`.
2. Move `tools` inside a `config` object in `lib/copilot/glossaryWorker.js` and re-run.

**Expected:** FOUR SEPARATE ASSERTIONS on the captured body, not one deep-equal (a deep-equal passes for the wrong reason when the body is built by a spread): `tools` present at the top level; `tools[0]` equals `{ type: "google_search" }` with no `googleSearch` key; `input` defined and `contents` undefined; `system_instruction` defined with no `config` and no `systemInstruction`. The client is a REAL `GoogleGenAI` built INSIDE the capture window (the Interactions transport binds `globalThis.fetch` at the first `.interactions` access and holds that reference, so a client reused across windows sends its request to a stub that has already been restored). The standing negative control - a direct `models.generateContent` call with a top-level `tools` - still asserts the key is DROPPED, proving the probe can still see a drop. Step 2 turns three assertions red.

### R-341 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** THE PREDICATE. One citation must never be able to claim a whole batch. A rule testing only "overlap >= N characters" was defeated by a single citation spanning `[0, byteLen-1)` of a twelve-definition response: 12/12 terms marked researched, all twelve popovers offering one SEO farm mid-interview, the row written `ready` with `recalled_count: 0`, every constraint satisfied. `SPAN_REFUSAL.WHOLE_DOCUMENT` does not save it - that rule is an EXACT equality on `[0, length)` and one byte short is a different claim. And the adversary is weaker than that sounds: they need only be the one page Google grounds a batch against, which is the ordinary outcome when a model answers twelve related questions from one reference page. THIS FIRES ON HONEST TRAFFIC.

**Steps:**
1. Run `lib/copilot/glossaryResearch.test.js`.
2. Run `scratchpad/glosscheck/attack-real.mjs` (ATTACK 1, 1b, 2, 3).

**Expected:** A whole-document span and a `[0, byteLen-1)` span each yield `recalled` for EVERY term. A span whose precision is exactly one half is refused (the comparison is STRICTLY greater). An overlap below 20 characters is refused. A citation touching more than two definition ranges is refused FOR ALL of them. An exhaustive sweep over every `[s, e)` span at a 7-byte stride (~16,000 spans) finds the maximum terms any single citation can claim is EXACTLY ONE - the upper half is the theorem (disjoint definition ranges cannot both take more than half a citation's width), the lower half is the positive control that stops the case passing because the predicate refuses everything. A citation correctly covering definition #1 that bleeds 20 characters into #2 keeps #1 and refuses #2 (which is why the touch bound is 2 and not 1: refusing outright would lose the correct attribution too, and under-claiming a correct source feeds straight into the research floor). Selection is on PRECISION first, so a correct narrow citation beats a wide one - selecting on overlap alone made the widest, wrongest citation win on EVERY term including the one that had a correct citation.

### R-342 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** THE JOIN IS PER TEXT BLOCK AND NEVER THROUGH `interaction.output_text`. The SDK builds that field (`@google/genai dist/node/index.cjs:19018-19074`) as a BACKWARDS, BARRIER-TERMINATED scan: text emitted before a `google_search_call` is EXCLUDED, and several blocks are CONCATENATED, while annotation offsets are per-block. In `model_output -> google_search_call -> model_output` - the canonical grounded flow - a citation measured over the excluded preamble resolves CLEANLY onto definition #1. NOTHING IS MALFORMED in that failure: the offsets are integers, non-negative, ordered and on character boundaries, so `spanFor` returns a span, `spanRefusalReason` is null, and `interactionStageCounts` reports a healthy walk. No refusal rule and no stage count can see it.

**Steps:**
1. Run `lib/copilot/glossaryCitations.test.js` and the per-block cases of `lib/copilot/glossaryResearch.test.js`.
2. Run `scratchpad/glosscheck/attack-real.mjs` (ATTACK 5, 5b, 5c, 10, 11).

**Expected:** A citation on a block excluded from `output_text` sources NO definition, and all twelve definitions are still parsed and stored. Two text blocks in one step resolve each block's annotations against ITS OWN text: the citation lands on definition #1 at precision 1, and no other definition is claimed. A mid-document citation under a short leading block lands on definition #5 - the block-offset attack, where an adversary who can steer the model's text slides every honest annotation backwards by `len(block1)` and silently re-attributes real publisher URLs to the wrong terms. Definitions are parsed ONCE over the assembled document, never per block: a definition straddling a block boundary is STILL STORED and is `recalled` (parsing per block silently loses it - the measured symptom is 11 of 12). A CRLF response stores no trailing `\r` (`.` excludes `\n` but INCLUDES `\r`, so a naive recogniser shifts every `defEnd` by one). A duplicated index drops the LATER occurrence, never both (dropping both destroys the unrelated real term whose number was reused). `extractCitationSources` in `lib/llm/interactionCitations.js` is UNCHANGED and still returns its old flat shape - the per-block walk is additive and local to this feature.

### R-343 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** A TOTAL INPUT BECOMING A TOTAL LOSS MUST BE A NAMED, REPORTABLE ANOMALY, never a bare empty - a bare empty is indistinguishable from "the model found nothing". And the throw path is closed twice: the SDK OMITS `output_text` entirely when the text is empty, `interactionOutputText` throws on that, and `interactionSearched` is still TRUE - so a "did it search?" criterion never fires because the code reaches the throw first, one empty batch throws out of the loop, and paid work is discarded.

**Steps:**
1. Run the reason and throw-path cases of `lib/copilot/glossaryResearch.test.js` and `lib/copilot/glossaryWorker.test.js`.
2. Run `scratchpad/glosscheck/attack-real.mjs` (ATTACK 6, ATTACK 4).

**Expected:** The predicate NEVER reads `output_text` (a source sweep asserts `interactionOutputText` appears in no glossary module, with a positive control). An Interaction with `output_text` absent, one whose `steps` is not an array, and one whose `content` is a string each fail to throw and yield zero definitions. Reasons distinguish `walk-broke` (textBlocks 0) from `no-citations` (textBlocks > 0, annotations 0) from `unparsed-lines` (text present, no numbered line matched) from `all-citations-refused` from `surrogate-cliff`. A single unpaired surrogate refuses every span IN ITS OWN BLOCK and is reported as `surrogate-cliff` with a per-reason tally; per-block scoping confines it, so a surrogate in block 1 leaves block 2's citations usable. WITHIN ONE BLOCK THE CLIFF IS UNCHANGED and is an accepted, stated residual. In the worker, a join that throws marks its batch's terms `recalled`, increments `malformed_batches`, ADVANCES THE CURSOR, and does not fail the row.

### R-344 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** Conditions 6 and 7 - the vendor redirect and third-party intermediaries. Measured: `t.co`, `webcache.googleusercontent.com`, `translate.google.com`, `l.facebook.com`, `r.jina.ai` and `www.google.com/url` ALL pass the href gate AND the vendor-redirect check. A card would have said "webcache.googleusercontent.com" to a candidate mid-interview. Condition 6 is REUSED from `lib/tracking/citationHref.js` rather than copied, because a second copy of a URL allow-list is exactly what that module exists to prevent - and the reuse is through `nonPublisherHosts` called with EXACTLY ONE ENTRY, at which size its second clause (which suppresses a host shared by every entry) is structurally inert.

**Steps:**
1. Run the URL-gate cases of `lib/copilot/glossaryResearch.test.js`.
2. Run `scratchpad/glosscheck/attack-real.mjs` (ATTACK 7, 8, 9).

**Expected:** All eleven redirectors and interstitials are blocked, AND four real publishers (`en.wikipedia.org`, `www.postgresql.org`, `learn.microsoft.com`, `datatracker.ietf.org`) are ADMITTED - the positive control without which the rule passes by refusing everything. Condition 7a is STRUCTURAL (an embedded `http(s)://` in the decoded path-or-query after the origin, catching the whole interstitial class without a list) and 7b is a named residue for hosts that carry no embedded URL, which is the right way round because deny-lists are incomplete by construction. A `vertexaisearch` citation and a `t.co` citation each yield `recalled` with `source_url`, `source_host` and `source_title` ALL null. THE n=1 REDUCTION IS PINNED BOTH WAYS: calling `nonPublisherHosts` with a four-entry batch DOES suppress `en.wikipedia.org` (the hazard being avoided), while the per-citation call suppresses none of the four and still rejects the vendor redirect. NO export was added to `citationHref.js`, and no glossary module contains `vertexaisearch`, `grounding-api-redirect` or `cloud.google.com`. The inherited FALSE POSITIVE stands and is accepted: a legitimate `cloud.google.com` documentation page whose path contains `grounding-api-redirect` is rejected.

### R-345 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** Every cost number is `ceil(120 / RESEARCH_BATCH_SIZE)` calls, so changing the batch size changes the bill linearly AND changes the call caps AND the `research_total <= 10` database CHECK AND the throughput claim. These must fail an arithmetic test rather than a production invoice. The test asserts the RELATIONS, never the literals: a test that restates a constant is a second copy of it and goes green on any coordinated edit.

**Steps:**
1. Run `lib/copilot/glossaryConstants.test.js`.
2. Change `RESEARCH_BATCH_SIZE` to 10 without touching anything else, and re-run.

**Expected:** `MAX_TERMS_PER_POSTING % RESEARCH_BATCH_SIZE === 0`; `RESEARCH_TOTAL_MAX === MAX_TERMS_PER_POSTING / RESEARCH_BATCH_SIZE` and the migration's CHECK bound equals it; `MAX_CALLS_PER_GENERATION === 1 + batches + MAX_BATCH_RETRIES_PER_GENERATION`; `MAX_LIFETIME_MODEL_CALLS === MAX_AUTO_ATTEMPTS * MAX_CALLS_PER_GENERATION`; generation <= fingerprint <= absolute; and the per-posting HOURLY exposure is STRICTLY less than the per-fingerprint cap, so no single hour can retire a shared row (an earlier design authorised 44 calls per user per hour against a 36-call per-posting lifetime cap and described the two as comparable). `BATCH_WORST_CASE_MS === 2 * RESEARCH_TIMEOUT_MS + 2000` and fits inside `INVOCATION_BUDGET_MS - INVOCATION_RESERVE_MS`; the derived worst-case batches per invocation is 2; the lease outlives the invocation. The capacity inequality holds against `EXPECTED_POSTINGS_PER_DAY`, which is AN ESTIMATE and not a measurement - the test pins the arithmetic, production logging replaces the estimate. Step 2 turns several of these red at once, which is the point.

### R-346 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** THE CRON ROUTE IS A SECOND AUTHORISATION SURFACE: it makes paid model calls and is not behind a signed-in user. What makes a shared-secret gate acceptable is that IT CANNOT BE AIMED - it reads no request body, takes no parameters, and selects its own work. Someone who guessed the secret could make the worker do work it was already going to do, sooner; that is the whole blast radius, and it is by construction rather than by care.

**Steps:**
1. Run `app/api/cron/position-glossary/route.test.js`.
2. POST with no `Authorization` header, with a wrong bearer, and with the exact bearer.
3. Set `GLOSSARY_DISABLED=1` and POST with the exact bearer.

**Expected:** `runtime` is `nodejs` and `maxDuration` is 300 (the value both live cron routes use); `GET === POST` because Vercel cron sends GETs in some configurations. The `isAuthorized` helper is CHARACTER-IDENTICAL to BOTH `cron/feed-ingest` and `cron/tailor` (there is no shared cron-auth helper in this repo - those two are byte-identical private copies and feed-ingest's own comment says it mirrors tailor, so a third copy is the established precedent and this assertion is what stops it drifting). No secret and a wrong secret each return 401 with ZERO model calls and no admin client constructed; the exact bearer returns 200; with `CRON_SECRET` unset the `x-vercel-cron: 1` header is accepted and a bare request is not. The kill switch is the FIRST STATEMENT, before the authorization gate and before any client, and returns `{status: "disabled"}` with zero IO. The handler contains no request-body read, no search params, no per-user authentication, no `applications` query, no rate limiter (deliberately - stated so the absence is not read as an oversight) and NO REDIS (the feed ingest cursor returns 0 on any cache error and its lock fails OPEN, which is right for re-scanning 25 companies and catastrophic for re-spending ten grounded calls: a failed instrument is invalid, never its zero value, and that rule applies to money). `vercel.json` carries the `/api/cron/position-glossary` entry at the cadence the capacity constant is derived from, the two pre-existing entries are unchanged, and the file still has no key other than `crons`.

### R-347 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** `ready` IS REACHABLE, AND A TEST WALKS THE DESIGN TO ITS OWN SUCCESS STATE. One research batch's worst case is ~92 seconds and a full generation is ten of them, which do not fit one serverless invocation at any `maxDuration` this platform offers. A design that made ten calls from one request could never finish, so `ready` - defined as `recalled_count = 0` and enforced by a database CHECK - would be ARITHMETICALLY UNREACHABLE while every gate and every panel line reasoned about it. The absence of this case is how that ships.

**Steps:**
1. Run `lib/copilot/glossaryWorker.test.js`.
2. Drive a 120-term row through repeated worker invocations on a simulated clock.
3. Kill the loop after batch 6 and inspect the row.

**Expected:** The row reaches `status: 'ready'` with `recalled_count = 0`, `researched_count = 120`, `research_cursor === research_total`, no term left with `provenance: "recalled"` (the database CHECK's third clause, asserted in JS so the two cannot drift), and exactly 10 grounded calls. The worker WRITES AFTER EVERY BATCH: killed after batch 6 the row holds six batches of sources, `research_cursor === 6`, six writes, and the next invocation starts at 6. THE DEADLINE, NOT A COUNT, BOUNDS AN INVOCATION: with each batch consuming the full 92-second worst case exactly two batches run; with 12-second batches the whole generation completes in one invocation and the chunking never engages. Batching is by POSITION over a work list ordered recalled-first, so positions never move while a generation runs - slicing a filtered "still recalled" list instead would skip a term every time a batch succeeded.

### R-348 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** The lease is a conditional UPDATE and is the ONLY concurrency control. Zero rows returned means another invocation holds it, so skip - never wait. Progress and spend live in Postgres, not Redis, and the queue read selects only rows whose research is PENDING.

**Steps:**
1. Run the lease and queue cases of `lib/copilot/glossaryStore.test.js` and `lib/copilot/glossaryWorker.test.js`.
2. Run two concurrent invocations against one row.

**Expected:** The lease UPDATE filters on the row AND on `lease_until.is.null,lease_until.lt.<now>`; a row another invocation holds yields NO row, ZERO grounded calls, and an unmoved cursor; the lease is cleared in a `finally` so a worker that finishes in thirty seconds releases immediately, and it is still cleared when a batch throws. The queue read selects on `research_pending = true` (a STORED GENERATED column, because PostgREST cannot compare two columns in a filter, so `research_cursor < research_total` is not expressible as a query predicate at all), orders by `queued_at` ascending so no posting starves, and applies BOTH call caps IN THE QUERY - a row already at either cap must never be selected and leased, because the lease itself is a write. A COMPLETED ROW CAN NEVER BE SELECTED: a worker that quietly re-researched finished rows would turn the monthly bill into a subscription, and it is exactly the change someone would make to "keep sources fresh". A failed read is distinguishable from a missing row.

### R-349 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** A MECHANISM FAILURE IS RETRYABLE; A SOURCING FAILURE IS NOT. A batch that did not search means the tools payload did not reach the wire, or Google returned no search step - retryable, and the criterion that catches a `tools`-nesting regression after the wire test stops running. A batch that searched and found nothing to cite is a sourcing outcome, and retrying it spends money to learn the same thing. Left unbounded, "always retry an unsearched batch" costs a full generation per posting ON EVERY POSTING.

**Steps:**
1. Run the retry, malformed, budget and usage cases of `lib/copilot/glossaryWorker.test.js`.

**Expected:** An unsearched batch is retried EXACTLY ONCE, then the cursor advances, `unsearched_batches` increments, its terms keep their harvest definitions, and the row can never be `ready`. A batch that searched and cited nothing is NEVER retried. Mechanism retries are bounded across the whole generation, so ten unsearched batches cost at most thirteen calls, not twenty. A malformed response advances the cursor, counts itself, and leaves every term `recalled` - it never fails the row. `budget_exceeded` writes `reason: 'budget-exceeded'`, does NOT increment `attempts`, and STOPS the worker: it is the one upstream signal meaning "stop", not "try again", and burning an attempt on it converts a quota event into a permanent row failure. Usage is aggregated across batches for all four figures, and A MISSING USAGE OBJECT DEGRADES TO `null`, NEVER TO `0` - a zero that means "we could not measure" and a zero that means "nothing was spent" must not be the same value. Every model call increments BOTH counters BEFORE it is made, because a call that throws still cost money.

### R-350 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** THE LIMITER IS AT MODULE SCOPE, AND THE GATES REFUSE BEFORE A MODEL CLIENT IS CONSTRUCTED. A limiter built inside the handler gets a brand-new store on every request, so every caller is forever on its first request: it permits everything, counts nothing, and PASSES A SMOKE TEST WHILE DOING IT. And a module that constructs the client and then decides is green on most fixtures and red only on the one that reaches the gate at all.

**Steps:**
1. Run `app/api/copilot/glossary/route.test.js`.
2. Move the `createRateLimiter` call inside the handler and re-run.
3. Fire five POSTs for one user inside the window.

**Expected:** A static check asserts the `createRateLimiter` declaration precedes the exported handler, and a behavioural case fires five requests and expects the FIFTH to be denied - a per-request limiter would pass all five, so both halves are required. The denial carries `Retry-After` and `RateLimit-Limit` and WRITES NO ROW: a rate-limited request is never converted into a `failed` row, because a `failed` row consumes the attempt budget while a 429 consumed nothing but a counter. The gates refuse in order and each before `getGeminiClient` is constructed: the kill switch first (no Supabase client, no model client); 401 for an unauthenticated caller; identity from `getUser()` and never the cookie-only accessor (which makes ZERO network requests, so gating on it is a total bypass - a source sweep pins the absence); 400 for a malformed body and for a missing or oversized id; 403 with ZERO model calls and ZERO writes for a posting the caller holds no application on (403 and not 404 because the existence of a posting is not a secret); an empty description writes `unavailable` with NO model call; and the embedded engine makes ZERO calls of either kind, reads no server env, and writes `research_total: 0` so the worker's queue can never select the row. The GET read resolves an `applicationId` to its position, 401s an unauthenticated read, 403s an application the caller does not hold, 400s a request with neither id, returns `{glossary: null}` rather than a 404 for a posting never attempted, and makes no model call ever.

### R-351 | area: copilot-glossary | parallel-safe: yes | automatable: yes

**Summary:** FORCE MUST NOT MINT BUDGET. `model_calls_fingerprint` RESETS when the posting fingerprint changes - and anyone who can rewrite a shared posting's description can cycle that fingerprint. `model_calls_total <= 126` is what makes the reset safe rather than an unbounded spend bypass, and it is the half a well-meaning refactor would delete. A single one-way ratchet was the alternative and it is worse: it retires a shared posting's rebuild PERMANENTLY, for everyone, from a button rendered for every user, with no state for the condition.

**Steps:**
1. Run the cache-gate and counter cases of `app/api/copilot/glossary/route.test.js`.
2. Press Rebuild twice within an hour on one posting; then at each cap.

**Expected:** A `ready` row on the SAME fingerprint is returned as-is and `force` adds nothing (there is nothing a retry could add). A generation already in flight is returned as-is with `force` INCLUDED - this is what stops a rebuild press re-rolling the harvest and pulling the term list out from under the worker's cursor. A completed row at or above the research floor is returned as-is unless forced, and THE FLOOR IS EVALUATED ONLY ON A COMPLETED GENERATION (applying it to a row still in flight is what turns "incomplete" into "permanently stable at ~50%"). The one-hour cooldown refuses a second generation on the same posting with `force` INCLUDED, so no number of users pressing Rebuild can spend more than one generation an hour on a shared row. Either call cap refuses with `force` included, and the database CHECKs are the backstop under both. ACROSS a fingerprint change a rebuild IS allowed and is not a demotion; a fingerprint change resets the fingerprint counter to zero AND LEAVES `model_calls_total` UNTOUCHED. `force` increments both counters and does NOT reset `attempts`. An EMBEDDED force rebuild over a `ready` or `partial` row writes NOTHING and makes no call - that refusal is deliberately NOT scoped to a fingerprint, because a quotes-only write is a downgrade of KIND rather than of freshness: it would replace every researched definition on a shared row with a handful of posting quotes, on behalf of every other applicant, and a different fingerprint does not make that acceptable.

