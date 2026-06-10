-- Fix: "permission denied for table positions".
--
-- The `positions` table predates these migrations and never received explicit
-- privileges for the Supabase API roles. The auto-apply pipeline writes to it
-- via the service_role (cron + manual "Auto-apply"), and the app reads/writes
-- it with the logged-in user's client. Grant the standard roles access; RLS
-- (if enabled) still constrains rows, and service_role bypasses RLS.

grant select, insert, update on table public.positions to authenticated;
grant all on table public.positions to service_role;

-- Cover the application/resume/cover-letter tables too, in case any predate the
-- grant conventions used above.
grant select, insert, update, delete on table public.applications to authenticated;
grant all on table public.applications to service_role;
