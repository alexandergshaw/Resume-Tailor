-- ---------------------------------------------------------------------------
-- Track when an auto-apply queue item was "opened" (resume/cover downloaded and
-- the posting opened) without ejecting it from the queue.
--
-- Queued postings (status "auto_queued") now stay in the queue until the user
-- manually changes their status in the Tracking / Edit UI. The Apply button in
-- the queue records auto_apply_opened_at instead of flipping the status, so the
-- row remains visible (just marked as already opened).
-- ---------------------------------------------------------------------------
alter table public.applications
  add column if not exists auto_apply_opened_at timestamptz;
