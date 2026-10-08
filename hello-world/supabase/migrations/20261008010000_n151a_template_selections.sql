-- Template selections: the per-(user, kind) pointer that records WHICH saved
-- formatting template is active for the next generation (N151a). The library
-- itself is the already-shipped public.resume_templates table (N64): its
-- unique index on (user_id, kind, lower(name)) already allows many named
-- templates per kind, so no column is added to it. What it never had is a
-- "which one is chosen" home, and that is all this table is.
--
-- The primary key is (user_id, kind), not a generated id: "at most one active
-- template per kind" is structural, and changing the choice is a single
-- upsert on that key rather than a clear-then-set pair of writes.
--
-- `template_id` is nullable and references resume_templates (id) with
-- ON DELETE SET NULL, deliberately not CASCADE or RESTRICT. Deleting the
-- selected template must only null the pointer: the consumption path then
-- resolves "no selection" and falls back to today's behaviour (the N97
-- reserved-name default, else native rendering) instead of failing the
-- delete or silently removing the selection row. Already-generated outputs
-- are frozen bytes read independently of this table, so no past download is
-- ever changed by a selection change.
--
-- `kind` admits 'resume' and 'cover' now, mirroring resume_templates, so the
-- cover-letter extension later needs no migration. 'email' is excluded for the
-- same reason resume_templates excludes it.
--
-- This is a NEW table that this repo's migration history is the sole author
-- of (no drift risk), so `create table if not exists` plus drop-and-create
-- policies is the correct idempotent idiom, exactly as in
-- 20261008000000_application_project_pool.sql. It needs resume_templates to
-- exist first, which holds whenever 20260930000000_n64_saved_templates.sql
-- has applied (stamp order).
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory. Once
-- applied, this file must not be edited in place: `db push` keys on the
-- version stamp, so an edited applied file is skipped and the committed text
-- would describe a database that does not exist.

create table if not exists public.template_selections (
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('resume', 'cover')),
  template_id uuid references public.resume_templates (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind)
);

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring 20260930000000_n64_saved_templates.sql.
-- ---------------------------------------------------------------------------
alter table public.template_selections enable row level security;

drop policy if exists "template_selections_select_own" on public.template_selections;
create policy "template_selections_select_own" on public.template_selections
  for select using (auth.uid() = user_id);

drop policy if exists "template_selections_insert_own" on public.template_selections;
create policy "template_selections_insert_own" on public.template_selections
  for insert with check (auth.uid() = user_id);

drop policy if exists "template_selections_update_own" on public.template_selections;
create policy "template_selections_update_own" on public.template_selections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "template_selections_delete_own" on public.template_selections;
create policy "template_selections_delete_own" on public.template_selections
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.template_selections to authenticated;
grant all on table public.template_selections to service_role;
