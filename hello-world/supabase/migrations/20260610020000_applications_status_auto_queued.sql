-- ---------------------------------------------------------------------------
-- Allow the "auto_queued" application status.
--
-- The auto-apply pipeline parks tailored postings at status "auto_queued" so
-- the Live Feed's queue view can surface them for one-by-one apply. The
-- existing applications_status_check constraint predates that status and
-- rejects it, raising:
--   new row for relation "applications" violates check constraint
--   "applications_status_check"
--
-- Recreate the constraint with the full set of statuses the app uses today.
-- ---------------------------------------------------------------------------
alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (
    status in (
      'tracking',
      'tailored',
      'auto_tailored',
      'auto_queued',
      'applied',
      'phone_screen',
      'interviewing',
      'offer',
      'accepted',
      'rejected',
      'withdrawn'
    )
  );
