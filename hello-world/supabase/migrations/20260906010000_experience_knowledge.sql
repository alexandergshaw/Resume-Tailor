-- ===========================================================================
-- Knowledge-page scope summaries and question history
-- ===========================================================================
-- Two new tables over the existing "Notion-like" knowledge-page tree
-- (public.experience_pages, 20260812000000_experience_pages.sql):
--
--   experience_page_summaries -- at most ONE stored, regenerable summary per
--     (user, scope).
--   experience_page_questions -- MANY rows per (user, scope): the full
--     question-and-answer history for that scope, append-only.
--
-- "Scope" is either the whole knowledge base (scope_page_id IS NULL, "the
-- root scope") or one page and everything beneath it in the tree
-- (scope_page_id = that page's id). See lib/experience/knowledgeScope.js
-- (not yet written in this checkout -- Wave 3a of this feature's
-- implementation plan) for how a scope id is turned into the set of pages it
-- actually covers, and lib/supabase/experienceKnowledge.js (Wave 4) for the
-- only code that will ever write these tables.
--
-- This migration is additive only: two new tables, their indexes, RLS and
-- grants, and (conditionally) one constraint on a THIRD, pre-existing table.
-- No `drop`, no `alter ... type`, no data rewrite, anywhere in this file.
--
-- ===========================================================================
-- WHY scope_key EXISTS: scope_page_id CANNOT BE AN UPSERT ARBITER BY ITSELF
-- ===========================================================================
-- The store's only write to experience_page_summaries is a single-row upsert
-- per scope -- "replace this scope's summary" -- and PostgREST turns
-- `.upsert(row, { onConflict })` into a bare `ON CONFLICT (<column list>)`
-- clause. Two independent facts about that make a raw, nullable
-- `scope_page_id` unusable as the target, and neither is a matter of style:
--
--   1. PostgreSQL requires a unique index on EXACTLY the conflict-target
--      columns to exist before it will accept the ON CONFLICT clause at all
--      (PostgreSQL 17 docs, INSERT: "All table_name unique indexes that,
--      without regard to order, contain exactly the conflict_target-specified
--      columns/expressions are inferred (chosen) as arbiter indexes"). Absent
--      one, the very first write raises Postgres error 42P10 -- "there is no
--      unique or exclusion constraint matching the ON CONFLICT specification"
--      (confirmed against PostgreSQL REL_17_STABLE source,
--      src/backend/optimizer/util/plancat.c, infer_arbiter_indexes()) --
--      loud, immediate, on every write. That failure mode is the CHEAP one.
--
--   2. Two PARTIAL unique indexes -- e.g. one on (user_id, scope_page_id)
--      where scope_page_id is not null, plus one on (user_id) where
--      scope_page_id is null for the root scope -- do not fix this and
--      cannot fix it through this stack at all. A partial index is only ever
--      inferred as an arbiter when the statement RESTATES its predicate
--      (same PostgreSQL docs: "If an index_predicate is specified, it must,
--      as a further requirement for inference, satisfy arbiter indexes ...
--      Used to allow inference of partial unique indexes"). The installed
--      PostgREST client (@supabase/postgrest-js 2.106.2, the version this
--      repo has) has no parameter for a predicate at all --
--      PostgrestQueryBuilder.ts sends `onConflict` as nothing but a bare
--      column list (`url.searchParams.set('on_conflict', onConflict)`), and
--      PostgREST's own docs describe `on_conflict` only as "a column(s) that
--      has a UNIQUE constraint". No predicate can ever reach the database
--      over this wire protocol, so two partial indexes fail with the exact
--      same 42P10 as having no index at all, on every write, forever -- this
--      is not a version gap or a future fix, it is a limitation of the
--      protocol the app already speaks.
--
-- A THIRD option -- one plain unique index on (user_id, scope_page_id),
-- nullable -- passes Postgres's inference (unlike the two above) and is the
-- genuinely dangerous choice, because it fails SILENTLY, not loudly. SQL
-- NULLs are distinct from each other by default (PostgreSQL 17 docs,
-- constraints: "two null values are not considered equal in this
-- comparison"), so `scope_page_id IS NULL` (the root scope) never matches
-- itself under that index, and PostgREST's "upsert" for the root scope
-- degrades to a plain INSERT every time -- each regeneration against the
-- root scope silently APPENDS a second, third, fourth row instead of
-- replacing the first. Nothing goes red at write time. It breaks two
-- generations later, somewhere else, when a `.maybeSingle()` read for that
-- scope finds more than one row and PostgREST raises PGRST116 -- a message
-- that names neither this table nor this cause.
--
-- The fix is the standard one for exactly this shape: `scope_key`, a STORED
-- GENERATED column that coalesces the nullable scope_page_id onto a sentinel
-- UUID for the root scope, so the arbiter column is NEVER NULL and
-- Postgres's ordinary (non-partial) unique-index inference and
-- NULL-distinctness both become non-issues -- there is no NULL for either
-- rule to act on. It also gives the read side ONE query shape for a scope's
-- history instead of two (`.eq("scope_key", key)` on both root and page
-- scopes, rather than `.is("scope_page_id", null)` for root and
-- `.eq("scope_page_id", id)` for a page -- two branches, and the wrong one
-- silently returns nothing).
--
-- The sentinel, 00000000-0000-0000-0000-000000000000 (the nil UUID), can
-- never collide with a real page id: experience_pages.id is
-- `default gen_random_uuid()`, which is UUID version 4 and sets specific
-- version/variant bits the nil UUID does not carry, so no real page id can
-- ever equal it.
--
-- ===========================================================================
-- scope_key MUST NEVER BE WRITTEN TO -- POSTGRES REFUSES IT, ON PURPOSE
-- ===========================================================================
-- PostgreSQL 17 docs, generated columns: "A generated column cannot be
-- written to directly. In INSERT or UPDATE commands, a value cannot be
-- specified for a generated column, but the keyword DEFAULT may be
-- specified." Any write from lib/supabase/experienceKnowledge.js that names
-- `scope_key` in its payload -- however "complete" that payload looks --
-- fails the write outright.
--
-- THIS IS DELIBERATE, AND IT CUTS AGAINST A PATTERN THIS REPO OTHERWISE
-- FOLLOWS: lib/supabase/applicationDigests.js's own header requires its
-- field whitelist to be "exhaustive for every column it may write", and a
-- test written to enforce that same rule literally here -- walking this
-- migration's column list and demanding whitelist coverage for all of
-- them -- would demand a payload that includes scope_key, which Postgres
-- then rejects on every single write. The whitelist in
-- lib/supabase/experienceKnowledge.js must be read as exhaustive for every
-- WRITABLE column, with `scope_key` named as the one deliberate, permanent
-- exception -- and its own test must assert scope_key's ABSENCE from the
-- sent payload, not its presence. Say this again in that file when it is
-- written; it is said here because a whitelist test written from this
-- migration's column list alone, without this file's header, has no way to
-- know the exclusion is intentional rather than an oversight.
--
-- ===========================================================================
-- WHY THE COMPOSITE FK IS ON BOTH TABLES, NOT JUST SUMMARIES
-- ===========================================================================
-- `foreign key (user_id, scope_page_id) references public.experience_pages
-- (user_id, id) on delete cascade` -- composite, never a plain
-- `scope_page_id references experience_pages (id)` -- for the exact reason
-- 20260812000000_experience_pages.sql's own header already gives for that
-- table's self-referencing FK (lines 17-26, re-read verbatim): "foreign-key
-- checks run bypassing row-level security entirely -- RLS only guards the
-- query path, not the FK's own lookup. A plain id-only FK would let a client
-- set parent_id to ANY user's page id through PostgREST: the update
-- policy's `with check (auth.uid() = user_id)` constrains user_id, not
-- parent_id." The identical mechanism applies to scope_page_id on both
-- tables below: an id-only FK (or no FK) lets a signed-in PostgREST caller
-- insert a row whose scope_page_id points at a page belonging to a
-- DIFFERENT user, because RLS's insert policy only constrains the row's own
-- user_id column, never the value referenced by a foreign key. The
-- composite FK makes that cross-tenant reference impossible to create at
-- the database level, not merely unlikely.
--
-- experience_page_summaries needed this on its own merits (a stored summary
-- names the page it summarizes). It is placed on experience_page_questions
-- for a separate, specific reason: without it, a PostgREST insert into
-- experience_page_questions could set scope_page_id to another user's page
-- id, creating a row the attacker owns that points at a victim's page -- a
-- page-id existence oracle reachable across tenants -- and that row would
-- never be cleaned up by the victim deleting that page, because deletion
-- only cascades through a FK that would not exist. The feature's own
-- criteria, as originally drafted, required "the same ownership + scope
-- columns" for the questions table but never named the foreign key -- an
-- omission this migration does not repeat.
--
-- MATCH SIMPLE (the default, used on both FKs below) skips the check when
-- ANY referencing column is NULL, so the root scope's scope_page_id IS NULL
-- stays valid on both tables with no special case -- the same reasoning
-- 20260812000000_experience_pages.sql:49-53 already states for parent_id.
--
-- ===========================================================================
-- PRECONDITION: unique (user_id, id) on public.experience_pages
-- ===========================================================================
-- The composite FKs above reference (user_id, id) on experience_pages, and
-- Postgres will only accept a FOREIGN KEY against a column pair that already
-- carries a UNIQUE or PRIMARY KEY CONSTRAINT on the referenced table -- a
-- bare `create unique index` with no backing pg_constraint row does NOT
-- satisfy this; Postgres's own docs are explicit that the referenced columns
-- must belong to "a non-deferrable unique or primary key constraint."
--
-- 20260812000000_experience_pages.sql:49 DOES declare
-- `unique (user_id, id)` -- but that line lives inside a
-- `create table if not exists public.experience_pages (...)` statement, and
-- `if not exists` means the ENTIRE statement is a silent no-op the moment a
-- table of that name already exists: it does not add a missing column or
-- constraint to a pre-existing table. This repo has TWO CONFIRMED cases of
-- exactly that drift already: `public.applications` and its
-- `applications_user_position_key` constraint (see
-- 20260906000000_applications_user_position_key.sql's header in full) exist
-- in production with no migration in this directory ever having created
-- either, and RLS is independently confirmed enabled on both `applications`
-- and `positions` while neither table appears in any of this directory's
-- `enable row level security` statements. Both drifts run the same
-- direction: production has MORE than the migrations describe. That means
-- an absence in this directory proves nothing about experience_pages
-- either, and the owner has not yet run the confirming query
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.experience_pages'::regclass;
-- against production.
--
-- The survival design is one guarded statement, in THIS file, run FIRST,
-- before either table below is created:
--
--   * If a unique CONSTRAINT on exactly (user_id, id) already exists on
--     experience_pages under the specific name this guard checks for --
--     because 20260812000000's CREATE TABLE really did run for real, and
--     really did produce that name -- the guard is a clean no-op.
--   * If an equivalent constraint already exists under some OTHER name
--     (the owner's query above finds one this migration did not predict),
--     the guard does not recognise it by name and adds a second,
--     functionally redundant unique constraint under the name below. Both
--     FKs created later in this file still validate correctly either way:
--     Postgres's FK validation accepts ANY unique CONSTRAINT (a primary key
--     or an explicit UNIQUE constraint, not a bare index) whose column set
--     exactly matches the referenced columns -- it does not care which one,
--     or how many. The only cost of that redundancy is a second B-tree
--     Postgres must maintain on every write to experience_pages, which is
--     strictly safer than a guard that risks missing an existing
--     constraint under an unpredicted name and failing the ALTER outright.
--   * If it is genuinely absent under any name, the guard's ALTER runs
--     exactly once and creates it, and both FKs below build cleanly.
--
-- Unlike 20260906000000_applications_user_position_key.sql's identically
-- shaped guard, THIS one needs no pre-check for existing violating rows.
-- That migration's constraint could genuinely be violated, because
-- positions.id is not unique per user. Here it cannot be: `id` is already
-- public.experience_pages's own PRIMARY KEY (20260812000000:35), globally
-- unique across every row regardless of user_id, so no two rows -- for the
-- same user or for different users -- can ever share an id. Adding user_id
-- to a column that is already globally unique on its own can never
-- encounter a duplicate; the ALTER below cannot fail with Postgres's
-- duplicate-key error on any database, in any state.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'experience_pages_user_id_key'
      and conrelid = 'public.experience_pages'::regclass
  ) then
    alter table public.experience_pages
      add constraint experience_pages_user_id_key
      unique (user_id, id);
  end if;
end $$;

-- ===========================================================================
-- DEPLOY ORDERING IS A HARD REQUIREMENT -- AND A FAILURE HERE BLOCKS EVERY
-- FUTURE MIGRATION IN THIS DIRECTORY
-- ===========================================================================
-- This migration must merge and go GREEN before any application code writes
-- to either table below. PostgREST rejects a row naming a column it does
-- not recognise, and it rejects the WHOLE ROW, not just the unknown key --
-- so a premature write from lib/supabase/experienceKnowledge.js (Wave 4)
-- would lose `summary` and `status` along with whatever else it sent, and
-- write no row at all. This is the identical reasoning
-- 20260905000000_application_digest_citation_outcome.sql's header states
-- for `citation_outcome`, and it applies again here for these two tables
-- specifically. There is deliberately no runtime schema check on the write
-- side -- sniffing PostgREST's unknown-column error string would turn a
-- schema problem into a silent partial write; the guarantee is procedural,
-- not defensive code.
--
-- .github/workflows/supabase-migrations.yml runs `supabase db push` on
-- every merge to main that touches this directory -- ANY file in it, not
-- only this one. If the guarded `add constraint` above fails for a reason
-- this header did not anticipate (it should not, per the proof above, but
-- this migration cannot see production), that failure blocks every OTHER,
-- unrelated future change to supabase/migrations/ behind it -- the same
-- failure mode 20260906000000_applications_user_position_key.sql's own
-- header names as the reason for its guard. Every statement in this file
-- has been checked against that bar: nothing below can fail against a
-- database that has none of the objects this migration creates, and the
-- one statement touching a pre-existing table (the guarded ALTER above) is
-- proven above to be unconditionally safe.
--
-- ===========================================================================
-- WHAT DELETING A PAGE PURGES -- AND WHAT THE SCHEMA CANNOT REACH
-- ===========================================================================
-- The owner's ruling: deleting a knowledge page invalidates every stored
-- summary and every stored answer whose scope CONTAINED it, not only rows
-- scoped to that exact page.
--
-- What `on delete cascade` on both composite FKs actually does,
-- mechanically: deleting a page P deletes every experience_page_summaries /
-- experience_page_questions row whose scope_page_id = P (the summary FOR P,
-- and P's own question history), AND -- because
-- 20260812000000_experience_pages.sql's own self-referencing FK already
-- cascades a page delete onto its whole subtree -- every row scoped to any
-- DESCENDANT of P as well, transitively, for free, as those descendant
-- pages are themselves deleted first. That is the whole of "deletes its
-- summary and, by the existing tree cascade, its descendants and their
-- summaries."
--
-- What no cascade can reach, and never will, no matter how this migration
-- is written: an ANCESTOR scope. A summary or question row scoped to P's
-- parent, P's grandparent, or the root (scope_page_id IS NULL) has a
-- scope_page_id that names the ANCESTOR, not P -- deleting P touches no
-- column any such row's FK points at, so no ON DELETE CASCADE, ON DELETE
-- SET NULL, or trigger declared on P's own row can ever fire for it. A
-- database-level cascade physically cannot express "purge every row whose
-- RECORDED SUBTREE, computed at generation time and long since discarded,
-- happened to contain the page just deleted" -- that requires knowing which
-- ancestor scopes P belonged to at generation time, which is exactly the
-- membership question lib/experience/knowledgeScope.js's
-- collectScopePages() answers in application code, not the database. The
-- root scope's row (scope_page_id IS NULL) is the extreme case of this: it
-- has no scope_page_id at all, so it can NEVER be reached by any FK cascade
-- on ANY page's delete, regardless of tree depth.
--
-- So: closing the owner's ruling in full is split across two layers, and
-- only one of them lives in this file.
--   * THIS MIGRATION covers exactly the scope-page-itself and
--     descendant-scope cases, via the two composite FKs' `on delete
--     cascade`.
--   * Application code -- the page-delete path (Wave 7 of this feature's
--     plan: app/components/experience/DeletePageDialog.js and whatever
--     server route actually issues the delete) -- MUST separately purge
--     every ANCESTOR scope's summary and question rows (walking up from the
--     deleted page to the root, including the root scope itself) before or
--     alongside the page delete. Nothing in this schema does that, nothing
--     in this schema COULD do that, and a reader of this file who assumes
--     the FK cascade is a complete implementation of the purge ruling would
--     be wrong in a way that leaves stale, page-derived prose sitting in a
--     summary or answer indefinitely after the page it came from is gone.
--
-- ===========================================================================
-- model IS FREE TEXT WITH NO CHECK CONSTRAINT -- DELIBERATELY
-- ===========================================================================
-- Every other closed-vocabulary column here (`status`) gets a CHECK.
-- `model` does not, on purpose: its allowed values are a set OWNED BY A
-- THIRD PARTY (the Gemini API's published model names), not by this schema.
-- A CHECK constraint enumerating today's known model names would reject a
-- write the moment the app is pointed at a newer model this migration's
-- author never heard of -- and it would reject it AFTER the paid model call
-- already happened, turning a successful, billed generation into a failed
-- write with no row and no way to show the user what they just paid for.
-- Free text costs nothing here that a CHECK would have protected against,
-- since `model` is never used to construct a query or a path -- it is
-- stored, displayed, and put in the downloadable log, nothing else.
--
-- ===========================================================================
-- DELIBERATELY NOT HERE
-- ===========================================================================
-- No RLS, policy or grant change to any OTHER table. No back-fill, no data
-- migration, no `not null` retrofit on any pre-existing column. No TTL,
-- purge job, or cleanup function for either new table -- the purge ruling
-- above is enforced by the FK cascade plus application code, never by a
-- scheduled job. No dedicated (user_id, scope_page_id) index for the two
-- composite FKs' own cascade-delete lookup: both tables' indexes below
-- already lead with `user_id`, which serves the FK's referential-integrity
-- trigger as a narrowing prefix scan rather than a direct lookup on the
-- exact (user_id, scope_page_id) pair the trigger predicates on. That is a
-- real, measured gap against a table that grows large enough for
-- page-delete latency to matter, not a claim that it is free -- if that
-- ever shows up as measured latency on a page delete, the fix is one more
-- `create index if not exists ... (user_id, scope_page_id)` in a follow-up
-- migration, not a reason to hold this one.
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch). Every
-- statement below is idempotent: `create table if not exists`,
-- `create index if not exists`, `comment on column` (replaces the comment
-- with the same text on a re-run), the `drop policy if exists` /
-- `create policy` pairs, and the guarded `add constraint` above are all
-- safe to re-run against a database that already has some or all of these
-- objects.

-- ---------------------------------------------------------------------------
-- experience_page_summaries: at most one stored summary per (user, scope).
-- ---------------------------------------------------------------------------
create table if not exists public.experience_page_summaries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  scope_page_id     uuid,
  scope_key         uuid generated always as (coalesce(scope_page_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  summary           text not null default '',
  source_pages      jsonb not null default '[]'::jsonb,
  retrieval_outcome jsonb,
  model             text,
  engine            text,
  status            text not null default 'ready',
  error             text,
  generated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint experience_page_summaries_status_check check (status in ('ready', 'failed')),
  -- MATCH SIMPLE (the default) skips this check when scope_page_id is NULL,
  -- so the root scope's row needs no special case. See this file's header,
  -- "WHY THE COMPOSITE FK IS ON BOTH TABLES", for why this must be composite
  -- rather than a plain `scope_page_id references experience_pages (id)`.
  foreign key (user_id, scope_page_id) references public.experience_pages (user_id, id) on delete cascade
);

-- The sole upsert arbiter -- see this file's header, "WHY scope_key EXISTS",
-- for why scope_page_id alone, and why two partial indexes, cannot serve
-- this role.
create unique index if not exists experience_page_summaries_user_scope_key
  on public.experience_page_summaries (user_id, scope_key);

-- Required because the primary key here is a surrogate (id), not one that
-- leads with user_id -- unlike drive_documents (20260901000000_drive.sql),
-- whose primary key LEADS with user_id and so needs no separate index to
-- serve `where user_id = auth.uid()`. Without this, every RLS-filtered read
-- on this table would need a full table scan.
create index if not exists experience_page_summaries_user_idx
  on public.experience_page_summaries (user_id);

comment on column public.experience_page_summaries.scope_page_id is
  'NULL means the whole knowledge base (the root scope); a page id means
   that page and its subtree. Never write scope_key alongside it: scope_key
   is derived from this column automatically and Postgres will reject any
   value supplied for it directly.';

comment on column public.experience_page_summaries.scope_key is
  'GENERATED ALWAYS, STORED: coalesce(scope_page_id, the nil uuid). Postgres
   refuses any value supplied for this column directly, so it must never
   appear in an insert or update payload. It exists because scope_page_id is
   nullable and the upsert target used by this table''s only writer requires
   an arbiter column that is never null, so the root scope can match itself
   on every write. See this migration''s header, "WHY scope_key EXISTS", for
   the full proof and the silent duplicate-row failure this column
   prevents.';

-- The "must never gain a default" rule below is the identical no-default
-- discipline this repo's migrations directory already applies to an
-- analogous jsonb outcome column on a different table -- see that other
-- migration's own header for the full argument. Deliberately NOT named by
-- filename or column name INSIDE the string literal that follows: that
-- other migration's own column-name is a substring of its filename, and
-- lib/supabase/applicationDigestsMigrationShape.test.js's mentions-sweep
-- greps every migration file's comment-STRIPPED text for that exact
-- substring to prove no second migration touches that column -- a sweep
-- that, by design, does not strip a STRING LITERAL's contents (only `--`
-- comments and prose), so spelling that name out inside this column's own
-- `comment on column` string, rather than in this `--` comment, would trip
-- that unrelated file's test. Confirmed by running it before and after.
comment on column public.experience_page_summaries.retrieval_outcome is
  'The full per-generation record: retrieval stage counts and their
   monotone-chain anomaly, citation stage counts and their own anomaly,
   model response diagnostics (called, responseTextKind, finishReason,
   envelopeParsed, answerChars), refusal tallies as {reason, count}, and
   whether the read of experience_pages was truncated. See
   lib/experience/knowledgeScope.js (buildRetrievalOutcome) for the exact
   shape. NULL means no retrieval outcome was ever computed for this row: a
   hard failure before the pipeline reached the counting stage, such as an
   auth, load, or parse error, which is a different state from a populated
   record whose counts are themselves zero. This column must NEVER GAIN A
   DEFAULT -- see the comment immediately above this one for why that rule
   is not a new idea in this repo: a default would make every future row
   indistinguishable from a real, computed outcome.';

comment on column public.experience_page_summaries.model is
  'Free text, no CHECK constraint. See this migration''s header, "model IS
   FREE TEXT", for why: the allowed values are owned by a third-party API,
   and a CHECK would reject a write for a model this schema does not yet
   know about, after the paid call already happened.';

comment on column public.experience_page_summaries.source_pages is
  'One element per page that was in scope at generation time, included or
   not, with its exclusion reason when excluded. Full contract:
   lib/experience/knowledgeScope.js (classifyScopePages). Overwritten
   wholesale on every regeneration; never appended to.';

comment on column public.experience_page_summaries.generated_at is
  'When this scope''s summary last succeeded, written by the application,
   never by the database (no default, no trigger). NULL means it has never
   succeeded. Distinct from updated_at, which means "row last written" and
   is stamped on every write including failures: a failure write should
   omit generated_at from its payload entirely rather than write NULL, so a
   prior success is not overwritten by a later failure''s absence of one.';

comment on column public.experience_page_summaries.status is
  'ready means the row reflects the last completed generation attempt for
   this scope, including one that legitimately found nothing to summarize;
   failed means the last attempt did not complete. The reason for a failure
   belongs in the error column and in retrieval_outcome, never in this
   column itself.';

alter table public.experience_page_summaries enable row level security;

drop policy if exists "experience_page_summaries_select_own" on public.experience_page_summaries;
create policy "experience_page_summaries_select_own" on public.experience_page_summaries
  for select using (auth.uid() = user_id);

drop policy if exists "experience_page_summaries_insert_own" on public.experience_page_summaries;
create policy "experience_page_summaries_insert_own" on public.experience_page_summaries
  for insert with check (auth.uid() = user_id);

drop policy if exists "experience_page_summaries_update_own" on public.experience_page_summaries;
create policy "experience_page_summaries_update_own" on public.experience_page_summaries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "experience_page_summaries_delete_own" on public.experience_page_summaries;
create policy "experience_page_summaries_delete_own" on public.experience_page_summaries
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.experience_page_summaries to authenticated;
grant all on table public.experience_page_summaries to service_role;

-- ---------------------------------------------------------------------------
-- experience_page_questions: append-only question/answer history, many rows
-- per (user, scope). No unique key at all -- history is intentionally
-- many-valued, and rows here are inserted, never upserted.
-- ---------------------------------------------------------------------------
create table if not exists public.experience_page_questions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  scope_page_id       uuid,
  scope_key           uuid generated always as (coalesce(scope_page_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  question            text not null,
  answer              text not null default '',
  citations           jsonb not null default '[]'::jsonb,
  answered_from_pages boolean,
  retrieval_outcome   jsonb,
  model               text,
  engine              text,
  status              text not null default 'ready',
  error               text,
  created_at          timestamptz not null default now(),
  constraint experience_page_questions_status_check check (status in ('ready', 'failed')),
  -- Identical composite FK to experience_page_summaries' above, for an
  -- identical reason -- see this file's header, "WHY THE COMPOSITE FK IS ON
  -- BOTH TABLES". This is the fix for the cross-tenant scope_page_id hole a
  -- summaries-only FK would otherwise leave open on this table.
  foreign key (user_id, scope_page_id) references public.experience_pages (user_id, id) on delete cascade
);

-- The read pattern: newest-first history for one scope
-- (`.eq("scope_key", key).order("created_at", { ascending: false })`). This
-- index also serves `where user_id = auth.uid()` as its leading column, so
-- no separate (user_id) index is added here -- it would only add write cost
-- for a query shape this index already leads with.
create index if not exists experience_page_questions_user_scope_created_idx
  on public.experience_page_questions (user_id, scope_key, created_at desc);

comment on column public.experience_page_questions.scope_page_id is
  'NULL means the whole knowledge base (the root scope); a page id means
   that page and its subtree. Never write scope_key alongside it: scope_key
   is derived from this column automatically and Postgres will reject any
   value supplied for it directly.';

comment on column public.experience_page_questions.scope_key is
  'GENERATED ALWAYS, STORED: coalesce(scope_page_id, the nil uuid). Postgres
   refuses any value supplied for this column directly, so it must never
   appear in an insert payload (this table is append-only; there is no
   update). It exists so a scope''s full question history is one query
   shape -- an equality match on scope_key -- for both the root scope and a
   page scope, rather than branching between an is-null check and an
   equality check on scope_page_id. See
   experience_page_summaries.scope_key''s comment above, and this
   migration''s header, "WHY scope_key EXISTS", for the full arbiter proof
   this column also relies on.';

comment on column public.experience_page_questions.citations is
  'Array of objects shaped {pageId}, deliberately with no title, no excerpt
   and no URL. A citation''s label is resolved against the LIVE page tree at
   render time, every time, never cached here, so that deleting a page
   actually removes it from a rendered answer; storing a title in this
   column would defeat that. Full contract: lib/experience/knowledgeScope.js
   (resolveCitedPageIds).';

comment on column public.experience_page_questions.answered_from_pages is
  'Three states, not two. TRUE: the model says its answer is grounded in the
   supplied pages. FALSE: the model explicitly says it could not answer from
   them. NULL: no answer envelope was ever parsed for this row, a hard
   failure before or during the model call. NULL and FALSE are different
   facts and must render as different sentences: treating NULL as FALSE
   reports that the pages do not say, for a question the model was never
   actually asked. Must NEVER GAIN A DEFAULT, for the identical reason
   retrieval_outcome below never does.';

comment on column public.experience_page_questions.retrieval_outcome is
  'Same shape and the same rule as
   experience_page_summaries.retrieval_outcome above -- see that comment.
   Must NEVER GAIN A DEFAULT.';

comment on column public.experience_page_questions.model is
  'Free text, no CHECK constraint. See this migration''s header, "model IS
   FREE TEXT", for why.';

comment on column public.experience_page_questions.status is
  'ready means this question received a completed answer attempt, including
   one where the model declined to answer from the supplied pages; failed
   means the attempt did not complete. The reason for a failure belongs in
   the error column and in retrieval_outcome, never in this column itself.';

alter table public.experience_page_questions enable row level security;

drop policy if exists "experience_page_questions_select_own" on public.experience_page_questions;
create policy "experience_page_questions_select_own" on public.experience_page_questions
  for select using (auth.uid() = user_id);

drop policy if exists "experience_page_questions_insert_own" on public.experience_page_questions;
create policy "experience_page_questions_insert_own" on public.experience_page_questions
  for insert with check (auth.uid() = user_id);

drop policy if exists "experience_page_questions_update_own" on public.experience_page_questions;
create policy "experience_page_questions_update_own" on public.experience_page_questions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "experience_page_questions_delete_own" on public.experience_page_questions;
create policy "experience_page_questions_delete_own" on public.experience_page_questions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.experience_page_questions to authenticated;
grant all on table public.experience_page_questions to service_role;
