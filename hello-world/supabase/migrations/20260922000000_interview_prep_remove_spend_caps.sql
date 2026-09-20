-- N41 (owner decision, 2026-09-20): both interview-prep spend caps are
-- removed entirely -- interview_prep_spend.attempts' own upper bound
-- (<= 6) and claim_prep_pack_slot's top-of-function `model_calls >= 12`
-- guard. The kill switch (PREP_DISABLED) and the route's own rate limiter
-- remain the only guards a candidate can ever hit (design-experience.r1.md
-- §0). interview_prep_spend.attempts/.model_calls THEMSELVES REMAIN --
-- still written, unconditionally, on every claim/model call, never reset --
-- N41(d)'s own text: this migration removes the CEILING, not the counters.
--
-- 20260914000000_interview_prep.sql and
-- 20260915000000_interview_prep_spend_lockdown.sql are both already applied
-- to the live project. Editing either in place is exactly the hazard
-- [[schema-migration-drift]]/backlog N30 tracks -- this file supersedes
-- them by REPLACING the objects they created, the same precedent both of
-- those files already followed themselves.
--
-- Two changes, both required:
--
--   1. `interview_prep_spend_attempts_check` (attempts >= 0 and attempts <=
--      6) is DROPPED outright, not widened -- there is no remaining reason
--      to keep an upper bound once the guard that reads it is also gone.
--      The `attempts >= 0` sanity half goes with it; nothing in this
--      feature relies on that half independently of the removed ceiling.
--
--   2. claim_prep_pack_slot's own top-of-function
--      `if v_attempts >= 6 or v_model_calls >= 12 then return false; end
--      if;` (20260915000000_interview_prep_spend_lockdown.sql:268-270) is
--      the ONLY line removed from this function's body. Every other line
--      -- the 3-parameter signature, SECURITY DEFINER, `search_path`
--      pinned to '', the ownership check against public.applications, both
--      upserts and their WHERE clauses, and the 42501 integrity raise --
--      is carried forward byte-for-byte from that migration, so this file
--      cannot silently regress the N12 security fix it made.
--
-- NOT restated here, deliberately: this function's own GRANT/REVOKE
-- privileges. `create or replace function` does not reset an existing
-- function's ACL (20260915000000_interview_prep_spend_lockdown.sql's own
-- header, verbatim) -- PUBLIC/anon stay revoked and `authenticated` stays
-- granted EXECUTE without restating any of those three statements here.
-- Restating them would also trip
-- lib/interviewPrep/interviewPrepEffectiveSchema.test.js's own
-- prose-vs-real-revoke control, which expects no additional revoke
-- statement on this function beyond the lockdown migration's own two.

alter table public.interview_prep_spend
  drop constraint if exists interview_prep_spend_attempts_check;

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
  -- Unchanged from 20260915000000_interview_prep_spend_lockdown.sql: the
  -- ownership check DEFINER mode needs, since RLS is no longer the
  -- backstop it was under the original SECURITY INVOKER function.
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

  -- N41: the cap check that used to live here --
  -- `if v_attempts >= 6 or v_model_calls >= 12 then return false; end if;`
  -- -- is REMOVED. The `select ... for update` above still runs, so a
  -- concurrent claim on the same row still serializes the same way it
  -- always has; the two counters below are still written, unconditionally,
  -- on every claim -- nothing compares them to a ceiling any more.

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

  insert into public.interview_prep_spend (application_id, user_id, attempts, model_calls)
  values (p_application_id, auth.uid(), 1, 0)
  on conflict (application_id) do update
    set attempts = interview_prep_spend.attempts + 1,
        updated_at = now()
    where interview_prep_spend.user_id = auth.uid();

  get diagnostics v_spend_rows = row_count;
  if v_spend_rows = 0 then
    raise exception 'interview_prep_spend ownership mismatch for application %', p_application_id
      using errcode = '42501';
  end if;

  return true;
end;
$$;
