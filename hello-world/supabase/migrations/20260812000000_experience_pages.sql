-- Professional Experience: the "Notion-like" nested knowledge base of
-- project pages (chunk 1's data contract — see lib/experience/tree.js and
-- app/api/experience/). Each row is one page: a title, a markdown body, and
-- a parent_id that nests it under another page of the same user's, or NULL
-- for a top-level page. `position` is this page's gap-free 0..n-1 rank
-- among its siblings — maintained by lib/experience/tree.js's moveNode and
-- written back through lib/supabase/experiencePages.js, never computed by a
-- query here.
--
-- `foreign key (user_id, parent_id) references experience_pages (user_id,
-- id) on delete cascade`: deleting a page deletes its whole subtree. That is
-- a deliberate, sharp edge — the UI warns before deleting a page with
-- children — chosen over `on delete set null` because an orphaned subtree
-- with no way back to a top-level page would be effectively unreachable
-- clutter, not a page a user could still find and use.
--
-- The FK is composite (user_id, parent_id), not a plain `parent_id
-- references ... (id)`, because foreign-key checks run bypassing row-level
-- security entirely — RLS only guards the query path, not the FK's own
-- lookup. A plain id-only FK would let a client set parent_id to ANY user's
-- page id through PostgREST: the update policy's `with check (auth.uid() =
-- user_id)` constrains user_id, not parent_id. Composite-scoping the FK to
-- (user_id, id) makes a cross-tenant parent_id impossible at the database
-- level rather than merely unlikely. This migration has not yet been
-- applied to production, so editing the table definition in place — rather
-- than a follow-up ALTER migration — is correct.
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch). Every
-- statement below is idempotent, so re-running it over an already-applied
-- migration is safe.

create table if not exists public.experience_pages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  parent_id   uuid,
  title       text not null default '',
  body        text not null default '',
  position    integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Composite reference target for the self-FK below (and for
  -- experience_attachments' page_id FK). `id` alone is already unique via
  -- the primary key, so this adds no new uniqueness — it exists only so a
  -- composite FK can pin BOTH columns at once. See this file's header
  -- comment for why that matters.
  unique (user_id, id),
  -- MATCH SIMPLE (the default) skips the check when any referencing column
  -- is null, so a top-level page's null parent_id remains valid without a
  -- special case.
  foreign key (user_id, parent_id) references public.experience_pages (user_id, id) on delete cascade
);

-- The tree's only query shape: this user's pages, grouped by parent, in
-- position order. Deliberately NOT unique: a move is applied as several row
-- updates (see lib/supabase/experiencePages.js's applyMoves), so two
-- siblings can briefly share a position mid-move — a unique index would make
-- the order those updates land in load-bearing, and it isn't.
create index if not exists experience_pages_user_parent_position_idx
  on public.experience_pages (user_id, parent_id, position);

-- No separate index for the self-referencing FK's cascade is needed here,
-- UNLIKE 20260805000000_practice_answers.sql's practice_answers_application_idx.
-- That FK is single-column (application_id), so its RI trigger predicates on
-- application_id alone and needs an index led by that column specifically.
-- This FK is composite — `foreign key (user_id, parent_id) references
-- experience_pages (user_id, id)` — so its RI trigger predicates on BOTH
-- columns together (`where user_id = $1 and parent_id = $2`), and the
-- composite index directly above already leads with exactly those two
-- columns in that order. A dedicated single-column `(parent_id)` index
-- would never be chosen by that query plan; it would only add write
-- amplification on every insert/update/delete to a table meant to grow. If
-- this FK ever reverts to single-column, practice_answers_application_idx's
-- pattern is the one to bring back — do not add it while the FK stays
-- composite.

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring 20260805000000_practice_answers.sql.
-- ---------------------------------------------------------------------------
alter table public.experience_pages enable row level security;

drop policy if exists "experience_pages_select_own" on public.experience_pages;
create policy "experience_pages_select_own" on public.experience_pages
  for select using (auth.uid() = user_id);

drop policy if exists "experience_pages_insert_own" on public.experience_pages;
create policy "experience_pages_insert_own" on public.experience_pages
  for insert with check (auth.uid() = user_id);

drop policy if exists "experience_pages_update_own" on public.experience_pages;
create policy "experience_pages_update_own" on public.experience_pages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "experience_pages_delete_own" on public.experience_pages;
create policy "experience_pages_delete_own" on public.experience_pages
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.experience_pages to authenticated;
grant all on table public.experience_pages to service_role;
