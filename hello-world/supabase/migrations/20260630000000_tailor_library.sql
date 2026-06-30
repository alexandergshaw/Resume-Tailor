-- Tailor library: per-user storage for the deterministic engine's editable data
-- (buzzword taxonomy, focus areas, skill groups, content-library fragments, and
-- profile values). Today these live as bundled JSON under
-- lib/llm/engines/tailor-lite/data/*; moving them here lets the user manage them
-- via UI. The bundled JSON remains the seed (per-user, on first use) and the
-- offline fallback, so tailoring never breaks. Stopwords stay bundled (not editable).
--
-- Applied automatically by the Supabase CLI (`supabase db push`) from CI.
-- RLS scopes every row to its owner (auth.uid() = user_id), mirroring the rest of
-- the schema; grants are still required for the API roles.

-- ---------------------------------------------------------------------------
-- tailor_taxonomy: one row per buzzword/canonical (canonical + category + aliases).
-- ---------------------------------------------------------------------------
create table if not exists public.tailor_taxonomy (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  canonical       text not null,
  category        text not null,
  aliases         text[] not null default '{}',
  match_canonical boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tailor_taxonomy_user_idx on public.tailor_taxonomy (user_id);
create unique index if not exists tailor_taxonomy_user_canonical_uniq
  on public.tailor_taxonomy (user_id, lower(canonical));

-- ---------------------------------------------------------------------------
-- tailor_focus_areas: one row per focus area (match + the four capability lists).
-- ---------------------------------------------------------------------------
create table if not exists public.tailor_focus_areas (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  name                   text not null,
  match                  text[] not null default '{}',
  subjects               text[] not null default '{}',
  job_emphases           text[] not null default '{}',
  technical_capabilities text[] not null default '{}',
  domain_capabilities    text[] not null default '{}',
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists tailor_focus_areas_user_idx on public.tailor_focus_areas (user_id);

-- ---------------------------------------------------------------------------
-- tailor_skill_groups: one row per skill group (heading + keywords + conditional).
-- ---------------------------------------------------------------------------
create table if not exists public.tailor_skill_groups (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  heading      text not null,
  categories   text[] not null default '{}',
  keywords     text[] not null default '{}',
  conditional  boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tailor_skill_groups_user_idx on public.tailor_skill_groups (user_id);

-- ---------------------------------------------------------------------------
-- tailor_content_library: one row per accomplishment/bullet fragment.
-- ---------------------------------------------------------------------------
create table if not exists public.tailor_content_library (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  frag_id     text not null,
  slots       text[] not null default '{}',
  text        text not null,
  tags        text[] not null default '{}',
  fabricated  boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tailor_content_library_user_idx on public.tailor_content_library (user_id);
create unique index if not exists tailor_content_library_user_frag_uniq
  on public.tailor_content_library (user_id, frag_id);

-- ---------------------------------------------------------------------------
-- tailor_profile: one row per user — the placeholder value map + teaching
-- subjects, plus library_version (the cache-busting token bumped on any write).
-- ---------------------------------------------------------------------------
create table if not exists public.tailor_profile (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  values                   jsonb not null default '{}'::jsonb,
  default_teaching_subjects jsonb not null default '[]'::jsonb,
  library_version          integer not null default 1,
  updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS + grants: every table is owner-scoped; grants for the API roles.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'tailor_taxonomy', 'tailor_focus_areas', 'tailor_skill_groups',
    'tailor_content_library', 'tailor_profile'
  ] loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists "%s_select_own" on public.%I;', t, t);
    execute format($p$create policy "%s_select_own" on public.%I for select using (auth.uid() = user_id);$p$, t, t);

    execute format('drop policy if exists "%s_insert_own" on public.%I;', t, t);
    execute format($p$create policy "%s_insert_own" on public.%I for insert with check (auth.uid() = user_id);$p$, t, t);

    execute format('drop policy if exists "%s_update_own" on public.%I;', t, t);
    execute format($p$create policy "%s_update_own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);$p$, t, t);

    execute format('drop policy if exists "%s_delete_own" on public.%I;', t, t);
    execute format($p$create policy "%s_delete_own" on public.%I for delete using (auth.uid() = user_id);$p$, t, t);

    execute format('grant select, insert, update, delete on table public.%I to authenticated;', t);
    execute format('grant all on table public.%I to service_role;', t);
  end loop;
end $$;
