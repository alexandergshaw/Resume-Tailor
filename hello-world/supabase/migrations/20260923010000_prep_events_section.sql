-- N45/N46 step S8, AC-LOG.1/LOG.2 -- interview_prep_events gains `section`.
-- NEW FILE ONLY -- neither claim_prep_pack_slot nor record_prep_model_call
-- is `create or replace`d here. Filename deliberately does NOT end
-- `_interview_prep.sql` (lib/interviewPrep/interviewPrepMigrationShape.test.js's
-- glob would otherwise pick it up alongside the original), and names
-- `interview_prep_spend` nowhere (lib/interviewPrep/interviewPrepEffectiveSchema.test.js
-- pins that mention count at exactly three files).
--
-- 20260923000000_prep_section_revisions.sql added the revisions table and
-- interview_prep_packs.live_revisions, but named interview_prep_events zero
-- times (verified by direct read) -- a section-scoped attempt's own event
-- row (lib/interviewPrep/prepStore.js's recordPrepEvent) had nowhere to
-- record WHICH section the attempt was for, so a candidate's downloaded prep
-- log could not distinguish "askThem's regeneration failed" from "the whole
-- pack did".
--
-- Same vocabulary as interview_prep_packs_section_revisions_section_check
-- and PREP_SECTION_NAMES (lib/interviewPrep/prepContract.js) -- the four
-- section names, never a fifth value. Null for a whole-pack attempt and
-- every delete event, exactly like trigger_class/engine on this same table.

alter table public.interview_prep_events
  add column if not exists section text;

alter table public.interview_prep_events
  drop constraint if exists interview_prep_events_section_check;
alter table public.interview_prep_events
  add constraint interview_prep_events_section_check
  check (section is null or section in ('aboutYou', 'whyRole', 'askThem', 'stages'));

-- No grant change needed: authenticated already holds select+insert on this
-- table (20260914000000_interview_prep.sql), unrestricted by column, and no
-- update/delete grant exists for any column on it -- this one included.
