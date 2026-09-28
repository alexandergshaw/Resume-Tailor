-- N59: persist the generated cover-letter docx bytes so accepted facts
-- survive a reload / version switch. Adds `docx_path` to
-- `generated_cover_letters` (nullable -- every row written before this
-- migration, and any accept whose upload fails, keeps NULL and must
-- degrade to today's refusal, never a crash) and re-issues
-- `accept_application_facts` with a new `p_docx_path` parameter threaded
-- into the cover-letter INSERT.
--
-- The old 7-argument signature is explicitly DROPPED. Re-issuing via
-- `create or replace` alone would leave BOTH signatures resolvable, and a
-- still-deployed 7-arg caller (named-argument call, no `p_docx_path`)
-- would keep silently resolving to the OLD function -- docx_path would
-- never be written, with no error anywhere. `p_docx_path text default
-- null` on the new 8-arg signature means an old 7-arg caller still
-- resolves correctly to the new function during the code-deploy window
-- (the default fills the missing 8th argument), so there is no
-- accept-outage between this migration applying and the app-code deploy
-- that starts passing `p_docx_path`.
--
-- Applied by .github/workflows/supabase-migrations.yml on merges to main
-- that touch this directory.

-- ---------------------------------------------------------------------------
-- generated_cover_letters.docx_path -- the storage path of the spliced
-- engine docx for this version, mirroring generated_resumes' existing
-- docx_path column. Nullable: pre-migration rows, and any accept whose
-- upload failed, have none.
-- ---------------------------------------------------------------------------
alter table public.generated_cover_letters
  add column if not exists docx_path text;

-- ---------------------------------------------------------------------------
-- accept_application_facts: re-issued with p_docx_path. The old 7-arg
-- signature is dropped by its exact argument-type list so Postgres cannot
-- keep an overload of it around.
-- ---------------------------------------------------------------------------
drop function if exists public.accept_application_facts(uuid, integer, jsonb, jsonb, text, jsonb, jsonb);

create or replace function public.accept_application_facts(
  p_application_id uuid,
  p_base_revision integer,
  p_facts jsonb,
  p_removed jsonb,
  p_cover_content text,
  p_cover_lines jsonb,
  p_inserted_facts jsonb,
  p_docx_path text default null
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
    insert into public.generated_cover_letters (user_id, position_id, content, content_lines, inserted_facts, docx_path)
    values (v_user_id, v_position_id, p_cover_content, coalesce(p_cover_lines, '[]'::jsonb), p_inserted_facts, p_docx_path)
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

revoke execute on function public.accept_application_facts(uuid, integer, jsonb, jsonb, text, jsonb, jsonb, text) from public, anon;
grant  execute on function public.accept_application_facts(uuid, integer, jsonb, jsonb, text, jsonb, jsonb, text) to authenticated;
