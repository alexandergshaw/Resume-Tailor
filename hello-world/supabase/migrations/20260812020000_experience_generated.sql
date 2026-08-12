-- Professional Experience: two nullable columns marking a page as
-- SYSTEM-GENERATED rather than written by hand (see
-- 20260812000000_experience_pages.sql for the table itself). Chunk 9's
-- research report — a child page created under the researched project,
-- titled "Research: <title> (<YYYY-MM-DD>)" — is the first writer of these.
-- No new table: the report is an ordinary experience_pages row, which is
-- what keeps it editable, searchable, and reachable by everything else this
-- feature already does with a page. `generated_kind` names what produced
-- the page ('research' for now — room for more later without another
-- migration); `generated_at` is when.
--
-- Both start out null, and stay null forever for the overwhelming majority
-- of rows: a plain page a user typed by hand. Nullable rather than
-- `not null default ''`/`default now()` is the point, not an oversight — a
-- non-null default would silently relabel every EXISTING page, and every
-- page any OTHER future writer creates without knowing about this column,
-- as "generated". A null pair reads as exactly what it is: nobody has
-- claimed authorship of this row besides the user who typed it.
--
-- Applied by .github/workflows/supabase-migrations.yml, which runs
-- `supabase db push` on merges to main that touch this directory, and can
-- also be started by hand from the Actions tab (workflow_dispatch). Every
-- statement below is idempotent, so re-running it over an already-applied
-- migration is safe.

alter table public.experience_pages
  add column if not exists generated_kind text,
  add column if not exists generated_at timestamptz;
