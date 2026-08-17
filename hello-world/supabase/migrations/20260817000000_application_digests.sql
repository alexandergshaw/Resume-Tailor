-- Application digests: the researched "what the posting does not tell you"
-- column on the tracking table (see lib/tracking/applicationDigest.js and
-- lib/supabase/applicationDigests.js). One row per tracked application,
-- holding the markdown a grounded model call produced plus the sources it
-- actually grounded on.
--
-- This is a NEW join-side table, deliberately not a column added to
-- `public.applications`. `applications` predates this repo's migration set
-- (it has no `create table` here to alter) and is written by six separate
-- call sites across the app. A table that only ever LEFT JOINs against
-- `applications.id` cannot break any of those writers; a migration that
-- tried to ALTER the existing table could.
--
-- `application_id` is the primary key, not a generated `id` — this is
-- intentionally a one-to-one extension of `applications`, so "does this
-- application already have a digest" is a primary-key lookup, and
-- `on delete cascade` means a deleted application's digest disappears with
-- it rather than becoming an orphaned row.
--
-- `status` distinguishes 'ready' (markdown/sources are usable) from 'failed'
-- (the grounded call errored; `error` holds why). This distinction is what
-- lets lib/tracking/applicationDigest.js's selectAutoDigestTargets refuse to
-- auto-retry a failed row on every page load — see that file's header
-- comment. A row simply not existing yet (no INSERT at all) is the third,
-- implicit state: "never attempted."
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch). Every
-- statement below is idempotent, so re-running it over an already-applied
-- migration is safe.

create table if not exists public.application_digests (
  application_id uuid primary key references public.applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  markdown       text not null default '',
  status         text not null default 'ready',
  error          text,
  sources        jsonb not null default '[]'::jsonb,
  engine         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint application_digests_status_check check (status in ('ready', 'failed'))
);

-- RLS's own policies already restrict every query to `auth.uid() = user_id`,
-- but that predicate still has to scan something — this index is what lets
-- it seek instead of scanning the whole table, mirroring why
-- practice_answers_application_idx exists in 20260805000000_practice_answers.sql.
create index if not exists application_digests_user_idx
  on public.application_digests (user_id);

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring 20260812000000_experience_pages.sql.
-- ---------------------------------------------------------------------------
alter table public.application_digests enable row level security;

drop policy if exists "application_digests_select_own" on public.application_digests;
create policy "application_digests_select_own" on public.application_digests
  for select using (auth.uid() = user_id);

drop policy if exists "application_digests_insert_own" on public.application_digests;
create policy "application_digests_insert_own" on public.application_digests
  for insert with check (auth.uid() = user_id);

drop policy if exists "application_digests_update_own" on public.application_digests;
create policy "application_digests_update_own" on public.application_digests
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "application_digests_delete_own" on public.application_digests;
create policy "application_digests_delete_own" on public.application_digests
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.application_digests to authenticated;
grant all on table public.application_digests to service_role;
