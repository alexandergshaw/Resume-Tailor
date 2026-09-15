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
--              "matching design-structure.r1.md §4.1's own adopted text
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
-- stated at 20260908000000_positions_policy_hardening.sql:188). The cleanup
-- block below is the one exception worth calling out explicitly: it is
-- re-runnable too (a second run simply finds zero cross-tenant rows and
-- reports zero deleted), but it is not idempotent in the sense of "always
-- produces the same rows" -- it can only ever delete a given poisoned row
-- once.

-- ===========================================================================
-- CLEANUP: cross-tenant rows created via the still-open N12 hole -- BEFORE
-- claim_prep_pack_slot is replaced, deliberately
-- ===========================================================================
-- OWNER RULING, 2026-09-15. Ordering matters: once claim_prep_pack_slot
-- below becomes SECURITY DEFINER with the ownership-checked spend upsert's
-- `where interview_prep_spend.user_id = auth.uid()`, a POISONED row (one
-- whose user_id does not match its own application's owner -- reachable
-- today only through the still-open N12 hole: POSTing a victim's
-- application_id creates interview_prep_spend/interview_prep_packs rows
-- keyed to the victim's application but owned by the attacker) makes that
-- upsert's WHERE clause match zero rows for that application FOREVER --
-- v_spend_rows stays 0 on every subsequent call, and the 42501 raise below
-- fires on every claim attempt for that victim, permanently, with no
-- candidate-facing or application-level way to clear it (authenticated holds
-- no DELETE grant or policy on this table, by design). Running this cleanup
-- FIRST, before the function below is replaced, means the new function never
-- has a poisoned row left to trip over.
--
-- WHAT "FIRST" ACTUALLY BUYS, STATED PRECISELY (minor-10 correction): this
-- paragraph previously claimed running the cleanup after the function swap
-- would leave the new function "live, and already poisoned, for the entire
-- window in between" -- decorative, not established. All statements in this
-- file run inside ONE migration: .github/workflows/supabase-migrations.yml
-- applies it via `supabase db push`, which wraps each migration FILE in a
-- single transaction, so within this one file the cleanup and the function
-- swap commit together or not at all -- no window between them can exist
-- regardless of which comes first. The ordering is kept anyway, for a human
-- reader's sake and as defense-in-depth against a future edit that splits
-- this file's statements across more than one transaction, not because
-- today's ordering closes a race that would otherwise exist.
--
-- WHY THIS DELETE CANNOT REMOVE A LEGITIMATE ROW: every writer of these two
-- tables -- the ORIGINAL invoker claim_prep_pack_slot this file supersedes,
-- record_prep_model_call, and the new DEFINER claim_prep_pack_slot below --
-- always sets user_id to auth.uid(), the CALLER's own identity, never a
-- client-suppliable value. A legitimate row's user_id can therefore only
-- ever equal its own application's user_id. A row where they differ can only
-- exist if some caller supplied an application_id belonging to a DIFFERENT
-- account than their own and the write proceeded anyway -- exactly the
-- still-open N12 gap described above, and by definition only that gap can
-- produce such a row. Deleting exactly the rows where they differ therefore
-- removes only exploit-created rows, never a legitimately-written one.
--
-- Counted and reported, not silent -- get diagnostics + raise notice, so a
-- later reader can tell "nothing was wrong" from "this did not run". Order
-- between the two tables' own deletes does not matter (neither references
-- the other; both independently reference applications), so spend is
-- cleaned first only because it is the table this file's header discusses
-- first.
do $$
declare
  v_deleted_spend integer;
  v_deleted_packs integer;
  v_spend_force_rls boolean;
  v_packs_force_rls boolean;
begin
  -- MAJOR-6, reworded (MAJOR-E adversarial-review correction): the wording
  -- here previously claimed "neither table carries a DELETE policy" --
  -- false for interview_prep_packs, which has carried
  -- "interview_prep_packs_delete_own" (using auth.uid() = user_id) since
  -- 20260914000000_interview_prep.sql:271-273. The conclusion below still
  -- holds, but for the mechanism that actually produces it:
  -- relforcerowsecurity, if ever set on either table, forces RLS to filter
  -- THIS MIGRATION's own DELETE exactly the way it would filter any
  -- non-owner role's -- and a migration runs with no authenticated session,
  -- so auth.uid() is NULL here. No ownership policy -- present
  -- (interview_prep_packs) or absent (interview_prep_spend) -- can ever
  -- match a NULL auth.uid() against a row's own (necessarily non-null)
  -- user_id, so a force-RLS table deletes ZERO rows no matter how many
  -- cross-tenant rows actually exist, regardless of whether it happens to
  -- carry a DELETE policy at all.
  --
  -- MAJOR-F, OWNER RULING 2026-09-15: raises rather than merely warning.
  -- Left as a warning, continuing on would install the DEFINER
  -- claim_prep_pack_slot below while a poisoned row stays behind --
  -- permanently unclaimable (this file's own reasoning above), with no
  -- candidate-facing remedy -- and a CI warning is routinely unread. Gated
  -- on relforcerowsecurity alone, not on whether either DELETE actually
  -- reports zero rows, so a genuinely clean project (both flags false)
  -- never reaches this branch. Checked here, for both tables, before
  -- either DELETE runs. Every statement in this file runs in one
  -- transaction (this file's own header, above), so raising here rolls
  -- back cleanly and leaves the file re-runnable once relforcerowsecurity
  -- is cleared.
  select relforcerowsecurity into v_spend_force_rls
    from pg_class where oid = 'public.interview_prep_spend'::regclass;
  if v_spend_force_rls then
    raise exception 'interview_prep_spend has relforcerowsecurity set -- aborting rather than silently deleting 0 row(s): with no authenticated session in a migration, auth.uid() is NULL and no ownership policy can match, so any cross-tenant row here would be left behind, permanently unclaimable once claim_prep_pack_slot below is installed; clear relforcerowsecurity on this table and re-run this migration';
  end if;

  select relforcerowsecurity into v_packs_force_rls
    from pg_class where oid = 'public.interview_prep_packs'::regclass;
  if v_packs_force_rls then
    raise exception 'interview_prep_packs has relforcerowsecurity set -- aborting rather than silently deleting 0 row(s): with no authenticated session in a migration, auth.uid() is NULL and no ownership policy can match, so any cross-tenant row here would be left behind, permanently unclaimable once claim_prep_pack_slot below is installed; clear relforcerowsecurity on this table and re-run this migration';
  end if;

  delete from public.interview_prep_spend spend
  using public.applications app
  where spend.application_id = app.id
    and spend.user_id <> app.user_id;
  get diagnostics v_deleted_spend = row_count;
  raise notice 'interview_prep_spend cross-tenant cleanup: % row(s) deleted', v_deleted_spend;

  delete from public.interview_prep_packs packs
  using public.applications app
  where packs.application_id = app.id
    and packs.user_id <> app.user_id;
  get diagnostics v_deleted_packs = row_count;
  raise notice 'interview_prep_packs cross-tenant cleanup: % row(s) deleted', v_deleted_packs;
end;
$$;

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
--
-- `anon` is revoked as its OWN statement, separate from `public` -- a bare
-- `revoke ... from public` narrows the default PUBLIC-wide grant but does
-- NOT remove an explicit grant a more specific role such as `anon` might
-- separately hold, so naming `public` alone would not actually prove `anon`
-- has no path to either function. Both precedents this file's own header
-- cites revoke `anon` explicitly rather than relying on the umbrella revoke
-- to reach it: 20260612000000_feed_postings_retention.sql:33-34 revokes
-- `from public;` AND `from anon, authenticated;` as separate statements, and
-- 20260908000000_positions_policy_hardening.sql already ruled that on this
-- project an omission is not an absence.
revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public;
revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from anon;
grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to authenticated;
revoke execute on function public.record_prep_model_call(uuid) from public;
revoke execute on function public.record_prep_model_call(uuid) from anon;
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
-- Two revokes, not one -- belt-and-braces, not strictly required. Per the
-- PostgreSQL documentation's REVOKE reference (Notes section, verbatim):
-- "When revoking privileges on a table, the corresponding column privileges
-- (if any) are automatically revoked on each column of the table, as well."
-- So the second, bare `revoke update, insert ...` below already reaches the
-- original migration's column-scoped `grant update (attempts, updated_at)`
-- on its own -- the first, explicit column-scoped revoke is deliberate
-- redundancy, not a requirement. Kept anyway and stated explicitly, matching
-- this repo's own convention of never leaving a privilege's removal to an
-- unstated cascade (3b.r1.md Item 1; 1-0-contract.r8.md §15), and as cheap
-- insurance should this ever run against a database where that cascade
-- behaviour somehow does not hold.
revoke update (attempts, updated_at) on table public.interview_prep_spend from authenticated;
revoke update, insert on table public.interview_prep_spend from authenticated;
-- `anon` never held a grant on this table
-- (20260914000000_interview_prep.sql granted only `authenticated` and
-- `service_role`), so this revoke is a no-op today -- restated anyway, as
-- its own explicit statement rather than assumed closed by omission,
-- matching 20260908000000_positions_policy_hardening.sql:274's identical
-- precedent for `positions`.
revoke all on table public.interview_prep_spend from anon;
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
-- setting would make RLS apply even to the table owner -- overstated here
-- previously as something that "would break BOTH DEFINER functions
-- outright". The restated policies above check `auth.uid()`, which reads
-- the CALLING session's own JWT GUC regardless of which role is actually
-- executing the statement, not the table owner's identity -- so a
-- legitimate DEFINER write would likely still satisfy its own policy under
-- force RLS too, not be broken outright by it. Not confirmed against a live
-- project from this checkout ([[schema-migration-drift]],
-- [[windows-shell-environment]]), so left off rather than asserted safe --
-- the decision not to add force RLS is unaffected either way; restating the
-- policies above is what actually matters, regardless of whether force RLS
-- is ever set.
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
-- this file -- the ownership check, the `42501` raise, the cleanup block's
-- own DELETE/GET DIAGNOSTICS/RAISE NOTICE, the column-privilege revoke, the
-- PUBLIC/anon execute and table revokes, or whether this project's
-- `relforcerowsecurity`/function-ownership actually needs the restated
-- policies above -- has been executed against a real Postgres instance from
-- this seat. In particular: whether the cleanup block finds and removes any
-- cross-tenant rows on the live project, and how many, is unknown from
-- here -- its `raise notice` output is only visible to whoever actually
-- runs the migration, and the owner should capture it for that reason.
-- lib/interviewPrep/interviewPrepEffectiveSchema.test.js, which this file's
-- shape was driven by, can only prove the DECLARED SQL text is internally
-- consistent across every migration replayed in order, and that the cleanup
-- block's own statements PRECEDE claim_prep_pack_slot's replacement IN THE
-- SOURCE TEXT -- text order, read top to bottom, not a proof of execution
-- order inside the live database. It cannot prove Postgres enforces any of
-- it.
