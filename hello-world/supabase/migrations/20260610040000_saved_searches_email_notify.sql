-- Email-on-new-jobs: opt-in flag + optional override address per saved search.
-- Applied automatically by the Supabase CLI (`supabase db push`) from CI.
--
-- When `email_on_new_jobs` is true, the auto-tailor cron emails the user a
-- summary of newly-matched postings it just queued. `notify_email` overrides
-- the destination; when null, the cron falls back to the account email.

alter table public.saved_searches
  add column if not exists email_on_new_jobs boolean not null default false;
alter table public.saved_searches
  add column if not exists notify_email text;
