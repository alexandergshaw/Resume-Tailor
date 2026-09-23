-- Company facts the candidate ACCEPTED into a cover letter / hiring email
-- (backlog N35). "accepted", never "verified" -- this table only records
-- what the candidate chose to keep; it makes no claim the facts are true.
--
-- public.application_accepted_facts holds ONE row per application: the
-- live set of accepted facts (facts), the removed-fact log (retracted --
-- both retracted and declined entries, so the picker can default a
-- previously-seen card unchecked without re-fetching history), and a
-- revision counter the client uses for optimistic concurrency.
--
-- public.accept_application_facts(...) is the accept path's ONE
-- transaction: it writes the facts row, optionally inserts the new cover
-- letter version and moves applications.cover_letter_id to it, all inside
-- one function invocation so a client never sees the facts move without the
-- served letter moving too (or the reverse). SECURITY INVOKER on purpose --
-- it runs as the calling user, under RLS, so it can only ever do what that
-- user's own policies already allow; it is a convenience for making several
-- statements atomic, not a privilege escalation.
--
-- What this migration cannot verify from this checkout: the live
-- `applications` row-level policies (this repo's migrations do not create
-- `public.applications` at all -- see 20260906000000_applications_user_position_key.sql's
-- own header), and default ACLs. Both are owed as a live check, not
-- something a migration file can prove about itself.
--
-- Applied by .github/workflows/supabase-migrations.yml on merges to main
-- that touch this directory.

-- ---------------------------------------------------------------------------
-- A composite unique key on applications (id, user_id) so a composite
-- foreign key below can require application_accepted_facts.user_id to match
-- the OWNING application's user_id at the database level, not merely by
-- convention in application code. `id` is the primary key, so (id, user_id)
-- is unique by construction and this ALTER can never fail on existing rows.
-- Guarded exactly like 20260906000000_applications_user_position_key.sql's
-- own idempotent idiom (no `if not exists` spelling for `add constraint`).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'applications_id_user_id_key'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_id_user_id_key
      unique (id, user_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- application_accepted_facts: one row per application.
-- ---------------------------------------------------------------------------
create table if not exists public.application_accepted_facts (
  application_id uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  facts          jsonb not null default '[]'::jsonb,
  retracted      jsonb not null default '[]'::jsonb,
  revision       integer not null default 0,
  updated_at     timestamptz not null default now(),
  constraint application_accepted_facts_application_fk
    foreign key (application_id, user_id)
    references public.applications (id, user_id)
    on delete cascade,
  -- Byte caps: `facts` (<=5 entries) measured worst-case at 55,725 B real /
  -- 83,400 B hypothetical -- 131072 leaves >1.5x headroom. `retracted`'s cap
  -- matches the app's own MAX_REMOVED_LOG (20 entries) exactly, with a byte
  -- ceiling ABOVE the app's own eviction budget (98,304 B) rather than below
  -- it -- a cap below the app's own budget would 400 a payload the app
  -- itself considers legal.
  constraint application_accepted_facts_max_bytes
    check (octet_length(facts::text) <= 131072),
  -- design.r2.md:117/120's shape checks, missing from the first version of
  -- this table: `jsonb_array_length` throws (not merely fails a check) on a
  -- non-array jsonb value, so this guards the length checks below it against
  -- a caller who bypasses the route and calls the RPC directly with a
  -- malformed p_facts/p_removed.
  constraint application_accepted_facts_facts_is_array
    check (jsonb_typeof(facts) = 'array'),
  constraint application_accepted_facts_retracted_is_array
    check (jsonb_typeof(retracted) = 'array'),
  -- design.r2.md:118's cap, missing from the first version of this table
  -- (verify.r1.md M4): an accept plans against at most a handful of chosen
  -- research cards, so 5 is the real ceiling the app itself works to --
  -- sanitizeStoredFacts (lib/acceptedFacts/factStore.js) enforces the same
  -- number before the RPC runs, so this is defence in depth, not the first
  -- line.
  constraint application_accepted_facts_max_facts
    check (jsonb_array_length(facts) <= 5),
  constraint application_accepted_facts_max_retracted
    check (jsonb_array_length(retracted) <= 20),
  constraint application_accepted_facts_retracted_bytes
    check (octet_length(retracted::text) <= 131072)
);

alter table public.application_accepted_facts enable row level security;

drop policy if exists "application_accepted_facts_select_own" on public.application_accepted_facts;
create policy "application_accepted_facts_select_own"
  on public.application_accepted_facts for select
  using (auth.uid() = user_id);

drop policy if exists "application_accepted_facts_insert_own" on public.application_accepted_facts;
create policy "application_accepted_facts_insert_own"
  on public.application_accepted_facts for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "application_accepted_facts_update_own" on public.application_accepted_facts;
create policy "application_accepted_facts_update_own"
  on public.application_accepted_facts for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid()
    )
  );

-- No delete policy and no delete grant: retraction is recorded IN the row
-- (the `retracted` log), never by deleting it.
revoke all on table public.application_accepted_facts from anon, authenticated;
grant select, insert, update on table public.application_accepted_facts to authenticated;
grant all on table public.application_accepted_facts to service_role;

-- ---------------------------------------------------------------------------
-- generated_cover_letters.inserted_facts -- which accepted facts (id, text)
-- a saved cover-letter version actually carries, so a later download/Drive
-- save can tell a fact-bearing version from one generated before any were
-- accepted. Nullable: every version before this column existed, and every
-- version this function writes with no facts to record, has none.
-- ---------------------------------------------------------------------------
alter table public.generated_cover_letters
  add column if not exists inserted_facts jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'generated_cover_letters_inserted_facts_bytes'
      and conrelid = 'public.generated_cover_letters'::regclass
  ) then
    alter table public.generated_cover_letters
      add constraint generated_cover_letters_inserted_facts_bytes
      check (octet_length(inserted_facts::text) <= 16384);
  end if;
end $$;

-- design.r2.md:178's array-shape check, missing from the first version of
-- this table (verify.r1.md M4): the byte cap above says nothing about the
-- column actually holding a JSON ARRAY of at most a handful of facts. NULL
-- (every version before this column existed) is exempt, matching the
-- column's own "unknown provenance" meaning.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'generated_cover_letters_inserted_facts_shape'
      and conrelid = 'public.generated_cover_letters'::regclass
  ) then
    alter table public.generated_cover_letters
      add constraint generated_cover_letters_inserted_facts_shape
      check (
        inserted_facts is null
        or (jsonb_typeof(inserted_facts) = 'array' and jsonb_array_length(inserted_facts) <= 5)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- accept_application_facts: the accept path's one transaction. Table names
-- below are schema-qualified throughout (search_path is pinned to empty)
-- since this runs SECURITY INVOKER under the caller's own privileges and
-- RLS, but an empty search_path still stops any object reference here from
-- being redirected by a search_path the caller could otherwise influence.
--
-- p_base_revision null means "no facts row exists yet for this application"
-- (first accept): the INSERT's own ON CONFLICT DO NOTHING is the guard --
-- a concurrent first accept loses the race and reads back the winner's row
-- as a conflict, never overwriting it. p_base_revision non-null means
-- "update the row I last read, only if nobody else moved it since" -- the
-- UPDATE's WHERE carries the same revision check. Either way, a failed
-- write is told apart from a real 0-row update by RETURNING ... INTO a
-- variable that starts null and is only ever set by a row the write
-- actually touched -- never by GET DIAGNOSTICS, which this function
-- reserves for the ONE check that genuinely needs it below (a same-revision
-- update immediately followed by a same-revision no-op DOES exist, but a
-- retried write can only ever be exactly this application's OWN prior
-- write, so replaying the SAME base revision a second time is refused --
-- correctly -- exactly like any other conflict).
--
-- The pointer UPDATE only runs when a cover letter version was actually
-- supplied (p_cover_content is not null) -- an accept that changes only the
-- facts (a pure retract/decline) never touches applications or
-- generated_cover_letters at all, and the caller is told so via a null
-- cover_version_id (app/api/accepted-facts/route.js maps that into
-- versionSaved: false, so a 200 always states truthfully whether the served
-- letter moved with the facts).
create or replace function public.accept_application_facts(
  p_application_id uuid,
  p_base_revision integer,
  p_facts jsonb,
  p_removed jsonb,
  p_cover_content text,
  p_cover_lines jsonb,
  p_inserted_facts jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_position_id uuid;
  v_revision integer;
  v_cover_version_id uuid;
  v_rows integer;
  v_cur_facts jsonb;
  v_cur_retracted jsonb;
begin
  if v_user_id is null then
    raise exception 'accept_application_facts: no authenticated user' using errcode = '42501';
  end if;

  select position_id into v_position_id
    from public.applications
    where id = p_application_id and user_id = v_user_id;

  if not found then
    return jsonb_build_object('status', 'no-application');
  end if;

  if p_base_revision is null then
    insert into public.application_accepted_facts (application_id, user_id, facts, retracted, revision)
    values (p_application_id, v_user_id, coalesce(p_facts, '[]'::jsonb), coalesce(p_removed, '[]'::jsonb), 1)
    on conflict (application_id) do nothing
    returning revision into v_revision;
  else
    update public.application_accepted_facts
      set facts = coalesce(p_facts, '[]'::jsonb),
          retracted = coalesce(p_removed, '[]'::jsonb),
          revision = revision + 1,
          updated_at = now()
      where application_id = p_application_id
        and user_id = v_user_id
        and revision = p_base_revision
      returning revision into v_revision;
  end if;

  if v_revision is null then
    select facts, retracted, revision into v_cur_facts, v_cur_retracted, v_revision
      from public.application_accepted_facts
      where application_id = p_application_id;
    return jsonb_build_object(
      'status', 'conflict',
      'revision', v_revision,
      'facts', v_cur_facts,
      'removed', v_cur_retracted
    );
  end if;

  if p_cover_content is not null then
    insert into public.generated_cover_letters (user_id, position_id, content, content_lines, inserted_facts)
    values (v_user_id, v_position_id, p_cover_content, coalesce(p_cover_lines, '[]'::jsonb), p_inserted_facts)
    returning id into v_cover_version_id;

    update public.applications
      set cover_letter_id = v_cover_version_id
      where id = p_application_id
        and user_id = v_user_id
        and exists (
          select 1 from public.application_accepted_facts f
          where f.application_id = p_application_id and f.revision = v_revision
        );

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'accept_application_facts: pointer update touched % rows, expected 1', v_rows
        using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'revision', v_revision,
    'cover_version_id', v_cover_version_id,
    'facts', coalesce(p_facts, '[]'::jsonb),
    'removed', coalesce(p_removed, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.accept_application_facts(uuid, integer, jsonb, jsonb, text, jsonb, jsonb) from public;
revoke execute on function public.accept_application_facts(uuid, integer, jsonb, jsonb, text, jsonb, jsonb) from anon;
grant  execute on function public.accept_application_facts(uuid, integer, jsonb, jsonb, text, jsonb, jsonb) to authenticated;
