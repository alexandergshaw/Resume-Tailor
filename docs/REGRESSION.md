# Regression Suite

The living record of behavior that must keep working. Stage 10 of the development
loop runs this whole document once per group, before that group is pushed.

Rules:

- Acceptance criteria are appended here when a feature clears stage 9. A feature
  is not done until its AC lives in this file.
- Nothing is ever deleted because it became inconvenient. A case is removed only
  when the behavior it describes is deliberately retired, and the removal is
  stated in the commit that removes it.
- A case that cannot be automated still belongs here, marked `automatable: no`,
  with the manual steps written out. Blocked is not the same as passing.

## Case format

Each case is one `###` heading followed by the three labelled blocks. The stage 10
workflow parses this shape, so keep it exact.

`parallel-safe: no` means the case cannot run beside another case: it builds, starts
or restarts a server, writes to a shared output directory such as `.next`, depends on
a specific working-tree state, or mutates files. Read-only inspection and scoped test
runs are `parallel-safe: yes`.

### R-000 | area: example | parallel-safe: yes | automatable: yes

**Summary:** Template case. Copy this shape; do not run it.

**Steps:**
1. Describe the exact command or interaction, not a paraphrase.
2. One numbered step per action.

**Expected:** The observable result, specific enough that a reader can tell a pass
from a fail without judgement calls.

## Cases

### R-001 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** With a tailored resume supplied, the cover letter prompt grounds on it and drops the instruction that steered the model away from the resume's language.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/buildCoverLetterPrompt.test.js`.

**Expected:** All tests pass. The prompt built with a usable `tailoredResume` contains the tailored-resume header and the tailored text, also contains the original resume as background grounding, and does NOT contain the phrase "do not copy phrasing wholesale".

### R-002 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** Without a usable tailored resume, the prompt falls back to the original pre-feature behavior.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/buildCoverLetterPrompt.test.js`.

**Expected:** When `tailoredResume` is undefined, null, or carries only whitespace, the prompt contains the "Source resume (for factual grounding only" header including "do not copy phrasing wholesale", and does not contain the tailored-resume header.

### R-003 | area: cover-letter-structure | parallel-safe: yes | automatable: yes

**Summary:** Sourcing content from the resume must never loosen the letter's structural constraints. This is the guard against the feature silently degrading formatting.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/buildCoverLetterPrompt.test.js`.

**Expected:** In BOTH the tailored and fallback branches the prompt still contains: the exact output-line-count constraint derived from `templateLines.length`, the per-line budget wording "within +/-10%" and "Never exceed +15%.", the blank-template-lines rule, and the JSON-only output shape. The total-character constraint reflects the sum of the template line lengths.

### R-004 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** Client-supplied tailored resume lines take precedence over the resume tailored in the same request. This is what makes cover-only regeneration use the resume you are actually keeping.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/tailor/pickTailoredResume.test.js`.

**Expected:** All tests pass. Non-empty client lines win over a populated resume result; an empty, missing, or non-array client value falls through to the resume result; a null or undefined resume result yields an empty shape rather than throwing.

### R-005 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** The tailored resume text resolver treats unusable input as absent so the caller can fall back.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/resolveTailoredResumeText.test.js`.

**Expected:** All tests pass, including that a whitespace-only `result` falls through to `resultLines` rather than winning, and that `result` takes precedence over `resultLines` when both carry content.

### R-006 | area: cover-letter-grounding | parallel-safe: yes | automatable: yes

**Summary:** The tailoring route wires the tailored resume through to the engine, and the client sends its stored lines only on a cover-only revise. Not covered by unit tests: the client-side form append lives inside a React hook and is verified by inspection here.

**Steps:**
1. Read `hello-world/app/api/tailor/route.js` and locate the `tailorCoverLetter` call.
2. Read `hello-world/app/hooks/useDocumentPreview.js` and locate the `tailoredResumeLines` form append and the `applyCover` definition.

**Expected:** The route passes a `tailoredResume` option built by `pickTailoredResume`. The client appends `tailoredResumeLines` guarded by `applyCover`, and `applyCover` is defined as the cover scope AND not a focus change, so a focus change or a resume-scope revise falls through to the freshly tailored resume instead of stale stored lines.

### R-007 | area: engine-parity | parallel-safe: yes | automatable: yes

**Summary:** The embedded and external engines tolerate the new option without behavior change, and embedded output stays deterministic.

**Steps:**
1. From `hello-world`, run `npx vitest run`.

**Expected:** The full suite passes with no tailor-lite determinism failures. The embedded engine accepts `tailoredResume` via its options object without destructuring it; the external engine's outbound HTTP body is unchanged.

### R-008 | area: headless-tailoring | parallel-safe: yes | automatable: yes

**Summary:** Automated queue tailoring grounds the letter in the resume it just tailored, not a re-extraction of the original upload.

**Steps:**
1. Read `hello-world/lib/feed/tailorAndQueue.js` around the `tailorCoverLetterHeadless` call.
2. Read `hello-world/lib/llm/tailorForUserHeadless.js` for the `tailoredResume` parameter.

**Expected:** `tailorAndQueue.js` passes `tailoredResume` built from the resume draft it generated moments earlier, and `tailorCoverLetterHeadless` accepts and forwards it to the engine.

### R-009 | area: gates | parallel-safe: no | automatable: yes

**Summary:** Project gates are green. Exclusive because the build writes to shared output.

**Steps:**
1. From `hello-world`, run `npx eslint .`
2. From `hello-world`, run `npx vitest run`
3. From `hello-world`, run `npm run build`

**Expected:** eslint reports zero errors and zero warnings. vitest reports at least 816 passing tests with zero failures. The build compiles successfully. Note `tsc --noEmit` is not applicable: this project has `jsconfig.json` and no `tsconfig.json`.

### R-011 | area: preview-concurrency | parallel-safe: yes | automatable: yes

**Summary:** Working on one document must not disable the other. This is the core of per-document concurrency.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/tailor/previewScopes.lockScopesFor.test.js lib/tailor/previewScopes.applyScopeFlags.test.js`.
2. Read `app/components/DocumentPreviewDialog.js` and locate every `disabled=` guard.

**Expected:** Tests pass. The per-scope download and revise controls are gated on `busyActive` (the active tab's own flag), NOT on `anyBusy`. Only the combined download and the both-document operations (focus picker, framing, scan posting) use `anyBusy`.

### R-012 | area: preview-concurrency | parallel-safe: yes | automatable: yes

**Summary:** A finishing operation on one document must not discard uncommitted edits on the other. This was a silent data-loss path.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/tailor/previewScopes.changedScopes.test.js`.
2. Read the `reloadKey` handling block in `app/components/DocumentPreviewDialog.js`.

**Expected:** Tests pass, including that a scope missing from the previous signatures counts as changed. The reload handler clears cached renders and `draftHtmlRef` only for scopes whose content signature actually changed, and only drops out of edit mode when the ACTIVE scope changed.

### R-013 | area: preview-concurrency | parallel-safe: yes | automatable: yes

**Summary:** busy, notice and error are per-scope objects, and no surviving code treats them as scalars. An object is always truthy, so a missed truthiness check would pin a banner open permanently.

**Steps:**
1. From `hello-world`, search `app/hooks/useDocumentPreview.js`, `app/page.js` and `app/components/DocumentPreviewDialog.js` for reads of `busy`, `notice` and `error`.

**Expected:** Every consumer indexes by scope (for example `busy?.[tab]`, `notice?.[tab] || ""`). No bare truthiness test on the whole object exists anywhere.

### R-014 | area: preview-concurrency | parallel-safe: yes | automatable: yes

**Summary:** Re-entrancy guards are ref-based, not render-closure based, so a fast double-click cannot slip through.

**Steps:**
1. Read `resubmitDocumentPreview` and `downloadDocumentPreview` in `app/hooks/useDocumentPreview.js`.

**Expected:** Both guard on `inFlightScopesRef` (a ref, always current), acquire before the first await, and release in a `finally`. Downloads use a `download:` prefixed key so a download and a revise on the same scope are tracked independently and never block each other.

### R-015 | area: preview-ai | parallel-safe: yes | automatable: yes

**Summary:** The Ask AI button opens a chat the user can actually see. ChatPanel sits at z-index 1100 and MUI dialogs default to 1300.

**Steps:**
1. Read the Ask AI handler in `app/components/DocumentPreviewDialog.js` and its wiring in `app/page.js`.

**Expected:** The handler commits any pending edit, then closes the preview, then opens the chat. ChatPanel's z-index is NOT raised globally. The pinned context carries the company, role, which document, the document text, and `sourceJobId` so the existing refresh effect keeps it current.

### R-016 | area: tailoring-metadata | parallel-safe: yes | automatable: yes

**Summary:** A resume-only revise must not null out the cover letter's stored framing metadata. This was a pre-existing bug.

**Steps:**
1. Read the metadata write block near the end of `resubmitDocumentPreview` in `app/hooks/useDocumentPreview.js`.

**Expected:** `focusInfo`, `keywordsInfo`, `personaInfo` and `coverVariantInfo` are each written only when the call actually touched that scope. A resume-only revise leaves `coverVariantInfo` untouched rather than overwriting it with null.

### R-017 | area: persistence | parallel-safe: yes | automatable: yes

**Summary:** Interactively generated cover letters persist. Previously only the automated queue ever wrote a cover letter row, so a browser-generated letter was lost on reload.

**Steps:**
1. Search the repo for callers of `saveGeneratedCoverLetter` and of `persistGeneratedDocuments`.

**Expected:** Every interactive generate path in `app/page.js` persists the cover letter when one was generated, via the shared helper in `lib/supabase/persistGeneration.js`. The helper never writes `docx_path` for cover letters, because `generated_cover_letters` has no such column.

### R-018 | area: persistence | parallel-safe: yes | automatable: yes

**Summary:** Auto-save must never write database rows. It fires on a 600ms debounce while typing; persisting there would create hundreds of rows per session and make the version list unusable.

**Steps:**
1. Read `saveDocumentPreview` in `app/hooks/useDocumentPreview.js` in full.

**Expected:** Its body contains no Supabase client creation, no await, and no call to any persistence helper. Only regenerations persist.

### R-019 | area: persistence | parallel-safe: yes | automatable: yes

**Summary:** The revise path must never write to the positions table. `upsertPosition` is a full-row upsert built for freshly scraped job objects and would null out location, salary, employment type, posted date and raw_data when called with partial preview data.

**Steps:**
1. Search `app/hooks/useDocumentPreview.js` for every access to the `positions` table.

**Expected:** Position access from this hook is read-only (`.select("id").eq("external_id", ...)`). There is no `upsert`, `insert`, `update` or `delete` against `positions` anywhere in the hook, and `upsertPosition` is not imported by it. The four generate flows in `app/page.js` legitimately still call `upsertPosition`, because they hold a complete job object.

### R-020 | area: version-history | parallel-safe: yes | automatable: yes

**Summary:** Version history reads the append-only generation rows by position, newest first.

**Steps:**
1. Read `lib/supabase/documentVersions.js`.

**Expected:** The query selects from `generated_resumes` or `generated_cover_letters` per scope, filters on `position_id`, orders by `created_at` descending, and is capped with the reason documented. It returns an empty array on any error and never throws.

### R-021 | area: version-history | parallel-safe: yes | automatable: yes

**Summary:** Selecting a version restores it as current content without losing in-progress typing, and the choice survives a reload.

**Steps:**
1. Read the version selection handler in `app/hooks/useDocumentPreview.js` and its `onSelect` wiring in `app/components/DocumentPreviewDialog.js`.

**Expected:** The handler flushes the pending auto-save (`commitDraft`) BEFORE switching. Selecting writes the version's content and lines for that scope only, sets that scope's `edited` to false, invalidates only that scope's cached render, and best-effort updates `applications.resume_used_id` or `cover_letter_id` so a reload restores the chosen version. The control is disabled only while its own scope is busy.

### R-022 | area: version-history | parallel-safe: yes | automatable: yes

**Summary:** The version control degrades gracefully rather than showing an empty or broken selector.

**Steps:**
1. Read `app/components/preview/VersionControl.js`.

**Expected:** It renders nothing when there are fewer than two versions. Signed-out and no-position cases resolve to an empty version list upstream without console errors.

### R-023 | area: version-diff | parallel-safe: yes | automatable: yes

**Summary:** Change classification is precise. Over-marking makes the highlight useless, so identical content must produce zero marks.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/document/versionDiff.classifyLineChanges.test.js lib/document/versionDiff.markChangedParagraphs.test.js lib/document/versionDiff.markVersionChanges.test.js`.

**Expected:** All pass, including: identical inputs produce an empty result; an empty previous version produces an empty result (a first version must not mark everything); whitespace-only differences count as unchanged; an inserted line is marked without marking its neighbours; and the input render model is never mutated, with unaffected paragraphs returned by the same object reference.

### R-024 | area: version-diff | parallel-safe: yes | automatable: yes

**Summary:** The shared HTML renderer stays byte-identical for documents with no highlights. Every preview, the combined download and the PDF path all flow through it.

**Steps:**
1. Read the run-style assembly in `renderModelToHtml` in `lib/document/docxPreview.js`.

**Expected:** The highlight entry is a conditional that yields an empty string when `mark` is absent, and the style array is filtered for falsy entries before joining. A model with no marks therefore produces exactly the previous output.

### R-025 | area: version-diff | parallel-safe: yes | automatable: yes

**Summary:** Highlighting never fails silently on hand-edited documents. Those render from saved HTML and bypass the model entirely, so an annotated model would never be built.

**Steps:**
1. Read the highlight enablement logic in `app/components/DocumentPreviewDialog.js` and `app/components/preview/HighlightToggle.js`.

**Expected:** When a scope has saved edited HTML, the toggle is disabled and states why. It does not silently appear active while showing no highlights.

### R-026 | area: file-size | parallel-safe: yes | automatable: yes

**Summary:** The project's 1000-line-per-file cap holds for every file touched by this work.

**Steps:**
1. From the repo root, run a line count over `hello-world/app/components/DocumentPreviewDialog.js`, `hello-world/app/components/preview/*.js`, `hello-world/app/hooks/useDocumentPreview.js`, `hello-world/lib/document/versionDiff.js`, `hello-world/lib/supabase/documentVersions.js`, `hello-world/lib/supabase/persistGeneration.js` and `hello-world/lib/tailor/previewScopes.js`.

**Expected:** Every one is under 1000 lines. Known pre-existing exception: `hello-world/app/page.js` is over 3000 lines and is being reduced by a separate consolidation effort; this work only added minimal prop wiring to it.

### R-027 | area: preview-concurrency | parallel-safe: yes | automatable: yes

**Summary:** Hand edits to one document survive a regeneration of the other. The `edited` flag was entry-wide, so editing the cover letter and then regenerating the resume silently made the cover letter download serve a stale pre-edit document while the preview still showed the edits.

**Steps:**
1. Search the whole repo (`app` and `lib`) for reads of `.edited`.
2. Read the `editedForScope` helper and its callers in `app/hooks/useDocumentPreview.js`, `app/hooks/useCompanyResearch.js`, `app/page.js`, `lib/document/docx.js` and `app/components/StatusBar.js`.

**Expected:** `edited` is a per-scope object `{ resume, cover }`. EVERY read is scope-indexed through a helper; no bare `if (entry.edited)` or `!entry.edited` survives anywhere, because an object is always truthy and a bare check would silently invert behavior. A resume regeneration clears only `edited.resume`; a cover-letter hand edit sets only `edited.cover`; the company-research weave sets only the cover scope. A legacy boolean value is tolerated and read as edited on both scopes, which is the safe direction because it forces a rebuild rather than a stale verbatim serve.

### R-010 | area: cover-letter-quality | parallel-safe: no | automatable: no

**Summary:** End to end, a generated cover letter visibly reflects the tailored resume's emphasis and reads as letter prose rather than restated resume bullets.

**Steps:**
1. Sign in to the running app with a Gemini engine selection and a configured API key.
2. Tailor a resume and cover letter against a real posting.
3. Read the resulting letter against the tailored resume.

**Expected:** The letter's substance tracks the tailored resume's achievements and vocabulary, keeps the template's paragraph count and rhythm, and contains no fabricated employer, title, date, or metric. Requires a human read and a live API key, so it cannot be automated; record the outcome manually when run.

### R-028 | area: hiring-email | parallel-safe: yes | automatable: yes

**Summary:** The hiring email is a third preview scope that is never treated as a .docx. A plain-text scope must never be pulled into the docx build, download, edit, or combine paths, all of which would silently produce a wrong or corrupt document.

**Steps:**
1. Read `hello-world/lib/tailor/documentScopes.js`.
2. Search `hello-world/app` for every use of `SCOPES` and `DOCX_SCOPES`.
3. Read the `canCombine`, `steeringEnabled`, Preview/Edit toggle, file-name row, `EditorToolbar` and Download/Copy branches in `hello-world/app/components/DocumentPreviewDialog.js`, the scope loop in `hello-world/app/components/preview/CombineDocumentsControl.js`, and `buildPreviewBlob` in `hello-world/app/hooks/useDocumentPreview.js`.

**Expected:** `SCOPES` is `["resume","cover","email"]` and `DOCX_SCOPES` is `["resume","cover"]`, defined once in `documentScopes.js` with no duplicate local copies anywhere. Tabs and content availability iterate `SCOPES`. Every docx-producing or docx-editing path iterates or gates on `DOCX_SCOPES`: combine, the Preview/Edit toggle, the editor toolbar, the file-name row, and the revise/steering strip. `buildPreviewBlob("email")` returns null so the email always renders through the plain-text model. The email tab's primary action is Copy, never Download .docx.

### R-029 | area: hiring-email | parallel-safe: yes | automatable: yes

**Summary:** What the email preview displays and what the Copy button puts on the clipboard are the same text. These drifted apart trivially when each side formatted the subject itself.

**Steps:**
1. Read `emailPreviewLines` / `emailPreviewText` in `hello-world/lib/tailor/documentScopes.js`.
2. Confirm the preview render path (`loadPreviewModel` in `app/hooks/useDocumentPreview.js`) and the `copyEmail` handler in `DocumentPreviewDialog.js` both source their text from those helpers.
3. Run `npx vitest run --no-file-parallelism lib/tailor/documentScopes.emailPreviewLines.test.js` from `hello-world/`.

**Expected:** Both the renderer and the copy control go through the shared helpers, neither formats the subject itself. A present subject renders as `Subject: <text>` then a lone blank line then the body; an absent, empty, or whitespace-only subject yields the body alone with no `Subject:` line. A missing entry or a non-array body yields an empty result rather than throwing. The returned array is a copy, never an alias of `entry.emailResultLines`. Tests pass.

### R-030 | area: hiring-email | parallel-safe: yes | automatable: yes

**Summary:** The email is addressed to a hiring committee, matching this repo's cover-letter convention. It previously opened with an unaddressed run-on sentence.

**Steps:**
1. Read `buildHiringEmailText` in `hello-world/lib/llm/engines/tailor-lite/engine.js`.
2. Read `buildHiringEmailPrompt` in `hello-world/lib/llm/tailorResume.js`.
3. Run `npx vitest run --no-file-parallelism lib/llm/engines/tailor-lite/buildHiringEmailText.test.js lib/llm/buildHiringEmailPrompt.test.js` from `hello-world/`.

**Expected:** The embedded builder's `bodyLines[0]` is exactly `Dear Hiring Committee,` as its own line, never merged into the intro sentence, and no line begins with `Hello, `. The sign-off is two lines when a name exists (`Best regards,` then the name alone); one bare `Best regards,` line when no name exists. Every emitted line is non-empty and already trimmed. The Gemini prompt instructs the same salutation as the first body line and a sign-off followed by the candidate's name, while keeping every pre-existing hard constraint: JSON-only output shape, single-line subject, no embedded newlines, and no fabrication. Tests pass.

### R-031 | area: hiring-email | parallel-safe: yes | automatable: yes

**Summary:** The email never claims a capability the candidate's own library cannot back up. Sourcing the claims from the posting alone would fabricate skills.

**Steps:**
1. Read `topMatchingCapabilities` in `hello-world/lib/llm/engines/tailor-lite/engine.js`.
2. Run `npx vitest run --no-file-parallelism lib/llm/engines/tailor-lite/topMatchingCapabilities.test.js` from `hello-world/`.

**Expected:** Returned capabilities are the intersection of the posting's keywords and `candidateUniverse(...)` built from the candidate's own skill groups, so a posting keyword absent from the library is never returned. The `topic` category (RAKE-lite advisory phrases) is excluded. Results are deduplicated, ordered by descending score with a stable alphabetical tiebreak, and capped at the requested limit. Tests pass.

### R-032 | area: hiring-email | parallel-safe: yes | automatable: yes

**Summary:** A failure to generate the email never fails the whole tailoring request, and an engine that cannot produce one degrades quietly. The email is the last of three documents; an unguarded throw here would discard an already-generated resume and cover letter.

**Steps:**
1. Read the `tailorHiringEmail` block in `hello-world/app/api/tailor/route.js`.
2. Read `tailorHiringEmail` in `hello-world/lib/llm/engines/externalEngine.js` and the registry comment in `hello-world/lib/llm/engines/index.js`.
3. Read the `emailResultLines` guard in the post-payload hook in `hello-world/app/hooks/useDocumentPreview.js`.

**Expected:** The route calls `tailorHiringEmail` only when the active engine implements it, wraps the call in try/catch, and on error records `emailError` and returns the resume and cover letter normally. The external engine resolves to null rather than throwing, and a null draft leaves the email fields empty rather than crashing. On a revise or focus change, an empty `emailResultLines` in the response never wipes a previously generated email; only a non-empty array replaces it.

### R-033 | area: hiring-email | parallel-safe: yes | automatable: yes

**Summary:** The email scope does not break the preview controls that assume a docx-backed document with saved version history.

**Steps:**
1. Read the `VersionControl` and `HighlightToggle` render conditions in `hello-world/app/components/DocumentPreviewDialog.js`, and the early returns in both components under `hello-world/app/components/preview/`.
2. Read `lockScopesFor` and `changedScopes` in `hello-world/lib/tailor/previewScopes.js`.
3. Confirm switching tabs resets the editor mode.

**Expected:** With no saved versions for the email scope, `VersionControl` returns null (fewer than two versions) and `HighlightToggle` returns null (no previous version), so neither renders a broken control on the email tab. `lockScopesFor` never returns `email`, since the email is regenerated with the documents rather than revised on its own. Changing tabs sets the mode back to `view`, so edit mode cannot leak onto the read-only email tab.

### R-034 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** The interviewer's audio source is selectable, and anything unrecognized degrades to the browser-tab path rather than throwing. Tab sharing was the only source before this option existed, so an unrecognized value must never break a session that used to work.

**Steps:**
1. Read `THEM_CAPTURE_BY_SOURCE` and the `CopilotSession` constructor in `hello-world/lib/copilot/session.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/session.test.js` from `hello-world/`.

**Expected:** `source: "system"` selects `captureSystemAudio`; `source: "tab"`, an omitted `source`, and an unrecognized value all select `captureTabAudio`. The constructor never throws on a bad source. The "them" source is still captured before the mic prompt, so its picker appears first.

### R-035 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** System-audio capture requests the constraints Chrome actually needs, and fails with instructions specific to that path. A generic or tab-worded error here sends the user to the wrong checkbox in the share dialog.

**Steps:**
1. Read `captureSystemAudio` in `hello-world/lib/copilot/capture.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/capture.test.js` from `hello-world/`.

**Expected:** `getDisplayMedia` is called with `systemAudio: "include"`, `monitorTypeSurfaces: "include"`, and a `monitor` `displaySurface`, plus the shared raw-signal audio constraints (echoCancellation, noiseSuppression and autoGainControl all false). When the granted stream has no audio track, EVERY track is stopped before throwing, so no share indicator is left lit, and the thrown message names "Entire Screen" and "Share system audio" and states honestly that Chrome cannot capture system audio on macOS.

### R-036 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** Adding the system-audio option did not change tab capture. Tab sharing is the default and the only path that works on macOS, so a silent change here would break the majority path.

**Steps:**
1. Read `captureTabAudio` and the shared `DISPLAY_AUDIO_CONSTRAINTS` / `requireAudioTrack` helpers in `hello-world/lib/copilot/capture.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/capture.test.js` from `hello-world/`.

**Expected:** `captureTabAudio` still requests `video: true` (Chrome will not grant tab audio without a video track) with the same three raw-signal audio constraints, and still throws the tab-specific message naming a browser tab and "Share tab audio" -- not the system-audio wording. The two capture paths share one constraints constant and one no-audio-track guard so they cannot drift apart.

### R-037 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** The source control cannot change under a running session, and the choice survives a reload. Switching source mid-session would leave the UI describing a source the live Deepgram streams are not using.

**Steps:**
1. Read the `ToggleButtonGroup`, `onSourceChange`, the `SOURCE_STORAGE_KEY` seeding effect, and the `shareInstructions` text in `hello-world/app/copilot/CopilotClient.js`.
2. Confirm `source` is passed to `new CopilotSession(...)` and is in the `start` callback's dependency array.

**Expected:** The control is disabled whenever status is `live` or `connecting`. `onSourceChange` ignores a null value (an exclusive ToggleButtonGroup emits null when the active button is clicked again), so the selection can never be cleared. The choice is stored under `copilot-audio-source`, which is a different key from `copilot-prep-context`; reads and writes are wrapped in try/catch and an unrecognized stored value falls back to `tab`. The instructional paragraph names Entire Screen and "Share system audio" for the system option and the meeting tab for the tab option.

### R-038 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** Session teardown and failure semantics are unchanged by the new source option. The mic has always been optional and the interviewer source fatal; inverting either would either kill working sessions or leave a session silently transcribing nothing.

**Steps:**
1. Read `start`, `_addSource` and `stop` in `hello-world/lib/copilot/session.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/session.test.js` from `hello-world/`.

**Expected:** A failure of the "them" capture (tab or system) rejects out of `start()` and is fatal. A mic failure is soft: it reports through onError and the session continues with interviewer audio only. Each source still gets its own PcmPipeline and DeepgramStream, which is what provides speaker separation without diarization. The first audio track of every source still gets an "ended" listener so the browser's native "Stop sharing" tears the session down.
