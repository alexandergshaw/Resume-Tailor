-- Interview prep (IP3) spend lockdown -- backlog N12.
--
-- ===========================================================================
-- WHY THIS FILE EXISTS, AND WHY IT IS A NEW FILE RATHER THAN AN EDIT
-- ===========================================================================
-- 20260914000000_interview_prep.sql is already applied to the live project
-- (.github/workflows/supabase-migrations.yml runs on merge to main). Editing
-- an applied migration in place is exactly the mechanism
-- [[schema-migration-drift]] tracks: the file on disk would stop describing
-- what the live database actually has, and a fresh clone or a rebuilt
-- shadow database would apply a DIFFERENT statement than the one that ran
-- against production. This file supersedes specific passages of that
-- migration by REPLACING the objects it created, the same way every other
-- privilege-narrowing migration in this directory does
-- (20260908000000_positions_policy_hardening.sql over
-- 20260610010000_positions_grants.sql).
--
-- Superseded passages of 20260914000000_interview_prep.sql, by line range --
-- each now asserts something the schema no longer does once this file is
-- applied on top of it:
--   :28-31   -- "claim_prep_pack_slot ... is a SECURITY INVOKER function --
--              deliberately not DEFINER". It is DEFINER as of this file.
--   :333-346 -- "What narrows below is the GRANT, not these two policies'
--              text ... these ownership predicates can stay exactly as they
--              always were". This file DROPs and RECREATEs both policies
--              (same predicate text, restated -- see below for why restating
--              rather than leaving untouched still matters).
--   :359-369 -- "authenticated's own privilege on interview_prep_spend no
--              longer reaches model_calls at all" as the closing statement of
--              that table's privilege story. It is narrower than that now:
--              authenticated reaches NEITHER model_calls NOR attempts NOR
--              updated_at through a direct table grant -- the UPDATE grant
--              this passage describes narrowing to (attempts, updated_at) is
--              itself fully revoked below.
--   :455-471 -- claim_prep_pack_slot's own header, asserting SECURITY INVOKER
--              and unqualified table names as the function's permanent shape
--              "matching design-structure.r1.md ss4.1's own adopted text
--              byte-for-byte". That adopted text specified SECURITY INVOKER;
--              this migration supersedes that adopted text under backlog
--              N12, for the reason in the next section. The unqualified-name
--              convention it describes does NOT carry over -- this file's
--              own function body schema-qualifies every table reference
--              except the ON CONFLICT correlation names (see below).
--   :564-568 -- record_prep_model_call's header, framing narrowing
--              authenticated's UPDATE grant to (attempts, updated_at) as the
--              closing move that makes SECURITY DEFINER "safe rather than
--              merely decorative" for THAT function. claim_prep_pack_slot
--              becoming DEFINER too, and that grant being revoked entirely
--              rather than merely column-scoped, is what this file adds on
--              top.
--
-- Binding contract documents (1-0-contract.r8.md; design-structure.r1.md
-- §4.1, quoted byte-for-byte at the superseded :465-471 above) specify
-- SECURITY INVOKER for claim_prep_pack_slot. This migration supersedes that
-- adopted text under backlog N12. Both documents are out-of-tree loop
-- artifacts from the design round that produced this repo's own IP3
-- migration -- never checked into this working tree -- so this paragraph is
-- bookkeeping, not a blocker: it exists only so a later reader who goes and
-- finds those documents elsewhere does not mistake the live schema's
-- disagreement with them for an unrecorded regression, when it is in fact
-- this ruling, recorded here because it could not be recorded there.
--
-- ===========================================================================
-- WHY N12 EXISTS: claim_prep_pack_slot's own spend upsert has no WHERE
-- ===========================================================================
-- claim_prep_pack_slot is SECURITY INVOKER, so its spend upsert
-- (20260914000000_interview_prep.sql:542-546) runs AS the calling
-- `authenticated` role -- which is exactly why that role needs
-- `grant update (attempts, updated_at)` on interview_prep_spend at all. That
-- upsert's `on conflict (application_id) do update set attempts = ...,
-- updated_at = now()` carries NO `where` clause, unlike this same file's
-- OWN record_prep_model_call a few statements later
-- (20260914000000_interview_prep.sql:612-615), whose otherwise-identical
-- upsert does carry `where interview_prep_spend.user_id = auth.uid()`. RLS
-- is today's only backstop against a client PATCHing a victim's
-- `application_id` into a claim call and resetting the victim's own attempts
-- counter to 0 -- buying free retries at the victim's expense.
--
-- Converting SECURITY INVOKER to SECURITY DEFINER without ALSO adding an
-- explicit ownership check would not close that hole, it would trade it for
-- a worse one: SECURITY DEFINER bypasses RLS entirely, so the same
-- attacker-suppliable `application_id` would then reach the spend upsert
-- with NO gate at all -- six calls burn a victim's `attempts` to the
-- `interview_prep_spend_attempts_check` ceiling (<= 6) and permanently deny
-- them the feature, the exact failure mode this file's own ownership check
-- and `42501` raise below exist to make unreachable.
--
-- Second, independent gap closed here: 20260914000000_interview_prep.sql
-- contains ZERO `revoke execute` statements on either function, so PUBLIC
-- retains Postgres's own default EXECUTE grant on both -- including the
-- already-shipped SECURITY DEFINER record_prep_model_call, which was never
-- meant to be callable by an unauthenticated request. Closed below for both
-- functions, matching this directory's own explicit-grant convention
-- (3b.r1.md Item 1; 1-0-contract.r8.md §15; the same convention
-- 20260612000000_feed_postings_retention.sql already follows for
-- prune_feed_postings).
--
-- Every statement below is safely re-runnable: create or replace function,
-- drop policy if exists before create policy, and grant/revoke are
-- idempotent by definition -- matching every other migration in this
-- directory (20260914000000_interview_prep.sql's own closing note; also
-- stated at 20260908000000_positions_policy_hardening.sql:188).

-- ===========================================================================
-- claim_prep_pack_slot -- converted to SECURITY DEFINER, ownership checked
-- explicitly because DEFINER means RLS is no longer the backstop
-- ===========================================================================
-- Signature stays BYTE-IDENTICAL to the original, (uuid, uuid, timestamptz)
-- -- `create or replace function` only replaces an EXISTING function when
-- the argument list matches exactly; a changed signature would create a
-- SECOND, independent function and leave the old INVOKER one still callable
-- under whatever grant it already holds, defeating this entire migration.
create or replace function public.claim_prep_pack_slot(
  p_application_id uuid, p_lease_token uuid, p_lease_until timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_model_calls integer;
  v_rows integer;
  v_spend_rows integer;
begin
  -- The ownership check this function did not need as SECURITY INVOKER
  -- (RLS did it for free) and now cannot do without: DEFINER runs as this
  -- function's OWNER, not the caller, so nothing else below would stop one
  -- user's request from reading or writing another user's application's
  -- spend/pack rows. Checked first, before any read or write.
  if not exists (
    select 1 from public.applications
    where id = p_application_id and user_id = auth.uid()
  ) then
    return false;
  end if;

  select attempts, model_calls into v_attempts, v_model_calls
    from public.interview_prep_spend
    where application_id = p_application_id and user_id = auth.uid()
    for update;

  v_attempts := coalesce(v_attempts, 0);
  v_model_calls := coalesce(v_model_calls, 0);

  -- BOTH caps, checked together, before any write -- unchanged from the
  -- original function's own reasoning (20260914000000_interview_prep.sql's
  -- header): a missing check on the no-row-yet path would be a spend-bypass
  -- reachable by deleting a pack and re-triggering (R-IP3-45).
  if v_attempts >= 6 or v_model_calls >= 12 then
    return false;
  end if;

  -- Table names everywhere else in this body are schema-qualified
  -- (`public.interview_prep_packs`) because `set search_path = ''` above
  -- means an unqualified name resolves against NOTHING -- but the
  -- correlation names inside this ON CONFLICT's own SET/WHERE clauses
  -- (`interview_prep_packs.user_id`, `interview_prep_packs.status`,
  -- `interview_prep_packs.lease_until`) refer to the INSERT's OWN target
  -- table via the implicit correlation name Postgres binds for the
  -- statement being executed, not a separately resolved identifier -- that
  -- name is always the bare table name as written in the `insert into`
  -- clause, never schema-qualified, regardless of search_path. Writing
  -- `public.interview_prep_packs.user_id` here is not extra safety, it is a
  -- syntax error: Postgres does not accept a schema-qualified correlation
  -- name in this position.
  insert into public.interview_prep_packs (application_id, user_id, status, lease_until, lease_token)
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

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  -- THE FIX: this upsert now carries the `where` clause the SECURITY
  -- INVOKER version relied on RLS to provide. Same correlation-name
  -- reasoning as the packs upsert above -- `interview_prep_spend.attempts`
  -- and `interview_prep_spend.user_id` name this INSERT's own target table,
  -- never `public.interview_prep_spend.*`.
  insert into public.interview_prep_spend (application_id, user_id, attempts, model_calls)
  values (p_application_id, auth.uid(), 1, 0)
  on conflict (application_id) do update
    set attempts = interview_prep_spend.attempts + 1,
        updated_at = now()
    where interview_prep_spend.user_id = auth.uid();

  get diagnostics v_spend_rows = row_count;
  -- Reachable only if the packs row above was just claimed (v_rows > 0,
  -- already returned false otherwise) AND this spend upsert's own `where`
  -- then refused the write -- i.e. the spend row exists but belongs to a
  -- DIFFERENT user_id than the packs row this transaction just claimed.
  -- That should never happen (both rows are keyed on the same
  -- application_id, and applications.user_id was already confirmed above),
  -- so this is a belt-and-braces integrity check, not a normal-traffic
  -- path. Raising instead of silently returning true or false is
  -- deliberate: returning true here would grant a slot with no attempt
  -- ever recorded against it (a free, uncapped retry), and returning false
  -- would leave the packs row already claimed above with no way to signal
  -- that the transaction should roll back -- both leave the cap's own
  -- accounting wrong. SQLSTATE 42501 (insufficient_privilege) is the
  -- closest standard code for "this write was refused by an ownership
  -- check", matching the vocabulary this function already reads elsewhere
  -- (record_prep_model_call's own RLS-shaped refusal is a plain `false`
  -- return precisely because it has no prior write to unwind).
  if v_spend_rows = 0 then
    raise exception 'interview_prep_spend ownership mismatch for application %', p_application_id
      using errcode = '42501';
  end if;

  return true;
end;
$$;

-- Explicit on both directions, for both functions: PostgreSQL grants EXECUTE
-- on a new function to PUBLIC by default, and `create or replace` does not
-- reset an existing function's ACL -- so 20260914000000_interview_prep.sql
-- never touching PUBLIC's privilege at all means PUBLIC has held EXECUTE on
-- both functions, unnoticed, since that file was applied. Revoked here,
-- explicitly, rather than assumed closed by omission.
revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public;
grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to authenticated;
revoke execute on function public.record_prep_model_call(uuid) from public;
grant execute on function public.record_prep_model_call(uuid) to authenticated;

-- ===========================================================================
-- interview_prep_spend -- authenticated loses every direct write privilege
-- ===========================================================================
-- claim_prep_pack_slot is DEFINER now (above); record_prep_model_call
-- already was. Both write this table as their OWNER, not as `authenticated`
-- -- so `authenticated` needs no client-facing privilege over it beyond
-- SELECT at all. The original migration's column-scoped
-- `grant update (attempts, updated_at)` existed ONLY to let the old INVOKER
-- claim_prep_pack_slot write as the caller; that reason is gone.
--
-- Two revokes, not one, because the original grant is itself two shapes:
-- `grant update (attempts, updated_at) ...` is a COLUMN-level privilege,
-- stored separately from a table-level one, and only a `revoke` naming the
-- same columns removes it -- a bare `revoke update ...` does not reach a
-- column-scoped grant. The second statement then removes the plain,
-- table-level `insert` the original migration also granted.
revoke update (attempts, updated_at) on table public.interview_prep_spend from authenticated;
revoke update, insert on table public.interview_prep_spend from authenticated;
-- Restated, not merely left alone -- this pair is now a complete statement
-- of the table's intended privileges (matching
-- 20260908000000_positions_policy_hardening.sql's own precedent for
-- restating an unchanged grant alongside a narrowed one). `select` survives
-- because `readPrepPack`/`listPrepPacks`
-- (lib/interviewPrep/prepStore.js) read this table directly through the
-- browser Supabase client, under RLS, never through a server-only path.
grant select on table public.interview_prep_spend to authenticated;
grant all on table public.interview_prep_spend to service_role;

-- These two policies are RECREATED with the SAME predicate text they
-- already had (20260914000000_interview_prep.sql:338-343) -- not left
-- untouched, and deliberately not dropped outright. SECURITY DEFINER
-- bypassing RLS is conditional, not absolute: if this function's OWNER
-- ever differs from interview_prep_spend's table owner, or if
-- `relforcerowsecurity` is ever set on this table, Postgres does NOT skip
-- RLS for a DEFINER function -- and this checkout has no way to see which
-- of those is true on the live project. Restating these policies costs
-- nothing when DEFINER's usual bypass holds, and is the ONLY thing that
-- keeps claim_prep_pack_slot's and record_prep_model_call's writes working
-- at all if it does not. Not adding `force row level security`: that
-- setting would make RLS apply even to the table owner, which would break
-- BOTH DEFINER functions outright rather than merely fail to bypass it.
drop policy if exists "interview_prep_spend_insert_own" on public.interview_prep_spend;
create policy "interview_prep_spend_insert_own" on public.interview_prep_spend
  for insert with check (auth.uid() = user_id);
drop policy if exists "interview_prep_spend_update_own" on public.interview_prep_spend;
create policy "interview_prep_spend_update_own" on public.interview_prep_spend
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===========================================================================
-- WHAT THIS CHECKOUT CANNOT VERIFY
-- ===========================================================================
-- Same limitation as 20260914000000_interview_prep.sql's own closing
-- section, restated because it applies just as fully here:
-- NEXT_PUBLIC_SUPABASE_URL is a placeholder in this checkout
-- ([[schema-migration-drift]], [[windows-shell-environment]]), so nothing in
-- this file -- the ownership check, the `42501` raise, the column-privilege
-- revoke, the PUBLIC execute revoke, or whether this project's
-- `relforcerowsecurity`/function-ownership actually needs the restated
-- policies above -- has been executed against a real Postgres instance from
-- this seat. lib/interviewPrep/interviewPrepEffectiveSchema.test.js, which
-- this file's shape was driven by, can only prove the DECLARED SQL text is
-- internally consistent across every migration replayed in order; it cannot
-- prove Postgres enforces any of it.
