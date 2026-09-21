-- Revokes EXECUTE from anon on:
--   public.claim_prep_pack_slot(uuid, uuid, timestamptz)
--   public.record_prep_model_call(uuid)
--
-- Why: migration 20260915000000_interview_prep_spend_lockdown.sql, as first
-- pushed (commit 3d9bb27), did not contain these two revokes. They were
-- added to that file afterwards, and an already-applied migration is never
-- re-run. So the revokes never took effect, and this file issues them.
--
-- Effect: where anon holds an explicit EXECUTE grant on either function,
-- this removes it; where it holds none, the statement is a no-op.
--
-- Rollback (a new migration, never an edit to this one):
--   grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to anon;
--   grant execute on function public.record_prep_model_call(uuid) to anon;
--
-- Full history: backlog item N30.

revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from anon;
revoke execute on function public.record_prep_model_call(uuid) from anon;
