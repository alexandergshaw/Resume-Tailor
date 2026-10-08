-- Application project pool: the pre-warmed set of invented "example projects"
-- the interview copilot shows beside a drafted answer (see
-- lib/copilot/projectExampleGen.js, lib/copilot/projectExampleSelect.js and
-- lib/supabase/applicationProjectPool.js). One row per tracked application,
-- holding the handful of hypothetical, domain-anchored example projects a
-- model generated for that posting, so the answer route can pick one per
-- question with no model call on the critical path.
--
-- This is a NEW join-side table, deliberately not a column added to
-- `public.applications`, for the same reason application_digests is not:
-- `applications` predates this repo's migration set (it has no `create table`
-- here to alter) and is written by six separate call sites across the app. A
-- table that only ever LEFT JOINs against `applications.id` cannot break any
-- of those writers; a migration that tried to ALTER the existing table could.
--
-- `application_id` is the primary key, not a generated `id` -- this is a
-- one-to-one extension of `applications`, so "does this application already
-- have a pool" is a primary-key lookup, and `on delete cascade` means a
-- deleted application's pool disappears with it rather than becoming an
-- orphaned row.
--
-- `projects` is a JSON array of entries shaped
-- { competency, domain, title, bullets: string[], hypothetical: true }. It is
-- the whole pool, question-independent; the per-question pick is computed
-- fresh in the answer route and is never stored here.
--
-- `status` has THREE values, and the difference from application_digests is
-- load-bearing: 'pending' is an ACTIVELY WRITTEN state here, not merely a
-- reserved one. The prewarm route writes a timestamped 'pending' row BEFORE
-- the model call, so the answer route can tell a generation still in flight
-- (young pending: "warming") from one that crashed mid-run (pending older
-- than POOL_PENDING_MAX_AGE: "failed", and the cost gate retries it). A CHECK
-- that omitted 'pending' would make that write violate the constraint -- the
-- upsert would fail, no row would be written, and the cost gate would re-fire
-- a billed generation on every load. 'ready' means `projects` is usable;
-- 'failed' means the generation errored (`error` holds why) and is not
-- auto-retried. A row simply not existing yet is the fourth, implicit state:
-- "never attempted".
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch). Every
-- statement below is idempotent, so re-running it over an already-applied
-- migration is safe. Once applied, this file must not be edited in place:
-- `db push` keys on the version stamp, so an edited applied file is skipped
-- and the committed text would describe a database that does not exist.

create table if not exists public.application_project_pool (
  application_id uuid primary key references public.applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  projects       jsonb not null default '[]'::jsonb,
  status         text not null default 'pending',
  error          text,
  engine         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint application_project_pool_status_check check (status in ('pending', 'ready', 'failed'))
);

-- RLS's own policies already restrict every query to `auth.uid() = user_id`,
-- but that predicate still has to scan something -- this index is what lets
-- it seek instead of scanning the whole table, mirroring
-- application_digests_user_idx in 20260817000000_application_digests.sql.
create index if not exists application_project_pool_user_idx
  on public.application_project_pool (user_id);

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring 20260817000000_application_digests.sql.
-- ---------------------------------------------------------------------------
alter table public.application_project_pool enable row level security;

drop policy if exists "application_project_pool_select_own" on public.application_project_pool;
create policy "application_project_pool_select_own" on public.application_project_pool
  for select using (auth.uid() = user_id);

drop policy if exists "application_project_pool_insert_own" on public.application_project_pool;
create policy "application_project_pool_insert_own" on public.application_project_pool
  for insert with check (auth.uid() = user_id);

drop policy if exists "application_project_pool_update_own" on public.application_project_pool;
create policy "application_project_pool_update_own" on public.application_project_pool
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "application_project_pool_delete_own" on public.application_project_pool;
create policy "application_project_pool_delete_own" on public.application_project_pool
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.application_project_pool to authenticated;
grant all on table public.application_project_pool to service_role;
