-- Live Feed schema: continuously ingested job postings + per-user feed state.
-- Applied automatically by the Supabase CLI (`supabase db push`) from CI.

-- ---------------------------------------------------------------------------
-- feed_postings: normalized postings populated by the Vercel Cron ingest job.
-- Read by /api/feed. Writes happen only from the service-role cron/refresh path.
-- ---------------------------------------------------------------------------
create table if not exists public.feed_postings (
  id                  uuid primary key default gen_random_uuid(),
  dedup_key           text not null unique,            -- e.g. "greenhouse:gh-12345"
  source              text not null,                   -- e.g. "greenhouse"
  source_posting_id   text,                            -- upstream id
  title               text,
  company             text,
  location            text,
  remote_type         text,                            -- remote | hybrid | onsite | unknown
  employment_type     text,
  salary_min          integer,
  salary_max          integer,
  description_snippet text,
  url                 text,
  tags                text[] default '{}',
  posted_at           timestamptz,
  raw_data            jsonb,
  ingested_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists feed_postings_posted_at_idx
  on public.feed_postings (posted_at desc);
create index if not exists feed_postings_source_idx
  on public.feed_postings (source);
create index if not exists feed_postings_company_idx
  on public.feed_postings (company);

-- Anyone (including anonymous) may read the feed; only the service role writes.
alter table public.feed_postings enable row level security;

drop policy if exists "feed_postings_read_all" on public.feed_postings;
create policy "feed_postings_read_all"
  on public.feed_postings for select
  using (true);

-- ---------------------------------------------------------------------------
-- feed_user_state: per-user saved/hidden flags for postings.
-- ---------------------------------------------------------------------------
create table if not exists public.feed_user_state (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  posting_id  uuid not null references public.feed_postings (id) on delete cascade,
  saved       boolean not null default false,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, posting_id)
);

create index if not exists feed_user_state_user_idx
  on public.feed_user_state (user_id);

alter table public.feed_user_state enable row level security;

drop policy if exists "feed_user_state_select_own" on public.feed_user_state;
create policy "feed_user_state_select_own"
  on public.feed_user_state for select
  using (auth.uid() = user_id);

drop policy if exists "feed_user_state_insert_own" on public.feed_user_state;
create policy "feed_user_state_insert_own"
  on public.feed_user_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "feed_user_state_update_own" on public.feed_user_state;
create policy "feed_user_state_update_own"
  on public.feed_user_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "feed_user_state_delete_own" on public.feed_user_state;
create policy "feed_user_state_delete_own"
  on public.feed_user_state for delete
  using (auth.uid() = user_id);
