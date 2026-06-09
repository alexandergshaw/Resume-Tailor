-- Live Feed: persist the minimum years of experience parsed from each posting
-- so the feed can filter by an experience cap server-side (the feed only stores
-- a truncated description_snippet, so this is computed at ingest time).
alter table public.feed_postings
  add column if not exists min_years_required integer;

create index if not exists feed_postings_min_years_idx
  on public.feed_postings (min_years_required);
