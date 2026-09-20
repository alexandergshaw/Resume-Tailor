-- N33's O-15 exemption trust anchor: the candidate's own name (once per
-- account) and the interviewer names they have been given (once per
-- application). Neither table existed before this migration -- the
-- 2026-09-20 owner reversal moved interviewer-name storage OFF
-- `interview_stages.interviewer_names` onto a dedicated table, because that
-- column carries no migration of its own, no ownership predicate on its
-- UPDATE (see the N37 fix alongside lib/supabase/upsertInterviewStage.js),
-- and a per-stage shape that does not match "names arrive before any
-- interview is even scheduled" (docs/backlog.yml N33, decision (2)).
--
-- Timestamped later than every migration in this directory as of writing
-- (20260915000000_interview_prep_spend_lockdown.sql) and NEVER edits an
-- already-applied migration -- backlog N30 records that exact hazard firing
-- in this same feature area.

-- ===========================================================================
-- public.candidate_identity -- once per account, structurally impossible to
-- duplicate: the primary key IS user_id, so there is exactly one row per
-- account, full stop -- no "most recent across applications" query, no
-- prefill heuristic, no risk of one application's copy going stale relative
-- to another's, because there is no other copy.
--
-- Precedent: supabase/migrations/20260630000000_tailor_library.sql:87-93
-- (public.tailor_profile), an exact structural match -- PK-on-user_id, one
-- settings-shaped row per account.
-- ===========================================================================

create table if not exists public.candidate_identity (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  candidate_name  text,
  updated_at      timestamptz not null default now()
);

alter table public.candidate_identity enable row level security;

drop policy if exists "candidate_identity_select_own" on public.candidate_identity;
create policy "candidate_identity_select_own" on public.candidate_identity
  for select using (auth.uid() = user_id);

drop policy if exists "candidate_identity_insert_own" on public.candidate_identity;
create policy "candidate_identity_insert_own" on public.candidate_identity
  for insert with check (auth.uid() = user_id);

drop policy if exists "candidate_identity_update_own" on public.candidate_identity;
create policy "candidate_identity_update_own" on public.candidate_identity
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "candidate_identity_delete_own" on public.candidate_identity;
create policy "candidate_identity_delete_own" on public.candidate_identity
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.candidate_identity to authenticated;
grant all on table public.candidate_identity to service_role;

-- ===========================================================================
-- public.application_trusted_names -- interviewer names, per application.
-- Deliberately carries NO candidate_name column: the candidate's own name is
-- per-ACCOUNT (candidate_identity above), never duplicated onto a
-- per-application row.
--
-- Precedent: supabase/migrations/20260914000000_interview_prep.sql:131-133
-- (interview_prep_packs' own column shape) and :252-276 (the identical
-- four-policy RLS/grant block), copied verbatim minus the candidate_name
-- column.
-- ===========================================================================

create table if not exists public.application_trusted_names (
  application_id     uuid primary key references public.applications (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  interviewer_names  text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists application_trusted_names_user_idx
  on public.application_trusted_names (user_id);

alter table public.application_trusted_names enable row level security;

drop policy if exists "application_trusted_names_select_own" on public.application_trusted_names;
create policy "application_trusted_names_select_own" on public.application_trusted_names
  for select using (auth.uid() = user_id);

drop policy if exists "application_trusted_names_insert_own" on public.application_trusted_names;
create policy "application_trusted_names_insert_own" on public.application_trusted_names
  for insert with check (auth.uid() = user_id);

drop policy if exists "application_trusted_names_update_own" on public.application_trusted_names;
create policy "application_trusted_names_update_own" on public.application_trusted_names
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "application_trusted_names_delete_own" on public.application_trusted_names;
create policy "application_trusted_names_delete_own" on public.application_trusted_names
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.application_trusted_names to authenticated;
grant all on table public.application_trusted_names to service_role;
