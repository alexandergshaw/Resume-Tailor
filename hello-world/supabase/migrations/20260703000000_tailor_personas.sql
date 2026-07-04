-- Tailor personas: per-user named identities that reframe tailored resume/cover
-- letters without changing the base profile. A user can select a persona per
-- posting to override profile values, teaching subjects, focus area, and cover
-- letter variant. Personas enable use cases like "Finance Educator" vs. default
-- industry focus.
--
-- A persona: { name, values: { KEY: string, ... }, default_teaching_subjects,
-- focus_area, cover_variant: "" | "teaching" | "staff" | "industry" | "nontechnical" }.

create table if not exists public.tailor_personas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  values      jsonb not null default '{}'::jsonb,
  default_teaching_subjects jsonb not null default '[]'::jsonb,
  focus_area  text not null default '',
  cover_variant text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tailor_personas_user_idx on public.tailor_personas (user_id);
-- Personas are named by the user and selected per-posting, so the same persona
-- can't exist twice per user (case-insensitive to prevent confusing dupes).
create unique index if not exists tailor_personas_user_name_uniq
  on public.tailor_personas (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring the other tailor_* tables.
-- ---------------------------------------------------------------------------
alter table public.tailor_personas enable row level security;

drop policy if exists "tailor_personas_select_own" on public.tailor_personas;
create policy "tailor_personas_select_own" on public.tailor_personas
  for select using (auth.uid() = user_id);

drop policy if exists "tailor_personas_insert_own" on public.tailor_personas;
create policy "tailor_personas_insert_own" on public.tailor_personas
  for insert with check (auth.uid() = user_id);

drop policy if exists "tailor_personas_update_own" on public.tailor_personas;
create policy "tailor_personas_update_own" on public.tailor_personas
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tailor_personas_delete_own" on public.tailor_personas;
create policy "tailor_personas_delete_own" on public.tailor_personas
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.tailor_personas to authenticated;
grant all on table public.tailor_personas to service_role;
