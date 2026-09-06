-- Recreate, in this repo's migration history, the UNIQUE (user_id,
-- position_id) constraint that ALREADY EXISTS in the LIVE database on
-- public.applications, under the name applications_user_position_key --
-- confirmed by the owner running
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.applications'::regclass;
-- against production and pasting the output.
--
-- NO MIGRATION IN THIS DIRECTORY CREATES THIS CONSTRAINT, OR public.applications
-- ITSELF. `create table public.applications` appears nowhere under
-- supabase/migrations/ (23 files as of this one, grepped) -- the table
-- predates this repo's tracked migration history and was evidently created
-- directly against the database. The only other `(user_id, position_id)` hit
-- anywhere in this directory is drive_documents' PRIMARY KEY in
-- 20260901000000_drive.sql -- a different table, sharing only the two column
-- names. This is the FIRST migration in the repo's history to declare this
-- constraint at all.
--
-- ===========================================================================
-- WHAT BREAKS WITHOUT THIS -- concretely, not "for data integrity"
-- ===========================================================================
--
-- 1. lib/duplicateApply/postingIdentity.js's OWN test suite pins the failure
--    mode. lib/duplicateApply/postingIdentity.test.js, describe block
--    "C-16b -- the precondition boundary (documented, not a defect in this
--    module)", test "[pin] two distinct rows sharing one fallback
--    positions.id, neither carrying independent evidence, diverge from the
--    invariant ...": it builds two application rows for one user that share
--    ONE positions.id and carry no independent posting evidence (no url, no
--    external_id) and proves that, for exactly that pair,
--      samePostingRows(a, b) !== (canonicalPositionKey(a) === canonicalPositionKey(b)
--                                   && canonicalPositionKey(a) !== null)
--    samePostingRows correctly says "different" (a null postingKeyOfPosition
--    never matches, by construction -- irreflexivity). canonicalPositionKey
--    says "same": with no URL/external-id evidence on either side, both rows
--    fall back to the identical `pos:<positions.id>` key. The test's own
--    comment names exactly why this shape is reachable at all: it is
--    "reachable only by violating the stated precondition (two distinct
--    application rows for one user sharing one positions.id)". That
--    precondition is THIS constraint. Hold it, and no two rows for one user
--    can ever share a positions.id, so canonicalPositionKey's `pos:` fallback
--    is never handed two rows that need telling apart -- the divergence is
--    provably unreachable, which is exactly what the test file states and
--    what this migration now makes true. Without it (every database
--    provisioned from this repo's migrations alone, before this file), an
--    ordinary double-insert race can produce that shape for real, and
--    duplicate-apply detection then disagrees with itself about whether two
--    rows are the same posting -- silently, since postingIdentity.js is a
--    pure module with no way to see this constraint, by the test file's own
--    admission.
--
-- 2. lib/supabase/applicationStatusWriter.js:191-193 -- the ONLY code path
--    that inserts a new application row (step C3 of the promote-or-insert
--    sequence documented in that file's header) -- issues:
--      supabase.from("applications")
--        .upsert(payload, { onConflict: "user_id,position_id", ignoreDuplicates: true })
--    Supabase/PostgREST turn `onConflict` into a column-list
--    `ON CONFLICT (user_id, position_id)` clause, and PostgreSQL requires a
--    unique index on EXACTLY that column pair to exist before it will accept
--    that clause at all -- absent one, every insert fails outright with
--    "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification", not a silent no-op. The identical target is asserted
--    against a fake in lib/supabase/applicationStatusGuardWalk.test.js and
--    test/helpers/supabaseFake.test.js. Against a database provisioned from
--    this repo's migrations alone (no such constraint before this file), the
--    very first attempt to record a new application would fail.
--
-- ===========================================================================
-- WHY A GUARDED `alter table ... add constraint`, NOT
-- `create unique index if not exists`
-- ===========================================================================
-- `alter table ... add constraint` has no `if not exists` in PostgreSQL --
-- unlike `add column if not exists` (20260826000000_experience_attachment_text.sql,
-- 20260905000000_application_digest_citation_outcome.sql), there is no
-- idempotent spelling of "add this table constraint" built into the syntax.
-- A bare, unconditional
--   alter table public.applications
--     add constraint applications_user_position_key unique (user_id, position_id);
-- re-run against PRODUCTION, where a constraint of that exact name already
-- lives, raises
--   ERROR: constraint "applications_user_position_key" for relation
--   "applications" already exists
-- which is a hard migration failure. .github/workflows/supabase-migrations.yml
-- runs `supabase db push` on every merge that touches this directory, so that
-- error would block every future, unrelated change to this directory forever.
--
-- This repo already has a working idiom for a genuinely idempotent unique
-- constraint: `create unique index if not exists ...`, used in
-- 20260630000000_tailor_library.sql, 20260702000000_tailor_edit_rules.sql and
-- 20260703000000_tailor_personas.sql. It is deliberately NOT used here.
-- `create unique index if not exists applications_user_position_key on
-- public.applications (user_id, position_id)`, run against a database with no
-- object of that name yet, would create a plain unique INDEX under that name
-- -- it would show up in pg_index/pg_class, but there would be no matching
-- pg_constraint row (contype 'u') for it, ever. Production's actual object,
-- per the owner's pg_constraint query, IS a pg_constraint row. A migration
-- whose entire job is "bring this repo's migrations into line with" that
-- fact should produce the SAME catalog shape everywhere it runs, not a
-- functionally similar substitute that quietly diverges from production on
-- the one database that already has the real thing.
--
-- Does that distinction matter for the thing this migration exists to
-- protect -- the `onConflict: "user_id,position_id"` targets in
-- applicationStatusWriter.js and its test doubles
-- (lib/supabase/applicationStatusGuardWalk.test.js,
-- test/helpers/supabaseFake.test.js)? NO. PostgreSQL's ON CONFLICT
-- column-list inference matches ANY unique index on that exact column set,
-- constraint-backed or bare -- it does not consult pg_constraint at all. A
-- bare `create unique index` would have satisfied every onConflict call site
-- on this table just as well. The constraint-vs-index choice made here is
-- decided purely by fidelity to what production already has, not by any
-- upsert behavioural gap.
--
-- The safe idiom for an otherwise-unconditional `add constraint`, used below
-- for exactly this reason, is to guard it on a catalog read:
--
--   do $$ begin
--     if not exists (select 1 from pg_constraint where ...) then
--       alter table ... add constraint ...;
--     end if;
--   end $$;
--
-- Against production: the IF finds the existing pg_constraint row and the
-- ALTER never runs -- no error, a clean no-op. Against a database with no
-- such constraint (a fresh project provisioned from this directory alone):
-- the IF finds nothing and the ALTER runs exactly once, creating the same
-- named constraint production already has.
--
-- ===========================================================================
-- IF A DATABASE ALREADY HAS VIOLATING ROWS
-- ===========================================================================
-- If some non-production database already holds two application rows
-- sharing one (user_id, position_id) pair -- the exact shape this constraint
-- exists to forbid, and the exact shape postingIdentity.test.js pins as
-- unreachable once it holds -- then `add constraint ... unique (...)` fails
-- with Postgres's own
--   ERROR: could not create unique index "applications_user_position_key"
--   DETAIL: Key (user_id, position_id)=(...) is duplicated.
-- which aborts this migration's transaction and fails the Supabase
-- Migrations workflow. That failure is correct, not a bug to route around:
-- silently succeeding would leave that database materially different from
-- production's real shape, and choosing which of two duplicate rows survives
-- is a product decision this migration has no authority to make (an
-- update/delete is explicitly out of scope; see REQUIREMENTS).
--
-- This migration DOES check for that case ahead of the ALTER, but only to
-- turn Postgres's generic duplicate-key error into an actionable one: the
-- block below runs a read-only pre-check and RAISEs a specific EXCEPTION
-- naming the exact query to find the offending rows, before ever attempting
-- the ALTER. That pre-check is a SELECT -- it reads, it never writes, and it
-- runs ONLY on the branch where the constraint does not already exist, so it
-- costs production nothing (production takes the "already exists" branch and
-- never touches public.applications at all).
--
-- Cannot be verified from this checkout: whether any other database this
-- workflow runs against (a staging or preview Supabase project, if one
-- exists) currently holds violating rows. No database is reachable from here
-- to check directly. If the workflow goes red on this file with the
-- duplicate-key message above, that is this migration doing its job.
--
-- ===========================================================================
-- WHAT THIS DOES NOT TOUCH
-- ===========================================================================
-- No RLS change, no policy change, no grant change. No `drop`, no
-- `alter ... type`, no `update`, no `delete`, no data rewrite of any kind --
-- the only write statement below is the single `add constraint`, and it only
-- runs at all when the constraint is verifiably absent.
--
-- The constraint's NAME is preserved exactly as production has it
-- (applications_user_position_key) on the chance that something references
-- it directly (e.g. `... on constraint applications_user_position_key`, or a
-- future `drop constraint`). Grepped: nothing in this repo does today --
-- every call site found (applicationStatusWriter.js,
-- applicationStatusGuardWalk.test.js, test/helpers/supabaseFake.test.js)
-- targets it as a column list, `"user_id,position_id"`, never by name. There
-- is no cost to matching the name exactly and a real cost to not.
--
-- Note for whoever edits the message text below next: adjacent string
-- literals separated by a NEWLINE are concatenated by Postgres, which is how
-- the long RAISE EXCEPTION message is assembled across several lines; joining
-- two of those fragments onto one line is a syntax error, not a reformat.
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch).

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'applications_user_position_key'
      and conrelid = 'public.applications'::regclass
  ) then

    if exists (
      select 1
      from public.applications
      group by user_id, position_id
      having count(*) > 1
    ) then
      raise exception
        'applications_user_position_key: % distinct (user_id, position_id) pair(s) '
        'already have more than one application row on this database. This '
        'migration will not merge, delete or choose a survivor among them '
        '(additive-only, out of scope; see the header of this file). Resolve '
        'the duplicates by hand, then re-run this migration. Find them with: '
        'select user_id, position_id, count(*) from public.applications '
        'group by user_id, position_id having count(*) > 1;',
        (
          select count(*)
          from (
            select 1
            from public.applications
            group by user_id, position_id
            having count(*) > 1
          ) dup
        );
    end if;

    alter table public.applications
      add constraint applications_user_position_key
      unique (user_id, position_id);

  end if;
end $$;
