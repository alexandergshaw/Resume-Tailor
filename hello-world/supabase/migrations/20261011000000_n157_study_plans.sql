-- Study plans (N157): one researched, personalized study plan per tracked
-- application, plus the learner's resume position and per-card history. See
-- lib/studyPlan/studyPlanContract.js (projection + names) and
-- lib/studyPlan/studyPlanSchema.js (the plan/progress/knobs shapes).
--
-- This mirrors public.application_digests (20260817000000): a one-to-one
-- extension of `applications`, so `application_id` is the primary key and
-- `on delete cascade` removes a deleted application's plan with it. The only
-- foreign keys are to applications(id) (its primary key) and auth.users, so
-- the live applications UNIQUE(user_id, position_id) never touches this table.
--
-- `status` has NO default, deliberately. application_digests defaults to
-- 'ready', but here a 'ready' row must carry at least one module in `plan`
-- (study_plans_ready_has_modules), so a default-'ready' insert with an empty
-- plan would violate the CHECK. An insert that omits status must error, the
-- same stance as interview_prep_packs.status in 20260914000000.
--
-- `progress` is WRITTEN ONLY through merge_study_plan_progress below, never by
-- a whole-object read-modify-write, so two devices recording different cards
-- cannot drop each other's entries.
--
-- Applied by .github/workflows/supabase-migrations.yml (`supabase db push` on
-- merges to main that touch this directory). Every statement is idempotent.

create table if not exists public.study_plans (
  application_id      uuid primary key references public.applications (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  status              text not null,
  plan                jsonb not null default '{}'::jsonb,
  knobs               jsonb not null default '{}'::jsonb,
  progress            jsonb not null default '{}'::jsonb,
  cached_research     jsonb not null default '{}'::jsonb,
  posting_fingerprint text not null default '',
  researched_at       timestamptz,
  engine              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint study_plans_status_check check (status in ('ready', 'partial', 'unavailable')),
  -- CASE-guarded, mirroring interview_prep_packs_ready_is_complete: the path
  -- operator returns SQL NULL on a missing key, jsonb_typeof of that is NULL,
  -- which fails the = 'array' test and falls to `else false`, so
  -- jsonb_array_length can never be reached on a non-array.
  constraint study_plans_ready_has_modules check (
    status <> 'ready' or (
      case when jsonb_typeof(plan #> '{modules}') = 'array'
           then jsonb_array_length(plan #> '{modules}') > 0
           else false end
    )
  )
);

-- RLS's own policies restrict every query to `auth.uid() = user_id`, but that
-- predicate still has to scan something; this index lets it seek instead,
-- mirroring application_digests_user_idx.
create index if not exists study_plans_user_idx
  on public.study_plans (user_id);

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, exactly the application_digests shape.
-- ---------------------------------------------------------------------------
alter table public.study_plans enable row level security;

drop policy if exists "study_plans_select_own" on public.study_plans;
create policy "study_plans_select_own" on public.study_plans
  for select using (auth.uid() = user_id);

drop policy if exists "study_plans_insert_own" on public.study_plans;
create policy "study_plans_insert_own" on public.study_plans
  for insert with check (auth.uid() = user_id);

drop policy if exists "study_plans_update_own" on public.study_plans;
create policy "study_plans_update_own" on public.study_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "study_plans_delete_own" on public.study_plans;
create policy "study_plans_delete_own" on public.study_plans
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.study_plans to authenticated;
grant all on table public.study_plans to service_role;

-- ---------------------------------------------------------------------------
-- Progress merge: lost-update-safe by construction.
--
-- SECURITY INVOKER (stated explicitly, per claim_prep_pack_slot's convention)
-- so it runs as the caller under RLS; the WHERE also carries auth.uid() as
-- defence in depth. There is no p_user_id parameter: identity is auth.uid()
-- server-side, never a caller-supplied value.
--
-- WHY THIS IS NOT A LOST UPDATE under READ COMMITTED: the single UPDATE takes a
-- row lock; a concurrent second call blocks on it, and when the first commits
-- the second RE-EVALUATES its SET expression against the newly committed tuple
-- (EvalPlanQual), so `seen || p_seen_delta` is computed over the first
-- writer's merged value. Distinct itemId keys both survive; this is the
-- property a whole-object read-modify-write in application code cannot give.
-- Two writes to the SAME itemId are last-writer-wins, which is correct
-- (grading a card twice keeps the latest grade).
-- ---------------------------------------------------------------------------
create or replace function public.merge_study_plan_progress(
  p_application_id uuid, p_cursor jsonb, p_seen_delta jsonb
) returns boolean
language plpgsql
security invoker
as $$
declare v_rows integer;
begin
  update study_plans
     set progress = jsonb_set(
                      jsonb_set(coalesce(progress, '{}'::jsonb), '{cursor}', p_cursor, true),
                      '{seen}',
                      coalesce(progress -> 'seen', '{}'::jsonb) || coalesce(p_seen_delta, '{}'::jsonb),
                      true
                    ),
         updated_at = now()
   where application_id = p_application_id and user_id = auth.uid();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.merge_study_plan_progress(uuid, jsonb, jsonb) to authenticated;
