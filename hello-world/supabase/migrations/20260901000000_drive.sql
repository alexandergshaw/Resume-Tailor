-- Google Drive integration: per-user document identity (drive_documents) and
-- the OAuth credential + app folder (drive_connections).
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch). Every
-- statement below is idempotent, so re-running it over an already-applied
-- migration is safe.

-- =============================================================================
-- 1. public.drive_documents
-- =============================================================================
--
-- Per-user Google Drive document identity for a tailored posting.
--
-- Shape follows 20260817000000_application_digests.sql: a new join-side table,
-- upserted on the subject's own identity, never appended. It is deliberately
-- NOT a column on generated_resumes / generated_cover_letters. Those tables are
-- APPEND-ONLY -- lib/supabase/saveGeneratedResume.js:51 is an .insert(, and
-- lib/supabase/documentVersions.js states that every generate, revise and
-- focus change appends a row and nothing dedupes or deletes. A drive_file_id
-- there would be orphaned by the next revise, the app would lose the Doc it is
-- meant to update in place, and it would create a second one. A docx_path
-- (20260617000000_generated_resume_docx_path.sql) belongs to ONE generation; a
-- Drive document identity belongs to the POSTING.
--
-- The key is (user_id, position_id, scope), not (position_id, scope):
-- public.positions is a SHARED table with no user_id column
-- (lib/supabase/upsertPosition.js, upserted onConflict "external_id"), so two
-- users can and do tailor the same position row. user_id leads the key so the
-- primary key's own index serves the RLS predicate -- no separate user index.
--
-- drive_file_id is NOT NULL. An earlier draft left that column empty-able to
-- express a "claim the row before calling Drive" concurrency protocol --
-- insert a placeholder row with an absent file reference, then fill it in
-- once the Drive call returns -- guarded by a paired check constraint tying
-- the file reference and the content hash together, plus a 2-minute
-- stale-claim reclaim window. That protocol was NOT adopted: the concurrency
-- hole it targeted is closed instead by a three-way version compare at save
-- time (client version vs. stored row version vs. live Drive version) plus a
-- `files.list`-by-name lookup on every create, neither of which needs an
-- empty-able column, a lease, or a reclaim timeout. A column with no
-- protocol behind it invites a future implementer to build half the
-- protocol, so it -- and its paired check constraint -- are withdrawn. A row
-- is written only once the Drive call for that scope has already returned a
-- file id; "never saved" and "save failed" are therefore the same durable
-- state here: no row at all.
--
-- positions is SHARED, so `on delete cascade` here has a blast radius worth
-- naming: deleting ONE position row silently deletes EVERY user's Drive
-- reference for that posting, and each of them then creates a duplicate Doc on
-- their next save. Near-unreachable today (20260610010000_positions_grants.sql
-- grants select/insert/update to authenticated -- no delete), but service_role
-- and any future retention job can do it. Cascade is still correct: position_id
-- is part of the primary key and cannot be null.

create table if not exists public.drive_documents (
  user_id               uuid        not null references auth.users (id)      on delete cascade,
  position_id           uuid        not null references public.positions (id) on delete cascade,
  scope                 text        not null,
  drive_file_id         text        not null,
  drive_content_hash    text,
  drive_file_version    text,
  drive_web_view_link   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint drive_documents_pkey primary key (user_id, position_id, scope),
  -- SQL cannot reference the JS constant directly -- these literals must be
  -- kept equal to DOCX_SCOPES in lib/tailor/documentScopes.js by hand. A
  -- `[src]` test asserts the two stay in sync.
  constraint drive_documents_scope_check check (scope in ('resume', 'cover'))
);

-- NO separate (user_id) index: unlike application_digests -- whose primary key
-- is application_id, leaving user_id unindexed -- user_id is the LEADING column
-- of this table's primary key, so the PK btree already serves
-- `where user_id = auth.uid()` as a prefix seek. Adding
-- drive_documents_user_idx would be a second index on the same prefix: pure
-- write cost, zero read benefit.

alter table public.drive_documents enable row level security;

drop policy if exists "drive_documents_select_own" on public.drive_documents;
create policy "drive_documents_select_own" on public.drive_documents
  for select using (auth.uid() = user_id);

drop policy if exists "drive_documents_insert_own" on public.drive_documents;
create policy "drive_documents_insert_own" on public.drive_documents
  for insert with check (auth.uid() = user_id);

-- UPDATE needs BOTH using and with check: without `with check` a user could
-- update their own row and move it to another user_id. Mirrors
-- application_digests.sql.
drop policy if exists "drive_documents_update_own" on public.drive_documents;
create policy "drive_documents_update_own" on public.drive_documents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "drive_documents_delete_own" on public.drive_documents;
create policy "drive_documents_delete_own" on public.drive_documents
  for delete using (auth.uid() = user_id);

-- RLS filters rows; it does NOT grant table access. Tables created by migration
-- get no privileges for the API roles, which is the exact failure
-- 20260609010000_feed_grants.sql and 20260610010000_positions_grants.sql were
-- both written to repair ("permission denied for table ..."). Grant them here
-- so this table never needs its own repair migration.
grant select, insert, update, delete on table public.drive_documents to authenticated;
grant all on table public.drive_documents to service_role;

-- =============================================================================
-- 2. public.drive_connections
-- =============================================================================
--
-- Per-user Google Drive OAuth credential + the app's "Resume Tailor" folder
-- id. SERVICE-ROLE ONLY.
--
-- !! THIS TABLE IS UNLIKE EVERY OTHER TABLE IN THIS DIRECTORY. !!
-- !! Do NOT copy the standard grant block from
-- !! 20260817000000_application_digests.sql (or from drive_documents above)
-- !! into this table. That block ends with `grant ... to authenticated`,
-- !! which would expose every signed-in user's Google refresh token to any
-- !! browser session the moment someone "fixed" the missing RLS policies
-- !! below by adding a select policy without also re-adding this table's
-- !! deliberate absence of an `authenticated` grant.
-- !!
-- !! This is the FIRST table in this migrations directory with NO
-- !! `authenticated` grant at all. RLS is enabled with NO policies for
-- !! `authenticated`: under RLS, no policy means no row is visible to any
-- !! non-service role -- that is the intended state, not an oversight, and
-- !! the explicit `revoke` below is belt-and-braces against a project-wide
-- !! `grant all on all tables in schema public` ever being run.
--
-- Reached only through lib/supabase/admin.js's createAdminClient(), which
-- requires SUPABASE_SERVICE_ROLE_KEY -- an established env var, so this adds
-- no new secret and no new deployment step. lib/supabase/driveConnections.js
-- is the ONLY module permitted to name this table; a `[src]` sweep enforces
-- that no other file under app/ or lib/ contains the string
-- "drive_connections", and that driveConnections.js itself never selects
-- every column from it.
--
-- expiry_date is `bigint`, not `timestamptz`: the OAuth client rewrites
-- `expires_in` into an absolute `expiry_date` in epoch milliseconds, and that
-- is the exact shape stored here -- no unit conversion at the boundary.
-- drive_documents' `user_id, position_id, scope` primary key does not apply
-- here: this is one row per user, not per posting, so `user_id` alone is the
-- primary key, the same one-to-one shape application_digests uses.

create table if not exists public.drive_connections (
  user_id             uuid        primary key references auth.users (id) on delete cascade,
  refresh_token       text        not null,
  access_token        text,
  expiry_date         bigint,
  scope               text,
  google_email        text,
  folder_id           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.drive_connections enable row level security;
-- DELIBERATELY NO POLICIES FOR `authenticated`, AND NO GRANT TO
-- `authenticated`. RLS on with no policy means the browser's anon-key client
-- cannot read this table even with a valid session -- only the service role
-- (which bypasses RLS entirely) can.

revoke all on table public.drive_connections from anon, authenticated;
grant all on table public.drive_connections to service_role;
