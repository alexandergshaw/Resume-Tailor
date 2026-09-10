### R-060 | area: practice-history | parallel-safe: yes | automatable: yes

**Summary:** The practice-answer history table is owner-scoped and shaped so a partial save is still a valid row. The video itself lives in the existing `resumes` bucket, which already owner-scopes `{user_id}/...`, so no new bucket or storage policy exists to get wrong.

**Steps:**
1. Read `hello-world/supabase/migrations/20260805000000_practice_answers.sql`.
2. Compare its conventions against `hello-world/supabase/migrations/20260703000000_tailor_personas.sql`.
3. Read the storage path built in `hello-world/lib/supabase/practiceAnswers.js`.

**Expected:** `user_id` references `auth.users (id) on delete cascade`; `application_id` references `public.applications (id) on delete set null` and has its own index; every text and jsonb column has a not-null default so a critique-less or video-less save is still valid, while `duration_ms` and `video_bytes` are nullable because null honestly means unknown. There is an index on `(user_id, created_at desc)` matching the history query. RLS is enabled with owner-scoped policies for select, insert, update and delete, plus explicit grants. The migration is idempotent. Clips are written to `{userId}/practice/` in the pre-existing `resumes` bucket — no new bucket and no new storage policy are introduced.

### R-061 | area: practice-history | parallel-safe: yes | automatable: yes

**Summary:** Saving an answer never silently loses it, and never claims to have kept a recording it did not keep.

**Steps:**
1. Read `savePracticeAnswer` in `hello-world/lib/supabase/practiceAnswers.js`.
2. Run `npx vitest run --no-file-parallelism lib/supabase/practiceAnswers.test.js` from `hello-world/`.

**Expected:** The storage path and the inserted row id agree, and the extension follows the recorded mime type. With no blob at all the row is still inserted with an empty `video_path` AND a note saying there was no recording, so the caller can tell that apart from a saved video. A blob over the size cap is not uploaded but the rest of the answer is still saved, with the cap reported. An upload failure inserts no row. An insert failure after a successful upload removes the uploaded object, and a cleanup that itself fails is reported rather than leaving a silent orphan. A foreign-key violation on `application_id` is retried once with null, so a posting deleted mid-session never costs the user the whole answer. The generated id is a valid uuid even without `crypto.randomUUID`.

### R-062 | area: practice-history | parallel-safe: yes | automatable: yes

**Summary:** Deleting a saved answer either fully succeeds or leaves the entry intact so it can be retried. The row is the only pointer to the storage object, so deleting it first strands a video the user can never reach again.

**Steps:**
1. Read `deletePracticeAnswer` in `hello-world/lib/supabase/practiceAnswers.js`.
2. Run `npx vitest run --no-file-parallelism lib/supabase/practiceAnswers.test.js` from `hello-world/`.

**Expected:** The storage object is removed BEFORE the row, and the tests assert that ORDER rather than only that both happened. When the object removal fails the row is NOT deleted and the message says the entry was kept and can be retried. An object that is already gone counts as success and the row is still deleted. A row-delete failure after the object was removed is reported and invites a retry. A missing row, another user's row, a missing id and a signed-out caller are each errors, never thrown exceptions.

### R-063 | area: practice-history | parallel-safe: yes | automatable: yes

**Summary:** The history lists the user's own answers, never mints playback links it does not need, and admits when it has truncated.

**Steps:**
1. Read `listPracticeAnswers`, `signedVideoUrl` and `updatePracticeAnswerCritique` in `hello-world/lib/supabase/practiceAnswers.js`.
2. Run `npx vitest run --no-file-parallelism lib/supabase/practiceAnswers.test.js lib/supabase/practiceAnswers.updatePracticeAnswerCritique.test.js` from `hello-world/`.

**Expected:** The list queries the signed-in user's rows newest first with the cap applied, and reports when the cap was hit so the UI can say the history is truncated. Signed out returns an empty list rather than an error. `signedVideoUrl` refuses an empty path instead of minting anything, and is called on demand rather than for every row at list time — the bucket is private, so a public URL is never an option. `updatePracticeAnswerCritique` is scoped to the signed-in user, so a critique that failed and was then successfully retried updates that row rather than leaving it permanently empty, and one user can never patch another's row.

