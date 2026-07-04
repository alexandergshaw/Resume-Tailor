-- Tailor edit rules: per-user persistent "template" edits. When the same hand-edit
-- recurs across enough sessions, the client promotes it here so it becomes part of
-- the user's template — applied server-side on every future generation (resume AND
-- cover letter), durable and cross-device, rather than only replayed from the
-- device-local localStorage overlay. A rule is a case-sensitive { before -> after }
-- text replacement (after '' = a deletion), matching applyTextEdits in docxModel.
--
-- Applied automatically by the Supabase CLI (`supabase db push`) from CI. RLS scopes
-- every row to its owner (auth.uid() = user_id); grants are still required for the
-- API roles. loadLibrary reads these rows into the assembled library (tolerant of the
-- table not existing yet), so an unapplied migration just means "no persisted edits".

create table if not exists public.tailor_edit_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  "before"    text not null,
  "after"     text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tailor_edit_rules_user_idx on public.tailor_edit_rules (user_id);
-- Case-sensitive uniqueness (edit rules match text exactly), so upsert-on-conflict
-- keeps promotion idempotent and one before->after pair is stored once per user.
create unique index if not exists tailor_edit_rules_user_rule_uniq
  on public.tailor_edit_rules (user_id, "before", "after");

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring the other tailor_* tables.
-- ---------------------------------------------------------------------------
alter table public.tailor_edit_rules enable row level security;

drop policy if exists "tailor_edit_rules_select_own" on public.tailor_edit_rules;
create policy "tailor_edit_rules_select_own" on public.tailor_edit_rules
  for select using (auth.uid() = user_id);

drop policy if exists "tailor_edit_rules_insert_own" on public.tailor_edit_rules;
create policy "tailor_edit_rules_insert_own" on public.tailor_edit_rules
  for insert with check (auth.uid() = user_id);

drop policy if exists "tailor_edit_rules_update_own" on public.tailor_edit_rules;
create policy "tailor_edit_rules_update_own" on public.tailor_edit_rules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tailor_edit_rules_delete_own" on public.tailor_edit_rules;
create policy "tailor_edit_rules_delete_own" on public.tailor_edit_rules
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.tailor_edit_rules to authenticated;
grant all on table public.tailor_edit_rules to service_role;
