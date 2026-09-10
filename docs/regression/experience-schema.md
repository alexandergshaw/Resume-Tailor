### R-189 | area: experience-schema | parallel-safe: no | automatable: no

**Summary:** `experience_pages` applies cleanly, isolates users, and cascades a subtree delete.

**Steps:**
1. Apply `hello-world/supabase/migrations/20260812000000_experience_pages.sql` (merge to main runs `.github/workflows/supabase-migrations.yml`, or start it by hand from the Actions tab).
2. Run it a second time and confirm it succeeds again - every statement is written to be idempotent.
3. In the SQL editor confirm: the table exists with all nine columns; `rowsecurity` is true for it in `pg_tables`; four policies exist on it in `pg_policies`; and index `experience_pages_user_parent_position_idx` exists and is NOT unique.
4. As user A, insert a page and a child of it. As user B, select from `experience_pages` and attempt to update user A's row by id.
5. As user A, delete the parent row.

**Expected:** Step 2 succeeds with no error. Step 4 returns zero rows for user B and the update affects zero rows. Step 5 removes the child as well, via `on delete cascade`.

**Why this case is manual:** no test in the repo executes this SQL, so a green `npx vitest run` says nothing about any of it. The index being non-unique is deliberate and load-bearing: a move is applied as several sequential row updates, so two siblings can briefly share a position mid-move, and a unique index would make the order those updates land in decide whether the write succeeds. Do not "tighten" it.

### R-195 | area: experience-schema | parallel-safe: no | automatable: no

**Summary:** `experience_attachments` applies cleanly, isolates users, and cascades from its page.

**Steps:**
1. Apply `hello-world/supabase/migrations/20260812010000_experience_attachments.sql`, then run it a second time and confirm it succeeds again.
2. Confirm RLS is enabled and four owner-scoped policies exist, as for `experience_pages`.
3. As user A, upload an attachment. As user B, attempt to select it by id and attempt to DELETE it by id through the API.
4. As user A, delete the parent PAGE.

**Expected:** Step 3 returns nothing for user B and the delete returns 404, not 403 - 403 would confirm the row exists to someone who cannot see it. Step 4 removes the attachment rows via `on delete cascade`.

**Why manual:** no test executes this SQL, and the ownership-before-storage-delete ordering can only really be proven against a live bucket.

