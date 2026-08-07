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

**Expected:** `getDisplayMedia` is called with `systemAudio: "include"`, `monitorTypeSurfaces: "include"`, and a `monitor` `displaySurface`, plus the shared raw-signal audio constraints (echoCancellation, noiseSuppression and autoGainControl all false). When the granted stream has no audio track, EVERY track is stopped before throwing, so no share indicator is left lit. When the shared surface was the whole screen, the thrown message names "Entire Screen" and "Share system audio" and states honestly that Chrome cannot capture system audio on macOS. The other surfaces get their own wording -- see R-039.

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

### R-039 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** When system-audio capture yields no audio, the error names the mistake the user actually made. `displaySurface: "monitor"` is advisory per spec and cannot restrict the picker, so the user can still land on a window or a tab -- and the original message told every one of them to tick a "Share system audio" checkbox that Chrome never shows for those surfaces.

**Steps:**
1. Read `readDisplaySurface`, `buildSystemAudioMessage`, `SYSTEM_AUDIO_MESSAGES_BY_SURFACE` and `requireAudioTrack` in `hello-world/lib/copilot/capture.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/capture.test.js` from `hello-world/`.

**Expected:** The video track's `getSettings().displaySurface` is read BEFORE any track is stopped, since a stopped track's settings may be cleared. A `window` surface produces a message saying a window share carries no system audio on Windows and to pick "Entire Screen" instead, and it must NOT tell the user to turn on a "Share system audio" checkbox. A `browser` surface produces a message pointing at this app's own "Browser tab" interviewer-audio option. A `monitor` surface, an unrecognized surface, a missing `getSettings`, a `getSettings` that throws, a stream with no video track, and a stream that does not implement `getVideoTracks` at all ALL fall back to the whole-screen wording rather than raising a TypeError. In every one of these failure cases every granted track still has `stop()` called exactly once.

### R-040 | area: practice-capture | parallel-safe: yes | automatable: yes

**Summary:** Practice mode captures the candidate's own camera and mic, and a camera failure degrades to microphone-only without blaming the wrong device. `getUserMedia` is atomic, so a combined request also rejects when the MICROPHONE is the problem, and the old wording blamed the camera for that.

**Steps:**
1. Read `captureCameraAndMic` and the shared `MIC_AUDIO_CONSTRAINTS` in `hello-world/lib/copilot/capture.js`.
2. Read `start()` in `hello-world/lib/copilot/practiceSession.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/capture.test.js lib/copilot/practiceSession.test.js` from `hello-world/`.

**Expected:** `captureCameraAndMic` requests 720p-ideal front-facing video plus the processed mic constraints, and `captureMicAudio`'s own argument is unchanged by the extraction of that shared constant. A granted stream with no audio track has every track stopped before a microphone-specific error is thrown. The soft "Camera unavailable (...). Continuing with microphone only." warning is emitted ONLY after the mic-only fallback actually succeeds; when the fallback also fails, the ORIGINAL combined-request error propagates and no camera-blaming warning is emitted.

### R-041 | area: practice-capture | parallel-safe: yes | automatable: yes

**Summary:** A Stop that lands while the session is still connecting leaves nothing running. Without the guard this leaked a billed Deepgram socket and a live AudioContext, and repainted the UI as live with the session unreachable.

**Steps:**
1. Read `start()` and `stop()` in `hello-world/lib/copilot/practiceSession.js`, specifically where `_dg` and `_pipeline` are assigned relative to their awaits and where `_stopped` is re-checked.
2. Run `npx vitest run --no-file-parallelism lib/copilot/practiceSession.test.js` from `hello-world/`.

**Expected:** `_dg` and `_pipeline` are assigned to the instance BEFORE their `connect()` / `start()` are awaited, and `_stopped` is re-checked after every await. A `stop()` during the Deepgram handshake, and a `stop()` during the AudioWorklet load, each end with the socket closed, the pipeline stopped, every track stopped, and a final status of `idle`. A late `open` arriving after teardown never repaints the status to `live` — every callback forwarded from the socket is swallowed once `_stopped` is set.

### R-042 | area: practice-capture | parallel-safe: yes | automatable: yes

**Summary:** A Deepgram socket that closes on its own tears the capture down for real. Reporting `idle` while the camera and mic kept running left the user with a lit camera indicator and no Stop button.

**Steps:**
1. Read the `onStatus` handler passed to `DeepgramStream` in `hello-world/lib/copilot/practiceSession.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/practiceSession.test.js` from `hello-world/`.

**Expected:** An unsolicited `closed` while the session is running calls `stop()`, so every track is stopped and the status reaches `idle` — it is not a cosmetic status change. A `closed` arriving as a result of the app's own `stop()` does not recurse. The video track's `ended` listener flips `hasVideo` false and re-publishes through `onStream` WITHOUT stopping the session, since audio-only is a valid state; the audio track's `ended` listener does tear the session down.

### R-043 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** `PcmPipeline` closes an AudioContext whose worklet load was interrupted by a concurrent stop. This affects the LIVE interview path as well as practice mode — before the fix, any Stop racing the module load leaked a running AudioContext for the life of the page.

**Steps:**
1. Read `PcmPipeline.start()` and `PcmPipeline.stop()` in `hello-world/lib/copilot/capture.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/capture.test.js lib/copilot/practiceSession.test.js lib/copilot/session.test.js` from `hello-world/`.

**Expected:** `this.ctx` is assigned immediately after the AudioContext is constructed, BEFORE `addModule` is awaited, so a concurrent `stop()` always has something to close. `start()` re-checks its stopped flag after that await and returns without building the node graph when it is set, so `createMediaStreamSource` is never called on a closed context and no spurious error surfaces to a user who pressed Stop. The flag resets at the top of `start()` so the instance stays reusable.

### R-044 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** The live interview session can never be stranded by leaving its view. The mode toggle keys off the session's existence rather than its status, because `status === "error"` leaves a `CopilotSession` holding the screen share and mic while the UI already shows "Start session".

**Steps:**
1. Read `onModeChange` and the unmount-cleanup effect in `hello-world/app/copilot/CopilotClient.js`.
2. Confirm the mode `ToggleButtonGroup` ignores a null value and is disabled while the live session is running.

**Expected:** Switching to practice mode stops any existing live session first, keyed on `sessionRef.current` existing rather than on `status`. Unmounting `CopilotClient` (switching main tabs in `app/page.js`) also stops the session, mirroring `PracticeClient`. Nothing about the audio-source toggle, the `copilot-audio-source` storage key, the share-instruction wording, the `CopilotSession` wiring or the question/answer flow is changed by this — R-034 through R-039 all still hold.

### R-045 | area: practice-postings | parallel-safe: yes | automatable: yes

**Summary:** The practice posting picker offers exactly the rows the Tracking table shows, and a failed load is never reported to the user as an empty account.

**Steps:**
1. Read `fetchPracticePostings` and `normalizePostingRows` in `hello-world/lib/copilot/postings.js`, and compare the query against `loadApplications` in `hello-world/app/page.js`.
2. Read the `noOptionsText` and helper-text branches in `hello-world/app/copilot/practice/PostingPicker.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/postings.test.js` from `hello-world/`.

**Expected:** The query is `applications` joined to `positions`, filtered to the signed-in user, excluding statuses `tracking` and `auto_tailored`, ordered by `applied_at` descending. Rows with no joined position, or with neither a title nor a company, are dropped; duplicates on title+company collapse case-insensitively keeping the newest; a row with a missing or unparseable `applied_at` is still included and merely sorts last. Signed out returns an empty list without querying, while an auth-lookup error and a query error are each thrown so the picker can show them. When the load fails, the dropdown says the load failed — it must NOT say the user has no tracked postings.

### R-046 | area: practice-questions | parallel-safe: yes | automatable: yes

**Summary:** The deterministic question bank is genuinely deterministic, never empty, and never repeats a question the session already asked.

**Steps:**
1. Read `buildQuestionBank` and `nextPracticeQuestion` in `hello-world/lib/copilot/practiceQuestions.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/practiceQuestions.test.js` from `hello-world/`.

**Expected:** No `Math.random`, no `Date`; the same posting and asked-list always yield the same next question and the same wording. The bank is non-empty for a null, undefined, empty or whitespace-only posting. Technical questions are built from terms extracted from the posting's own description, falling back to a generic technical set when nothing is extractable. Types interleave rather than grouping. Dedupe runs through `normalizeQuestion`, tolerates non-strings and empty entries in the asked list, and a fully consumed bank returns exactly `{ question: "", type: "general", exhausted: true }`.

### R-047 | area: practice-questions | parallel-safe: yes | automatable: yes

**Summary:** The question route serves all three engine paths without ever dead-ending a practice session, and its asked-list cap keeps the questions most likely to be repeated.

**Steps:**
1. Read `app/api/copilot/question/route.js` in `hello-world/`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/question/route.test.js` from `hello-world/`.

**Expected:** No signed-in user returns 401 with "Sign in to use the interview copilot.". The embedded engine answers from the deterministic bank with `source: "embedded"` and never constructs a Gemini client. A Gemini throw, an unparseable response, an empty question, or a question duplicating one already asked all fall back to the bank and report `source: "fallback"` — never a 5xx, and never silently. `sanitizeAsked` keeps the MOST RECENT entries at the cap, not the first ones, and the anti-repeat comparison truncates the candidate the same way the stored entries were truncated. The response shape is identical across all three paths.

### R-048 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** An answer contains the words the candidate actually spoke between Start and Done — bounded by AUDIO time, not by when the transcript happened to arrive. Bounding by arrival time dropped the closing sentence of every answer and attributed pre-Start speech to it.

**Steps:**
1. Read `isFinalInAnswerWindow` and `deriveSpeechSpan` in `hello-world/lib/copilot/answerWindow.js`.
2. Read the `start`/`duration` passthrough in `hello-world/lib/copilot/deepgram.js` and the drain in `doneAnswer` in `hello-world/app/copilot/practice/usePracticeAnswer.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/answerWindow.test.js lib/copilot/deepgram.test.js` from `hello-world/`.

**Expected:** A final whose audio start precedes the answer's start offset is excluded. While the end offset is still null — the answer is in progress or draining — a final at or after the start offset is included, which is what catches the last sentence still in flight when Done is pressed. `doneAnswer` does not close the window synchronously; it drains for a bounded period so a lost socket can never hang the UI. `deepgram.js`'s `start` and `duration` are additive: the pre-existing `speaker`, `transcript`, `isFinal` and `speechFinal` fields are unchanged in name and value, non-Results frames and empty transcripts are still ignored, and the live copilot path is unaffected.

### R-049 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** Pace is computed over the span the words actually cover, not the button-to-button wall clock, and no delivery number is ever `NaN` or `Infinity`.

**Steps:**
1. Read `computeAnswerMetrics` in `hello-world/lib/copilot/answerMetrics.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerMetrics.test.js` from `hello-world/`.

**Expected:** `wordsPerMinute` is derived from `speechDurationMs`, not from the wall-clock `durationMs`; both are reported, and the UI shows them as separate rows so they are never conflated. Zero, missing or negative durations produce 0 wpm rather than Infinity or NaN, and empty text returns zeros throughout. `hasMetric` delegates to `profileMetric` rather than duplicating the regex, and `micMuted` is carried through so the review can say the mic was off.

### R-050 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** A camera the candidate switched off is reported as off, not measured as a dark, motionless shot. The Camera control sets `track.enabled = false`, which leaves the track in the stream emitting black frames.

**Steps:**
1. Read `isTrackActive`, the sampling guard, and how `hadVideo` and `partiallyOff` are derived in `VideoFrameSampler` in `hello-world/lib/copilot/videoStats.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/videoStats.test.js` from `hello-world/`.

**Expected:** Sampling is skipped while the video track is disabled or muted, and `hadVideo` is derived from whether any VALID sample was captured — not from track presence. A camera off for the whole answer reports `hadVideo: false` and produces no lighting or steadiness claim at all. A camera off for part of the answer sets `partiallyOff`, which the review states, while the valid samples still produce honest numbers. No sample is taken while the offscreen video reports zero dimensions or a readyState below HAVE_CURRENT_DATA.

### R-051 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** A measurement flag that is false for lack of data is never presented as a finding. This is the difference between "we measured it and it was fine" and "we could not measure it".

**Steps:**
1. Read `summarizeVideoStats` and the `MIN_LUMA_SAMPLES` / `MIN_MOTION_SAMPLES` gates in `hello-world/lib/copilot/videoStats.js`.
2. Read `buildDeliveryNotes` and `computeDeliveryScore` in `hello-world/lib/copilot/critiqueLocal.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/videoStats.test.js lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** Empty or missing input returns `frames: 0`, `motionSamples: 0` and every flag false with no NaN. `veryStill` and `fidgety` cannot fire below the motion-sample gate — a single-sample answer must never claim the candidate was very still. `tooDark` and `tooBright` cannot fire below the luma gate. No lighting claim is emitted without luma samples and no steadiness claim without motion samples, and no visual claim of any kind when `hadVideo` is false. When nothing about delivery was measurable, the delivery component is excluded and the remaining weights renormalized rather than scored zero and blamed in the verdict.

### R-052 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** Filler counting does not overstate. Ambiguous words are counted separately from true fillers, and no filler matches inside a larger or hyphenated word.

**Steps:**
1. Read `FILLER_PHRASES`, `DISCOURSE_MARKER_PHRASES` and `phraseRegex` in `hello-world/lib/copilot/answerMetrics.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerMetrics.test.js` from `hello-world/`.

**Expected:** Um, uh, er, "you know", "sort of", "kind of" and "I mean" count as fillers. Like, right, actually, basically and literally are counted and displayed SEPARATELY as discourse markers that may be legitimate usage — they are not folded into the filler count. "unlike" never counts "like" and "right-hand" never counts "right": the boundary handling excludes letters, digits and hyphens on both sides. `fillerRate` is per 100 words and is 0 when there are no words.

### R-053 | area: practice-answer | parallel-safe: yes | automatable: yes

**Summary:** The replay recorder never blocks answering and never mixes one answer's video into another's clip.

**Steps:**
1. Read `pickSupportedMimeType` and the `AnswerRecorder` class in `hello-world/lib/copilot/answerRecorder.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerRecorder.test.js` from `hello-world/`.

**Expected:** With `MediaRecorder` missing or no supported mime type, `start()` is a no-op and `stop()` resolves null — replay is a bonus and its absence never blocks answering or the metrics. `stop()` ALWAYS settles: with a Blob on the stop event, and with null when unsupported, when nothing was recording, when no chunks arrived, or when the guard timeout elapses first. Each recording's `dataavailable` listener is bound to its OWN chunk array, so a chunk flushed late by a previous recorder cannot land in the next answer's clip. `stop()` is safe twice and without a matching `start()`; a throwing constructor or `start()` degrades to the no-op path.

### R-054 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** The critique response contract is enforced by the server on every path, and the engine that produced a critique is reported truthfully.

**Steps:**
1. Read `sanitizeCritique`, `sanitizeStar` and the branch structure in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** `source` is always set by the server from the path actually taken and is never read from the model, so a Gemini response claiming `source: "embedded"` cannot survive. `star` is null unless the question type is behavioral, on both paths. The score is clamped to an integer 0-100 and the arrays are capped, so no unexpected field from the model reaches the client. The response shape is identical across the embedded, Gemini and fallback paths.

### R-055 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** The critique never dead-ends and never leaks camera frames to a path that should not have them.

**Steps:**
1. Read the `wantsEmbedded` branch, `sanitizeFrames`, and the fallback handling in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** No signed-in user returns 401. The embedded engine returns the deterministic critique, never constructs a Gemini client, and never parses frames at all. Frames reach Gemini only on the non-embedded path, and a non-JPEG data URL, a payload that is not decodable base64, a non-string entry, and anything past the third frame are all dropped. A Gemini throw, an unparseable response, and malformed client metrics all still return a usable critique rather than a 5xx — inputs are normalized once, before either branch, so the fallback cannot fail the same way the primary did.

### R-056 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** The deterministic rubric — what a no-API-key deploy runs — states nothing about the candidate's answer that it did not measure, and never contradicts itself.

**Steps:**
1. Read `RESULT_PHRASE_RE` / `RESULT_METRIC_RE`, `SITUATION_RE`, `TECH_TRADEOFF_RE`, `structureStrengthText`, the posting-overlap term matching, and the relevance boilerplate filter in `hello-world/lib/copilot/critiqueLocal.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** A quantified result is detected anywhere in a sentence — "Support tickets fell by 40% after the change." and "It generated $250,000 in new revenue." both set the result beat. "A complete STAR story" is claimed only when all four beats are present, never alongside a `missing` entry naming an absent beat. "I looked at the logs" does not credit a Situation beat, and a bare "however" or "although" does not credit a trade-off. Posting-vocabulary overlap matches on word boundaries with a minimum canonical length, so short taxonomy entries cannot match inside unrelated words and manufacture a strength. Interview-question boilerplate is stripped before relevance overlap, so a directly responsive answer is not told it drifted. The rubric is fully deterministic — identical inputs give an identical score AND identical wording — and the score stays an integer within 0-100 for an empty answer, a one-word answer, a 2000-word answer and an all-filler answer. An empty answer returns a low score, an honest verdict, empty strengths, and asserts nothing about prose that does not exist.

### R-057 | area: practice-privacy | parallel-safe: yes | automatable: no

**Summary:** The practice screen never tells the candidate their camera data stays local while it is being uploaded, and consent for frames is read at send time rather than latched.

**Steps:**
1. Read `framesWillUpload`, `privacyNotice` and `onRetryCritique` in `hello-world/app/copilot/practice/PracticeClient.js`.
2. Read `runCritique` and `retryCritique` in `hello-world/app/copilot/practice/usePracticeAnswer.js`, noting what `lastCritiqueInputsRef` does and does not hold.
3. Read the practice-mode description in `hello-world/app/copilot/CopilotClient.js`.

**Expected:** The frames opt-in defaults to off and is disabled on the embedded engine. Frames are read from the retained frame ref at SEND time using the current opt-in, and are deliberately not part of the cached retry inputs — so turning the switch off and pressing Retry sends no frames.

**Narrowed (group H):** this case now covers ONLY the frames opt-in and the retry-reads-at-send-time guarantee, above. Its original Expected also asserted the whole privacy notice, and three of those clauses have since been deliberately retired by later features, leaving this case unsatisfiable at the same time as R-064 and R-081:

- "audio to Deepgram always" was retired by the pluggable-STT work; R-081 now requires the notice to name whichever provider the server actually selected, and to name none before that is known.
- "the recorded replay clip is never uploaded under any setting" was retired by the save-recordings feature; R-064 requires the notice to state the Supabase upload when saving is on.
- "No wording promises the video stays in the browser while frames are in flight" reads as false against the current wording, which discloses the still frames in one sentence and the clip staying local in the next — two independent destinations, deliberately worded so neither implies anything about the other.

R-064 is this case's successor for notice truthfulness and enumerates the same guarantees against the current three-control matrix. Retiring those clauses here, rather than deleting the case, keeps the frames-consent guarantee — the part nothing else covers — under test.

### R-058 | area: practice-critique | parallel-safe: yes | automatable: no

**Summary:** The shared prep context behaves like one value across both copilot views, and a deliberate deletion sticks.

**Steps:**
1. Read `usePrepContext` in `hello-world/app/copilot/usePrepContext.js`, specifically the listener store, the fallback latch, and how a stored empty string is distinguished from a never-written key.
2. Confirm `CopilotClient` wraps the setter only to clear its answer cache, and that the cache-clearing logic is not inside the hook.

**Expected:** The `/api/user-context` fallback runs at most once per mount and is not re-fired by the stored value changing, so clearing the textarea does not silently refill it from the account's saved context. The hook is a real external store — a module-level listener set, a subscribe that registers and unregisters, and a setter that notifies after writing — so an edit in practice mode is immediately visible to the live view mounted alongside it, and neither can overwrite the other with a stale value. Storage access stays wrapped in try/catch and the live path keeps the same storage key, the same fallback and the same answer-cache clearing on edit.

### R-059 | area: practice-answer | parallel-safe: yes | automatable: no

**Summary:** No browser resource outlives the answer that created it. Every abandonment path finalizes the recorder and the sampler, and exactly one replay object URL exists at a time.

**Steps:**
1. Read `abandonInProgressAnswer`, `resetAnswerState`, the object-URL handling, and the generation guard in `hello-world/app/copilot/practice/usePracticeAnswer.js`.
2. Confirm every caller — posting change, next question, try again, session stop, the session's own unsolicited teardown, and unmount — goes through them.

**Expected:** Changing the posting, moving to the next question, retrying, stopping the session, an unsolicited teardown, and unmounting all finalize an in-progress answer: the sampler interval and its offscreen video are released, the recorder is stopped, and the pending drain is resolved rather than left hanging. The replay object URL is revoked before a new one replaces it and on every discard path. Post-await writes are dropped when their captured generation is stale, so a finished answer's review cannot land under a different question. The mic-muted flag is seeded from the current switch state at answer start, not only from a toggle fired mid-recording.

### R-060 | area: practice-history | parallel-safe: yes | automatable: yes

**Summary:** The practice-answer history table is owner-scoped and shaped so a partial save is still a valid row. The video itself lives in the existing `resumes` bucket, which already owner-scopes `${user_id}/...`, so no new bucket or storage policy exists to get wrong.

**Steps:**
1. Read `hello-world/supabase/migrations/20260805000000_practice_answers.sql`.
2. Compare its conventions against `hello-world/supabase/migrations/20260703000000_tailor_personas.sql`.
3. Read the storage path built in `hello-world/lib/supabase/practiceAnswers.js`.

**Expected:** `user_id` references `auth.users (id) on delete cascade`; `application_id` references `public.applications (id) on delete set null` and has its own index; every text and jsonb column has a not-null default so a critique-less or video-less save is still valid, while `duration_ms` and `video_bytes` are nullable because null honestly means unknown. There is an index on `(user_id, created_at desc)` matching the history query. RLS is enabled with owner-scoped policies for select, insert, update and delete, plus explicit grants. The migration is idempotent. Clips are written to `${userId}/practice/` in the pre-existing `resumes` bucket — no new bucket and no new storage policy are introduced.

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

### R-064 | area: practice-privacy | parallel-safe: yes | automatable: no

**Summary:** The practice screen's privacy notice is true in every combination of the three independent controls, and consent is read at send time rather than latched.

**Steps:**
1. Read `privacyNotice`, `framesWillUpload`, the save switch and `onRetryCritique` in `hello-world/app/copilot/practice/PracticeClient.js`.
2. Read `persistAnswer` and `runCritique` in `hello-world/app/copilot/practice/usePracticeAnswer.js`, noting how the save preference and the frames opt-in are each read.
3. Read the practice-mode description in `hello-world/app/copilot/CopilotClient.js`.

**Expected:** The save switch defaults on and the frames opt-in defaults off; they are independent controls with independent wording, and neither implies the other's behavior. The notice names every real destination for the current settings: audio to whichever transcription provider the server actually reports, and to none before that is known (R-081 owns that clause in full); on the Gemini engine the answer transcript, posting details and prep context to Google, plus up to three still frames only when the frames switch is on; the video to the user's own account storage only when saving is on, private to them and deletable from the history. Nothing anywhere still claims the video never leaves the browser while saving is enabled. Both the frames opt-in and the save preference are re-read immediately before the corresponding request, so turning either off mid-flight prevents that upload — neither is latched at Done.

**Amended (group I):** the audio clause previously read "audio to Deepgram always". The pluggable-STT work retired that: the provider is a server-side choice and must be named only once known. R-057 had already been narrowed for the same reason but this case's own Expected was missed, leaving two cases in this document contradicting each other about the same sentence. Corrected here rather than deleted, since everything else this case pins is still live.

### R-065 | area: body-language | parallel-safe: yes | automatable: yes

**Summary:** The on-device body-language models are served locally and the vendored runtime's telemetry never leaves the browser. An on-device feature that phones home is not on-device.

**Steps:**
1. Read `hello-world/public/mediapipe/models/README.md` and `hello-world/scripts/copy-mediapipe.mjs`.
2. Read the model and wasm paths, and `isMediaPipeTelemetryUrl` plus the fetch guard, in `hello-world/lib/copilot/bodyLandmarks.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/bodyLandmarks.test.js` from `hello-world/`.

**Expected:** The `.task` model files are committed under `public/mediapipe/models/` and loaded from that local path; the wasm runtime is staged from the installed package by the copy script rather than committed, so it stays version-locked, and the script asserts the exact files it must produce. No model or wasm is fetched from any CDN at runtime, and the build needs no network access. `@mediapipe/tasks-vision` 1.0.1 ships a telemetry POST to `odml.pa.googleapis.com` with no working opt-out (`enableLogging` is in its type definitions but absent from the shipped bundle), so a scoped guard answers that host locally; `isMediaPipeTelemetryUrl` matches that exact hostname and does NOT match look-alike hosts that merely contain it as a substring or subdomain prefix. The README records the model versions, hashes, licence and re-fetch commands.

### R-066 | area: body-language | parallel-safe: yes | automatable: yes

**Summary:** Posture measurements are geometrically correct. Level shoulders read as level, and the same physical pose measures the same regardless of how close the person sits or what aspect ratio the camera has.

**Steps:**
1. Read `postureFrom` and its threshold constants in `hello-world/lib/copilot/bodyLanguage.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/bodyLanguage.test.js` from `hello-world/`.

**Expected:** Landmark 11 is the subject's ANATOMICAL left shoulder, which in the unmirrored frame the sampler feeds MediaPipe sits at the LARGER image x. Perfectly level shoulders therefore must report a tilt near 0 and never near 180 — the tests build the fixture unmirrored and assert this explicitly, because the original implementation reported 180 for a level sitter and, since the true signal sat on atan2's branch cut, averaged a real wobble down to a fabricated 0. Tilt is symmetric with opposite signs when the lower shoulder swaps sides. Slouch is scale-invariant across distance from the camera, and tilt and slouch are aspect-ratio corrected so a 4:3 and a 16:9 frame agree. Shoulder tilt and lean depend only on the shoulder landmarks — a nose below the visibility threshold may null slouch alone.

### R-067 | area: body-language | parallel-safe: yes | automatable: yes

**Summary:** No body-language figure is reported unless enough of the answer was actually visible. A percentage computed over a handful of detected frames is not a measurement of the answer.

**Steps:**
1. Read `summarizeBodyLanguage`, `MIN_COVERAGE_RATIO` and the per-signal sample minimums in `hello-world/lib/copilot/bodyLanguage.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/bodyLanguage.test.js` from `hello-world/`.

**Expected:** An aggregate is null when the frames that produced it fall below `MIN_COVERAGE_RATIO` of ALL sampled ticks, not merely when an absolute count is unmet — a face detected in a handful of hundreds of ticks yields no confident percentage. Every derived value is null rather than 0 or false below its minimum, and the reported sample counts match the samples actually used. Head-movement deltas are taken only between genuinely consecutive ticks, so a gap where the camera was off or the face was lost does not manufacture movement. A fresh summary object is returned per call. Empty, single-sample and all-invalid input produce no NaN or Infinity anywhere.

### R-068 | area: body-language | parallel-safe: yes | automatable: no

**Summary:** The sampler reports why it could not measure, rather than reporting nothing as if it were a measurement of stillness.

**Steps:**
1. Read `BodyLanguageSampler` in `hello-world/lib/copilot/bodyLandmarks.js`: the failure reasons, the track-active check, the overrun guard, the model cache and `stop()`.
2. Read how `AnswerReview` renders the unavailable state and `partiallyOff`.

**Expected:** Each distinct failure — no camera, camera off, model load failed, no frames, not ready, inference failed, no samples — is reported as its own machine-readable reason, never swallowed into a silent zero. `hadVideo` derives from whether any VALID sample was captured, not from track presence, so a camera switched off for the whole answer reports as off rather than as a dark, motionless shot; a camera off for part of it sets `partiallyOff`, which the UI states. Sampling is skipped while the track is disabled or muted, and while the offscreen video reports zero dimensions or an insufficient readyState. A tick that overruns the interval is skipped rather than queued. The landmarkers are cached across answers, per-answer state is not, a failed load closes what it constructed and retries are bounded, and `stop()` is safe without `start()`, twice, and immediately after `start()`.

### R-069 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** Body-language feedback actually reaches the user. It is appended to a capped list, so without a reserved slot it is silently deleted and the panel then declares it unavailable for an answer that was measured and scored.

**Steps:**
1. Read `buildDeliveryNotes` in `hello-world/lib/copilot/critiqueLocal.js` and `sanitizeCritique` in `hello-world/app/api/copilot/critique/route.js`, specifically how the body-language line is budgeted against `MAX_LIST`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueLocal.test.js app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** On the embedded path, an answer with a fully measured body-language summary AND a mic-muted note still returns the body-language note — the other notes are capped to `MAX_LIST - 1` first. On the Gemini path, a model response carrying a full set of delivery items PLUS a body-language line still delivers the body-language line. The body-language line has its own longer length clamp so a fully measured note is not truncated mid-sentence and does not lose its final fact. The note is identifiable by a prefix that tolerates common variants without double-prefixing.

### R-070 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** Turning the camera off costs the user nothing. An unmeasurable component is excluded and the weights renormalised, never scored zero and blamed.

**Steps:**
1. Read `computeBodyLanguageScore` in `hello-world/lib/copilot/critiqueBodyLanguage.js` and how `computeDeliveryScore` in `hello-world/lib/copilot/critiqueLocal.js` consumes it.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueBodyLanguage.test.js lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** `computeBodyLanguageScore` returns null, not zero, when nothing was measurable. An answer given with the camera off scores identically to an otherwise identical answer that never had a camera, asserted by comparing composite scores rather than internals. The composite stays an integer within 0-100 across no summary, an all-null summary, camera off and fully measured. The too-close and too-far framing penalties scale with their ratios rather than being flat deductions, and lean is scored in exactly one place rather than penalised twice.

### R-071 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** Every body-language sentence claims exactly what was measured and nothing more. This feature tells a person things about their own body, so the vocabulary is a correctness property.

**Steps:**
1. Read `buildBodyLanguageFacts`, `bodyLanguageDeliveryNote` and `normalizeBodyLanguage` in `hello-world/lib/copilot/critiqueBodyLanguage.js`, and `bodyLanguageInstruction` in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueBodyLanguage.test.js` from `hello-world/`.

**Expected:** A null aggregate produces no sentence at all, in either direction — it never becomes praise and never becomes criticism. Head orientation is described as facing the camera and never as eye contact, gaze or attention. Percentages state the visible-face denominator rather than implying whole-answer coverage, and `partiallyOff` adds a coverage caveat. Face fill is described as the face, not the person filling the frame. Hands out of frame is reported as not measured, never as stillness. No fact is emitted whose rounded percentage reads as 0. Ratios and angles are clamped, so a malformed client summary cannot print impossible values into either the user-facing note or the facts block sent to Gemini as ground truth. No emotion, confidence, nerves, personality or appearance vocabulary appears anywhere, including in the model instruction, which also forbids commenting on a signal absent from the supplied facts.

### R-072 | area: bl-feedback | parallel-safe: yes | automatable: yes

**Summary:** The model cannot manufacture body-language content out of nothing, and the response contract is unchanged for existing consumers.

**Steps:**
1. Read `sanitizeCritique` and the `allowBodyLanguage` gate in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** When nothing was measured and no frames were sent, body-language content is dropped from the WHOLE delivery channel — not merely from the dedicated field — so a model that writes it into `delivery` instead cannot bypass the gate. The measured facts are supplied to the model as ground truth it is told not to contradict. The response still carries exactly its established key set, `source` is still set by the server from the path actually taken, `star` is still null unless the question is behavioral, the score is still clamped to an integer 0-100, and the embedded path still never constructs a Gemini client and never parses frames.

### R-073 | area: bl-feedback | parallel-safe: yes | automatable: no

**Summary:** The feedback panel says who actually looked at the video, and why body language is missing when it is.

**Steps:**
1. Read the provenance caption and the unavailable state in `hello-world/app/copilot/practice/AnswerFeedback.js`.
2. Read what `PracticeClient` passes it, specifically the frames-sent boolean and the body-language reason.

**Expected:** The caption keys on whether frames were ACTUALLY sent, not on which engine ran. With the frames opt-in off — the default — the Gemini path reads the same as the embedded path: measured numbers only, nobody reviewed the video. The Gemini-failed-and-fell-back case does not claim a visual review either. When body language is unavailable the panel states the specific reason carried from the sampler rather than a generic message, and never hides the section silently or renders empty rows. The panel's body-language feedback is distinct from the raw measurements `AnswerReview` shows on the same screen, and the two never contradict each other.

### R-074 | area: copilot-config | parallel-safe: yes | automatable: yes

**Summary:** The copilot can open a session on a deploy with no Gemini key. Transcription is independent of the LLM, so requiring an LLM key to mint a transcription token was a coupling bug that made the whole copilot unusable on a keyless (embedded-engine) deploy.

**Steps:**
1. Read `getDeepgramApiKey` in `hello-world/lib/config/env.js` and confirm it does not go through `REQUIRED_SERVER_KEYS`.
2. Read `app/api/copilot/token/route.js` and confirm the order of the auth check and the configuration check.
3. Run `npx vitest run --no-file-parallelism lib/config/env.test.js app/api/copilot/token/route.test.js` from `hello-world/`.

**Expected:** With `Gemini_LLM_API_Key` unset and the selected provider's key set, a signed-in POST mints a token successfully — before the fix this returned a 500 and no session could start. `getServerEnv()` itself is unchanged and still throws when the Gemini key is missing, because its other callers depend on that. An unauthenticated request returns the existing 401 EVEN when the provider is unconfigured, so an anonymous caller cannot probe the deployment's configuration; only a signed-in caller can learn that a provider key is unset.

### R-075 | area: stt-abstraction | parallel-safe: yes | automatable: yes

**Summary:** Speech-to-text sits behind a documented provider contract, and exactly one short-lived credential is minted per stream. ElevenLabs tokens are single-use and consumed on use, so a second fetch is not merely wasteful.

**Steps:**
1. Read the contract comment and `createSttStream` in `hello-world/lib/copilot/stt/index.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/index.test.js lib/copilot/stt/token.test.js lib/copilot/stt/deepgram.token.test.js` from `hello-world/`.

**Expected:** `createSttStream` fetches exactly ONE token per call and threads both the resolved provider and that token into the constructed instance — assert the call count, not merely that it worked. An explicit provider argument forces that choice; an omitted or unrecognized provider name resolves to Deepgram rather than throwing, so a bad value degrades to today's behavior. A token fetch that fails still returns a usable Deepgram instance with no injected token, leaving `connect()` to surface the real error rather than failing at selection time. A provider constructed directly with no token still fetches its own, which is what keeps `deepgram.test.js` valid.

### R-076 | area: stt-abstraction | parallel-safe: yes | automatable: yes

**Summary:** Both copilot session types construct their transcription stream through the abstraction, and Deepgram's wire behavior is unchanged by the move.

**Steps:**
1. Confirm `lib/copilot/session.js` and `lib/copilot/practiceSession.js` both obtain their stream from `createSttStream` rather than constructing a provider directly.
2. Read `lib/copilot/stt/deepgram.js` and compare its connection parameters against what the live copilot used before the refactor.
3. Run `npx vitest run --no-file-parallelism lib/copilot/session.test.js lib/copilot/practiceSession.test.js lib/copilot/stt/deepgram.test.js` from `hello-world/`.

**Expected:** Deepgram keeps the same listen URL, the same query parameters (model, encoding, sample_rate, channels, interim_results, smart_format, punctuate, endpointing), the same `["token", <token>]` subprotocol, the same non-Results frame filtering, the same empty-transcript skip, the same `start`/`duration` passthrough and the same `CloseStream` flush on close. `PracticeSession` still assigns its stream reference BEFORE awaiting `connect()`, so the stop-during-connect guards from R-041 still hold. The session tests pass with their assertions unchanged — that is the evidence the refactor preserved behavior, and any rewording of them would destroy it.

### R-077 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** The ElevenLabs provider speaks the documented wire protocol, including the fields the service requires but the copilot's own pipeline knows nothing about.

**Steps:**
1. Read `connect()` and `send()` in `hello-world/lib/copilot/stt/elevenlabs.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js` from `hello-world/`.

**Expected:** The socket is opened with `model_id=scribe_v2_realtime`, `audio_format=pcm_16000`, `include_timestamps=true`, `commit_strategy=vad` and the token. `send()` accepts the same 16 kHz mono PCM16 `ArrayBuffer` every caller already passes, base64-encodes it into `audio_base_64`, and sends `message_type: "input_audio_chunk"` with `sample_rate: 16000` and `commit: false` — `commit` is documented as required, and `false` is the correct value under a VAD commit strategy where the server decides utterance boundaries. The base64 round-trips the original bytes exactly, including 0x00 and 0xFF and across the internal encode-loop boundary. Nothing is sent when the socket is not open.

### R-078 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** The ElevenLabs transcript mapping, which is where this provider silently succeeds or silently corrupts everything downstream.

**Steps:**
1. Read the message-type switch and the span derivation in `hello-world/lib/copilot/stt/elevenlabs.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js` from `hello-world/`.

**Expected:** `partial_transcript` maps to isFinal false / speechFinal false; `final_transcript` and `final_transcript_with_timestamps` map to isFinal true / speechFinal FALSE; `committed_transcript` and `committed_transcript_with_timestamps` map to isFinal true / speechFinal TRUE. That last mapping is the one that makes live-mode question detection work at all — under `commit_strategy=vad` a commit IS the end-of-utterance signal, the role Deepgram's `speech_final` plays — so it is asserted directly rather than incidentally. `start` and `duration` derive from the `words` array using only entries whose `type` is `word`, excluding spacing and audio-event entries. When there is no usable `words` array, BOTH are `undefined` and never a fabricated 0: `answerWindow.js` reads undefined as "no timing available", so a 0 would silently corrupt every practice-mode delivery number without ever throwing. Empty or whitespace-only text is skipped, and `session_started` and `committed_transcript_entities` never reach `onTranscript`.

### R-079 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** The tripwire for the wire format differing from the documentation. This provider was implemented against published docs and has never been exercised against the live service, so a protocol mismatch must announce itself rather than presenting as a session that transcribes nothing.

**Steps:**
1. Read the error handling and the unknown-message-type reporting in `hello-world/lib/copilot/stt/elevenlabs.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js` from `hello-world/`.

**Expected:** Every documented error `message_type` routes to `onError` with a useful message and is not treated as unrecognized. An UNRECOGNIZED `message_type` is reported through `onError` exactly ONCE per session, naming the type — it must fire, and it must not spam once per message. An abnormal socket close surfaces through `onError` in addition to `onStatus("closed")`, while a close initiated by the module's own `close()` does not. The module carries a comment recording that it was written against documentation rather than verified against the live service, so the provenance of its assumptions is legible to the next reader.

### R-080 | area: copilot-config | parallel-safe: yes | automatable: yes

**Summary:** Provider selection is a server decision, misconfiguration names the provider actually selected, and asking which provider is live costs nothing.

**Steps:**
1. Read `getSttProvider` and `getElevenLabsApiKey` in `hello-world/lib/config/env.js`.
2. Read both the `GET` and `POST` handlers in `app/api/copilot/token/route.js`.
3. Run `npx vitest run --no-file-parallelism lib/config/env.test.js app/api/copilot/token/route.test.js` from `hello-world/`.

**Expected:** `STT_PROVIDER` selects the provider; unset, empty or unrecognized values resolve to Deepgram, so today's deploys are unaffected. `GET` returns `{ provider }` only — it mints nothing and makes no outbound provider call, which is the entire reason it exists: learning the provider name for the consent notice must not burn a single-use credential on every page view. `GET` is auth-gated exactly like `POST`, with auth ahead of configuration. `POST` mints from the selected provider, sending `xi-api-key` to the ElevenLabs single-use-token endpoint on that path. When the selected provider's key is unset the response is a 503 naming THAT provider and THAT environment variable, and it never silently falls back to the other provider.

### R-081 | area: copilot-privacy | parallel-safe: yes | automatable: no

**Summary:** The copilot tells the user which transcription service actually receives their audio, rather than a hardcoded name.

**Steps:**
1. Read how the provider display name is obtained and used in `hello-world/app/copilot/CopilotClient.js`.
2. Read the privacy notice construction in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** The destination name is derived from the provider the server reports, not hardcoded to either vendor. Before the provider is known the notice omits the destination clause entirely rather than guessing or naming a placeholder. The engine clause, the camera-frames clause and the save-recordings clause are independent of this and unchanged. The provider probe uses the non-minting GET, so simply opening the copilot does not consume a transcription credential.

### R-082 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The sample answer shown for a practice question is keyed to that exact question, and revealing one never starts a duplicate request underneath one already in flight.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerState.test.js`.

**Expected:** All tests pass. `activeSampleAnswer` returns the empty state whenever the stored draft's question differs from the question on screen — this derivation, not any explicit reset call, is what clears the panel on Next question, a posting change and a fresh Start. `needsRedraft` always redrafts on force and from the idle/error states, NEVER redrafts while a request for the same question is loading, and from the done state redrafts only when the prep context, the interview type, or the selected application has changed since the draft was built.

### R-083 | area: sample-answer | parallel-safe: yes | automatable: no

**Summary:** The sample-answer toggle is available in every phase where a question is on screen, and never displays a draft belonging to a question that is no longer showing.

**Steps:**
1. Read the `SampleAnswer` render condition and the action row in `hello-world/app/copilot/practice/QuestionCard.js`.
2. Read `hello-world/app/copilot/practice/SampleAnswer.js`.

**Expected:** The toggle renders whenever a question is present AND no next-question request is in flight, and is never disabled by `answering` or `settling` — so it works before answering, while recording, while settling, and after the answer is done. It does not render at all when there is no question, nor while `loading` is true (the guard against the previous question's draft sitting under a "Getting your next question" spinner). Regenerate appears only when a draft is actually displayed; the error state offers Retry instead.

### R-084 | area: interview-type | parallel-safe: yes | automatable: yes

**Summary:** The interview-type registry is the single frozen source of truth, and its `general` descriptor is behaviour-preserving.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/interviewTypes.test.js`.

**Expected:** All tests pass. `normalizeInterviewType` maps null, undefined, empty string, non-strings and unrecognized values to `general` and never throws; `interviewType` always returns a descriptor. Seven entries with unique values; every `questionGroups` entry and every expectation `cue` is drawn from its fixed vocabulary; every `lengthTarget` has `minWords` below `maxWords`. The `general` descriptor is pinned to `questionGroups` exactly behavioral/technical/role, `lengthTarget` exactly 80-220 words, and an empty `expectations` list. Those three pins are the contract that keeps every consumer's default behaviour identical to what it was before interview types existed.

### R-085 | area: interview-type | parallel-safe: yes | automatable: yes

**Summary:** The interview type selects which question groups a practice session draws from, and omitting it reproduces the original bank exactly.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/practiceQuestions.test.js`.

**Expected:** All tests pass. `buildQuestionBank(posting)` with no interview type equals `buildQuestionBank(posting, "general")` for a posting with a description, a posting without one, and no posting at all. A phone-screen bank draws only role questions; a behavioral bank only behavioral ones; a system-design bank includes the system-design group. Every bank, whatever the type, still opens with the opening question and closes with the closing question. Output is deterministic across repeated calls, and `nextPracticeQuestion` still dedupes via `normalizeQuestion` and still reports `exhausted:true` with an empty question once a type-scoped bank is drained.

### R-086 | area: interview-type | parallel-safe: yes | automatable: yes

**Summary:** The answer critique judges against the selected format's bar, and is unchanged for the default.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/critiqueLocal.test.js app/api/copilot/critique/route.test.js`.

**Expected:** All tests pass. `critiqueAnswerLocal` with no interview type, and with "general", both produce the pre-feature output. Otherwise the descriptor's `lengthTarget` replaces the old fixed 80-220 window, so the same answer scores differently under a phone screen than under system design. Each unmet expectation cue appends its note to `missing` (a system-design answer naming no trade-off is told to name one; an answer that does name one is not), still capped by `MAX_LIST`. A non-general verdict names the format it was judged as. `star` stays gated purely on the QUESTION being behavioral — a behavioral interview type with a technical question still yields a null `star`. The response keeps exactly its eight keys and the interview type never leaks into it.

### R-087 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A spoken sample answer never claims experience the candidate's own documents do not contain. This is the guard against the app coaching someone to lie in an interview.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerLocal.test.js`.

**Expected:** All tests pass. Given a resume that says "Led a team of five engineers" and "four product teams" but never mentions Microsoft Teams, the answer does not name Microsoft Teams — a mined skill is spoken only when it literally appears in the source material. No bare standalone metric sentence is emitted, and a metric is never paired with a story it did not come from (the answer never contains a bare "The result" sentence carrying a figure mined from a different bullet). A quoted resume bullet is spoken in first person ("I led a team..."), never as a subject-less fragment. A cover letter's application or motivation line is never quoted as the concrete example, in either the behavioral or the general shape; when used at all it is framed as motivation. With no resume, cover letter or prep context the answer says plainly that there is nothing on file rather than inventing a situation. Output is deterministic.

### R-088 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Sample-answer grounding reads only the signed-in user's own submitted documents, and degrades to empty rather than throwing.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/applicationDocs.test.js`.

**Expected:** All tests pass. The `applications` lookup filters on BOTH `id` and `user_id` — the filter that stops one user's submitted resume or cover letter being read for another, and the reason this case exists. `fetchApplicationDocs` never throws, returning empty strings for: a missing applicationId, a missing userId, no matching row, a query error on the application lookup, a null `resume_used_id`, a null `cover_letter_id`, and a query error on either document fetch.

### R-089 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The two modes of the answer route stay separate: live mode's glanceable bullets are untouched by practice mode's fuller sample answer.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.test.js lib/copilot/answerLocal.test.js lib/copilot/answerClient.test.js`.

**Expected:** All tests pass. A request with no `mode`, or an unrecognized one, returns points and type exactly as before — this is the live-interview path and it must not move. An `answer` mode request returns points, answer, type and grounding, with grounding reporting which submitted documents were actually found, and both flags false when the application has none. On the embedded engine, answer mode drafts on-device and never constructs a Gemini client. Auth still 401s and a blank question still 400s. `draftAnswerLocal` with no interview type produces the original bullets; `resolveScaffoldType` only ever overrides a general classification, never an already-behavioral or already-technical one.

**Amended (group H):** this case originally required answer mode to return a single prose `answer` string and described it as "the practice-mode prose path". The sample answer is now bullet points by explicit instruction — see R-097, which owns that contract. `answer` still exists on the response but is derived from `points` rather than generated, and is no longer what the UI renders.

**Amended (group K):** "returns points and type exactly as before" no longer means the response has exactly those two keys. Both modes now also return `cues`, `buzzwords` and `resumeAnchor` (R-120). What this case still pins, and what it was always really about, is that `answer` and `grounding` remain ANSWER MODE'S ALONE — points mode must never grow either one — and that points mode's prompt and system instruction are untouched. The test asserts the full key set plus an explicit absence check for those two, rather than an exact-shape equality that would have to be rewritten by every later addition.

### R-090 | area: interview-type | parallel-safe: yes | automatable: yes

**Summary:** The three copilot fetch wrappers forward the new fields, and omit them entirely when not supplied so existing callers send byte-identical requests.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/questionClient.test.js lib/copilot/critiqueClient.test.js lib/copilot/answerClient.test.js`.

**Expected:** All tests pass. `fetchNextQuestion`, `critiqueAnswer` and `draftAnswer` each forward `interviewType`; `draftAnswer` also forwards `applicationId` and `mode`. A call that omits those fields produces a request body without those keys at all, so live mode's requests are unchanged from before the feature. Non-ok responses still throw with the server's error message.

### R-091 | area: copilot-privacy | parallel-safe: yes | automatable: no

**Summary:** The practice-mode privacy notice names the submitted resume and cover letter as things a sample answer sends, because it does send them.

**Steps:**
1. Read the `engineNotice` construction in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** The document clause is governed by whether documents are actually going to be sent, in all four states. (1) No posting selected: no document clause at all — the sample-answer clause names only the question and the prep context. (2) Posting selected and the documents load has settled with at least one document found: both Gemini branches state definitely that revealing a sample answer sends that question, the prep context AND the submitted documents, and that the critique sends them too. (3) Posting selected, load settled, NEITHER document found: no document clause, because the routes skip the document sections entirely when both are empty and nothing is sent. (4) Posting selected but the load has not settled or has failed: conditional phrasing ("any resume or cover letter you submitted for it") — never a definite claim, and never silence, because a user who is not warned while documents ARE about to be sent is the worse failure. The embedded branch states that sample answers are drafted on the server too, and still claims nothing is sent to Google, in every one of those states. The camera-frames clause, the save-recordings clause and the transcription-provider clause remain independent of all of this and unchanged.

**Amended twice (group H):** originally the document clause was unconditional on both Gemini branches. It was first narrowed to "a posting is selected" — which was still wrong, and was caught in that group's own stage-10 run: an application with no `resume_used_id`/`cover_letter_id` fetches nothing and sends nothing, so naming Gemini as a recipient was still claiming a destination that was not receiving data, the exact defect this case exists to prevent. Selection is not the condition; documents actually existing is.

### R-092 | area: interview-type | parallel-safe: yes | automatable: no

**Summary:** Changing the interview type mid-session invalidates the work that belonged to the previous format, without discarding the selected posting.

**Steps:**
1. Read `onInterviewTypeChange` alongside `onPostingChange` in `hello-world/app/copilot/practice/PracticeClient.js`.
2. Read `hello-world/app/copilot/practice/useInterviewType.js`.

**Expected:** Changing the type bumps the question-request generation token, clears the asked list, the current question, the exhausted flag, the question error and the loading flag, and abandons then resets any in-progress or reviewed answer — the same sequence a posting change performs, and for the same reason: a question generated for the old format no longer belongs on screen. It does NOT clear the selected posting. The selection persists across reloads via localStorage, defaults to `general`, and an unrecognized stored value reads back as `general`.

### R-093 | area: submitted-docs | parallel-safe: yes | automatable: yes

**Summary:** The shared submitted-documents contract — prompt sections, caps, grounding flags, and the browser-side loader — behaves as every route that depends on it assumes.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/applicationDocsPrompt.test.js lib/copilot/applicationDocsClient.test.js`.

**Expected:** All tests pass. `clampDocs` truncates to exactly 12000 (resume) and 6000 (cover letter), leaves shorter and exactly-at-cap input untouched, degrades a missing or non-string field to an empty string, and never throws. `submittedDocsPromptParts` emits the resume section, the cover letter section, or both, and emits `NO_SUBMITTED_DOCS_NOTE` ONLY when neither document is present — the assertion two call sites depend on, since both guard against ever emitting that note. `loadApplicationDocs` returns empty documents for a falsy application id WITHOUT creating a Supabase client at all, throws for an auth-lookup failure, degrades to empty documents (no throw) when nobody is signed in, and on the happy path passes `userId` through to `fetchApplicationDocs` — that filter is the control stopping one user's submitted documents being read for another, so its presence is asserted directly.

**Known pinned quirk:** `groundingFlags` uses a bare truthiness check, so a whitespace-only document counts as found. The consequence is that `SampleAnswer.js`'s caption would claim the answer was drafted "from the resume you submitted" when that resume has no usable content. This is pinned by test as current behavior, not fixed; the tests will fail if it changes, which is the point.

### R-094 | area: submitted-docs | parallel-safe: yes | automatable: yes

**Summary:** The documents panel never shows one posting's documents while a different posting is selected, and a retry visibly supersedes the error it is retrying.

**Steps:**
1. From `hello-world`, run `npx vitest run app/copilot/useApplicationDocs.test.js`.

**Expected:** All tests pass. `resolveDocs` reports `idle` with empty documents for a falsy application id EVEN WHEN the stored state holds a settled result for some other id, and reports `loading` with empty documents and an empty error whenever the stored state belongs to a different id than the one being asked about — these two are the cross-posting leak this derivation exists to prevent. A stored result is surfaced only when its `forId` matches. A stored `outcome` of `loading` reports loading: that is the state `retry()` writes so the panel stops showing a stale, superseded error for the whole time a retry is in flight.

### R-095 | area: submitted-docs | parallel-safe: yes | automatable: yes

**Summary:** Live mode's talking points are grounded in the submitted documents, fetched server-side, and are byte-identical to the pre-feature output when there is nothing to ground in.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.test.js lib/copilot/answerLocal.test.js`.

**Expected:** All tests pass. With no `applicationId`, or an application whose documents are absent, the points-mode prompt and system instruction are byte-for-byte what they were before submitted documents existed as a grounding source — including never emitting the "no submitted resume or cover letter" note, which points mode has never had. With documents present, the prompt contains them. A client-supplied `resume` or `coverLetter` field in the request body is IGNORED: the route fetches documents itself from `applicationId`, so a client cannot inject arbitrary text labelled as a submitted document into the prompt. `draftAnswerLocal` on the embedded engine grounds in the same material and is byte-identical without it.

**Amended (group K):** the posting description became an input to this route for the first time (it feeds the buzzword list — R-118). The byte-identity requirement above is UNCHANGED and now carries more weight, not less: the description is fetched through its own function and handed only to the buzzword miner, so points mode's prompt still contains no posting text whatsoever. R-118 asserts that directly, on a request where a description is present.

### R-096 | area: submitted-docs | parallel-safe: yes | automatable: yes

**Summary:** The critique is grounded in the submitted documents without moving the embedded rubric's score, and the resulting note is not silently truncated away on a weak answer.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/critique/route.test.js lib/copilot/critiqueLocal.test.js lib/copilot/critiqueLocalDocsGrounding.test.js lib/copilot/critiqueClient.test.js`.

**Expected:** All tests pass. With no `applicationId` or no documents found, the critique prompt and the embedded rubric's output are byte-identical to before this existed. The embedded score NEVER changes as a result of documents being present — no new scoring component, no reweighting. When documents were found and the answer names none of their distinctive terms, exactly ONE additional `missing` item is appended saying so. That item is ordered ahead of the interview-format expectation items specifically so it survives the `MAX_LIST` cap of 4 on a weak answer — a weak answer generates the most structure gaps, and is exactly the case where "you never drew on the resume you submitted" matters most, so it must not be the first thing sliced off. A term that exists only as a taxonomy canonicalization and never literally appears in the submitted documents (the recorded "team" to "Microsoft Teams" defect) can never drive this signal.

### R-097 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Practice mode's sample answer is bullet points, each a complete spoken sentence, with the prose form derived from them rather than generated separately.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerLocal.test.js lib/copilot/sampleAnswerState.test.js app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. Answer mode returns `points` as an array of complete, speakable sentences — not the glanceable fragments live mode's points mode returns — plus a derived `answer` string. For a behavioral or leadership shape each point carries its STAR label. `answer` is produced by stripping those labels from `points` and joining them, never requested from the model as a second field and never generated independently: one is generated, the other is computed from it, so the two can never drift apart. `draftSampleAnswerLocal` on the embedded engine returns the same `{ points, answer, type }` shape built the same way. This case exists because a later feature synthesizes speech from `answer`, and bullet fragments read aloud sound like fragments.

**Amended (group K):** the UI no longer renders `points` — it renders `cues`, a few words each (R-117). Everything above is unchanged and is precisely why: the request was for shorter bullets, and the tempting way to deliver it was to make `points` themselves fragments, which would have broken the sentence contract this case exists to protect and made the derived `answer` unspeakable. The shortening happens at the render boundary instead, so `points` stays a sequence of complete sentences and `answer` stays derived from it. `points` remains the fallback the UI renders when a draft carries no cues.

### R-098 | area: copilot-privacy | parallel-safe: yes | automatable: no

**Summary:** Live mode's document-grounding disclosure cannot be dismissed away while the documents are still being sent.

**Steps:**
1. Read the `postingGroundingNotice` derivation and its render site in `hello-world/app/copilot/CopilotClient.js`.
2. Confirm the render site is NOT inside the `showConsent` conditional.

**Expected:** The notice renders in its own always-visible element, outside the dismissible consent Alert. This is the point of the case: the consent Alert has an `onClose`, and it is shown before the user has selected anything, so a user who dismisses it and THEN selects a posting would otherwise have their submitted resume and cover letter sent to Gemini with no notice on screen at all. The notice is empty when no posting is selected, and empty when a posting is selected whose application turns out to have no submitted documents — in that case the route sends none, so claiming otherwise would name a destination receiving nothing (the same rule R-091 enforces for practice mode). While the documents load is still in flight or has failed, the wording is conditional rather than definite, because the answer is genuinely unknown at that moment and silence would leave the user unwarned if documents do exist. On the embedded engine it states that nothing about the application is sent to Google. The fact is stated in exactly one place, so the two sites cannot drift.

### R-099 | area: submitted-docs | parallel-safe: yes | automatable: no

**Summary:** The submitted-documents panel states only what was actually found, and can never write to the prep context.

**Steps:**
1. Read `hello-world/app/copilot/SubmittedDocs.js`.
2. Read its two call sites: `hello-world/app/copilot/CopilotClient.js` and `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** The panel is rendered by both modes, and by each ONLY when a posting is actually selected — never present in an empty or disabled state. Its collapsed header states what was actually found for the current selection: both documents, only the resume, only the cover letter, neither, still loading, or load failed — never a generic claim. Each document that was not found is stated as not found rather than rendered as an empty box that could be mistaken for a short one. Long documents scroll within a bounded height instead of pushing the rest of the screen down. The component takes no `onChange` and no prep-context prop of any kind — it has no prop through which it could write to the prep context, which is what guarantees selecting, changing, or clearing a posting never touches what the user typed there.

### R-100 | area: submitted-docs | parallel-safe: yes | automatable: no

**Summary:** Selecting a posting in live mode grounds the answers and invalidates drafts grounded in the previous one.

**Steps:**
1. Read `onPostingChange`, `runDraft`, and the `PostingPicker` render in `hello-world/app/copilot/CopilotClient.js`.
2. Read the `label` and `blankHint` defaults in `hello-world/app/copilot/PostingPicker.js`.

**Expected:** The picker stays enabled at all times, including while a session is live — unlike the mode toggle and audio-source picker, which disable once live — because the user may realize mid-interview that they picked the wrong posting. Changing OR clearing the posting clears `answerCacheRef`, for the same reason editing the prep context does: every cached draft was grounded in the previous application's documents and must not be served afterwards. `runDraft` passes the selected posting's own id as `applicationId`, reading it from a ref so a stable callback's async body sees the latest selection. The picker's `label` and `blankHint` defaults are practice mode's exact original strings, so practice mode's rendering — including the composed "no tracked postings yet" helper text — is unchanged.

### R-101 | area: mic-selection | parallel-safe: yes | automatable: yes

**Summary:** Choosing a microphone constrains capture to that exact device, and choosing System default sends no constraint at all.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/capture.test.js lib/copilot/session.test.js lib/copilot/audioDevices.test.js`.

**Expected:** All tests pass. With no device id — and with `null`, `undefined` or `""` — the getUserMedia constraints object has NO `deviceId` own-key whatsoever, asserted with `hasOwnProperty` rather than an equality check: `deviceId: undefined` and `deviceId: "default"` are both WRONG here, the first because it still serializes as a key and the second because some browsers treat it as a real alias id rather than as "no constraint". With a device id it is applied as `deviceId: { exact: id }`; `exact` is mandatory, because with `ideal` or a bare string the browser silently substitutes another device and the user believes they are recording on a microphone they are not. An `OverconstrainedError` (the chosen device was unplugged) produces a message naming that cause and never the word "denied" — it is detected by `err.name`, not by matching message text, which is not spec'd — and the session still continues with interviewer audio only, exactly as any other mic failure does. `normalizeMicDevices` always puts System default first with `deviceId: null`, drops the browser's `"default"`/`"communications"` alias rows, de-duplicates by id, and numbers its "Microphone N" placeholders over the KEPT audioinput devices only. `resolveStoredMicDeviceId` returns `null` for an id no longer present. Both getUserMedia paths — `captureMicAudio` and `captureCameraAndMic` — build their audio constraints through ONE shared helper, so live and practice mode cannot drift apart on what "System default" means. (Amended: this case originally required `captureCameraAndMic` to be untouched, because practice mode had no microphone selection of its own at the time. That requirement is deliberately retired — a user who had chosen a specific microphone for live mode was silently recorded on the OS default the moment they switched to practice. Everything else in this case is unchanged, and R-108 now covers the practice-mode path.)

### R-102 | area: live-pace | parallel-safe: yes | automatable: yes

**Summary:** Live pace is measured from audio time or not reported at all, and shares one set of thresholds with practice mode.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/livePace.test.js lib/copilot/answerMetrics.test.js`.

**Expected:** All tests pass. `computeLivePace` returns `wordsPerMinute: null` with `measured: false` whenever it cannot measure — never `0`, and never a label without a measurement. `appendSpeechSample` DROPS frames whose `start`/`duration` are unusable rather than coercing them to `0`, and specifically does not treat `start === 0` as missing: a naive falsy check there is the exact bug class this guards, and a fabricated zero silently corrupts the reading. The slow/rushed thresholds are imported from `answerMetrics.js` (110/170), not restated — two copies would drift and live mode would then disagree with practice mode about what "rushed" means for the same speaker. `computeAnswerMetrics`'s own output is unchanged by that extraction, including its deliberate `"conversational"` fallback when the speech span or word count is zero, which is a not-enough-to-judge fallback and NOT a claim that 0 wpm was measured.

### R-103 | area: live-dashboard | parallel-safe: yes | automatable: yes

**Summary:** The prediction cache signature cannot collide, and the hook cannot show a stale prediction.

**Steps:**
1. From `hello-world`, run `npx vitest run app/copilot/useCopilotDashboard.test.js`.

**Expected:** All tests pass. Two genuinely different (questions, posting) pairs that WOULD collapse to the same string under a naive `|` delimiter produce different signatures under the real one. That collision matters because its failure is silent: a missed re-prediction leaves a stale predicted question on screen forever with nothing erroring. The signature is deterministic for identical inputs, since the whole caching scheme rests on it. `resolveDashboardState` returns the idle state whenever `active` is false EVEN WHEN a completed prediction is stored — the guarantee that a just-ended session cannot leave its prediction on screen — and does not surface a stored result whose signature no longer matches. The test also asserts at BYTE level that the source file contains no literal NUL character: the delimiter must be written as a six-character unicode escape (backslash, u, four zeroes), never as the raw byte, because a literal NUL makes git classify the file as binary and renders every future diff of it unreviewable, which passed eslint, the build and the whole test suite when it happened.

### R-104 | area: live-dashboard | parallel-safe: yes | automatable: no

**Summary:** The dashboard's speculative work cannot start before a session, and cannot break the session once it has.

**Steps:**
1. Read the `active` gating in `hello-world/app/copilot/useCopilotDashboard.js`.
2. Confirm `hello-world/app/copilot/CopilotClient.js` passes its existing `live` value as `active`.

**Expected:** With `active` false, neither the prediction nor the pre-draft issues any request, and both report idle rather than whatever the previous session left behind. This exists because selecting a posting merely to look at the page would otherwise spend two model calls before Start was ever pressed. Every failure is caught inside the hook and surfaced as an error with a retry; nothing throws back out to the caller. Prediction and pre-drafting are speculative conveniences bolted onto a live interview — they must never be able to break transcription, question detection, or answer drafting, which are the session's actual job.

### R-105 | area: live-dashboard | parallel-safe: yes | automatable: no

**Summary:** A correct prediction is free, not merely fast — the pre-drafted answer lands under the key the real draft looks up.

**Steps:**
1. Read `onPrefetchedAnswer` and `runDraft` in `hello-world/app/copilot/CopilotClient.js`.

**Expected:** Both use `normalizeQuestion(question)` as the `answerCacheRef` key. This is the whole cost argument for the feature: pre-drafting roughly doubles model calls per detected question, and the cache hit is what pays that back when the interviewer actually asks the predicted question. If the two keys ever diverge the cache silently never hits, nothing errors, and every prediction becomes pure cost with the real question still paying full price — so the two expressions must be checked against each other, not merely each read in isolation. Pre-drafting happens only while the existing Auto-draft switch is on, since that switch already means "spend model calls automatically".

### R-106 | area: live-dashboard | parallel-safe: yes | automatable: no

**Summary:** A predicted question can never be mistaken for one the interviewer actually asked.

**Steps:**
1. Read `hello-world/app/copilot/dashboard/CopilotDashboard.js`.

**Expected:** The two prediction panels are visually distinct from the two real-question panels (a different wrapper, an accent treatment, and a "Prediction" chip), AND say in words that the interviewer has not asked this. The failure mode being designed against is a candidate glancing at this mid-interview and confidently answering a question nobody asked, so visual distinction alone is not sufficient and neither is the text alone. The answer panel is explicitly tied to the predicted question rather than the current one. The pace panel says pace is not being measured yet whenever `measured` is false, and never renders `0 wpm` or a label — an unmeasured signal is reported as unmeasured, the same rule the body-language work established.

### R-107 | area: mic-selection | parallel-safe: yes | automatable: no

**Summary:** The microphone picker explains what it cannot know, and never prompts for permission just to render.

**Steps:**
1. Read `hello-world/app/copilot/MicPicker.js`.
2. Read its wiring and storage handling in `hello-world/app/copilot/CopilotClient.js`.

**Expected:** Device labels are empty until microphone permission has been granted once — a browser privacy rule, not an error — so the picker shows "Microphone N" placeholders and states plainly that real names appear after the first session grants access. It must NOT call `getUserMedia` to unlock labels: prompting for a microphone as a side effect of rendering a dropdown is a worse trade than an unnamed device. It subscribes to `devicechange` so a headset plugged in mid-visit appears, and removes that listener on unmount. It is disabled while a session is live or connecting, matching the audio-source toggle, because switching microphones mid-session would require rebuilding the "you" pipeline and a control that silently does nothing is worse than a disabled one. The selection persists under its own localStorage key, separate from `copilot-audio-source` and `copilot-prep-context`, wrapped in try/catch, and is resolved through `resolveStoredMicDeviceId` on load so a device that has since been unplugged falls back to System default rather than failing capture. There is exactly ONE selection and ONE storage key for the whole copilot: `CopilotClient` owns both and hands `micDeviceId`/`onMicDeviceChange` to practice mode as props, the same way it hands down `sttProviderName`. Two independent selections under two keys would let the picker in one mode name a microphone the other mode is not recording on.

### R-108 | area: mic-selection | parallel-safe: yes | automatable: yes

**Summary:** Practice mode records on the microphone the user actually chose, and says so plainly when that device is gone.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/capture.test.js lib/copilot/practiceSession.test.js lib/copilot/practiceSession.micDevice.test.js`.

**Expected:** All tests pass. The microphone cases live in `practiceSession.micDevice.test.js` rather than the main session suite, which crossed this repo's 1000-line file gate when they were added to it; both files import their stream/track/AudioContext doubles from `lib/copilot/practiceSessionTestDoubles.js` rather than each keeping a copy, since two suites with two copies of a fixture end up asserting against two different notions of what a MediaStream is. That helper deliberately does not match vitest's test-file include pattern, so it is never collected as a suite of its own. `captureCameraAndMic` obeys the same device-id rules `captureMicAudio` does, asserted the same way: with no id — and with `null`, `undefined` or `""` — the audio constraints object has NO `deviceId` own-key at all (checked by own-key inspection, not by comparing against `undefined`), and with a real id it is applied as `deviceId: { exact: id }`, never `ideal` and never a bare string. Both paths build those constraints through one shared helper, because two copies is precisely how live and practice would end up disagreeing about whether "System default" means an absent key or a present-but-undefined one — a difference invisible in review. `PracticeSession` forwards its `micDeviceId` to the camera+mic request AND to the mic-only fallback, and omitting it reproduces the pre-feature behaviour. When a device was selected and capture fails with `err.name === "OverconstrainedError"`, the error names the microphone as unavailable and never says "denied"; detection is by `.name`, never by matching message text, so a test using an unrelated `.message` still passes. With no device selected, an `OverconstrainedError` propagates as the ORIGINAL error object (asserted by identity, not message), as does a `NotAllowedError` in either case. Capture is NOT retried with the constraint dropped: falling back to a different microphone would start recording on hardware the user did not choose while the picker still names the one they did, which is the exact silent substitution `exact` exists to prevent. Unlike live mode — where the mic is optional and the session continues on interviewer audio — practice mode's message tells the user what to do, because there is no session without a microphone.

### R-109 | area: practice-dashboard | parallel-safe: yes | automatable: no

**Summary:** Both modes render one dashboard component, and only wording that would be false in context differs.

**Steps:**
1. Read `hello-world/app/copilot/dashboard/CopilotDashboard.js`, including `LIVE_COPY` and `PRACTICE_COPY`.
2. Read both call sites: `hello-world/app/copilot/CopilotClient.js` and `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** There is ONE dashboard component and ONE dashboard hook (`useCopilotDashboard`), used by both modes — not a live implementation and a practice copy. The whole reason practice mode has a dashboard is that the candidate rehearses against the instrument they will be reading during the real interview, so a fork here defeats the feature; this is the same argument that made `livePace.js` import `answerMetrics.js`'s thresholds rather than restate them. Layout, panel treatments, and every state (loading, error, empty, measured/unmeasured) are shared verbatim. `LIVE_COPY` holds live mode's exact pre-existing strings and is the DEFAULT for the `copy` prop, so live mode passes nothing and renders unchanged — the same "defaults are the incumbent mode's strings" discipline `PostingPicker.js`'s `label`/`blankHint` use. `PRACTICE_COPY` spreads `LIVE_COPY` and overrides only sentences that would be untrue with no interviewer in the room, so a string added later cannot leave either mode rendering `undefined`. Practice mode's prediction disclaimer carries extra weight and must state that the predicted question is not necessarily the question practice mode will serve next: the candidate could otherwise read "predicted next question" as "the question this app is about to ask me", which is R-106's failure mode in the form it takes here.

### R-110 | area: practice-dashboard | parallel-safe: yes | automatable: no

**Summary:** The practice dashboard never spoils the answer to the question on screen.

**Steps:**
1. Read `CurrentAnswerPanel` and the `answerHidden` prop in `hello-world/app/copilot/dashboard/CopilotDashboard.js`.
2. Read how `hello-world/app/copilot/practice/PracticeClient.js` passes `answerHidden`, `onRevealAnswer`, and the `questions` array it synthesizes.

**Expected:** In practice mode the current-answer panel shows a reveal button until it is pressed — it does NOT populate on its own. Practice mode's entire drill is answering cold (AC-G1), and a dashboard that put the model's answer on screen the moment a question appeared would quietly remove the thing being practised. The `answerHidden` check comes BEFORE any status branch, so a draft that is loading or already cached still stays hidden. Live mode passes neither `answerHidden` nor `onRevealAnswer` and reaches none of this. Crucially the panel is driven by the SAME `useSampleAnswer` instance the question card's own toggle uses, so revealing in either place reveals in both: two independent visibility flags for one draft would let the card and the panel disagree about whether the answer is showing, and the user would trust whichever they happened to be looking at.

### R-111 | area: practice-dashboard | parallel-safe: yes | automatable: yes

**Summary:** A correct prediction is free on reveal, not merely fast, and a cached draft is never served under grounding it was not built from.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerState.test.js`.
2. Read `useSampleAnswer.js`'s cache and `prime`, and `PracticeClient.js`'s `onPrefetchedAnswer`.

**Expected:** All tests pass. This is practice mode's counterpart of live mode's `answerCacheRef` and carries the same cost argument as R-105: pre-drafting roughly doubles the model calls a predicted question costs, and the cache hit on reveal is what pays that back. The cache is keyed by `normalizeQuestion(question)` — the same normalization the reveal path looks up with — and if those two expressions ever diverge nothing errors, the cache simply never hits and every prediction becomes pure cost, so they must be checked AGAINST EACH OTHER rather than each read in isolation. `prime` never touches the hook's state: a pre-drafted answer for a question the user has not asked to see must not put itself on screen, and must not disturb a draft already on screen for a different question. `cachedSampleAnswerFor` returns null — meaning draft it properly — for a missing entry, for an entry whose points are empty or malformed (a blank answer that renders like a finished one), and when the profile, interview type, or application id differs from the current value; each of those three is tested independently so a missing comparison on any one is caught. It encodes the same staleness rule as `needsRedraft`, so the two are asserted against each other rather than only separately. Retry and Regenerate always bypass the cache. The pre-draft carries the profile/interviewType/applicationId it was ACTUALLY built from (`draftedFrom`, read before the await in `useCopilotDashboard.js`) rather than whatever is current when the callback fires, because the pre-draft is deliberately not re-fired when those change — caching it under current values would label a draft with grounding it never had and then serve it as valid.

### R-112 | area: practice-dashboard | parallel-safe: yes | automatable: yes

**Summary:** Interview type reaches both dashboard requests and re-triggers prediction, without changing any live-mode signature.

**Steps:**
1. From `hello-world`, run `npx vitest run app/copilot/useCopilotDashboard.test.js`.

**Expected:** All tests pass. `predictionSignatureFor`'s third parameter contributes a segment ONLY when it is a non-empty string, so omitting it — or passing `undefined`, `null`, `""`, or a non-string — produces a signature byte-identical to the two-argument call. That compatibility is what keeps R-103's exact expected strings valid and is why the segment is conditional rather than always appended as an empty field the way the posting key is. A non-empty type produces a different signature, and two different types differ from each other: practice mode can change format while a posting is selected and no question has been asked yet, and without this the prediction made for the previous format would keep matching with nothing to re-trigger it. No questions, no posting and no type still returns the empty sentinel; no questions, no posting but WITH a type must NOT, or practice mode with only a format chosen would never predict at all. The delimiter reasoning is unchanged — an interview type is a short slug but still payload, and payload never delimits payload — so a collision check in the same spirit as the existing one holds. `interviewType` and `draftMode` are `undefined` in live mode and `JSON.stringify` drops them, so live's request bodies are byte-identical to before these inputs existed; practice passes its selected format and `mode: "answer"`, which is what makes a pre-draft land in the same shape `useSampleAnswer` would have fetched.

### R-113 | area: practice-dashboard | parallel-safe: yes | automatable: no

**Summary:** Practice-mode pace is measured from audio time, and speculative work never starts before a session.

**Steps:**
1. Read the `onTranscript` handler and the `useCopilotDashboard` call in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** `recordSpeechSample` is called for FINAL frames only, with the provider's own `start`/`duration`, never a wall-clock substitute and never a fabricated zero — `appendSpeechSample` drops unusable timing itself, so the caller does not pre-filter. `active` is the session's own running flag, so selecting a posting or choosing an interview type merely to look at the page spends no model call, and a session that has ended reports idle rather than leaving its last prediction on screen. `start()` calls BOTH `resetForSession` functions: `usePracticeAnswer` and `useCopilotDashboard` each return one, and the dashboard's must be renamed at the destructuring site. Dropping either one is silent — a stale prediction or a stranded answer clock, with nothing erroring — so both calls must be present.

### R-114 | area: practice-notices | parallel-safe: yes | automatable: yes

**Summary:** Extracting the practice privacy notice changed no wording, and the save switch is still read at upload time.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/practiceNotices.test.js`.
2. Read `hello-world/app/copilot/practice/PracticeClient.js` where it calls `buildPrivacyNotice` and where it passes `isSaveEnabled`.

**Expected:** All tests pass. The notice module is pure — no React, no imports from `app/` — and its tests pin the output string for every combination of engine, frames switch, posting, document-load state, and save switch against an oracle captured from the pre-extraction implementation. This is a mechanical extraction of text a user relies on to know where their video and transcript go, so "looks the same" is not the bar: every branch is asserted byte-for-byte. The hedge/assert/omit split survives — while the submitted-document load is unsettled the clauses say "may", once settled they name only the document(s) actually found, and the critique clause falls silent when neither was found rather than repeating a blanket claim. `PracticeClient` still passes the plain `readSaveEnabled` FUNCTION to `doneAnswerFlow` as `isSaveEnabled`, not the hook's render-time value: the upload it gates happens seconds later, after the critique settles, and latching the switch at click time would make toggling it mid-critique do nothing.

### R-115 | area: practice-notices | parallel-safe: yes | automatable: yes

**Summary:** Practice mode discloses that pre-drafting sends a question to Gemini before the user reveals anything, and never claims the embedded engine fails to cover it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/practiceNotices.test.js`.
2. Read the embedded-engine caption rendered beside the switches in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** All tests pass. Before this feature the practice notice framed Gemini contact as coming from exactly two things — the critique, and *revealing* a sample answer — and that was accurate. "Pre-draft predicted answer" broke it: while that switch is on (and it defaults ON), a predicted question plus the prep context, plus any submitted resume/cover letter, go to Gemini automatically for a question the user never revealed and never asked to see. A user reading the old wording would reasonably conclude nothing reaches Gemini until they press something. The notice therefore names this transfer whenever `preDraftEnabled` is true, following the same hedge/assert/omit discipline as the other document clauses, and reusing the shared label helper rather than restating it. This is the same defect class as BUG-H5 — naming a narrower set of transfers than actually occurs — and it was a specification error, not an implementation slip: the acceptance criteria for the dashboard did not ask for the disclosure at all, and it was caught only at verification.

The clause lives ONLY in the non-embedded branch. On the embedded engine `app/api/copilot/answer/route.js` branches on `wantsEmbedded(body?.engine)` and drafts through `draftSampleAnswerLocal`, so a pre-draft reaches no AI provider — the embedded sentence's existing "Sample answers are drafted on this server too" already covers it, and a second clause there would contradict it. For the same reason the caption beside the switches must NOT say the embedded guarantee is "separate from" pre-drafting: that construction means "the guarantee does not cover this", which is true of saving recordings (a Supabase upload that happens identically on every engine) and false of pre-drafting. Understating a protection the user actually has is still a false privacy claim.

With `preDraftEnabled` false the notice is byte-identical to the frozen pre-extraction oracle on every combination — that path IS the old behaviour and must not shift by one character — and with `preDraftEnabled` true on the embedded engine it is likewise unchanged.

### R-116 | area: practice-notices | parallel-safe: yes | automatable: yes

**Summary:** The feedback panel reports the critique request that actually happened, not the current position of a switch the user can still move.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/answerProvenance.test.js`.
2. Read `runCritique` and `resetAnswerState` in `hello-world/app/copilot/practice/usePracticeAnswer.js`, following `critiqueFramesSent`.
3. Read what `hello-world/app/copilot/practice/PracticeClient.js` passes as `AnswerFeedback`'s `framesSent` prop, and separately what it passes as `buildPrivacyNotice`'s `framesWillUpload`.

**Expected:** All tests pass. The provenance caption is derived from a value written ONCE, at the moment each critique settles, and never re-derived at render time. "Include camera frames in AI feedback" stays enabled and is rendered on the same screen as the feedback panel, so a caption re-derived from that switch silently rewrites itself for a request that already completed — turning it off after a frames-bearing critique made the panel say "no one reviewed your video for this" when Gemini had, with no new request made and nothing on screen indicating the claim had changed.

The recorded value is what the `frames` array actually CARRIED, via `framesWereSent(frames)`, never the `includeFrames` flag that selected it. Those differ in a way that fails in the more damaging direction: with the opt-in on but no camera present, the camera switched off, or the sampler having failed, `runCritique` sends `frames: []`, so recording the flag would assert a video review that never occurred. `framesWereSent` treats anything that is not a non-empty array — missing, null, a string, an array-like object — as "nothing was sent" rather than throwing.

`videoWasReviewed(source, framesSent)` requires BOTH that Gemini produced the critique and that frames were sent for that same request. The embedded engine never constructs a Gemini client or parses a frame; the Gemini-failed-and-fell-back-to-embedded path reports `source: "embedded"` even though frames may already have been transmitted for the failed attempt, because frames leaving the browser and a review having happened are two different facts and this function reports the second. It returns a real boolean, never a truthy passthrough — the panel renders one of two sentences off it, so a passthrough would still select the right branch and hide itself from a naive assertion.

Both functions live in `lib/copilot/answerProvenance.js` rather than inside `AnswerFeedback.js` for the same reason `answerPoints.js` and `answerWindow.js` do: this repo's vitest runs `environment: "node"` with no jsdom, so a claim that lives inside a component module cannot be exercised by any test.

The write happens on BOTH the success and the error settle, inside the same `answerGenRef.current === gen` guard as the other UI writes, so an abandoned or superseded request never repaints it; `resetAnswerState` clears it. `framesWillUpload` is deliberately UNCHANGED for the privacy notice and for the `includeFrames` argument built inside `onDoneAnswer`/`onRetryCritique` — those describe what will happen on the NEXT request and must keep reading live state (R-057, R-064). Only the retrospective caption reads the recorded value. Related: R-057, R-064, R-073.

### R-117 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A drafted answer is read as a few words per beat, not as sentences, and shortening one never changes what it says.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/answerCues.test.js`.

**Expected:** All tests pass. `shortenToCue` trims a spoken answer sentence to roughly six words, keeping any STAR label verbatim (the label is the navigation between beats; shortening it defeats the point) and applying the budget only to the sentence behind it. It cuts at a clause boundary in preference to counting words, trying STRONG boundaries (punctuation, `because`, `which`, `while`, `before`, `after`) before WEAK ones (a bare `and`/`then`/`or`) — the order matters and is asserted directly: "Open with where and when" is one thought that a weak-first split would cut to "Open with where", which is not a prompt. A trailing enumeration is kept whole rather than cut at its first comma, because half a list of skills reads as a complete answer naming fewer skills than the candidate has. The leading first-person subject and filler openers are dropped, since every point in a sample answer starts "I" and the word therefore distinguishes nothing. A cue never ends on a dangling function word and never carries terminal punctuation or a mid-word ellipsis. Anything that shortens to nothing returns an empty string so the caller drops it rather than rendering a blank bullet.

`resolveCues` prefers the model's own cues, which read better than any mechanical trim, but ONLY when there is exactly one per point: a mismatched count means the model paired them differently than the points array reads, and a cue sitting against the wrong beat is worse than a mechanical one sitting against the right beat, so the whole supplied set is discarded rather than padded. Supplied cues are still put through `shortenToCue`, so a "cue" returned as a full sentence is trimmed rather than trusted.

### R-118 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The posting's own vocabulary is offered as a list to work in, and the posting description still grounds nothing.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/postingBuzzwords.test.js app/api/copilot/answer/route.test.js lib/copilot/applicationDocs.test.js`.

**Expected:** All tests pass. This is the first time the posting description has been an input to `/api/copilot/answer` at all, and AC-H7.27 is unchanged: the description reaches the buzzword miner and nothing else. The route proves it on a request where a description IS present — neither the answer-mode prompt nor the points-mode prompt contains any of its text. The separation is structural rather than remembered: `fetchPostingDescription` is its own function beside `fetchApplicationDocs` precisely so no prompt builder is ever handed an object that happens to carry the description. Both prompts still receive only the submitted résumé/cover letter.

The distinction being drawn is deliberate and is the reason the constraint survives: material an answer is GENERATED from can make a candidate claim experience the posting described rather than experience they have; a list the candidate reads and chooses from cannot, because they decide which terms they can honestly say.

`postingBuzzwords` returns only terms that literally occur in the posting — a canonical taxonomy name is an inference, and telling someone to say "Microsoft Teams" because the posting said "team" would put a false term in their mouth in a live interview (the same recorded hazard R-087 and R-096 guard elsewhere). Relevance to the current question and draft outranks the extractor's own score AND outranks the taxonomy/RAKE tier, because this list answers "say these here", not "these are the important words in the posting". A posting the technology taxonomy barely matches still returns terms, via the RAKE topic tier. Output is capped, de-duplicated case-insensitively, and deterministic. `fetchPostingDescription` scopes on both `id` and `user_id`, and degrades to an empty string — never throws — for a missing id, a missing user, no row, a query error, no joined position, or a null/non-string description.

### R-119 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The role and project offered beside an answer are the candidate's own, from the résumé they actually submitted, and are labelled honestly.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/resumeAnchor.test.js app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. `resumeAnchor` scores every parsed role against the question AND the drafted points, not the question alone — a question like "Tell me about a time you took ownership" is too short to discriminate, while the draft has already selected the material that mattered. The project is drawn from the bullets of the role just named, widening to the whole résumé only when that role has none: a project attributed to one employer while the label beside it names another is worse than no project at all. `pastWorkExperienceLine` is reused rather than re-derived, so a cover letter's "I am applying for..." opener can never be presented as a project (the same disqualification the drafted answer applies).

`matched` reports whether the role was chosen for OVERLAP or is merely the most recent one on file, and the UI's label changes with it — calling an unmatched role a "closest match" would claim a relevance that was never computed. Every returned value literally occurs in the material: the test walks each word of the project back to the résumé text. Returns null for empty material and for material where nothing parses as employment; returns a project with an empty role when a bullet is usable but no role header parses. The résumé is preferred over the prep-notes profile because the ask was specifically for the job title and company from the submitted résumé; the profile is the fallback only when no résumé was submitted. Deterministic.

### R-120 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Both modes of the answer route carry the three reading aids, and every one of them degrades to absent rather than to an empty section.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. Answer mode returns points, cues, answer, type, grounding, buzzwords and resumeAnchor; points mode returns the same minus `answer`/`grounding` — those two remain answer mode's alone (R-089). The aids are computed identically for both modes and both engines from the same two pure modules, so live and practice can never show different aids for the same question and no aid depends on which engine drafted the answer. On the embedded path `cues` are always derived; on the Gemini path they are the model's when it returned one per point and derived otherwise, and that fallback is asserted with a deliberately mismatched model response.

With nothing to build from — no posting selected, no submitted résumé, no prep profile — `buzzwords` is empty and `resumeAnchor` is null, which the UI renders as no subsection at all. This is the load-bearing half of the case: an empty header under a drafted answer reads as a failure, and these are ordinary states, not errors.

### R-121 | area: live-dashboard | parallel-safe: yes | automatable: no

**Summary:** Every surface that shows a drafted answer shows the same one, in the same form, including one served from cache.

**Steps:**
1. Read `answerBullets` in `hello-world/lib/copilot/answerPoints.js`.
2. Confirm it is what selects the bullets in ALL FOUR answer surfaces: `app/copilot/practice/SampleAnswer.js`, `app/copilot/QuestionFeed.js`, and both `CurrentAnswerPanel` and `PredictedAnswerPanel` in `app/copilot/dashboard/CopilotDashboard.js`.
3. Confirm `app/copilot/AnswerAids.js` is the only place the buzzword and role/project subsections are rendered, and that `SampleAnswer.js`, `QuestionFeed.js` and `CurrentAnswerPanel` all render it.
4. Read the cache writes in `app/copilot/practice/useSampleAnswer.js` (`request`'s then-handler and `prime`) and `app/copilot/CopilotClient.js` (`runDraft`'s success path and `onPrefetchedAnswer`), and the cache read in `runDraft`'s not-forced branch.

**Expected:** `answerBullets(cues, points)` returns the cues when there are any and the full points otherwise, and no surface writes that choice out for itself. This is the same failure `cleanAnswerPoints` was extracted for (BUG-J6, where two copies of one filter had already drifted), applied to a decision made in twice as many places — a dashboard panel still rendering full sentences beside a card rendering cues would read as two different kinds of thing.

`AnswerAids` renders nothing at all when given neither buzzwords nor a role/project, so a surface can pass it through unconditionally. It is deliberately NOT rendered in `PredictedAnswerPanel`: that panel answers a question nobody has asked, and two more labelled blocks under it would crowd out the current answer beside it. Its data still travels on the `onPrefetchedAnswer` payload into the caller's cache, so a prediction that is actually asked reveals a COMPLETE answer.

Every cache entry — a real draft, a pre-draft, and live mode's reused-answer path — stores the cues and both subsections alongside the points. A cache hit that dropped them would render a visibly poorer panel than the same question drafted fresh, which is the opposite of what "reused" is meant to signal. An entry written before these fields existed (a session open across a deploy) resolves to the empty shapes, so the surface falls back to the full points and omits the subsections rather than crashing or showing empty headers.

### R-122 | area: practice-dashboard | parallel-safe: yes | automatable: no

**Summary:** Revealing the practice dashboard's current answer moves focus into it instead of dropping it to `<body>`.

**Steps:**
1. In practice mode, with a current question on screen and its answer still hidden, Tab to the dashboard's "Show sample answer" button (`CurrentAnswerPanel` in `hello-world/app/copilot/dashboard/CopilotDashboard.js`) and press Enter/Space.
2. With a screen reader running (NVDA/JAWS) or by watching the visible focus outline, note where focus lands immediately after the press.
3. Repeat for a question whose answer is already cached (R-111), so the reveal resolves straight to `done` with no visible loading spinner in between.
4. Read `CopilotClient.js`'s `CopilotDashboard` call site (`hello-world/app/copilot/CopilotClient.js`) and confirm it passes neither `answerHidden` nor `onRevealAnswer`. Separately, read the effect's guard condition in `CurrentAnswerPanel` and confirm it still checks `typeof onReveal === "function"` in addition to the `true -> false` transition — then construct the case that check alone defends: `answerHidden` transitioning true -> false while `onReveal`/`onRevealAnswer` is not a function (neither of today's two real call sites can produce this; it would take a future caller passing `answerHidden` without also passing `onRevealAnswer`). Confirm the guard's condition would block `revealedRef.current?.focus()` in exactly that constructed case.

**Expected:** The button the user just activated is replaced by the drafted answer's container, and focus moves into that container in the SAME interaction — never falling back to `<body>`, which used to leave a keyboard/screen-reader user with no cue except silence and a Tab from the top of the document. `CurrentAnswerPanel` puts a single wrapping `Box` (`revealedRef`, `tabIndex={-1}`) around every post-reveal branch (loading spinner, error Alert, drafted bullets, and the "no points" empty text) — not only the `done` branch — so focus lands there and stays valid across the loading -> done transition without needing to move a second time, and lands there just as correctly on a cache hit that never shows a spinner at all. `tabIndex={-1}` makes the container programmatically focusable without adding a new Tab stop. The move happens only on the `answerHidden` TRUE -> FALSE transition, tracked by a ref that starts equal to the current value (so the effect never fires on mount). These are three SEPARATE protections, and step 4 must not credit one with another's job: (a) the seeded ref is what stops a mount-time false positive, in every mode; (b) live mode passes neither `answerHidden` nor `onRevealAnswer`, so `answerHidden` holds its `false` default for the panel's entire life and the `true -> false` transition never occurs there AT ALL — that absence of any transition is what excludes live mode, independent of guard (c); (c) the `typeof onReveal === "function"` check is defence-in-depth for a hypothetical future caller that passes `answerHidden` without `onRevealAnswer` — it protects nothing in either of today's two real call sites, since neither can reach the state it defends against, so "open the live dashboard and confirm nothing fires" (the previous version of step 4) passes no matter what that check does and therefore tests nothing. `CurrentAnswerPanel`'s branch order is unchanged: `!current`, then `answerHidden`, then the status branches, now nested one level inside the focus container rather than flattened — R-110's "the `answerHidden` check comes BEFORE any status branch" still holds. Related: R-109, R-110, R-113.

### R-123 | area: copilot-a11y | parallel-safe: yes | automatable: yes

**Summary:** The sentence read by every drafted-answer status region is a pure function of status and bullet count, and it stays silent for an error so the sibling Alert is the only thing that announces one.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/answerStatus.test.js`.

**Expected:** All tests pass. `answerStatusMessage({ status, bulletCount })` — there is no `error` parameter — returns `""` for idle — including an undefined or unrecognized status, which is what "no current question yet" looks like to this function — `"Drafting an answer"` for loading regardless of `bulletCount`, and `"Answer ready, N points"` for done, keeping the singular only at exactly one (`"Answer ready, 1 point"`). It ALSO returns `""` for `error`, the same as idle: every surface that can reach `status: "error"` already renders an MUI `Alert severity="error"` for that same failure, and `Alert` sets `role="alert"` on its own, so this `role="status"` region announcing it too would be a redundant second announcement — and, before this fix, the two could word the same failure differently (`SampleAnswer.js`'s Alert said "Could not draft a sample answer." while this region said "Could not draft an answer."). The Alert owns the announcement; this region simply has nothing to say for that status. A missing, non-numeric, `NaN`, or negative `bulletCount` on a done draft is treated as zero rather than throwing or rendering `NaN`.

### R-124 | area: copilot-a11y | parallel-safe: yes | automatable: no

**Summary:** A drafted answer arriving is actually announced to a screen reader, not just implied by a button's label changing.

**Steps:**
1. Read the `role="status"`/`aria-live="polite"` element and where it sits relative to the surrounding conditional content in each of: `hello-world/app/copilot/QuestionFeed.js` (ONE region at the `QuestionFeed` level, reading the LATEST entry of `questions` — not one per `QuestionCard`), `hello-world/app/copilot/dashboard/CopilotDashboard.js` (`CurrentAnswerPanel` and `PredictedAnswerPanel`), and `hello-world/app/copilot/practice/SampleAnswer.js`.
2. With NVDA or JAWS running, draft a FRESH answer (a question not asked before this session) on each of the four surfaces and confirm an announcement is heard once each draft finishes. (For `CurrentAnswerPanel` in practice mode, reveal the answer first — the hidden state is R-110/R-122's case, where this region is intentionally silent regardless of draft status.)
3. On the SAME four surfaces, separately and explicitly ask a question a SECOND time (or otherwise trigger the R-111/R-121 cache — e.g. an interviewer repeating a question in live mode) so its card/panel resolves straight to `status: "done"` on its FIRST render, with no visible loading spinner in between. Confirm an announcement is STILL heard for this specific case. This step is not satisfied by step 2 and must not be skipped: a reviewer who only performs the structural check in step 1 and the fresh-draft check in step 2 has NOT exercised the cache-hit path this case exists for, and must run step 3 before marking R-124 passed.

**Expected:** In every one of the four surfaces the status element is rendered UNCONDITIONALLY — never nested inside the surface's own `{visible/done/... ? (...) : null}` content block — styled with the shared `visuallyHidden` constant exported by `lib/copilot/answerStatus.js` (a plain object literal; NOT `@mui/utils`, which this repo does not depend on) rather than hand-rolled CSS, and fed `answerStatusMessage(...)` (`lib/copilot/answerStatus.js`, R-123) on every render. This is deliberate, not incidental: a live region that MOUNTS at the same moment its content is already inside it is not reliably announced by NVDA/JAWS — only a TEXT CHANGE on an already-mounted node is. `QuestionFeed.js` is the sharpest case for step 3: a REUSED answer's card starts life already `status: "done"` — `CopilotClient.js`'s `addQuestion` seeds `status: "loading"` (auto-draft is on by default) and synchronously calls `runDraft`, whose cache-hit branch sets `status: "done"` before any `await`, so React 18 batches both into the card's very first render. A region living on that card would therefore mount already carrying its final text and go unannounced — which is why its region instead lives one level up, at `QuestionFeed`, mounted outside the `questions.length === 0` branch (so it exists before any question does) and reading whichever entry is latest, so a reused answer's arrival is a text change on an already-mounted region rather than a new node appearing with its final text already inside it. `SampleAnswer.js` is the sharpest case for step 2: its whole answer panel is conditionally rendered on `visible`, so its status span sits OUTSIDE that conditional (immediately after the toggle button's `Stack`, mounted with `""` while hidden). Before this, the only thing announced in live mode was the draft button's own label changing ("Draft answer" -> "Drafting…" -> "Redraft") — which said nothing to a user not focused on that button, and nothing at all on the dashboard panels, which have no such button.

### R-125 | area: copilot-a11y | parallel-safe: yes | automatable: no

**Summary:** Heading levels under `/copilot`'s h2 descend one level at a time, with no level skipped.

**Steps:**
1. Read every `Typography` in `hello-world/app/copilot/`, `hello-world/app/copilot/dashboard/`, and `hello-world/app/copilot/practice/` that carries `variant="subtitle2"`, `variant="h6"`, or `variant="h4"`, and check its `component=` prop.
2. With a browser accessibility-tree inspector (or a screen reader's heading-navigation list) open on `/copilot` in both live and practice mode, walk the heading list top to bottom.

**Expected:** `app/components/TabHeader.js` is UNCHANGED — it still renders `component="h2"` with no `component=` override anywhere in this fix — because it is shared by every other tab (`ApplyingControls.js`, `AutoApplyQueueTab.js`, `LibraryEditor.js`, `LiveFeedTab.js`, `TrackingTab.js`, `app/page.js`), and this fix touches only files under `app/copilot/`, so whatever heading structure those other tabs already have is provably unaffected. Every panel/section title one level under that h2 — `CopilotDashboard`'s own title, `QuestionFeed`'s "Detected questions", `SubmittedDocs`'s "Submitted resume"/"Submitted cover letter", practice mode's `QuestionCard` question text, `AnswerReview`'s "Answer review", `AnswerFeedback`'s "Answer feedback", and `PracticeHistory`'s "Practice history" — carries `component="h3"`. Every title nested one level under one of THOSE — `CopilotDashboard`'s four panel titles (`RealPanel`/`PredictionPanel`) plus its pace panel title, `AnswerReview`'s "Body language"/"Replay"/"What was heard", and `AnswerFeedback`'s `BulletList` titles plus "Body language feedback" — carries `component="h4"`. Nothing in this tree goes a level deeper than h4, so h5 is never needed and therefore never skipped either. `AnswerFeedback`'s score number (`{feedback.score}`) carries `component="span"`: it used to be an h4 nested inside the panel's own (then-h6) title — the second half of the "h6 then h4 inside it" defect — and a numeric score is a data value, not a section title, so it is removed from the heading outline entirely rather than assigned a level. Every change here touches only `component=`; `variant=`, and therefore the visual size/weight of every one of these strings, is byte-for-byte unchanged. `app/copilot/AnswerAids.js` is unchanged — it deliberately renders a `<dl>` with no heading of its own, which is still the right call.

### R-126 | area: copilot-a11y | parallel-safe: yes | automatable: no

**Summary:** A failed draft is announced as an error, not shown as a plain colored sentence.

**Steps:**
1. Read the `q.error` branch in `hello-world/app/copilot/QuestionFeed.js`'s `QuestionCard` and the `current.status === "error"` branch in `hello-world/app/copilot/dashboard/CopilotDashboard.js`'s `CurrentAnswerPanel`.
2. Force a draft failure on both surfaces (e.g. disconnect the network mid-draft) and compare the visual treatment against `SampleAnswer.js`'s and `PredictedAnswerPanel`'s existing error states.

**Expected:** Both branches render MUI `<Alert severity="error">`, matching the sibling error paths (`SampleAnswer.js`, `PredictedQuestionPanel`, `PredictedAnswerPanel`) — never a bare `<Typography sx={{ color: "var(--danger)" }}>`. `Alert` sets `role="alert"` and renders its own icon, so the failure is no longer a colour-only signal (WCAG 1.4.1) and is announced without depending on where focus happens to sit. Neither branch gained a Retry action: `CurrentAnswerPanel` has no redraft callback wired to it from either caller, and adding one is out of scope here — this is styling/semantics parity with the sibling paths, not new functionality. `QuestionFeed.js` gained an `Alert` import for this; `CopilotDashboard.js` already imported `Alert` for its two prediction panels.

### R-127 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** A committed_transcript(_with_timestamps) that only re-delivers the span of the final_transcript(_with_timestamps) that already landed is delivered for `speechFinal` but never counted twice.

**Steps:**
1. Read `_emitTranscript` in `hello-world/lib/copilot/stt/elevenlabs.js` and the `textAlreadyDelivered` field documented on `onTranscript` in `hello-world/lib/copilot/stt/index.js`.
2. Read the guards in `hello-world/app/copilot/practice/usePracticeAnswer.js`'s `recordTranscriptEvent` (via `acceptedAnswerFinal` in `hello-world/lib/copilot/answerWindow.js`), `hello-world/app/copilot/practice/PracticeClient.js`'s `onTranscript` handler, and `hello-world/app/copilot/CopilotClient.js`'s `onTranscript` handler.
3. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js lib/copilot/stt/deepgram.test.js lib/copilot/answerWindow.test.js` from `hello-world/`.

**Expected:** `ElevenLabsStream` retains the last isFinal:true frame's `{ text, start, duration }` it delivered; a later isFinal:true frame whose text, start, AND duration all exactly match it is still delivered (consumers need its `speechFinal: true`) but carries `textAlreadyDelivered: true`. The match requires all three fields — two genuinely different utterances that happen to share the same words but start at different times are both delivered, un-flagged, and a frame with no usable `words` array (start/duration both `undefined`) is never treated as a match either, since `undefined === undefined` proves nothing about whether it's really the same span. The flag is absent (never explicit `false`) on every other frame, so Deepgram's frames — proven by an explicit no-regression case — and any consumer written before the flag existed see byte-identical objects. `acceptedAnswerFinal` (answerWindow.js) rejects a final carrying the flag even when it is otherwise perfectly in-window and collecting; `usePracticeAnswer.js`'s `recordTranscriptEvent`, `PracticeClient.js`'s session-transcript append and pace-sampler feed, and `CopilotClient.js`'s `appendFinal`/`recordSpeechSample`/interviewer-utterance assembly all skip the TEXT for a flagged frame while still honouring `speechFinal` for question detection. Before this fix a five-entry answer transcript rendered as A, A, B, B, C and reported word count / filler count / words-per-minute at roughly double the true value.

### R-128 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** A wpm no human voice can produce is flagged as an implausible measurement, not clamped into a smaller number and not asserted as delivery fact to the critique model.

**Steps:**
1. Read `MAX_PLAUSIBLE_WPM` and `paceIsPlausible` in `hello-world/lib/copilot/answerMetrics.js`, and `normalizeMetrics`'s/`buildDeliveryNotes`'s implausible-pace handling in `hello-world/lib/copilot/critiqueLocal.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerMetrics.test.js lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** `computeAnswerMetrics` sets `paceIsPlausible: false` once `wordsPerMinute` exceeds 300 (a physical ceiling, distinct from the existing RUSHED_WPM_MIN=170 delivery band) — it never clamps the number itself, so a measurement fault stays visible as a fault instead of rendering as a plausible-looking, wrong one. `critiqueLocal.js`'s `normalizeMetrics` independently RE-DERIVES `paceIsPlausible` from the numeric `wordsPerMinute` it just normalized rather than trusting whatever a client payload claims, in both directions: a client that (falsely) claims `paceIsPlausible: true` at an impossible wpm is overridden to `false`, and a client that (incorrectly) flags a genuinely plausible wpm as implausible is overridden back to `true`. `buildDeliveryNotes` cites the wpm as fact ("You spoke for N seconds at N words per minute...") only when plausible; when not, it reports that speech was captured and that the pace measurement points to a data problem, without stating the impossible number — which is what keeps it out of `app/api/copilot/critique/route.js`'s "MEASURED DELIVERY METRICS... treat those numbers as ground truth" prompt section as a fact to cite. No score moves: `computePaceScore`/`computeDeliveryScore` still key off `paceLabel` alone, proven by a case that holds `paceLabel` fixed while flipping `wordsPerMinute` across the ceiling and asserting `critiqueAnswerLocal`'s score is byte-identical either way.
