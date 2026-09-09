-- ===========================================================================
-- public.position_glossaries -- the per-posting interview glossary
-- ===========================================================================
-- The explicitly-stated and implicitly-anticipated terms a candidate is likely
-- to meet in an interview for ONE POSTING, with a definition each. Generated
-- when the position is first applied to (app/api/copilot/glossary/route.js) and
-- read when the copilot opens that posting; the definitions are what the hover
-- popover shows.
--
-- ===========================================================================
-- TWO PHASES, AND THE SECOND ONE RUNS IN A CRON WORKER
-- ===========================================================================
-- The POST route makes ONE ungrounded harvest call and writes a COMPLETE row:
-- every term with a definition, every term provenance "recalled", no source
-- fields. Phase 2 is an UPGRADE PASS of ceil(n/12) GROUNDED
-- client.interactions.create calls, driven by /api/cron/position-glossary over
-- research_cursor.
--
-- WHY A WORKER: one research batch's worst case is ~92 seconds (45s timeout +
-- backoff + 45s retry, the figure app/api/application-digest/route.js derives
-- for the same call shape). Ten of them do not fit one serverless invocation at
-- any maxDuration this platform offers. A design that made ten calls from one
-- request could never finish, so 'ready' -- which the CHECK below defines as
-- recalled_count = 0 with the cursor exhausted -- would be arithmetically
-- unreachable while every gate reasoned about it.
--
-- THE CURSOR LIVES HERE AND NOT IN REDIS, ON PURPOSE. lib/feed/ingestFeed.js is
-- the resumable-worker pattern this feature copies, with one deliberate
-- deviation: its Redis cursor returns 0 on ANY cache error and its lock fails
-- OPEN. For feed ingestion those are correct -- the worst case is scanning the
-- same 25 companies twice. Here a cursor that reads 0 on a cache hiccup
-- restarts a generation and RE-SPENDS TEN GROUNDED CALLS. A failed instrument is
-- invalid, never its zero value, and that rule applies to money.
--
-- ===========================================================================
-- WHERE THE SOURCE URLS COME FROM
-- ===========================================================================
-- From url_citation.url on the Interactions surface, via
-- lib/copilot/glossaryCitations.js -- NEVER from groundingChunks[].web.uri,
-- which is a vertexaisearch REDIRECT and whose web.domain is documented "not
-- supported in Gemini API".
--
-- The join is PER TEXT BLOCK, never through interaction.output_text. The SDK
-- builds that field by a BACKWARDS, BARRIER-TERMINATED scan
-- (@google/genai dist/node/index.cjs:19018-19074) that EXCLUDES text emitted
-- before a google_search_call and CONCATENATES multiple blocks, while annotation
-- offsets are per-block. Joining through it resolves CLEANLY onto the WRONG text
-- whenever a response has more than one text block or any text before its first
-- search step -- which is the canonical grounded flow. Nothing is malformed in
-- that failure, so no refusal rule and no stage count can see it.
--
-- ===========================================================================
-- KEYED ON position_id, NOT application_id, AND THAT IS THE WHOLE DESIGN
-- ===========================================================================
-- A posting's vocabulary is a property of the posting, so the research runs ONCE
-- and every user who applies to that posting reuses it. Per-application keying
-- would research a popular posting once per applicant for identical output.
--
-- THE CONSEQUENCE, WHICH IS A HARD RULE AND NOT A NOTE: public.positions has NO
-- owner column -- one row is referenced by many users' applications rows, which
-- is the whole reason the catalogue is shared -- so this table has none either,
-- and A ROW HERE IS READABLE BY EVERY AUTHENTICATED ACCOUNT. NO BYTE DERIVED
-- FROM A USER'S OWN PRIVATE MATERIAL MAY EVER BE WRITTEN INTO IT: no resume
-- text, no drafted answer, no cover letter, no note, no user id, no hover count.
-- lib/copilot/glossaryStore.js enforces that with a column allow-list rather
-- than a spread, because a key no column matches is this repo's signature silent
-- drop and nothing at runtime catches it.
--
-- THE POSTING TEXT IS A DIFFERENT MATTER AND IS NOT TRUSTED. positions.title,
-- company and description are world-readable, and until
-- 20260908000000_positions_policy_hardening.sql is APPLIED they are also
-- world-WRITABLE (that file quotes the live policy dump). So description is
-- treated as UNTRUSTED INPUT everywhere: fenced in the prompt, rendered as text
-- and never as markup. THE FEATURE MUST NOT BE ENABLED IN PRODUCTION UNTIL THAT
-- MIGRATION HAS BEEN APPLIED.
--
-- SO IS EVERY source_url. It is a URL a model returned, persisted in a shared
-- table, read back by a DIFFERENT user's browser. It is re-validated through the
-- href gate AND re-checked against the redirect and intermediary rules AT
-- RENDER, never trusted from the row.
--
-- ===========================================================================
-- RLS ON, SELECT IS `to authenticated`, AND THERE IS NO WRITE POLICY AT ALL
-- ===========================================================================
-- The denial of user writes IS THE ABSENCE OF A POLICY. That is not a shortcut,
-- it is the strongest posture available and the only correct one here: a
-- row-ownership predicate needs a column naming the owner, and this table
-- deliberately has none, so no predicate over its columns can mean "this row is
-- yours". A permissive policy constrained only by the CALLER's role says nothing
-- about the ROW's content and is exactly the defect
-- 20260908000000_positions_policy_hardening.sql was written to remove from the
-- catalogue table this one hangs off.
--
-- Every write goes through lib/supabase/admin.js's createAdminClient(), which
-- bypasses RLS, from the two server routes that authenticate AND authorize (the
-- POST route) or authenticate as the platform (the cron route). No service_role
-- policy is declared either: service_role holds BYPASSRLS, so a policy naming it
-- would never be consulted, and writing one would imply a constraint that does
-- not exist.
--
-- ===========================================================================
-- THE FIVE STATUSES, AND WHY THERE IS NO SIXTH AND NO DEFAULT
-- ===========================================================================
--   'ready'       -- EVERY stored term is researched AND the cursor is exhausted.
--   'partial'     -- some researched, some recalled. ALSO the in-flight state:
--                    research_cursor < research_total means the worker has not
--                    finished. The two are told apart BY THE CURSOR, not by a
--                    sixth status value, and not by a third `provenance` -- a
--                    third provenance would render as neither label, i.e.
--                    silently as though the definition were sourced.
--   'quotes-only' -- the embedded engine's row: explicit terms only, each
--                    "defined" by the posting's own sentence, verbatim.
--   'unavailable' -- deliberately produced with NO terms: no description text.
--   'failed'      -- the HARVEST errored, or zero terms survived ingest.
-- A row simply not existing is the sixth, implicit state: never attempted.
--
-- NO DEFAULT ON status, DELIBERATELY. 20260817000000_application_digests.sql
-- defaults its status to 'ready' and that is safe there because no invariant
-- rides on the value. Here 'ready' carries a CHECK, and a default would let an
-- insert that omitted the column produce a 'ready' row over zero terms that
-- satisfies every constraint. The write path always supplies it; an insert that
-- does not MUST error.
--
-- truncated_reason IS NOT A DUPLICATE OF status:
--   'model'   -- a research batch was cut off. INCOMPLETE and RETRYABLE.
--   'ceiling' -- we kept the best 120 of more. COMPLETE.
--   'bytes'   -- the serialization bound dropped trailing terms.
--
-- ===========================================================================
-- TWO CALL COUNTERS, AND THE SPLIT IS THE POINT
-- ===========================================================================
-- model_calls_fingerprint is what the gates read, and it RESETS when
-- posting_fingerprint changes, because a genuinely different posting deserves a
-- fresh budget. model_calls_total NEVER resets, gates nothing but its own CHECK,
-- and exists so that resetting the first cannot be used as an unbounded spend
-- bypass by anyone who can rewrite positions.description -- which, until the
-- hardening migration is applied, is any authenticated account. A single one-way
-- ratchet was the alternative and it is worse: it retires a shared posting's
-- rebuild permanently, for everyone, with no way back.
--
-- Every statement below is idempotent; re-running this file is a no-op. There is
-- deliberately no explicit begin/commit: the Supabase CLI sends each migration
-- as one simple-query batch, which Postgres already executes in one implicit
-- transaction, and no other migration in this directory uses transaction control.

create table if not exists public.position_glossaries (
  position_id              uuid primary key references public.positions (id) on delete cascade,
  status                   text not null,
  reason                   text,
  engine                   text,
  terms                    jsonb not null default '[]'::jsonb,
  explicit_count           integer not null default 0,
  anticipated_count        integer not null default 0,
  researched_count         integer not null default 0,
  recalled_count           integer not null default 0,
  rejected_count           integer not null default 0,
  truncated_reason         text,
  dropped_count            integer not null default 0,
  max_anticipated          integer not null default 0,
  attempts                 integer not null default 0,

  -- SCHEDULING
  research_cursor          integer not null default 0,
  research_total           integer not null default 0,
  lease_until              timestamptz,
  queued_at                timestamptz,
  last_generation_at       timestamptz,

  -- The worker's queue predicate, as a COLUMN. PostgREST cannot compare two
  -- columns in a filter, so `research_cursor < research_total` is not
  -- expressible as a query predicate at all -- a worker written against it
  -- would either scan the whole table every two minutes or silently filter on
  -- something else. Generating it in the database keeps the queue read
  -- indexable and makes it impossible for the flag to drift from the pair it is
  -- derived from.
  research_pending         boolean generated always as (research_cursor < research_total) stored,

  -- SPEND
  model_calls_fingerprint  integer not null default 0,
  model_calls_total        integer not null default 0,

  -- OBSERVABILITY. The worker has no client, so its per-batch outcomes cannot
  -- reach the app activity log the way a route's response can. They are written
  -- HERE instead, which is why these columns exist at all.
  research_batches         integer not null default 0,
  unsearched_batches       integer not null default 0,
  malformed_batches        integer not null default 0,
  stage_counts             jsonb,
  refusal_reasons          jsonb,
  usage_totals             jsonb,

  posting_fingerprint      text not null default '',
  researched_at            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint position_glossaries_status_check
    check (status in ('ready', 'partial', 'quotes-only', 'unavailable', 'failed')),

  constraint position_glossaries_truncated_reason_check
    check (truncated_reason is null or truncated_reason in ('model', 'ceiling', 'bytes')),

  -- 'ready' MEANS FULLY RESEARCHED AND FINISHED, AND THE DATABASE ENFORCES IT
  -- OVER THE ARRAY, not merely over a counter the same statement wrote. A
  -- recalled_count = 0 check ALONE is defeated by exactly the bug it names: a JS
  -- miscount writes status 'ready' AND recalled_count 0 together, from the same
  -- array, in the same statement, and the constraint passes while terms still
  -- contains recalled entries. jsonb_contains is IMMUTABLE, which is what makes
  -- the containment test legal in a CHECK; if that is ever wrong, `supabase db
  -- push` fails loudly with "functions in check constraint must be marked
  -- IMMUTABLE" rather than shipping a weaker constraint. The cursor clause is
  -- what makes 'ready' mean FINISHED: a row whose worker has not finished is not
  -- ready no matter what the counters say.
  constraint position_glossaries_ready_is_fully_researched
    check (status <> 'ready'
           or (recalled_count = 0
               and research_cursor >= research_total
               and not (terms @> '[{"provenance": "recalled"}]'::jsonb))),

  -- THE SPEND CEILINGS, at the last line of defence. A JS bug that reset a
  -- counter cannot spend past these.
  constraint position_glossaries_calls_fingerprint_check
    check (model_calls_fingerprint <= 42),
  constraint position_glossaries_calls_total_check
    check (model_calls_total <= 126),
  constraint position_glossaries_calls_ordered_check
    check (model_calls_fingerprint <= model_calls_total),

  -- THE CURSOR IS BOUNDED AND ORDERED. Without this a negative or runaway cursor
  -- is a silent infinite worker. The 10 is not a policy number: it is
  -- 120 terms / 12 per batch, and lib/copilot/glossaryConstants.test.js asserts
  -- the two stay equal so a change to the batch size cannot leave the worker
  -- writing rows this constraint rejects mid-generation.
  constraint position_glossaries_cursor_check
    check (research_cursor >= 0
           and research_total >= 0
           and research_cursor <= research_total
           and research_total <= 10),

  -- THE HARD TERM CEILING. A `case` expression rather than
  -- `jsonb_typeof(terms) = 'array' and jsonb_array_length(terms) <= 120`,
  -- because PostgreSQL does not guarantee left-to-right evaluation of `and`
  -- inside a CHECK, so a non-array terms could reach jsonb_array_length and
  -- raise a type error instead of a constraint violation. `case` DOES guarantee
  -- its evaluation order.
  constraint position_glossaries_terms_shape
    check (
      case when jsonb_typeof(terms) = 'array'
           then jsonb_array_length(terms) <= 120
           else false
      end
    )
);

-- THE WORKER'S QUEUE READ. Without this the worker sequentially scans the whole
-- table every two minutes, forever. Partial on research_pending because a
-- finished row must never be selected: a worker that quietly re-researched
-- completed rows would turn the monthly bill into a subscription, and it is
-- exactly the change someone would make to "keep sources fresh".
create index if not exists position_glossaries_worker_queue_idx
  on public.position_glossaries (queued_at)
  where research_pending;

-- NOT ADDED, deliberately: a byte-size CHECK such as
--   check (pg_column_size(terms) <= 262144)
-- pg_column_size is not IMMUTABLE, and a CHECK containing a non-immutable
-- function is a dump/restore hazard. The byte bound is enforced in
-- lib/copilot/glossaryStore.js before the write, where it can also report which
-- terms overflowed and drop anticipated ones ahead of explicit ones.

-- NO user_id index: there is no user_id column, and there cannot be one.

alter table public.position_glossaries enable row level security;

-- Privileges and policies are separate gates and PostgREST needs both. Revoking
-- first makes the grants below a complete statement of this table's intended
-- privileges rather than a delta against whatever Supabase's default privileges
-- happened to leave in place.
revoke all on table public.position_glossaries from anon;
revoke all on table public.position_glossaries from authenticated;

grant select on table public.position_glossaries to authenticated;
grant all    on table public.position_glossaries to service_role;

drop policy if exists "position_glossaries_select_authenticated" on public.position_glossaries;
create policy "position_glossaries_select_authenticated" on public.position_glossaries
  for select to authenticated using (true);

-- There is no second policy, and that absence is the whole security posture of
-- this table. See the header.

comment on table public.position_glossaries is
  'Per-posting interview glossary, keyed on position_id. NO user_id: one posting
   is referenced by many users'' applications rows, so no row-ownership
   predicate can be written over this table and none should be attempted, and a
   row here is readable by every authenticated account. NO BYTE DERIVED FROM A
   USER''S OWN PRIVATE MATERIAL MAY BE WRITTEN INTO IT. WRITES ARE SERVICE-ROLE
   ONLY, enforced by the absence of any write policy rather than by a row
   predicate -- see 20260908000000_positions_policy_hardening.sql for why a row
   predicate cannot work on a table with no owner column. Reads are open to any
   authenticated user and closed to anon. Phase 2 of generation runs in
   /api/cron/position-glossary over research_cursor; research_pending is what
   that worker selects on.';
