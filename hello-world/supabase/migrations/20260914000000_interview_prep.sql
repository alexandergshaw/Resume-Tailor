-- Interview prep (IP3): three new tables backing the candidate-facing
-- "prepare for this interview" feature -- a generated pack of answer
-- material (interview_prep_packs), a per-application spend ledger
-- (interview_prep_spend), and an append-only audit trail
-- (interview_prep_events). Binding source: 1-0-contract.r8.md (final,
-- R-IP3-60) + design-structure.r1.md (the merged 1b+1d architecture,
-- R-IP3-51) + rulings.md R-IP3-16 through R-IP3-65.
--
-- ===========================================================================
-- WHY THREE TABLES, NOT ONE
-- ===========================================================================
-- interview_prep_packs holds the generated content and its lifecycle status.
-- interview_prep_spend holds two integer counters ONLY -- no free text, no
-- PII, no posting or interviewer content -- so O-16's real DELETE on the
-- packs table (see below) can erase a candidate's stored content without
-- also erasing the spend bound that stops them re-spending immediately
-- after. Before this split, that required a tombstone (a row kept forever,
-- content cleared field-by-field); after it, deleting the packs row removes
-- every column it ever had, and the spend row is simply never one of them,
-- because it never lived there (design-structure.r1.md S2.1).
-- interview_prep_events is an append-only diagnostic log, one row per
-- attempt or delete, FK'd to applications DIRECTLY -- never to
-- interview_prep_packs -- so a packs-row delete can never cascade the log
-- of what happened away with it.
--
-- ===========================================================================
-- THE CLAIM RPC IS THE ONLY WRITER OF A FIRST interview_prep_packs ROW
-- ===========================================================================
-- claim_prep_pack_slot(p_application_id, p_lease_token, p_lease_until) is a
-- SECURITY INVOKER function -- deliberately not DEFINER -- and takes NO
-- p_user_id parameter: every statement inside it uses auth.uid() directly,
-- so there is no client-suppliable value that could ever diverge from the
-- caller's own identity (closes check-structure.r2.md's S2-M2;
-- design-structure.r1.md ss4.1). BOTH spend caps (attempts >= 6,
-- model_calls >= 12) are checked, together, before ANY write -- including
-- on the path where no packs row and no spend row exist yet, where a
-- missing check would be a spend-bypass reachable simply by deleting a
-- pack and re-triggering (R-IP3-45). Neither cap is enforced by a CHECK on
-- the counter column itself: a CHECK forbidding model_calls > 12 would
-- reject the very write that records the 12th, cap-hitting call, so the
-- gate lives here, in the claim path, before any row is touched.
--
-- The claim verdict is read from GET DIAGNOSTICS ... ROW_COUNT on the
-- claiming INSERT ... ON CONFLICT itself, never from a follow-up read of
-- the row's current token -- a same-token retry after a successful claim
-- finds the ON CONFLICT ... WHERE predicate false on both disjuncts, so
-- ROW_COUNT is 0 and the function returns false WITHOUT ever reaching the
-- ledger INSERT, which is what stops a retried request from double-
-- debiting attempts (closes S2-M3; design-structure.r1.md ss4.1).
--
-- An explicit `grant execute ... to authenticated` follows the function.
-- Postgres grants EXECUTE on a new function to PUBLIC by default, so this
-- may be redundant on this specific project -- but Supabase's own docs
-- describe moving toward revoking that default, this checkout cannot see
-- the live project's actual privilege configuration
-- ([[schema-migration-drift]]), and every other grant in every migration in
-- this directory is already explicit. This repo's own convention governs:
-- state it, never rely on an unverifiable default (3b.r1.md Item 1;
-- 1-0-contract.r8.md ss15).
--
-- ===========================================================================
-- interview_prep_events: WHY THE FK TARGETS applications, NOT THE PACKS ROW
-- ===========================================================================
-- If this table's FK targeted interview_prep_packs, deleting a pack (O-16's
-- candidate-facing delete control) would cascade its own audit trail away
-- with it -- the log would prove nothing about a deletion it no longer
-- contains a record of. Targeting applications instead means the log
-- outlives the pack it describes, for exactly as long as the application
-- itself exists. Its RLS grants select + insert only, to authenticated --
-- there is NO update policy and NO delete policy, and no update/delete
-- grant either, so "an event row is never modified or removed by any
-- candidate-facing action" is enforced by the database, not by convention
-- (design-structure.r1.md Table 3; ss1.5 of the contract's carried text).
--
-- ===========================================================================
-- interview_prep_events_trigger_class_check / _engine_check: SIMPLER THAN
-- AN EARLIER CONTRACT ROUND'S SQL SAMPLE, ON PURPOSE
-- ===========================================================================
-- 1-0-contract.r6.md's own DDL sample guarded both CHECKs with the event's
-- own type ("(event_type = 'attempt' and trigger_class in (...)) or
-- (event_type = 'delete' and trigger_class is null)"), so that a 'delete'
-- event could only ever carry a null trigger_class/engine. The landed
-- lib/interviewPrep/interviewPrepMigrationShape.test.js -- this seat's own
-- specification for this file -- asserts the OPPOSITE shape: it reads each
-- CHECK's quoted literals with an exact-set comparison ('B1'/'B3' only;
-- 'gemini'/'external'/'embedded' only), which an event_type-guarded clause
-- cannot satisfy, because guarding on event_type embeds the literals
-- 'attempt'/'delete' inside these two constraints' own text too. Written
-- here as the simpler, ungarded form the test requires: each column is
-- bounded to its vocabulary whenever non-null, and "non-null only for an
-- attempt event, null for a delete event" is upheld by recordPrepEvent,
-- this table's sole writer (two call sites), as application-code
-- discipline rather than a database CHECK -- worth the reviewer's own look,
-- since it is a real (if narrow) weakening against r6's original text.
--
-- ===========================================================================
-- NO updated_at TRIGGER -- THIS REPO HAS NONE, ANYWHERE
-- ===========================================================================
-- Grepped repo-wide: zero trigger-function hits under supabase/migrations
-- for updated_at/set_updated_at/moddatetime/handle_updated_at. The
-- convention here is application-stamped -- every writer sets updated_at
-- explicitly in its own SET list, matching every other table in this
-- directory. This migration does not introduce a trigger.
--
-- ===========================================================================
-- WHAT THIS CHECKOUT CANNOT VERIFY
-- ===========================================================================
-- No live Supabase project is reachable from this checkout in the ordinary
-- sense -- NEXT_PUBLIC_SUPABASE_URL is a placeholder here
-- ([[schema-migration-drift]], [[windows-shell-environment]]) -- so none of
-- the CHECK constraints, RLS policies, indexes, the GRANT, or
-- claim_prep_pack_slot's own body have been executed against a real
-- Postgres instance from this seat. This file is written to be applied by
-- .github/workflows/supabase-migrations.yml on merge to main, which DOES
-- run it against the real, linked project -- everything above is therefore
-- a careful specification, not a confirmed-by-execution fact, and the
-- lib/interviewPrep/interviewPrepMigrationShape.test.js suite that drove
-- this file's shape can only prove the DECLARED SQL text is internally
-- consistent with the binding design documents, never that Postgres
-- actually enforces any of it.
--
-- Every statement below is written to be safely re-runnable: create table
-- if not exists, create index if not exists, drop policy if exists before
-- create policy, create or replace function. There is deliberately no
-- explicit begin/commit, matching every other migration in this directory.

-- ===========================================================================
-- public.interview_prep_packs
-- ===========================================================================

create table if not exists public.interview_prep_packs (
  application_id         uuid primary key references public.applications (id) on delete cascade,
  user_id                 uuid not null references auth.users (id) on delete cascade,

  -- No default, deliberately: an insert that omits status must error rather
  -- than silently landing in some default state. claim_prep_pack_slot is
  -- the only statement that ever creates a row, and it always supplies
  -- 'running' explicitly.
  status                  text not null,

  -- CHECK-bounded, shared with interview_prep_events.reason below --
  -- PREP_REASON_VALUES (lib/interviewPrep/prepContract.js) is the one
  -- JS-side source of truth; SQL cannot import a JS constant, so both
  -- CHECKs in this file duplicate the same 8 literal strings.
  reason                  text,

  -- Free text, status = 'failed' only, never rendered to the candidate --
  -- a distinct column and a distinct vocabulary from reason.
  error                   text,

  engine                  text,

  -- { version, sections, claims }. Reset to '{}'::jsonb on every re-claim
  -- by claim_prep_pack_slot below.
  pack                    jsonb not null default '{}'::jsonb,

  resume_id               uuid,
  cover_letter_id         uuid,
  posting_fingerprint     text not null default '',
  digest_researched_at    timestamptz,

  -- Claim predicate: a row is claimable when lease_until is null or in the
  -- past. Rotated on every successful claim.
  lease_until             timestamptz,
  lease_token             uuid,

  -- Success-only stamp; reset to null on every re-claim.
  researched_at           timestamptz,

  -- null | 'bytes'.
  truncated_reason        text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint interview_prep_packs_status_check
    check (status in ('running', 'ready', 'partial', 'failed', 'unavailable')),

  constraint interview_prep_packs_running_has_no_content
    check (status <> 'running' or pack = '{}'::jsonb),

  -- 'ready' means every one of the four sections is populated, enforced
  -- over the actual nested arrays -- not merely over a counter written by
  -- the same statement, which a JS miscount could satisfy while the
  -- content itself stayed empty. `case` (not a bare `and` chain) guards
  -- evaluation order, matching position_glossaries_terms_shape's own
  -- precedent (20260908010000_position_glossaries.sql): PostgreSQL does
  -- not guarantee left-to-right evaluation inside `and`, so an ungarded
  -- jsonb_array_length could be reached on a non-array and raise a type
  -- error instead of a clean constraint violation. `#>` returns SQL NULL
  -- on a missing intermediate key; jsonb_typeof(null) is NULL, which fails
  -- `= 'array'` and falls into `else false` rather than reaching
  -- jsonb_array_length on a non-array.
  constraint interview_prep_packs_ready_is_complete
    check (
      status <> 'ready' or (
        (pack -> 'sections') ?& array['aboutYou', 'whyRole', 'askThem', 'stages']
        and case when jsonb_typeof(pack #> '{sections,aboutYou,answer,lines}') = 'array'
                  then jsonb_array_length(pack #> '{sections,aboutYou,answer,lines}') > 0
                  else false end
        and case when jsonb_typeof(pack #> '{sections,whyRole,answer,lines}') = 'array'
                  then jsonb_array_length(pack #> '{sections,whyRole,answer,lines}') > 0
                  else false end
        and case when jsonb_typeof(pack #> '{sections,askThem,questions}') = 'array'
                  then jsonb_array_length(pack #> '{sections,askThem,questions}') > 0
                  else false end
        and case when jsonb_typeof(pack #> '{sections,stages,stages}') = 'array'
                  then jsonb_array_length(pack #> '{sections,stages,stages}') > 0
                  else false end
      )
    ),

  constraint interview_prep_packs_researched_at_terminal
    check (researched_at is null or status in ('ready', 'partial')),

  constraint interview_prep_packs_truncated_reason_check
    check (truncated_reason is null or truncated_reason = 'bytes'),

  constraint interview_prep_packs_claims_is_array
    check (status not in ('ready', 'partial') or jsonb_typeof(pack -> 'claims') = 'array'),

  -- NOT ADDED, deliberately: a byte-size CHECK such as
  --   check (pg_column_size(pack) <= 262144)
  -- pg_column_size is not IMMUTABLE, and a CHECK containing a non-immutable
  -- function is a dump/restore hazard -- a sibling migration in this same
  -- directory (20260908010000_position_glossaries.sql) already rejected
  -- this exact pattern on position_glossaries.terms for that reason. The
  -- byte bound (PREP_PACK_MAX_BYTES, lib/interviewPrep/prepConstants.js) is
  -- enforced in lib/interviewPrep/prepStore.js's checkPackByteBudget,
  -- before the write, where it can also report how far over budget the
  -- generated pack was.

  -- 8 members: PREP_REASON_VALUES, including spend-record-failed
  -- (1-0-contract.r8.md ss1.3bis / design-structure.r1.md ss8.5).
  -- writePrepPackResult forces this column to null whenever the terminal
  -- status is 'ready'/'partial', regardless of what its caller passes --
  -- application-code discipline, not something this CHECK can express.
  constraint interview_prep_packs_reason_check
    check (
      reason is null
      or reason in (
        'provider-timeout', 'provider-error', 'refused-posting',
        'check-violation', 'stale-claim', 'not-found', 'unknown',
        'spend-record-failed'
      )
    )
);

create index if not exists interview_prep_packs_user_id_idx
  on public.interview_prep_packs (user_id);

alter table public.interview_prep_packs enable row level security;

drop policy if exists "interview_prep_packs_select_own" on public.interview_prep_packs;
create policy "interview_prep_packs_select_own" on public.interview_prep_packs
  for select using (auth.uid() = user_id);

drop policy if exists "interview_prep_packs_insert_own" on public.interview_prep_packs;
create policy "interview_prep_packs_insert_own" on public.interview_prep_packs
  for insert with check (auth.uid() = user_id);

drop policy if exists "interview_prep_packs_update_own" on public.interview_prep_packs;
create policy "interview_prep_packs_update_own" on public.interview_prep_packs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- O-16's candidate-facing delete control (deletePrepPackContent) is a real
-- row DELETE, guarded server-side by application code with an additional
-- "not currently running" predicate (design-structure.r1.md ss8.3) -- RLS
-- itself only needs to confirm ownership here, matching this table's own
-- select/insert/update policies.
drop policy if exists "interview_prep_packs_delete_own" on public.interview_prep_packs;
create policy "interview_prep_packs_delete_own" on public.interview_prep_packs
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.interview_prep_packs to authenticated;
grant all on table public.interview_prep_packs to service_role;

-- ===========================================================================
-- public.interview_prep_spend
-- ===========================================================================
-- Two integer counters, keyed on application_id alone (this feature never
-- produces more than one prep effort per application, the same 1:1
-- invariant the packs table's own PK already assumes). Created once, at
-- the first successful claim; updated by exactly two writers
-- (claim_prep_pack_slot's attempts += 1, recordModelCallIssued's
-- model_calls += 1, unconditional on issue); never deleted or reset by any
-- candidate-facing action -- O-16's delete control touches only
-- interview_prep_packs (1-0-contract.r3.md ss1).

create table if not exists public.interview_prep_spend (
  application_id   uuid primary key references public.applications (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,

  -- Retry-opportunity counter -- not consumed by a 23514 CHECK-violation
  -- failure, which is not a "the candidate got to try" event.
  attempts         integer not null default 0,

  -- Spend counter -- incremented unconditionally whenever a provider call
  -- is actually issued. Bounded below only: this table's own >= 0 CHECK is
  -- a sanity constraint, not the cap. The real cap (12,
  -- PREP_MODEL_CALLS_MAX) is enforced by claim_prep_pack_slot BEFORE any
  -- write, on every claim path including the one where neither this row
  -- nor a packs row exists yet -- a CHECK forbidding model_calls > 12 on
  -- this column would reject the very write that records the 12th,
  -- cap-hitting call.
  model_calls      integer not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint interview_prep_spend_attempts_check
    check (attempts >= 0 and attempts <= 6),

  constraint interview_prep_spend_calls_check
    check (model_calls >= 0)
);

create index if not exists interview_prep_spend_user_id_idx
  on public.interview_prep_spend (user_id);

alter table public.interview_prep_spend enable row level security;

drop policy if exists "interview_prep_spend_select_own" on public.interview_prep_spend;
create policy "interview_prep_spend_select_own" on public.interview_prep_spend
  for select using (auth.uid() = user_id);

-- INSERT and UPDATE stay real policies here -- NOT dropped to nothing.
-- claim_prep_pack_slot above is SECURITY INVOKER, deliberately (its own
-- header states why), so its own
-- "insert ... on conflict (application_id) do update set attempts =
-- interview_prep_spend.attempts + 1" runs AS `authenticated` and needs both
-- privileges to keep working -- that function is unchanged this round, by
-- instruction. What narrows below is the GRANT, not these two policies'
-- text: authenticated's own privilege over `model_calls` is removed
-- entirely (see the grant block below), so these ownership predicates can
-- stay exactly as they always were without reopening this round's hole.
drop policy if exists "interview_prep_spend_insert_own" on public.interview_prep_spend;
create policy "interview_prep_spend_insert_own" on public.interview_prep_spend
  for insert with check (auth.uid() = user_id);

drop policy if exists "interview_prep_spend_update_own" on public.interview_prep_spend;
create policy "interview_prep_spend_update_own" on public.interview_prep_spend
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- SECURITY HOLE CLOSED THIS ROUND. This table used to grant `authenticated`
-- select+insert+update+DELETE, with a matching delete policy -- so a
-- candidate could DELETE their own spend row (claim_prep_pack_slot's own
-- coalesce(...,0) then reads both counters as zero) or PATCH model_calls
-- straight back to 0 through PostgREST, and either one gets a fresh slot
-- granted on the very next claim. That is the exact spend-bypass-by-deleting
-- ruling R-IP3-45 already closed once, at the claim path's own cap check --
-- reintroduced here at the RLS/grant layer because an earlier round
-- specified the EVENTS table's policies below and never specified this
-- one's. No delete policy, no delete grant -- a candidate can never remove
-- this row, matching interview_prep_events' own select+insert-only shape.
drop policy if exists "interview_prep_spend_delete_own" on public.interview_prep_spend;

-- record_prep_model_call (SECURITY DEFINER, defined at the end of this
-- file) is now the ONLY writer of model_calls, so `authenticated` needs no
-- client-facing privilege over that column at all -- its UPDATE grant is
-- narrowed, column by column, to exactly the two columns
-- claim_prep_pack_slot's own unchanged body writes directly (attempts,
-- updated_at). model_calls is deliberately absent from that list, which is
-- what stops a direct `.update({ model_calls: 0 })` PostgREST call even
-- though the row's ownership predicate (auth.uid() = user_id) above would
-- otherwise allow it -- a column-privilege failure is raised before RLS is
-- even consulted.
grant select, insert on table public.interview_prep_spend to authenticated;
grant update (attempts, updated_at) on table public.interview_prep_spend to authenticated;
grant all on table public.interview_prep_spend to service_role;

-- ===========================================================================
-- public.interview_prep_events
-- ===========================================================================
-- Append-only diagnostic log, one row per attempt or delete. FK targets
-- applications DIRECTLY, never interview_prep_packs -- see header. No
-- update policy, no delete policy, and no update/delete grant to
-- authenticated: "never modified or removed by a candidate action" is
-- database-enforced by the ABSENCE of those grants/policies, not by
-- convention.

create table if not exists public.interview_prep_events (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references public.applications (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  event_type      text not null,
  trigger_class   text,
  engine          text,
  outcome         text not null,
  reason          text,
  at              timestamptz not null default now(),

  constraint interview_prep_events_event_type_check
    check (event_type in ('attempt', 'delete')),

  -- Bounds the value to the vocabulary whenever it is present; does not
  -- itself cross-reference event_type (deliberately simpler than an
  -- earlier design round's event_type-guarded form -- see this file's
  -- header note on interviewPrepMigrationShape.test.js's exact-set
  -- assertion here). "Non-null only for an 'attempt' event, null for a
  -- 'delete' event" is upheld by recordPrepEvent, this table's one and
  -- only writer (two call sites, design-structure.r1.md ss2.1), the same
  -- application-code-discipline pattern this migration already relies on
  -- elsewhere (e.g. interview_prep_packs.engine/.resume_id are not reset
  -- on re-claim and no CHECK depends on them against status either).
  constraint interview_prep_events_trigger_class_check
    check (trigger_class is null or trigger_class in ('B1', 'B3')),

  -- Same reasoning as trigger_class_check immediately above.
  constraint interview_prep_events_engine_check
    check (engine is null or engine in ('gemini', 'external', 'embedded')),

  constraint interview_prep_events_outcome_check
    check (
      (event_type = 'attempt' and outcome in
        ('ready', 'partial', 'failed', 'unavailable', 'check-violation', 'stale-token', 'error'))
      or (event_type = 'delete' and outcome in ('deleted', 'not-found', 'error'))
    ),

  -- Same 8-member PREP_REASON_VALUES vocabulary as
  -- interview_prep_packs_reason_check above -- one JS-side source of
  -- truth, two CHECKs that happen to enforce the same strings, never two
  -- independently typed lists.
  constraint interview_prep_events_reason_check
    check (
      reason is null
      or reason in (
        'provider-timeout', 'provider-error', 'refused-posting',
        'check-violation', 'stale-claim', 'not-found', 'unknown',
        'spend-record-failed'
      )
    )
);

create index if not exists interview_prep_events_application_id_at_idx
  on public.interview_prep_events (application_id, at);
create index if not exists interview_prep_events_user_id_idx
  on public.interview_prep_events (user_id);

alter table public.interview_prep_events enable row level security;

drop policy if exists "interview_prep_events_select" on public.interview_prep_events;
create policy "interview_prep_events_select" on public.interview_prep_events
  for select using (auth.uid() = user_id);

drop policy if exists "interview_prep_events_insert" on public.interview_prep_events;
create policy "interview_prep_events_insert" on public.interview_prep_events
  for insert with check (auth.uid() = user_id);

-- Deliberately NO update policy, NO delete policy.

grant select, insert on table public.interview_prep_events to authenticated;
grant all on table public.interview_prep_events to service_role;
-- No grant to anon, matching the other two tables' precedent above.

-- ===========================================================================
-- claim_prep_pack_slot -- the one Postgres function this feature adds
-- ===========================================================================
-- SECURITY INVOKER (Postgres's own default when unspecified -- stated
-- explicitly so a future migration author "fixing" a permissions complaint
-- by reaching for SECURITY DEFINER has to delete a named line to do it,
-- rather than silently omitting one). No p_user_id parameter: every
-- statement below reads auth.uid() directly, so there is no
-- client-suppliable identity value to ever diverge from the caller's own.
--
-- Table names inside this function body are DELIBERATELY NOT
-- schema-qualified (interview_prep_spend, interview_prep_packs, not
-- public.interview_prep_spend) -- this function runs under the
-- authenticated role's own default search_path, which already includes
-- public, matching design-structure.r1.md ss4.1's own adopted text
-- byte-for-byte.
create or replace function public.claim_prep_pack_slot(
  p_application_id uuid, p_lease_token uuid, p_lease_until timestamptz
) returns boolean
language plpgsql
security invoker
as $$
declare
  v_attempts integer;
  v_model_calls integer;
  v_rows integer;
begin
  select attempts, model_calls into v_attempts, v_model_calls
    from interview_prep_spend
    where application_id = p_application_id and user_id = auth.uid()
    for update;

  v_attempts := coalesce(v_attempts, 0);
  v_model_calls := coalesce(v_model_calls, 0);

  -- BOTH caps, checked together, before any write -- including the
  -- no-spend-row-yet path above, where coalesce brings both to 0 and this
  -- comparison is simply false. Skipping this check on that path would be
  -- a spend-bypass reachable by deleting a pack and re-triggering
  -- (R-IP3-45).
  if v_attempts >= 6 or v_model_calls >= 12 then
    return false;
  end if;

  -- The claim/re-claim write. On first claim this INSERTs a fresh
  -- 'running' row. On re-claim (a prior attempt's lease expired, or a
  -- prior attempt ended in a terminal status) the ON CONFLICT branch
  -- resets pack/researched_at/reason together, so a re-claimed row can
  -- never violate interview_prep_packs_running_has_no_content or
  -- interview_prep_packs_researched_at_terminal at the moment this
  -- statement commits, and never carries a stale diagnostic reason from
  -- its prior attempt into the new 'running' row. The WHERE clause is what
  -- refuses a claim against a row someone else already holds a live lease
  -- on.
  insert into interview_prep_packs (application_id, user_id, status, lease_until, lease_token)
  values (p_application_id, auth.uid(), 'running', p_lease_until, p_lease_token)
  on conflict (application_id) do update
    set status = 'running',
        lease_until = excluded.lease_until,
        lease_token = excluded.lease_token,
        pack = '{}'::jsonb,
        researched_at = null,
        reason = null,
        updated_at = now()
    where interview_prep_packs.user_id = auth.uid()
      and (interview_prep_packs.status <> 'running' or interview_prep_packs.lease_until < now());

  -- The claim verdict comes from THIS statement's own ROW_COUNT, never
  -- from a follow-up read of the row's current token. A retry that resends
  -- the identical (application_id, lease_token) pair after this call
  -- already succeeded once finds the row already status = 'running' with a
  -- still-valid lease_until -- the WHERE clause's disjunction is false on
  -- both arms, the DO UPDATE branch does not fire, ROW_COUNT is 0, and
  -- this function returns false WITHOUT ever reaching the ledger INSERT
  -- below -- so a same-token retry can never double-debit attempts.
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return false;
  end if;

  -- Reached only when the statement above just created or claimed a row,
  -- in the SAME transaction -- so a interview_prep_packs row can never
  -- exist without a corresponding interview_prep_spend row (the fourth,
  -- otherwise-unreachable read-contract quadrant design-structure.r1.md
  -- ss5.4 proves closed by this construction).
  insert into interview_prep_spend (application_id, user_id, attempts, model_calls)
  values (p_application_id, auth.uid(), 1, 0)
  on conflict (application_id) do update
    set attempts = interview_prep_spend.attempts + 1,
        updated_at = now();

  return true;
end;
$$;

-- Required by this repo's own convention (every grant in every migration
-- under this directory is explicit; the one existing function,
-- prune_feed_postings in 20260612000000_feed_postings_retention.sql, is
-- likewise followed immediately by an explicit grant) -- never framed as a
-- possibly-redundant defensive line. Harmless if the live project's
-- default privileges already include this; load-bearing if a prior ALTER
-- DEFAULT PRIVILEGES statement revoked it (3b.r1.md Item 1;
-- 1-0-contract.r8.md ss15).
grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to authenticated;

-- ===========================================================================
-- record_prep_model_call -- SECURITY DEFINER, closes two problems at once
-- ===========================================================================
-- 1. `authenticated`'s own privilege on interview_prep_spend no longer
--    reaches model_calls at all (see that table's grant above) -- so the
--    write this function performs cannot be done any other way by a
--    candidate-facing request. SECURITY DEFINER runs it as this function's
--    OWNER instead of the caller, which is exactly the trusted-helper shape
--    that makes narrowing the table grant above safe rather than merely
--    decorative.
-- 2. It is atomic -- one `insert ... on conflict (application_id) do
--    update set model_calls = interview_prep_spend.model_calls + 1`, the
--    SAME expression pattern claim_prep_pack_slot already uses for
--    `attempts` a few statements up -- replacing prepStore.js's prior
--    select-then-update, which raced two concurrent calls into reading and
--    incrementing the same starting value.
--
-- SAFE BY CONSTRUCTION, the opposite way claim_prep_pack_slot is safe by
-- construction (SECURITY INVOKER, stated explicitly): this one is SECURITY
-- DEFINER, stated explicitly, with `search_path` pinned to the empty string
-- so no object reference in this body can be redirected by a search_path a
-- caller controls -- every reference below is fully schema-qualified
-- (`public.interview_prep_spend`, `public.applications`) for exactly that
-- reason. No p_user_id parameter -- identity is auth.uid(), read
-- server-side, never a client-suppliable value. Ownership is checked
-- explicitly, BEFORE any write, against `public.applications` (SECURITY
-- DEFINER bypasses this table's own RLS, so nothing else would stop one
-- user's request from touching another user's application's spend row);
-- the ON CONFLICT DO UPDATE's own WHERE clause repeats the same check
-- against the target row's `user_id`, mirroring claim_prep_pack_slot's own
-- WHERE-clause convention on interview_prep_packs above.
create or replace function public.record_prep_model_call(
  p_application_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not exists (
    select 1 from public.applications
    where id = p_application_id and user_id = auth.uid()
  ) then
    return false;
  end if;

  insert into public.interview_prep_spend (application_id, user_id, attempts, model_calls)
  values (p_application_id, auth.uid(), 0, 1)
  on conflict (application_id) do update
    set model_calls = interview_prep_spend.model_calls + 1,
        updated_at = now()
    where interview_prep_spend.user_id = auth.uid();

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Same repo convention as claim_prep_pack_slot's own grant immediately
-- above -- explicit, never relying on Postgres's default PUBLIC-execute
-- grant.
grant execute on function public.record_prep_model_call(uuid) to authenticated;
