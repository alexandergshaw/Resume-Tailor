### R-167 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** The Job Description tab submits every non-blank posting it holds, each as its own tracked job, capped at three concurrent tailor requests.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/tailor/postingQueue.test.js lib/tailor/runWithConcurrency.test.js app/hooks/useManualPostings.test.js`.
2. Read `app/hooks/useManualPostings.js` and `lib/tailor/runWithConcurrency.js`.
3. In the app, paste three different postings into three boxes and click Generate. Confirm three StatusBar chips appear, each with its own title and company once it finishes, and that the three tailored résumés differ from one another.

**Expected:** Blank and whitespace-only boxes are skipped and never submitted. Each posting is handed a DISTINCT `manual-...` tracked-job id, minted from a counter in `useManualPostings.js`.

**The id is the whole point of this case.** `runWithConcurrency` starts its runners inside a single `.map`, and each async arrow runs synchronously up to its first `await` -- so the original clock-only `manual-<Date.now()>` in `handleManualSubmit` gave all three postings the *same* id, every time, not just under unlucky timing. The cascade from one shared id is silent and total: `setTrackedJobs`'s `prev.some((j) => j.id === syntheticJobId)` creates one tracked job carrying only the FIRST posting's description, three `updateTailoringJob` writes land on one key so the last résumé wins and the other two are destroyed with no error anywhere, `libraryPromptSeenRef` suppresses two of the three library prompts, and `upsertPosition` thrashes a single Supabase row with three different titles. A chip regenerate afterwards then regenerates the wrong posting, because `job.description` is posting #1's. The default id in `app/hooks/useManualTailor.js` also gained a random suffix (matching `app/hooks/useScreenshots.js`) so the same hole is closed for every caller that does not mint its own.

`runWithConcurrency` moved out of `app/page.js` into `lib/tailor/runWithConcurrency.js` and is now shared with `startBatchTailor`, which passes its progress side-effect as the injected `onSettled` callback. Its `limit` is clamped defensively: `Math.max(1, NaN)` is still `NaN` and `new Array(NaN)` **throws**, so the limit is coerced to a number before it is clamped.

### R-168 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** Each posting carries its own outcome, one failure never touches the others, and "Retry failed" re-runs only what failed.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/hooks/useManualPostings.test.js app/components/JobDescriptionTab.test.js`.
2. In the app with several postings queued, make one fail (a posting that trips the engine, or a network failure forced from devtools) and confirm the others still finish.
3. Confirm the failed posting shows its own message on its own card, and that the tab-wide error alert stays empty.
4. Click "Retry failed (1)" and confirm only that posting re-runs, and that the succeeded postings keep their existing tracked jobs rather than generating a second one each.
5. Edit a posting's text after its run and confirm its Ready/Failed pill, its message, and its "Preview documents" button all disappear.

**Expected:** Statuses are `idle` then `pending`, `processing`, and finally `done` or `error`, shown as TEXT ("Queued", "Working...", "Ready", "Failed") through the shared `app/components/StatusPill.js`, never colour alone. A box that has never been run shows no pill at all -- `idle` renders nothing, which is why `StatusPill` gained that case when it was extracted out of `ScreenshotTab`. A posting whose résumé generated but whose cover letter failed stays **done** and shows the message as a warning: the résumé is fine, so it is not a failure.

**Nothing may write the tab-wide error during a queued run.** `tailorPosting` is called with `queued: true`, which suppresses every write to the shared submitting/error state in `useManualTailor.js`. Without it the first of three concurrent postings to settle would re-enable the Generate button for the other two and its error would overwrite everyone else's -- the tab-wide submitting/error are single scalars, and three concurrent writers is exactly what this feature introduced.

`setEntryText` deliberately resets the entry to a fresh idle one (step 5): a Ready badge, a job id, or an error that outlives the text that earned it is a lie about which document belongs to which posting.

### R-169 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** A lone posting still behaves exactly as the single-textarea tab did, and several postings do not fight each other over the preview.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/hooks/useManualPostings.test.js`.
2. With exactly one posting in the tab, click Generate and confirm the document preview opens by itself when it finishes, on the cover-letter tab when a cover letter was produced.
3. With three postings, click Generate and confirm the preview does NOT open by itself, and that each finished card offers "Preview documents" which opens that posting's own documents.
4. With three postings where one failed, click "Retry failed" and confirm the preview still does not open by itself.

**Expected:** `openPreview` is `true` only when `submittableEntries(entries).length === 1` -- computed from every non-blank posting in the tab, not from the size of the current run, which is why step 4's retry-of-one does not pop it open. `useManualTailor.tailorPosting` gates `finishByOpeningPreview` on that flag.

**Not auto-opening costs nothing.** `finishByOpeningPreview` also warms company research; `openResumePreview` -- what the per-card "Preview documents" button calls -- warms it too (`app/hooks/useDocumentPreview.js`), so a queued posting gets its research the moment the user actually looks at it.

`previewEntry` in `useManualPostings.js` is deliberately NOT memoized, exactly like `previewItem` in `app/hooks/useScreenshots.js`: a `useCallback` whose dependency list omitted `tailoringMap` would still pass its test and would ship a preview that always read a stale, usually empty, map.

### R-170 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** Pasted postings survive a reload, and a posting saved by the old single-textarea tab is migrated rather than dropped.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/tailor/postingQueue.test.js app/hooks/useManualPostings.test.js`.
2. Type two postings, reload, and confirm both come back.
3. In devtools, clear `jobPostings`, set the legacy key `jobPosting` to some text, reload, and confirm that text comes back as a single posting.
4. Clear every box, reload, and confirm the legacy text does NOT come back.

**Expected:** Postings are saved under `jobPostings` as a JSON array of the TEXT only -- never a run's status, error, warning, or tracked job id. The legacy `jobPosting` key is read as a fallback and **never written**; `app/hooks/useManualPostings.js` is the only reader or writer of either key.

**The persist effect must not run before the restore effect has landed.** It skips its first commit through a `persistMountedRef`, the same pattern `app/page.js` already uses for `tailoringMapStatus`. Without that guard the mount render's single blank box is written over the saved queue, and on a reload race that is the value the next session reads -- silent, permanent loss of the user's text on the very upgrade the migration exists for. The test asserts EVERY write, not just the final value, because an implementation that writes one empty box and then immediately corrects itself passes a last-value-only check.

The same hazard applied from the other direction: `app/page.js`'s old persist effect for the legacy key fired on mount with an empty string. It, the `jobPosting` state, and its restore lines were all deleted; leaving any of them in would have made whether the migration worked depend on where in `Home()` the hook happened to be called.

### R-171 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** The multi-posting tab is operable and legible without sight, and reports what a run is doing.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/JobDescriptionTab.test.js`.
2. With three postings, tab through the whole panel and confirm every box, the add control, each remove control, Generate, Ask AI, and each "Preview documents" button is reachable with a visible focus ring.
3. With a screen reader, confirm each box announces which posting it is ("Job posting 2") and each remove control announces which posting it removes ("Remove job posting 2").
4. Start a run and confirm the progress is announced, then confirm the outcome ("2 tailored, 1 failed") is announced when it ends.
5. Confirm adding and removing are disabled while a run is in flight.

**Expected:** Every box is named by a real `<label for>` association (the `TextField` gets an explicit `id`), not a placeholder. One `role="status" aria-live="polite"` region, rendered from the start -- a live region only announces content that changes AFTER it exists in the DOM, so adding it lazily when a run begins would announce nothing at all. Status is text, never colour alone (R-168).

A run driven from somewhere else -- a StatusBar chip's "Regenerate" -- also disables this tab's submit control, through `manualTailor.submitting`, but has no queue counters behind it. Both the button and the live region must say "Generating..." in that case, never "Tailoring 0 of 0", which is what they said when this was first written.

**`removePosting` is a no-op while a run is in flight even if called anyway.** The disabled control is not the only guard: removing an entry mid-run would leave its worker patching an entry that no longer exists and desync `completed` from `total`.

### R-173 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** Starting a run from the Job Description tab clears the shared error banner, so a failure that happened somewhere else cannot outlive a run in which everything succeeded.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/hooks/useManualPostings.test.js`.
2. Read the `onRunRequested` prop in `app/hooks/useManualPostings.js` and where `app/page.js` supplies it.
3. In the app, make a StatusBar chip's "Regenerate" fail so the Job Description tab shows an error banner. Then paste a valid posting, click Generate, and let it succeed. Confirm the banner is gone.
4. With no résumé uploaded and the same stale banner showing, click Generate and confirm the banner now reads "Please upload a resume file." rather than the older message.

**Expected:** The tab renders one banner from two sources -- this hook's own guardrail messages and `useManualTailor`'s error, which anything calling the shared manual pipeline can set, including from outside this tab. `onRunRequested` fires after the re-entrancy guard and **before** the blank-posting and missing-résumé guards. The ordering is the point of step 4: the banner prefers the shared error, so clearing it only on a run that PASSES the guards would leave the stale message sitting on top of the guardrail message the user actually needs to read.

**This exists because the first version of the fix was invisible to every gate.** It was written as two wrapper functions in `app/page.js` that cleared the error before delegating to `submitAll`/`retryFailed`. Deliberately deleting that wiring left eslint clean, the whole vitest suite green, and the build passing -- because no test in this repo renders `app/page.js`, and the eslint config does not flag an unused top-level function declaration. The implementing agent reported that honestly rather than claiming coverage. Moving the trigger into the hook as an injected callback is what made it falsifiable: removing the call from `retryFailed` alone now fails a named test.

The general rule, already recorded in the development loop and re-earned here: **when a sabotage catches nothing, move the logic, do not accept the gap.** What remains untestable is only that `page.js` passes the prop at all -- the same irreducible residue every other page.js-to-hook wiring in this repo carries.

### R-174 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** A posting's preview can actually be revised — the preview is opened with the posting text it was tailored against.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/hooks/useManualPostings.test.js app/hooks/useManualTailor.test.js`.
2. Paste two postings, Generate, and click "Preview documents" on one of them.
3. In the preview, type a steering instruction and click Revise. Confirm it runs rather than refusing.
4. Do the same for the "wrong focus" picker, the cover-letter framing, and the persona control.
5. Repeat with a SINGLE posting: let the preview auto-open, close it, reopen it from the card, and revise.

**Expected:** `previewEntry` passes `description: t.jobDescription || entry.text || ""`. The manual pipeline never writes `jobDescription` into `tailoringMap` — only the URL flow and the feed flow do — so reading it alone yields `""` every time. `openResumePreview` stores that as `resumePreview.posting`, and `resubmitDocumentPreview` refuses with *"Couldn't find the job posting to revise against."* when both the posting and the URL are empty, which for a manual job they both are. Company research is warmed with an empty posting for the same reason.

**The asymmetry is what proves it was an oversight rather than a decision:** the StatusBar chip opens the very same preview from a `trackedJobs` entry, which does carry `description`, so that path always worked. Only the queue's own per-card button was broken, and step 5 shows it reached the single-posting case too, the moment the user reopened a preview they had closed.

### R-175 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** A posting that is being tailored cannot be edited out from under its own run.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/JobDescriptionTab.test.js app/hooks/useManualPostings.test.js`.
2. Queue five postings and click Generate. While postings 4 and 5 are still queued, try to edit posting 1's text.
3. Confirm the box is not editable, and that this is also true while a run started from a StatusBar chip is in flight.

**Expected:** The `TextField` carries `disabled={busy}`, and `setPostingText` has the same `runningRef` backstop `removePosting` already had. The field was the ONE control left editable mid-run.

**What made it worse than a stray keystroke:** `setEntryText` deliberately resets an entry to a fresh idle one, so typing cleared the pill mid-run; the in-flight worker then landed `status: "done"`, a job id, a title and a company on the NEW text. The card ended up reading "Ready · Staff Engineer · Acme" with a working "Preview documents" button, describing a document generated from text that was no longer on screen and no longer in localStorage. Blanking a box instead still produced a tracked job, a `positions` row and an `applications` row marked applied, for an empty box showing Ready.

### R-176 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** The tab's busy label reports its own queue's progress and nothing else, and the outcome it announces is the run's, not the boxes'.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/JobDescriptionTab.test.js app/hooks/useManualPostings.test.js`.
2. Run a three-posting queue to completion. Then click "Regenerate" on any `manual-` chip in the StatusBar and read the Generate button and the live region.
3. After a run finishes, edit one of the finished boxes and confirm the announcement does not change while you type.

**Expected:** Two separate props. `running` is the tab's own queue and is the ONLY thing that may show a count; `busy` is `manualTailor.submitting || manualPostings.running` and is what disables controls. The label is `busy ? (running ? "Tailoring N of M…" : "Generating…") : "Generate"`. The announcement comes from `lastRun` — `{ done, failed }` captured when a run ends — never from live `entries`.

**Both halves of this shipped broken and the first fix was inert.** `completed`/`total` are set in `runQueue` and never reset, so after the session's first queue run a chip regenerate read **"Tailoring 3 of 3…"**: a count belonging to finished work, and an assertion that the run was complete while it was still in flight. An earlier fix keyed on `total === 0`, which is only reachable before the first run ever happens — correct-looking, and dead. Separately, deriving the outcome from live `entries` made the polite live region fire *while the user typed*, reporting a shrinking count of boxes rather than the documents the run produced.

### R-177 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** A cover letter that failed is still reported, whichever surface asked for the tailoring.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/hooks/useManualTailor.test.js`.
2. Force `/api/tailor` to return a `coverLetterError` alongside a good résumé.
3. Confirm a queued posting shows it on its own card as a warning and stays **Ready**, and that the tab-wide banner stays empty.
4. Confirm a StatusBar chip's "Regenerate" and the external engine's reviewed-fields Generate both surface it in the tab-wide banner.

**Expected:** The pipeline returns `warning` on an otherwise successful result AND, when `!opts.queued`, still writes it to the tab-wide error exactly as the pre-queue code did.

**Returning it alone was a silent regression.** The two non-queued callers — `handleRegenerateSyntheticJob` and `generateWithReviewedValues` — neither await nor read the return value, and have no surface for a warning. The résumé regenerated, the chip flipped to done, the preview auto-opened, and nothing told the user the cover letter was missing or stale. The sibling URL pipeline still did the old thing, so the two disagreed about the same failure.

### R-178 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** "Retry failed" honours the same guards a first submit does, and a queued run never writes the tab-wide banner.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/hooks/useManualPostings.test.js app/hooks/useManualTailor.test.js`.
2. Run a queue, let one posting fail. Re-pick the résumé file and cancel the dialog so no résumé is loaded, then click "Retry failed".
3. Confirm one tab-wide message, no per-card duplicates, and nothing submitted.

**Expected:** `retryFailed` guards `resumeFile` the way `submitAll` does, and **both** of the pipeline's entry guards gate their `setError` on `!opts.queued`. The guards used to sit above the `queued` check, contradicting the flag's own docblock: every retried posting tripped the guard and wrote the same message into the one shared banner while also showing it inline on its own card.

### R-179 | area: manual-postings | parallel-safe: yes | automatable: yes

**Summary:** The multi-posting tab is navigable and comprehensible without sight, and every control says what it acts on.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/JobDescriptionTab.test.js`.
2. With several finished postings, list the buttons with a screen reader and confirm each preview control names its posting.
3. Tab to a failed posting's box and confirm the failure is announced with it.
4. On the external engine with two boxes filled, tab to "Review & edit fields" and confirm you reach it and hear why it will not act.
5. Remove a posting and confirm focus stays inside the panel.
6. Navigate the postings as a list.

**Expected:**
- Every preview control is `Preview documents for job posting N`. Visible text alone made every finished card's button identical — five cards, five buttons a screen-reader user cannot tell apart.
- Each card's pill, error and warning carry ids, the field's `aria-describedby` points at whichever exist, and `error` is set for a failed posting. Previously a user tabbing to a failed box heard "Job posting 2, edit, multiline" and nothing else; the only failure signal anywhere in the a11y layer was an aggregate live region that named neither the posting nor the reason.
- "Review & edit fields" uses **`aria-disabled` plus a refusing handler, never a real `disabled`** — MUI's `disabled` removes it from the tab order at exactly the moment its explanation appears, so the only people who could not reach the reason were the ones who could not see it. The caption has an id and the button is `aria-describedby` it.
- Focus moves to a neighbouring field after a removal. Going from two boxes to one removes every remove button at once, so there is nothing adjacent left to inherit focus by default and it fell to `<body>`.
- The postings are a real list, so ten cards can be navigated and counted instead of being ten anonymous boxes under no heading.

### R-180 | area: manual-postings | parallel-safe: yes | automatable: no

**Summary:** The tab is usable on a phone, and its explanation text does not drive a button's width.

**Steps:**
1. At 320px with three postings, confirm each posting's box is full width and the remove control sits above it, right-aligned, rather than beside it.
2. Confirm the action row stacks rather than wrapping into ragged mismatched widths.
3. On the external engine with a single **empty** box — the state a freshly-opened tab is in — confirm "Review & edit fields" is the same width as the other buttons.
4. Fill exactly one box and confirm no control changes width as the explanation disappears.
5. Confirm a long unbroken company or role name wraps inside its card instead of overflowing it.

**Expected:** Breakpoint-scoped `flexDirection`, `p` and `gap`, mirroring `app/components/ScreenshotTab.js`, which this tab was modelled on and which had them all along. The explanation sentence renders on its own line below the button row, not inside it.

**Both of these were default states, not edge cases.** At 320px a 40px remove button plus its gap took 48px out of a ~234px card, leaving a textarea about 20 characters wide — roughly 160 characters of a job posting visible in an 8-row box. And because the caption sat inside the button row in a `flex-basis:auto` column, the row sized to the ~95-character sentence: "Review & edit fields" rendered about 500px wide on a fresh external-engine tab and snapped back to ~170px the instant one box became non-blank, reflowing the row mid-typing. This repo has regressed on phone layout three times (R-159, R-164, R-165); the pattern each time was a surface built without a single breakpoint-scoped value.

### R-181 | area: manual-postings | parallel-safe: yes | automatable: no

**Summary:** Known limitations of the multi-posting tab that are accepted, so nobody re-discovers them as bugs.

**Steps:**
1. Read this case before filing any of the below as a defect.

**Expected:** Each of these is real, understood, and deliberately not fixed. All are pre-existing and reachable identically from batch tailoring or the Screenshots tab; the multi-posting tab amplifies rather than introduces them.

- **One `libraryPrompt` slot.** N concurrent postings each call `maybeOfferLibraryUpdate`; the last write wins, and the losers are permanently suppressed for the session because `libraryPromptSeenRef` is written *before* the state write. `LibraryUpdateDialog` is keyed on `promptId`, so a second suggestion arriving remounts it and discards checkboxes the user had already ticked. Same today from `startBatchTailor` and from the Screenshots tab.
- **The preview's job can be swapped mid-revise.** `finishByOpeningPreview` replaces `resumePreview` unconditionally, and the re-entrancy set is keyed by scope only, so a single posting finishing while a revise runs on a different job shows that job's success notice on the new document.
- **No request-id guard on `openSlotReview`'s proposals fetch**, so a stale response merges onto whichever posting is in the slot when it lands.
- **No abort or timeout on `/api/tailor`.** One hung request leaves `running` true, every control disabled, and no cancel — reload is the only escape.
- **The legacy `jobPosting` key is never deleted after migration.** Deliberate: it is the only thing a rolled-back build could read. The cost is that a `jobPostings` value corrupted by something outside the app falls back to text the user has long moved past.
- **Persistence stores text only**, so after a reload previously-Ready boxes come back status-blank — the pill, the role/company line and the Preview button all disappear, though the documents still exist in tracked jobs.
- **A failed attempt leaves its tracked job behind**, and a retry mints a new id rather than reusing it, so repeated retries accumulate dead "Generating from posting…" chips. Each still satisfies the chip's regenerate condition, so one can be re-run concurrently with the queue's own retry of the same text.
- **Positional labels renumber** after a removal: the box a user was just told was "Job posting 3" becomes "Job posting 2" with no announcement.
- **`rows` went 10 → 8** and the field's `name="jobPosting"` attribute is gone.

