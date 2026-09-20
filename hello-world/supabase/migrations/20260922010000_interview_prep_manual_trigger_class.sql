-- N29: the manual "prepare me for this interview" control needs its own
-- trigger_class value so a candidate-initiated attempt is distinguishable,
-- in interview_prep_events, from an automatic B1 (post-tailor) or B3
-- (mark-applied) one -- the "Download prep log" control's own source
-- (AC-N33.21). "B2" is unused anywhere in the tree today.
--
-- Sorts after 20260922000000_interview_prep_remove_spend_caps.sql (same-day
-- multi-migration ordering, matching this repo's own
-- 20260908000000_positions_policy_hardening.sql /
-- 20260908010000_position_glossaries.sql precedent) but has no ordering
-- DEPENDENCY on it -- this file touches interview_prep_events only, never
-- interview_prep_spend or claim_prep_pack_slot.
--
-- 20260914000000_interview_prep.sql is already applied to the live project
-- -- editing it in place is exactly the hazard [[schema-migration-drift]]/
-- backlog N30 tracks, so this widens the CHECK with the drop+add idiom this
-- repo already uses for exactly this shape of change
-- (20260610020000_applications_status_auto_queued.sql).
--
-- This is only HALF the fix. `app/api/interview-prep/route.js`'s own
-- `triggerClassOf` independently collapses any value that is not exactly
-- "B3" to "B1", before it ever reaches this CHECK -- widening the CHECK
-- alone would silently mislabel every manual-trigger event as "B1" with no
-- error anywhere. That function is widened to the matching 3-member
-- allowlist in the same change that adds this migration.
alter table public.interview_prep_events
  drop constraint if exists interview_prep_events_trigger_class_check;
alter table public.interview_prep_events
  add constraint interview_prep_events_trigger_class_check
  check (trigger_class is null or trigger_class in ('B1', 'B2', 'B3'));
