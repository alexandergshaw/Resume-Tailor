-- Practice answers: the index for practice mode's per-user recording
-- history (D1). Each row is one recorded/analyzed practice answer — the
-- question asked, the posting it was practiced against (denormalized so a
-- later-deleted application still leaves a readable history row), the
-- transcript, C3's delivery metrics, and C4's substance critique. The video
-- clip itself is NOT stored in this table — it lives as an object in the
-- existing `resumes` storage bucket, under `${user_id}/practice/${id}.<ext>`
-- (same bucket/ownership convention as lib/supabase/materials.js). This row
-- is only the pointer to it (`video_path`); a row can also legitimately have
-- no video (browser without MediaRecorder support, or a clip over the size
-- cap) and still be a complete history entry with its transcript, metrics
-- and critique.
--
-- Every text/jsonb column defaults to a not-null empty value so a partial
-- save (e.g. critique failed, or no video) is still a valid row — see
-- lib/supabase/practiceAnswers.js.

create table if not exists public.practice_answers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  application_id  uuid references public.applications (id) on delete set null,
  posting_title   text not null default '',
  posting_company text not null default '',
  question        text not null default '',
  question_type   text not null default '',
  transcript      text not null default '',
  duration_ms     integer,
  video_path      text not null default '',
  video_mime      text not null default '',
  video_bytes     integer,
  metrics         jsonb not null default '{}'::jsonb,
  critique        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- The history list's only query shape: this user's rows, newest first.
create index if not exists practice_answers_user_created_idx
  on public.practice_answers (user_id, created_at desc);

-- Supports `on delete set null` above: without it, every delete from
-- `applications` sequentially scans this whole table to find rows to null
-- out.
create index if not exists practice_answers_application_idx
  on public.practice_answers (application_id);

-- ---------------------------------------------------------------------------
-- RLS + grants: owner-scoped, mirroring the other tailor_* tables (see
-- 20260703000000_tailor_personas.sql).
-- ---------------------------------------------------------------------------
alter table public.practice_answers enable row level security;

drop policy if exists "practice_answers_select_own" on public.practice_answers;
create policy "practice_answers_select_own" on public.practice_answers
  for select using (auth.uid() = user_id);

drop policy if exists "practice_answers_insert_own" on public.practice_answers;
create policy "practice_answers_insert_own" on public.practice_answers
  for insert with check (auth.uid() = user_id);

drop policy if exists "practice_answers_update_own" on public.practice_answers;
create policy "practice_answers_update_own" on public.practice_answers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "practice_answers_delete_own" on public.practice_answers;
create policy "practice_answers_delete_own" on public.practice_answers
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table public.practice_answers to authenticated;
grant all on table public.practice_answers to service_role;
