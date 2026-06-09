-- Auto-Apply Queue: tailored cover-letter storage + queue columns on applications.
-- Applied automatically by the Supabase CLI (`supabase db push`) from CI.
--
-- The daily auto-tailor cron now sources matches from `feed_postings`, tailors
-- BOTH a resume and a cover letter for each newly-matched posting, and parks it
-- in an "auto-apply queue" the user works through one job at a time.

-- ---------------------------------------------------------------------------
-- generated_cover_letters: mirrors generated_resumes, one row per generation.
-- ---------------------------------------------------------------------------
create table if not exists public.generated_cover_letters (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  position_id         uuid references public.positions (id) on delete set null,
  content             text not null,
  content_lines       jsonb default '[]'::jsonb,
  source_resume_path  text,
  additional_context  text,
  created_at          timestamptz not null default now()
);

create index if not exists generated_cover_letters_user_idx
  on public.generated_cover_letters (user_id);
create index if not exists generated_cover_letters_position_idx
  on public.generated_cover_letters (position_id);

alter table public.generated_cover_letters enable row level security;

drop policy if exists "gen_cover_letters_select_own" on public.generated_cover_letters;
create policy "gen_cover_letters_select_own"
  on public.generated_cover_letters for select
  using (auth.uid() = user_id);

drop policy if exists "gen_cover_letters_insert_own" on public.generated_cover_letters;
create policy "gen_cover_letters_insert_own"
  on public.generated_cover_letters for insert
  with check (auth.uid() = user_id);

drop policy if exists "gen_cover_letters_update_own" on public.generated_cover_letters;
create policy "gen_cover_letters_update_own"
  on public.generated_cover_letters for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "gen_cover_letters_delete_own" on public.generated_cover_letters;
create policy "gen_cover_letters_delete_own"
  on public.generated_cover_letters for delete
  using (auth.uid() = user_id);

-- Privileges (RLS already scopes rows; grants are still required for API roles).
grant select, insert, update, delete on table public.generated_cover_letters to authenticated;
grant all on table public.generated_cover_letters to service_role;

-- ---------------------------------------------------------------------------
-- applications: add queue metadata. The new "auto_queued" status marks rows
-- that the cron tailored and parked for one-by-one auto-apply.
-- ---------------------------------------------------------------------------
alter table public.applications
  add column if not exists cover_letter_id uuid references public.generated_cover_letters (id) on delete set null;
alter table public.applications
  add column if not exists auto_search_id uuid references public.saved_searches (id) on delete set null;
alter table public.applications
  add column if not exists auto_saved_at timestamptz;

create index if not exists applications_status_idx
  on public.applications (status);
