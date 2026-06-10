-- Email-on-new-jobs dedup ledger.
-- Applied automatically by the Supabase CLI (`supabase db push`) from CI.
--
-- The "email me new jobs" feature is decoupled from auto-tailor: a saved search
-- can email a user about newly-fetched matching postings without tailoring or
-- queueing anything. Because no application row is created for those alerts, we
-- need a dedicated ledger so the cron never emails the same posting to the same
-- user twice. One row per (user, external posting id) we've already alerted on.

create table if not exists public.email_notified_postings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  external_id  text not null,                 -- posting source id (postingExternalId)
  created_at   timestamptz not null default now(),
  unique (user_id, external_id)
);

create index if not exists email_notified_postings_user_idx
  on public.email_notified_postings (user_id);

alter table public.email_notified_postings enable row level security;

-- Users may read their own ledger; only the service-role cron writes.
drop policy if exists "email_notified_postings_select_own" on public.email_notified_postings;
create policy "email_notified_postings_select_own"
  on public.email_notified_postings for select
  using (auth.uid() = user_id);
