-- Live Feed retention: bound the size of feed_postings.
--
-- The ingest cron upserts postings forever but never deleted stale ones, so the
-- table grew without bound. This adds a prune function the ingest run calls at
-- the end of each cycle to delete postings older than a retention window,
-- measured over coalesce(posted_at, ingested_at) (a filter PostgREST can't
-- express directly, hence a SQL function). The window is expressed in hours so
-- sub-day retention (e.g. 36h = 1.5 days) is possible.

-- Supports the prune predicate and the existing newest-first reads.
create index if not exists feed_postings_ingested_at_idx
  on public.feed_postings (ingested_at);

create or replace function public.prune_feed_postings(retention_hours integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.feed_postings
  where coalesce(posted_at, ingested_at)
        < now() - make_interval(hours => greatest(retention_hours, 1));
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Only the service role (cron / ingest path) may prune. Revoke from the API
-- roles so it can never be invoked from a browser-facing client.
revoke all on function public.prune_feed_postings(integer) from public;
revoke all on function public.prune_feed_postings(integer) from anon, authenticated;
grant execute on function public.prune_feed_postings(integer) to service_role;
