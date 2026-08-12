-- Professional Experience: attachments on a project page - files, images and
-- video that live alongside a page's markdown body (see
-- 20260812000000_experience_pages.sql for the page table itself). Each row
-- points at one object in the EXISTING `resumes` storage bucket, under the
-- key lib/experience/attachments.js's storagePathFor builds
-- (`${user_id}/experience/${page_id}/${id}-${safeName}`) - no new bucket,
-- because that bucket already owner-scopes anything under `${user_id}/...`
-- via the storage policy shared with lib/supabase/materials.js and
-- lib/supabase/practiceAnswers.js. The attachment id is generated on the
-- client with crypto.randomUUID() and used as BOTH this row's id and the
-- token in the storage key, so two attachments with the same original file
-- name can never collide - see storagePathFor's own comment.
--
-- `notes` and `transcript` are both added NOW even though nothing writes
-- `transcript` yet. `notes` is live from day one - it is the attachment's
-- own free-text field, in the user's words, that the AI reads about the
-- file. `transcript` is reserved for chunk 5 (audio/video transcription):
-- adding it in a second migration later would be a statement that does
-- nothing but add a text column, which is pure churn compared to reserving
-- it here alongside its sibling.
--
-- `foreign key (user_id, page_id) references experience_pages (user_id, id)
-- on delete cascade`: deleting a page (or a whole subtree, which cascades
-- from that table's own `on delete cascade`) deletes its attachment ROWS
-- with it. The storage OBJECTS are not swept by this cascade - an orphaned
-- object under an owner-scoped path costs the user nothing to leave behind,
-- the same tradeoff 20260805000000_practice_answers.sql accepts for its own
-- bucket objects, and the app-level delete route
-- (app/api/experience/attachments) removes the object itself before
-- removing a row deleted one at a time.
--
-- The FK is composite (user_id, page_id), not a plain `page_id references
-- ... (id)`, for the same reason given in
-- 20260812000000_experience_pages.sql's header comment: foreign-key checks
-- bypass row-level security, so an id-only FK would let a client attach a
-- row to ANY user's page id through PostgREST, not just their own. This
-- migration has not yet been applied to production, so editing the table
-- definition in place - rather than a follow-up ALTER migration - is
-- correct.
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch). Every
-- statement below is idempotent, so re-running it over an already-applied
-- migration is safe.

create table if not exists public.experience_attachments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  page_id      uuid not null,
  name         text not null default '',
  mime         text not null default '',
  bytes        integer,
  storage_path text not null default '',
  notes        text not null default '',
  transcript   text not null default '',
  created_at   timestamptz not null default now(),
  -- Kept symmetric with 20260812000000_experience_pages.sql's own (user_id,
  -- id) unique constraint even though nothing composite-references this
  -- table yet - `id` alone is already unique via the primary key, so this
  -- adds no new uniqueness, only a ready target if that ever changes.
  unique (user_id, id),
  -- Composite FK: page_id must belong to a page owned by the SAME user_id.
  -- See this file's header comment for why an id-only FK is not
  -- owner-scoped.
  foreign key (user_id, page_id) references public.experience_pages (user_id, id) on delete cascade
);

-- The panel's only query shape: this user's attachments for one page, in
-- upload order. Mirrors the reasoning in
-- 20260812000000_experience_pages.sql's own index comment.
create index if not exists experience_attachments_user_page_idx
  on public.experience_attachments (user_id, page_id);

-- No separate index for the FK's cascade is needed here, UNLIKE
-- 20260805000000_practice_answers.sql's practice_answers_application_idx.
-- That FK is single-column (application_id), so its RI trigger predicates on
-- application_id alone and needs an index led by that column specifically.
-- This FK is composite — `foreign key (user_id, page_id) references
-- experience_pages (user_id, id)` — so its RI trigger predicates on BOTH
-- columns together (`where user_id = $1 and page_id = $2`), and the
-- composite index directly above is exactly those two columns. A dedicated
-- single-column `(page_id)` index would never be chosen by that query plan;
-- it would only add write amplification on every insert/update/delete to a
-- table meant to grow. If this FK ever reverts to single-column,
-- practice_answers_application_idx's pattern is the one to bring back - do
-- not add it while the FK stays composite.

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring 20260812000000_experience_pages.sql.
-- ---------------------------------------------------------------------------
alter table public.experience_attachments enable row level security;

drop policy if exists "experience_attachments_select_own" on public.experience_attachments;
create policy "experience_attachments_select_own" on public.experience_attachments
  for select using (auth.uid() = user_id);

drop policy if exists "experience_attachments_insert_own" on public.experience_attachments;
create policy "experience_attachments_insert_own" on public.experience_attachments
  for insert with check (auth.uid() = user_id);

drop policy if exists "experience_attachments_update_own" on public.experience_attachments;
create policy "experience_attachments_update_own" on public.experience_attachments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "experience_attachments_delete_own" on public.experience_attachments;
create policy "experience_attachments_delete_own" on public.experience_attachments
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.experience_attachments to authenticated;
grant all on table public.experience_attachments to service_role;
