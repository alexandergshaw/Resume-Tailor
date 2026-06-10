-- Notification bubbles: track when the user last viewed each saved search so
-- we can count postings ingested since then. Applied automatically by the
-- Supabase CLI (`supabase db push`) from CI.
--
-- `last_viewed_at` is bumped to now() whenever the user applies (opens) a
-- saved search. The unviewed-counts endpoint counts feed_postings newer than
-- this timestamp that match the saved search's criteria. A null value means
-- the search has never been opened, so every matching posting counts as new.

alter table public.saved_searches
  add column if not exists last_viewed_at timestamptz;
