-- Fix: "permission denied for table feed_postings".
--
-- RLS policies filter rows but do NOT grant table access. Tables created via
-- SQL/migrations don't automatically receive privileges for the API roles, so
-- any non–service-role query (e.g. /api/feed/apply reading feed_postings with
-- the logged-in user's client) is rejected before RLS is evaluated.
--
-- Grant the standard Supabase API roles the privileges their RLS policies
-- already constrain. The service_role bypasses RLS and keeps full access.

-- feed_postings: public read (RLS policy already limits to SELECT for everyone).
grant select on table public.feed_postings to anon, authenticated;

-- feed_user_state: per-user CRUD (RLS policies already scope rows to the owner).
grant select, insert, update, delete on table public.feed_user_state to authenticated;

-- Ensure the service role retains full access for cron ingestion / writes.
grant all on table public.feed_postings to service_role;
grant all on table public.feed_user_state to service_role;
