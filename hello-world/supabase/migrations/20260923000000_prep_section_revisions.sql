-- Per-section revision history for interview-prep packs (N45/N46). NEW FILE
-- ONLY -- neither claim_prep_pack_slot nor record_prep_model_call is
-- `create or replace`d here; both are unchanged (see
-- 20260914000000_interview_prep.sql / 20260922000000_interview_prep_remove_spend_caps.sql
-- for those). Filename deliberately does NOT end `_interview_prep.sql`
-- (lib/interviewPrep/interviewPrepMigrationShape.test.js:161-163's glob
-- would otherwise pick this file up alongside the original), and names
-- `interview_prep_spend` nowhere (lib/interviewPrep/interviewPrepEffectiveSchema.test.js:119-123
-- pins that mention count at exactly three files).
--
-- ===========================================================================
-- WHY A NEW TABLE, NOT A COLUMN ON interview_prep_packs
-- ===========================================================================
-- interview_prep_packs.pack holds the LIVE, merged document -- one row, one
-- document, overwritten on every terminal write. Per-section regeneration
-- and per-section version history need the OPPOSITE property: the ability
-- to replace ONE section's content without losing the other three, and to
-- list/restore an OLDER version of a section. An append-only table, one row
-- per (application, section, revision), is what makes both properties hold
-- without ever mutating a historical row -- this table carries NO update
-- grant and NO `for update` policy, so "immutable once written" is enforced
-- by the database, not by convention.
--
-- interview_prep_packs.live_revisions (added below) is the pointer from the
-- live document into this table -- `{section: revision}`. It is what makes
-- the N47 restore-on-failure fix possible at all: claim_prep_pack_slot
-- (unchanged by this file) blanks `pack` unconditionally on every re-claim,
-- but it does NOT touch `live_revisions`, so the prior document can be
-- rebuilt from this table even after a claim has already wiped the column
-- that used to be the only copy of it.
--
-- ===========================================================================
-- WHAT THIS SCHEMA DELIBERATELY LEAVES OPEN FOR N49 (queued next)
-- ===========================================================================
-- `content` and `claims` carry NO internal-shape CHECK beyond
-- jsonb_typeof(...) = 'object' / 'array'. N49 splits a Stage's single
-- `support` into per-question provenance -- an internal-shape CHECK here
-- would have to be dropped and replaced the day that shape changes, exactly
-- the trap interview_prep_packs_ready_is_complete already illustrates for
-- the packs table itself. `content_version` records the pack SCHEMA version
-- (pack.version) a row's content was generated under -- a migrate-on-read
-- discriminator for N49, never a revision counter (backlog N46 warns
-- explicitly against overloading it with `revision`, which is the actual
-- counter). No cardinality cap on `claims` either: N49 needs one claim per
-- verified question, and PREP_SECTION_REVISION_MAX_BYTES
-- (lib/interviewPrep/prepConstants.js) is a BYTE bound enforced in JS, not a
-- count bound baked into this DDL.
--
-- ===========================================================================
-- NO byte-size CHECK -- same reasoning as interview_prep_packs.pack
-- ===========================================================================
-- `pg_column_size` is not IMMUTABLE, so a CHECK built on it is a
-- dump/restore hazard (see interview_prep_packs_claims_is_array's own "NOT
-- ADDED, deliberately" note in 20260914000000_interview_prep.sql). The bound
-- is PREP_SECTION_REVISION_MAX_BYTES, enforced in JS by
-- lib/interviewPrep/prepStore.js's appendSectionRevisions, before any
-- statement runs.

create table if not exists public.interview_prep_section_revisions (
  application_id   uuid not null references public.applications (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  section          text not null,
  revision         integer not null,

  -- The section's own body at the exact nesting
  -- interview_prep_packs_ready_is_complete reads (aboutYou/whyRole:
  -- {answer:{lines:[...]}}; askThem: {questions:[...]}; stages:
  -- {stages:[...]}) -- never wrapped in a `sections` envelope.
  content          jsonb not null,

  -- The claims THIS revision was generated with, ids included -- always an
  -- array, even when empty.
  claims           jsonb not null default '[]'::jsonb,

  -- The provenance H1 (lib/interviewPrep/prepMerge.js's buildPackDocument)
  -- reads to decide whether a merged document may carry `templateOrigin`.
  engine           text not null,

  content_version  integer not null default 1,

  -- Non-null exactly when this row was created by a restore (AC-UX.1);
  -- always strictly less than this row's own revision, since restore
  -- appends and never rewinds.
  restored_from    integer,

  created_at       timestamptz not null default now(),

  constraint interview_prep_section_revisions_pkey
    primary key (application_id, section, revision),

  constraint interview_prep_section_revisions_section_check
    check (section in ('aboutYou', 'whyRole', 'askThem', 'stages')),

  constraint interview_prep_section_revisions_revision_check
    check (revision >= 1),

  constraint interview_prep_section_revisions_content_shape_check
    check (jsonb_typeof(content) = 'object'),

  constraint interview_prep_section_revisions_claims_shape_check
    check (jsonb_typeof(claims) = 'array'),

  constraint interview_prep_section_revisions_engine_check
    check (engine in ('gemini', 'external', 'embedded')),

  constraint interview_prep_section_revisions_content_version_check
    check (content_version >= 1),

  constraint interview_prep_section_revisions_restored_from_check
    check (restored_from is null or restored_from < revision)
);

create index if not exists interview_prep_section_revisions_user_id_idx
  on public.interview_prep_section_revisions (user_id);

alter table public.interview_prep_section_revisions enable row level security;

drop policy if exists "interview_prep_section_revisions_select_own" on public.interview_prep_section_revisions;
create policy "interview_prep_section_revisions_select_own" on public.interview_prep_section_revisions
  for select using (auth.uid() = user_id);

drop policy if exists "interview_prep_section_revisions_insert_own" on public.interview_prep_section_revisions;
create policy "interview_prep_section_revisions_insert_own" on public.interview_prep_section_revisions
  for insert with check (auth.uid() = user_id);

drop policy if exists "interview_prep_section_revisions_delete_own" on public.interview_prep_section_revisions;
create policy "interview_prep_section_revisions_delete_own" on public.interview_prep_section_revisions
  for delete using (auth.uid() = user_id);

-- Deliberately NO update policy, under any name (AC-GRANT.1). Immutability
-- once written is the whole point of this table -- a restore APPENDS a new
-- row rather than editing an old one.
grant select, insert, delete on table public.interview_prep_section_revisions to authenticated;
grant all on table public.interview_prep_section_revisions to service_role;
-- No grant to anon, matching every other table in this feature.

-- ===========================================================================
-- interview_prep_packs.live_revisions -- the pointer restore is possible
-- because claim_prep_pack_slot (unchanged) does not touch it.
-- ===========================================================================
alter table public.interview_prep_packs
  add column if not exists live_revisions jsonb not null default '{}'::jsonb;

alter table public.interview_prep_packs
  drop constraint if exists interview_prep_packs_live_revisions_shape_check;
alter table public.interview_prep_packs
  add constraint interview_prep_packs_live_revisions_shape_check
  check (jsonb_typeof(live_revisions) = 'object');

-- No grant change needed on interview_prep_packs: authenticated already
-- holds an unrestricted (not column-scoped) select/insert/update/delete
-- grant on this table, so the new column is covered by it automatically --
-- unlike interview_prep_spend, which narrows privilege column by column.
