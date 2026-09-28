-- N64 step 1 (backlog docs/loop/N64.plan.r1.md, Step 1): saved formatting
-- templates for resumes and cover letters.
--
-- ===========================================================================
-- ARCHITECTURE: provenance lives on public.applications, NOT on the
-- generated-document tables (Arch B, orchestrator ruling 4)
-- ===========================================================================
-- `accept_application_facts` (20260928000000_n59_cover_letter_docx_path.sql
-- and its predecessor 20260923030000_application_accepted_facts.sql)
-- re-inserts a NEW public.generated_cover_letters row and repoints
-- `applications.cover_letter_id` at it every time a user accepts a
-- researched fact. A `template_id` column placed on
-- `generated_cover_letters` would therefore be silently NULLed on every fact
-- acceptance, because the fresh row the RPC inserts would carry no
-- provenance -- a live template's name would vanish from a past
-- application's display the moment the user accepted any fact on it. Putting
-- the four provenance columns on `public.applications` instead makes that
-- loss structurally impossible: `accept_application_facts` only ever
-- repoints `cover_letter_id`, and is not touched or re-issued by this
-- migration. Do not "fix" this by moving these columns onto
-- `generated_resumes` / `generated_cover_letters` -- that reintroduces the
-- bug this architecture exists to foreclose.
--
-- ===========================================================================
-- AUTHORED ON ASSUMPTION -- the live-schema check was explicitly WAIVED
-- (owner ruling 3, 2026-09-28); this changes the idiom below (owner ruling 6)
-- ===========================================================================
-- `public.applications`' base CREATE TABLE is not in this repo (predates the
-- migrations directory, confirmed by 20260906000000_applications_user_
-- position_key.sql's own header and by askTracking.js's comment to the same
-- effect) and this repo has a CONFIRMED case of the live database carrying a
-- constraint no migration here creates (that same file). So the four new
-- `applications` columns and the two new foreign keys below are added on
-- ASSUMPTION, not on a verified live schema. The assumptions being made,
-- stated so a reviewer can check them against a real query before this ships:
--   1. `public.applications` EXISTS in the live database. (Confirmed in
--      practice by the app's heavy use of it -- askTracking.js,
--      positions_grants.sql -- though not by a migration in this repo.)
--   2. `public.applications` has NO existing column or constraint already
--      named for a resume or cover template (i.e. none of
--      `resume_template_id`, `resume_template_label`, `cover_template_id`,
--      `cover_template_label`, `applications_resume_template_id_fkey`,
--      `applications_cover_template_id_fkey` already exist on it).
--      THIS IS THE ONLY ASSUMPTION AN ACTIVE STATEMENT BELOW CAN TRIP, and
--      so it is the one a post-deploy check should spend its attention on.
--
-- Deliberately NOT listed as assumptions, because nothing below depends on
-- them and listing them would misdirect a verifier: the type of
-- `applications.id` or `applications.user_id`, and whether `applications`
-- has RLS enabled. The two foreign keys run FROM the new `applications`
-- columns TO `resume_templates(id)`; they never reference `applications.id`
-- or `user_id`, and this file adds no policy to `applications`. The real
-- live-schema dependency is instead that `authenticated`'s TABLE-LEVEL
-- update grant on `applications` (positions_grants.sql:14) covers the new
-- columns -- a table-level grant automatically covers columns added later,
-- so this holds, but it is the dependency that actually matters.
--
-- Because assumption 2 might be wrong, the four `add column` statements and
-- the two `add constraint` statements below deliberately use the PLAIN,
-- non-idempotent form -- NOT `add column if not exists`, and NOT a `do $$ ...
-- if not exists ... $$` guard around the constraints. This is DELIBERATE.
-- Supabase's migration workflow (.github/workflows/supabase-migrations.yml,
-- `supabase db push`) applies each migration file exactly once, keyed by its
-- filename stamp, so re-run idempotency is not needed here. If any of the
-- four names above already exists in the live database, the plain form
-- raises a hard Postgres error and the deploy STOPS -- loudly and visibly.
--
-- HOW TO RECOVER, and read this carefully because the obvious answer is
-- WRONG: each migration file runs in one implicit transaction, so a
-- collision rolls this ENTIRE file back. It is never recorded in
-- schema_migrations and it stays PENDING. `supabase db push` applies
-- pending files in stamp order and stops at the FIRST failure, so a
-- later-stamped follow-up migration CANNOT leapfrog this one to fix it --
-- it sorts behind the failure and never runs. Until this file is resolved,
-- EVERY later migration in the project is blocked behind it (the same
-- hazard 20260908000000_positions_policy_hardening.sql:191-214 records).
-- The recovery is therefore to correct THIS file -- or `supabase migration
-- repair` -- before the next push. Editing it is correct precisely because
-- on this path it was never applied. The
-- alternative -- `if not exists` / a guarded no-op -- would instead succeed
-- silently against a wrong guess, leaving this repo's application code
-- writing template provenance into a column that already means something
-- else in production. A loud stop is the safe failure mode here; a silent
-- no-op is not. DO NOT change these four `add column` / two `add constraint`
-- statements back to an idempotent form -- that would defeat the reason they
-- are written this way.
--
-- The new `resume_templates` table below is a DIFFERENT case: it is a table
-- this repo's migration history is the sole author of (no drift risk), so
-- `create table if not exists` remains the correct, safe, idempotent idiom
-- for it, exactly as used elsewhere in this directory.
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
-- 1. `public.resume_templates` -- a new per-user table holding named,
--    saved formatting templates (resume or cover-letter .docx shells),
--    copied in SHAPE from 20260703000000_tailor_personas.sql: RLS enabled,
--    four `auth.uid() = user_id` policies (select/insert/update/delete), a
--    per-user index, and a unique index on (user_id, kind, lower(name)) so a
--    user cannot save two same-named templates of the same kind. Storage
--    bytes live in the existing `resumes` bucket at
--    `${user_id}/templates/${id}.docx`; nothing new in storage plumbing.
-- 2. Four nullable provenance columns on `public.applications`:
--    `resume_template_id`, `resume_template_label`, `cover_template_id`,
--    `cover_template_label`. Nullable throughout, so every pre-migration
--    application row, and every future generation where the user picks no
--    template, keeps NULL and degrades gracefully (today's behaviour). The
--    `*_template_label` columns are a name SNAPSHOT taken at generation time,
--    kept alongside the live FK id so a later reader can still show what
--    template was used even after that template is deleted.
-- 3. Two foreign keys, `applications.resume_template_id` and
--    `applications.cover_template_id`, both referencing
--    `public.resume_templates(id)` `ON DELETE SET NULL`. Never CASCADE:
--    deleting a saved template must only null the pointer on any application
--    that used it, and must never delete or corrupt that application's own
--    row or its already-generated, already-downloaded output documents
--    (those are frozen bytes captured at generation time, stored and read
--    independently of this table).
--
-- This migration touches no application code, and does not alter
-- `accept_application_facts`, `generated_resumes`, or
-- `generated_cover_letters` in any way.

-- ---------------------------------------------------------------------------
-- 1. public.resume_templates -- new table, safe to keep idempotent (see
--    header: this repo is the sole author of this table's schema).
-- ---------------------------------------------------------------------------
create table if not exists public.resume_templates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  kind         text not null check (kind in ('resume', 'cover')),
  storage_path text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists resume_templates_user_idx
  on public.resume_templates (user_id);

-- A user cannot save two templates of the same kind under the same name
-- (case-insensitive), so selection at generation time is unambiguous (AC-2).
create unique index if not exists resume_templates_user_kind_name_uniq
  on public.resume_templates (user_id, kind, lower(name));

alter table public.resume_templates enable row level security;

drop policy if exists "resume_templates_select_own" on public.resume_templates;
create policy "resume_templates_select_own" on public.resume_templates
  for select using (auth.uid() = user_id);

drop policy if exists "resume_templates_insert_own" on public.resume_templates;
create policy "resume_templates_insert_own" on public.resume_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists "resume_templates_update_own" on public.resume_templates;
create policy "resume_templates_update_own" on public.resume_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "resume_templates_delete_own" on public.resume_templates;
create policy "resume_templates_delete_own" on public.resume_templates
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.resume_templates to authenticated;
grant all on table public.resume_templates to service_role;

-- ---------------------------------------------------------------------------
-- 2. Provenance columns on public.applications (Arch B) -- PLAIN `add
--    column`, DELIBERATELY not `if not exists` (see header, owner ruling 6).
-- ---------------------------------------------------------------------------
alter table public.applications add column resume_template_id uuid;
alter table public.applications add column resume_template_label text;
alter table public.applications add column cover_template_id uuid;
alter table public.applications add column cover_template_label text;

-- ---------------------------------------------------------------------------
-- 3. Foreign keys, ON DELETE SET NULL -- PLAIN `add constraint`,
--    DELIBERATELY not guarded with `do $$ ... if not exists ... $$` (see
--    header, owner ruling 6). The table (section 1, above) is created in
--    this same file before these constraints run.
-- ---------------------------------------------------------------------------
alter table public.applications
  add constraint applications_resume_template_id_fkey
  foreign key (resume_template_id) references public.resume_templates (id)
  on delete set null;

alter table public.applications
  add constraint applications_cover_template_id_fkey
  foreign key (cover_template_id) references public.resume_templates (id)
  on delete set null;
