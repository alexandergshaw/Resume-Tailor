-- Company-research digest citations: the per-digest citation OUTCOME record,
-- plus an honest "when was this research actually performed" timestamp, on the
-- tracking table's research column. See
-- supabase/migrations/20260817000000_application_digests.sql for the table,
-- lib/supabase/applicationDigests.js for its only writer (upsertDigest), and
-- lib/tracking/applicationDigest.js for the pipeline these columns describe.
--
-- THIS MUST BE A NEW MIGRATION, NOT AN EDIT TO
-- 20260817000000_application_digests.sql. That file is already in main's
-- history and .github/workflows/supabase-migrations.yml has already pushed it,
-- so its `create table if not exists` is now a no-op against the live database
-- and editing the table definition in place would change nothing real while
-- looking correct in every local test. 20260812020000_experience_generated.sql
-- and 20260826000000_experience_attachment_text.sql both established the right
-- pattern for a column added after a table shipped -- a new, timestamped
-- `alter table ... add column if not exists` -- and this migration follows it.
--
-- ===========================================================================
-- DEPLOY ORDERING MATTERS, AND IT IS NOT COSMETIC.
-- ===========================================================================
-- This migration must merge and go GREEN BEFORE the application change that
-- writes `citation_outcome`. Not "preferably before" -- before.
--
-- upsertDigest (lib/supabase/applicationDigests.js:53-68) builds an EXPLICIT
-- `row` object and sends its keys. PostgREST rejects a row naming a column it
-- does not know, and it rejects the WHOLE ROW -- so `markdown`, `status` and
-- `sources` are lost along with the unknown key, no row is written at all, and
-- app/api/application-digest/route.js returns 500.
--
-- That is not a one-request failure. selectAutoDigestTargets
-- (lib/tracking/applicationDigest.js:192-215) excludes an application only
-- when a digest row EXISTS for it, and app/hooks/useApplicationDigests.js
-- feeds it the fresh database read rather than local state -- so with no row
-- written, every eligible application re-fires a full billed grounded search
-- on EVERY page load, silently, for as long as it stays inside
-- AUTO_DIGEST_MAX_AGE_HOURS (24). Landing the code first re-arms exactly the
-- billed retry storm this feature exists to prevent.
--
-- There is deliberately NO runtime schema check on the write side. Sniffing
-- PostgREST's unknown-column error string would turn a schema problem into a
-- silent partial write. The guarantee is procedural: this file merges, the
-- Supabase Migrations workflow goes green, and only then does the code push.
--
-- The READ side is already immune and must stay that way: listDigests does
-- `.select("*")` (applicationDigests.js:28). `*` never names a column, so it
-- cannot 400 on a missing one and it picks both new columns up for free. Do
-- not "optimise" that into a narrowed column list.
--
-- ===========================================================================
-- Column-by-column
-- ===========================================================================
--   citation_outcome -- jsonb, NULLABLE, NO DEFAULT. The per-digest record of
--                       what the citation pipeline received and what it did
--                       with it: the monotone stage counts
--                       (annotations >= spansUsable >= splicesSafe >= placed),
--                       the per-reason refusal tallies, which model surface
--                       produced the row, and the length+hash stamp that binds
--                       `sources[].start`/`.end` to THIS row's `markdown`. No
--                       URLs, no titles, no spans and no marker numbers live
--                       here -- per-citation data extends the existing
--                       `sources` jsonb elements in place, which needs no DDL.
--
--   researched_at    -- timestamptz, NULLABLE, NO DEFAULT. When research last
--                       SUCCEEDED for this row. See the section below; it is
--                       not `updated_at` and it is not the discriminator.
--
-- ---------------------------------------------------------------------------
-- citation_outcome MUST NEVER GAIN A DEFAULT. Not '{}'::jsonb, not
-- 'null'::jsonb, not anything.
-- ---------------------------------------------------------------------------
-- SQL NULL in this column is the ONLY signal separating "this row was written
-- before the citation pipeline existed" from "the pipeline ran and genuinely
-- found nothing to cite". Those two states render differently and mean
-- opposite things to a candidate reading the panel, and there is nothing else
-- in the row to tell them apart: a pre-fix digest had its publisher URLs
-- destroyed at WRITE time (the links were replaced by their own text), so
-- there is nothing to back-fill from and no back-fill is planned. A default
-- would stamp every historical row with a value indistinguishable from a real
-- outcome, permanently and silently, and nothing would go red.
--
-- If you are here to tidy the schema: adding a default to this column is a
-- data-destroying change dressed as housekeeping. It is asserted against by
-- lib/supabase/applicationDigestsMigrationShape.test.js, which parses this
-- file's own DDL.
--
-- ---------------------------------------------------------------------------
-- Why researched_at is a real column and not a field inside the jsonb
-- ---------------------------------------------------------------------------
-- `updated_at` legitimately means "row last written", and upsertDigest stamps
-- it unconditionally on every write (applicationDigests.js:56) -- including
-- the route's failure path, which carries the PREVIOUS run's markdown forward
-- (route.js:126-132). AppViewDialog's digest panel then renders
-- `Researched {formatRelative(digest.updated_at, ...)}` (AppViewDialog.js:50-52)
-- and never reads `status`, which is why six-week-old research can currently
-- display as "Researched 2 minutes ago". Research recency needs its own field;
-- `updated_at` must keep its honest meaning rather than be bent into one.
--
-- It is a COLUMN rather than a jsonb key because research recency is a thing
-- SQL will want to filter and order by -- "which digests are stale", "oldest
-- first" -- and a timestamp buried in jsonb needs a
-- `(citation_outcome->>'researchedAt')::timestamptz` cast at every call site,
-- cannot be b-tree indexed without an expression index, and silently yields
-- NULL on a typo in the key name. The cost asymmetry decides it: one nullable
-- column with no default is catalog-only metadata added now for free, whereas
-- discovering later that it was needed costs a SECOND migration and a SECOND
-- deploy on a feature whose whole deployment plan is "the columns must be
-- right the first time". `extracted_at` in
-- 20260826000000_experience_attachment_text.sql is the same shape for the same
-- reason.
--
-- TWO THINGS ABOUT THIS COLUMN, both easy to get wrong:
--
--   1. researched_at IS NOT THE PRE-FIX DISCRIMINATOR. It is NULL on a
--      pre-migration row AND on a post-migration row whose research has never
--      succeeded. Only `citation_outcome is null` answers "was this row
--      written before we could tell?".
--
--   2. It is written by the app, never by the database -- there is no default
--      and no trigger, so it stays NULL until code sets it. A reader must not
--      treat NULL as "just now"; a row with markdown and a NULL researched_at
--      is a row written before this column was populated, and should fall back
--      to `updated_at` WITH the accompanying disclosure rather than assert a
--      recency it does not know.
--
-- ---------------------------------------------------------------------------
-- ONE IDENTIFIER, SPELLED citation_outcome, EVERYWHERE
-- ---------------------------------------------------------------------------
-- The column here, the key on upsertDigest's `row`, and the field on its
-- `fields` argument are all spelled `citation_outcome`. There is no camelCase
-- variant and no shortened variant anywhere in this feature. An earlier design
-- draft wrote `row.citations` for this column; implemented literally that
-- writes a key no column matches, which is this repo's signature silent-drop
-- failure. Same rule for `researched_at`.
--
-- ---------------------------------------------------------------------------
-- COST: catalog-only. NEITHER COLUMN HAS A DEFAULT AT ALL, which is the
-- cheapest possible add -- no value has to be materialised for any existing
-- row, so Postgres adds these as pure catalog metadata with no table rewrite.
-- (A VOLATILE default -- `now()`, or anything reading session or transaction
-- state -- would force a full rewrite under an ACCESS EXCLUSIVE lock, which is
-- the rule 20260826000000_experience_attachment_text.sql's header states.)
--
-- RLS AND GRANTS ARE UNCHANGED, and this migration deliberately does not touch
-- them. Verified by reading 20260817000000_application_digests.sql:56-75: row
-- level security is enabled on public.application_digests as a whole and all
-- four policies (select/insert/update/delete) predicate on
-- `auth.uid() = user_id` -- a table-wide condition already covering every
-- column on the table, these two included -- and the grants are table-level.
-- Adding a column never widens or narrows a policy that was never
-- column-scoped. Whether those policies are actually live in the production
-- database is a separate, open question, and a migration is not the place to
-- guess at it: confirm it directly with
--   select relname, relrowsecurity from pg_class
--    where relname = 'application_digests';
--   select policyname, cmd, qual, with_check from pg_policies
--    where tablename = 'application_digests';
--
-- DELIBERATELY NOT HERE: no change to `status` or its CHECK constraint; no
-- `not null`; no RLS, policy or grant change; no index (nothing queries by
-- either column, and listDigests filters on user_id + application_id, both
-- already covered by application_digests_user_idx and the primary key); no
-- TTL, purge or cleanup function; no back-fill. Every statement below only
-- ADDS -- there is no drop, no type change and no data rewrite in this file.
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can also
-- be started by hand from the Actions tab (workflow_dispatch). Every statement
-- below is idempotent -- `add column if not exists` skips an existing column,
-- and `comment on column` replaces the comment with the same text -- so
-- re-running this over an already-applied migration is safe.
--
-- Two notes on the `comment on column` statements below, for whoever edits
-- them next. Adjacent string literals separated by a NEWLINE are concatenated
-- by Postgres; joining two of those fragments onto one line is a syntax error,
-- not a reformat. And their prose deliberately contains no "--" sequence: it
-- would be harmless to Postgres (inside a string literal it is just two
-- characters) but it mangles any naive source-text tool that strips SQL line
-- comments, this migration's own shape test included.

alter table public.application_digests
  add column if not exists citation_outcome jsonb,
  add column if not exists researched_at    timestamptz;

comment on column public.application_digests.citation_outcome is
  'Per-digest citation outcome: the monotone stage counts, the per-reason refusal tallies, the '
  'model surface that produced the row, and the length+hash stamp binding sources[].start/.end to '
  'this row''s markdown. Contains NO urls, NO titles and NO spans. NULL means the row predates the '
  'citation pipeline, and that is the ONLY signal separating a pre-feature row from one where the '
  'pipeline ran and found nothing, so this column MUST NEVER BE GIVEN A DEFAULT. '
  'OPEN QUESTION (unresolved, recorded here rather than guessed at): the Gemini API Additional '
  'Terms restrict caching Grounded Results, with a carve-out permitting storage for up to two (2) '
  'years in an end user''s chat history. This table has no TTL and no purge job. Whether a '
  'per-application research digest falls inside that carve-out has not been answered.';

comment on column public.application_digests.researched_at is
  'When research last SUCCEEDED for this row, written by the application. Distinct from updated_at, '
  'which means "row last written" and is stamped on every upsert including the failure path that '
  'carries the previous run''s markdown forward, which is why updated_at must not be read as '
  'research recency. NULL means either a row written before this column existed or a row whose '
  'research has never succeeded, so this column is NOT the pre-feature discriminator: '
  '"citation_outcome is null" is. No default and no trigger, so NULL is never "now".';
