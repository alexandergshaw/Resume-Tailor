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
3. Read the `canCombine`, `steeringEnabled`, Preview/Edit toggle, file-name row, `EditorToolbar` and Download/Copy branches in `hello-world/app/components/DocumentPreviewDialog.js`, the scope loop in `hello-world/app/components/preview/CombineDocumentsControl.js`, and `buildPreviewBlob` in `hello-world/lib/document/previewBlob.js`.

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

**Amended (group M):** a third source, `"inperson"`, now exists and does NOT go through `THEM_CAPTURE_BY_SOURCE` at all -- it calls no `getDisplayMedia` function whatsoever and captures only the microphone. The degradation rule above is unchanged and is what this case still protects: an unrecognized value must resolve to `captureTabAudio`, NOT to the new mic-only path. See R-144.

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

**Amended (group M):** every sentence above still holds for `"tab"` and `"system"`, and that is now precisely the point of this case -- those two paths must stay byte-identical. It is NO LONGER true of the session as a whole. On the new `"inperson"` source there is exactly one source, the microphone is REQUIRED (its failure is fatal and rejects out of `start()`, with wording that must not reuse "continuing with interviewer audio only"), and speaker separation comes from diarization rather than from having two streams. See R-144 and R-147.

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
1. Read `onModeChange` in `hello-world/app/copilot/CopilotClient.js` and the unmount-cleanup effect in `hello-world/app/copilot/useLiveSession.js` (the session pipeline moved there in group M; `onModeChange` stayed behind and calls the hook's `stop`).
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
3. Run `npx vitest run --no-file-parallelism lib/copilot/answerWindow.test.js lib/copilot/stt/deepgram.test.js` from `hello-world/`.

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

**Expected:** A quantified result is detected anywhere in a sentence — "Support tickets fell by 40% after the change." and "It generated250,000 in new revenue." both set the result beat. "A complete STAR story" is claimed only when all four beats are present, never alongside a `missing` entry naming an absent beat. "I looked at the logs" does not credit a Situation beat, and a bare "however" or "although" does not credit a trade-off. Posting-vocabulary overlap matches on word boundaries with a minimum canonical length, so short taxonomy entries cannot match inside unrelated words and manufacture a strength. Interview-question boilerplate is stripped before relevance overlap, so a directly responsive answer is not told it drifted. The rubric is fully deterministic — identical inputs give an identical score AND identical wording — and the score stays an integer within 0-100 for an empty answer, a one-word answer, a 2000-word answer and an all-filler answer. An empty answer returns a low score, an honest verdict, empty strengths, and asserts nothing about prose that does not exist.

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

**Expected:** All tests pass. `fetchNextQuestion`, `critiqueAnswer` and `draftAnswer` each forward `interviewType`; `draftAnswer` also forwards `applicationId` and `mode`. A call that omits those fields produces a request body without those keys at all — a property of the wrapper itself (`answerClient.test.js:102-114`), not a description of live mode's traffic: live mode now supplies `interviewType` on every request. Non-ok responses still throw with the server's error message.

**Amended (chunk A — interview type):** the trailing clause "so live mode's requests are unchanged from before the feature" is struck; chunk A makes it false by having live mode start sending `interviewType` (AC-A18). What the case actually pins, unedited, is that `answerClient.test.js:102-114` asserts the wrapper omits whatever keys its caller omits — a property of the client module, not a claim about live traffic. **The test itself is untouched.**

### R-091 | area: copilot-privacy | parallel-safe: yes | automatable: no

**Summary:** The practice-mode privacy notice names the submitted resume and cover letter as things a sample answer sends, because it does send them.

**Steps:**
1. Read the `engineNotice` construction in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** The document clause is governed by whether documents are actually going to be sent, in all four states. (1) No posting selected: no document clause at all — the sample-answer clause names only the question and the prep context. (2) Posting selected and the documents load has settled with at least one document found: both Gemini branches state definitely that revealing a sample answer sends that question, the prep context AND the submitted documents, and that the critique sends them too. (3) Posting selected, load settled, NEITHER document found: no document clause, because the routes skip the document sections entirely when both are empty and nothing is sent. (4) Posting selected but the load has not settled or has failed: conditional phrasing ("any resume or cover letter you submitted for it") — never a definite claim, and never silence, because a user who is not warned while documents ARE about to be sent is the worse failure. The embedded branch states that sample answers are drafted on the server too, and still claims nothing is sent to Google, in every one of those states. The camera-frames clause, the save-recordings clause and the transcription-provider clause remain independent of all of this and unchanged.

**Amended twice (group H):** originally the document clause was unconditional on both Gemini branches. It was first narrowed to "a posting is selected" — which was still wrong, and was caught in that group's own stage-10 run: an application with no `resume_used_id`/`cover_letter_id` fetches nothing and sends nothing, so naming Gemini as a recipient was still claiming a destination that was not receiving data, the exact defect this case exists to prevent. Selection is not the condition; documents actually existing is.

### R-092 | area: interview-type | parallel-safe: yes | automatable: no

**Summary:** Changing the interview type mid-session invalidates the work that belonged to the previous format, without discarding the selected posting — and the duty performed depends on whether the change came from this tab or from another browser window.

**Steps:**
1. Read the `useInterviewTypeChange` subscriber in `hello-world/app/copilot/practice/PracticeClient.js` alongside `onPostingChange`, and `discardPracticeWork` in `hello-world/lib/copilot/choiceChangeInvalidation.js`.
2. Read `hello-world/app/copilot/useInterviewType.js` and `hello-world/lib/copilot/choiceStore.js`.
3. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/choiceChangeInvalidation.test.js lib/copilot/choiceStore.test.js app/copilot/useInterviewType.test.js app/copilot/practice/PracticeClient.interviewTypeWiring.test.js`.

**Expected:** The duty list fires on both a local change (this tab's own picker, or the other mode's tab in the same window) and a foreign one (a `storage` event from another browser window) — but the two origins run different sequences. On a **local** change: bump the question-request generation token; clear the asked list, the current question, the exhausted flag, the question error and the loading flag; abandon then reset any in-progress or reviewed answer; clear the practice session's running score average; and invalidate room-question drafts while leaving the room questions themselves in place. On a **foreign** change: clear the score average and the room drafts and do nothing else — no abandon, no answer-state reset, no full question reset (the asked list, the current question, the loading flag and the request-generation token are all left alone; only the exhausted flag and any stale question error are cleared, so the candidate keeps the question they are mid-answer on while the next request already fetches under the new type). Neither origin ever clears the selected posting. The selection persists across reloads under the unchanged `copilot-practice-interview-type` key, defaults to `general`, reads back `general` for an unrecognized stored value, and — even when storage cannot be written — a selection made in this tab still applies for the rest of the tab, with the picker's helper text saying so.

**Amended (chunk A — interview type):** this case originally sent the reviewer to `onInterviewTypeChange` in `PracticeClient.js` — a callback this chunk collapses to one line — and to `hello-world/app/copilot/practice/useInterviewType.js`, a path this chunk moves; both step 1 and step 2 are rewritten to name the subscriber, the pure duty-composer module it delegates to, and the module's new location, and step 3 is new. The Expected no longer describes a single invalidation sequence living inside `onInterviewTypeChange`: it states the two sequences the duty list now runs depending on the change's origin, which is the property AC-A11 exists to protect — a foreign-window click must never abandon a recording in progress or revoke a finished take's replay.

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

**Amended (regression pass, defect 1):** the "empty when a posting is selected whose application turns out to have no submitted documents" clause above stopped being the whole rule once R-227's company-research cue shipped: that cue reaches this exact state (posting selected, non-embedded engine, document load settled, neither document found) and always uses Gemini, so `postingGroundingNotice` now names that destination there instead of staying silent — see R-227's own "silent branch was the wrong answer" note. The corrected rule: that branch is empty ONLY when the posting additionally has no company on file (`hasCompany: false`) — `companyBriefRequest`/`useCompanyBrief` never issue a company-research request for a companyless posting, so there is nothing left to disclose. `postingGroundingNotice` shipped with no such guard at all — every fixture in `groundingNotice.test.js` fixed `company: "Acme Corp"`, so a titled, companyless posting (reachable: `normalizePostingRows` drops a row only when it has NEITHER a title nor a company) was never exercised, and the branch asserted a Gemini request while `useCompanyBrief`'s fetch could never fire for it. Guarded now, matching `companyResearchDestination`'s own `hasCompany` check exactly; `groundingNotice.test.js` pins both outcomes.

### R-099 | area: submitted-docs | parallel-safe: yes | automatable: no

**Summary:** The submitted-documents panel states only what was actually found, and can never write to the prep context.

**Steps:**
1. Read `hello-world/app/copilot/SubmittedDocs.js`.
2. Read its two call sites: `hello-world/app/copilot/CopilotClient.js` and `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** The panel is rendered by both modes, and by each ONLY when a posting is actually selected — never present in an empty or disabled state. Its collapsed header states what was actually found for the current selection: both documents, only the resume, only the cover letter, neither, still loading, or load failed — never a generic claim. Each document that was not found is stated as not found rather than rendered as an empty box that could be mistaken for a short one. Long documents scroll within a bounded height instead of pushing the rest of the screen down. The component takes no `onChange` and no prep-context prop of any kind — it has no prop through which it could write to the prep context, which is what guarantees selecting, changing, or clearing a posting never touches what the user typed there.

### R-100 | area: submitted-docs | parallel-safe: yes | automatable: no

**Summary:** Selecting a posting in live mode grounds the answers and invalidates drafts grounded in the previous one.

**Steps:**
1. Read `onPostingChange` and the `PostingPicker` render in `hello-world/app/copilot/CopilotClient.js`, and `runDraft` in `hello-world/app/copilot/useLiveSession.js` (group M moved the pipeline out; `answerCacheRef` and its invalidation deliberately stayed in the component).
2. Read the `label` and `blankHint` defaults in `hello-world/app/copilot/PostingPicker.js`.

**Expected:** The picker stays enabled at all times, including while a session is live — unlike the mode toggle and audio-source picker, which disable once live — because the user may realize mid-interview that they picked the wrong posting. Changing OR clearing the posting clears `answerCacheRef`, for the same reason editing the prep context does: every cached draft was grounded in the previous application's documents and must not be served afterwards. `runDraft` passes the selected posting's own id as `applicationId`, reading it from a ref so a stable callback's async body sees the latest selection. The picker's `label` and `blankHint` defaults are practice mode's exact original strings, so practice mode's rendering — including the composed "no tracked postings yet" helper text — is unchanged.

**Fixed (chunk N1):** this case was FAILING when group M's stage 10 audited it, on three pre-existing defects: an in-flight draft repopulated the cache after invalidation cleared it; the prediction path discarded the grounding `useCopilotDashboard` handed it; and a prep-context edit made from practice mode never reached live mode's cache-clearing wrapper. All three are closed by R-152. Note the invalidation-on-change behaviour this case describes was never sufficient on its own - clearing a cache does not stop a pending write from refilling it - so the load-bearing protection is now the grounding comparison on READ, not the clear on change.

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

### R-106 | area: live-dashboard | parallel-safe: yes | automatable: no

**Summary:** A question the dashboard is not sure was asked can never be mistaken for one the interviewer actually asked, and an unmeasured reading is never rendered as a number.

**Steps:**
1. Read `CurrentQuestionPanel`'s `provisional` branch, the shared `AccentPanel` wrapper it renders through, and `DeliveryPanel`, in `hello-world/app/copilot/dashboard/CopilotDashboard.js`.

**Expected:** An unconfirmed question is visually distinct from a confirmed one (a different wrapper, an accent treatment, and a chip naming the SPECIFIC uncertainty — `chipLabel="Unconfirmed"`, which `AccentPanel` requires rather than defaults), AND says in words that the interviewer may not have asked it. The failure mode being designed against is a candidate glancing at this mid-interview and confidently answering a question nobody asked, so visual distinction alone is not sufficient and neither is the text alone: the accent card AND the chip AND the sentence, never one of the three standing in for the others. The pace panel says pace is not being measured yet whenever `measured` is false, and never renders `0 wpm` or a label — an unmeasured signal is reported as unmeasured, the same rule the body-language work established.

**Narrowed (prediction removal):** this case was written as "a predicted question can never be mistaken for one the interviewer actually asked", against the two prediction panels, their "Prediction" chip, and the answer panel being tied to the predicted question rather than the current one. The predicted next question and its pre-drafted answer are deliberately retired (R-237), so those clauses are struck — they have no subject left. Two requirements survive and are why this is narrowed rather than deleted. (a) The pace panel's unmeasured rule never had anything to do with predictions and is unchanged. (b) The three-part bar — visual distinction alone is not sufficient, and neither is the text alone — is now exactly what `CurrentQuestionPanel`'s provisional/"Unconfirmed" treatment must meet, and that branch is the last caller of the shared accent card (renamed `PredictionPanel` -> `AccentPanel`, with `chipLabel` now required rather than defaulting to "Prediction"). A provisional question is a REAL detected utterance of unclear speaker, not a guess about the future, so the failure this case names arrives there unchanged.

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

**Expected:** There is ONE dashboard component and ONE dashboard hook (`useCopilotDashboard`), used by both modes — not a live implementation and a practice copy. The whole reason practice mode has a dashboard is that the candidate rehearses against the instrument they will be reading during the real interview, so a fork here defeats the feature; this is the same argument that made `livePace.js` import `answerMetrics.js`'s thresholds rather than restate them. Layout, panel treatments, and every state (loading, error, empty, measured/unmeasured) are shared verbatim. `LIVE_COPY` holds live mode's exact pre-existing strings and is the DEFAULT for the `copy` prop, so live mode passes nothing and renders unchanged — the same "defaults are the incumbent mode's strings" discipline `PostingPicker.js`'s `label`/`blankHint` use. `PRACTICE_COPY` spreads `LIVE_COPY` and overrides only sentences that would be untrue with no interviewer in the room, so a string added later cannot leave either mode rendering `undefined`.

**Amended (prediction removal):** this case's closing sentence required practice mode's prediction disclaimer to state that the predicted question is not necessarily the question practice mode will serve next. The predicted next question and its pre-drafted answer are deliberately retired (R-237), so that sentence is struck — there is no disclaimer and no predicted question to disclaim. Everything else is unchanged and is now load-bearing in a narrower way: `PRACTICE_COPY` still spreads `LIVE_COPY` and still overrides only the sentences that would be untrue with no interviewer in the room, and the one dashboard component / one dashboard hook requirement is what stops the removal being taken as licence to fork the two modes apart.

### R-110 | area: practice-dashboard | parallel-safe: yes | automatable: no

**Summary:** The practice dashboard never spoils the answer to the question on screen.

**Steps:**
1. Read `CurrentAnswerPanel` and the `answerHidden` prop in `hello-world/app/copilot/dashboard/CopilotDashboard.js`.
2. Read how `hello-world/app/copilot/practice/PracticeClient.js` passes `answerHidden`, `onRevealAnswer`, and the `questions` array it synthesizes.

**Expected:** In practice mode the current-answer panel shows a reveal button until it is pressed — it does NOT populate on its own. Practice mode's entire drill is answering cold (AC-G1), and a dashboard that put the model's answer on screen the moment a question appeared would quietly remove the thing being practised. The `answerHidden` check comes BEFORE any status branch, so a draft that is loading or already cached still stays hidden. Live mode passes neither `answerHidden` nor `onRevealAnswer` and reaches none of this. Crucially the panel is driven by the SAME `useSampleAnswer` instance the question card's own toggle uses, so revealing in either place reveals in both: two independent visibility flags for one draft would let the card and the panel disagree about whether the answer is showing, and the user would trust whichever they happened to be looking at.

### R-111 | area: practice-dashboard | parallel-safe: yes | automatable: yes

**Summary:** A cached sample answer is free on reveal, not merely fast, and is never served under grounding it was not built from.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sampleAnswerState.test.js`.
2. Read `useSampleAnswer.js`'s cache and `queue`.

**Expected:** All tests pass. This is practice mode's counterpart of live mode's `answerCacheRef`. The cache is keyed by `normalizeQuestion(question)` — the same normalization the reveal path looks up with — and if those two expressions ever diverge nothing errors, the cache simply never hits, so they must be checked AGAINST EACH OTHER rather than each read in isolation. The cache's surviving primer is `useSampleAnswer.queue` (R-141), which drafts the CURRENT question the moment it lands and never touches the hook's state: an answer the user has not asked to see must not put itself on screen, and must not disturb a draft already on screen for a different question. `cachedSampleAnswerFor` returns null — meaning draft it properly — for a missing entry, for an entry whose points are empty or malformed (a blank answer that renders like a finished one), and when the profile, interview type, or application id differs from the current value; each of those three is tested independently so a missing comparison on any one is caught. It encodes the same staleness rule as `needsRedraft`, so the two are asserted against each other rather than only separately. Retry and Regenerate always bypass the cache.

**Amended (prediction removal):** three things are struck. (1) The pre-draft/prediction cost argument this case shared with the retired R-105 — "pre-drafting roughly doubles the model calls a predicted question costs, and the cache hit on reveal is what pays that back" — has no subject left now that the pre-drafted answer for a predicted question is deliberately retired (R-237). The keying requirement it was used to justify is NOT struck and needs no cost argument: a key mismatch is silent, and that is reason enough. (2) Step 2's `PracticeClient.js`'s `onPrefetchedAnswer` is gone with the feature; `prime` is gone too, and the state-untouched property it carried now belongs to `queue`, which is named in its place. (3) The closing paragraph about `draftedFrom` and the pre-draft carrying the grounding it was ACTUALLY built from went with `useCopilotDashboard.js`'s pre-draft leg — the general rule survives in R-152, which owns the grounding comparison for both modes. The `cachedSampleAnswerFor`/`needsRedraft` agreement, the `normalizeQuestion` keying, the three independently-tested staleness comparisons, and Retry/Regenerate bypassing the cache are all unchanged.

### R-113 | area: practice-dashboard | parallel-safe: yes | automatable: no

**Summary:** Practice-mode pace is measured from audio time.

**Steps:**
1. Read the `onTranscript` handler and the `useCopilotDashboard` call in `hello-world/app/copilot/practice/PracticeClient.js`.

**Expected:** `recordSpeechSample` is called for FINAL frames only, with the provider's own `start`/`duration`, never a wall-clock substitute and never a fabricated zero — `appendSpeechSample` drops unusable timing itself, so the caller does not pre-filter. `start()` calls BOTH `resetForSession` functions: `usePracticeAnswer` and `useCopilotDashboard` each return one, and the dashboard's must be renamed at the destructuring site. Dropping either one is silent — a previous session's speech bleeding into the next session's pace reading, or a stranded answer clock, with nothing erroring — so both calls must be present.

**Amended (prediction removal):** the "speculative work never starts before a session" half is struck, along with the `active: running` reasoning behind it — `useCopilotDashboard()` now takes no arguments at all, so there is no `active` to pass and no speculative request for it to gate (R-237). The pace half is untouched, and so is the two-`resetForSession` requirement: it is still exactly as silent a failure as it was, only the leaked state is now the rolling speech window rather than a stale prediction.

### R-114 | area: practice-notices | parallel-safe: yes | automatable: yes

**Summary:** Extracting the practice privacy notice changed no wording, and the save switch is still read at upload time.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/practiceNotices.test.js`.
2. Read `hello-world/app/copilot/practice/PracticeClient.js` where it calls `buildPrivacyNotice` and where it passes `isSaveEnabled`.

**Expected:** All tests pass. The notice module is pure — no React, no imports from `app/` — and its tests pin the output string for every combination of engine, frames switch, posting, document-load state, and save switch against an oracle captured from the pre-extraction implementation. This is a mechanical extraction of text a user relies on to know where their video and transcript go, so "looks the same" is not the bar: every branch is asserted byte-for-byte. The hedge/assert/omit split survives — while the submitted-document load is unsettled the clauses say "may", once settled they name only the document(s) actually found, and the critique clause falls silent when neither was found rather than repeating a blanket claim. `PracticeClient` still passes the plain `readSaveEnabled` FUNCTION to `doneAnswerFlow` as `isSaveEnabled`, not the hook's render-time value: the upload it gates happens seconds later, after the critique settles, and latching the switch at click time would make toggling it mid-critique do nothing.

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

**Amended (group L), part 2 — `deriveCues` no longer drops a blank, it holds the position.** The clause above says "anything that shortens to nothing returns an empty string so the caller drops it rather than rendering a blank bullet." `shortenToCue` still returns `""`, but `deriveCues` and `resolveCues` now KEEP that entry, so the returned array always has exactly one element per cleaned point. Dropping it was correct when a cue WAS the bullet; it became a defect the moment cues started pairing with points. Reproduced: a three-point answer containing one terse sentence ("I did.") yielded two cues for three points, and `answerLines`' all-or-nothing pairing then discarded EVERY cue in the draft — one short sentence anywhere silently removed the bold lead-ins from the whole answer, on all four surfaces, via four separate route paths. `answerLines` correspondingly pairs against the RAW cues array, never `cleanAnswerPoints(cues)`, because cleaning re-drops the placeholders and re-creates the bug. Cleaning POINTS and cleaning CUES are different operations now: a blank point is not a line, a blank cue is a line without a lead-in. The all-or-nothing rule itself is unchanged and still fires on a genuine count mismatch (a model returning two cues for three points).

**Amended (group L): a cue is no longer what the UI renders INSTEAD of the point — it is rendered in front of it.** Everything above is unchanged and still correct about what a cue IS. What was wrong was the render decision built on top of it. `answerBullets` returned the cues and used the full sentences only as a fallback, so a real three-point answer reached the user as "Product Curriculum Lead / Tech covered: SQL, APIs / Familiar with platforms" — the sentences behind those cues were drafted, cached, derived into `answer`, and never shown to anyone. The user's verdict was "this section is not helpful", and it was accurate: those fragments cannot be spoken and say nothing. The cue's purpose — a few words absorbed in the two seconds before you start talking — is real, so the fix is a bold cue lead-in followed by its sentence, not a reversal back to sentences alone. See R-132.

### R-118 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The posting's own vocabulary is offered as a list to work in, and the posting description still grounds nothing.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/postingBuzzwords.test.js app/api/copilot/answer/route.test.js lib/copilot/applicationDocs.test.js`.

**Expected:** All tests pass. This is the first time the posting description has been an input to `/api/copilot/answer` at all, and AC-H7.27 is unchanged: the description reaches the buzzword miner and nothing else. The route proves it on a request where a description IS present — neither the answer-mode prompt nor the points-mode prompt contains any of its text. The separation is structural rather than remembered: `fetchPostingDescription` is its own function beside `fetchApplicationDocs` precisely so no prompt builder is ever handed an object that happens to carry the description. Both prompts still receive only the submitted résumé/cover letter.

The distinction being drawn is deliberate and is the reason the constraint survives: material an answer is GENERATED from can make a candidate claim experience the posting described rather than experience they have; a list the candidate reads and chooses from cannot, because they decide which terms they can honestly say.

`postingBuzzwords` returns only terms that literally occur in the posting — a canonical taxonomy name is an inference, and telling someone to say "Microsoft Teams" because the posting said "team" would put a false term in their mouth in a live interview (the same recorded hazard R-087 and R-096 guard elsewhere). Relevance to the current question and draft outranks the extractor's own score AND outranks the taxonomy/RAKE tier, because this list answers "say these here", not "these are the important words in the posting". A posting the technology taxonomy barely matches still returns terms, via the RAKE topic tier. Output is capped, de-duplicated case-insensitively, and deterministic. `fetchPostingDescription` scopes on both `id` and `user_id`, and degrades to an empty string — never throws — for a missing id, a missing user, no row, a query error, no joined position, or a null/non-string description.

**Amended (group L): relevance now DECIDES membership, not just order, and "a posting the taxonomy barely matches still returns terms" is deleted — it was the bug.** The sentence above about relevance outranking score and tier was true and did nothing, because relevance was tested with `literallyMentioned(canonical, question + points)` — an exact substring match that almost never fires. With every candidate scoring zero, the ranking collapsed to the posting's global top terms, which are constant for a given posting. Reproduced: three unrelated questions against one posting returned the byte-identical array `["Education","CRM","Agile","SDLC","Artificial Intelligence","Communication"]`. The user reported it as "the words from the posting to work in are always the same". An irrelevant term is now dropped outright rather than ranked last, and there is deliberately **no top-terms fallback tier** — that fallback IS the constant list. A question nothing in the posting relates to yields `[]` and no row at all. See R-133.

### R-119 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The role and project offered beside an answer are the candidate's own, from the résumé they actually submitted, and are labelled honestly.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/resumeAnchor.test.js app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. `resumeAnchor` scores every parsed role against the question AND the drafted points, not the question alone — a question like "Tell me about a time you took ownership" is too short to discriminate, while the draft has already selected the material that mattered. The project is drawn from the bullets of the role just named, widening to the whole résumé only when that role has none: a project attributed to one employer while the label beside it names another is worse than no project at all. `pastWorkExperienceLine` is reused rather than re-derived, so a cover letter's "I am applying for..." opener can never be presented as a project (the same disqualification the drafted answer applies).

`matched` reports whether the role was chosen for OVERLAP or is merely the most recent one on file, and the UI's label changes with it — calling an unmatched role a "closest match" would claim a relevance that was never computed. Every returned value literally occurs in the material: the test walks each word of the project back to the résumé text. Returns null for empty material and for material where nothing parses as employment; returns a project with an empty role when a bullet is usable but no role header parses. The résumé is preferred over the prep-notes profile because the ask was specifically for the job title and company from the submitted résumé; the profile is the fallback only when no résumé was submitted. Deterministic.

**Amended (group L): "every returned value literally occurs in the material" was true of `title`/`company` and was not enough.** A value can be a verbatim quote from the résumé and still be a lie about what it IS. Reported verbatim: "Collaborated with business leaders **at** and development teams to translate product roadmaps into detailed requirements" — `roleText()` joining a title and company that `parseEmploymentHistory` had torn out of a wrapped, marker-less résumé bullet. Both halves occur literally in the résumé; neither is a job. `parseEmploymentHistory` is best-effort by design and is shared with the résumé-tailoring flow, so it was deliberately left alone; the plausibility gate lives in `resumeAnchor` because that is what PRESENTS these fields to a candidate. `project` and `description` survive a failed header gate — they come from the role's own bullets and are still true — and the UI falls back to a "From your resume" label. See R-134.

### R-120 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Both modes of the answer route carry the three reading aids, and every one of them degrades to absent rather than to an empty section.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.test.js`.

**Expected:** All tests pass. Answer mode returns points, cues, answer, type, grounding, buzzwords and resumeAnchor; points mode returns the same minus `answer`/`grounding` — those two remain answer mode's alone (R-089). The aids are computed identically for both modes and both engines from the same two pure modules, so live and practice can never show different aids for the same question and no aid depends on which engine drafted the answer. On the embedded path `cues` are always derived; on the Gemini path they are the model's when it returned one per point and derived otherwise, and that fallback is asserted with a deliberately mismatched model response.

With nothing to build from — no posting selected, no submitted résumé, no prep profile — `buzzwords` is empty and `resumeAnchor` is null, which the UI renders as no subsection at all. This is the load-bearing half of the case: an empty header under a drafted answer reads as a failure, and these are ordinary states, not errors.

**Amended (group L):** `idealProject` now carries a third field, `summary`, alongside `shape` and `metrics`. More importantly, the "degrades to absent" half of this case has a second, much commoner trigger than "nothing to build from": a posting IS selected and its documents ARE loaded, but nothing in it relates to the question being answered, so `buzzwords` is `[]`. That state is now ordinary rather than exceptional, and the route-level case asserts it directly — not only the everything-missing case this was originally written for.

### R-121 | area: live-dashboard | parallel-safe: yes | automatable: no

**Summary:** Every surface that shows a drafted answer shows the same one, in the same form, including one served from cache.

**Steps:**
1. Read `answerLines` in `hello-world/lib/copilot/answerPoints.js` and the shared `app/copilot/AnswerLines.js` component that renders its output.
2. Confirm that pair is what produces the bullets in ALL THREE answer surfaces: `app/copilot/practice/SampleAnswer.js`, `app/copilot/QuestionFeed.js`, and `CurrentAnswerPanel` in `app/copilot/dashboard/CopilotDashboard.js`. No surface may hand-roll the `ul`/`li` markup.
3. Confirm `app/copilot/AnswerAids.js` is the only place the buzzword and role/project subsections are rendered, and that `SampleAnswer.js`, `QuestionFeed.js` and `CurrentAnswerPanel` all render it.
4. Read the cache writes in `app/copilot/practice/useSampleAnswer.js` (`request`'s then-handler and `queue`) and `app/copilot/useLiveSession.js` (`runDraft`'s success path), and the cache read in `runDraft`'s not-forced branch - `runDraft` moved to the hook in group M.

**Expected:** `answerBullets(cues, points)` returns the cues when there are any and the full points otherwise, and no surface writes that choice out for itself. This is the same failure `cleanAnswerPoints` was extracted for (BUG-J6, where two copies of one filter had already drifted), applied to a decision made in twice as many places — a dashboard panel still rendering full sentences beside a card rendering cues would read as two different kinds of thing.

**Amended (group L):** step 1 previously named `answerBullets`, which no longer exists — it returned the cues INSTEAD of the points and is the bug R-132 documents. The four surfaces now render a cue AND the sentence behind it, through one shared `AnswerLines.js` component rather than four hand-rolled copies of the markup, so this case's "one decision, one place" requirement is stricter than it was: the four copies of the `ul`/`li` markup were verified byte-identical before being replaced.

`AnswerAids` renders nothing at all when given neither buzzwords nor a role/project, so a surface can pass it through unconditionally.

Every cache entry — a real draft and live mode's reused-answer path — stores the cues and both subsections alongside the points. A cache hit that dropped them would render a visibly poorer panel than the same question drafted fresh, which is the opposite of what "reused" is meant to signal. An entry written before these fields existed (a session open across a deploy) resolves to the empty shapes, so the surface falls back to the full points and omits the subsections rather than crashing or showing empty headers.

**Fixed (group M / chunk N1):** this case was FAILING when it was audited. Two causes, both now closed: `runDraft`'s cache-hit branch never cleared a prior `error`, so a question that had failed and was later served from cache rendered its answer beneath a stale red "Failed to draft." alert and announced it as an error - while the dashboard, which gates on `status` rather than on truthiness, showed the same entry as fine; and `QuestionFeed` hand-rolled its own "which entry is current" as `questions[questions.length - 1]` while the dashboard had moved to `latestQuestionEntry`, so the two surfaces could describe different questions at the same moment. `QuestionFeed` now imports that selector, keeping one decision in one place.

**Amended (prediction removal):** the fourth answer surface is gone. `PredictedAnswerPanel` is struck from step 2 — three surfaces remain (`SampleAnswer.js`, `QuestionFeed.js`, `CurrentAnswerPanel`), and the group L note above should be read as three rather than four — and `prime` and `onPrefetchedAnswer` are struck from step 4's list of cache writes, leaving `useSampleAnswer`'s `request` then-handler and `queue` plus `runDraft`'s success path. The paragraph explaining why `AnswerAids` is deliberately NOT rendered in `PredictedAnswerPanel`, and why its data still had to travel on the `onPrefetchedAnswer` payload, is struck outright: the panel it reasoned about no longer exists (R-237). `AnswerAids` rendering nothing when given nothing is kept — step 3 rests on it and it never had anything to do with predictions. "A pre-draft" is likewise struck from the list of cache-entry kinds; the requirement that EVERY entry stores the cues and both subsections is unchanged and still applies to the ones that remain. Nothing here weakens the case: one decision in one place is the whole point, and it is now checked across three copies instead of four.

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
1. Read the `role="status"`/`aria-live="polite"` element and where it sits relative to the surrounding conditional content in each of: `hello-world/app/copilot/QuestionFeed.js` (ONE region at the `QuestionFeed` level, reading the LATEST entry of `questions` — not one per `QuestionCard`), `hello-world/app/copilot/dashboard/CopilotDashboard.js` (`CurrentAnswerPanel`), and `hello-world/app/copilot/practice/SampleAnswer.js`.
2. With NVDA or JAWS running, draft a FRESH answer (a question not asked before this session) on each of the three surfaces and confirm an announcement is heard once each draft finishes. (For `CurrentAnswerPanel` in practice mode, reveal the answer first — the hidden state is R-110/R-122's case, where this region is intentionally silent regardless of draft status.)
3. On the SAME three surfaces, separately and explicitly ask a question a SECOND time (or otherwise trigger the R-111/R-121 cache — e.g. an interviewer repeating a question in live mode) so its card/panel resolves straight to `status: "done"` on its FIRST render, with no visible loading spinner in between. Confirm an announcement is STILL heard for this specific case. This step is not satisfied by step 2 and must not be skipped: a reviewer who only performs the structural check in step 1 and the fresh-draft check in step 2 has NOT exercised the cache-hit path this case exists for, and must run step 3 before marking R-124 passed.

**Expected:** In every one of the three surfaces the status element is rendered UNCONDITIONALLY — never nested inside the surface's own `{visible/done/... ? (...) : null}` content block — styled with the shared `visuallyHidden` constant exported by `lib/copilot/answerStatus.js` (a plain object literal; NOT `@mui/utils`, which this repo does not depend on) rather than hand-rolled CSS, and fed `answerStatusMessage(...)` (`lib/copilot/answerStatus.js`, R-123) on every render. This is deliberate, not incidental: a live region that MOUNTS at the same moment its content is already inside it is not reliably announced by NVDA/JAWS — only a TEXT CHANGE on an already-mounted node is. `QuestionFeed.js` is the sharpest case for step 3: a REUSED answer's card starts life already `status: "done"` — `useLiveSession.js`'s `addQuestion` (moved out of `CopilotClient.js` in group M) seeds `status: "loading"` (auto-draft is on by default) and synchronously calls `runDraft`, whose cache-hit branch sets `status: "done"` before any `await`, so React 18 batches both into the card's very first render. A region living on that card would therefore mount already carrying its final text and go unannounced — which is why its region instead lives one level up, at `QuestionFeed`, mounted outside the `questions.length === 0` branch (so it exists before any question does) and reading whichever entry is latest, so a reused answer's arrival is a text change on an already-mounted region rather than a new node appearing with its final text already inside it. `SampleAnswer.js` is the sharpest case for step 2: its whole answer panel is conditionally rendered on `visible`, so its status span sits OUTSIDE that conditional (immediately after the toggle button's `Stack`, mounted with `""` while hidden). Before this, the only thing announced in live mode was the draft button's own label changing ("Draft answer" -> "Drafting…" -> "Redraft") — which said nothing to a user not focused on that button, and nothing at all on the dashboard panels, which have no such button.

**Amended (prediction removal):** this case covered FOUR surfaces; it now covers three. `PredictedAnswerPanel` is deliberately retired (R-237) and is struck from step 1 and from the surface count in steps 2, 3 and the Expected. Nothing else changes: the structural rule (the region rendered UNCONDITIONALLY, outside the surface's own conditional content block, so a text change rather than a mount is what announces), the shared `visuallyHidden` constant, and the two sharpest cases — `QuestionFeed.js` for the cache-hit path in step 3 and `SampleAnswer.js` for the fresh draft in step 2 — are all on surviving surfaces, and step 3 is still not satisfied by step 2.

### R-125 | area: copilot-a11y | parallel-safe: yes | automatable: no

**Summary:** Heading levels under `/copilot`'s h2 descend one level at a time, with no level skipped.

**Steps:**
1. Read every `Typography` in `hello-world/app/copilot/`, `hello-world/app/copilot/dashboard/`, and `hello-world/app/copilot/practice/` that carries `variant="subtitle2"`, `variant="h6"`, or `variant="h4"`, and check its `component=` prop.
2. With a browser accessibility-tree inspector (or a screen reader's heading-navigation list) open on `/copilot` in both live and practice mode, walk the heading list top to bottom.

**Expected:** `app/components/TabHeader.js` is UNCHANGED — it still renders `component="h2"` with no `component=` override anywhere in this fix — because it is shared by every other tab (`ApplyingControls.js`, `AutoApplyQueueTab.js`, `LibraryEditor.js`, `LiveFeedTab.js`, `TrackingTab.js`, `app/page.js`), and this fix touches only files under `app/copilot/`, so whatever heading structure those other tabs already have is provably unaffected. Every panel/section title one level under that h2 — `CopilotDashboard`'s own title, `QuestionFeed`'s "Detected questions", `SubmittedDocs`'s "Submitted resume"/"Submitted cover letter", practice mode's `QuestionCard` question text, `AnswerReview`'s "Answer review", `AnswerFeedback`'s "Answer feedback", and `PracticeHistory`'s "Practice history" — carries `component="h3"`. Every title nested one level under one of THOSE — `CopilotDashboard`'s panel titles (`RealPanel`/`AccentPanel`) plus its pace panel title, `AnswerReview`'s "Body language"/"Replay"/"What was heard", and `AnswerFeedback`'s `BulletList` titles plus "Body language feedback" — carries `component="h4"`. Nothing in this tree goes a level deeper than h4, so h5 is never needed and therefore never skipped either. `AnswerFeedback`'s score number (`{feedback.score}`) carries `component="span"`: it used to be an h4 nested inside the panel's own (then-h6) title — the second half of the "h6 then h4 inside it" defect — and a numeric score is a data value, not a section title, so it is removed from the heading outline entirely rather than assigned a level. Every change here touches only `component=`; `variant=`, and therefore the visual size/weight of every one of these strings, is byte-for-byte unchanged.

**Amended (group L):** this case used to close by saying "`app/copilot/AnswerAids.js` is unchanged". That is now literally false — the file was rewritten and renders TWO `dl`s rather than one. The a11y property the clause was actually protecting is unaffected and still deliberate: neither `AnswerAids.js` nor the new `app/copilot/AnswerLines.js` introduces a heading element of any kind, so the three parents that enclose them still supply `h3`, `h3` and `h4` and the outline is unchanged. Restated as a property rather than as a claim about a file's history, so it cannot go stale again.

**Amended (prediction removal):** "`CopilotDashboard`'s FOUR panel titles (`RealPanel`/`PredictionPanel`)" named a count and a component that no longer exist — the two prediction panels are deliberately retired (R-237) and the shared accent card is now `AccentPanel`. Restated without the count, as the property this clause was always protecting: whatever panel wrappers `CopilotDashboard` renders, their titles sit one level under its own `h3` and therefore carry `component="h4"`. The h2/h3/h4 outline, the "nothing goes deeper than h4" rule, and `TabHeader.js` being untouched are all unchanged — removing panels cannot skip a heading level, but renaming one and leaving a stale name here would send a reader looking for a component that is not there.

### R-126 | area: copilot-a11y | parallel-safe: yes | automatable: no

**Summary:** A failed draft is announced as an error, not shown as a plain colored sentence.

**Steps:**
1. Read the `q.error` branch in `hello-world/app/copilot/QuestionFeed.js`'s `QuestionCard` and the `current.status === "error"` branch in `hello-world/app/copilot/dashboard/CopilotDashboard.js`'s `CurrentAnswerPanel`.
2. Force a draft failure on both surfaces (e.g. disconnect the network mid-draft) and compare the visual treatment against `SampleAnswer.js`'s existing error state.

**Expected:** Both branches render MUI `<Alert severity="error">`, matching the sibling error path (`SampleAnswer.js`) — never a bare `<Typography sx={{ color: "var(--danger)" }}>`. `Alert` sets `role="alert"` and renders its own icon, so the failure is no longer a colour-only signal (WCAG 1.4.1) and is announced without depending on where focus happens to sit. Neither branch gained a Retry action: `CurrentAnswerPanel` has no redraft callback wired to it from either caller, and adding one is out of scope here — this is styling/semantics parity with the sibling paths, not new functionality. `QuestionFeed.js` gained an `Alert` import for this.

**Amended (prediction removal):** the two prediction panels this case cited as sibling error paths — `PredictedQuestionPanel` and `PredictedAnswerPanel` — are deliberately retired (R-237), so `SampleAnswer.js` is named in their place, in both step 2 and the Expected. It is a surviving error path and was always the closest comparison: it is the other place a failed sample-answer draft is announced. The closing note that `CopilotDashboard.js` "already imported `Alert` for its two prediction panels" is struck as well; that file still imports `Alert`, but now for `CurrentAnswerPanel`'s own error branch — the very branch this case requires — so the observation no longer says anything. The requirement itself is unchanged: `Alert severity="error"`, never a colour-only `Typography`, and still no Retry action on either branch.

### R-127 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** A committed_transcript(_with_timestamps) that only re-delivers the span of the final_transcript(_with_timestamps) that already landed is delivered for `speechFinal` but never counted twice.

**Steps:**
1. Read `_emitTranscript` in `hello-world/lib/copilot/stt/elevenlabs.js` and the `textAlreadyDelivered` field documented on `onTranscript` in `hello-world/lib/copilot/stt/index.js`.
2. Read the guards in `hello-world/app/copilot/practice/usePracticeAnswer.js`'s `recordTranscriptEvent` (via `acceptedAnswerFinal` in `hello-world/lib/copilot/answerWindow.js`), `hello-world/app/copilot/practice/PracticeClient.js`'s `onTranscript` handler, and `hello-world/app/copilot/useLiveSession.js`'s `onTranscript` handler (moved out of `CopilotClient.js` in group M).
3. Run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.test.js lib/copilot/stt/deepgram.test.js lib/copilot/answerWindow.test.js` from `hello-world/`.

**Expected:** `ElevenLabsStream` retains the last isFinal:true frame's `{ text, start, duration }` it delivered; a later isFinal:true frame whose text, start, AND duration all exactly match it is still delivered (consumers need its `speechFinal: true`) but carries `textAlreadyDelivered: true`. The match requires all three fields — two genuinely different utterances that happen to share the same words but start at different times are both delivered, un-flagged, and a frame with no usable `words` array (start/duration both `undefined`) is never treated as a match either, since `undefined === undefined` proves nothing about whether it's really the same span. The flag is absent (never explicit `false`) on every other frame, so Deepgram's frames — proven by an explicit no-regression case — and any consumer written before the flag existed see byte-identical objects. `acceptedAnswerFinal` (answerWindow.js) rejects a final carrying the flag even when it is otherwise perfectly in-window and collecting; `usePracticeAnswer.js`'s `recordTranscriptEvent`, `PracticeClient.js`'s session-transcript append and pace-sampler feed, and `CopilotClient.js`'s `appendFinal`/`recordSpeechSample`/interviewer-utterance assembly all skip the TEXT for a flagged frame while still honouring `speechFinal` for question detection. Before this fix a five-entry answer transcript rendered as A, A, B, B, C and reported word count / filler count / words-per-minute at roughly double the true value.

### R-128 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** A wpm no human voice can produce is flagged as an implausible measurement, not clamped into a smaller number and not asserted as delivery fact to the critique model.

**Steps:**
1. Read `MAX_PLAUSIBLE_WPM` and `paceIsPlausible` in `hello-world/lib/copilot/answerMetrics.js`, and `normalizeMetrics`'s/`buildDeliveryNotes`'s implausible-pace handling in `hello-world/lib/copilot/critiqueLocal.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerMetrics.test.js lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** `computeAnswerMetrics` sets `paceIsPlausible: false` once `wordsPerMinute` exceeds 300 (a physical ceiling, distinct from the existing RUSHED_WPM_MIN=170 delivery band) — it never clamps the number itself, so a measurement fault stays visible as a fault instead of rendering as a plausible-looking, wrong one. `critiqueLocal.js`'s `normalizeMetrics` independently RE-DERIVES `paceIsPlausible` from the numeric `wordsPerMinute` it just normalized rather than trusting whatever a client payload claims, in both directions: a client that (falsely) claims `paceIsPlausible: true` at an impossible wpm is overridden to `false`, and a client that (incorrectly) flags a genuinely plausible wpm as implausible is overridden back to `true`. `buildDeliveryNotes` cites the wpm as fact ("You spoke for N seconds at N words per minute...") only when plausible; when not, it reports that speech was captured and that the pace measurement points to a data problem, without stating the impossible number — which is what keeps it out of `app/api/copilot/critique/route.js`'s "MEASURED DELIVERY METRICS... treat those numbers as ground truth" prompt section as a fact to cite. No score moves: `computePaceScore`/`computeDeliveryScore` still key off `paceLabel` alone, proven by a case that holds `paceLabel` fixed while flipping `wordsPerMinute` across the ceiling and asserting `critiqueAnswerLocal`'s score is byte-identical either way.

### R-129 | area: practice-setup | parallel-safe: yes | automatable: no

**Summary:** Practice mode's setup and session controls render and behave identically after being extracted out of PracticeClient, and nothing was lost in the move.

**Steps:**
1. Read `hello-world/app/copilot/practice/PracticeSetup.js` and `hello-world/app/copilot/practice/PracticeControls.js`, then the two call sites in `hello-world/app/copilot/practice/PracticeClient.js`.
2. From the repo root, dump the pre-split file and diff its comment set against the union of the three post-split files:
   `git show <the commit before the split>:hello-world/app/copilot/practice/PracticeClient.js > /tmp/pc-head.js`
   then extract every `//`, `/* */` and `{/* */}` line from that dump and from the three current files, sort each set, and diff.
3. From `hello-world`, run `wc -l` on all three files.
4. Grep both new files for `useState|useEffect|useRef|useCallback|useMemo`.

**Expected:** Both new files are PURELY presentational: no hooks, no handlers, no derived values — every value arrives as a discrete prop computed exactly where it was computed before, following the flat-prop convention `QuestionCard.js` already established. The comment diff shows ZERO removals; the only additions are the two new module docs. This check is the whole verification, because this repo runs vitest with `environment: "node"` and no jsdom, so no test can render either component and a textual oracle against the pre-split file is the only real proof the move was faithful.

The comment check is not ceremony. Several of the moved comments encode reasoning that cost a fix round to learn and would be silently expensive to lose: BUG-J2's explanation of why the embedded-engine caption must NOT claim the guarantee is "separate from" pre-drafting (understating a protection is still a false privacy claim), AC-J1.6's note that the microphone is one piece of hardware whose selection and storage key both live in CopilotClient, and AC-J2.7's note on why the pre-draft switch shares a row with the two switches it was named alongside.

`PracticeClient.js` is at or below 900 lines. The gate is 1000 and the file was at 990 before this extraction, with two queued features both adding threading to it. The extraction stopped at 840 rather than a lower target: driving it further would have required bundling unrelated state into ad-hoc objects invented at the call site, which is a new derived value, not a faithful move. A number reached by trimming comments or collapsing JSX would NOT satisfy this case — an earlier extraction in this repo landed the file at exactly 999 that way, which is why the comment diff in step 2 exists.

**Known follow-up:** `app/copilot/CopilotClient.js` is 937 lines and has the same two seams (an audio-source/mic/consent/posting setup block and a Start/Stop/Auto-draft controls block). It was deliberately NOT bundled into this change — two extractions in one diff is unreviewable — and remains uncovered by this case.

**Amended (prediction removal):** step 2's oracle is no longer "ZERO removals" against the original pre-split commit, and cannot be. The predicted next question and its pre-drafted answer are deliberately retired (R-237), which took the "Pre-draft predicted answer" switch out of `PracticeControls.js` and `preDraftPredicted` out of `PracticeClient.js`, and with them two of the three comments this case singles out by name: AC-J2.7's note on why the pre-draft switch shared a row with the two switches it was named alongside, and the pre-drafting half of BUG-J2's "separate from" explanation (that comment survives, rewritten, now that the row holds only the two remaining switches). AC-J1.6's microphone note is untouched. The check itself is NOT retired and is still the whole verification for a future move of this code — this repo has no jsdom and no test can render either component — but its baseline is now the current files rather than the pre-split commit, and a removal must be traceable to a case in this document that retired the behaviour, as these two are. An unexplained removal still fails.

### R-130 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The ideal-project benchmark can never be lifted into an answer as a claim, and never states a number the posting did not.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/idealProject.test.js app/api/copilot/answer/route.test.js`.
2. Read the ideal-project block in `hello-world/app/copilot/AnswerAids.js`.

**Expected:** All tests pass. This block describes work the candidate did NOT do — that is its purpose, and it is the only part of the sample-answer panel with that property. Everything about it exists to stop a candidate reading it under interview pressure and claiming it out loud, which is the failure R-087 exists to prevent, arriving from a new direction.

`idealProject` emits no digit sequence that is not literally present in the posting: the numbers it shows ("5+ years", "2M requests") are the posting's own, and everything else is a metric CATEGORY ("latency reduction %", "uptime / reliability %") — a kind of number to have ready, never a fabricated figure. Terms in `shape` survive the same `literallyMentioned` filter `postingBuzzwords` uses, so a taxonomy inference the posting never wrote can never appear. Blank, missing or non-string input returns `null`, so no posting selected renders no block at all rather than an empty header. Output is deterministic.

The rendered wording is third person throughout — "Roles like this look for:" and "Metrics to have ready:" — and is asserted to contain no first-person pronoun. It carries the accent treatment `PredictionPanel` uses (`var(--accent)` border, `var(--accent-soft)` background) plus a "Benchmark, not from your resume" chip, NOT the plain description-list styling the résumé-derived rows use. That visual separation is load-bearing, not decoration: it sits directly beside "Project to talk about", which is quoted from the candidate's real résumé, and a user glancing mid-interview must never mistake one for the other (the same argument as AC-I3.20). The chip deliberately carries no em dash — an em dash is not spoken at default screen-reader punctuation, so the contrast it was carrying would be lost.

**Amended (group L) — two of the three claims above no longer hold, and one is now stronger.**

1. **Posting numbers are gone entirely.** "The numbers it shows ('5+ years', '2M requests') are the posting's own" was the bug, not the safeguard. A user's posting stated "Salary range:78,496.00 -105,974.00" twice in two formats, and the block rendered `Metrics to have ready:78,496, $105,974, $78,496.00, $105,974.00` — the SALARY BAND, four times over (the dedupe key was the exact string), consuming the whole `MAX_METRICS` budget so the real categories were never reached. The grounding argument was sound and the conclusion was still wrong: a posting's digits are its salary, its years-of-experience floor and its headcount, and no regex separates those from a project metric because postings do not state project metrics. `POSTING_NUMBER_RE` and `postingNumbers` are deleted; `metrics` is now category phrases only and is asserted to contain **no digit at all**. `MAX_METRICS` is 3. See R-135.
2. **The accent box and the chip are gone.** The visual-separation ARGUMENT is unchanged and still load-bearing; what changed is where the disclosure lives. It moved into the row's own `dt`, which now reads "Ideal project — not from your resume". That is strictly stronger than the chip it replaces: it is permanent, it cannot be scrolled past as decoration, and a screen reader announces it as the TERM the value belongs to rather than as a stray label inside the value. The row keeps a single `2px` left rule in `var(--accent)`, and colour still never carries the meaning alone (WCAG 1.4.1) — the label text does. The accent-tinted box was one of four competing visual languages in a component the user described as "all over the place"; see R-136.
3. **`shape` is joined by a new `summary` sentence.** `shape` alone restated the buzzword chips two rows above it, which is why the user's verdict on this block was "there's no substance to the project section". The advisory sentence is still third person and still asserted to carry no first-person pronoun.

### R-131 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** Every phrase shown to the candidate is a contiguous fragment of ONE source line — word membership is not enough.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/resumeAnchor.test.js lib/copilot/idealProject.test.js`.

**Expected:** All tests pass. `resumeAnchor`'s `description` is a `string[]`, one independently-shortened phrase per source bullet, and is NEVER joined into a single string anywhere — not in the module, not in `AnswerAids.js`, which renders one element per phrase. `project` and each `description` element are asserted to be contiguous substrings of a single line of the source material, not merely composed of words that appear somewhere in it.

This case exists because of BUG-K2, and the shape of that bug is the point. `description` was built by joining two bullets, producing "Built a payments migration platform serving Mentored four junior engineers through the promotion process" — two unrelated accomplishments spliced into one sentence, the first truncated mid-phrase. The module's own "never invents a word" test PASSED on it, because every individual word does occur in the résumé. A word-membership assertion is structurally incapable of catching phrase-level fabrication; only a contiguity assertion is. This is the same gap that let an earlier defect emit "Ubled the throughput" while a word-level check stayed green, and it will keep recurring wherever mined text is shown to a user, so the contiguity form is the one to reach for.

`description` excludes the bullet already used as `project`, is empty when the role has no second usable bullet, and the block does not render at all when empty. A motivation line is never surfaced as role scope, via the same `pastWorkExperienceLine` disqualification the drafted answer uses.

**Known limitation, deliberately not fixed here:** `significantTerms` filters through the shared tailor-lite stopword list, which contains "team". So a question about "leading a team" scores zero overlap against a bullet reading "Led a team of six engineers", and `matched` reports false — the label then honestly says "Most recent role" rather than "Closest role", but the role scoring is weaker than intended for common interview vocabulary. Fixing it needs a resumeAnchor-local allowlist reasoned about deliberately; the shared list must NOT be edited, since the tailoring pipeline depends on it.

### R-132 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A drafted answer is shown as a short cue AND the sentence behind it — never as a cue with its sentence thrown away.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/answerLines.test.js lib/copilot/answerPoints.test.js`.

**Expected:** All tests pass. `answerLines(cues, points)` returns one `{ label, cue, point }` per cleaned point and `point` is never empty. This replaces `answerBullets`, which returned the CUES ALONE and used the sentences only as a fallback — the reported bug, where a real three-point answer reached the user in its entirety as "Product Curriculum Lead / Tech covered: SQL, APIs / Familiar with platforms" while the speakable sentences behind them sat in the same response, unrendered.

`points` is the source of truth for how many lines there are: a cue with no point to head makes no sense (a cue for WHAT?), so the cleaned points array alone decides the length and cues attach to it, never the reverse. Cues pair POSITIONALLY and only when the two cleaned arrays are the same length — the same all-or-nothing rule `resolveCues` applies (R-117), for the same reason: a cue against the wrong beat sends a candidate down the wrong line of their own answer. Any mismatch, including a draft cached before cues existed, drops every cue and renders the sentences alone, which is byte-for-byte the pre-cue rendering.

A STAR label is carried exactly once, on `label`, stripped from both the point and its cue, so the UI never has to choose between two copies; `STAR_LABEL_RE` is imported from `answerLocal.js` rather than re-declared, because a second copy of the pattern the prompts emit is free to drift from the one they actually use. A cue is dropped to `""` for its own line when it is empty after label-stripping, equals its point modulo case and trailing punctuation, or is not strictly shorter by word count — a model that returns the sentence as its own cue must not render "X — X".

`answerBullets` is DELETED rather than kept alongside. Two functions rendering one answer is precisely the drift `answerPoints.js` was created to end, after its own filter had already diverged between two copies. Note that ESLint here does **not** catch a call to a deleted named export — no rule resolves named imports, and the call keeps `no-unused-vars` quiet — so `npm run build` is the only gate that catches it.

A point that is ONLY its own STAR label (the literal `"Situation:"`) is dropped from the result rather than rendered as a labelled blank bullet. It survives `cleanAnswerPoints` because it is non-blank, and only becomes empty after the label comes off — the same rule that module already applies to a blank point, applied one step later. The drop happens AFTER cue pairing is resolved (the cue is looked up by the pre-drop index inside the map, and the filter runs on the result), so dropping an entry from the MIDDLE of a draft cannot shift every later cue onto the wrong point.

All four surfaces render through one component, `app/copilot/AnswerLines.js`, rather than four hand-rolled copies of the `ul`/`li` markup — the four were verified byte-identical before being replaced, so nothing was silently flattened. The cue (with its label) is in a `<strong>`, semantic emphasis rather than a styled span, and the cue and its sentence stay inside ONE `<li>` in reading order so a screen reader announces them as a single item rather than two unrelated bullets.

**Known limitation, accepted deliberately:** the em dash separating cue from sentence is not spoken at default screen-reader punctuation settings, so the two run together audibly ("Product Curriculum Lead I spent three years as..."). Unlike R-130's chip, no MEANING is carried by the dash here — it separates a summary from its own expansion, both of which are read in full and in the right order — so the cost is a missing pause, not a lost distinction.

### R-133 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The posting words offered for an answer are about the question on screen, and are absent rather than constant when nothing fits.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/postingBuzzwordsRelevance.test.js lib/copilot/postingBuzzwords.test.js`.

**Expected:** All tests pass. Two different questions against the SAME posting produce different lists — asserted directly, because the reported bug was that they did not. A question about higher-education technology platforms surfaces "Education" and "SQL" and does NOT surface "CRM", "SDLC" or "Artificial Intelligence"; a salary-expectations question surfaces nothing at all.

Relevance runs two independent signals against `question + points`, and both are needed. **Canonical intersection** runs the SAME `extractKeywords` over the question/draft that already ran over the posting, so an alias the taxonomy knows resolves the same way on both sides ("higher education" → `Education`); a second, cheaper heuristic would let the two disagree about what a term means. **Word overlap** covers everything the taxonomy has no alias for, with a deliberately dumb trailing-`s`/`es` plural fold so a question saying "CRMs" matches a posting term "CRM".

Word overlap requires **all** of a term's significant words to be covered, not any one of them. This is load-bearing and was found by testing: with "any", the word "salary" in a salary-expectations question matched the posting's own "Salary range:" line through the RAKE topic tier, and the section filled up with coincidental single-word overlap — the same class of noise the whole case exists to remove. A term whose words are all stopwords or shorter than three characters (a bare "Go", "R", "C") can never clear that bar and is reachable only via canonical intersection.

`literallyMentioned(canonical, description)` still runs FIRST and independently of relevance: a term can be exactly what the question is about and is still dropped if the posting never said it (the "team" → "Microsoft Teams" hazard). `MAX_BUZZWORDS` is 4. Order is overlap count, then tier, then extractor score, then discovery order — fully deterministic for one (posting, question) pair. A taxonomy failure on EITHER extraction degrades the section to `[]` rather than breaking the answer around it.

**Known limitation, deliberately not fixed here — read this before "improving" the gate.** Both relevance signals require the term's own concept to be present in the question or draft already, so this row now CONFIRMS vocabulary rather than SUGGESTING it. Demonstrated: against an infrastructure posting naming Kubernetes and Terraform, the question "How do you approach infrastructure work?" returns `[]` even with a draft saying "container platform", "infrastructure modules", "pipeline" and "deploys" — because none of it contains the literal words "Kubernetes" or "Terraform", and the taxonomy resolves no shared canonical. Arguably that is the case where naming Kubernetes would help most.

Fixing it needs deterministic topical relatedness, and the two obvious sources do not provide it. Widening to "same taxonomy CATEGORY" is far too coarse — every technical question would surface every technical term, which is the constant list this case exists to eliminate, wearing a different hat. Bridging through `skill_groups.json` was investigated and rejected: those groups are the USER'S OWN résumé vocabulary, not a general ontology (they contain "Drupal", "Zoom", "Git" and no Kubernetes at all), so they would invent relationships rather than find them. The current gate is kept because it demonstrably fixed the reported failure and produces genuinely per-question output on real postings; a future fix needs a real relatedness source, not a looser threshold. Anyone loosening this must first re-run the three-questions-one-posting check at the top of this case.

### R-134 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A résumé bullet is never presented as a job title or an employer, and the project survives when the header cannot be read.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/resumeAnchorPlausibility.test.js lib/copilot/resumeAnchor.test.js`.

**Expected:** All tests pass. The reported string — "Collaborated with business leaders at and development teams to translate product roadmaps into detailed requirements" — is asserted unproducible. A field earns display only if it still reads as a NAME once out of the parser: at most 6 words and 60 characters, capitalised, not opening with a verb from the shared `ACHIEVEMENT_VERBS` (imported, never re-declared), and carrying no sentence punctuation mid-string. "Product Curriculum Lead", "Senior Software Engineer", "VP of Product", "Acme Learning" and "Acme, Inc." all survive.

**`title` and `company` are gated as a PAIR, not independently, and that is the subtle part.** On the reported résumé the company half is obviously garbage, but the title half — "Collaborated with business leaders" — passes all four checks on its own: four words, capitalised, no stray punctuation, and "collaborated" is not in `ACHIEVEMENT_VERBS`. Gating in isolation would therefore still have rendered half the original bug as "Closest role on your resume". They are not independent observations: `parseHeader` tears both out of the same clump of header lines by splitting on commas, pipes, "at" and "@", so one non-empty field failing is evidence the SPLIT landed wrong, not that one half happens to be bad. One failing blanks both. A field that is merely ABSENT — the parser legitimately found no second segment — is not evidence of anything and never contaminates a good sibling; only non-empty text that fails the check does.

`project` and `description` are unchanged by a failed header gate: they come from the role's own bullets, they are still true, and the UI labels the row "From your resume" instead of naming a role. `matched` keeps its exact meaning — the gate changes which FIELDS are shown, never which role is selected. `parseEmploymentHistory` is deliberately untouched: it is best-effort by design, it is shared with the résumé-tailoring flow, and every résumé layout it cannot read would otherwise become a new special case in a parser serving two callers.

`gateHeaderPair` is exported alongside `resumeAnchor` for one specific reason: `parseHeader` splits every segment on `,\s+`, so a comma-bearing company like "Acme, Inc." can never reach `resumeAnchor`'s output as one string and no résumé fixture can route it through. Asserting the gate's own verdict on that literal is the only way to pin that a real comma-bearing employer is not rejected.

### R-135 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The benchmark names a kind of project in a sentence, and never quotes a figure out of the posting.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/idealProjectMetrics.test.js lib/copilot/idealProject.test.js`.

**Expected:** All tests pass. **Every entry in `metrics` is asserted to contain no digit at all** — not "no fabricated digit", no digit. A posting stating "Salary range: $78,496.00 - $105,974.00" (and restating it as "$78,496 - $105,974") produces metric categories only; the salary, the "5+ years" experience floor and the "12 campuses" headcount are all absent, in every form. `MAX_METRICS` is 3 and entries never repeat.

The reasoning matters more than the assertion, because the deleted code was defensible and still wrong. `POSTING_NUMBER_RE` was built so that every number shown was structurally guaranteed to be the posting's own — never fabricated — which is the same discipline that keeps `project` honest. But grounding a number does not make it a METRIC: a posting's digits are its compensation, its experience floor and its headcount, and it essentially never states a metric from a project a candidate should describe, so there is nothing there to mine and no regex that could tell the difference if there were. Mining is deleted rather than filtered, and the module now never reads a number out of the posting at all.

`summary` is one advisory sentence built from the same shape terms — "They want a project built around X, Y and Z, owned end to end, with a measurable outcome." — joined as ordinary prose rather than as a second rendering of the comma-separated `shape`. It is asserted to carry no first-person pronoun, for the same reason the rest of this block is third person: it describes work the candidate did NOT do, sitting next to a real quote from their own résumé. The `null` contract is unchanged — blank/non-string description, taxonomy failure, or zero surviving shape terms means no block at all.

### R-136 | area: sample-answer | parallel-safe: yes | automatable: no

**Summary:** The reading aids under a drafted answer read as one organised thing, in two groups, with the candidate's own material first.

**Steps:**
1. Open `/copilot`, pick a posting whose application has a submitted résumé, and draft an answer in live mode. Repeat in practice mode, and check the dashboard's current-answer panel, the question-feed card, and practice's sample-answer panel.
2. **In Safari, with VoiceOver on, reach the benchmark row in PRACTICE mode** and confirm the "not from your resume" disclosure is announced as part of the row's value. Practice mode captures with `getUserMedia`, so Safari is a supported route here — live mode's Chrome/Edge-only constraint does NOT cover this component.
3. Narrow the viewport below the `sm` breakpoint and confirm each label is visibly closer to its OWN value than to the next label.
4. Read `app/copilot/AnswerAids.js` and count: distinct `variant=` values, distinct `Chip` style objects, and accent/background/border treatments.

**Expected:** Two description lists inside one wrapper, grouped by WHOSE material it is: the candidate's role and project first, a divider, then the posting's words and the benchmark project. Both `dl`s share one grid style constant and one `Aid` row component. Exactly **two** `variant` values (`caption` on `dt`, `body2` on every value), exactly **one** `Chip` style, and the accent rule used exactly once. The `description` phrases are subordinate by COLOUR, not by a third font size.

This case exists because the user's report was not only about content: "the text/styling is all over the place. chips, then a header, then bold, then smaller, then a separate section" and "this section needs to be far more organized". The previous layout stacked four visual languages in one flat `dl` and put the posting-derived keyword row ABOVE the candidate's own résumé material.

**The disclosure lives in the VALUE, and this is the load-bearing clause of the case.** The benchmark row's `dd` opens with `<strong>Not from your resume.</strong>`, unconditionally, before the advisory sentence. An earlier version of this fix moved that disclosure into the row's `dt` and deleted the chip that had carried it, on the argument that a `dt` is announced as the term its value belongs to and is therefore strictly stronger. **That argument was refuted and the change reverted.** It depends on the `<dl>` keeping its description-list role — which the very next paragraph concedes `display: grid` drops in WebKit. On the engine where the role is gone, a `dt` is a bare text run and the disclosure is no longer attached to anything; the deleted chip, being text inside the `dd`, never had that dependency. A safety disclosure must not be carried by the one semantic this component knowingly gives up. Its sentence also ends in a period rather than being joined by an em dash, because an em dash is not spoken at default screen-reader punctuation — the same reason the original chip used a comma, a lesson this fix re-learned by breaking it.

Salience, not just presence, is part of the requirement: this row is the only one describing work the candidate did NOT do, sitting beside three rows quoting material they can. Bold text leading the value is what distinguishes it for a sighted user scanning values; a 12px muted label styled identically to its three neighbours is not, however permanent it is. Colour never carries meaning alone (WCAG 1.4.1).

Below `md` (**amended: this was `sm` until the mobile pass -- see R-157/R-159's group; the two-column form starved the value column to ~8px at exactly 600px, where the dashboard's own grid also flips to two columns**) the grid collapses to one column, ordered `dt, dd, dt, dd`, and **the gap inside a pair must be smaller than the gap between pairs** — `rowGap` is tightened at `xs` with a matching `dt` top margin (first row excepted). A single uniform `rowGap` puts a label exactly as far from its own value as from the next label, destroying the pairing on a phone; the layout this replaced did not have that flaw, and step 3 exists to catch it. Empty states: a group with no populated row renders neither its `dl` nor the divider; both groups empty renders `null`. A résumé whose header failed R-134's gate still renders its group, labelled "From your resume". No heading element is introduced at any point (R-125).

The buzzword `ul` carries an explicit `role="list"`. This is NOT redundant and must not be deleted as such: its `sx` sets `listStyle: "none"`, which strips the implicit `list` role in Safari/VoiceOver, and the chips are then announced as loose text with no indication of how many terms there are or that they form a set.

The group divider carries `role="separator"` and is **decorative reinforcement only — it does not carry the grouping.** Measured contrast against `--bg-soft` is 1.28:1 in both themes, and `--border-strong` only reaches 1.76:1, so it cannot meet WCAG 1.4.11's 3:1 floor and must never be treated as a meaningful graphical object. The grouping is carried by the row labels, each of which already names whose material it is ("Closest role on your resume", "Words from the posting to work in"). Do not "fix" the divider's colour under the impression it is load-bearing; if the grouping ever needs to be programmatic, give the lists accessible names instead.

**Known limitation, accepted deliberately:** `display: grid` on a `<dl>` can drop the description-list role in WebKit, and this component IS reachable in Safari via practice mode — the earlier justification that only Chrome and Edge matter was simply wrong, since that constraint belongs to live mode's `getDisplayMedia` capture, not to this component. The limitation is now benign rather than accepted-with-risk: no safety-critical text depends on the role any more, labels remain visible text immediately before their values in DOM order, and the content is complete and correctly ordered either way. Moving the grid off the `dl` would require wrapping each pair in a `div`, which breaks column alignment across rows.

### R-137 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The metric categories offered for a posting come from the bucket that best fits it, not the first one that matches a single word.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/idealProject.test.js lib/copilot/idealProjectMetrics.test.js`.

**Expected:** All tests pass. A "Senior Product Manager, Education Technology" posting returns product metrics (`adoption rate`, `user satisfaction / NPS`, `time-to-ship`) and NOT `latency reduction %`. An infrastructure-heavy posting still returns the infrastructure metrics — the fix must not simply invert the bug — and a posting matching no bucket still falls through to `GENERIC_METRICS`.

`categoryMetrics` used to walk `METRIC_BUCKETS` in DECLARATION ORDER and return as soon as it filled its quota. The infrastructure bucket is declared first and its pattern matches the single word "platform", so the posting above — which says "product manager" twice plus "product experience", "classroom" and "student", against exactly one incidental "platform" — was told to have latency and uptime figures ready. A candidate who prepares those for that interview has prepared the wrong thing. First-match-wins was silently doing the job a fit comparison should do.

Buckets are now scored by HOW MANY distinct matches their pattern finds in the posting, so one incidental word loses to five real ones; zero-scoring buckets are still skipped, ties break on declaration order so output stays deterministic, and `GENERIC_METRICS` still only tops up a short list. Which words each bucket recognises is unchanged. The R-135 contract is untouched and still asserted alongside this: no metric contains a digit, and nothing is read out of the posting's own numbers.

This is the third distinct way this one block has produced unhelpful output — the salary band (R-135), the term-list echo (R-130), and now the wrong domain entirely. The pattern worth carrying forward: a block that assembles advice from a taxonomy needs a test with a REALISTIC posting for a NON-default domain, because every failure here looked correct against the infrastructure-flavoured fixtures the module was originally written with.

### R-138 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The ideal-project benchmark is a worked example with invented figures, and the invented figures cannot escape it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/idealProjectNarrative.test.js lib/copilot/idealProject.test.js lib/copilot/idealProjectMetrics.test.js app/api/copilot/answer/route.test.js`.
2. Read the benchmark row in `hello-world/app/copilot/AnswerAids.js` and confirm the invented-numbers disclosure sits inside the `dd`, before the first figure in DOM order.

**Expected:** All tests pass. `idealProject` returns a fourth field, `project`, carrying a hypothetical project told as something a team actually did: a `title`, four sections labelled "The problem" / "What they built" / "How it ran" / "How it landed", and three `{ metric, figure }` outcomes. Every section body is at least 30 words. `shape`, `summary` and `metrics` are unchanged in meaning and content, and `idealProject.test.js` / `idealProjectMetrics.test.js` pass completely unmodified.

**This case deliberately reverses half of R-130/R-135, and the exact scope of the reversal is the point.** Those cases banned fabricated figures because this block sits beside "Project to talk about", quoted from the candidate's real résumé, and a figure there could be read aloud as theirs (R-087's failure from a new direction). The user asked for the opposite — "it needs to be written as though it's an actual project", then "insert realistic metric numbers in there as well" — because a benchmark that says "with a measurable outcome" and then shows no outcome is advice nobody can act on. So the ban holds exactly where it was earned: `metrics` is still asserted to contain no digit at all and is still the candidate's own checklist of metric CATEGORIES; every fabricated figure lives inside `project`, which the UI covers with one disclosure.

Note what is NOT claimed, because an earlier draft of this change did claim it and it is false: `shape` and `summary` are not digit-free and never were. `Section 508` and `HL7` are taxonomy canonicals, so a posting naming either puts a digit in both fields today. Those are names, not figures. Writing "no digit in shape/summary" into a test would pin a property the module does not have.

**Two structural guarantees carry the safety story, and each has its own assertion.**

1. **The posting's numbers are not an input.** Every figure is a hand-authored constant, and `buildProject` never receives the posting text at all — only an archetype key and the already-verified `shape` terms. Two postings differing only in a salary band stated twice in two formats, a years-of-experience floor, a headcount, a campus count and a percentage produce a deep-equal `project`. The percentage is in that fixture deliberately: `40%` is the shape a "mine the posting for something metric-like" implementation would reach for first, and it is the only percentage in any fixture. R-135's salary band cannot return through this door.
2. **Figures cannot cross archetypes.** `project.outcomes` is owned by the archetype, not looked up per entry of `metrics`. This is not a style choice. `categoryMetrics` tops `metrics` up from LOWER-ranked buckets and then from `GENERIC_METRICS` whenever the winning bucket has fewer than `MAX_METRICS` phrases of its own — the security bucket has only two — so a table keyed by metric phrase would caption a SOC-2 story with a p95 latency figure, and would show a newsroom staff writer "31% → 68% of licensed seats active weekly". That is R-137's complaint one level down, and archetype-owned pairs make it unconstructible rather than merely tested against. The live proof is visible on any security posting: `metrics` reads `incidents prevented, audit / compliance pass rate, cost saved` (the third topped up from generic) while `outcomes` reads `incidents prevented, audit / compliance pass rate, evidence-gathering time` — the archetype's own third, consistent with its own prose.

**The three substitution slots are selected by rule, not by rank, and each rule encodes a failure caught before it shipped.** `shape`'s ranking changes with the question, so "first term" is not a stable selector.

- `{D1}`, the setting, is the first `shape` term whose taxonomy category is `domain`, excluding whichever term was chosen as `{D2}` (every `TECH_TERMS` entry is itself a `domain` canonical, so without the exclusion a posting naming only "Artificial Intelligence" fills both slots with one word). Rank alone produced *"Surviving the peak day without a war room, in Infrastructure as Code."* on one posting under one question and "in Distributed Systems" on the same posting under another. Every `{D1}` occurrence in the copy is written as "…in ${d1}"; that fixed "in" is what lets a bare noun ("Education"), a multi-word one ("Distributed Systems") and an archetype's prose default ("a support organisation") all substitute in and stay grammatical. The slot is never the grammatical subject of its sentence, so nothing about its own shape can break the sentence around it.
- `{D2}`, the capability doing the work, is restricted to a four-entry allowlist of terms that read correctly as the subject of "…doing the unglamorous part". `Cloud Computing`, `Data Science` and `Analytics` were tried and rejected: `Cloud Computing` is reachable from this repo's own existing infrastructure fixture and produced *"Cloud Computing rolled out region by region behind a flag"*.
- `{M}`, the delivery method, is `Agile` or `Scrum` and nothing else. `Kanban`, `Waterfall`, `DevOps`, `Lean` and `Infrastructure as Code` are all `methodology` canonicals and all reachable, and every archetype's "How it ran" copy describes two-week or weekly increments — which is false of every one of them. *"Waterfall: two-week sprints … a demo every second Friday"* and *"Kanban: weekly increments"* are fabrications about the posting's own vocabulary, the same class of error `literallyMentioned` exists to prevent for `shape`. Those postings take the unlabelled `ranWithout` variant instead: the example project still ran in two-week increments, it simply is not given a name that would make the sentence a lie. A posting naming no methodology has never had one invented for it and still does not.

**Accepted limitation, covered by its own case:** a posting whose only shape term is a methodology (`shape: "Scrum"`, from a real support-operations posting) has nothing left for the setting slot, so it falls back to the archetype default and the example carries no posting-specific subject matter beyond the methodology name. It must still render complete, grammatical, and with no unsubstituted `{…}` token anywhere.

**`buildProject` returns fresh objects on every call.** The archetype table is module-level state in a long-lived server process, so returning `archetype.outcomes` by reference meant one careless `.sort()`, `.reverse()` or field assignment anywhere downstream would corrupt every subsequent answer for every user until restart — and nothing would report it, because the payload stays well-formed. The table is deep-frozen as a second line of defence, so a future by-reference return throws in strict mode rather than corrupting silently. Determinism here means the same VALUE, never the same object; the case that mutates a returned result and then re-calls is what pins it.

**The rendered block.** The row keeps its label, its `2px` `var(--accent)` left rule and its existing `<strong>Not from your resume.</strong>` first line. Under it: the disclosure ("**A worked example, invented.** The numbers below are made up, to show what a strong answer for this posting sounds like. Replace every one of them with your own."), the title, the four sections as `<strong>{label}.</strong> {body}`, and the outcomes as a real `<ul>`/`<li>` with markers left INTACT — `listStyle: "none"` is deliberately not set, because it strips the implicit `list` role in Safari/VoiceOver (R-136) and, unlike the buzzword `Stack` above it, this really is a `ul`, so there would be nothing to restore the role with. `pl: 2.5` keeps the markers clear of the row's accent rule instead of letting the ~40px browser default shove the list right of every other line. Labels are separated from their values by a period or a colon, never an em dash: an em dash is not spoken at default screen-reader punctuation, which R-136 learned twice.

The whole worked example is gated on BOTH `sections` and `outcomes` surviving normalization, not either alone — a half-built block would either put the "numbers below are made up" disclosure over no numbers, or a figure list over no narrative to anchor it. Either coming up short falls all the way back to today's rendering.

**When the outcomes list renders, the trailing "Metrics to have ready:" line does not.** It restates the same category names two lines below the list that just gave them with worked examples — R-130's term-list echo verbatim ("there's no substance to the project section… it was just the buzzword list two rows above, repeated"). `metrics` stays in the payload and is still the line that renders for an entry cached before this change, which is now the only path producing the old two-line block. No heading element is introduced (R-125), the component keeps exactly two `variant` values and one `Chip` style (R-136), and the accent-tinted box stays deleted.

This is the fourth distinct complaint about this one block — the salary band (R-135), the term-list echo (R-130), the wrong domain (R-137), and now no substance at all. The pattern worth carrying forward is the one R-137 already named and this change re-proved twice over: every defect here was found by working a REAL posting for a NON-default domain through the code by hand. The infrastructure-flavoured fixtures the module was written with looked correct at every step.

**Amended, same group — four defects the regression pass found before this shipped, and one limitation accepted rather than fixed.** All four were invisible to the fixtures the feature was written with, and every one of them was found the same way R-137 already prescribes: by working a realistic posting for a NON-default domain through the code by hand. Three of the seven archetypes (`data`, `revenue`, `security`) were reachable in production and selected by no fixture at all, which is how the first of these shipped past a green suite. `ALL_POSTINGS` in `idealProjectNarrative.test.js` now carries a realistic posting per archetype; adding one is part of adding an archetype.

1. **A section began a sentence with a lowercase word.** The `data` archetype put its `{D2}` slot at a SENTENCE BOUNDARY and its own fallback is the lowercase `"the model"`, so any analytics posting that named no capability rendered "…the exact model and inputs that produced it. **the model** shipped behind a flag…". The sentence was rewritten to put the slot mid-sentence, and the case that pins it asserts the general rule — no `. ` followed by a lowercase letter, and a capital first character — across every archetype, because the same mistake anywhere else would read exactly as sloppy.
2. **The capability slot was filled in archetypes whose sentence cannot hold a capability.** `TECH_TERMS` was justified against ONE sentence — the product archetype's "…doing the unglamorous part" — but the slot is used in all seven. The infrastructure archetype's is the subject of "rolled out region by region behind a flag", a sentence about a service tier, so a posting naming Machine Learning produced "**Machine Learning rolled out region by region behind a flag**" — verbatim the construction the allowlist was introduced to prevent, arriving from the other side. `infra` and `security` now carry `capabilityFromPosting: false` and always use their own default. The grammatical justification for an allowlist is per-SENTENCE, never global; an allowlist checked against one sentence and applied to seven is not an allowlist.
3. **A standard, a regulation or a vendor product was used as the setting.** `pickD1` accepted any `domain` canonical, and 12 of the 80 in the taxonomy are not settings: `HL7`, `FHIR`, `C-CDA`, `EDI`, `EHR`, `HIPAA`, `Section 508`, `Epic`, `Cerner`, `Component Library`, `Reference Architecture`, `Technical Roadmap`. They are things a project complies with or runs on, not fields a project happens in, and the fixed "in" that makes the slot safe for any other noun phrase does not save them: "…, in HIPAA.", "…, in Cerner.", "Owning one problem end to end in Technical Roadmap, from…". A `NOT_A_SETTING` exclusion now skips them to the next candidate and ultimately to the archetype default. This also closes the one route by which the posting's own digits reached `project.title` — `HL7`, `C-CDA` and `Section 508` are all on the list.
4. **A figure spelled its numbers out.** The security archetype's third outcome read "three weeks of manual evidence → two days", carrying no numeral, in a three-item list beside "17 credential leaks…" and "…1 finding, down from 6". Showing what a real number looks like is the entire purpose of these, so every figure is now asserted to contain a digit.

**Accepted limitation: `literallyMentioned` cannot see negation.** A posting reading "We do not run Agile here — our delivery model is Waterfall with formal stage gates" still puts `Agile` in `shape`, and "How it ran" is therefore still labelled `Agile:`. This is not new and is not specific to this block: the same posting already produced `summary: "They want a project built around Waterfall and Agile…"` and an `Agile` chip in "Words from the posting to work in" (`postingBuzzwords`), because every one of them is built on the same whole-word literal-occurrence test. Fixing it here alone would leave two of the three surfaces still wrong while implying all three were correct, and fixing it properly means a negation parser over posting prose — a feature, not a patch, and one with its own false-positive failure mode ("no prior Agile experience required" is not a disavowal of Agile). Recorded here so the next person to find it knows it was seen and priced rather than missed.

**Amended again, same group — the worked example is bulleted, and its length is bounded in both directions.** The first version answered "written as though it's an actual project" with four paragraphs, and the verdict on it was "this is way too fucking verbose … keep the core with the project details and numbers, just make it much shorter and bulleted". That is a fair verdict on something read mid-question, in one glance, under interview pressure. Nothing was cut from the CONTENT — every project detail and every figure survives — only the length: title plus four sections went from roughly 220 words to 93.

- **Section labels are one word**: `Problem`, `Built`, `Ran`, `Landed`. A label leading a bulleted line earns its place only by being shorter than what it labels; "What they built" in front of a fifteen-word bullet is padding.
- **Each body is bounded at both ends** — at least 12 words, at most 28, with a 120-word ceiling on title-plus-bodies. The floor stops the sections decaying back into the one-line advice this whole feature replaced; the ceiling stops them growing back into paragraphs. Both are asserted, because only one of them was ever the risk at a time and the pair is the actual requirement.
- **`{M}` moved from a sentence-initial prefix to an adjective inside the sentence** — `Two-week Agile sprints, …` rather than `Agile: two-week sprints, …`. Under the bulleted rendering the old form put two colons on one line (`**Ran:** Agile: two-week sprints…`). The change also retires the whole class of defect where a slot at a sentence boundary renders a lowercase fallback mid-paragraph, since no slot begins a sentence any more.
- **The two preamble lines collapsed into one**: `**Not from your resume.** The example below and its numbers are invented. Replace them with your own.` The safety disclosure keeps its position — first in the `dd`, ahead of every figure — and both sentences are separated by periods, never an em dash. The `summary` sentence is no longer rendered when a worked example is present: it restated in a long sentence what the title and bullets show concretely, and it was the single longest line in the block. `summary` remains in the payload and is still what renders for a cached entry from before this feature, which is the path that must stay byte-identical to its old output.
- **The four sections render as a real `<ul>`/`<li>`**, markers intact, immediately above the outcomes list — two lists, the story then the numbers, with no heading between them (R-125). Label and body are separated by a colon, which is spoken.

### R-139 | area: copilot-live | parallel-safe: yes | automatable: yes

**Summary:** The verbal-filler reading sits beside the talking-speed one, measured over the same window, and neither can fake a reading it does not have.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/liveFiller.test.js lib/copilot/livePace.test.js lib/copilot/answerMetrics.test.js lib/copilot/critiqueLocal.test.js`.
2. Read `DeliveryPanel` in `hello-world/app/copilot/dashboard/CopilotDashboard.js`.

**Expected:** All tests pass. `computeLiveFillers` returns `{ fillerCount, fillerRate, fillerLabel, measured }` from the SAME `speechSamples` list and the SAME rolling window `computeLivePace` uses. The two readings render side by side, which is why they must share one list: two independently-windowed lists could each be internally correct and still describe two different spans of speech, making the pairing on screen a lie even though neither number was wrong.

**What counts as a filler is imported, never restated.** `FILLER_PHRASES` and `countPhrases` come from `answerMetrics.js` — the same matcher the post-answer review uses — so a live reading and a recorded-answer review can never disagree about the same sentence. `countPhrases` was made public for this and for no other reason. The matcher is specifically not re-implementable by eye: `phraseRegex`'s lookaround is what stops "um" firing inside "summary" and "right" inside "right-hand", which a plain `\b` boundary does not. `DISCOURSE_MARKER_PHRASES` ("like", "actually", "basically") stay counted separately and are NOT in this reading — BUG-7's distinction, which a live indicator folding them in would quietly undo, telling a candidate they are filling when they said "I like Python".

**Two deliberate differences from the pace reading, both asserted.** First, a filler RATE needs words, not time: `computeLivePace` refuses a zero-length span because it would divide by zero, but the same window is perfectly measurable for fillers, so the two can legitimately disagree about whether they have a reading and each says only what it knows. Copying the pace guard across is the obvious mistake and has its own case. Second, **zero fillers is a measurement, and a good one** — only too little speech is unmeasured. That is AC-I2.14's rule (an unmeasured signal is reported as unmeasured, never as a real-looking zero) applied to the one metric where zero is the target rather than the failure.

**The per-frame count is an ordinary enumerable field on the sample.** It was first written as a non-enumerable property, to avoid touching exact-shape `toEqual` assertions in `livePace.test.js`. That is the wrong trade and the case that pins it round-trips a sample list through JSON: a hidden field vanishes through any clone or rebuild, and the symptom is not an error but a filler rate that is silently too low while still looking like a real reading — the exact failure class `livePace.js`'s header already guards against for missing durations. The shape assertions were widened instead; none was deleted or weakened.

`FILLER_RATE_CLEAN_MAX` (1) and `FILLER_RATE_HEAVY_MIN` (5) are inclusive at both ends, deliberately unlike `paceLabelFor`'s strict `<`/`>` — the names say so, and a comment says not to "fix" the inconsistency. They are deliberately NOT `critiqueLocal.js`'s `FILLER_RATE_GOOD_PCT`/`FILLER_RATE_BAD_PCT`: those two are endpoints of a continuous score ramp, these two are boundaries of a label a person reads, and merging them would force one pair of numbers to do two jobs.

### R-140 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** The worked example is written per question by the model, and nothing the model returns reaches the screen unvouched-for.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/idealProjectGenerated.test.js lib/copilot/idealProject.test.js lib/copilot/idealProjectNarrative.test.js lib/copilot/idealProjectMetrics.test.js app/api/copilot/answer/route.test.js`.
2. Read `normalizeIdealProject` in `hello-world/lib/copilot/idealProjectPrompt.js`.

**Expected:** All tests pass. Reported: "the example projects are always this shit", the same product story pasted back across many questions on one posting. That was structural, not editorial — seven hand-authored archetypes cannot not repeat. The model now writes the example from the actual posting; the archetypes remain as the FALLBACK and `lib/copilot/idealProject.js` is untouched.

**The safety argument moved and got stricter, and that is the whole of this case.** R-138's guarantee was STRUCTURAL: every figure was a hand-authored constant and `buildProject` never received the posting text, so the salary band that produced R-135 was unreachable by construction. A model that reads the posting has neither property. So the guarantee moved from the generator to `normalizeIdealProject`, which returns `null` — never a repair, never a partial accept — for anything it cannot vouch for, and the caller falls back to a deterministic archetype. A half-repaired example is worse than a templated one: it is still on screen, still labelled a benchmark, and nothing downstream knows it was patched.

Six rules, each with its own case and each independently sabotage-checked (disabling any one fails exactly one test): the four labels present and in order; every body within the same word bounds a templated one obeys, imported from `idealProjectNarrative.js` rather than restated; no first-person pronoun anywhere; every `metric` free of digits and every `figure` carrying one; no leftover `{token}`, `undefined` or `[object`; and **no number that occurs in the posting**.

That last rule is the one R-135 earned. Every digit run in the example is compared against every digit run in the posting, separators stripped so `78,496` and `78496` match, and any collision rejects the whole example. It is deliberately blunt — one rule covering the salary band, the compensation restatement, the years-of-experience floor, the headcount and the campus count without trying to tell them apart — because telling them apart is exactly what R-135 concluded is impossible. Whole numbers are matched, not digit substrings: "9 weeks" must survive a posting containing "$105,974", and that has its own case, because the naive version rejects nearly every example.

The prompt asks for all of this correctly first, including an explicit instruction never to reuse the posting's own numbers, because a rejected response silently costs the user a fresh example and hands them a templated one instead. It never asks for, or mentions, the candidate's résumé, cover letter or prep notes — this is a benchmark of what a strong answer looks like, not a draft of theirs.

**Cost and failure posture.** The embedded engine makes no model call at all and stays fully deterministic, per this repo's standing rule that engine choice governs every AI feature. On the Gemini path the example call is issued CONCURRENTLY with the answer call, so the added latency is the max of the two and not the sum — this runs while the user is mid-question. Any failure — network, unparseable JSON, validation reject, no posting selected — falls back silently to the deterministic archetype and must never fail the request. `buildPointsPrompt` and `buildAnswerPrompt` are byte-identical: AC-H7.27 is unchanged, and the posting still never reaches either of them. The new prompt is a third, separate one.

### R-141 | area: practice | parallel-safe: yes | automatable: yes

**Summary:** One practice rep costs two clicks, and a press that is waiting on a question can never fire late.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/practiceFlow.test.js`.
2. Read the two effects in `hello-world/app/copilot/practice/PracticeClient.js` that call `autoStartDecision` and `shouldQueueSampleAnswer`.

**Expected:** All tests pass. Reported: "the workflow for the practice page needs to be a lot less clicks. next question should kick off the 'start answering' and should also queue up the sample answer." Next question -> Start answering -> Done -> Show sample answer becomes Next question -> Done, with the sample answer already drafted.

**The hard part is that the question arrives asynchronously**, so the press ARMS an intent and the arrival consumes it. Every way the arrival can go wrong DISARMS rather than leaving a press pending — a pending press fires on some later, unrelated render, which in a recorded practice session means the recorder starting at the worst possible moment. The cases cover: the fetch failing, the bank being exhausted, the session never having been live, and the user pressing Start answering manually in the gap. `loading` outranks a non-empty `question`, because the PREVIOUS question is still on screen while the next one loads and starting there records an answer to the question the user just moved off.

`onRetryQuestion` does NOT arm: a retry recovers from a failed fetch, it is not a deliberate "give me the next one and let me answer it". "Try again" DOES arm, and calls the decision synchronously at the click rather than through the watcher effect — `resetAnswerState`/`abandonInProgressAnswer` change none of the five values the effect watches when the question is already on screen, so the effect would never re-fire and the shortcut would silently not work for that path.

**Recording starts immediately, with no countdown, and that is safe for a measured reason rather than an assumed one:** pace and filler are computed on the AUDIO clock, never wall-clock (see `livePace.js`'s header and `answerMetrics.js`'s `speechDurationSec`), so the seconds a candidate spends reading the question before speaking do not drag either reading down. Dividing by wall-clock time already burned this app once as BUG-1c.

**Queuing makes the sample answer READY, never SHOWN.** It writes the cache through the same path `prime` already uses and never touches `state`. Practice mode hides the sample answer behind a reveal on purpose — seeing a model answer before attempting one is what makes practice worthless — so this must stay a cache write. It is gated by its own generation ref so a slow queue for a question the user has moved past writes nothing, deduped per question via `normalizeQuestion` (the same key the cache uses, so case and whitespace differences do not pay twice), and its errors are swallowed: a failed queue leaves the user with today's behaviour, a request on reveal, never an error on screen.

### R-142 | area: copilot-live | parallel-safe: no | automatable: no

**Summary:** Live mode fits a half-width window without scrolling the page, and its height is measured rather than predicted.

**Steps:**
1. Open `/copilot`, start a session, and set the browser window to half the screen width (~720px on a 1440-wide display).
2. Confirm the page itself does not scroll: the collapsed setup summary, the controls row and the dashboard all fit, and the dashboard's panels scroll internally if their content overflows.
3. Expand the setup disclosure mid-session and confirm the posting picker is still usable and the audio-source and microphone pickers are still disabled (AC-I1.7).
4. Expand the transcript/history disclosure and confirm it appears without breaking the layout.
5. Narrow below the `sm` breakpoint and confirm the page scrolls normally again.
6. Read `app/copilot/CopilotClient.js` and confirm no hard-coded viewport offset constant exists.

**Expected:** The user will dual-screen this during a real interview; the reported problem was "the amount of scrolling i have to do while in half a window mode needs to be cut down drastically". Asked what must stay visible without scrolling, they chose the current question and its drafted answer, the delivery readings, and the predicted question with its pre-draft — deliberately NOT the running transcript, which at `62vh` (and stacked at narrow widths, alongside the question feed at another `62vh`) was the tallest thing on the page.

The pre-session setup block is extracted into `app/copilot/SessionSetup.js` — the follow-up R-129 recorded and left open — and collapses to a summary line once a session is live, behind a real disclosure with `aria-expanded`/`aria-controls` whose collapsed content is unmounted or `hidden`, so the tab order and a screen reader agree with what is on screen. The dashboard's four panels go two-up from `sm` rather than `md`: at `md` a 720px half-window fell to one column and stacked all four, which was a large share of the complaint.

**The column's height is MEASURED, not predicted, and this is the load-bearing clause.** The first version hard-coded `LIVE_VIEWPORT_OFFSET = 420`, hand-summed from the page padding, title block, `NavTabs`, `TabHeader` and mode row, then rounded up from ~384 on the reasoning that guessing low means the page scrolls anyway. That constant is stale the moment anything above it changes, nothing can catch it (this repo has no jsdom, so no test renders this component), the deliberate over-rounding is dead space in a layout whose entire purpose is to not waste vertical room, and it cannot account for the share-instructions row or the error/warning alerts, which change height at runtime. The wrapper now measures its own distance to the top of the viewport and sizes itself against `100dvh` — `dvh` rather than `vh` so a mobile URL bar cannot push it below the fold.

**`minHeight: 0` on every flex child containing scrollable content is what actually makes this work.** Without it a flex item refuses to shrink below its content's intrinsic height and the column overflows regardless of the height calculation — the single most likely way this change silently fails. Below `sm` the height stays `auto` on purpose: a phone is not the dual-screen case and a fixed-height column there would be worse.

Every prior behaviour is preserved: the consent alert stays dismissible, the posting-grounding notice stays ungated by it (BUG-H4), the audio-source and microphone pickers keep their disabled-while-live rule (AC-I1.7), and the question feed still exists (AC-I5.30).

**Known follow-up, not yet done:** practice mode must get the identical shell. Both clients are already decomposed along the same seams (`SessionSetup`/`PracticeSetup`, and the two controls rows), so the layout itself should be extracted into one shared component with slots rather than built twice — `AnswerAids.js`'s own header records what happens otherwise, and `cleanAnswerPoints` was extracted only after its two copies had already diverged. `CopilotClient.js` is at 990 lines against the 1000 gate and `PracticeClient.js` at 954; that extraction is also what brings both back down.

### R-143 | area: sample-answer | parallel-safe: yes | automatable: yes

**Summary:** A generated worked example enriches the ideal-project aid; it never replaces it.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/idealProjectWiring.test.js`.

**Expected:** All tests pass. On the accept path the response's `idealProject` still carries `shape`, `summary` and `metrics` — computed deterministically — with `project` carrying the model's example instead of the archetype's. On the reject path it is the deterministic aid, complete, with four sections. With no posting (or no surviving shape term) it is `null`, and a generated example is NOT returned on its own: an example with no `shape`/`summary`/`metrics` beside it is the broken state this case exists to prevent.

**This shipped broken and nothing caught it, which is the part worth remembering.** `normalizeIdealProject` returns the shape of the `project` FIELD, and the route wrote `idealProject: generatedProject || deterministicProject` — substituting the field for the whole aid. `AnswerAids` then computed `hasIdealRow === false` and rendered nothing at all: no row, no "Not from your resume." disclosure, no example. The feature reached the user **only when the model call failed or was rejected**.

The suite was 2624 tests green over it. `route.test.js`'s `mockGemini` returns ONE canned payload for every `generateContent` call, so the second call — the one asking for a worked example — always came back as the answer payload, always failed validation, and always fell back. **The accept path had zero coverage**, and the unit tests for `normalizeIdealProject` were all in isolation, which is the "a test that can't fail hasn't verified anything" trap arriving through the mock rather than through the assertion. Every case in the new file mocks the two calls SEPARATELY, keyed on what each prompt actually contains; a mock that cannot tell two calls apart cannot test either one.

Two things that make this file work and are easy to get wrong when extending it: the request must carry `engine: "gemini"`, because `wantsEmbedded` defaults to the embedded no-LLM path and a request without it never reaches this code at all; and the posting fixture's embedded relation key is `positions`, not `position`, because that is what `fetchPostingDescription`'s select uses — get it wrong and every case fails for the wrong reason (no posting means no aid, rather than a mis-wired one).

**Amendment to R-140's number guard.** `digitRuns` matched `/\d[\d,]*/g` and stripped only commas, so a posting written with space or period thousands separators (`78 496`, `$105.974`) did not block the comma form in an example. A separator is now recognised only when followed by exactly three digits and not a fourth, which groups `78 496` and `$105.974` into single runs while leaving `4.1 days` as two independent runs that still cannot collide with a posting containing `41`. Numbers spelled out as words ("twelve campuses") remain out of scope — inherent to a digit-run rule, and recorded rather than silently ignored.

**Amendment to R-141 — the fetch-failure case was asserted against an input the component cannot produce.** `autoStartDecision` disarmed on an empty question, and the case supplied one. But `usePracticeQuestions`'s catch deliberately leaves `currentQuestion` in place (its own comment says so), so a failed fetch yields the PREVIOUS, non-empty question with `loading` back to false — and the decision returned `"start"`, firing the recorder on the question the user had just moved off, in a session that may be recording video. "Is there a question" is not evidence one arrived. The decision now takes `armedFrom` — what was on screen when the press armed — and disarms when the question is unchanged, compared through `normalizeQuestion` so case and whitespace cannot masquerade as an arrival. An empty `armedFrom` still starts: the first question of a session has no predecessor. "Try again" arms with an empty `armedFrom` deliberately, because it re-arms on the SAME question synchronously with no fetch gap, and comparing against the current question would falsely disarm the one path that has no arrival to wait for.

The lesson generalises past this case: a test can assert the right rule against a state the system never reaches, and it will pass forever while the real state goes unhandled. When a decision function is fed by a component, at least one case has to be derived from what that component actually produces on the failure path, not from what the rule says should happen.

**Amendment to R-139 — practice mode was never wired to the filler reading.** `PracticeClient` destructured `pace` but not `fillers` and passed no `fillers` prop, so `DeliveryPanel` rendered "filler: not measured yet" permanently in the mode where a candidate actually rehearses delivery — contradicting the shared-panel guarantee `CopilotDashboard.js`'s own header states. Both clients now pass it.

**Amendment to R-142 — the measured height was viewport-relative.** `getBoundingClientRect().top` is measured from the viewport, so the `calc` was only correct at `scrollY === 0`, and the `ResizeObserver` on `document.body` can fire at ANY scroll position — an alert appearing, the history disclosure expanding. At a non-zero scroll the column was sized taller than the viewport, reintroducing exactly the page scrolling this layout removes, and with no scroll listener the wrong value persisted until the next resize. It now measures `rect.top + window.scrollY`, the wrapper's document-relative offset, which does not change with scroll — so no scroll listener is warranted, and adding one would be pure cost.

**Amendment to R-139 — `computeLiveFillers` could report `NaN` as a measured reading.** Summing a sample whose `fillers` is not finite produced `{ fillerCount: NaN, fillerRate: NaN, fillerLabel: "noticeable", measured: true }`, because `fillerLabelFor(NaN)` falls through both comparisons — the UI would render "NaN% filler" beside "Some filler". Unreachable today (`appendSpeechSample` always sets the field), but the module's stated posture is that a signal it cannot measure is reported as unmeasured and never as a plausible number, so a non-finite sample now contributes nothing.

### R-144 | area: copilot-audio | parallel-safe: yes | automatable: yes

**Summary:** A live session can run on the microphone alone, for an in-person interview where there is no tab or system audio carrying the other person's voice. Before this, `start()` awaited the display-capture as its very first act, so an in-person interview could not start a session at all.

**Steps:**
1. Read `start`, `_startInPerson`, `_addSource` and `stop` in `hello-world/lib/copilot/session.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/session.inperson.test.js lib/copilot/session.test.js` from `hello-world/`.

**Expected:** `source: "inperson"` calls NO `getDisplayMedia` function -- not `captureTabAudio`, not `captureSystemAudio` -- and opens exactly one transcription stream, requesting diarization on it. The microphone is REQUIRED in this mode: its failure rejects out of `start()` with wording saying the session cannot start, and never reuses `micFailureMessage`'s "Continuing with interviewer audio only", which is false when the mic IS the session. `withMic: false` is ignored rather than producing a zero-source session whose `aggregateStatus()` reads "idle" while nothing transcribes. The `_stopped` re-check still runs after the `captureMicAudio` await (R-041). An unrecognized source value still falls back to the tab path, never to mic-only. `"tab"` and `"system"` are unchanged: two sources, no diarization requested, the frame reaching `onTranscript` byte-identical to before with no `speakerTag` own-key, and `onUtterance` never fired.

### R-145 | area: stt-diarization | parallel-safe: yes | automatable: yes

**Summary:** Deepgram diarization is strictly additive, and a diarized frame is split per speaker. The pre-diarization wire behaviour is what R-076 pins, and this feature must not disturb a single byte of it.

**Steps:**
1. Read `DEFAULT_PARAMS`, `connect()` and `_emitDiarizedRuns` in `hello-world/lib/copilot/stt/deepgram.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/` from `hello-world/`.

**Expected:** With diarization off or unrequested, the query string equals the frozen literal `model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=300` exactly, and `speakerTag` is an ABSENT key on the emitted frame -- not `speakerTag: undefined`, which vitest's `toHaveBeenCalledWith` would ignore while the object shape silently changed. With diarization on, `diarize_model=v1` is appended and nothing else changes; the deprecated `diarize=true` boolean is never sent, and never both. A diarized frame emits one call per contiguous run of same-speaker words, preferring `punctuated_word`, with each run's own `start`/`duration` derived from its own first and last word -- both ABSENT, never a fabricated `0`, when the underlying timings are missing (R-078's lesson: a `0` corrupts every derived delivery number without throwing). The frame's `speech_final` lands on the LAST run actually emitted; blank runs are skipped; a frame whose runs are all blank emits nothing. An unusable `words` array -- missing, `[]`, or no numeric `speaker` on any entry -- falls back to today's single whole-frame call rather than to silence.

### R-146 | area: copilot-speaker-identity | parallel-safe: yes | automatable: yes

**Summary:** Deciding which voice on a shared microphone is the candidate. This is the case that protects against the copilot going silently deaf mid-interview, which is what the first version of this logic actually did.

**Steps:**
1. Read `scoreSpeakers`, the confidence clauses, `shouldEvaluateAsQuestion` and `labelFor` in `hello-world/lib/copilot/speakerIdentity.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/speakerIdentity.test.js` from `hello-world/`.

**Expected:** `youScore = wordShare - (2 * questionRate)`, and BOTH the term and its coefficient are load-bearing: an implementation scoring on word share alone, or weighting the penalty at 1x, picks the wrong speaker in the pinned cases. `"high"` confidence requires all six clauses -- two distinct tags, four turns, somebody has asked a question, the argmax has asked NONE, the argmax has at least 40 words, and a margin of at least 0.15. Two counterexamples, both produced by running the original formula rather than imagined, must stay at `"low"`: (a) an interviewer's opening preamble (29 words, 3 turns, no questions from anyone) against the candidate's "Sounds good" scores 0.95 vs 0.05 and elected the INTERVIEWER; (b) a candidate opening with "Thanks for having me, how are you?" and "Great, shall we start?" trips `detectQuestion` twice, scoring -1.35 against the interviewer's 0.35, and elected the interviewer inside about fifteen seconds. Clause 5, the absolute 40-word floor, is the ONLY clause blocking (b) -- clauses 3 and 4 do not, because on that evidence the conversation genuinely looks inverted -- so it must not be replaced by another share-based test. The gate must still resolve a real interview (an interviewer asking twice, a candidate answering at length twice, resolves `"high"` to the candidate) or it has become useless rather than safe. `shouldEvaluateAsQuestion` returns false ONLY when the tag is the resolved user, AND identity is overridden or genuinely `"high"`, AND some OTHER tag has been observed to carry the evaluation (amended by R-219 -- suppressing the sole observed tag suppresses everyone) -- every tag is evaluated during cold start, because missing the interviewer's question is silent and permanent while over-evaluating the user's own speech is visible and bounded. `labelFor` and `shouldEvaluateAsQuestion` use DIFFERENT thresholds and must not be collapsed: with two voices heard and confidence still low, the transcript shows a best-guess label while BOTH voices are still evaluated. `labelFor` never returns `"you"` from a single observed voice.

### R-147 | area: copilot-speaker-identity | parallel-safe: yes | automatable: yes

**Summary:** Assembling per-speaker utterances from frames that can mix speakers. The drain rule exists because the obvious design deadlocks and silently loses the interviewer's question.

**Steps:**
1. Read `hello-world/lib/copilot/utteranceAssembly.js` and `_handleInPersonFrame` / `stop` in `hello-world/lib/copilot/session.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/utteranceAssembly.test.js lib/copilot/session.inperson.test.js` from `hello-world/`.

**Expected:** A speaker's buffer drains when EITHER a different speaker starts -- on a shared mic a speaker change is the end of a turn -- OR that speaker's own `speechFinal` arrives, whichever comes first. The speaker-change rule is not optional: with `endpointing=300`, a frame carrying `speech_final` routinely also carries the next speaker's opening words, so the first speaker's run is not last, never receives `speechFinal`, and without this rule its buffer never drains at all -- the question the copilot exists to answer is lost, and its text is later glued onto an utterance from minutes afterwards. A two-speaker frame ending in `speech_final` must yield BOTH utterances. `drainAll()` on session stop emits anything still buffered, so a speaker who is mid-sentence when the user presses Stop does not have their last words discarded. Buffers do not leak for tags that stop speaking.

### R-148 | area: copilot-speaker-identity | parallel-safe: yes | automatable: yes

**Summary:** A question from someone else is detected and answered exactly as fully as before, and the candidate's own speech cannot evict it from the panel they are reading.

**Steps:**
1. Read `handleUtterance`, `evaluateUtterance` and `addQuestion` in `hello-world/app/copilot/useLiveSession.js`, and `latestQuestionEntry` in `hello-world/app/copilot/dashboard/CopilotDashboard.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/session.inperson.test.js` from `hello-world/`.

**Expected:** In-person question routing keys off the session's `onUtterance` `evaluate` flag, NEVER off the `speaker` label -- the label is a best guess with a lower threshold, and routing on it reintroduces the silent-deafness failure. `"tab"`/`"system"` keep their existing `pendingRef` path untouched and are not double-detected. A confirmed question flows through the SAME path as before -- `confirmQuestion`, `addQuestion`, `runDraft`, `draftAnswer` -- so it still carries `points`, `type`, `cues`, `buzzwords`, `resumeAnchor`, `idealProject`, posting grounding via `applicationId`, and the `answerCacheRef` reuse keyed on `normalizeQuestion`; there is no parallel answering path. While identity is unsettled, a question detected from the provisionally-presumed user is marked provisional, and `latestQuestionEntry` prefers the last NON-provisional entry -- otherwise the candidate's own "Does that answer your question?" evicts the interviewer's live question and answer from the dashboard mid-answer. `recordSpeechSample` stays gated on the user's own speech only, so words-per-minute describes the candidate's delivery rather than the conversation.

### R-149 | area: copilot-speaker-identity | parallel-safe: yes | automatable: no

**Summary:** The transcript shows who it thinks is speaking, admits when it does not know, and lets the user correct it. Manual because this repo runs vitest with `environment: "node"` and has no jsdom, so no component here can be rendered by a test.

**Steps:**
1. Start the app, open the interview copilot, and select the in-person interviewer-audio option.
2. Before starting a session, confirm the share instructions do not mention sharing a tab or screen, and that "Chrome or Edge only" is absent.
3. Start a session with two people speaking into the one microphone. Watch the transcript labels and the always-visible "Who's talking" bar.
4. Activate the correction control on the other person's chip and confirm every earlier turn from that voice relabels.
5. Repeat with a keyboard only. Then repeat with a screen reader listening.
6. Switch the source back to browser tab and compare the transcript against a pre-feature screenshot.

**Expected:** A speaker label never falls back to "You" -- an unresolved voice reads "Unknown speaker", and a third voice reads "Speaker N" with a number that stays stable as more voices appear. While confidence is low the UI says it is still working out who is who. The correction control is a real button, reachable by keyboard with a visible focus ring, with an accessible name naming both the voice and the action, and it is reachable WITHOUT expanding the transcript disclosure (which live mode collapses by default). The chip for the voice already resolved as the user is NOT interactive -- there is no "mark yourself as yourself" action, and making it one adds a pointless tab stop on every one of the user's own turns. A correction is announced through a polite live region from EITHER surface it can be made from. The recording notice states plainly that everyone in the room is being recorded, and does not live only inside the dismissible consent alert. In tab and system mode nothing new renders at all and the transcript is pixel-identical to before.

### R-150 | area: copilot-speaker-identity | parallel-safe: no | automatable: no

**Summary:** Diarization actually works against Deepgram's live service. THIS HAS NEVER BEEN VERIFIED. Every automated test above proves the mapping and routing are correct GIVEN Deepgram's documented response shape; none of them prove Deepgram returns that shape for this account, model and audio.

**Steps:**
1. Ensure `STT_PROVIDER` is Deepgram (or unset) and `DEEPGRAM_API_KEY` is set.
2. Start an in-person session with two real people speaking into one microphone, alternating naturally, and let the interviewer ask at least three questions.
3. In devtools, inspect the Deepgram WebSocket frames. Confirm the request URL carries `diarize_model=v1` and that `channel.alternatives[0].words[]` entries carry an integer `speaker`.
4. Specifically look for a frame where `speech_final` is true AND the words array contains more than one distinct `speaker`.
5. Confirm each interviewer question was detected and drafted, and that none were missed.

**Expected:** Speaker ids arrive per word and stay stable for the same voice across the session. Both speakers' utterances are transcribed and attributed. Every interviewer question is detected. Step 4 is the important one: the whole drain rule in R-147 is built on the assumption that `speech_final` frames genuinely mix speakers. If they never do, R-147's speaker-change rule is harmless but unnecessary; if they do, it is load-bearing and this case is the only evidence for it. Record the finding here either way. Until this case has actually been run, no commit message, code comment or report may state that diarization is confirmed working -- this repo has already shipped an STT provider that was wire-correct on paper and silently double-counted every utterance in production (R-127).

### R-151 | area: copilot-speaker-identity | parallel-safe: yes | automatable: yes

**Summary:** In-person mode on a provider that cannot diarize is a defined, useful, degraded mode -- not a broken one, and not one that pretends to work.

**Steps:**
1. Read the `diarizationActive` handling in `hello-world/lib/copilot/stt/index.js` and the warning it drives in `hello-world/lib/copilot/session.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/stt/index.diarize.test.js lib/copilot/session.inperson.test.js` from `hello-world/`.

**Expected:** `DeepgramStream.supportsDiarization` is true and `ElevenLabsStream.supportsDiarization` is false -- ElevenLabs Scribe v2 Realtime has no realtime diarization at all, it is a batch-only feature. Requesting diarization from a provider that cannot do it is NOT an error: the stream connects and transcribes normally, and `diarizationActive` is false. `diarizationActive` is also false when the token fetch failed, even though that path falls back to Deepgram, because claiming diarization is live off an unverified fallback would be an overclaim. In that degraded mode the session still starts and still transcribes, every utterance routes as "them" so no question is missed, and a soft warning names the limitation and attributes it to the configured provider. The warning fires ONLY when diarization is genuinely inactive -- an unconditional warning cries wolf on every session. Two consequences are accepted and must stay stated rather than rediscovered: the transcript cannot attribute turns, and live pace and filler readings are not measured at all, since `recordSpeechSample` is gated on `speaker === "you"`; they report unmeasured rather than a fabricated 0.

### R-152 | area: copilot-answer-cache | parallel-safe: yes | automatable: yes

**Summary:** A cached answer is never served after the posting or the prep context it was built from has changed, and a draft already in flight when the user switches cannot write itself onto the screen either.

**Steps:**
1. Read `hello-world/lib/copilot/answerGrounding.js` and the way `cachedSampleAnswerFor` in `hello-world/lib/copilot/sampleAnswerState.js` consumes it.
2. Read `runDraft` in `hello-world/app/copilot/useDraftAnswer.js` (called from `hello-world/app/copilot/useLiveSession.js`, its sole writer): where the grounding and the generation are CAPTURED relative to the `await`, and where they are re-checked.
3. Read `onPostingChange`, `onProfileChange` and the prep-context effect in `hello-world/app/copilot/CopilotClient.js`.
4. Run `npx vitest run --no-file-parallelism lib/copilot/answerGrounding.test.js lib/copilot/sampleAnswerState.test.js app/copilot/useDraftAnswer.interviewType.test.js` from `hello-world/`.

**Expected:** One definition of "same grounding" serves both modes. `undefined`, `null` and `""` fold together per field, so live mode - which often has no `applicationId` because no posting is selected - still gets cache HITS on that field; getting that wrong throws nothing and fails no other test, it just silently disables the cache, which is why the "still hits" cases matter as much as the rejection ones. The interview type is now present on both modes' grounding keys - live mode is no longer the exception it once was - so a `general`→`technical` re-ask of the same question is a deliberate MISS, with no "reused" label, not a hit the fold above would wrongly grant it. Fields are compared individually and never concatenated, so `("ab","c")` and `("a","bc")` do not collide. An entry that never recorded its grounding is a MISS, never a false hit, so one forgetful write site cannot opt out of the guard. `answerCacheRef`'s sole live write site records the grounding the answer was ACTUALLY built from - `runDraft` (in `hello-world/app/copilot/useDraftAnswer.js`, called from `useLiveSession.js`) captures `profileRef`/`postingRef` BEFORE its await. A grounding mismatch is an ordinary miss: it drafts properly, and never surfaces as an error or as a "reused" label.

Separately, and NOT redundantly: `runDraft`'s post-await path also writes the resolved answer straight onto the visible question entry via `setQuestions`, which no grounding comparison can catch because it is not cache-mediated. A generation ref bumped by `onPostingChange`, `onProfileChange` and `start` is captured before the await and re-checked before BOTH that write and the cache write, in the success AND catch branches. A superseded draft returns the entry to `idle` - never stranded at `loading`, never showing an answer or an error built for a context the user has left. **This half has no automated coverage**: `vitest.config.js` is `environment: "node"` with no jsdom, so `runDraft` cannot be exercised, and deleting the generation check turns nothing red. It is verified by reading only.

**A third guard, added by chunk A, answers a different question, and neither of the two above substitutes for it.** The generation ref above answers "has the user moved on" - a posting or profile change. A per-entry `draftToken` (`useDraftAnswer.js:115`, stamped BEFORE the `if (!force)` cache branch at `:123`, and carried by the cache-hit write itself) answers "is a newer draft this entry's owner" - the SAME context, a second draft on the SAME question, because the user pressed redraft or an auto-redraft fired. Without the token, a superseded draft resolving AFTER a newer one has already landed flips a correct `done` answer back to `idle` via `revertToIdle` (`useDraftAnswer.js:208-216`, reachable on a stale success at `:259` and on a stale rejection at `:292`), with no `AbortController` anywhere in the file to prevent either. Unlike the generation-ref half above, this one DOES have automated coverage: `app/copilot/useDraftAnswer.interviewType.test.js` runs under `@vitest-environment jsdom` and drives `runDraft` directly, asserting both the stale-success and stale-rejection cases stay `done`.

**Critically, the two halves of `sampleAnswerState.js` must stay INDEPENDENT.** `cachedSampleAnswerFor` routes through the shared predicate; `needsRedraft` deliberately keeps its own inline comparison. That file's "agrees with needsRedraft on every combination of matching/mismatching fields" block asserts the two agree, and it only has power while they are separate implementations - routing both through the shared predicate would turn it into `f(x) === f(x)`, green forever and incapable of failing. Verify by breaking `sameGrounding` and confirming that block goes RED; if it stays green, the test is dead and the consolidation went too far.

**Amended (prediction removal):** this case had TWO live write sites into `answerCacheRef`; it now has one. `onPrefetchedAnswer` in `CopilotClient.js` went with the retired pre-drafted answer (R-237), so it is struck from step 3 and from the Expected, and `runDraft` is the sole writer named in its place — which step 2 already reads. The cost framing "doubles what every predicted question costs" is struck for the same reason; a silently disabled cache is reason enough on its own. Everything the case actually pins is unchanged and none of it was prediction-specific: the fold of `undefined`/`null`/`""`, the per-field comparison, "an entry that never recorded its grounding is a MISS" — which still guards practice mode's write sites and any future live one — the generation-ref half with no automated coverage, and the deliberate independence of `cachedSampleAnswerFor` and `needsRedraft`.

**Amended (chunk A — interview type), THREE corrections:** (1) the clause "live mode - which has no interview type and often no posting - still gets cache HITS" is struck — AC-A18/AC-A19 make it false. The fold-`undefined`/`null`/`""`-together argument now applies to `applicationId` alone (still genuinely absent when no posting is selected); the interview type is now present on both modes' grounding keys, and a `general`→`technical` re-ask of the same question is a deliberate MISS, never a "reused" hit. (2) Two stale pointers, both pre-existing this chunk (`area-baseline.md` §3, anomaly 2): step 2 and the Expected's own parenthetical named `runDraft` as living in `hello-world/app/copilot/useLiveSession.js`. It has lived in `hello-world/app/copilot/useDraftAnswer.js` since the AC-P4 split; `useLiveSession.js:317` only calls it. Both are corrected, and the prediction-removal amendment directly above — which itself said "runDraft in `useLiveSession.js` is the sole writer" — is corrected the same way. (3) The "Separately, and NOT redundantly" paragraph gains the per-entry `draftToken` as a third, independent guard — see the paragraph appended after it, above.

### R-153 | area: copilot-practice-speakers | parallel-safe: yes | automatable: yes

**Summary:** Practice mode's delivery metrics count only the candidate's own words, now that its single microphone is diarized and another person in the room lands in the same transcript stream.

**Steps:**
1. Read `partitionAnswerFinals` and `answerMetricsInputs` in `hello-world/lib/copilot/answerSpeakers.js`.
2. Read where `doneAnswer` in `hello-world/app/copilot/practice/usePracticeAnswer.js` consumes them.
3. Run `npx vitest run --no-file-parallelism lib/copilot/answerSpeakers.test.js lib/copilot/answerMetricsInputs.test.js lib/copilot/answerWindow.speaker.test.js` from `hello-world/`.

**Expected:** Untagged finals are ALWAYS the candidate's, which is what makes the no-diarization path - every existing practice user - a special case of the general one rather than a separate branch that can drift, and what stops a final the provider could not attribute from being silently dropped from the candidate's word count. Dominance is by WORDS, not by number of finals: an interviewer interjecting "Right" three times must not outrank one long answer. Order within each half is preserved, because the span derivation takes the FIRST timed entry in list order rather than the minimum, so reordering would silently move an answer's start. The input list is not mutated.

Every number derived from the collected finals reads the candidate's half: word count, words per minute, pace label, filler count and rate, discourse-marker count and rate, sentence count, longest sentence, the speech span - and the transcript TEXT that is saved and sent for critique, since another person's sentences would otherwise be graded as the candidate's.

**Both halves of the pair are asserted deliberately.** This is R-127's shape: contamination inflates the WORD COUNT (a sum) while barely moving the SPAN (a min/max), so the two stay superficially coherent while one is wrong. R-127 shipped a 98-word answer measured as 196 words at 367 wpm, and the critique told the user to be more concise and slow down. A span that is merely too LONG makes words-per-minute read too SLOW, which is advice a candidate would act on.

Note the history: this protection originally shipped inside a React hook, where sabotaging it turned NOTHING red across the whole suite - `vitest.config.js` is `environment: "node"` with no jsdom, so no hook can be mounted. The composition was moved into `lib/` for exactly that reason, as `answerWindow.js` and `answerPoints.js` already were. Do not move it back.

### R-154 | area: copilot-practice-speakers | parallel-safe: yes | automatable: yes

**Summary:** Practice mode notices a question asked by someone else in the room AS IT IS ASKED, and answers it as fully as live mode does.

**Steps:**
1. Read `shouldTreatAsRoomQuestion` in `hello-world/lib/copilot/roomQuestions.js`.
2. Read the `onUtterance` assembly in `hello-world/lib/copilot/practiceSession.js` and `hello-world/app/copilot/practice/useRoomQuestions.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/roomQuestions.test.js lib/copilot/practiceSession.diarize.test.js` from `hello-world/`.

**Expected:** Detection is live, driven by assembled per-speaker turns from the session - NOT by the end-of-answer partition, which only resolves when the candidate presses Done, by which point the moment to draft has passed. Turns are assembled by the SAME `utteranceAssembly.js` live mode uses, so a turn drains on a speaker change OR its own `speechFinal`, whichever comes first (R-147: with `endpointing=300` a frame carrying `speech_final` routinely also carries the next speaker's opening words, so a turn that is not last in its frame would otherwise never drain and its question would be lost).

Two signals decide. First, whether an answer is being collected: while it is, everything is the candidate's answer by definition, which is what pressing Start answering means - this signal needs no diarization at all. Second, which tag is the candidate's, learned from the dominant speaker of the previous completed answer and persisted for the rest of the session; a completed answer is the strongest identity signal practice mode ever gets, because the person talking during an answer window IS the one answering. Tag `0` is a real tag on both sides.

A confirmed question runs the same pipeline live mode runs and produces the same answer shape - points, type, cues, buzzwords, resume anchor, ideal project - grounded in the selected posting. Back-to-back identical questions are deduped, and a short fragment does not buy an LLM call.

**The deliberate asymmetry with live mode, which must not be "made consistent":** with NO diarization at all, live mode evaluates every utterance and practice mode evaluates none. In live mode missing the interviewer's question is the catastrophic direction. In practice mode the drill supplies its own questions and the population is overwhelmingly solo, so every detection in an untagged session would be a false positive that spends a model call and puts a question nobody asked on the user's screen.

**Known coverage gap:** the hook's wiring of that decision into `onUtterance` is glue reachable only by mounting a hook, which this repo cannot do. Making the detector ignore the rule entirely turns nothing red. The DECISION is pure and tested; its application is verified by reading. **Amended:** the claim that this repo "cannot do" that is no longer true. `app/copilot/useCopilotDashboard.wiring.test.js` mounts a real hook under a per-file `// @vitest-environment jsdom` docblock (see R-166), so glue like this IS reachable now. This case's gap simply has not been closed yet; closing it means rendering the hook and asserting on observable outbound work the same way that file does, not accepting "verified by reading".

### R-155 | area: copilot-practice-speakers | parallel-safe: yes | automatable: no

**Summary:** Practice mode's privacy notice still enumerates everything that actually leaves the browser, now that a room question can trigger a draft.

**Steps:**
1. Read the notice `hello-world/app/copilot/practice/PracticeClient.js` renders, including the room-question clause it appends to `buildPrivacyNotice`'s output.
2. Select a posting, start a practice session on the Gemini engine, and read the notice on screen.
3. Repeat on the embedded engine.

**Expected:** The notice names the room-question draft as a destination for the question text and prep context, hedges while the submitted documents are still loading, asserts only what was actually found once settled, and says nothing at all when the embedded engine means no provider is contacted. This codebase has been bitten before by a feature silently falsifying a notice that enumerated destinations (BUG-H5), and again by one that was true but auto-hidden the moment recording began. Whenever a change adds an automatic outbound request, re-read every notice that lists where data goes.

**Known duplication to resolve:** the clause is composed in `PracticeClient.js` rather than in `lib/copilot/practiceNotices.js` where `buildPrivacyNotice` lives, duplicating a small document-label helper. It belongs in that module.

### R-156 | area: copilot-practice-speakers | parallel-safe: yes | automatable: yes

**Summary:** Turning diarization on for practice mode changed nothing for a solo user.

**Steps:**
1. Read the `createSttStream` call in `hello-world/lib/copilot/practiceSession.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/practiceSession.test.js lib/copilot/practiceSession.diarize.test.js lib/copilot/answerMetrics.test.js` from `hello-world/`.

**Expected:** Diarization is requested unconditionally, unlike live mode where it is tied to the in-person source: the microphone is already the only source, the parameter costs nothing, and a solo session yields a single speaker tag which the answer partition treats exactly as it treats no tag. So a solo user's metrics are byte-identical to before the feature. No warning is raised when the provider cannot diarize - unlike live mode, practice mode loses nothing a solo user would notice, and warning on every session would cry wolf. Frames still reach consumers with `speaker: "you"`, with `speakerTag` riding alongside, so nothing downstream had to learn a second vocabulary.

### R-157 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** The interview copilot has no horizontal overflow anywhere between 320px and 430px, in either mode, through either entry point.

**Steps:**
1. Open the copilot BOTH ways: the `/copilot` route, and the "Interview Copilot" tab in the main nav (`app/page.js`, `mainTab === "copilot"`). The nav-tab path adds two more padding layers (`.page` and `.main` in `app/page.module.css`) and is the stricter case.
2. In device emulation, at each of 320, 375, 390 and 430 CSS px wide, in live mode and practice mode, run in the console:

       const vw = innerWidth;
       [...document.querySelectorAll('main *')]
         .filter(el => { const r = el.getBoundingClientRect(); return (r.width || r.height) && r.right > vw + 0.5; })
         .map(el => [el.tagName, el.textContent.trim().slice(0, 40)]);

3. Repeat with a live session started, and with practice mode showing a completed answer's review and feedback.

**Expected:** The array is empty every time. **Measure by element bounds, never by looking for a scrollbar.** `app/globals.css:20` sets `html { overflow-x: hidden }` -- deliberately, and scoped to `html` rather than `body` so the sticky header still pins -- so horizontal overflow here is silently CLIPPED AND UNREACHABLE rather than scrollable. A visual check cannot distinguish "fits" from "the right-hand third was deleted", which is how this shipped: measured at a 320px shell, the copilot's root Box had a min-content width of 327.8px against a 256px content box, and because `.main` is a flex column (so the child's `min-width: auto` floor applies) it overflowed by ~72px with no scrollbar and no visible symptom.

The dominant contributor was the three-option "Interviewer audio" `ToggleButtonGroup` in `SessionSetup.js`: a `ToggleButtonGroup` is `inline-flex` and never wraps internally, so the parent `Stack`'s `flexWrap` -- which was already present -- only ever wrapped BETWEEN the label and the group. **Adding `flexWrap` to a parent does nothing for a non-wrapping child**; the group itself has to change `orientation`. It stacks below `sm` through a bounded `theme.breakpoints.down("sm")` media query in `sx` -- NOT through the `orientation` prop, and NOT through an `{ xs, sm }` object. Both of those were tried and both are wrong here. `orientation="vertical"` did not take effect in this MUI build: the committed fiber carried `orientation: "vertical"` while the DOM still rendered `MuiToggleButtonGroup-horizontal` with `flex-direction: row`, at 320px, across a reload and a resize. And an `{ xs: ..., sm: undefined }` object never switches off, because `xs` compiles to `@media (min-width: 0px)` and is therefore true at EVERY width -- written that way first, it silently shipped detached 8px-radius buttons to the 1280px desktop. **Amended: an earlier draft of this case claimed the orientation was driven by `useIsMobile()` threaded down as a prop. It never was; `SessionSetup.js` has no `useIsMobile` import at all.** The second contributor was `MicPicker.js`'s hard `minWidth: 220` `FormControl`. **Amended: an earlier draft called that "the only fixed px width in the live file set", which is false** -- `PostingPicker.js`'s `maxWidth: 480` and `AnswerAids.js`'s `minmax(0, 150px)` are both fixed px values in live-mode components. Neither is a defect: a `maxWidth` is a ceiling over a fluid child and never constrains a phone, and `minmax(0, ...)` explicitly permits shrinking below its track size. What made `minWidth: 220` different is that it is a FLOOR with nothing allowed under it.

### R-158 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** Every interactive control in the copilot is at least 44 CSS px tall on a phone.

**Steps:**
1. At 375px wide, in live mode and practice mode, run:

       const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=combobox], .MuiSwitch-switchBase';
       [...document.querySelectorAll('main ' + SEL.split(', ').join(', main '))]
         .filter(el => el.getAttribute('aria-hidden') !== 'true' && el.getAttribute('tabindex') !== '-1')
         .map(el => {
           const target = el.closest('.MuiInputBase-root') || el;
           return { h: target.getBoundingClientRect().height, label: (el.getAttribute('aria-label') || el.textContent || el.type || '').trim().slice(0, 40) };
         })
         .filter(x => x.h && x.h < 44);

2. Expand every disclosure first (setup, transcript history, submitted docs, prep context, sample answer) and start a practice answer, so their controls exist to be measured.
3. For `SpeakerChip`'s "Mark ... as me" button, the visual pill stays 20px on purpose -- verify its HIT area instead by tapping 10px above and 10px below it and confirming both activate it.

**Expected:** The filtered array is empty apart from `SpeakerChip`'s button, whose hit area is extended by a transparent `::after` (`TOUCH_PILL_SX` in `app/copilot/mobileSx.js`) rather than by growing the pill -- a chip grown to 44px would dominate every transcript row. Twelve controls measured under 44px in live mode idle alone before this work, including both disclosure buttons, each of which is the ONLY route to its content while a session is live.

The mobile rules live in ONE place (`app/copilot/mobileSx.js`) rather than being restated per call site, the same argument that makes `livePace.js` import `answerMetrics.js`'s thresholds instead of repeating them: two definitions of "big enough to tap" will drift.

**Amended: an earlier draft claimed "every value in that module is breakpoint-scoped so that at 600px and above the rendering is unchanged". That is false and must not be restored.** Three constants deliberately apply at every width -- `WRAP_ROW_SX` (a row should wrap wherever it does not fit, not only on a phone), `BREAK_LONG_WORDS_SX` (and `overflowWrap: "anywhere"` is NOT inert on desktop: unlike `break-word` it also feeds intrinsic min-content sizing), and `TOUCH_PILL_SX`'s positioning context -- while `PHONE_PANE_SX` is keyed to `md` and so changes the 600-899px band on purpose. The module's opening comment now states which is which. What IS a hard requirement, and what the rest of this paragraph is about, is narrower: **where a value is meant to be phone-only, its `sm`/`md` branch must be the property's real initial value.** `SpeakerChip` shipped a first version of this fix with `minWidth: { xs: 44, sm: 0 }`; the button had previously had no `min-width` at all, i.e. `auto`, which on a flex item is exactly what stops it being squeezed below its own label. `0` handed that floor back at every desktop width to buy nothing. Check any `sm`/`md` value that reads as "off" -- `0`, `none`, `visible` -- against what the property's INITIAL value actually was.

**Amended (chunk A — interview type):** `SEL` omitted `[role=combobox]`, which is what MUI's non-native `Select` actually renders (a `div`, never a `<select>` or a `<button>`) -- the sweep could not see the interview-type picker, or any other Select-based control, at all. It also had no exclusion for MUI's hidden native `<input>` (`aria-hidden="true"`, `tabindex="-1"`, ~21px), which the unfiltered `input:not([type=hidden])` clause matched as a false positive -- it is deliberately never a tap target. And a matched `<input>` nested inside a `.MuiInputBase-root` -- `PostingPicker`'s own Autocomplete field, measured at 28px -- was measured at its own height rather than its root's, when the 44px `InputBase` root beneath it is the actual tappable surface. Step 1 now adds `[role=combobox]` to `SEL`, filters out `aria-hidden`/`tabindex="-1"` matches before measuring, and measures the closest `.MuiInputBase-root` ancestor when one exists (the same class `app/copilot/mobileSx.js` itself targets as "the outer clickable surface"), falling back to the element itself when there is none. The counts named elsewhere in this case predate this fix and are unchanged by it.

### R-159 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** On a phone the page is the single scroll container -- no copilot pane is its own nested scroller, and every viewport-height value that does reach a phone is expressed in `dvh` with a `vh` fallback.

**Steps:**
1. At 375x812 in live mode, scroll the page with a drag that starts INSIDE the transcript pane, then inside the question feed, then inside the "Submitted for this application" panel.
2. Confirm `TranscriptView`, `QuestionFeed` and `SubmittedDocs` compute no `overflow-y: auto` and no height cap below `md`.
3. Widen past 900px and confirm all three return to being bounded, internally-scrolling panes.
4. In practice mode, confirm the camera preview does not exceed the viewport on a short or landscape phone.

**Expected:** Every drag scrolls the page. Below `md` the three panes grow with their content (`PHONE_PANE_SX`); at `md`+ their previous `minHeight: 340` / `maxHeight: 62vh` / `overflowY: auto` behaviour is unchanged. Two independent reasons, each sufficient on its own: a nested touch scroller steals the page-scroll gesture and makes the page feel stuck, and `62vh` is the LARGE-viewport height on iOS Safari, so a pane sized to it is taller than the visible area whenever the URL bar is expanded and its bottom rows sit under the chrome. Note it was plain `vh`, not `dvh` -- `CopilotClient.js` already does the `CSS.supports("height", "1dvh")` dance for its own live column, so the idiom existed and had simply not been applied here.

`SubmittedDocs` is the sharpest case: setting `overflow-y: auto` while `overflow-x` stays `visible` makes the computed `overflow-x` `auto` as well (CSS overflow spec), and its resume text is `white-space: pre-wrap`, which preserves the document's own long lines -- so it was a 260px-tall TWO-AXIS nested scroller on a ~250px-wide screen. It keys the same release to `md` as its two siblings, but deliberately does NOT spread `PHONE_PANE_SX`: that constant carries a `minHeight: 340` / `maxHeight: 62vh` pane geometry, while this panel has its own smaller, deliberate `SCROLL_MAX_HEIGHT = 260` cap that must survive. The breakpoint is shared; the cap is not. **Amended: this originally shipped keyed to `sm`, leaving it a bounded two-axis scroller between 600 and 899px while both siblings had already released -- two definitions of one rule, which is exactly the drift `app/copilot/mobileSx.js` exists to prevent.**

`CopilotClient.js`'s live-height block was already correctly gated (`measureLiveHeight = live && !isMobile`, plus `height: { xs: "auto", sm: ... }`) -- that guard is complete at both the JS and CSS layers and must stay. Only its sibling `overflow` key had been left ungated, and that single omission is what made every other overflow on this page invisible while a session was live.

### R-160 | area: copilot-mobile | parallel-safe: yes | automatable: yes

**Summary:** A device that cannot capture a display surface is not offered the two sources that require one, and a source chosen on another device resolves to something runnable.

**Steps:**
1. Read `hello-world/lib/copilot/captureSupport.js` and how `CopilotClient.js` seeds `source` from `localStorage` through `resolveInterviewerSource`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/captureSupport.test.js` from `hello-world/`.
3. In a desktop browser, confirm all three "Interviewer audio" options are enabled and stored-source behaviour is unchanged.
4. In devtools, delete `navigator.mediaDevices.getDisplayMedia` and reload. Confirm "Browser tab" and "System audio (speakers)" are disabled, that a visible sentence in the DOM explains why, and that the selection has become "In person (same microphone)".
5. Set `localStorage["copilot-audio-source"] = "tab"` on that same crippled profile, reload, and confirm the session still starts.

**Expected:** `getDisplayMedia` is unsupported on EVERY mobile browser -- Safari on iOS, Chrome for Android, Samsung Internet, Android Browser and Opera Mobile are all unsupported per caniuse. `lib/copilot/session.js`'s `THEM_CAPTURE_BY_SOURCE` maps `tab` and `system` straight onto functions that call it, and `start()` awaits `captureThem()` as its first act, so before this those two options were controls on a phone that could only ever throw.

Detection is FEATURE detection (`typeof mediaDevices?.getDisplayMedia === "function"`), never user-agent sniffing, and a key that merely exists is not enough -- a non-callable value would still throw. The explanation must be real text in the DOM: a `title=` or a `Tooltip` has no touch equivalent, so on the exact devices this exists for it would never be seen. The wording states a capability gap and never says "denied" or "permission" -- the browser never gets far enough to prompt -- and the test asserts those words are absent.

`unavailableSourceReason` is deliberately called with the fixed string `"tab"`, never with the current `source` state. `"tab"` and `"system"` share an identical reason, `"inperson"` always returns `""`, and a device without display capture is exactly the case where `source` has already been resolved to `"inperson"` -- so reading the reason off the selected source would go silent precisely when it is needed. The seed effect depends on `displayCapture` rather than `[]` for the same reason: detection lands after the first render, and without the re-run a phone's stored or default `"tab"` would never self-correct.

**`lib/copilot/session.js` is deliberately unchanged.** Its fallback of an unrecognized source to `captureTabAudio` is pinned by R-034/R-038/R-144 and must stay; this gate is in the UI only. On a device that DOES support display capture, `resolveInterviewerSource` reproduces today's behaviour exactly, including `"tab"` as the default -- pinned by its own assertion so a change to the default has to be deliberate rather than a side effect of this feature.


**RUN AND PASSED (2026-08-09), including the manual steps.** Recorded here rather than left as "verified by reading", because the automated tests cover `captureSupport.js` in isolation and prove nothing about the wiring.

Method, since the obstacle is real and will recur: the stub has to be installed BEFORE `CopilotClient`'s mount effect, which is where `displayCaptureSupported()` is called and the answer latched -- a `useEffect` in a wrapper races the child's own effect and loses. Two throwaway routes under `app/auth/` (public per `lib/supabase/middleware.js`), identical except that one shadows the method at MODULE scope, which evaluates during hydration before any render. Note `delete navigator.mediaDevices.getDisplayMedia` does NOT work: the method lives on `MediaDevices.prototype`, so deleting a non-existent own property returns true and changes nothing. `Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: undefined, configurable: true })` is what actually hides it. Both routes deleted after the run.

Observed on the control (display capture present): all three options enabled, `"tab"` selected by default, no reason text rendered anywhere, Start enabled. With `localStorage["copilot-audio-source"] = "system"`, System audio came back selected -- stored source still honoured, unchanged by this feature.

Observed on the crippled device: `getDisplayMedia` absent, Browser tab and System audio both `disabled`, In person selected, Start still enabled. The reason rendered as a real `<p>` in the DOM (not a `title=`, not a tooltip) reading "This browser can't share a tab or your screen. Pick the In person (same microphone) option instead, or open the copilot in desktop Chrome or Edge to capture a call.", and contains neither "denied" nor "permission". With a stored `"system"` AND separately a stored `"tab"`, both resolved to In person -- and **`localStorage` still held the original value afterwards**, so a laptop preference is not clobbered by being read on a phone.

The sharpest part, and the reason step 5 exists: pressing Start with `getDisplayMedia` replaced by a getter that counts reads gave **zero accesses** -- the in-person path does not call it, and does not so much as look at it. `getUserMedia` was called exactly once, with `{audio: {echoCancellation, noiseSuppression, autoGainControl}}` and **no `deviceId` own-key at all** (System default, which is R-101's requirement, incidentally re-confirmed here). The session then failed on "Microphone unavailable (Permission denied)", which is the browser pane blocking microphone access and not a product fault; what matters is that it failed at the MICROPHONE and never at display capture. Before this feature that same click would have thrown `getDisplayMedia is not a function` as `start()`'s first act.

A full end-to-end session still has not been run on a real phone -- that needs a device, a microphone grant, and an STT key. This case does not claim otherwise.

### R-161 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** Practice mode's drill is reachable on a phone, and its reordering moves the DOM rather than only the pixels.

**Steps:**
1. At 390x844 in practice mode with a posting selected, confirm the question card appears above the five-panel dashboard, with the compact self-view above both.
2. **Tab through the page from the top and confirm the focus order matches the visual order** -- "Start answering" must be reached before the dashboard's "Show sample answer", not after it.
3. Widen past 900px and confirm the order returns to exactly what it was before this work: dashboard above the question card, full-size camera preview beside the transcript in the bottom row.
4. Confirm only ONE `<video>` element is bound to the camera stream at any width: check `document.querySelectorAll('video').length` and which have a `srcObject`.
5. Rotate/resize across the 900px boundary while a sample answer is revealed and confirm it stays revealed.

**Expected:** Before this work the dashboard sat between the controls and the question card, putting "Start answering" ~1990px down (about 2.9 screens) and the self-view ~2100-3400px down -- so a candidate could never see the question and their own face at once, which is practice mode's entire premise.

**Step 2 is the point of this case.** The first implementation used breakpoint-keyed CSS `order` on a flex column. That moves the paint order and leaves the DOM alone, so below `md` a keyboard or screen-reader user met the dashboard -- including its "Show sample answer" button -- BEFORE the question card while every sighted user saw the opposite: a visual/focus order mismatch, WCAG 2.4.3 and 1.3.2. Reordering the rendered array instead keeps the two in agreement. The `key`s on those two blocks are load-bearing: React matches keyed children across a reorder, so crossing the breakpoint MOVES them rather than remounting them, and `CopilotDashboard`'s panels carry `aria-live` regions that go unannounced if they remount already holding their final text.

The reveal gate must survive the reorder: the dashboard and the question card share ONE `useSampleAnswer` instance, because a second visibility flag would let them disagree about whether the model's answer is on screen. Likewise only one `<video>` may hold the stream -- the compact self-view is the same component re-placed, not a second copy.

**What must NOT be done to shorten the scroll:** the privacy notice at the top of `PracticeSetup.js` is the largest single block of height, and collapsing it behind a disclosure is forbidden. This codebase has shipped that failure twice -- a posting-grounding fact appended to a dismissible consent `Alert` (BUG-H4), and a recording notice that vanished the moment `start()` collapsed the setup block (BUG-4). A disclosure may not live inside a dismissible or collapsible container, and "it was too tall on mobile" is not an exception.

### R-162 | area: copilot-a11y | parallel-safe: yes | automatable: yes

**Summary:** The copilot's visually-hidden live regions are 1px boxes, not full-size elements, because MUI's `sx` reinterprets bare numbers.

**Steps:**
1. Read `visuallyHidden` in `hello-world/lib/copilot/answerStatus.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerStatus.test.js` from `hello-world/`.
3. In a browser at any width, evaluate `getComputedStyle` width for every `span[role="status"]` in the copilot.

**Expected:** Every one reports `1px`. This object is consumed only as an `sx` value, at six call sites across the copilot, and **MUI's `sx` does not read a bare number as pixels**: `width`/`height` go through `sizingTransform`, where any number in 0..1 means a percentage, and `margin` goes through the spacing system, where `-1` means -8px. Verified directly in `node_modules/@mui/system/styleFunctionSx/defaultSxConfig.js` -- `width` carries `transform: sizingTransform`, while `top`/`right`/`bottom`/`left` have empty configs and DO pass raw numbers through as px (which is why `TOUCH_PILL_SX`'s `top: -12` is correct as written). So the plain-CSS reading of the old object -- a 1px box nudged 1px -- was not what shipped; it computed to `width: 100%; height: 100%; margin: -8px`, measured in a browser as a real 320x900px element.

Nothing looked wrong, because `clip` and `overflow: hidden` still hid it. What it did instead was silently extend the document's scroll width, which on a phone is indistinguishable from a layout bug precisely because `app/globals.css:20` clips horizontal overflow at the root (R-157).

The test asserts UNITS, not values: each length must be a unit-bearing string, so the numbers can be tuned without the assertion going stale, while a "simplification" back to bare numbers fails. Sabotage it by restoring `width: 1` and `margin: -1` and confirm it goes red -- it does, naming the property. The three properties that do the actual hiding (`position`, `overflow`, `clip`) are pinned in the same block, because losing one of those turns a screen-reader-only region into visible text, and it is only the fact that they kept working that let the sizing bug hide for so long.

### R-163 | area: copilot-practice | parallel-safe: yes | automatable: yes

**Summary:** Practice mode renders at all, and `no-undef` is the gate that keeps it that way.

**Steps:**
1. Run `npx eslint .` from `hello-world/`. It must report 0 errors and 0 warnings.
2. Delete the `const [replayUrl, setReplayUrl] = useState("")` declaration from `hello-world/app/copilot/practice/usePracticeAnswer.js` and re-run `npx eslint .`.
3. Restore it.
4. Open the copilot and switch to Practice. The setup, controls and question card must render.

**Expected:** Step 2 fails with three `no-undef` errors naming `setReplayUrl` twice and `replayUrl` once. This case exists because exactly that shipped to main: the declaration was lost in the extraction that split PracticeClient's hooks apart (commit d0dc09c), leaving `replayUrl`/`setReplayUrl` as free variables, and practice mode threw `ReferenceError: replayUrl is not defined` on its first render — the entire tab was a blank crash.

**Nothing caught it, and the reasons are the point of this case.** `eslint-config-next` leaves `no-undef` OFF, on the assumption that TypeScript does that job; this project has no `tsconfig.json` at all, and the development-loop notes already record that `tsc --noEmit` is vacuous here. `npm run build` passed, because an undeclared reference is legal SYNTAX and only fails at runtime. All 2816 tests passed, because `vitest.config.js` is `environment: "node"` with no jsdom, so no test in this repo can render a component or a hook — the same structural gap recorded in R-152 and R-153.

So three green gates said nothing was wrong while half the feature was dead. `no-undef` is now enabled in `eslint.config.mjs`; enabling it produced **zero** errors anywhere else in the codebase, so it costs nothing. Be precise about what it closes, though: bare free variables in linted source, and nothing wider. It cannot see a misspelled object property, cannot fire inside a `typeof` guard, does not reach anything under `globalIgnores`, and does not reach files outside `hello-world/`. Do not disable it, and do not add a `tsconfig.json` to "do it properly" — there are no TypeScript sources here for one to check.

### R-164 | area: app-nav | parallel-safe: yes | automatable: no

**Summary:** The main tab strip is usable on a phone, and the change that made it so is understood to be app-wide rather than copilot-only.

**Steps:**
1. At 320px, open the app and confirm the six top-level tabs (Materials, Manual Applying, Auto Applying, Tracking, Interview Copilot, Library) can all be reached by swiping the strip.
2. Confirm the same on a sub-navigation strip inside a tab, since `NavTabs` renders both sizes.
3. On a device or emulation profile with a COARSE pointer but a wide viewport -- a touch laptop, or a tablet in landscape -- confirm the strip is still navigable when it overflows.
4. At 1280px with a mouse, confirm scroll arrows still appear when the strip overflows.

**Expected:** `app/components/NavTabs.js` uses `variant="scrollable" scrollButtons="auto"` and, since the mobile pass, NO `allowScrollButtonsMobile`. That prop forced both `TabScrollButton`s to render even on touch, costing 80px of a 252px strip at 320px -- roughly one tab visible at a time out of six. Dropping it lets MUI hide them under `@media (pointer: coarse)`, where swiping is the natural affordance. `minWidth: { xs: 0, sm: 90 }` on `.MuiTab-root` stops short labels reserving MUI's default 90px they do not need; at `sm` and up it is `90`, matching the stock default exactly.

**This case exists because the change is app-wide and shipped inside a copilot-scoped commit.** `NavTabs` is used by `app/page.js` for the main nav AND for sub-navigation in several tabs, so every tab strip in the product is affected -- and the commit's claim of "verified at 1280 that the desktop rendering is unchanged" was verified with a FINE pointer, which is precisely the configuration the removed prop does not affect. Step 3 is the one that actually exercises the trade-off: a coarse-pointer wide viewport now has swipe and no arrows. If that ever proves inadequate, the fix is a breakpoint-scoped reinstatement, not restoring the prop unconditionally -- the 320px case is what it cost.

### R-165 | area: copilot-mobile | parallel-safe: yes | automatable: no

**Summary:** The live transcript still follows the newest line on a phone, where the pane is no longer its own scroll container.

**Steps:**
1. Start a live session at 375px, expand "Show transcript and question history", and let several turns of speech arrive.
2. Confirm the newest line is brought into view as it arrives.
3. Scroll UP to re-read an earlier line and confirm you are NOT dragged back down by the next arriving line.
4. Repeat both at >= 900px, where the pane IS its own bounded scroller, and confirm the behaviour there is unchanged from before the mobile pass.

**Expected:** Auto-follow works in both regimes, and which regime applies is read from the ELEMENT (`scrollHeight > clientHeight`), never from a duplicated breakpoint in JS -- a second `useMediaQuery` would be free to drift from the CSS that actually decides it.

This case exists because the mobile pass broke it and nothing caught it. `TranscriptView` kept the newest line visible by writing `el.scrollTop = el.scrollHeight` and recomputing a stick-to-bottom flag in `onScroll`. Applying `PHONE_PANE_SX` set `overflowY: visible` with no height cap below `md` -- deliberately, so the page is the single scroller on a phone (R-159) -- which means the pane stopped being a scroll container at all: `scrollHeight === clientHeight`, the `scrollTop` write became inert, and `onScroll` never fired again. Mid-interview on a phone the newest line simply went off-screen with nothing to bring it back, while the code still READ as though it worked, which is worse than the feature being absent.

Severity was limited only by an unrelated accident: live mode collapses the transcript disclosure by default, so the pane is opt-in during a session. That is not a mitigation to rely on -- step 1 opens it.

The general lesson, and the reason this is its own case rather than a footnote on R-159: **removing a scroll container silently disables every behaviour built on it.** Anything reading `scrollTop`, `scrollHeight`, `onScroll`, or `scrollIntoView` against that element becomes dead code that still type-checks, still lints, and still looks correct in review. When a pane stops being `overflow: auto` at any breakpoint, grep the component for those four names before assuming the change is presentational.

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

### R-172 | area: test-infrastructure | parallel-safe: yes | automatable: yes

**Summary:** A component whose source is a `.js` file containing JSX can be imported and rendered by a jsdom test.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/JobDescriptionTab.test.js`.
2. Read the `oxc` block and the `setupFiles` line in `vitest.config.js`, and `vitest.setup.js`.

**Expected:** All tests pass. `app/components/JobDescriptionTab.test.js` is the first test in this repo to import a real component file, and it required two pieces of infrastructure that had simply never been exercised before:

- **JSX in `.js` was not transformed.** Every component in this repo is a plain `.js` file containing JSX -- there are no `.jsx`/`.ts`/`.tsx` files anywhere. Vite 8 transforms through Oxc, whose default filter gives JSX parsing only to `.jsx`/`.tsx`. Setting `esbuild.loader` does not help: Vite converts an `esbuild` config into an `oxc` one when `oxc` is not itself a plain object, and that converter carries over only the JSX **runtime** options, dropping `loader` silently. `oxc: { lang: "jsx", include: /\.js$/, exclude: /node_modules/ }` is what actually works. Oxc's `jsx` lang is a strict superset of plain JS, so it is a no-op for every file that has none.
- **jsdom implements no `CSS` global at all** -- no `CSS.escape`, no `CSS.supports`. `vitest.setup.js` polyfills `CSS.escape` (the standard serialize-an-identifier algorithm) and is loaded for every test, at no cost to the node-environment majority.

`vitest.config.js` stays `environment: "node"` by default; both new jsdom test files opt in per-file with a `// @vitest-environment jsdom` docblock. **This does not license mounting components instead of extracting logic** -- `lib/` remains the first choice, and the many comments across this repo saying so are still right. What it does close is the class of criteria that ARE the markup: which control is disabled mid-run, what a live region announces, and whether every control has an accessible name.

**`react-hooks/globals` is scoped off for test files in `eslint.config.mjs`.** `eslint-plugin-react-hooks` v7 ships the React Compiler's component-purity rules, which treat every capitalized function as production render code; a `Probe` component that assigns a hook's return value to an outer variable so assertions can read it between `act()` calls is the intended shape of this harness, not a bug. The rule stays fully active for real app code.

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

### R-182 | area: copilot-manual-question | parallel-safe: yes | automatable: yes

**Summary:** The shared contract behind a typed question — what counts as submittable, what string gets submitted, and the order practice mode's two effects run in.

**Steps:**
1. `cd hello-world && npx vitest run --no-file-parallelism lib/copilot/manualQuestion.test.js`

**Expected:** `normalizeManualQuestion` collapses whitespace (including hard wraps out of a pasted posting), trims, rejects anything with no letter or digit in it, and caps at `MAX_MANUAL_QUESTION_CHARS`.

**Do not "fix" that cap to mirror the detect route.** The obvious rationale is wrong, and both the source comment and this case originally stated it wrongly: a typed question **never reaches** `app/api/copilot/detect/route.js` — skipping it is the entire feature — so its 1200-char truncation does not apply. The route a typed question does reach is `app/api/copilot/answer/route.js`, whose `question` is trimmed and **not length-capped at all**. `MAX_MANUAL_QUESTION_CHARS` is therefore the only bound between a pasted wall of text and a model request, and has to be a sane limit on its own merits.

It **must not** route through `cleanQuestion` (`lib/copilot/questions.js`). That helper repairs SPEECH: it drops leading filler, fixes transcription stutter, and appends a question mark. Typed text has none of those problems, and rewriting it means the card shows a different question than the one that was typed.

`submitPracticeQuestion` runs `advanceAsked` -> `abandonAnswer` -> `resetAnswer` -> `setDrillQuestion` -> `addToFeed`. **`advanceAsked` before `setDrillQuestion` is load-bearing:** it banks whatever is currently on the card onto the asked list, so running it after the replacement would bank the question just typed and lose the outgoing one, which the generator would then hand back later as if it had never been asked. This composition lives in `lib/` precisely because that ordering is unfalsifiable inlined in a React handler.

### R-183 | area: copilot-manual-question | parallel-safe: yes | automatable: yes

**Summary:** In live mode a typed question is indistinguishable from a detected one, minus the detection round trip.

**Steps:**
1. `cd hello-world && npx vitest run --no-file-parallelism app/copilot/useLiveSession.manual.test.js`

**Expected:** `addManualQuestion` puts the question into the same `questions` array detection feeds — so the dashboard's "Current question"/"Current answer" panels and `QuestionFeed` both pick it up — and drafts it through the same `draftAnswer` call, carrying the full aid set (points, cues, buzzwords, resume anchor, ideal project), not a barer card.

Four things it deliberately does NOT do, each of which is the actual assertion:

- **No `confirmQuestion` call, and `MIN_WORDS_FOR_LLM` is skipped.** That client exists to decide IS-THIS-A-QUESTION for a fragment of speech; typing is that decision, already made by the person who knows. A round trip to have the model second-guess it is slower and can discard the entry outright.
- **No pre-set type.** `runDraft` resolves `type: it.type || type`, so a locally-classified type would WIN over the drafted answer's own classification and make a typed card differ from a detected one.
- **No session required.** The realistic reason to type a question is that detection missed it or the interviewer is on a channel this tab cannot hear — gating on a live session withholds the feature in exactly that case.
- **The Auto-draft switch is still honoured**, because "the same as detecting" includes the switch.

It DOES write `lastQNormRef`, so the same question arriving from the transcript a second later is suppressed. Typing what you just heard while the interviewer is still speaking is the common case, and without this it costs two identical cards and two drafts.

**The guard is one-directional on the manual path, deliberately** — detection both reads and writes it; manual entry only writes. So typing the same question twice in a row DOES produce two cards. That is the intended behaviour: an explicit submit must never vanish with no feedback, and the feed already has Redraft for the other intent. In live mode the second card costs no extra model call (`runDraft` serves it from `answerCacheRef`); in practice mode `useRoomQuestions` has no cache, so a deliberate repeat there IS a second full round trip. Both directions are pinned by tests; changing either is a behaviour change, not a cleanup.

**Two positive controls guard this file, and must not be removed.** Every other case here asserts an ABSENCE ("still one card"), which a completely deaf detector satisfies — gutting the `speech_final` branch in `onTranscript` left the whole file green before they existed. This is the only jsdom coverage live detection has while `useLiveSession.instant.test.js` is red for unrelated reasons.

### R-184 | area: copilot-manual-question | parallel-safe: yes | automatable: yes

**Summary:** In practice mode one submit does two things — the typed question becomes the drill question AND joins the detected-questions feed with a drafted answer.

**Steps:**
1. `cd hello-world && npx vitest run --no-file-parallelism app/copilot/practice/useRoomQuestions.manual.test.js app/copilot/practice/usePracticeQuestions.manual.test.js`

**Expected:** `useRoomQuestions.addManualQuestion` adds a feed entry with the same full aid set a room question gets, without calling `confirmQuestion`.

**It must not go through `shouldTreatAsRoomQuestion`.** That gate guesses from speaker tags whether a turn belonged to someone other than the candidate, and while the candidate's own answer is recording it attributes every turn to them and reacts to none. Typing is an explicit statement about someone else's question; running it through a voice-attribution guess would silently swallow it in precisely the state manual entry exists to route around. The test asserts an overheard turn IS dropped in that state while a typed one is not.

`usePracticeQuestions.setManualQuestion` bumps the SAME `reqGenRef` generation token every other caller bumps, so a generated question already in flight cannot land on top of the typed one when it resolves. It also clears `questionLoading`, `questionError`, and `exhausted` — the exhausted notice disables "Next question", so left standing it both reads as false beside a fresh question and strands the user with no way forward.

It also writes `currentQuestionRef` **synchronously**, in addition to the state. The mirroring effect that already exists would get there eventually, but `usePracticeAnswerActions` reads that ref to stamp which question a recording belongs to, and this is the one path where a user can press "Use question" and "Start answering" back to back with nothing in between to force a flush. The test reads the ref INSIDE the same `act` as the call: asserting after `await act(...)` proved nothing, because awaiting runs the effect, so the test passed even when the setter never touched the ref.

**This file's positive control** — a question detected from the room — must not be removed, for the same reason as R-183's: an early `return` at the top of `onUtterance` left every other case here green.

### R-185 | area: copilot-manual-question | parallel-safe: yes | automatable: yes

**Summary:** The manual-question control's semantics — the parts that ARE the markup.

**Steps:**
1. `cd hello-world && npx vitest run --no-file-parallelism app/copilot/ManualQuestion.test.js`

**Expected:** A real `<form>`, so Enter submits without reaching for the button. The field has an accessible name from its label and the button has a non-empty one. Blank, whitespace-only and punctuation-only entries cannot be submitted by either route — a disabled button does not stop a form submit, so the Enter path is asserted separately.

The field clears and focus stays in it **only when the caller returns exactly `true`**. A refusal means the question landed nowhere; clearing regardless would destroy the typed text and leave no trace of it on screen. Keeping focus matters because this control is used repeatedly mid-interview — losing it to `<body>` means tabbing from the top of the document every time (WCAG 2.4.3, the same failure `CopilotDashboard`'s reveal button already had to fix).

The `role="status"` region is mounted from the first render but EMPTY, because a live region that mounts already carrying its text is not announced — only a later text change is. **Known limit, deliberately not worked around:** submitting the identical question twice in a row produces identical region text, which React renders as no change, so the second add is silent there. Three other signals cover it.

The helper text is wired to the input via `aria-describedby`. It is NOT passed as MUI's `helperText` prop: that puts it inside the FormControl, which makes the flex row taller and stretches the submit button to match it. See R-186.

### R-186 | area: copilot-manual-question | parallel-safe: no | automatable: no

**Summary:** The manual-question row's geometry, and the two known tensions it introduces.

**Steps:**
1. `/copilot` is behind Supabase auth, so measure it the way the mobile pass did: a throwaway page under `app/auth/<name>/` (middleware treats `/auth/*` as public) rendering `ManualQuestion` inside the `.page > .main` embedding. **Delete the harness before committing.**
2. At 320px and 1280px, measure element bounds against the viewport, and `getBoundingClientRect().height` on `.MuiInputBase-root` and every `button`.
3. In live mode, confirm the control is reachable during a running session WITHOUT expanding "Show transcript and question history".
4. In practice mode, type a question and confirm the card above changes to it, the type chip is right, and the recorder does NOT start by itself.

**Expected:** Zero elements escaping the viewport at either width — `app/globals.css:20` sets `html { overflow-x: hidden }`, so overflow is silently CLIPPED and unreachable and a visual check cannot tell "fits" from "the right third was deleted". No touch target under 44px at 320px. At 1280px the input and the button are the same height with their tops aligned; the row is 40px with no helper text and ~63px with it.

**The button height is the specific thing that regressed once and will again.** With `helperText` passed to the TextField, the helper text sits inside the FormControl, the flex row's default `align-items: stretch` applies, and the button rendered 63.9px (live idle) and 83.8px (practice) against a 40px input. The fix is structural — helper text as a sibling BELOW the row, with `aria-describedby` wired by hand — not a hard-coded height and not `align-items: flex-start`, so that matching heights keep falling out of the layout at any TextField `size`.

Live mode passes `helperText` only while idle. Commit 5258564 made live mode fit the viewport without scrolling; a permanent row spent on a sentence already read by the time a session starts eats that budget for nothing. The control's wrapper deliberately does not set `minHeight: 0`, so the flex item's automatic content-based minimum protects it from being squashed by the bounded live wrapper — the dashboard is the designated shrinker and is the only child that opts out.

**Two accepted tensions, so nobody re-discovers them as bugs:**

- **Practice mode shows the same question's answer twice, at two different reveal levels.** The typed question lands on the drill card with its sample answer hidden behind "Show sample answer" (the drill is answering cold), while the same question's fully drafted answer sits in the feed lower down the page. This dual exposure already existed for genuinely overheard room questions; typing makes it trivially easy to trigger for your own drill question. Accepted because the user asked for both effects explicitly. The smallest fix, if it is ever judged worth one, is to land the feed entry at `status: "idle"` so it needs a "Draft answer" press.
- **A typed question does not arm auto-start.** `onNextQuestion` sets `armedRef`/`armedFromRef` so the recorder starts by itself once the question lands; manual entry deliberately does not, because the user's hands are on the keyboard and they have not signalled they are ready to speak.

### R-187 | area: experience-tree | parallel-safe: yes | automatable: yes

**Summary:** The Professional Experience page tree orders siblings deterministically, never loses a page to a broken parent link, and produces minimal move updates.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/tree.test.js`.

**Expected:** 27 tests pass. Six of them exist because a peer audit mutated a reference implementation 29 ways against an earlier draft of this file and those six defects survived; they are marked `[S1]`..`[S6]` in the source and must not be weakened:

- `[S1]` a tree node carries the WHOLE row, not `{id, children}`. The tab and the editor render `title` and `body` straight off these nodes, and an implementation that dropped them passed every other assertion.
- `[S2]` a tied `position` falls through to `created_at` BEFORE `id`. The fixture's ids sort opposite to its timestamps, so skipping `created_at` gives the wrong answer rather than accidentally the right one.
- `[S3]` `collectDescendantIds` is depth-first. The fixture's deep branch is deliberately not the last branch, so breadth-first returns a different sequence.
- `[S4]` `moveNode` is minimal on the DESTINATION side as well as the vacated side. Applying the update set makes a redundant update indistinguishable from no update, so this is asserted on the raw set and cannot be checked through the apply helper.
- `[S5]` `canMove`'s reason codes have a precedence order (`unknown-page`, `self-parent`, `unknown-parent`, `cycle`); the route puts the code in front of the user in a 400.
- `[S6]` no page ever disappears. A row whose parent is absent, is itself, or sits in a loop is promoted to a root. The ids in the tree are exactly the ids in the input, each once.

Also pinned: a row with no `created_at` still sorts deterministically. `Date.parse(undefined)` is `NaN`, `NaN !== NaN` is true, and the resulting `NaN` comparator result is coerced to `0` by the sort spec, silently skipping the `id` tiebreaker. The column is `not null` in the database, so this only arises for a page created optimistically on the client before its insert returns, which is exactly when the user is watching it appear.

### R-188 | area: experience-api | parallel-safe: yes | automatable: yes

**Summary:** The knowledge base routes take ownership from the session only, and tell a caller nothing about rows that are not theirs.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/experience/routes.contract.test.js`.

**Expected:** 11 tests pass, covering:

- Every route answers 401 without a session AND never calls the data layer at all. Paired with a positive control, so a route that 401s unconditionally fails.
- `user_id` always comes from the session. A `user_id` in the request body is ignored and must not appear anywhere in the arguments passed to the data layer.
- A `parent_id` the caller does not own returns **404, not 403** - 403 would confirm the row exists to someone who cannot see it. Paired with a positive control on a parent the caller does own.
- `POST /api/experience/move` refuses a body that omits the `newParentId` KEY, rather than treating the omission as "move to top level". The tree layer treats `undefined` as `null` deliberately; the route must not let a caller reach that by dropping a key.
- A move the tree rejects comes back as 400 carrying the machine `reason` code, and never reaches the store.

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

### R-190 | area: experience-tree-keyboard | parallel-safe: yes | automatable: yes

**Summary:** The Professional Experience page tree implements the W3C APG tree view keyboard pattern, and the component actually dispatches what the pure model decides.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/treeNav.test.js app/components/experience/PageTree.test.js`.

**Expected:** All tests pass. The decisions live in `lib/experience/treeNav.js` and are asserted without a DOM; `PageTree.test.js` asserts the WIRING, which neither pure test can see - two individually-correct halves joined wrong is a defect this codebase has shipped before.

Load-bearing specifics, each of which was a surviving mutant in an earlier draft:

- `nextFocus` returns all five fields every time (`focusId`, `expand`, `collapse`, `activate`, `handled`). Asserting `focusId` alone let eight defects through, including ArrowDown quietly expanding every collapsed node it passed - a keyboard user unfolding the tree behind themselves.
- `handled: false` for keys the tree does not own. A tree that calls `preventDefault` on Tab is a keyboard trap; `defaultPrevented` is the ONLY way to see the difference in jsdom, and the event must be created with `cancelable: true` or `preventDefault` is a silent no-op and the test passes against anything.
- Space activates and never reaches type-ahead. The fixture deliberately contains a title starting with a space and one starting with "Shift" so the "these keys are not type-ahead" test can actually fail.
- Type-ahead matches a PREFIX of the visible TITLE, searching forward from the current node. The fixture's ids and titles are deliberately different strings; an earlier draft used `title: id.toUpperCase()` and could not tell the two fields apart.
- `aria-expanded` on parents only - never on a leaf, where it would announce a collapsed parent that never opens - and exactly ONE node at `tabindex="0"`.
- All four row actions (add sub-page, rename, delete, move) are in the tab order for the row holding the roving tabindex, and only that row. Re-parenting was pointer-only when first shipped; three more actions were found the same way by the accessibility pass afterwards.

### R-191 | area: experience-markdown | parallel-safe: yes | automatable: yes

**Summary:** The page-body markdown parser cannot emit a navigable dangerous URL from any block context, and never silently discards what the user typed.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/markdown.test.js app/components/experience/MarkdownPreview.test.js`.

**Expected:** All tests pass, including:

- Every dangerous scheme tried in EVERY block context - heading, list item, task item, ordered item, blockquote, inside emphasis, nested list - not just a bare paragraph. An implementation that parsed first and sanitized the tree afterwards, visiting only paragraph blocks, passed an earlier draft while leaving live `javascript:` links in all the others.
- URLs are checked STRUCTURALLY by walking the tree for any href-like property, not by searching JSON for the substring `"link"`. A token renamed to `unsafe-link` passed the earlier draft with its href fully intact, because the character before `link` was a hyphen rather than a quote.
- An ALLOWLIST (http, https, mailto, single-leading-slash paths). `file:`, `blob:`, `about:`, `view-source:`, `intent:`, `filesystem:`, `//evil.com` and `/\evil.com` are all rejected. The last one is protocol-relative via the WHATWG backslash equivalence and was found during verification; it had been marked SAME-ORIGIN, which also stripped it of `rel="noopener noreferrer"`.
- Safe URLs in non-canonical form (uppercase scheme, leading whitespace, leading C0 control, a tab inside the scheme) STILL produce links. Under an allowlist those defences are invisible to a dangerous-scheme fixture, so without these positive controls three real defects survived - each of which would silently turn a pasted link into plain text.
- CRLF input parses identically to LF. In JavaScript `.` does not match `\r`, so a regex anchored `(.*)$` fails on every line of a document pasted from Word or Outlook, dropping a fenced code block's entire contents. Windows machine; that paste is the common case.
- Malformed input keeps the user's characters. A mutant that deleted any paragraph containing a bracket or a pipe passed an earlier draft, because "did not throw" and "is an array" are both true of an empty array.
- `MarkdownPreview` shifts body headings down one level so the page title stays the only `h1`, puts `rel="noopener noreferrer"` on external links only, and renders no `<script>` element for `<script>` text while still showing that text.

### R-192 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** An uploaded file's storage key can never escape its owner's prefix, and a rejected upload explains itself.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/attachments.test.js app/components/experience/AttachmentPanel.test.js`.

**Expected:** All tests pass. The safety invariant runs 30 hostile filenames and checks each against BOTH the literal segment and `segment.normalize("NFKC")` - the normalized form is the general statement, because a key containing no separator today is worthless if one downstream normalization pass would create one.

Specifics that were each a real defect:

- The sanitize pipeline order is fixed: normalize and percent-decode to a FIXED POINT together, then strip forbidden characters, collapse separators, strip `..` repeatedly, trim leading dots and trailing dots/spaces, rename Windows reserved device names, and truncate LAST. Normalizing once at the start still let `%EF%BC%8F` through as a fullwidth solidus, because nothing re-normalized what the decode produced.
- The attachment's uuid is IN the key. Seven inputs - four of them fixtures in an earlier draft - collapsed onto the single key `file`, so any junk-named upload could overwrite a real note.
- Caps are INCLUSIVE (exactly 100 MB of video is accepted) and the reason names both the limit and the filename on every path.
- Every delete button's accessible name includes its own file name; N attachments produce N distinct names.
- A failed notes save shows a visible error with Retry and does NOT roll back the typed text. The notes field is the only thing a model ever sees about a video, since video bytes are never sent as context.

### R-193 | area: experience-tab | parallel-safe: no | automatable: no

**Summary:** The whole tab works end to end against a real signed-in account and a real database.

**Steps:**
1. Sign in, open the Professional Experience tab.
2. Create a top-level page; rename it; type a markdown body with a heading, a list, a task item, a fenced code block and a link; switch to Preview.
3. Create a sub-page under it, then a sub-sub-page. Collapse and expand each level.
4. Drag a page onto another to re-parent it; then move a different page using the Move dialog.
5. Upload an image, a PDF and a short video to a page. Type notes on each. Reload the page and confirm all three, and the notes, survive.
6. Delete a page that HAS sub-pages. Read the confirmation text before confirming.
7. Reload the browser while on this tab.

**Expected:** Every operation persists across the reload. The delete confirmation names the exact number of sub-pages that will go with it. Step 7 returns to the Professional Experience tab rather than bouncing to Materials - the same restore-whitelist bug that silently affected Interview Copilot until this feature fixed it.

**Why manual:** the app is auth-gated and no test in the repo drives a real Supabase session or real Storage. A green suite says nothing about whether upload, signed-URL playback, or the delete cascade actually work against the live services.

### R-194 | area: experience-tab | parallel-safe: no | automatable: no

**Summary:** Every operation in the tab can be performed with the keyboard alone.

**Steps:**
1. Unplug or ignore the mouse entirely. Sign in and Tab to the Professional Experience tab.
2. Enter the tree. Using only arrows, Home, End and type-ahead, move to a nested page.
3. From the focused row, Tab to its action buttons and use each one: add a sub-page, rename, move (via the dialog), delete.
4. Tab into the editor, type a body, switch to Preview and back.
5. Tab into the attachments panel, reach the file input, and open the picker with the keyboard.
6. Tab out of the tree entirely and confirm focus leaves rather than cycling inside it.

**Expected:** Every step is possible. Focus is visible at all times. No step requires a drag. Tab is never swallowed.

**Why this case exists:** re-parenting shipped as drag-and-drop only, which is unreachable by keyboard and invisible to assistive technology. It was fixed, and an accessibility sweep then found three MORE actions with hardcoded `tabIndex={-1}` in the same file. Automated tests assert the attribute; only walking it end to end proves the whole path is usable.

### R-195 | area: experience-schema | parallel-safe: no | automatable: no

**Summary:** `experience_attachments` applies cleanly, isolates users, and cascades from its page.

**Steps:**
1. Apply `hello-world/supabase/migrations/20260812010000_experience_attachments.sql`, then run it a second time and confirm it succeeds again.
2. Confirm RLS is enabled and four owner-scoped policies exist, as for `experience_pages`.
3. As user A, upload an attachment. As user B, attempt to select it by id and attempt to DELETE it by id through the API.
4. As user A, delete the parent PAGE.

**Expected:** Step 3 returns nothing for user B and the delete returns 404, not 403 - 403 would confirm the row exists to someone who cannot see it. Step 4 removes the attachment rows via `on delete cascade`.

**Why manual:** no test executes this SQL, and the ownership-before-storage-delete ordering can only really be proven against a live bucket.

### R-196 | area: experience-bulk | parallel-safe: yes | automatable: yes

**Summary:** Selecting several project pages counts their blast radius once, and a bulk action acts on selection roots rather than every ticked row.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/bulkSelection.test.js app/components/experience/BulkActionsBar.test.js app/components/experience/ExperienceTab.test.js`.

**Expected:** All pass, including:

- Selecting a page AND one of its children reports the deduplicated total. A naive sum says six pages will be deleted from a tree that loses four; over-stating trains the user to ignore the number, under-stating loses their work. A disjoint pair is asserted separately so the dedup cannot hide as a blanket under-count.
- Execution filters to selection ROOTS, so a selected parent and child fire ONE request. Otherwise the second DELETE 404s after the cascade, or a move flattens a child out from under a parent that is still moving.
- `bulkMoveTargets` is the intersection across every selected page - a destination legal for one and illegal for another is excluded - and legitimately returns empty, which disables the action WITH an explanation rather than hiding it.
- Selecting a parent never implicitly selects its children.

### R-197 | area: experience-research | parallel-safe: yes | automatable: yes

**Summary:** A research report cites only sources the search actually visited, and refuses rather than fabricating when it cannot search.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/researchReport.test.js app/api/experience/research/route.test.js`.

**Expected:** All pass, including:

- A citation absent from `groundingMetadata` is demoted to plain text with its claim intact. Fabricated citations are worse than none because they look checkable - this is the lesson `app/api/company-research/route.js` already records in its own comments.
- A grounded source still matches when the metadata carries tracking parameters, a fragment or a trailing slash the model's citation lacks. Comparing raw strings drops REAL citations and teaches the reader to distrust the filter instead of the model.
- A different path on the same host is NOT corroborated - host-only matching would wave through any page on a site the search happened to touch.
- No grounding at all marks the report ungrounded rather than presenting it as researched.
- The embedded engine refuses and creates no page. There is no offline equivalent of a web search; fabricating one from the page's own text and calling it research is the failure this guards.
- The route is owner-scoped: another user's page is a 404.

### R-198 | area: experience-deck | parallel-safe: yes | automatable: yes

**Summary:** A generated deck follows an uploaded template and opens without repair.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/deckOutline.test.js lib/experience/pptxTemplate.test.js lib/experience/pptxWriter.test.js lib/experience/deckTemplateStore.test.js`.

**Expected:** All pass, including:

- The template's `ppt/theme/*`, `ppt/slideMasters/*` and `ppt/slideLayouts/*` come through BYTE-IDENTICAL and the new slides reference them. Regenerating those parts is exactly how a templated deck comes out looking like a default deck, and it passes any test that only counts slides.
- Layouts are chosen by OOXML type, then by name, then by falling back to the first - never by a fixed index, which is why generated decks come out wrong against an unfamiliar template.
- Every slide is declared in `[Content_Types].xml`, referenced from the presentation rels, and listed in `sldIdLst`. An undeclared part makes PowerPoint call the file corrupt.
- An image extension is declared once per extension, and an image whose bytes are missing degrades to a caption-only slide with NO dangling relationship. A dangling rel is the other thing PowerPoint reports as corruption.
- Ampersands and angle brackets in a title are escaped. A project called R&D is ordinary and an unescaped ampersand makes the file unopenable.
- Prose before the first heading survives, and a video becomes a NAMED placeholder rather than being silently omitted - otherwise the user presents a deck missing something they attached and believed was included.

### R-199 | area: experience-askai | parallel-safe: yes | automatable: yes

**Summary:** Ask AI pins the whole page, spends its context budget deliberately, and is honest about what the model cannot see.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/pageContext.test.js app/components/experience/PageEditor.test.js app/components/experience/ExperienceTab.test.js`.

**Expected:** All pass, including:

- The title, breadcrumb and attachment inventory survive even when a long body must be cut, and the truncation is STATED. The chat route truncates silently, and a model answering from a body cut mid-sentence gives a confident answer about half a project with nobody aware.
- Attachment bytes, storage paths and signed URLs never enter the pinned context.
- A video contributes its notes and any cached transcript, and says so when it has NEITHER - the bytes are not forwarded to the model, so a bare filename would read as though the model had watched it.

### R-200 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** Deleting an attachment is undoable for five seconds, and leaving the page resolves the pending deletion rather than losing track of it.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/experience/AttachmentPanel.test.js`.

**Expected:** All pass, including: the DELETE has NOT fired before the window elapses (asserted by call count - a delete that fires immediately and one that fires after five seconds are both "called"); Undo restores the row to its ORIGINAL position, anchored by its neighbour's id rather than an index, so cascading undos land correctly; several deletions can be pending independently; and a page switch or unmount FLUSHES pending deletions rather than cancelling them, so the user's view and the database never diverge.

### R-201 | area: manual-tailoring | parallel-safe: yes | automatable: yes

**Summary:** The manual tab accepts new postings while a tailor run is in flight.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/tailor/rollingQueue.test.js app/hooks/useManualPostings.test.js app/components/JobDescriptionTab.test.js`.

**Expected:** All pass, including the full journey in one test: paste, press Tailor, ADD A NEW BOX mid-run, paste, press Tailor again, and both postings tailor within a single pool with `running` transitioning to false exactly once.

Load-bearing specifics:

- `runWithConcurrency` is untouched. It is a batch primitive - a fixed array in, resolved when it drains - and its other callers depend on that. The rolling queue replaced it for this hook only.
- Enqueuing something already waiting does not inflate the total, or the progress readout never reaches its own target.
- The cap applies across the whole active period, not per press: two submissions of two must not put four model calls in flight.
- The period ends only when nothing is pending AND nothing is in flight. Checking one alone ends it early, sets the tally mid-flight, and flips the UI to idle while results are still arriving.
- A posting that already succeeded is not re-submitted.
- Locking is PER-ROW: only the box a worker owns is frozen.

**One correction recorded here deliberately:** a pre-existing test required the Add button to stay disabled during a run - the batch-era invariant this change removes. It was corrected into the two rules that now apply rather than deleted, and the reason is written into the test itself. Without that correction the feature was inert: you could not create the box for the second posting.

### R-202 | area: feed-ingest | parallel-safe: yes | automatable: yes

**Summary:** Area baseline for the Live Feed ingest pipeline, recorded before the LLM search source was added. This area had no case in this document; everything below was observed by reading the source and running the suite on 2026-08-13, not assumed.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/feed/`.
2. Read `hello-world/vercel.json`, `hello-world/lib/feed/ingestFeed.js`, and `hello-world/app/api/cron/feed-ingest/route.js`.

**Expected:** 72 tests pass across 5 files. The pipeline behaves as follows, and each point is a thing a later change must not silently break:

- **Two crons, two cadences.** `vercel.json` schedules `/api/cron/feed-ingest` at `* * * * *` (every minute) and `/api/cron/tailor` at `*/15 * * * *`. Anything wired into the ingest route therefore runs 1440 times a day; a per-run cost belongs behind its own cadence gate, not on the cron tick.
- **Both cron routes authorize the same way** and export `GET = POST`: a bearer token equal to `CRON_SECRET` when that is set, otherwise the `x-vercel-cron: 1` header. Neither accepts an unauthenticated request.
- **Greenhouse rotates, the other sources do not.** `MAX_COMPANIES_PER_RUN = 25` with a Redis cursor at `feed:ingest:cursor` walks `GREENHOUSE_COMPANIES` across runs; Lever, Ashby and the higher-ed RSS feeds are pulled in full every run.
- **Per-source failure isolation.** `runSource` collects failures per source into `sourceHealth` and never throws, so one dead board cannot abort a run or lose the other sources' postings.
- **One Redis lock, released in `finally`.** `feed:ingest:lock` is held for 110s with `nx`; a run that cannot take it returns `{ ok: true, skipped: "locked" }`. With no Redis configured every lock/cursor helper degrades to permissive rather than blocking ingestion.
- **`dedup_key` is the only uniqueness constraint** (`feed_postings.dedup_key text not null unique`), and it is namespaced per source (`greenhouse:gh-123`). Two sources carrying the SAME job therefore produce TWO rows today. Every adapter does store a canonical `url` — Greenhouse `absolute_url`, Lever `hostedUrl || applyUrl`, Ashby `jobUrl || applyUrl` — so a URL is the only cross-source identity available.
- **Retention is enforced by SQL, not by the app.** `prune_feed_postings` is called with `FEED_RETENTION_HOURS` (default 36) and a prune failure is logged and swallowed so it can never fail an otherwise good run.
- **The feed table is global and world-readable.** `feed_postings` has RLS `using (true)` for select and is written only by the service role. There is no per-user partition: anything ingested for one user's saved search is visible to every user.
- **Queue selection is pure keyword AND-matching.** `selectQueueCandidates` requires every `job_keywords` entry to appear in title+description, rejects excluded title keywords and excluded companies by substring, and applies `max_years_exp`. It never calls a model.
- **`positions.source` is inferred from an id prefix, and the inference is wrong for anything new.** `jobToPositionRow` in `lib/feed/tailorAndQueue.js` reads `String(job.id).startsWith("gh-") ? "greenhouse" : "jsearch"`, and `postingToJob` does not carry the feed row's own `source` through. Every non-Greenhouse posting queued for auto-apply is therefore recorded as having come from jsearch, including Lever, Ashby and RSS postings today.
- **The Live Feed card renders the raw source string.** `LiveFeedTab.js` renders `<Chip label={posting.source} />` with no mapping table, so a new source value appears in the UI exactly as stored.

### R-203 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** Nothing the model says about a posting is trusted except the URL, and even the URL is only trusted once the page behind it has been fetched.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/llmSearch.test.js lib/feed/llmSearchParse.test.js`.

**Expected:** All pass, including each of these independently:

- A candidate whose page `fetchUrlContent` cannot read is DROPPED — not stored with a null description, not stored with the model's. The run itself still reports `ok: true`, because an unverifiable result is a normal outcome and not a source failure.
- A candidate whose host appears nowhere in the response's `groundingMetadata` is dropped. Empty grounding rejects EVERY candidate: no grounding is no evidence the model searched at all, and treating it as permissive is exactly how a fabricated posting reaches a globally-readable table.
- A page that does not read like an individual posting is dropped. The length floor and the marker check are separate rules and are tested separately — a short page fails even carrying a marker, and a long page passes on any ONE marker alone. A long careers INDEX page that mentions "requirements" must still fail; it is the realistic false positive.
- `parsePostings` DISCARDS the model's `description` field outright rather than carrying it under another name. `description_snippet`, `raw_data.description`, `salary_min`/`salary_max` and `min_years_required` all derive from the FETCHED text. This is the load-bearing rule of the whole feature: that description is what a résumé gets tailored against, so a fabricated one produces a résumé tailored to a job that does not exist.
- The three drops above are each paired with a positive control — a mixed batch where the one verifiable posting survives. Without it an implementation returning an empty array unconditionally satisfies every drop assertion.
- **`location` and the `remote_type` derived from it are a deliberate, recorded exception** and come from the model. They are display metadata that never reach a tailoring prompt, and a fetched page frequently states remoteness nowhere parseable. Do not "fix" this by deriving `remote_type` from page text without also revisiting the tests that pin it.

### R-204 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** An AI-found posting is actually usable by the pipeline it was ingested for — the half of the feature that is invisible until it is missing.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/llmSearch.test.js lib/feed/postingProvenance.test.js`.

**Expected:** All pass, including:

- Every row carries a `source_posting_id`, and it is STABLE: the same posting discovered on two separate runs yields the same id, while two different URLs yield different ids. `postingExternalId` reads this column; `selectQueueCandidates` skips any row whose external id is empty and `tailorAndQueueOne` throws on one. A row without it enters `feed_postings` and is then invisible to the entire auto-tailor pipeline — the feature ships looking complete and auto-applies to nothing, with every unit test green. This is asserted end to end by feeding a produced row to the real `selectQueueCandidates`.
- `dedup_key` is `ai_search:<canonical FINAL url>` — the URL the fetch RESOLVED to, not the link the model produced. The fixture proving this uses two URLs that canonicalize DIFFERENTLY; a fixture where both canonicalize the same proves only that canonicalization ran.
- The shared normalizers in `lib/feed/normalize.js` are genuinely called (asserted with module spies, not by matching output values). A private twelve-line reimplementation reproduces every stored value exactly and would otherwise pass.
- `postingToJob` carries the feed row's `source` through and `jobToPositionRow` prefers it, falling back to the `gh-` prefix inference only when absent. Before this, every Lever, Ashby and RSS posting queued for auto-apply was recorded in `positions.source` as `jsearch`.

### R-205 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** The source is wired into the real ingest run, and the cadence gate that keeps it affordable is wired in with it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/ingestLlmSource.test.js`.

**Expected:** All pass. These are asserted through actual `ingestFeed` runs by observable effect — was a model call issued, did the row reach the shared upsert — never by re-testing the pieces:

- Two consecutive `ingestFeed` runs issue exactly ONE grounded model call; the second reports `sourceHealth.ai_search.skipped`. `/api/cron/feed-ingest` fires every minute (R-202), so a source without this gate costs 1440 grounded calls per query per day. `shouldRunLlmSearch` being unit-tested proves nothing unless `ingestFeed` actually calls it — the test mocks Redis in memory for exactly this reason, because with no Redis every cadence path is inert and an implementation that omits the gate entirely passes.
- A SKIPPED run does not consume the cadence window. Otherwise a persistently failing model call burns the window every minute alongside itself.
- Zero model calls when the deployment runs the embedded engine, when no Gemini key is configured, or when no saved search has `auto_tailor_enabled` or `email_on_new_jobs`. Each reports a `skipped` reason rather than a failure — "chose not to run" and "ran and found nothing" must stay distinguishable.
- A model failure leaves `summary.ok` true, still prunes, and still reports the other four sources. A Redis client whose `get`/`set` reject also leaves the run succeeding: a cache hiccup must never take ingestion down.
- AI rows go through the SHARED chunked upsert — one call carrying `{ onConflict: "dedup_key", count: "exact" }` with `updated_at` stamped — not a private one. A source running its own private upsert produces identical rows while skipping chunking, the exact-count tally and the run's health accounting.
- The per-run page-fetch budget is enforced at the ingest call site and split across every query due that run, not only inside the helper's own per-query cap.

### R-206 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** The same job found by two different sources produces one card, not two.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/canonicalUrl.test.js lib/feed/ingestLlmSource.test.js`.

**Expected:** All pass. `feed_postings.dedup_key` is namespaced per source (R-202) and therefore cannot dedupe a Greenhouse row against an AI-search hit for the same job; the canonical URL is the only cross-source identity, and every adapter stores one. So: a posting already in the feed under another source is dropped, paired with a positive control keeping one the feed has never seen; within a batch the first occurrence wins; and a posting whose URL will not canonicalize is dropped rather than bucketed under a shared empty-string key.

`gh_jid` is deliberately NOT treated as a tracking parameter — on a Greenhouse-embedded careers page it IS the posting id, and stripping it collapses every job on that board into one key. `utm_*`, `gh_src`, `ref` and `source` are stripped, the host is lowercased and `www.`-stripped, and surviving parameters are sorted so parameter order cannot fork the key.

**Known limitation, deliberate:** the dedupe reads at most `AI_SEARCH_DEDUPE_URL_SCAN_LIMIT` recent URLs, so it is best-effort above that bound rather than exact. The read is bounded AND ordered by `ingested_at` descending so that any truncation retains the rows most likely to collide with a posting found today. An unbounded read here was a full-table scan inside a serverless function whose silent truncation would have stopped the dedupe doing the one thing it exists for.

### R-207 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** One grounded search serves every user who asked for the same thing, and the query budget is the real cost control.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/llmSearchQueries.test.js lib/config/env.test.js`.

**Expected:** All pass, including: two users whose saved searches carry the same keyword set (in any case or order) collapse to ONE query, paired with a positive control keeping genuinely different searches separate; a search with no usable keywords is skipped, because an empty query returns whatever the web feels like and `feed_postings` is world-readable; only searches with `auto_tailor_enabled` or `email_on_new_jobs` produce queries, since those users already opted into automated work and no second switch was added for them to find; and the cap applies **at its default of 3**, not only when passed explicitly — the default is what production runs.

`getLlmSearchIntervalMinutes` defaults to 60 and falls back to 60 for a non-numeric, zero, or negative `LLM_SEARCH_INTERVAL_MINUTES`.

### R-208 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** `extractGroundingSources` has exactly one definition, and the routes that use it use that one.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/grounding.test.js app/api/company-research/route.test.js`.

**Expected:** All pass. `app/api/company-research/route.js` and `app/api/experience/research/route.js` both expose the SAME function reference as `lib/llm/grounding.js`. The assertion is on identity rather than behaviour deliberately: three byte-identical copies existed, and adding a shared module while leaving the copies in place passes every behavioural test while removing no duplication at all. The experience-research copy was private and is re-exported solely so this can be checked.

### R-209 | area: ai-search | parallel-safe: yes | automatable: yes

**Summary:** CLOSED. The Live Feed no longer renders a raw source string. Kept as the record of a gap that was declared rather than hidden, and of what closing it actually took.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedWiring.test.js`.

**Expected:** All pass, and in particular `LiveFeedTab.js` contains no `label={posting.source}`. The behaviour that replaced it is covered by R-210 (labels and provenance), R-211 (status readouts), R-212 (accessible names) and R-213 (the wiring and the size limit).

**The original gap, preserved:** when the AI-search source shipped, every posting card rendered `posting.source` through a `Chip` with no mapping, so `greenhouse`, `lever`, `ashby`, `highered_rss` and `ai_search` all appeared exactly as stored in the database. It was left that way deliberately: `LiveFeedTab.js` was 1320 lines, over the 1000-line limit, so any edit to it obliged a split in the same change — and that was scoped as its own work item rather than bolted onto the ingest source.

**What closing it actually cost, worth knowing before the next deferral:** the split ran 1320 to 855 lines, and the three components originally planned were not enough — extracting only the card, the toolbar and the filter summary left the file at 1006 lines, so two further seams (`FeedEmailAlerts.js`, `FeedSearchFields.js`) had to be found. The work also surfaced two defects that had nothing to do with labelling and would not have been found otherwise: the toolbar counted source failures for Greenhouse alone, and feed staleness was signalled only by a coloured dot. Both are now covered by R-211.

### R-210 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** Every posting source renders as something a person recognizes, and an AI-found posting says what was actually checked about it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedClient.test.js app/components/feed/FeedPostingCard.test.js`.

**Expected:** All pass, including:

- `SOURCE_LABELS` covers every source `ingestFeed` writes — greenhouse, lever, ashby, highered_rss, ai_search — and no label leaks snake_case. `sourceLabel` falls back to the RAW value for a source the map has not caught up to, never to "Unknown": hiding an unrecognized source erases the only clue anyone debugging a new adapter has. A missing source renders `""`, not the literal word "undefined".
- `sourceProvenance` returns text only for `ai_search`, is rendered as VISIBLE text on the card rather than in a tooltip (a tooltip is unreachable on touch and easy to miss, and this is the whole reason to trust a model-proposed posting), and is capped at 60 characters because it repeats on every AI card.
- It must not overstate. `lib/feed/llmSearch.js` proves the URL resolves to a page that reads like an individual posting (R-203); it proves nothing about the role's quality and nothing about whether the job is still open. The test asserts the absence of "still open", "guarantee", "vetted" and "high quality", **paired with a positive control** asserting the sentence is actually present — without which a card rendering nothing at all would pass.
- `remote_type` renders through `REMOTE_LABELS`, so "On-site" rather than the raw enum.

### R-211 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** The Live Feed's status readouts tell the truth about every source, and in words rather than colour.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedClient.test.js app/components/feed/FeedToolbar.test.js`.

**Expected:** All pass, including:

- `sourceHealthFailureCount` sums failures across EVERY source. The toolbar previously read `sourceHealth?.greenhouse?.failures` alone, so a total outage of Lever, Ashby, the higher-ed RSS feeds or AI search displayed as perfect health — wrong from the moment a second source was added, and worse once there were five.
- A `skipped` source is NOT a failure and is not counted. The AI-search source reports `skipped` whenever the engine choice, the missing key or the cadence gate says not to run this cycle (R-205), which on a correctly-configured deploy is most runs. Counting it would put a permanent warning on a healthy feed.
- `freshnessLabel` returns different WORDS for stale and fresh, both carrying the relative time, with the before-first-ingest state distinct from both. Staleness used to be signalled only by a dot changing from green to amber — colour carrying meaning with no text equivalent (WCAG 1.4.1). The dot remains as glanceable reinforcement; it is no longer the only signal.

### R-212 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** Every control in the Live Feed has a name a screen reader can reach and a voice-control user can say.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/feed/FeedPostingCard.test.js app/components/feed/FeedToolbar.test.js`.

**Expected:** All pass. The rules below are what the tests enforce, and each exists because the code violated it:

- **Every control has a non-empty accessible name.** MUI's `Tooltip` labels its DIRECT child, and several controls are wrapped in a `<span>` so a tooltip still shows while the button is disabled — which put the name on the span and left the button announced as nothing at all. The fix is an explicit `aria-label` on the control itself, which MUI cannot override because the child's own props are spread last.
- **A tooltip must never override a visible label** (WCAG 2.5.3). A button reading "Autofill profile" was named "Edit the profile used by Auto Fill and get your bookmarklet", so a voice-control user saying what they saw could not activate it. Tooltips that EXPLAIN carry `describeChild`, making them `aria-describedby` rather than the name. This applies to non-controls too: the source-error `Chip` had the identical defect and was initially fixed with no test noticing, because the first version of the check only inspected `button, a[href]`. It now inspects every element carrying an `aria-label`.
- **A card's control names identify WHICH posting.** Forty cards previously produced forty controls all named "Hide". Names carry the posting title and stay distinct within a card, and the card renders exactly its four controls — pinning the count alone let a mutant swap Auto Fill for a do-nothing decoy and pass every naming assertion.
- **The accessible-name model in these tests reflects what an AT resolves, not one technique.** It resolves `aria-labelledby` and `title` as well as `aria-label`, and it strips `aria-hidden`, `[hidden]` and `display:none` subtrees before falling back to text — an earlier version accepted a control whose only name was a hidden span, which reads as named to a naive helper and as nothing to a real user, and rejected a correct `aria-labelledby` implementation.
- **The posting title is an `h3`** (under `TabHeader`'s `h2`) and the card is an `<article>`. It was a bold `Box` inside a `div`: the feed read as one undifferentiated run of text with no way to move between postings.

### R-213 | area: feed-ui | parallel-safe: yes | automatable: yes

**Summary:** The extraction is actually wired in, and LiveFeedTab stays under the size limit.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/feed/liveFeedWiring.test.js`.

**Expected:** All pass. `LiveFeedTab.js` renders `FeedPostingCard`, `FeedToolbar` and `FeedFilterSummary`; contains no `label={posting.source}` and no `sourceHealth?.greenhouse?.failures`; calls `freshnessLabel` and `sourceHealthFailureCount`; and every component under `app/components/feed/` plus `LiveFeedTab.js` itself is under 1000 lines, with `LiveFeedTab.js` specifically under 900 (it was 1320; it is now 855).

**Why this file exists, and why it reads source text rather than behaviour:** every other test in this change gates a PIECE. All of them pass just as happily against a `LiveFeedTab.js` that still has every original defect, with the new components sitting beside it fully tested and never rendered — which would have closed R-209 on paper while changing nothing on screen. An independent audit demonstrated exactly that before this file was written. Reading source text is ordinarily a poor way to test anything; it is used here because the properties being pinned are about the shape of the source, and the alternative — mounting the whole tab — drags in network state and a 60-second refresh timer. Where a behavioural test is possible it lives in the component test files instead.

**Not gated, deliberately:** `FeedEmailAlerts.js`, `FeedSearchFields.js` and `FeedFilterSummary.js` have no behavioural tests, only the wiring assertion that they are rendered. They were extracted to get `LiveFeedTab.js` under the limit; extracting only the three originally planned components left it at 1006 lines.

### R-214 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** A project page accepts PowerPoint and Excel files, tells the two apart on screen, and never implies the AI opened either one.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/attachments.test.js lib/experience/pageContext.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.

**Expected:** All pass. `classifyAttachment` answers `slides` for PowerPoint/Keynote/OpenDocument presentations and `sheet` for Excel/Numbers/OpenDocument spreadsheets, by mime type or by extension; the panel labels each distinctly; the pinned AI context names the kind and states once that no file's contents were read.

Load-bearing specifics, each of which was a real defect or one an audit proved could ship undetected:

- **The mime fixtures carry a `.bin` name on purpose.** An earlier draft named them `deck.pptx`, `book.xlsx` and so on - and because `kindOf` falls back to the extension, deleting the ENTIRE office mime table left the spreadsheet case green. Twelve of the fourteen mime strings the block exists to pin were unfalsifiable. A fixture whose two candidate paths reach the same answer proves neither of them ran.
- **The macro-enabled mime keys are stored lower-case.** `kindFromMime` lowercases its input, so `application/vnd.ms-excel.sheet.macroEnabled.12` written in the casing Windows actually sends can never match its own table entry. The fixtures deliberately use the real casing.
- **A `.csv` that Windows reports as `application/vnd.ms-excel` stays `text`.** Excel registers itself as the csv handler on most Windows machines, so this is the common case, not an edge one. It is the ONLY mime treated as ambiguous - `notes.txt` served as `application/pdf` is still a PDF, and `deck.txt` served as `application/vnd.ms-powerpoint` is still a deck. A wholesale precedence flip is the failure mode, and those two are the positive controls that catch it.
- **A bare `.key` file is not a Keynote deck.** `server.key` is a PEM private key far more often. Only the unambiguous `application/vnd.apple.keynote` mime classifies one.
- **The panel asks the SHARED classifier.** A private copy of the type table inside `AttachmentPanel.js` that happened to agree would produce identical markup and identical requests, so nothing else in the file could tell them apart. The test spies on the real module and asserts it was consulted.
- **The kind is text, not an icon.** Each kind renders its own decorative icon, but `Slides`/`Spreadsheet` is written out beside the file size - the icons are asserted distinct from each other AND from the generic file icon, and asserted `aria-hidden`.
- **Neither kind is previewed inline**, because the GET route mints no signed URL for them and an `<img>` would render broken. An image alongside them is the positive control, or "previews nothing at all" passes.
- **Only the deck and spreadsheet lines say "contents not read", and it must stay that way.** A draft of this change put the disclaimer on the `Attachments:` header instead, covering every kind, on the premise that a page attachment's bytes are never forwarded to the model. That premise is false: pressing Ask AI in `ExperienceTab.js` pins the context and then downloads every attachment whose kind is in `DOWNLOADABLE_ATTACHMENT_KINDS` (image, pdf, text) and hands the bytes to `addChatAttachments`, which turns them into inline data and extracted text on the same turn. The header version therefore told the model it had not read three files it was being handed in the same request - false in the more dangerous direction, and a test had already locked it in. A deck or a spreadsheet is downloaded by nothing, which is exactly why those two need the sentence. The test asserts both halves: `not read` present on slides/sheet, absent on image/pdf/text, absent from the header, and absent entirely from a page with no attachments.
- **The extension and mime tables are looked up with `hasOwnProperty`, not `table[key]`.** A plain-object lookup walks the prototype chain, so `notes.constructor` resolved to a FUNCTION - truthy, not the string `"other"` - and sailed through the unsupported-type check into an accepted upload with a function as its kind. `payload.__proto__` did the same with an object. Both survive `extensionOf`'s lower-casing, which is what makes them reachable at all. Pre-existing, found while verifying this change, and fixed at all three lookup sites.

**Known gap, deliberately not closed here:** `lib/experience/deckOutline.js` returns no slides for these kinds, so an attached `.pptx` does not appear in a deck generated FROM that page. That matches how `pdf` and `text` already behave; changing it needs a new slide kind in `deckOutline.js` and a matching branch in both of `pptxWriter.js`'s switches.

### R-215 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** A file whose name contains characters Supabase Storage refuses can still be attached, and an upload that does fail says which file and why.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/attachments.test.js lib/supabase/experienceAttachments.test.js app/api/experience/attachments/route.upload.test.js`.

**Expected:** All pass.

**The report that produced this case:** uploading `Centralized PR Standards [Autosaved] [Autosaved].pptx` to a project page answered `Could not save this attachment.` and nothing else. Two independent defects had to line up for that:

- **`storagePathFor` built a key storage refuses.** storage-api's `isValidKey` accepts only `` /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/ ``, and that `\w` carries no `u` flag, so it is ASCII `[A-Za-z0-9_]` and every non-ASCII character is outside the set too. Square brackets are outside it. `@supabase/storage-js` does no client-side key validation, so the object was refused server-side. PowerPoint appends `[Autosaved]` to its own autosave copies, and `[Compatibility Mode]` likewise, so this is an ordinary filename rather than an exotic one.
- **The route reported every cause with one string.** The genericization is half-right and stays: a failed INSERT can carry Postgres's `duplicate key value violates unique constraint`, which tells a caller that someone else's row holds that id. But it was applied to the storage-upload failure too, which is about the caller's own file. Two different causes - a rejected key and a bucket restriction - were indistinguishable to the user and to anyone diagnosing it.

Load-bearing specifics, several of which are here because a mutation run proved the first draft of these tests could not catch them:

- **The charset assertion runs over all 30 hostile names**, added INTO the existing R-192 invariant loop rather than beside it. A key that satisfies every traversal rule and still cannot be written is worth nothing.
- **Characters are escaped, never deleted.** Asserting `contains "Autosaved"` and `no brackets` passes just as well against a sanitizer that silently eats characters, so the test names the replacement (`_Autosaved_`) instead. Deletion is visibly wrong only once nothing safe is left: a wholly non-ASCII stem would collapse to `.pptx`, whose leading dot the trim stage then eats, leaving a key with no extension.
- **Two replacement rules, deliberately.** Disallowed ASCII becomes `_`, so the common case reads naturally. Non-ASCII becomes `u<hex code point>`, which keeps different scripts distinct. The older "does not merge names that differ only by case or by script" case cannot enforce that on its own: it contrasts a two-character name with a three-character one, so collapsing everything to `_` still yields different keys and survives it. A same-length pair is what forces the code points to be carried.
- **Escaping iterates by code point.** By UTF-16 unit an emoji becomes its two surrogate halves - still pure ASCII, still passing every charset assertion - so the test names the expected `u1f389`.
- **Truncation stays last.** A hex escape turns one code point into five, so a name that measured short before the escape can overflow `MAX_SEGMENT` only after it.
- **An ordinary name is returned byte-for-byte.** `notes.md`, `Q3 Review (final) v2.pptx`, `R&D deck.pptx`, `budget+forecast,v2.xlsx` keep every character - the positive control that stops "escape everything" from passing.
- **Only the upload stage is reported verbatim.** `createAttachment` returns `stage: "upload" | "insert" | "unknown"`; the route answers 400 naming the file and carrying the storage reason for `"upload"`, and keeps the generic 500 for everything else, including an error carrying no stage at all.
- **`lib/supabase/experienceAttachments.test.js` exists because the route test cannot cover this.** That test mocks this module and supplies a `stage` of its own invention, so it pins what the route DOES with a stage and nothing about whether the store produces the right one. Deleting the `stage: "upload"` tag, or mislabelling the INSERT failure as an upload - which would hand Postgres's duplicate-key text straight to the client - left the entire route suite green.

**Known gap:** `lib/supabase/materials.js`'s `safeMaterialName` replaces only path separators, so the supplementary-materials locker still refuses the same filenames. It cannot take this same fix as-is: its storage key has no id in it and doubles as the displayed file name, and it uploads with `upsert: true`, so any non-injective escape silently overwrites one file with another and any escape at all changes what the user sees in their list.

### R-216 | area: copilot-live | parallel-safe: yes | automatable: partly

**Summary:** A live session shows, without any extra click, whether it is hearing anything — and says so plainly when it is not.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/liveHearing.test.js`.
2. Manual (`automatable: no`): start a live session at `/copilot` with any source. Before speaking, confirm the strip above the disclosure reads as waiting. Speak, and confirm it shows the latest turn with a speaker label. Stop speaking for longer than `HEARD_NOTHING_AFTER_MS` and confirm it turns into a warning naming what to check for the SELECTED source.
3. Manual (`automatable: no`): with a screen reader running, repeat step 2 twice in one session — go silent, speak, go silent again — and confirm the silence sentence is announced BOTH times.

**Expected:** 1 passes. The strip renders as the FIRST child of the bounded live column, above everything else on the page, for the whole session.

**The report that produced this case:** a user started a live in-person session, watched it go "Live", and got no transcript and no question cards. They described it as "it doesn't recognize questions". While `live`, `CopilotClient.js` rendered BOTH `TranscriptView` and `QuestionFeed` only inside a `Collapse` keyed on `showHistory`, and `useLiveSession.js`'s `start()` closed it on every session. **A working copilot and a completely deaf one were the same picture.** Two independent diagnostic passes, given disjoint scopes, converged on this same finding.

Load-bearing specifics:

- **The collapse was not deleted, and moving the question feed out of it was WRONG.** The collapse exists so live mode fits on one screen without scrolling (R-142). The first attempt at this fix pulled `QuestionFeed` out of the collapse and put the new strip beside it — but both render AFTER the bounded live column closes, and that column is sized `calc(100dvh - <its own top>)` with `overflow: hidden`. So on desktop both were off-screen by construction: no longer hidden behind a disclosure, hidden below a viewport-filling box instead, with nothing on screen to say they existed. **The reported bug would have been unchanged and the fix would have shipped inert.** An adversarial review caught it; the automated regression pass would have marked this case passing, because the only steps that look at the screen are the manual ones it does not run.
- **What actually fixes it:** the strip moved INSIDE the bounded column as its first child, so it is above the fold by construction, and `QuestionFeed` went back into the collapse alongside `TranscriptView`. That is correct because `CopilotDashboard`'s current-question panel already renders the latest detected question unconditionally inside the column — verified, it has no gate of its own — so "a detected question is never hidden" was already satisfied there. The dashboard sits in a `flex: 1; minHeight: 0; overflow: auto` box, so the two lines the strip costs make the dashboard scroll internally rather than pushing the page into scrolling.
- **The silence clock has to start when Start is pressed, not when the socket opens.** `live` is true from `"connecting"`, but `startedAt` was only set once status reached `"live"` — and the ticking-clock effect was gated on `startedAt` too. A session whose socket hangs at connecting therefore had no clock at all, the threshold was unreachable, and the strip reassured the user with "Listening for speech." forever: the exact failure this feature exists to surface, reappearing inside the fix for it. `hearingState` now takes `liveSince` and measures from the LATER of it and `startedAt`, and claims silence from neither when there is no real clock.
- **An interim counts as hearing something, immediately.** It is the earliest possible proof that audio is flowing, and it is exactly what separates "connected but deaf" from "working". A strip driven only by finals would stay blank for the first several seconds of every healthy session.
- **`status: "silent"` is a boundary, and the test pins both sides of it** — one millisecond early is still `"waiting"`. A strip that cried wolf during a normal pause between questions would be trained away within one interview.
- **The silence copy names what to check FOR THE SELECTED SOURCE.** An in-person session is told about the microphone, a tab/system session about the shared tab still playing audio. `hearingState` itself takes no `source` — that stays in the presentation layer, which is why the pure test contract has no source in it.
- **The transcript must never be the live region's text.** The first implementation put `role="status"`/`aria-live="polite"` on the VISIBLE strip, whose text is the interim transcript — which updates several times a second. A MutationObserver probe measured five interim frames producing five full re-announcements, and since `role="status"` implies `aria-atomic` each one re-reads the whole string. It also starved the five other polite regions on that screen, so "Answer ready" never got a turn. The visible strip now carries no live-region role at all (note MUI's `Alert` defaults `role` to `"alert"` when the prop is omitted, so it must be passed as null explicitly); two separate visually-hidden regions carry only the CATEGORY — `aria-live="polite"` for the waiting sentence, and a separate `role="alert"` for the silence sentence, because a session going deaf mid-interview must not queue behind chatter.
- **A defence was written against a state the component cannot reach, and removed.** An earlier draft appended a toggled zero-width space to defeat React's text-node coalescing. `hearingState` can only re-enter `"silent"` by first leaving it, and every non-silent status renders different text, so `updateHostText`'s `oldText === newText` bail never fires — no coalescing was ever demonstrated. The mechanism cost an extra DOM write per silence (2 characterData mutations vs 1, measured), risked a double announcement, and leaked U+200B into copied text on odd-numbered silences. Deleted. The pre-existing `barAnnouncement` mechanism in `CopilotClient.js` uses the same weak pattern and was left alone; it is worth re-examining separately.
- **The hidden regions render on every pass, empty when not live** — not merely "for the whole session". The first draft rendered the strip only inside the `{live ? ... : ...}` branch, so the region node entered the DOM at the same instant it first had content and the first sentence of every session was silently dropped, while a comment claimed the opposite.
- **The disclosure button's glyph is `aria-hidden`.** `▸` (U+25B8) and `▾` (U+25BE) were part of the computed accessible name, read as "black right-pointing small triangle" or dropped entirely depending on the screen reader, and redundant with `aria-expanded`.

### R-217 | area: copilot-detection | parallel-safe: yes | automatable: yes

**Summary:** A spoken interviewer question is detected whether it opens with an imperative or an interrogative, and whether or not a hesitation sits in front of the lead-in.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/localDetection.spoken.test.js lib/copilot/localDetection.test.js lib/copilot/questions.test.js lib/copilot/detectClient.test.js app/api/copilot/detect/route.test.js`.

**Expected:** All pass.

**The report that produced this case:** the same live-session report as R-216. Detection was genuinely missing the largest single class of real interview speech, for three separate reasons, all of which survived because live transcription so rarely supplies a question mark.

- **The retry-trust rule was structurally unreachable.** `localDetection` retried against `cleanQuestion(utterance)` and trusted the retry only when `detectQuestion`'s reason was `"starter"`. But `cleanQuestion` SYNTHESIZES a trailing question mark for any interrogative opener, and `detectQuestion` tests punctuation BEFORE the STARTERS loop — so the retry's reason was always `"punctuation"` for exactly the utterances the retry existed to catch. "So why do you want to work here", "Okay so what's your greatest weakness", "Cool, so how would you scale this service" were all undetected. Only lead-in plus IMPERATIVE ("tell me", "walk me", "describe") survived, because those do not match `INTERROGATIVE_RE` and so never got a question mark synthesized.
- **The fix is a narrower question, not a looser one.** A new `hasStarterOpener` export answers "does this open with a STARTERS entry", with no punctuation involved at all, and `detectQuestion` now delegates to it — so STARTERS is matched in exactly one place. One real behaviour change came with it, small and benign: the old loop matched against `raw.toLowerCase()` while `hasStarterOpener` matches against `normalizeQuestion(text)`, which also collapses internal whitespace runs, so `"tell  me about X"` and a newline-broken transcript now match where they did not. Trusting the retry's `"punctuation"` reason instead would have been the loose fix: it would accept any statement that happened to pick up a synthesized mark.
- **Lead-in stripping ran before filler stripping**, and `LEAD_IN_RE` is anchored at the start, so a hesitation in front of a lead-in blocked it entirely: "Um, so tell me about yourself" — the commonest opener in interviewing — kept its "so" and was not detected. `cleanQuestion` now loops filler, then lead-in, then separators, until the string stops changing, which also fixes "And, uh, how would you..." cleaning to a doubled comma.
- **`LEAD_IN_RE` gained the lead-ins interviewers actually use**: now, and then, and, last question, quick question, first, just curious, let's see, one more thing. "and then" is listed BEFORE the bare "and" on purpose — regex alternation takes the first alternative that lets the match succeed, not the longest, so "and" first would strip only "and " and leave "then ..." behind.
- **The negative-control block is load-bearing.** A detector that says yes to everything passes every positive case in this file. Seven statements — "So we're a team of about forty engineers", "And then we'll get you scheduled with the hiring manager", "Now, the salary band for this role is posted on the listing" — must stay undecided, and each was checked against the new clean loop by hand as well as by test.
- **Known and accepted:** "Well, do you know what, we're out of time" now reads as a question. Missing the interviewer is silent and permanent; an extra card is visible and cheap. That asymmetry is the module's own stated rule.
- **The remote confirm was dead weight or a silent 500.** With the embedded engine the route called the very same `localDetection` on the very same string the client had just run — a round trip that could only ever repeat the client's own "no". `confirmQuestion` now decides locally for that engine and issues no request. Note the consequence rather than mistaking this for restored capability: in live mode `confirmQuestion` is only ever reached AFTER `localDetection` already returned `decided: false` on the same string, so on the embedded engine its answer is provably always `isQuestion: false`. Practice mode's `useRoomQuestions` calls it without a prior local pass, so it is not dead there. With any other engine, `getServerEnv()` threw when `Gemini_LLM_API_Key` was unset and the route 500'd, which `useLiveSession.js` swallows with a bare catch — completely invisible. The route now degrades to the heuristic and answers 200 with `degraded: true` and a reason, which `confirmQuestion` passes through unchanged.
- **One existing test was documenting the defect.** `useLiveSession.manual.test.js`'s positive control asserted `confirmQuestion` was called once for "so how do you handle ambiguity". That is now the wrong assertion — the whole point is that this needs no round trip — so it asserts the absence of the call instead, and a NEW case covers an indirect ask that still reaches the model, so deleting the `confirmQuestion` call outright cannot leave the file green.

### R-218 | area: copilot-capture | parallel-safe: yes | automatable: yes

**Summary:** A live session that stops working says so. Every failure after the socket opens reaches the user instead of being swallowed.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/stt/deepgram.silent.test.js lib/copilot/capture.silent.test.js lib/copilot/session.silent.test.js lib/copilot/session.test.js lib/copilot/session.inperson.test.js`.

**Expected:** All pass.

**The report that produced this case:** the same live-session report as R-216 — Live, no transcript, no error. A diagnostic pass found that essentially nothing in this pipeline could report a post-open failure at all.

- **The only `error` listener was registered once-only INSIDE the connect promise, and its whole body was a reject call.** Once `open` had settled that promise, a later error called reject on a settled promise: a no-op. `onError` was never called for any post-open failure, ever. A second, persistent listener now reports it, guarded on `_opened` so a pre-open failure is not reported twice — the rejected `connect()` already covers that one.
- **A close only reported `onStatus("closed")`**, and for a single-source in-person session `aggregateStatus` maps that to idle — so the pill quietly reverted and the button went back to "Start session" while the user was still sitting in the interview. An unexpected close now also calls `onError` carrying the close code and reason. A `_reportedFailure` flag stops an error-then-close pair from shouting twice.
- **The negative controls are what stop the fix from being worse than the bug.** A close after the user's own Stop, and a clean code-1000 close, must stay silent — otherwise every normal session ends with an error banner.
- **The provider's own error payloads were being discarded by the non-Results filter.** Deepgram was saying exactly what was wrong and nothing relayed it. An Error-typed frame is now routed to `onError`; Metadata, UtteranceEnd and SpeechStarted are still ignored, and unparseable data is still not treated as a provider error.
- **A throw downstream of `onTranscript` killed every subsequent frame** while the socket stayed open and the status stayed Live. Frame handling now sits in a try/catch that reports and keeps the listener alive — and the test asserts the SECOND frame still arrives, not merely that the first did not throw.
- **`AudioContext` was never resumed and nothing ever checked `ctx.state`.** A suspended context means the worklet never runs, zero bytes are sent, the socket stays healthy and nothing errors. The in-person path constructs it three async boundaries after the click (a permission prompt, a token fetch, a socket handshake), which is exactly where sticky activation runs out on mobile — and `captureSupport.js` force-selects in-person on every device without `getDisplayMedia`, i.e. every mobile browser. `PcmPipeline.start()` now resumes and, if the context is still not running, throws rather than proceeding silently. The check is gated on the context exposing a string `state` so pre-existing practice-mode test doubles that never modelled it are unaffected; a real `AudioContext` always satisfies it.
- **`captureMicAudio` was the only capture function returning its `getUserMedia` result raw** — every sibling passes through `requireAudioTrack`. A mic stream with no audio track flowed into the worklet, which keeps the node alive forever emitting nothing.
- **A failed `_addSource` leaked the MediaStream.** `stop()` walked `_sources` only, and a stream whose source never finished wiring was never in it — so the browser's recording indicator stayed lit for the life of the page, which reads to the user as "still live". Streams are now recorded in `_openStreams` at the moment of capture, BEFORE `_addSource` is attempted.
- **That fix covered MediaStreams and nothing else, and the AudioContext check opened a second leak on the same seam.** `_addSource` connects the STT socket, THEN builds the pipeline, THEN pushes into `_sources`. The new resume check throws from `pipeline.start()` — after the socket is open, before the push — so `stop()` found neither the socket nor the context. `_addSource` now releases everything it has opened if any later step throws. The test that catches this asserts the SOCKET CLOSE specifically; the pre-existing test only modelled `connect()` itself throwing, before a socket exists, so it structurally could not see it.
- **Making an unexpected close loud broke a standing contract, and needed an essential-source rule.** `_addSource`'s `onError` sets that source's status to `"error"`, and `aggregateStatus` short-circuited on ANY source erroring. So on a tab/system session a mid-session drop of the OPTIONAL mic socket flipped the aggregate from `"live"` to `"error"`, unmounted the entire live UI and put the button back to "Start session" — while the interviewer's socket was still transcribing and the screen share was still lit. That is R-038's contract (a mic problem is soft) broken by the fix for a different bug. The rule now: for tab/system, `them` is essential and the mic is not; for in-person the mic is the only source and is therefore essential. Only an essential source's failure escalates; a non-essential one is treated as closed for aggregation and still reaches the user through the warning channel. Both directions are tested, or the rule is unfalsifiable.
- **The stuck-context message names the actual source.** `PcmPipeline` also serves tab and system capture, so a hard-coded "Microphone capture could not start" would misreport a tab share as a microphone problem.
- **`session.js` ignored `textAlreadyDelivered` while `useLiveSession.js` honoured it**, so on ElevenLabs every assembled in-person utterance contained its own text twice — the same R-127 defect, in the one accumulation path that never got the guard.

**Known gap, unchanged:** R-150 is still unrun. `deepgram.js` claims `diarize_model=v1` is the current non-deprecated parameter and the repo still has no evidence either way; the default parameters and the diarization query string were deliberately not touched here.

### R-219 | area: copilot-diarization | parallel-safe: yes | automatable: yes

**Summary:** Telling the copilot which voice is yours can never make it stop listening while that is the only voice it has heard.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/speakerIdentity.deafness.test.js lib/copilot/speakerIdentity.test.js lib/copilot/session.inperson.test.js`.

**Expected:** All pass.

**The mechanism:** on a shared room mic, diarization very often resolves BOTH voices to a single tag. `scoreSpeakers` still elects tag 0 as the user at low confidence, and `speakerDisplayLabel` renders it "Speaker 1" rather than "You" — so the transcript offers that row as a correctable one. A user who sees their own words under "Speaker 1" clicks "that's me". `setUserTag(0)` pins the override, and `shouldEvaluateAsQuestion(0)` answers false from then on, for the only tag that exists. `observe` accumulates evidence and only then skips `recompute()` while overridden, and nothing calls `reset()` mid-session — the distinction matters, because evidence continuing to grow is exactly what the new "has another tag been observed" check depends on. **One click, and every subsequent utterance — including every question — is skipped for the rest of the interview, with no way for the user to notice.**

- **The property, not a special case:** identity may suppress a tag only while some OTHER tag remains observed to carry the evaluation. Suppressing the user tag is only ever the claim "skip this one, the other voice is covered", and that claim is false when the user tag is the only tag evidence has ever seen.
- **Deliberate limit, stated so nobody reads the summary too broadly.** The guard asks whether another tag has EVER been observed, not whether one is still carrying turns. So if two tags are seen early, the user corrects one, and the diarizer then merges everyone back onto the corrected tag, suppression continues for the rest of the session. That is the same behaviour the two-voice positive control asserts, so it cannot be tightened without deleting the feature; closing it properly needs a recency notion the module does not have. Worth revisiting if merged-tag deafness is reported in the field.
- **The positive controls are what stop the fix from deleting the feature.** On a genuine two-voice session a correction must still suppress exactly the corrected tag; a third voice joining later must still be evaluated; and the moment a second voice appears on a previously single-voice session, suppression must begin. A fix that simply returned true always fails all three.
- **`swap()` set high confidence and the override flag even when it found no other tag to swap to** — pinning a belief nobody expressed and, through the same path, going deaf. It now leaves the state untouched when there is nothing to swap to. It has no production caller yet, which is exactly why it was worth fixing before one exists.
- **`scoreSpeakers` and its six clauses were not touched**, in particular the clause requiring the argmax to hold at least 40 words ABSOLUTE rather than a share — that one is load-bearing against a known counterexample where a candidate saying "Thanks for having me, how are you?" elects the interviewer as the user at high confidence.
- **Falsifiability was proven, not assumed:** restoring the unconditional suppression put exactly the two single-tag cases red and left the other seven green, which is the correct blast radius.

### R-220 | area: copilot-logs | parallel-safe: yes | automatable: yes

**Summary:** Either mode of the copilot downloads a log of the session in one click — a readable transcript and a raw diagnostic record, in one file.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/sessionLog.test.js lib/copilot/sessionLogArchive.test.js app/copilot/useLiveSession.log.test.js app/copilot/practice/usePracticeSessionLog.test.js app/copilot/practice/PracticeControls.test.js`.
2. Manual (`automatable: no`): run a live session, press Download log, and confirm a single `.zip` arrives holding one `.md` and one `.json`, both named after the session. Open the `.md` and confirm the transcript, the questions and the drafted answers read as a record of what happened.
3. Manual (`automatable: no`): start a live session and stop it WITHOUT speaking. Download the log and confirm the Markdown says plainly that no speech was transcribed, and that the Diagnostics section still shows the session starting, its source, and its status transitions.

**Expected:** 1 passes. 2 and 3 as described.

**Why this exists:** the same live-session report as R-216. The user could not tell whether the copilot had heard anything, and neither could anyone diagnosing it afterwards — there was no artifact at all. The user asked for both a readable record and a raw diagnostic log, explicitly without being made to choose between them at download time, so one button produces one zip containing both.

Load-bearing specifics:

- **The zero-event log is a first-class case, not an edge case.** It is precisely the reported failure, so `renderSessionLogMarkdown` must produce a legible document that says no speech was transcribed and still shows what the session was and what happened at the protocol level. An empty file, or a crash, would leave the user with nothing to send.
- **Credentials are redacted at RECORD time, not at render time**, so a secret never enters the snapshot in the first place. The match is by key name (token, secret, password, authorization, credential, and the `api_key`/`api-key`/`apiKey` spellings) and the test's positive control is that `keywords` is NOT redacted just because it contains "key". Call sites are additionally forbidden from passing credentials at all — the redaction is a backstop, not the mechanism.
- **The log is bounded and drops the OLDEST events**, counting them. A long interview must keep the END of the session, which is where the user noticed the problem and stopped.
- **`event()` can never break an interview.** Circular objects, functions, `undefined`, a null payload, a null type and oversized strings all have to be survivable, and the snapshot has to stay `JSON.stringify`-able afterwards. An oversized string is truncated and says how much went.
- **The clock is injected.** A recorder that called `Date.now()` internally would make every timestamp assertion a test of the machine's wall clock.
- **The archive is built as an `arraybuffer`, not a `blob`.** JSZip's blob output needs a global `Blob` the vitest node environment does not provide, so the test could not have read its own archive back; an ArrayBuffer loads in both node and the browser, and the download path wraps it in a Blob itself.
- **The wiring is what makes this real, and it is tested separately from the recorder.** This repo has shipped three fully-tested components beside a caller that never imported them. The live spec drives the actual hook under jsdom and asserts the events arrive through the hook's own returned surface; the practice spec does the same for its own hook and its button.
- **The live harness fires BOTH `onTranscript` and `onUtterance`.** A first draft fired only `onTranscript` while declaring `source: "inperson"` — but that source's detection deliberately runs through `onUtterance` alone, so the test was modelling a tab/system session while claiming to be an in-person one, and "proved" that detection recorded nothing. A harness that models the wrong source is indistinguishable from a broken feature.
- **`question.rejected` is recorded with a reason** — too short, confirm unavailable, not a question, duplicate, speaker identity suppressed. Without it the log answers "what did it hear" but not "why did it not act", which is the question the reporting user actually had. Two of those five were missing when this case was first written, and the whole event had no test at all: deleting all three call sites left every suite green. The suppressed-by-identity reason is the one that matters most, since that is precisely the R-219 silent-deafness scenario, and the log built to explain it was mute about it.
- **The speaker snapshot has to REACH the download.** `sessionLogArchiveEntries` called `renderSessionLogMarkdown(snapshot)` with one argument, so `opts.speakerSnapshot` was `undefined` in every real download and `speakerDisplayLabel` resolved every in-person turn to "Speaker 1"/"Speaker 2" rather than "You"/"Them" — a parameter that was fully tested and never wired. It is now threaded through the archive builders and supplied by the recorder at download time, and the test reads the label back out of a REAL built zip, with a control proving the numbered fallback is what happens without it.
- **A second practice session cannot inherit the first one's transcript.** The counter that tracks which frames are already logged was reset by `onStart` before `finals` itself resets, and a straggler final from the old session's still-attached socket — a message already in flight when `close()` was called — changes the array by reference, re-runs the effect against the zeroed counter, and dumps the whole prior transcript into the new log. Note the mechanism first proposed for this was WRONG and was refuted before anything was changed: a render caused only by `setStatus("idle")` leaves `finals` referentially unchanged, so React does not re-run the effect at all. The fix is a per-session id stamped on each frame, not an index another code path resets asynchronously.
- **Practice records the posting and interview type by ID AND NAME ONLY.** The résumé and cover letter are fetched server-side precisely so their text never passes through the browser; a downloaded log must not become the thing that carries them out.
- **A second session starts a fresh log** in both modes, and the log survives Stop in both — reviewing an interview and diagnosing a dead one both happen afterwards.
- **Falsifiability was proven on the practice side:** deleting the `answer.recording.start` call put exactly one test red and left the other sixteen green.

**Known gap:** the live recorder does not yet carry the STT provider name into the log's `provider` field, though the value is already computed in `CopilotClient.js`, so the live log's Provider line reads "unknown"; practice writes the literal string "practice" there, which is a mode, not a provider. A log therefore says which audio source was used but not which transcription service — worth closing, since provider is exactly what distinguishes several of R-218's failure modes.

**Also undocumented elsewhere:** this batch extracted `roomQuestionPrivacyClause`/`roomQuestionDocsWord` out of `PracticeClient.js` into `app/copilot/practice/practiceRoomQuestionPrivacy.js` byte-for-byte, and split `TranscriptDisclosure.js` and `useDraftAnswer.js` out of `CopilotClient.js`/`useLiveSession.js`, all to stay under the 1000-line cap. R-155's step 1 still names `PracticeClient.js` as the place to read the privacy clause.

### R-221 | area: techwatch | parallel-safe: yes | automatable: partly

**Summary:** The Professional Experience tab briefs you, hour by hour, on outages, exploited vulnerabilities and end-of-support announcements affecting the technologies your own project pages name — with root cause, remedy, workaround and documentation taken from the primary source, never invented.

**Steps:**
1. From `hello-world`, run
   `npx vitest run lib/techwatch app/api/techwatch app/hooks/useTechWatch.test.js app/components/experience/TechWatchPanel.test.js app/components/experience/TechWatchPanel.wiring.test.js app/components/experience/ExperienceTab.techwatch.test.js app/components/experience/ExperienceTab.test.js`.
2. Manual (`automatable: no`): open Professional Experience. Confirm the briefing renders under the tab header, hour headings descend newest-first on a 24-hour clock, and the "as of" line reads a relative time ("5m ago"), not a bare date.
3. Manual (`automatable: no`): with a project page naming an old version (e.g. "React 17"), confirm the Support & decommission section flags it in words, not colour alone.
4. Manual (`automatable: no`): break the network mid-refresh (override `window.fetch` to 502 and press Refresh). Confirm the last good briefing stays on screen with the error beside it, rather than going blank.

**Expected:** 1 passes. 2-4 as described.

**Why this exists:** the user asked for an hour-by-hour briefing of tech outages, found vulnerabilities/exploits and update/decommission announcements, with root causes, remedies, documentation and workarounds. It lives on this tab because the project pages already name the stack — the watchlist is derived from them, not configured.

Load-bearing specifics:

- **Four primary sources, no LLM in this chunk.** Atlassian Statuspage (incidents *and* the separate scheduled-maintenances endpoint), OSV.dev, CISA's Known Exploited Vulnerabilities catalogue, and endoflife.date. All keyless. Every field on a card is quoted from one of them; a field the source did not publish renders as nothing at all, never as "unknown".
- **The whole feature shipped inert once and no test saw it.** `collectTechWatch` destructured `cacheImpl` with no default. Every one of the 20 collector tests injects one, and `route.test.js` mocks the collector module entirely, so the gap was invisible to both. Production calls `collectTechWatch({ entries, now, windowHours })` and nothing else — so every task threw `"cacheImpl is not a function"`, every worker caught its own throw and recorded a tidy `{ ok: false }` row, and the route returned a perfectly well-formed **empty briefing with 41 failed sources**. It never threw, so nothing surfaced it. Found only by running the real collector against the real feeds. The guard is the test named "works when the caller supplies no cache implementation, which is how the route calls it".
- **The exploited-in-the-wild cross-mark nearly shipped inert too, for a different reason.** OSV items are window-filtered on `published`, but CISA typically lists a CVE weeks or months later, and the UI's longest window is 7 days — so the join could essentially never fire in production while its mechanism test stayed green. The collector widens the OSV lookback to `OSV_LOOKBACK_HOURS` (3 years) and **re-dates a KEV-listed advisory to the day CISA catalogued it**, because being listed as exploited *is* today's news about an old advisory. Verified live: Apache Tomcat, critical, `exploitedAt` 2026-08-04.
- **`kevCveSet` returns a Map of CVE to `dateAdded`, unfiltered by window or watchlist**, precisely so that re-dating is possible. Filtering it restores the inert behaviour above.
- **Workarounds come from the GitHub Security Advisory template.** OSV `details` bodies carry `### Impact` / `### Fix` / `### Workarounds`; 35 of the 64 live advisories for one package have a workaround section. The naive "first paragraph of details" rule yields the literal string `"### Impact"` for one fixture advisory and `"Learn more here."` for another, because a heading and its body can be separated by a *single* newline — so the parser strips heading LINES, not heading blocks, and prefers a named section.
- **`eol` and `support` from endoflife.date are a date OR a boolean.** `new Date(false)` is 1970 and does not throw, so a parser that forgets this reports every supported release as having died at the epoch. Verified across all 21 catalog products live: zero 1970 dates.
- **A source row distinguishes "not configured" from "unreachable" on `note`, never on `ok`** — and the UI must keep them apart too. TypeScript has no endoflife.date entry at all (nor does Java); `status.hashicorp.com` serves incidents but 404s on scheduled-maintenances forever. Both are facts about the vendor, not our reliability. The panel renders two separately-headed lists, "Sources we could not reach" and "Sources with no feed to publish"; an earlier build put the note rows directly under the failure heading with nothing between, silently recasting "TypeScript publishes no lifecycle feed" as "we failed to reach it".
- **The 404 rule lives in the adapter, not the collector.** An interim version detected it in `collect.js` by regex-matching the error *string* another module produced. `fetchStatuspageMaintenances` now returns its own `note`, and only a 404 qualifies — a 500 stays a real failure, or the rule becomes a blanket excuse.
- **The window is bounded on BOTH sides** (`FUTURE_TOLERANCE_HOURS` = 48). CISA really does post-date KEV entries by about a day, so a hard `<= now` hides the newest exploit; but an end-of-life announced for October is not an event in this hour and belongs in the support table, not the timeline.
- **Hour buckets are UTC; labels are local; the clock is pinned to 24-hour.** A zone-dependent bucket key would make two users disagree about which hour an incident belongs to. `hourCycle: "h23"` is not cosmetic: the default `en-US` locale renders 15:00 as "03:00 PM", so an unpinned implementation passes on en-GB and fails on en-US. "Today" is decided in the *display* zone — a 15:00Z bucket is 00:00 the next day in Tokyo, where `now` is 00:30 that same day.
- **`formatRelative(value, now)` takes epoch milliseconds.** Handed a `Date` it computes NaN and silently degrades to `toLocaleDateString()`, so the "as of" line would read as a bare date forever with no error anywhere.
- **In MUI's `sx`, a bare number is a multiplier.** The visually-hidden live region was written `width: 1, height: 1`, which `@mui/system/sizing/sizing.js` turns into `100%` — an absolutely-positioned full-size overlay, not the 1px sink intended. Measured under jsdom: numeric gives `"100%"`, the string gives `"1px"`. `ExperienceTab.js`'s own `HIDDEN_STATUS_SX` uses the strings for exactly this reason.
- **`@upstash/redis` auto-deserializes.** `client.get()` returns a parsed object and `JSON.parse` on it throws, so a string-only cache treats every Redis hit as a miss: Redis becomes write-only, the in-memory Map does all the work, and nothing ever errors.
- **Watchlist entries are deep copies of the catalog.** A shallow spread shares the nested `osv` object and `aliases` array, so one downstream write corrupts the module-level `CATALOG` for the life of the process, for every user.
- **Pages this app generated itself are excluded from watchlist scanning** — a research report *it* wrote about Kubernetes is evidence the user pressed a button, not that they run Kubernetes.
- **Cache keys carry no user id.** These feeds are byte-identical for everyone; a per-user key would multiply outbound fan-out by the user count. Asserting key *uniqueness* does not catch this — per-user keys are unique too.
- **A total source failure is still HTTP 200**, with the failure recorded per source, because the panel has to tell "nothing happened" from "we could not look" and a 500 erases that distinction.
- **"Support & decommission" is an `h4`,** a sibling of the hour headings. It rendered as a plain element at first, so heading navigation jumped from the last hour bucket straight past the section that answers "is anything I depend on already dead". The two source-health captions are deliberately NOT headings — they caption one-to-three-line lists, and filling the outline with them is its own accessibility problem.
- **Two of the author's own tests were wrong and an implementer refused to edit them, correctly.** A negative control asserting React is not detected was defeated by the no-detection fallback, whose default watchlist *begins* with React; and the probe word "GOLANG" is itself a legitimate alias of `go`, so matching it proved nothing about two-letter substring leakage. Both fixtures now anchor the page to Django so the fallback cannot fire.

**Verified against live data before shipping** (not just fixtures): 8/8 vendor status pages parsed 259 incidents and 63 maintenances with 0 malformed items; all 64 live OSV advisories for one package produced a root cause and remedy, 35 a real workaround; CISA's full 1666-entry catalogue mapped without duplicate ids; all 21 endoflife products produced 493 support rows with no 1970 dates. A realistic three-page stack yielded 20 items and correctly flagged React 17 as security-only, Node.js 20 as unsupported and Next.js 14 as unsupported.

**Known gap:** TypeScript — the user's own worked example of a version "going under" — has no public lifecycle feed, so this chunk can only state that gap by name. Closing it is chunk B's job (Gemini-grounded announcements), along with workarounds for the sources that publish none.

### R-222 | area: techwatch | parallel-safe: yes | automatable: partly

**Summary:** For a technology no public feed covers — TypeScript is the worked case — the briefing fills its own stated gap with a Google-Search-grounded answer, marked as AI-sourced and carrying its citation, and never silently replaces an honest gap with an unproven claim.

**Steps:**
1. From `hello-world`, run
   `npx vitest run lib/techwatch/lifecycleSearch.test.js app/api/techwatch/lifecycle/route.test.js app/components/experience/TechWatchPanel.test.js app/hooks/useTechWatch.test.js`.
2. Manual (`automatable: no`): with the Gemini engine selected and a project page naming TypeScript, open Professional Experience. Confirm the "TypeScript lifecycle: no lifecycle feed" line is replaced by a row carrying a visible "Found by AI search" marker and a working citation link.
3. Manual (`automatable: no`): switch to the embedded engine in Settings and reload. Confirm the AI row disappears and the honest "no lifecycle feed" line returns — no error, no empty space.

**Expected:** 1 passes. 2 and 3 as described.

**Why this exists:** R-221 shipped a deterministic briefing that states, by name, which technologies no public feed covers. The user chose to fill **only those gaps** with grounded AI, leaving everything else keyless and always-on. TypeScript was their own worked example of a version "going under", and endoflife.date carries 464 products and not that one.

Load-bearing specifics:

- **This is the only place in Tech Watch where a model authors a fact the user reads.** Every other number on screen is quoted from a primary feed. So the parser's job is mostly refusal, and the panel's job is making the provenance impossible to miss: an AI row carries a "Found by AI search" chip and its citation as a real link. A model-authored end-of-support date rendered in the same style as an endoflife.date one would make the most trustworthy section on screen the least.
- **A row whose citation host is not in the model's own grounding metadata is dropped**, via `isGroundedHost` from `lib/llm/grounding.js` — which returns false for an EMPTY grounding list. No grounding is no evidence the model searched at all; treating it as permissive is exactly how a fabrication reaches the user. Proven falsifiable: neutering that gate turns three tests red, including the empty-grounding case.
- **A row naming a technology nobody asked about is dropped.** The model must not widen its own brief — such a row would appear in the support table with no deterministic row to contradict it.
- **Nothing is coerced.** A `state` outside the three allowed values, or a date that is not `YYYY-MM-DD`, drops the row rather than being repaired. `null` dates are legitimate and kept.
- **A failure here can never make the briefing worse.** Model error, unusable reply, missing key, embedded engine — every path leaves the panel exactly as R-221 rendered it, including the honest gap line. The route therefore returns **200** with `{ rows: [], error }` on a model failure; a 5xx would surface in the panel as a failure of the whole feature when the deterministic briefing beside it is fine.
- **The second request must not fire on every render.** The hook keys its effect on a sorted fingerprint of the gap ids, not on `data` — whose identity changes on every poll. Keying it wrong would launch a fresh grounded search every fifteen minutes and compound the model spend silently.
- **Cached globally for a day, keyed by technology ids and never by user.** TypeScript's support status is identical for everyone; a per-user key would multiply the model spend by the user count.
- **Capped at 4 technologies per request**, with the remainder reported in `skipped`. One grounded search per technology is the entire cost of this feature.
- **Two defects in the author's own test file, both found and reported by an implementer that correctly refused to edit them.** First: `wantsEmbedded` reads `process.env` DIRECTLY, not through the mocked `getServerEnv`, so with no explicit engine and no `Gemini_LLM_API_Key` stubbed, every request 503s as "embedded" before reaching anything worth testing — the same trap `app/api/experience/research/route.test.js` already documents. Second: a capping test used single-letter labels A-F and asserted a bare "F" was absent from the prompt, which is unsatisfiable because the prompt's own boilerplate reads "For each technology". Both fixed in the test, not worked around in the route.

**Known gap:** an AI-sourced row is always `inUse: false`. The deterministic rows compute `inUse` by matching the user's `detectedVersions` against a cycle, but the AI path does not, so a page naming "TypeScript 4.9" will not have that cycle flagged the way "React 17" is. The row still renders with its dates and state; only the personal "you use this one" emphasis is missing.

### R-223 | area: tracking-digest | parallel-safe: yes | automatable: partly

**Summary:** The tracking table carries a "Company & role" column holding a researched digest of what the job posting does NOT tell you — auto-filled for a newly tracked row, filled on demand by a Research button for older ones, and opened as formatted markdown with its sources in the existing row dialog.

**Steps:**
1. From `hello-world`, run
   `npx vitest run lib/tracking app/api/application-digest app/components/TrackingTab.digest.test.js`.
2. Manual (`automatable: no`): track a new job. Within a moment the Company & role cell fills in on its own. Click it and confirm the modal renders headed sections and a source list, not raw markdown.
3. Manual (`automatable: no`): find a row tracked more than a day ago with an empty cell. Confirm it did NOT auto-research, that a Research button is offered, and that pressing it fills the cell.
4. Manual (`automatable: no`): switch to the embedded engine in Settings and press Research. Confirm a clear refusal and that no empty or half-written digest is stored.
5. Manual (`automatable: no`): narrow the window below the `md` breakpoint. Confirm the digest is present in the stacked card layout too — it is a separate render path from the table.

**Expected:** 1 passes. 2-5 as described.

**Why this exists:** the user asked for a column listing the pertinent information about the company and role that cannot be gleaned from the posting, auto-populated on a new row, opening a formatted preview on click, with a Research button for existing rows.

Load-bearing specifics:

- **Nothing hooks row creation, deliberately.** Nine separate code paths create a tracked `applications` row — manual add, Job Search track, applied toggle, three tailor flows, feed apply, the auto-apply queue and `useManualTailor` — and seven are inside `app/page.js`, which is 3300 lines and far over this repo's cap. Instead the table asks for a digest for any row that lacks one, which covers every path without touching any of them and makes a tenth path work for free.
- **`selectAutoDigestTargets` is a SPEND control, not a completeness filter**, and it is pure so that decision is testable without a network. Auto-research fires only for a row with no digest row at all whose `tracked_at` is within `AUTO_DIGEST_MAX_AGE_HOURS` (24), newest first, `AUTO_DIGEST_CONCURRENCY` at a time. Opening the table on sixty untouched rows must not bill sixty grounded searches; the Research button is what covers the backlog, which is exactly the split the user described.
- **A `failed` digest is never auto-retried.** Without that, a permanently failing row burns a model call on every page load forever with nothing changing on screen. Retrying is the button's job.
- **An existing digest short-circuits the route with no model call.** The table asks on every load; re-researching would bill a grounded search per page view. `force: true` — what the button sends — is the only way past it.
- **A failure is PERSISTED as `status: "failed"` and returned as 200.** An empty cell reads as "nobody has looked yet"; the user has to be able to tell a failure from an untried row, and the auto path has to be able to tell them apart too.
- **Digests live in a NEW `application_digests` table, not a column on `applications`.** That table predates this repo's migration set and is written by six call sites; a join-side table with `application_id` as primary key and `on delete cascade` cannot break any of them. RLS on, four owner-scoped policies; the `insert ... with check (auth.uid() = user_id)` is what makes an upsert safe without a redundant `user_id` filter.
- **Existing digests are read straight from Supabase by the browser's RLS-scoped client**, not through a GET route. RLS already grants exactly the caller's rows, and a route would exist only to re-wrap that — while turning one query into one request per row. The API route exists for one reason: the grounded model call needs a server-side key the browser never sees.
- **The digest cell must be a real `<button>`.** The table row already has an `onClick` opening the edit dialog, guarded on `e.target.closest("a, button, ...")` — anything else is swallowed by the row.
- **The table has a second, stacked-card layout below `md`.** A column added only to the `<Table>` is invisible on a phone.
- **Rendered with the real markdown parser** (`MarkdownPreview` + `lib/experience/markdown.js`), not `FormattedContent.js`, which is a plain-text heuristic shaped for job ads and resumes.
- **The preview reuses `AppViewDialog`'s existing `kind` mechanism**, already opened from a tracking cell as `{ open, rowIndex, kind: "jd" }` — one dialog for row content rather than two competing ones.
- **An ungrounded link never reaches storage.** `parseDigestAnswer` demotes any `[text](url)` whose host is not in the model's own grounding metadata to plain text, keeping the sentence; an empty grounding list demotes everything.
- **A test-mock shape bug found by an implementer, not by the suite.** `listDigests` returns an OBJECT keyed by `application_id`; the route test mocked it as an array, so every assertion ran against a shape production never produces. The route survived only because it defensively handled both. The mock now matches the accessor.

### R-224 | area: copilot-cues | parallel-safe: yes | automatable: yes

**Summary:** A spoken cue only fires from the candidate's own completed speech, and only when the app actually knows whose speech it is.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/voiceCues.test.js app/copilot/useLiveSession.cues.test.js`.

**Expected:** All pass.

**Why this case exists:** the first version of the acceptance criteria gated cues on "a final transcript frame whose resolved speaker is `you`". For the in-person source that label comes from `speakerIdentity.labelFor`, which returns `"you"` for the argmax `userTag` as soon as TWO voices have been observed, with **no confidence requirement at all** (only `overridden` short-circuits it). `speakerIdentity.js`'s own header, `session.js` and `useLiveSession.js` all document at length that question detection deliberately routes off `shouldEvaluateAsQuestion` and NOT the label, because the label is a display guess. The acceptance criteria picked the display guess, and an adversarial review caught it.

Load-bearing specifics:

- **The failure it would have shipped:** during the normal cold-start state, where identity has not settled, the INTERVIEWER's frames resolve to `"you"`. The interviewer saying "Next question." or "Moving on." would silently release a hold the candidate had deliberately set; "Good question!" would pin the dashboard onto the wrong entry. Cues on the in-person source now require `speakerSnapshot.overridden === true || speakerSnapshot.confidence === "high"`.
- **`tab`/`system` are deliberately NOT gated the same way.** Those sources get structural speaker separation from two independent sockets, so there is no identity guess to wait on. The gate is per-source on purpose; do not "make consistent".
- **A stated, unfixable limitation:** on `tab`/`system` the `you` channel is a raw microphone, so an interviewer's voice bleeding through the candidate's speakers can be transcribed on it. No better signal exists. The sidebar says cues are heard on your own microphone; the ambiguity rule and the visible held-state badge bound the damage.
- **`textAlreadyDelivered` must be honoured.** ElevenLabs' `commit_strategy=vad` re-delivers a final's exact span purely to carry `speechFinal` (R-127). Without the guard, one spoken "does that answer your question" releases twice, and a duplicate pin re-pins to whatever is latest by then, which may be a different entry.
- **Interim frames are never matched.** An interim's text is rewritten several times a second, so a cue matched on interims fires repeatedly for one spoken phrase. The cost is the provider's endpointing delay, roughly 0.3 to 1.5 seconds.

### R-225 | area: copilot-cues | parallel-safe: yes | automatable: yes

**Summary:** Ordinary interview speech does not trigger a cue, and one utterance carrying two different intents triggers nothing at all.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/voiceCues.test.js`.

**Expected:** All pass, including every case in the "negative controls" block.

**Why this case exists:** a matcher that says yes to everything passes every positive case in its own test file. The first cue vocabulary had four ranked false positives, none guarded:

- **The worst was the company cue.** Bare noun phrases (`company info`, `company research`, `company news`, `company background`) are ordinary interview English: "my company background is in fintech", "I did company research before every call", "I built the company info page". The damage is the largest in the module, because that cue fires an outbound request to Google carrying the company name, job title and posting text, mid-answer, with no click. Every bare noun-phrase pattern was DELETED.
  - **Amended (`lib/copilot/voiceCues.js`, current vocabulary):** the verb-frame replacement this bullet used to require (`pull up`, `bring up`, `show me`, `tell me about`, `remind me about`, `what do we know about`) is ITSELF gone — a second adversarial pass found these are commands addressed to an app, and nobody says them out loud in a real interview. Every one of them is now a hard NEGATIVE control in `voiceCues.test.js`; re-adding any of them regresses this case. The shipped vocabulary instead is the natural bridge phrases a candidate says right before referencing something they know about the company — "I was reading about the company recently", "I've been following the company closely", "Tell me more about the company" — each requiring the match to END at "the company" (the shared `COMPANY_END_SRC` guard), not a bare noun phrase or a possessive. Do not re-add a bare noun-phrase OR a command-verb pattern; both are now documented false-positive classes, not oversights.
- **`moving on` and `next question` were anchored** to the start of an utterance or a sentence boundary, and `mov(e|ing) on` now refuses a following `to`/`from`/`past`/`onto`.
  - **Amended (current vocabulary):** anchoring was not enough on its own, and is no longer the mitigation. `moving on`, `next question`, `hold that thought`, and `give me a second`/`moment`/`minute` were all CUT ENTIRELY as pin cues, not narrowed — an interviewer says every one of them unprompted, about their own agenda ("Okay, let's move on to your last role"), which is worse than even the pin side's tolerant asymmetry allows. All four already appeared in `questions.js`'s `LEAD_IN_RE` as INTERVIEWER lead-ins — this codebase's own evidence they are interviewer speech — and are now hard NEGATIVE controls in `voiceCues.test.js`. Re-adding any of them, anchored or not, reintroduces the exact false positive this case exists to prevent.
- **Two intents in one frame is ambiguous, not last-wins.** "Good question. So, moving on from the monolith, we rebuilt it." expressed neither intent, and under a last-wins rule it released a hold the candidate had set. `matchVoiceCue` returns `actions` and `ambiguous`; the caller refuses to act and logs `cue.ignored` with reason `ambiguous`. An utterance matching the SAME action twice is not ambiguous.
- **`matchedAt` is pinned to an exact index.** Comparing it across two different inputs was satisfied by returning `text.length`, which also broke the last-occurrence rule whenever a cue repeated.
- **The registry is frozen all the way down.** `Object.isFrozen(VOICE_CUES)` alone was shallow: emptying `VOICE_CUES[0].patterns` at runtime left it "frozen" and silently disabled the pin cue entirely.

### R-226 | area: copilot-cues | parallel-safe: yes | automatable: yes

**Summary:** A held question is bounded. It expires only once something is actually hidden behind it, and never otherwise.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/questionPin.test.js lib/copilot/currentQuestion.test.js`.

**Expected:** All pass.

**Why this case exists:** the phrases that SET a hold are reflexive stalling tics said at the start of most answers ("good question", "let me think", "give me a second"); the phrases that RELEASE one are a deliberate hand-back many candidates never say. Capture rate exceeds release rate, so an unbounded hold's steady state is a dashboard stuck on question 1 while the candidate answers question 3, with a passive badge as the only mitigation. Someone mid-answer is reading bullets, not counting badges.

Load-bearing specifics:

- **The rejected fix was "auto-release on the next detected question."** That is exactly the eviction the feature exists to prevent: an interviewer's mid-answer clarification is a detected question too, and nothing distinguishes it from the next question.
- **The clock starts at the first SUPERSEDE, not at the pin,** and later arrivals do not restart it. Anchoring it to the most recent arrival would let a talkative interviewer keep a stale hold alive indefinitely.
- **A hold with nothing behind it NEVER expires.** Nothing is being hidden in that state, so expiring could only yank the panel out from under a long answer. This is the whole reason the bound is keyed on the supersede.
- **A repeat pin cue re-pins forward** to the current question. This is what makes the population that causes the problem, candidates who say "good question" reflexively every time, self-correct on every question instead of stranding on the first.
- **120000ms is not arbitrary.** IEC 60601-1-8 time-bounds an audio-paused alarm at 120s without operator intervention for critical-care ventilators, on the same reasoning: a human may suspend monitoring, but not indefinitely and not without a visible marker.
- **`newerQuestionCount` skips null holes.** It previously returned `length - 1 - index`, so `[q1, null, null, q2]` rendered "3 newer questions detected" when one arrived. The test that pinned that behaviour was itself the defect.
- **A stale pin falls back through `latestQuestionEntry`, never to null** - a cleared feed must not blank the panel a candidate is reading.

### R-227 | area: copilot-cues | parallel-safe: yes | automatable: partly

**Summary:** The company-research cue sends only what the route needs, only when asked, and says where it goes before it is ever spoken.

**Steps:**
1. From `hello-world`, run `npx vitest run app/copilot/useCompanyBrief.test.js lib/copilot/companyBrief.test.js lib/copilot/groundingNotice.test.js`.
2. Manual (`automatable: no`): on the live copilot screen with a posting selected, confirm the sidebar names where a company lookup sends data BEFORE any cue is spoken, and that the recording notice in the session setup covers that destination too.

**Expected:** 1 passes. 2 shows the destination disclosed ahead of the request, not alongside it.

**Why this case exists:** three separate ways this could have shipped wrong, two of them silent.

- **The `url` trap.** `normalizePostingRows` puts the job advert's own `url` on the posting object, and `app/api/company-research/route.js` branches on `if (url)` into custom-URL mode. A hook that spread the posting into the request body would have turned the "company brief" into a one-card summary of the job ad the candidate had already read, with every unit test green. The body is built by `companyBriefRequest` and nothing else; `MAX_BRIEF_POSTING_CHARS` matches the route's own `MAX_POSTING_CHARS` deliberately, since the route re-slices anyway.
- **The embedded engine's notice was literally false.** It promised "nothing about this application is sent to Google." `researchCompanyLocal` calls `searchPostingUrls`, whose second provider is Google Programmable Search (`https://www.googleapis.com/customsearch/v1?...&q=<company>`). The claim is now scoped to what stays true. The literal-oracle test that pinned the old string was updated deliberately, in the same change, with the reason recorded in both the source and the test. That oracle exists to catch an ACCIDENTAL rewording, and it still does.
- **The silent branch was the wrong answer.** `postingGroundingNotice` returned "" when a posting was selected, the document load had settled, and neither document existed. That state still sends company, job title and posting text on a company cue, so it now says so.
- **The disclosure has to precede the request.** The fetch fires on the cue, so a notice that first renders inside the panel appears simultaneously with the request it describes, and when triggered by voice the user clicked nothing. It lives in the sidebar, beside the cue, as well as in the panel.
- **`submittedDocsClause(false, false)` returned the cover-letter claim** - a false statement about a document that does not exist. Harmless while it was module-private with one careful caller; a trap once exported from `lib/`. It returns "" and the behaviour is pinned.
- **Nothing is fetched until asked.** Never on mount, never on a posting change, never when a session starts. A model call for merely looking at the page is a defect this codebase already fixed once (AC-I4).

**Amended (regression pass, defects 1–3):** a later adversarial read found two defects inside this case's own territory, plus a third in a sibling case fixed in the same pass — none visible to `groundingNotice.test.js` or to Step 2 above as they stood.

- **Defect 1 — the "silent branch was the wrong answer" fix above was itself unguarded.** It stopped `postingGroundingNotice` from being silent for every posting with a settled, documentless load, INCLUDING one with no company on file at all — a state where `companyBriefRequest` returns null and no company-research request is ever issued, so naming Gemini there is exactly as false as the silence it replaced. Every fixture in `groundingNotice.test.js` fixed `company: "Acme Corp"`, which is why this was invisible. Now guarded on `hasCompany`, matching `companyResearchDestination`'s own check; see R-098's amendment.
- **Defect 2 — Step 2's own claim ("the recording notice in the session setup covers that destination too") was not true on the embedded engine.** `SessionSetup.js`'s consent Alert asserted the posting text is ALWAYS sent and named no recipient at all ("for that search"); `researchCompanyLocal`'s embedded branch never receives `posting`, and the true recipient is Gemini on one engine, one of Brave/Google/DuckDuckGo on the other. `automatable: no` on Step 2 meant nothing ever diffed the two disclosures against each other or against the route they describe. Both now render the identical, engine-aware sentence via `companyResearchDestination` rather than a third hand-written claim; `SessionSetup.test.js` pins that both of `SessionSetup`'s recording-notice branches interpolate it.
- **Defect 3 — a held question could outlive its own session.** Not a company-research defect, but found and fixed in the same pass; see R-229's own amendment for the full account.

### R-228 | area: copilot-cues | parallel-safe: yes | automatable: no

**Summary:** The voice-cue sidebar and the company brief fit the interview screen and are reachable by keyboard and screen reader.

**Steps:**
1. Open `/copilot` in live mode on a desktop window at least 900px wide. Confirm the cue sidebar renders beside the dashboard, inside the bounded live column, with the hearing strip and the question panels all still above the fold and the page not scrolling.
2. Narrow the window below 900px. Confirm the sidebar stacks and remains reachable by page scroll rather than being clipped.
3. At 320px wide, confirm there is no horizontal page scroll.
4. Start a session. Confirm the sidebar collapses to a one-line summary with an expand control, and that expanding it works.
5. Tab through the sidebar. Confirm every control has a visible focus ring and a distinct spoken name, and that the hold control's name does NOT change when it is pressed (only its pressed state does).
6. With a screen reader, hold a question by voice and confirm the change is announced; hold one by clicking and confirm it is NOT announced twice.
7. Trigger the company brief and confirm focus does not jump out from under you mid-answer.

**Expected:** every step as described. This case is `automatable: no` because jsdom has no layout engine, `getBoundingClientRect` returns zeros, and no test in this repo can measure a viewport or a focus ring.

**Why this case exists:** R-216 is the precedent. A fix whose acceptance criterion is "X is visible" was verified by render-tree assertions, passed every gate, and shipped inert because the element sat below a viewport-filling box. The criterion for a layout claim is a viewport measurement.

Load-bearing specifics:

- **The breakpoint is `md` (900), not `sm`.** Arithmetic against this app's own `maxWidth: 1180, p: {xs:1.5, sm:3}`: a 280px rail plus a usable main column needs 824px minimum, so it does not fit at 720px, which is the primary dual-screen case. This also matches the house convention, where `sm` is used for control rows and `md` for pane-level side-by-side.
- **Rows, not cards.** A card per cue measures 166px, so three cues plus a header is 624px against a roughly 700px bounded column, overflowing at four cues. A row is 88px.
- **No `aria-label` on the sidebar buttons.** WCAG 2.5.3 Label in Name, and failure technique F96: Apple Voice Control responds only to the accessible name and will not act on visible text unless the two are identical. Decorating these buttons with an `aria-label` would break exactly the users a voice feature serves.
- **The hold control is one stable-labelled button with `aria-pressed`,** never a "Hold"/"Release" label swap. Change the name or the state, never both.
- **`<ul>` with `list-style: none` drops list semantics in Safari,** so phrase lists carry `role="list"`. Conversely `<dl>` under `display: grid` is fine (fixed in Safari 17); the remaining hazard is `display: contents`.
- **`var(--text-muted)` measures 4.15:1 on `--bg-surface` in light mode,** below the 4.5:1 threshold for normal text. New surfaces use `--text-secondary` (7.10:1). The 42 existing uses under `app/copilot` are a separate, pre-existing problem.

### R-229 | area: copilot-cues | parallel-safe: yes | automatable: no

**Summary:** A held question is unmissable, says what is still happening behind it, and cannot strand a screen-reader user.

**Steps:**
1. Start a live session, get a question detected, and hold it (by voice or by the sidebar control).
2. Confirm the held state is carried by at least two things at once: a border treatment, a text badge, and a release control. Squint, or view in greyscale, and confirm it is still obvious.
3. Have a second question detected while the hold is in force. Confirm the count of newer questions appears, and that the count-bearing element is itself the one-click release.
4. Confirm the screen says detection is still running, so the hold does not read as the app having broken.
5. With a screen reader, repeat step 3 and confirm the arrival of newer questions IS announced while held.

**Expected:** every step as described.

**Why this case exists:** the "I forgot it was frozen" mode error is documented by the vendors who shipped the weak version of this. Papertrail's own design post-mortem records that dimming alone failed because "the lit and dimmed icons were so subtly different that some users didn't notice", and that a loud red alarm was rejected as "too loud"; Grafana's own engineers filed a bug against their live-tail pause saying "we didn't realize that live tailing was paused... it might seem that live tailing is broken", and it was closed with no design shipped.

Load-bearing specifics:

- **Colour alone is not a state change here, measured.** `--warning-soft` against `--bg-surface` is 1.08:1 in light mode and the default `--border` is 1.37:1. The held state needs the `--warning` border (4.87:1), the text badge, and the release control together.
- **The indicator IS the button.** Every shipped implementation that carries a count puts it inside the release control: OpenShift's "Resume stream and show N new lines", Mastodon's "N new items", the Guardian's "N new updates". None of them caps the count, so this does not either. Two-click designs are the documented failures.
- **Name three states, not two:** live, held, and held-with-newer-questions-behind-it. Papertrail's post-mortem is explicit that two was not enough.
- **Say what is and is not still happening.** Sumo Logic's wording ("The Live Tail is still running, but automatic scrolling on your screen stops") is what prevents the "is it broken?" misread that bit Grafana. Detection, drafting and the question feed all keep running while held; only what the panel DISPLAYS is frozen.
- **The screen-reader stranding bug.** While held, `QuestionFeed`'s polite region would otherwise announce the PINNED entry's status, which does not change as new questions arrive, so React bails on the identical setState and the region says nothing at all. Sighted users get the badge; screen-reader users get silence, which is the exact stranding the badge exists to prevent. While held that region carries the hold state and the arrival count instead, and the feed carries `aria-busy="true"`.
- **Announce on the voice path only.** A cue the user spoke is a system-initiated change; a click is not, and announcing it duplicates the `aria-pressed` change. Always polite, never assertive: interrupting a candidate mid-answer is the worst available behaviour.
- **A framing worth keeping:** WCAG SC 2.2.2 Pause, Stop, Hide is Level A and its auto-updating clause has no five-second exception. The dashboard is auto-updating information presented in parallel with other content, so this hold is not only a convenience, it is the pause mechanism that SC's conformance rests on.

**Amended (regression pass, defect 3):** the hold released on every path this case's own steps exercise — the release control, Clear, a new session, an unpin cue — but not on the two ways a session ends WITHOUT any of those ever running: the audio track's own native `ended` event (a "Stop sharing" click, or the interviewer closing the shared tab) and a fatal essential-source error, both handled entirely inside `lib/copilot/session.js`'s `stop()`/`aggregateStatus()`, which reach `useLiveSession.js` as nothing more than a `status` change. `pin.unpinQuestion()` was called from exactly one place — this hook's own `stop()` — so a hold on either of those two paths survived the session that created it: `held` stayed true permanently, and because the ticking `now` clock R-226's own 120s expiry depends on is itself gated on `live`, that expiry could never even attempt to self-correct it either. `CopilotDashboard` kept rendering "Detection and drafting keep running behind the hold" — this case's own Step 4 requirement — for a session that was no longer running anything: exactly the "is it broken?" misread Step 4 exists to prevent, for the opposite reason this time — nothing was broken and nothing was running, and the screen said otherwise. No test anywhere in this suite ever ended a session any way but Stop, so this was invisible to all of them. Fixed by releasing the hold on every transition out of the live state — a render-phase state adjustment in `useLiveSession.js`, not only inside `stop()` — and, belt-and-suspenders, by conditioning `CopilotDashboard`'s held caption on `live` too. `useLiveSession.cues.test.js` now drives the exact `onStatus("idle")` callback `session.js` calls on both paths, without ever calling this hook's own `stop()`.

### R-230 | area: copilot-speak-as | parallel-safe: yes | automatable: partly

**Summary:** The copilot has a third mode, "Speak as", and entering it puts a situation on screen with no further click.

**Steps:**
1. Open `/copilot`. Confirm three modes: Live interview, Practice, Speak as.
2. Choose Speak as. Confirm a role picker, a situation as a heading, its one-line context, and an instruction to answer it out loud are all on screen without any further interaction.
3. Confirm no session setup, consent alert, dashboard, voice-cue rail or transcript disclosure renders in this mode.
4. Switch back to Live interview, then to Practice. Confirm both are exactly as before.
5. Change the role. Confirm a new situation loads with no extra click, and that reloading the page later reopens on the role last chosen.

**Expected:** every step as described. Two clicks take a cold page load to a revealed model answer for the remembered role: the mode toggle, then Reveal.

**Automated by:** `app/copilot/CopilotClient.roles.test.js` (mounts the real CopilotClient), `app/copilot/roles/RoleDrillClient.contract.test.js`.

**Why this case is `partly`, and what that means for a regression run:** the steps above are written as a click-through of `/copilot`, and that route is behind the auth middleware - a run without credentials lands on `/login?redirect=%2Fcopilot` with an empty body. **A blocked case is not a pass, and it is also not a regression.** The properties in these steps are each executed headlessly by the suites named above, which is what an automated pass may rely on; the browser walkthrough is the manual half, and needs a signed-in session. The same applies to R-231, R-232 and R-233. Never sign in on behalf of the user to unblock one of these - render the component in a temporary harness page under `app/auth/` instead (the middleware treats that path as public), which is how R-235's own measurements were taken, and delete the harness afterwards.

**Load-bearing specifics:**

- **The drill is mounted only while its own toggle is selected.** That is what makes "no request on page load" true without any guard inside the component: it does not exist in the tree until then.
- **The mode switch lives in `app/copilot/ModeSwitch.js`,** extracted when the third mode was added because `CopilotClient.js` was at 904 lines against a 1000-line cap. It owns MUI's null-on-re-click report; an exclusive `ToggleButtonGroup` reports `null` when the selected button is clicked again, and swallowing it there is what stops the mode from ever being unset.
- **Leaving live mode tears down a capture session keyed off `sessionRef.current`, not `status`** - an errored session still holds the screen-share and mic tracks. Same rule practice mode already followed.

### R-231 | area: copilot-speak-as | parallel-safe: yes | automatable: partly

**Summary:** The model answer is a disclosure: nothing is generated until it is asked for, and it is requested once per situation.

**Steps:**
1. In Speak as, confirm no model-answer request is issued on mount or on a role change.
2. Click "Reveal a model answer". Confirm one request, and that the panel opens with the beats, the spoken length, the cadence, the terms of art and the do-not-say list.
3. Hide and show again. Confirm no second request.
4. Click "New situation". Confirm the revealed answer is cleared and the control is back to "Reveal a model answer".
5. Confirm the situation response carries only `id`, `prompt` and `context`.

**Expected:** every step as described.

**Automated by:** `app/copilot/roles/RoleDrillClient.contract.test.js`, `app/api/copilot/role-situation/route.contract.test.js`.

**Load-bearing specifics:**

- **The bank's `beats` never leave the server with the situation.** They are the material the model answer is built from, and the whole premise of the drill is that you answer the scene out loud BEFORE seeing how the role would. Shipping them alongside the prompt would put the answer in the network response of the request that asks the question. Caught at verification, not by any test that existed at the time; there is one now.
- **Two independent generation refs.** A slow situation load and a slow reveal can be in flight together, and neither may cancel the other. A slow situation for a role the user has moved off repaints nothing even when it resolves last.

**Amended (adversarial audit, before first push):** four ways this case's own promises failed in practice, none of them visible to the tests as first written.

- **Leaving the mode and coming back destroyed the drill.** The mode renders from a ternary, so `RoleDrillClient` unmounts, and every bit of hook state died with it: the situation, the reveal, the answer cache and the asked list. Flicking to Live interview and back lost the scene the user was mid-drill on and fired a fresh model call for a round trip they experienced as free - the same "a model call for merely looking" defect AC-I4 already fixed once. The drill's session state now lives in a module-scoped, storage-backed store (`app/copilot/roles/roleDrillStore.js`), so re-entry restores rather than refetches. The test for this asserts NO fetch on remount; an assertion that a fetch happens is asserting the bug.
- **"New situation" went permanently dead once a role's bank was exhausted.** `asked` never shrinks, so the server returned the same first situation forever, and because its id never changed a revealed answer stayed open too - the button produced zero visible change, under a line promising the situations would start repeating. Exhaustion now starts the cycle over.
- **A double click reopened the panel the user had just closed.** The second click hid it; the in-flight draft then resolved and asserted `visible: true`. On a drill whose premise is answering before you look, an answer that reappears against the user's own action is the worst available behaviour.
- **"New situation" was never disabled in flight,** so five fast clicks fired five authenticated model calls, four of which were discarded by the generation guard without ever being recorded as asked - meaning they could be served again later.

### R-232 | area: copilot-speak-as | parallel-safe: yes | automatable: partly

**Summary:** Every claim the answer panel makes about its own answer is true.

**Steps:**
1. Reveal a model answer. Confirm the terms marked "(used in this answer)" actually appear in the lines above, and that terms not marked do not.
2. Confirm no line contains any phrase from the same panel's "Do not say" list.
3. Confirm the spoken-length line matches the answer actually shown, and that its pace is the same "measured" band live and practice mode use.
4. On the Embedded engine, confirm the caption reads that it was drafted on this server with no AI provider. On Gemini, confirm it names Gemini. Force a Gemini failure and confirm the caption says Gemini could not draft this one and it was drafted on this server instead.
5. Confirm the beat labels shown are the role's own, whichever engine answered.

**Expected:** every step as described.

**Automated by:** `lib/copilot/roleResponse.contract.test.js` (sweeps every role and every situation), `app/api/copilot/role-response/route.contract.test.js`, `lib/copilot/spokenPace.contract.test.js`. Step 4's rendering is covered by `RoleDrillClient.contract.test.js`; seeing it against the live model is manual.

**Load-bearing specifics:**

- **`termsUsed` is COMPUTED from the answer's own text on both engines, never asserted** - and fewer than two terms is a fallback trigger on the Gemini path, not just a guarantee of the deterministic one. Gemini is the default engine; a guarantee that holds only on the other path is a panel that routinely marks nothing.
- **A model answer containing one of the role's own `avoid` phrases falls back.** That is why `avoid` entries are quotable fragments with a reason attached rather than sentences describing a mistake: the route can only reject what it can match. An answer that commits the register violation printed directly beneath it teaches the opposite of the drill.
- **The model never authors the reference material.** Cadence, terms and do-not-say always come from the register, and the model's line labels are replaced positionally by the register's beat labels, so the panel's beats are always the role's beats.
- **A third source caption exists for `fallback` on purpose.** "Drafted by Gemini" credits a model that did not write it; "no AI provider" contradicts the engine the user chose. Both were false, so neither is used.
- **The composer may not introduce a term the authored beat did not contain.** An earlier build decorated the first fallback line with a term of art to satisfy the >= 1 guarantee and shipped "Let me be clear about the escalate here:" - broken English, and a vocabulary claim the material did not support. The guarantee lives in the content: every role's fallback beats carry at least one of its own terms.
- **A beat that opens itself is spoken as written.** Prepending a connector to "Let me tell you the assessment plainly:" produces two run-ups to one sentence. For a drill about cadence that is the wrong thing to model.

**Amended (adversarial audit, before first push):** five more ways the panel's claims came apart, all found by reading the composed prose and the matching code rather than by any assertion.

- **The do-not-say guard was defeated by an apostrophe.** 27 of the 40 avoid phrases contain a straight `'` ("it's probably nothing", "we'll figure it out later") and the match was a raw `includes`. A model writing the typographic apostrophe - which they routinely do - put the exact banned sentence on screen as a model answer, with "do not say <that same sentence>" rendered directly beneath it. Apostrophe variants are normalized on both sides before comparing.
- **Term marking had no word boundary,** so "board" matched "onboarding" and "scope" matched "telescope". Not cosmetic: two accidental substrings clear the two-term bar that gates the Gemini path, admitting an answer with no register vocabulary at all and then marking both accidents "used in this answer". Matching now requires a leading word boundary; a trailing one was deliberately NOT added, because the bank legitimately uses inflected forms ("backfilled" for "backfill").
- **The first line's connector contradicted the cadence rule printed three lines below it,** in 6 of 10 roles: every register's first cadence line is a lead-with rule, and the answer opened "Let me start with the facts: the number is a twelve percent cut... and I am leading with that before anything else." The first line is now the beat itself, always.
- **A beat carrying its own colon got a comma-spliced second lead-in** - "Here's where things stand, what they are asking is real: ..." - because the self-opening rule only recognised pronouns. Any beat with a colon in its first 60 characters is now spoken verbatim.
- **The fallback answered a DIFFERENT situation than the one on screen, silently.** On Gemini - the default engine - every situation after the first has a `generated-<hash>` id that is not in the bank, so any model failure fell through to the register's situation-agnostic beats: a scene about two engineers competing for one promotion, answered with a model answer about a slipped deadline, captioned only "Gemini could not draft this one". The response now carries `situationMatched`, and the panel says the answer is the role's general shape when it is.

**Content errors found by the same audit, all corrected** - the pattern is that most were caused by forcing a vocabulary term into a sentence to satisfy the two-terms-per-situation rule, which is exactly the wrong resolution:

- **HR folklore stated as law.** "The process requires a documented PIP first" - no jurisdiction requires one; it is company policy where it exists, and the registry's own `at-will employment` entry said so two entries later. Now framed as company policy.
- **A single termination framed as a mass-layoff trigger,** with a beat referring to "the affected roles" in the plural. Federal WARN needs 50+ losses at a site. The scene is now a real series.
- **"Adverse event" used for a rushed consent conversation** (the registry defines it as documented harm during care) and **"standard of care" used as a numeric wait-time target** (it is the negligence benchmark). Both replaced with correct usage.
- **"Conflict of interest" used twice by the attorney for exposure that is nothing of the kind** - and, worst of all, a beat in which the attorney told opposing counsel "the production is complete as agreed" when their own paralegal had flagged the gap two days earlier. That is a knowing misrepresentation, and it was the single most dangerous line in the bank.
- **MEDDIC has no "paper process"** - that letter belongs to MEDDPICC. An AE calling it a MEDDIC gap in a forecast call signals they do not know the framework they claim to run.
- **A do-not-say entry that forbade the honest thing** ("we don't really have the data") - which the response route then rejected as a register violation, exactly backwards.

**Design research, for whoever changes this next.** A survey of the comparable products found that none of them does what this feature does: Yoodli, Orai, Poised, Exec, Second Nature, Hyperbound and Google's Interview Warmup all measure DELIVERY and deliberately refuse to show a model answer (Interview Warmup's own FAQ: its insights "don't 'grade' your answer or tell you what part of your answer is right or wrong"). The revealable-model-answer-with-annotations pattern lives in a different family - LinkedIn Interview Prep, Duolingo's "Explain My Answer", and clinical communication guides like VitalTalk, whose layout (step name, then "What you say:", then the quoted line, then why it works) is the closest precedent for this panel. Two of that research's conclusions were already independently true here and should not be undone: **140 wpm** is the right pace constant for a target to be delivered deliberately (it sits inside every prescriptive band and below the measured 163-183 wpm of read-aloud and TED delivery), and **the revealed answer must NOT be wrapped in a live region** - `aria-expanded` already conveys the state change, and a live region would read the entire model answer aloud on every reveal. Announcing a category ("Answer ready, N points") from a separate hidden region is the correct shape.

**Known, deliberate, not done:** the spoken-length line reads "About 99 words - roughly 42 seconds". A words-per-minute constant cannot support second-level precision, and the surveyed products that age well (Medium) pick one disclosed constant and round hard. Rounding to a human grid - nearest 10s under 30s, nearest 15s to 90s, nearest half-minute above - would be the honest presentation. Left as-is because "roughly" already hedges it and the change would churn a tested contract for a cosmetic gain; do it the next time this panel is touched.

### R-233 | area: copilot-speak-as | parallel-safe: yes | automatable: partly

**Summary:** Both engines work, and the drill never dead-ends.

**Steps:**
1. On the Embedded engine, confirm situations and model answers are produced with no network call to a model provider at all.
2. On Gemini, confirm a model failure, an empty response, a repeat of a situation already shown, a wrong line count, or a body that cannot be parsed all return a usable result reported as `fallback` - never a 500 and never a well-formed empty one.
3. Click "New situation" past the end of a role's bank. Confirm the drill says the situations will start repeating rather than showing a blank card.
4. Sign out and confirm both routes answer with the copilot's shared sign-in message.

**Expected:** every step as described.

**Automated by:** both route contract tests, `lib/copilot/roleSituations.contract.test.js`.

**Load-bearing specifics:**

- **Situation selection cycles rather than dead-ending,** deliberately diverging from `nextPracticeQuestion`, which returns an empty question when exhausted. A register drill has no reason to stop, and a blank card is worse than an honest repeat - so the UI says it is repeating.
- **Ordering is seeded on the role value** via `pickDistinct`, so it is stable and reproducible without being the bank's declaration order.

**Amended (adversarial audit, before first push):** a model-written situation is now held to the bank's own contract - 80 to 420 characters for the prompt, a non-empty context of at most 200 - and anything outside it falls back. Before this, nothing bounded model-authored text that renders straight into an `h3`, and an empty context rendered as a blank line under the heading. The model's own generated prompt is also truncated to the same cap the asked list uses before being compared against it: without that, any generated prompt over 420 characters could never match its own recorded entry and would be re-served forever while `exhausted` stayed false. (The length gate now masks that second bug in the merged route - the agent that fixed it demonstrated the overlap by sabotage rather than writing a test that only appeared to isolate it. The fix is kept because it matches the sibling route and is real protection if the two caps ever diverge.) The role in the response is always the requested one, never anything echoed from the model.

### R-234 | area: copilot-speak-as | parallel-safe: yes | automatable: partly

**Summary:** Nothing about the user leaves the browser for this drill, and the screen says exactly that.

**Steps:**
1. Watch the network while using the drill. Confirm both requests carry only the role, the situation, and the engine - no prep context, resume, cover letter or posting.
2. Add extra fields to a request by hand. Confirm they reach neither the model prompt nor the response.
3. On the Embedded engine, confirm the mode's header credits THIS SERVER - it drafts with no AI provider, so nothing is sent to Google. On Gemini, confirm it names Google and says only the role and the situation text go there.
4. Confirm the header never mentions the prep context, resume or cover letter in this mode, and never claims nothing leaves the browser.

**Expected:** every step as described.

**Automated by:** `lib/copilot/roleDrillClient.contract.test.js` (exact request key sets), `app/api/copilot/role-response/route.contract.test.js` (injection, on the Gemini path where it matters), `app/copilot/CopilotClient.roles.test.js` (both header branches).

**Load-bearing specifics:**

- **Both request bodies are written as explicit object literals, never a spread,** so adding a field later is a visible edit rather than something that rides along.
- **The injection test runs on the Gemini engine.** On the embedded path there is nowhere for injected text to go, so a test there proves nothing about the property.
- **The precise claim is per-engine.** Both routes still authenticate like every other copilot route, so requests are attributable to the account server-side; the header claims nothing stronger than "nothing leaves this browser" on embedded and "the role and the situation text go to Google" on Gemini.

### R-235 | area: copilot-speak-as | parallel-safe: yes | automatable: no

**Summary:** The drill is operable and legible by keyboard, by screen reader, and on a phone.

**Steps:**
1. Tab through the whole mode. Confirm every control has a visible focus ring and a distinct spoken name, and that each name contains the control's own visible text.
2. With a screen reader, reveal a model answer. Confirm the reveal is announced once ("Answer ready, N points") and that a situation merely loading announces nothing.
3. Reveal an answer that is already cached (hide, then show). Confirm it is still announced.
4. Trigger a failed reveal. Confirm the error is announced once, by the alert, and not a second time by the status region.
5. Confirm the situation is a heading below the tab's own heading, in order.
6. At 320px wide, confirm no horizontal page scroll and that every control meets the 44px touch target.
7. Confirm the terms and do-not-say lists are announced as lists, and that "(used in this answer)" is real text, not colour or an icon alone.

**Expected:** every step as described. `automatable: no` because jsdom has no layout engine, no focus ring, and no screen reader.

**Why this case exists:** R-216 and R-228 are the precedent - a criterion about what is visible or announced is only settled by looking and listening, and this repo's automated steps cannot do either.

**Load-bearing specifics:**

- **The role picker is a NATIVE `<select>`, not MUI's listbox Select.** MUI points the non-native trigger's `aria-labelledby` at the field label only, never at the element holding the selected value, so its accessible name is "Speak as" while its visible text is the selected role - a WCAG 2.5.3 mismatch. The native control's real `<label for>` names it correctly.
- **No `aria-label` anywhere in this feature, and no `Tooltip` on a control with visible text.** MUI's Tooltip becomes an `aria-label` and renames the control, which breaks voice control for exactly the users a speaking drill serves.
- **The status region is mounted unconditionally and speaks for the reveal only.** A region that first appears already carrying its final text is not announced by NVDA or JAWS, and an instantly-cached reveal is precisely that case.
- **New surfaces use `var(--text-secondary)`, never `var(--text-muted)`** (4.15:1 on `--bg-surface`, under the 4.5:1 threshold).
- **The panel reads correctly aloud, not just on screen.** Quote marks and dashes are silent at default screen-reader punctuation, so a term and its meaning are joined by the word "signals" and each do-not-say phrase is emphasised, rather than running into its reason as one sentence.
- **The reveal control names the panel it opens** (`aria-controls` resolving to a real node), not just its own expanded state.
- **Two things here were found only by rendering it in a browser,** via a temporary harness page under `app/auth/` (the middleware treats that path as public), because `/copilot` is auth-gated and jsdom has no layout: MUI's `variant="subtitle2"` renders an `h6`, so the panel's section labels jumped straight from the situation's `h3` - the exact gap a screen-reader user navigating by heading falls into; and the role field measured 44px while the native `select` inside it measured 40, so the top and bottom of the visible control were not tappable. Measured after fixing: no horizontal scroll at 320px, 44px controls, the mode row 264px wide with its right edge at 286px against a 320px viewport, accessible name "Speak as", zero `aria-label`s, and the status region reading "Answer ready, 4 points".

### R-236 | area: copilot-speak-as | parallel-safe: yes | automatable: partly

**Summary:** "Speak as" records the answer you say out loud and gives it the same delivery measurements and AI feedback practice mode gives, in one press.

**Steps:**
1. Open `/copilot`, choose Speak as. Confirm a privacy notice, a microphone picker, a "Start speaking" button and the camera-frames / save-recordings switches are all on screen, and that no camera or microphone permission has been requested yet.
2. Press "Start speaking" ONCE. Confirm the camera and mic session starts AND the answer begins recording with no second press — the control becomes "Done" and a "● Recording your answer…" line appears.
3. Answer the situation out loud, then press "Done". Confirm the answer review (duration, speaking time, word count, pace, fillers) and the answer feedback panel (score, verdict, strengths, improvements, what was missing, delivery notes, body language) both appear.
4. Confirm the feedback panel's two actions read "New situation" and "Try again", not "Next question".
5. Press "Try again". Confirm recording restarts on the SAME situation with no second press and no new situation fetched.
6. Press "New situation" mid-answer, and again during the "Finishing up your answer…" window. Confirm the answer is discarded in both cases: no feedback appears for it, and the new situation is what is on screen.
7. Press "Stop", then leave the mode. Confirm the camera light goes out both times.
8. Turn "Include camera frames in AI feedback" on, then switch the engine to Embedded in Settings. Confirm the notice says nothing is sent to Google and that no frame is sent.
9. Turn "Save recordings to my account" off while the feedback is still loading. Confirm nothing is uploaded and no "Saved to your practice history" alert appears.

**Expected:** every step as described. ONE press takes a cold Speak as tab to a running recording; ONE press takes the feedback panel back to a second attempt.

**Automated by:** `app/copilot/roles/RoleDrillClient.recording.test.js` (mounts the real RoleDrillClient and drives it through real clicks), `lib/copilot/roleDrillAnswer.test.js`, `app/copilot/CopilotClient.roles.test.js`.

**Why this case is `partly`:** same as R-230 — `/copilot` is behind the auth middleware, and this mode now also needs real camera and microphone hardware, which no headless run can supply. A blocked case is not a pass and is not a regression. Steps 2-6, 8 and 9 are executed headlessly by the suites named above; the walkthrough is the manual half.

**Load-bearing specifics:**

- **Nothing here is a second implementation.** The recorder, the frame sampler, the body-language sampler, the post-Done transcript drain, the generation guard, the critique request and the save-to-history flow are all practice mode's own `usePracticeAnswer`; the camera/mic session is its own `usePracticeCaptureSession`. A fork would look identical on screen while silently dropping the generation guard (BUG-11), the live save-switch re-read (BUG-2), the muted-mic seed (BUG-15) and the frames-actually-sent record (K1). The test asserts on `computeAnswerMetrics`'s own key set plus the `bodyLanguage` value only `doneAnswer` merges, precisely because a hand-rolled pipeline could satisfy anything weaker.
- **The frames opt-in must be gated on the engine at SEND time, not latched.** The engine is a global preference changed elsewhere in the app, so it can move underneath a switch that is already on. `includeFrames: sendFrames && !isEmbedded` re-derived per request — including on Retry — is what stops a photograph of the user's face reaching Google while the notice on screen says nothing does.
- **`isSaveEnabled` is the plain `readSaveEnabled` function, never the hook's `saveEnabled` value.** The upload happens seconds after Done, once the critique settles. `persistAnswer` treats a MISSING reader as "enabled", so omitting it entirely is silent — the only assertion that catches it is one that turns the switch off mid-critique and requires no upload.
- **This mode sends nothing personal.** `roleAnswerContext` hard-pins `posting`, `profile` and `applicationId` to their absent values, so the critique route's document fetch, posting section and background section are all skipped. The privacy notice is therefore a separate function from `buildPrivacyNotice`, whose engine sentence asserts "the posting details, and your prep context are sent" — true in practice mode, false here.
- **A final is admitted to an answer by AUDIO time, not arrival order.** The window's lower bound is the audio clock as it stood at "Start answering", and that clock only moves forward across a session — so a second answer whose transcript replays an earlier offset is rejected in full and measured as empty. Any test driving more than one answer must advance the cursor, or it silently asserts against nothing.
- **Two live regions, and the reveal's must stay first in the DOM.** `answerStatusMessage` has no recording vocabulary and its region speaks for the model-answer reveal only, so recording state gets its own. `RoleDrillClient.contract.test.js` reads `querySelector('[role="status"]')` — the first such node — and requires it empty until an answer is revealed.
- **`MicPicker` became a native `<select>`** (the pattern `RolePicker` already used and documented): MUI's non-native Select points its trigger's `aria-labelledby` at the field label only, never at the element holding the selected value, which is a WCAG 2.5.3 accessible-name/visible-text mismatch. It became BLOCKING rather than cosmetic once the role drill rendered the picker, because that mode's frozen contract sweeps every `[role="combobox"]` for exactly this. A native `<select>` has no `role="combobox"` ATTRIBUTE, which is why `RolePicker` was never swept, and it genuinely does not have the mismatch. This affects live and practice mode too - the external `value`/`onChange` contract is unchanged.
- **That conversion was shipped, reverted, and re-landed the same day.** The first attempt broke two things no test in this repo could see, and both are now pinned by `app/copilot/MicPicker.test.js`, which did not exist before. (1) **The floating label stopped shrinking**: MUI derives `InputLabel`'s shrink from the FormControl's `filled` state, which `InputBase` computes on MOUNT from the DOM node's value - and this picker loads its options ASYNCHRONOUSLY, so at mount the select reads empty and the value-keyed effect never re-fires, printing "Microphone" on top of "Blue Yeti" with the outline notch closed, for every user on first load and again on every mode switch. Fixed by passing `inputLabel: { shrink: true }` unconditionally, which is correct precisely because a native select has no blank state. (2) **A vanished device displayed as "System default"**: a native `<select>` cannot hold an out-of-range value - the browser forces `selectedIndex 0` and fires no `change` - while `micDeviceId` still held the stale id and `capture.js` still applied it as `deviceId: { exact: ... }`. The picker now renders the unavailable id explicitly and never calls `onChange` to correct itself; silent substitution is what `audioDevices.js` says its resolver exists to prevent.
- **Recording cannot begin against a situation the user is about to be moved off.** `useRoleDrill` deliberately keeps the PREVIOUS situation on screen while a new one fetches, so `situation` is truthy and a press looked startable. Recording began against the stale scene, the new one swapped in under the running recorder, and the critique - plus the saved history row - graded the answer against a scene the user never read. `roleAutoStartDecision` returns `"wait"` (never `"drop"`) while a situation is pending, so the armed press SURVIVES and fires against the scene actually on screen; the answered situation is also captured into a ref at `startAnswer`, and the critique context is built from that ref rather than the live render value. Practice mode is immune by construction - its question can only change through a handler that abandons the answer - which is exactly why the hand-re-derived copy of `autoStartDecision` dropped the case.
- **The primary control is disabled whenever there is nothing to answer.** With only `status === "connecting"` gating it, pressing it before the first situation landed, after a role change, or after a failed fetch acquired the camera and microphone - permission prompt, camera light on - armed a press that was then rejected and DISCARDED, and recorded nothing, with no message anywhere on screen.
- **"Stop" must not delete a settled review.** `usePracticeCaptureSession`'s `stop()` and its `onStatus("idle")` branch both call `resetAnswerState()`. In this mode Stop sits in the SAME row as Start speaking/Done, so it is pressed right after an answer - wiping the score, the strengths and the replay being read. The drill passes a ref-gated wrapper that clears only when something is genuinely in flight: an answer recording or settling, OR a critique that has not settled yet. The critique clause is not optional - `abandonInProgressAnswer` bumps the generation, so an unsettled critique that is never cleared strands the panel on its spinner forever.
- **Every defect above reached a green suite.** All of them were found by rendering the real component and walking the manual steps, none by an automated case; the suite sat at 4992 passing tests throughout. Treat an automated pass on this case as covering its executable subset only.

### R-237 | area: copilot-predictions | parallel-safe: yes | automatable: partly

**Summary:** The predicted next question and its pre-drafted answer are gone from both copilot modes — removed, not hidden — and nothing they shared with a surviving feature went with them.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/predictionsRemoved.test.js app/copilot/useCopilotDashboard.noSpeculation.test.js app/copilot/dashboard/CopilotDashboard.render.test.js lib/copilot/practiceNotices.noPreDraft.test.js`.
2. In live mode with a session running and a question detected, confirm the dashboard shows exactly three things: "Current question", "Answer to the current question", and the "Your delivery" strip. There is no predicted-question panel, no predicted-answer panel, and no "Show predicted question and answer" switch beside the heading.
3. With devtools' network tab open, run a live session through several detected questions and confirm no `/api/copilot/question` request is ever issued. Live mode had no other caller of that route.
4. In practice mode, confirm the same three-panel dashboard, and that the switch row under the controls holds exactly two switches — "Include camera frames in AI feedback" and "Save recordings to my account". Confirm the privacy notice contains no sentence about a predicted question being sent to Gemini automatically.
5. Still in practice mode, press Start practice, then Next question twice. Confirm each question arrives (`/api/copilot/question` still serves the drill), and that revealing the sample answer still works and is instant for a question the queue already drafted.
6. Confirm `lib/copilot/predictionPrefs.js`, `app/copilot/usePredictionVisibility.js` and `app/copilot/useCopilotDashboard.wiring.test.js` do not exist, and that the `localStorage` key `copilot-show-predictions` is neither read nor written anywhere under `app/` or `lib/`.

**Expected:** All four suites pass, and the manual steps read as described.

**Removed, not disabled, and step 6 is what distinguishes the two.** The feature previously had a visibility preference (the retired R-166) that could hide the panels and stop the model calls. Shipping that switch permanently set to `false` would satisfy every behavioural assertion above while leaving the whole apparatus in the tree to be accidentally re-enabled. `app/copilot/predictionsRemoved.test.js` therefore reads SOURCE TEXT — normally a poor test, and the right tool here because the property being asserted IS the shape of the source. It bans the feature's vocabulary per-file across the seven files it touched, and sweeps every `.js` file under `app/` and `lib/` for imports of the deleted modules and for the storage key.

**Every absence assertion is paired with a positive control, because an absence is satisfied by a dead file.** "No predicted panel renders" is equally true of a component returning `null`; "`fetchNextQuestion` was never called" is equally true of a hook that does nothing. So each banned sweep in `predictionsRemoved.test.js` sits beside a `keep` list for the same file, `CopilotDashboard.render.test.js` asserts the surviving panels and headings render, and `useCopilotDashboard.noSpeculation.test.js` proves the hook is alive by driving `recordSpeechSample` to a real measured pace before asserting the two network modules were untouched. A change that guts rather than trims must fail here.

**The four gate files are the only things excluded from the repo-wide sweeps, by explicit path.** Each quotes the removed feature's strings verbatim — that is what makes their bans falsifiable — so sweeping them would fail forever regardless of the tree. The exclusion is by resolved path and NOT by a `.test.js` suffix rule, so a stale reference in any other test file is still caught. A `[control]` case pins that the walk returns hundreds of files and reaches both roots, since an empty offender list is also what a walk finding nothing produces.

**`useCopilotDashboard()` takes no arguments now, and that is deliberate.** A hook still accepting and ignoring nine props is the unwired-but-not-removed outcome in another form. `useCopilotDashboard.noSpeculation.test.js` asserts `Object.keys(...)` is exactly `["fillers","pace","recordSpeechSample","resetForSession"]`.

**`CurrentQuestionPanel`'s provisional branch is NOT a prediction and must keep rendering.** It describes a REAL detected utterance of unclear speaker — the opposite uncertainty from a guess about the future — and gating or deleting it would hide the candidate's own speech being mistaken for the interviewer's. The shared accent card it uses was named `PredictionPanel` and is now `AccentPanel`, with `chipLabel` required rather than defaulting to "Prediction", since that branch is its only remaining caller. It must still meet R-106's bar: the accent card AND the chip AND the sentence, never one of the three alone.

**Pace and fillers are not prediction panels.** They derive from `speechSamples` via `recordSpeechSample` and were always independent of the removed gate. `resetForSession` now clears nothing but that rolling window — which is still load-bearing, since a previous session's speech would otherwise bleed into the next session's reading.

**Three surviving features are easy to mistake for the removed one, and step 5 exists for them.** Practice mode's drill-question generator calls the same `/api/copilot/question` route the prediction used; `useSampleAnswer.queue` drafts an answer to the CURRENT question the moment it lands, caching it without showing it; and live mode's Auto-draft still drafts answers to REAL detected questions through `answerCacheRef`. Deleting any of the three as part of this removal would look superficially consistent and would silently cost the user a working feature.

**The privacy notice must not outlive the transfer it described.** Practice mode's notice used to state that a predicted question and the prep context were sent to Gemini automatically, before the user revealed anything. That send no longer happens, so `buildPrivacyNotice` no longer takes `preDraftEnabled` and `preDraftClauseFor` is gone. `lib/copilot/practiceNotices.noPreDraft.test.js` carries an independent frozen copy of the pre-feature derivation and asserts byte-identity across all 256 flag combinations times both provider values, that a stray `preDraftEnabled: true` from an un-updated caller changes nothing, and that no input produces a notice matching `/predict/i`. Its `[control]` case proves the oracle discriminates between inputs, so the comparison is not `f(x) === f(x)`.

**This gate was built by mutation, over three adversarial rounds, and the first version of it was theatre.** An independent reviewer cloned the tree into a scratchpad, wrote the post-removal implementation itself in twenty-five variants, and ran this case's four suites against each. Round one: **6 of 16 wrong implementations shipped fully green**, and the FAITHFUL removal could not pass at all — three repo-wide sweeps matched their own canary samples, which is precisely how a sweep gets deleted by someone who reasonably concludes it is broken. The escapes were not exotic. The feature came back verbatim under the word "lookahead" and every vocabulary ban passed. The speculative requests came back through raw `fetch` to the same two endpoints and the two mocked client modules were never touched. The same effect moved one file up into `CopilotClient.js`, which no ban covered. `useSampleAnswer.queue` was deleted outright and `keep: [/cacheRef/, /queue/]` still passed — satisfied by nine leftover comment mentions and two orphaned refs, because a `keep` regex cannot tell a live function from its own obituary. The visibility toggle came back as a `<Button role="switch">` and the `input[type="checkbox"]` count stayed zero.

**The durable lesson: a vocabulary ban pins the SPELLING of a removed feature, not its SHAPE.** Every fix that mattered replaced a ban with a positive, exhaustive, structural assertion — the exact heading list rather than a minimum count, the exact rendered text rather than a list of forbidden phrases, the exact parameter set of `buildPrivacyNotice` rather than one forbidden name, the declared prop surface with `...rest` forbidden rather than trusting the fixture's props. Two further rounds closed six more escapes found the same way: a headless panel built from `<Typography component="span">` (no heading, no control, invisible to every count); a panel gated on a prop the fixture never passes; a panel rendered through `createPortal(…, document.body)`, which is what every MUI Popper, Tooltip and Dialog does by default, so `container.textContent` never saw it — hence `text()` reads `document.body` and a tripwire asserts the two are equal; and the whole privacy clause reinstated under `readyReplyEnabled`, invisible because a combinatorial sweep never sets a flag it does not know about. Two known holes remain and are documented rather than papered over: speculation extracted into a NEW hook file that binds its transport at module scope (`const send = globalThis.fetch.bind(globalThis)`) escapes everything except the runtime `fetch` stub — **which is therefore load-bearing and must not be removed** — and content conveyed only through `aria-label`/`title`/`alt`/`::after`, which no careless change produces. Two of the review's own suggestions were wrong and were rejected after being run: a three-sentences-per-notice shape guard (the count is legitimately input-dependent) and a `SELF`-only sweep exclusion (two other gate files quote the banned strings too). Run the suggestion; do not adopt it on trust.
### R-238 | area: experience-attachments | parallel-safe: yes | automatable: partly

**Summary:** Every attachment on a project page can be downloaded again, under the name it was uploaded with, from a control that never leaves the tab order.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/experience/AttachmentPanel.download.test.js lib/supabase/experienceAttachments.download.test.js app/components/experience/AttachmentPanel.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.
2. Open a project page in the Professional Experience tab that has attachments of several kinds — at least one PDF or Office file (no inline preview) and one image or video (inline preview). Confirm EVERY card has a download control, not just the previewable ones.
3. Download a `.pptx` or `.xlsx`. Confirm the saved file opens, and that its name is the name it was uploaded with — not `<uuid>-<sanitized>`, which is what it is stored as.
4. Upload a file whose name is not plain ASCII and contains parentheses — `café report (v2).pdf` is the case this was built against — then download it. The saved name must be byte-identical to what was uploaded.
5. Tab to a download control with the keyboard and activate it with Enter. Confirm focus is still on that control afterwards and the tab order has not jumped.
6. With devtools' network tab open, download a large video and press the same control several more times while it is running. Exactly one request must be issued. The control must stay focusable throughout and show a spinner.
7. Fail a download deliberately (devtools offline, or delete the object in Supabase Storage and reload). Confirm an error naming that file appears on that card with a Retry, the row is not removed, and Retry succeeds once the cause is removed.
8. Fail a download on page A, then switch to page B and back. The error must be gone, not waiting there.

**Expected:** All four suites pass and the manual steps read as described.

**Until this shipped, an attachment was write-only for every kind except image and video.** Those two get a short-lived signed URL purely so the card can preview them inline; `app/api/experience/attachments/route.js`'s GET mints one for nothing else, so a PDF, a deck, a spreadsheet or a text file had no route back to the user's disk at all.

**There is deliberately no API route for this, and that is the load-bearing design decision.** `lib/supabase/server.js` builds its client from the anon key plus the caller's cookies — not a service-role key — so a route handler's storage read would run under exactly the same RLS identity as the browser's and buy no privileged access. The same feature already reads these same bytes client-side at `ExperienceTab.js`'s Ask-AI path, the `resumes` bucket owner-scopes anything under `${uid}/...` via `auth.uid()::text = (storage.foldername(name))[1]`, and `route.js` already spreads the whole row (`{ ...row, kind, url }`) so `storage_path` is on the wire today. Adding a route would have meant serving user-uploaded bytes from this app's own origin — a new, permanent XSS obligation (`Content-Disposition` plus `nosniff` plus a CSP sandbox) taken on for no security gain.

**`createSignedUrl(path, ttl, { download: name })` must never be used to name a download.** It is the obvious shortcut and it is broken: `@supabase/storage-js` builds the query with `URLSearchParams`, which percent-encodes, and then wraps the entire URL in `encodeURI`, which escapes the `%` signs a second time. Measured — `café report (v2).pdf` arrives as `caf%25C3%25A9+report+%2528v2%2529.pdf`. Passing the name to the anchor's `download` property instead has no encoding layer at all, which is what step 4 checks and what `"round-trips a name that is not plain ASCII"` pins.

**The re-entry guard is a `useRef`, and a `useState` guard cannot work.** A state update is not visible to a handler already queued in the same tick, so a real double-tap fires two reads — two files in the downloads folder and two `triggerBlobDownload` calls racing over one name. `scheduleDelete` in the same file guards identically. **The test for this only works if both clicks land inside a SINGLE `act()`**: two separate `await act()` calls let React flush the first click's state before the second arrives, so a broken state-based guard passes. That distinction is the whole test.

**Nothing is disabled while a download runs.** `aria-busy` plus a spinner carries the in-flight state instead. A control that leaves the tab order at the moment it is used throws keyboard focus to the top of the document, which this repo has shipped before.

**Success is announced exactly once, and a second "Downloading…" announcement would silently break it.** `announcedText` appends its invisible toggle on ODD sequence numbers, so a path that bumps the counter twice per cycle returns to the starting parity, renders a byte-identical string, and React's reconciler leaves the text node untouched — no DOM mutation, so no live region fires. The failure mode is nasty: it is silent from the SECOND download of any file onward, which is the ordinary repeat case. Note this is the reconciler, not a `setState` bailout — `bumpAnnouncement` returns a fresh object every call, so the `Object.is` bailout can never fire here.

**Three defects lived in the seam between the new handler and machinery 300 lines away, and every one of them shipped green.** They were found by a review pass over the whole diff, not by any test:
- `downloadErrors` was the one per-id map the `pageId`-change effect never cleared, even though the comment above that effect is a written specification of exactly why it must be. A failed download on page A was still sitting there on return, and — since ids are unique per attachment but scoped to nothing the panel enforces — could render against a DIFFERENT page's attachment sharing that id, naming the wrong file, with a Retry wired to the other one.
- The handler had a `finally` and no `catch`, alone among the file's six async handlers. `createClient()` throws when the public env vars are missing and `triggerBlobDownload` touches `URL.createObjectURL` and `link.click()`; either throw merely rejected an `onClick`'s promise, leaving the user with no file, no alert and nothing said.
- The post-`await` writes ignored `pageIdRef`, which exists for precisely this and which `uploadFile` already uses. A download is the slowest async operation in the panel — seconds for a 100 MB video — so it is the MOST likely to resolve after a page switch, announcing into a page it has nothing to do with. Note the page-switch clear does not cover this: the write lands after that effect's deferred clear has already run.

**The gate was proven by mutation, not by being green.** Ten mutants were generated against the shipped source — removing the page-switch clear, replacing each `pageIdRef` guard with a constant, deleting the `catch`, pinning the error `seq` to a constant, swapping the ref guard for state, saving under `storage_path` instead of `name`, overriding the alert's `role`, dropping `aria-busy`, and collapsing every control's accessible name to a bare "Download". **All ten were killed by their own named test**, and the source was verified byte-identical afterwards. Two of those tests did not exist before the mutation pass: the throw branch was entirely ungated, and no test failed the same file twice to prove the error `seq` was live.

**One vacuous test was caught before hand-off and is worth remembering.** "Renders each one as a real, enabled control" iterated the download buttons and asserted each was a `BUTTON`, not disabled, and in the tab order — and passed against a panel with no download control at all, because a `for` over an empty list satisfies every assertion inside it. It now asserts the count first.

**`vi.restoreAllMocks()` does not clear a `vi.fn()` from a `vi.mock` factory.** It restores only `vi.spyOn` registrations, so `triggerBlobDownload`'s call history survived every test in the file and later `not.toHaveBeenCalled()` assertions failed against a perfectly correct component. `BulkActionsBar.test.js` already knew this and resets the same helper. The reset must be `mockReset`, not `mockClear` — two tests install a throwing implementation, and `mockClear` leaves it in place to blow up everything after them.

**`AttachmentPanel.js` finished at 947 lines against a 950 tripwire.** The next thing added to it must extract the per-card render body into its own component first. An extraction there needs a wiring test that mounts the PANEL against a mocked card and asserts it rendered once per attachment — a refactor in this repo has already shipped with the new component fully tested and never imported.

**Recorded and deliberately not done:** `triggerBlobDownload` lives in `lib/document/docx.js`, which imports JSZip at module scope, so the Experience tab now ships a zip library it never calls; that helper also revokes its object URL outside a `finally`, so a throwing `click()` leaks it; `ExperienceTab.js` still hand-rolls the same storage read that `downloadAttachmentBlob` now owns; and all three Retry buttons in this panel unmount themselves on click, dropping focus to `<body>`. Each is a separate chunk.
### R-239 | area: document-download | parallel-safe: yes | automatable: yes

**Summary:** `triggerBlobDownload` lives in its own module, and no longer leaks an object URL when the click it makes throws.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/document/download.test.js app/components/experience/BulkActionsBar.test.js app/components/experience/AttachmentPanel.download.test.js`.
2. Confirm `lib/document/download.js` exists and holds the function, and that `lib/document/docx.js` re-exports it.
3. Download a tailored résumé from the main tab, a deck from the Experience tab's bulk actions, and an attachment from a project page. All three must still save.

**Expected:** All three suites pass and every download still works.

**The defect was six callers deep and had no test at all.** `URL.revokeObjectURL(url)` and `link.remove()` sat after `link.click()` with nothing guarding them, so a throwing click leaked the object URL and left a stray anchor in the DOM. An object URL keeps its whole Blob alive for as long as the mapping exists, and in a single-page app that never unloads that is the rest of the tab's life — a user retrying a failing 100 MB video download a few times pins hundreds of megabytes. `lib/copilot/sessionLogArchive.js` had already fixed the same idiom in its own copy, with a comment saying why, and the canonical helper was never brought along.

**It had no coverage because every test that touches a caller MOCKS it.** jsdom implements neither `URL.createObjectURL` nor a real download, so `BulkActionsBar.test.js` and `AttachmentPanel.download.test.js` both stub it — correctly, for their own purposes. That left the function itself as the one part of the download path nothing exercised. `lib/document/download.test.js` installs `URL.createObjectURL`/`revokeObjectURL` itself and patches `HTMLAnchorElement.prototype.click` to capture the anchor, since the helper removes it before returning.

**The re-export must be the SAME function object, and a test asserts it.** Six callers still import from `docx.js`. A wrapper, or a leftover copy of the old body, would leave every one of them on the unfixed version while the new tests stayed green — the exact shape of a fix that ships inert.

**The bundle argument that motivated this was wrong, and is recorded so nobody re-derives it.** The stated reason was that the Experience tab pulls JSZip through `docx.js` for a function that has nothing to do with DOCX. It does not follow: `lib/experience/pptxWriter.js` imports JSZip directly and `BulkActionsBar.js` imports pptxWriter, so that tab has shipped JSZip since the deck feature. `BulkActionsBar.js` also needs `sanitizeFileNamePart`, which stays in `docx.js`, and `app/page.js` imports `docx.js` into the root bundle regardless. The move was kept for cohesion and to give the fix a testable home — not for bytes.

### R-240 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** Ask AI reads an attachment's bytes through the shared store function instead of its own copy of it.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/experience/ExperienceTab.test.js`.
2. Open a project page with a text, image, PDF and video attachment and use Ask AI. The first three must reach the chat as real files; the video must not.

**Expected:** All 22 tests pass and the manual step reads as described.

**`ExperienceTab.js` hand-rolled the read that `downloadAttachmentBlob` owns**, with a second `"resumes"` literal and a second piece of error handling. Both copies were correct, which is exactly why it survived — two correct copies drift apart on the next change to either.

**The test wraps the REAL store function in a spy rather than stubbing it.** The behaviour assertions ("the bytes reach the chat", "the video's bytes are never downloaded") pass just as happily against an inline copy — they did, for as long as one existed — so on their own they could never have caught the helper being added, being correct, and never being wired up. The spy answers the one question they cannot: was the shared module asked? Because the wrapper still runs the real implementation against the mocked Supabase client, the end-to-end path is still tested at the same time.

**Video exclusion is unchanged and still happens BEFORE any read is attempted.** The filter on `DOWNLOADABLE_ATTACHMENT_KINDS` and `storage_path` is byte-for-byte what it was. A shared helper must not become a way for video bytes to reach the model.
### R-241 | area: experience-attachments | parallel-safe: yes | automatable: partly

**Summary:** One attachment's card is its own component, and none of the panel's three Retry buttons throws keyboard focus to the top of the document any more.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/experience/AttachmentCard.wiring.test.js app/components/experience/AttachmentPanel.retryFocus.test.js app/components/experience/AttachmentPanel.test.js app/components/experience/AttachmentPanel.download.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.
2. On a project page with several attachments, confirm nothing about a card looks or reads differently from before: same file name, kind and size line, same notes field, same Download and Delete controls, same inline preview for image and video.
3. Make a notes save fail (devtools offline), then Tab to the Retry and press Enter. Focus must land in that attachment's notes field. Press Enter on Retry again while still offline — the alert and its Retry must survive being focused, and must not vanish as you tab onto them.
4. Make a download fail, Retry with the keyboard, and confirm focus returns to that row's own Download button — the row that failed, not the first row.
5. Make a delete fail, wait out the five-second undo window, then Retry. If it fails again, focus stays on that row's Delete button. If it succeeds, focus moves to the NEXT row's Delete button — or the previous row's if you deleted the last one, or the upload control if it was the only attachment.
6. Start a delete Retry on a slow connection, then click into a different attachment's notes field and type. When the delete resolves, the caret must stay where you put it.
7. Start a delete Retry, then switch to a different project page before it resolves. Nothing on the new page may be removed, and focus must not jump.

**Expected:** All five suites pass and the manual steps read as described.

**The extraction had to come first, and its test is about the CALLER.** `AttachmentPanel.js` was 947 lines against a 1000-line ceiling and the focus fix could not fit. `AttachmentCard.js` took the per-card render body out (947 → 802). `AttachmentCard.wiring.test.js` therefore asserts the shape of the PANEL — that it renders one card per attachment, each with its own row's data, and that the card's markup is genuinely gone rather than duplicated — because a refactor in this repo has already shipped with three new components sitting beside their caller, fully tested and never imported. Piece-level tests structurally cannot catch that: they import the piece directly.

**Its line-count assertion is a CEILING, not a shrink-proof, and that distinction was learned the hard way.** It was first written as "under 880" against the freshly-extracted 802-line file. The focus fix then legitimately added ~80 lines, and the gate started failing for a correct change — at which point the temptation is to shave comments to hit a number, which is precisely how a useful assertion gets deleted by someone who reasonably concludes it is noise. The real proof that the markup moved is the assertion that no card is built inline. The number exists only to stop the file drifting back toward 1000 unnoticed.

**All three Retry buttons unmounted themselves on click.** Each handler cleared its own per-id error entry as its first synchronous act, which removed the Alert — and the Retry inside it, which is the element the user is standing on. Focus fell to `<body>`. Inherited by all three from the notes and delete alerts; gated now because the panel has since grown an explicit rule that a control must never leave the tab order at the moment it is used.

**The notes Retry is the one with a second, invisible trigger, and the fix is in `saveNotes`, not in the focus code.** Once a Retry puts the caret into the notes field, the next Retry is pressed from inside that field — and a browser moves focus to the button on MOUSEDOWN, firing `focusout`, which runs the very same `saveNotes` that clears the error. The alert and the button being pressed unmount before mouseup, the click never lands, and focus falls to `<body>`: the exact defect this work removes, reappearing on every retry after the first. Tabbing to the Retry does the same. So a notes error is now cleared only when its PATCH actually SUCCEEDS. `removeAttachment` and `downloadAttachment` still clear up front, and that stays correct for them — a React `onClick` fires after mouseup, so their click has already landed by the time the alert goes.

**The delete Retry is the only one whose focus target is decided after an `await`, and that makes it the only one that can steal focus.** A success removes the very row the click happened on, so the target cannot be chosen at click time. The consequence is that it can land seconds later, by which point the user may be typing somewhere else — and since leaving a notes field saves it, an unconditional `focus()` would also fire a PATCH of a half-typed note. Those requests therefore carry `ifLost`, and the effect honours them only when focus is genuinely unattended (`document.activeElement` is null, `<body>`, or disconnected).

**Gating EVERY focus move that way is wrong, and was caught by a test rather than by argument.** Once the notes alert survives a retry, the Retry button is still connected and focused when the effect runs, so a blanket "only if focus was lost" check drops the request and focus never reaches the notes field. The remediation agent tried the literal instruction, watched `puts focus on that attachment's notes field` go red, and carried the gate on the request instead. Requests set synchronously inside their own click stay unconditional — moving focus is what the user just asked for.

**A focus request is consumed exactly once.** Left pending when its target does not exist, it re-fires on every later render — and `onNotesInput` calls `setAttachments` on every keystroke, so the last target would be re-grabbed once per character and typing into a notes field would become impossible. It is now always cleared, with a terminal fallback to the upload input so an unresolvable request cannot leave focus on `<body>`.

**`pendingFocus`, the three ref maps and `removeAttachment`'s post-await writes all joined rules the panel already had.** The `pageId` effect wipes them, and `removeAttachment` now captures the pageId it started under, exactly as `uploadFile` and `downloadAttachment` do. Without those, a Retry resolving after a page switch removed a row from the new page's list, announced the old page's file name into its live region, and planted a focus request that could land on an unrelated attachment sharing the same id.

**Known and deliberately NOT fixed here:** switching pages leaves the previous page's last status announcement sitting in the live region — `statusAnnouncement` is set legitimately by `scheduleDelete` at click time and nothing resets it on a page change. Same family as the per-id maps, pre-existing, and out of this change's scope; the page-switch test says so in a comment rather than asserting it. Recorded as its own follow-up.

**Four of the review's findings were real and one was not, and the difference was established by running it.** The claim that swapping `onDelete={scheduleDelete}` with `onRetryDelete={removeAttachment}` survives the suite is false: it fails 8 tests in `AttachmentPanel.test.js`, which drives the undo window through the real Delete button. Run an adversarial finding before adopting it, in either direction.

**`AttachmentPanel.js` finished at 898 against a 900-line ceiling.** Two lines of headroom is not headroom. The next change to this file extracts something first — the cheapest candidate is the six-line "delete this key if present" state reducer, which appears five times and would free roughly 18 lines.
### R-242 | area: experience-tests | parallel-safe: yes | automatable: yes

**Summary:** The ExperienceTab suite is split across two files sharing one fixture module, and it still detects exactly what it detected before.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/experience/ExperienceTab --no-file-parallelism`.
2. Confirm `app/components/experience/ExperienceTab.test.js` (the tab shell), `ExperienceTab.askAi.test.js` (the Ask AI wiring) and `experienceTabTestHarness.js` (shared fixtures, not itself a test file) all exist, and that all three are under 1000 lines.
3. Confirm `npm run build` still succeeds — the harness imports `vitest`, and it must never become reachable from application code.

**Expected:** 28 tests pass across the three ExperienceTab files, and the build is clean.

**`ExperienceTab.test.js` was 1096 lines, over this repo's 1000-line ceiling.** It is now 721 + 300 + 173.

**The fixtures were EXTRACTED, not copied, and that was the whole constraint.** `ATTACHMENTS`, `PAGE_ROOT`, `mockFetchWithAttachments`, `flush`, `click`, `jsonResponse` and the rest are shared through `experienceTabTestHarness.js`. Copying them into a sibling would have created two fixture sets obliged to agree forever — the "two halves tested against different assumptions" failure this repo has already suffered, where a producer's tests asserted the row it produced and the consumer's used a hand-written fixture that had a field the producer omitted.

**`vi.mock` factories and `vi.hoisted` cannot move, so only the mock BODIES did.** The `vi.mock` CALLS stay in each test file (they are hoisted above imports); each one delegates to `pageEditorMockModule()` / `attachmentPanelMockModule()` in the harness, so the mock components have exactly one definition.

**Two helpers close over per-file state and are exported as FACTORIES for it.** `container` and `root` are reassigned in each file's own `beforeEach`, so `domHelpers(getContainer)` and `makeRender(getRoot, Component)` take GETTERS, never the values. Each file binds its own copies, which is what let every call site stay byte-identical:

```js
const { buttons, liveRegion } = domHelpers(() => container);
const render = makeRender(() => root, ExperienceTab);
```

Pass the value instead of a getter and every test silently queries the first render's detached container.

**Only the Ask AI file carries the Supabase mocks.** The hoisted `downloadMock`, the `lib/supabase/client` mock and the `experienceAttachments` spy moved with the tests that need them; no test left in the shell file goes near that path.

**A test-file refactor is exactly the change that can leave a suite green and permanently unable to fail, so this one was gated by a frozen ORACLE rather than by a passing run.** Before any edit, seven deliberate mutations to `ExperienceTab.js` were applied one at a time and the exact set of test NAMES each one killed was recorded to disk. After the split the same mutations were replayed and the same names had to die. Counting tests afterwards proves nothing — the same 22 names can all pass while gating nothing at all, which is what a dropped `vi.mock`, a helper closing over a stale container, or a diverged fixture would produce. The oracle covered both halves: Ask AI (video-bytes forwarded, shared store function bypassed, breadcrumbs blanked) and the shell (bulk actions per-id instead of per-root, delete not picking a next focus row, create and rename announcing nothing).

**A second, independent check proved the tests moved VERBATIM**: every `expect(` line and every `it`/`describe` name was extracted from the pre-split file and from the two post-split files, sorted, and compared as sets — 111 assertions and 35 names, none lost, none added. Relocation is invisible to that comparison; an edit is not.

**The oracle also exposed two PRE-EXISTING coverage gaps, neither caused by the split.** Both are recorded rather than fixed here, because adding tests during a split would have changed the very test set the oracle compares:
- **The bulk move's "expand the destination" is untested.** Disabling `if (destinationId) setExpandedIds(...)` in the BULK move handler kills nothing. The describe named "a move into a collapsed parent expands it and focuses the moved row" covers the SINGLE-page move, which is a different call site.
- **The announcement sequence bump is untested.** Freezing `seq` in `announce` kills nothing, including the test named "re-announces the count even when it repeats non-consecutively (3 -> 2 -> 3)" — because a non-consecutive repeat changes the TEXT between announcements anyway, so a DOM mutation happens regardless. The `seq` mechanism only matters for two CONSECUTIVE IDENTICAL messages ("Selection cleared" twice), and nothing exercises that.

**The harness lives under `app/` and imports `vitest`.** It is unreferenced by application code, so Next never traces it and the build is clean — but an accidental import from a component would break the build, which is why step 3 exists.
### R-243 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** A .zip can be attached to a project page, and adding it did not reclassify every Office document as an archive.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/experience/attachments.test.js lib/experience/pageContext.test.js app/components/experience/AttachmentPanel.test.js app/components/experience/AttachmentPanel.officeKinds.test.js`.
2. On a project page, upload a `.zip`. It is accepted, the card reads **Archive** with its own icon, and the upload box's own sentence says zip archives are allowed before you pick a file.
3. Upload a `.docx`, a `.pptx` and an `.xlsx` **from Windows**. All three must still read Text / Slides / Spreadsheet — NOT Archive.
4. Download the zip back and confirm it opens.
5. Press Ask AI on a page holding a zip. The pinned context must list the zip and say its contents were not read, and the zip's bytes must not be sent.

**Expected:** All four suites pass and the manual steps read as described.

**The whole difficulty is that every OOXML Office file IS a zip.** `.docx`, `.pptx` and `.xlsx` are zip containers, and Windows and several file managers report them with a generic `application/zip` or `application/x-zip-compressed` mime. This module's standing rule is mime-beats-extension, so mapping the zip mimes straight to a new `archive` kind silently reclassifies every Word, PowerPoint and Excel document uploaded from a Windows machine: they stop being read for the AI, and they start carrying a "contents not read" line that is false.

**The fix reuses the one precedent already in the file rather than inventing a second mechanism.** `AMBIGUOUS_SHEET_MIME` existed because Windows reports a plain `.csv` as `application/vnd.ms-excel` whenever Excel owns the file type. That single constant became `AMBIGUOUS_MIMES`, a deliberately short set: a mime in it is treated as a hint rather than as authoritative, and the EXTENSION wins whenever the extension has its own known mapping. `kindOf`'s structure is otherwise unchanged, so an UNambiguous mime still beats the extension — a file named `.zip` whose mime says `application/pdf` is still a pdf, and a test asserts it.

**Both halves are mutation-proven, not merely green.** Removing the two zip mimes from `AMBIGUOUS_MIMES` is the most likely careless edit here ("why is a zip mime in a list called ambiguous?"), and it is killed by "still calls a .docx a text file when the browser reports it as a zip" and "still calls a .pptx slides and an .xlsx a sheet when reported as a zip". Removing `zip: "archive"` from the extension table is killed by "accepts a .zip the browser reports with no mime type at all".

**An archive is inventory-only, and `pageContext.js` says so per line.** Nothing in this repo unzips anything and a zip's bytes are never handed to the model, so `archive` joins `slides` and `sheet` on the "contents not read" branch. It must NOT join `image`/`pdf`/`text`, whose bytes really are downloaded and attached to the same Ask AI request — disclaiming those would tell the model the opposite of what just happened. A test asserts a pdf sitting beside a zip is still not disclaimed, so a blanket disclaimer cannot pass.

**`archive` is deliberately absent from `DOWNLOADABLE_ATTACHMENT_KINDS`** in `ExperienceTab.js`, so a zip's bytes never reach the chat route. That set is `["text","image","pdf"]` and adding an opaque binary to it would hand the model bytes it cannot read.

**`.rar` and `.7z` are still refused, and that is asserted.** The request was zips. A pre-existing positive control named "does not widen the door for anything else" used `archive.zip` as its example of something unsupported; that example was MOVED to `.rar` rather than deleted, so the control still proves the door did not swing open while no longer contradicting a shipped feature. Deleting it outright would have been the easy way to a green suite and would have removed the only guard on that intent.

**Size: an archive uses the same 25 MB cap as everything that is not video.** Zips of real project artifacts will hit that ceiling sooner than most kinds; raising it is a deliberate product decision and has not been made.
### R-244 | area: experience-attachments | parallel-safe: yes | automatable: yes

**Summary:** The attachments live region stops describing the page you just left, and the seven-times-repeated state reducer behind it is now one tested helper.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/experience/ --no-file-parallelism`.
2. On a project page with attachments, download or delete one, then click to a different project page. The status line must be empty — it must not still read `Downloaded "<the other page's file>"`.
3. Download something on the new page. It must still be announced, and downloading the same file twice in a row must still announce twice.

**Expected:** All 17 suites pass and the manual steps read as described.

**The live region was the last piece of per-page state nobody reset.** It is written by `scheduleDelete` ("Removed …"), `undoDelete` ("Restored …"), `uploadFile` ("Added …") and `downloadAttachment` ("Downloaded …"), and the `pageId` effect that already wipes `notesErrors`, `deleteErrors`, `downloadErrors`, `pendingDeletes` and `pendingFocus` simply never included it. The long comment above that effect is the file's own statement of why this class of state must be cleared; the region now joins it.

**The sequence number is preserved rather than reset, and the reason is narrower than it looks.** `announcedText` appends an invisible character on ODD sequence numbers, which is what makes two consecutive identical messages produce a real DOM mutation. Resetting the counter to 0 could in principle let the first announcement on the new page render byte-identical to what the region last held on the old page — and if those two updates were ever coalesced into one render, the reconciler would leave the text node untouched and the announcement would be silent.

**That coalescing is not reachable today**, and the code says so rather than implying a fix for a live bug: the clear runs in a deferred `setTimeout(0)` on the page change, and the next announcement needs a fresh user action, so the empty string always renders in between. Preserving the counter is defensive, costs nothing, and stays correct if either of those two facts ever changes. It is deliberately not covered by a test, because a test for it would have to fake a coalescing the public surface cannot produce.

**Seven copies of the same six-line reducer became one helper, and that refactor had a real risk of its own.** The body

```js
if (!(id in prev)) return prev;
const next = { ...prev }; delete next[id]; return next;
```

appeared seven times: in `clearPendingDelete`, and in the clears for notes errors, delete errors (twice), download errors (twice) and the in-flight download map. Collapsing them freed 23 lines, which is what made room for the fix — the file was at 898 against a 900-line ceiling enforced by `AttachmentCard.wiring.test.js`.

**The dangerous half is the bail-out, and a mutation run proved it was unpinned.** Returning the SAME object reference when the key is absent is what lets React skip the update entirely; most of these calls are clearing an entry that is not there, since every fresh attempt at a notes save, a delete or a download clears an error that usually does not exist. Deleting that one line — so the helper always spreads — left the ENTIRE experience suite green, because nothing observable changes; only the number of renders does. `withoutKey` is therefore exported (the precedent is `UNDO_WINDOW_MS`, exported for the same reason) and `AttachmentPanel.withoutKey.test.js` asserts reference identity with `toBe`, not `toEqual` — `toEqual` would pass against a copy, which is the exact mutation the test exists to catch.

**Recorded, not asserted:** `withoutKey` uses `key in map`, which walks the prototype chain, so `"constructor"` would take the copying branch. `lib/experience/attachments.js` guards that hazard with an `ownLookup` helper and needs to — its keys come from user-supplied filenames and mime types. These keys do not: all seven call sites pass an attachment id, and those are uuids. Asserting it would mean requiring a behaviour change for an unreachable input, so it is written down in the test file instead, for whoever widens what these maps are keyed by.

### R-245 | area: experience-context | parallel-safe: yes | automatable: yes

**Summary:** The attachment inventory helpers are public, so a second feature can reuse the honesty rules instead of re-implementing them — and a public caller can no longer manufacture a line for a file that does not exist.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/ app/components/experience/ app/api/experience/ --no-file-parallelism`.
2. Press Ask AI on a project page holding several kinds of attachment. The pinned context must read exactly as it did before: a PDF and an image with no disclaimer, a deck, spreadsheet or zip marked "contents not read", and a video saying whether it was transcribed.

**Expected:** All suites pass and the pinned context is unchanged.

**Why they became public.** The live meeting copilot builds context spanning MANY pages, so it cannot use `buildPageContext`, which budgets and returns one blob for ONE page. It still has to produce inventory lines under identical rules. This module is the single enforcement point for "a line reads ONLY name/kind/notes/transcript — never bytes, `storage_path` or `url`", and a second implementation would be a second place for that to drift. The drift would not look like a bug; it would look like a model confidently quoting a file nobody read.

**The guard, and the precedent that demanded it.** `formatAttachment` now returns `""` for anything that is not a usable attachment — not an object, or no name after trimming. Its own defaults previously turned `null` into `- Untitled file (file)`: an inventory line for a file that does not exist. Inside this module that was unreachable, because `formatAttachments` filtered its list first.

`lib/copilot/groundingNotice.js` records what that reasoning cost last time. `submittedDocsClause` was module-private with exactly one caller that always checked `hasResume || hasCoverLetter`, so the `(false, false)` case was unreachable and a missing branch was harmless — until it became a public `lib/` export, at which point it silently returned a clause claiming a document had been sent when neither existed. **A public export cannot promise that its one careful caller stays its only caller.**

**`formatAttachments` did not already drop empty strings.** Its filter checks object shape (`entry && typeof entry === "object"`), which passes `{}` and `{ name: "   " }` — objects, but not usable attachments. With the guard returning `""` for those, a `.filter(Boolean)` was added before the join so a blank line can never land inside an inventory.

**Nothing a valid attachment produces changed**, and the existing tests are what prove it: they pin the exact line text for every kind, the video wording, the slides/sheet/archive disclaimer, the field caps and the truncation notices.

### R-246 | area: copilot-session | parallel-safe: yes | automatable: yes

**Summary:** `CopilotSession` can run without attributing speakers at all, for a meeting on one shared microphone — and the interview path is byte-for-byte unchanged.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/ --no-file-parallelism`.
2. Start an interview session in-person and confirm it behaves exactly as before: turns labelled You/Them, the "still working out who is who" behaviour intact, and the provider-cannot-diarize warning still appearing when it applies.

**Expected:** All 91 copilot suites pass, and in-person interview behaviour is unchanged.

**Why a meeting must not use `speakerIdentity.js`.** That module decides who "you" is with `youScore = wordShare - 2 * questionRate`, justified in its own header by "the candidate talks the most and asks the fewest questions; the interviewer does the opposite". In a work meeting the user is very often the quietest person present and very often the one asking, so the formula is not slightly off — it is systematically backwards. The same header records that a naive version elected the wrong speaker twice on real audio and then went **silently deaf**, because question detection routes off the identity gate rather than off the display label.

**"Just don't call it" was not available**, which is why this is a code change rather than a client-side choice: the constructor built the identity unconditionally for `source === "inperson"`, and two methods called it on every frame and every assembled utterance. A null instance throws.

**The new option is `attributeSpeakers`, defaulting to `true`.** That default is the entire safety argument: `session.test.js`, `session.inperson.test.js` and `session.silent.test.js` all construct without it, so they exercise the old path and are the real regression gate. Six seams changed — the constructor's identity, `_resolveSpeakerLabel`, `_emitUtterance`, `_handleInPersonFrame`'s assembly key, the `diarize` request, and the warning.

**With attribution off, a turn is `"room"` — not `"them"`.** One shared microphone is one unattributed voice, and `"them"` would be a claim about who spoke. `evaluate` is unconditionally `true`, because there is no conservative gate to consult and a meeting has no "the other person asked this" notion; every turn is potential material.

**Diarization is not requested rather than requested-and-discarded.** Asking a provider to separate speakers still costs the request and, on Deepgram, selects a different model.

**The warning is suppressed, not deleted, and a test pins the difference.** Its wording names live pace and filler-word readings "for you" — meaningless in a meeting, and describing a degradation that has not happened. The default path must still emit it, so the test asserts both directions.

**`tab` and `system` are inert under the option**, and a test says so rather than assuming it. Those paths open two independent sockets and never built an identity, so their separation is structural; the risk being guarded is a future change collapsing them to one voice.

### R-247 | area: meeting-copilot | parallel-safe: yes | automatable: yes

**Summary:** The meeting copilot's shared contract — what an insight is, how it stays identified across reads, and what may be claimed about where it came from.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/meeting/insightContract.test.js --no-file-parallelism`.

**Expected:** All 27 tests pass.

**It lands before anything else because three consumers normalize through it**: the Gemini-backed insights route, the deterministic no-LLM path, and the client. They cannot drift on these rules, because all three call these functions.

**The load-bearing rule is the attribution downgrade.** An insight claiming `source.kind === "page"` for a `pageId` that was NOT in the context actually assembled for that call is rewritten to `{ kind: "model", pageId: null, pageTitle: null }`, keeping its text. A model handed four pages will cite a fifth it remembers, or invent a plausible id. Letting that through puts "your page X says…" on screen for a page that contributed nothing — and the user can then no longer tell their own notes from the model's invention, which is the entire reason a source is shown. A non-page source may never carry a page id either; that is the same claim through the back door.

**The insight is kept when its attribution is stripped.** A mis-attributed point may still be worth saying; what is not allowed is the false provenance.

**Ids are a deterministic FNV-1a hash of normalized text**, not a uuid, a timestamp or a counter. They have to be stable across separate reads for two reasons: the client accumulates insights over a meeting without showing the same point twice, and `knownInsightIds` goes back to the server so a read can skip what is already on screen. Normalization folds case, surrounding whitespace and one trailing run of punctuation, because a model asked twice rephrases trivially and those are the same point to a human. `Math.random`/`Date.now` are also unavailable in some execution contexts here.

**`changed` on a topic is computed in this module, never asked of the model.** A model asked "did the topic change?" says yes far too often, and the UI uses this to decide whether to interrupt the user mid-meeting with a new topic.

**Everything else is defensive because this runs live**: an unusable text, an unrecognised insight kind, a duplicate within one read, an id the client already has, more insights than the cap, and a model returning `undefined`, `null`, a bare string or an array of junk — none may throw into a running meeting.

**Both vocabularies are asserted exactly, with `toEqual`.** A lower bound cannot detect an ADDED source kind, and adding one is the single direction this contract can quietly go wrong.

### R-248 | area: meeting-copilot | parallel-safe: yes | automatable: partly

**Summary:** The meeting copilot's server, client pipeline and views — transcription, the debounced insight loop, the knowledge-base context, and the no-LLM path.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/meeting/ app/meeting/ app/api/meeting/ --no-file-parallelism`.
2. Confirm `npm run build` lists `ƒ /api/meeting/insights` and `ƒ /api/meeting/save`.
3. With a real meeting running, confirm insights arrive after a pause in speech and not during a burst, and that the nudge control returns one immediately.
4. On the embedded engine, confirm insights still arrive, that none of them is a composed "point" attributed to the model, and that the notice still says audio reaches the speech provider on every engine.

**Expected:** All suites pass; the manual steps read as described.

**Four defects were found by review AFTER every suite was green, and every one lived in a seam between two agents.** Each is now pinned.

**The route analysed the OLDEST speech, permanently.** `slice(0, MAX_TRANSCRIPT_CHARS)` keeps characters 0–8000 — the START of the meeting. The client sends a window of recent turns, which passes 8000 characters after roughly a hundred turns, so from then on every read saw only the opening minutes while the prompt said "TRANSCRIPT SO FAR (most recent last)". An hour-long meeting would have frozen its topic and its insights on the opening small talk while still spending a model call every twenty seconds. It now keeps the END and opens the window on a turn boundary. Nothing caught it because no test ever sent an over-length transcript.

**`topic` was an object on the wire and a string everywhere downstream.** The route returned `normalizeTopic`'s whole `{ text, changed, confidence }`; every consumer treated it as a string. The heading read "Not yet identified" for the entire meeting, and the stored object went back to the server as the literal `"[object Object]"` — pasted into the prompt as the previous topic AND concatenated into the page-ranking query, where "object" became a scoring term. **Two client test files pinned `topic` as a string, the route test pinned it as an object, and all three were green.** That is what a contradiction between two agents looks like from inside either one. The wire now carries `topic` (string), `topicChanged` and `topicConfidence`, and `changed` stays server-computed — a model asked "did the topic change?" says yes far too often.

**After a dropped socket, pressing Start did nothing.** `start()` early-returns when a session ref exists, and nothing cleared that ref when a source errored — so the recovery path the hook's own header documents was inert, silently, until the user found and pressed Stop. There is no reconnect anywhere in the STT layer, so this WAS the recovery path. The ref is now cleared when the session goes terminal, and the accumulated transcript still survives it.

**The embedded engine counted the speaker label as meeting content.** The transcript reaches the local path with `You: ` / `Others: ` prefixes, and the tokenizer matches four-plus-letter words, so `"others"` was the most frequent term in any call-mode meeting. The topic became literally "others, …", and a page whose only overlap with the conversation was that word scored above zero and was surfaced as worth pulling up. Labels are stripped once before term counting; the prompt still shows the model the labelled transcript.

**The attachment inventory was never fetched at all.** `listPages` returns rows from `experience_pages`; attachments live in `experience_attachments`, and the route never queried them. So `page.attachments` was always undefined, no attachment was ever mentioned to the model, and the honesty notice could never fire — an apparatus fully unit-tested against a page shape the data layer never produces. A single `user_id`-scoped `listAttachmentsByPage` query now grafts them on, with a per-page cap and an "N attachments not listed" notice.

**The honesty rule that made all of this worth doing.** `pageContext.js` disclaims "contents not read" for slides, sheets and archives and deliberately NOT for images, PDFs or text — because in the Ask AI flow those bytes really are attached to the same request. A meeting read sends no bytes, so reusing `formatAttachment` (which is required — a second copy is how those rules drift) inherits a silence that is false here. A blanket sentence states that no attachment contents were read. Without it the model is handed `- Q3 board deck.pdf (PDF) - notes: revenue slide` and will say out loud, in a real meeting, "your board deck shows revenue up 12%."

**The two normalization paths are deliberately asymmetric, and unifying them is a bug.** The model path validates a page citation against the pages that fitted the prompt budget; the local path validates against the pages it actually read. An earlier version applied the budget to both, which downgraded the local path's verifiably-true citations to "the model made this up" — the exact opposite of the truth, and it stripped the one thing that makes the no-LLM path worth having. The comment names re-unification as the bug it prevents, because "for symmetry" is exactly how it would come back.

**The embedded path may never claim authorship.** The invariant is `source.kind` is never `"model"` — not, as an earlier draft had it, that it never emits `kind: "point"`. Quoting a user's own bullet verbatim is surfacing, not composing, and labelling it a "Gap" on screen was simply wrong. It can point at what the user wrote and at what the room asked; it cannot compose.

**A near-miss worth recording.** During its own mutation check an agent rewrote a source file with PowerShell `Out-File -Encoding utf8`, which re-encoded it and corrupted every non-ASCII character — including the `[-*•–—]` bullet-detection character class, which would have silently stopped recognising three of four bullet markers. It restored from a byte-exact backup and reported it. Verified independently afterwards: the regex is intact and the tree carries no replacement characters. **Never write a source file in this repo through a shell redirection.**

### R-249 | area: meeting-copilot | parallel-safe: yes | automatable: partly

**Summary:** The meeting copilot is on the Professional Experience view, and a finished meeting becomes an ordinary page in the knowledge base.

**Steps:**
1. From `hello-world`, run `npx vitest run app/meeting/ app/components/experience/ lib/meeting/meetingPage.test.js --no-file-parallelism`.
2. Open the Professional Experience tab. A single "Start a meeting" control is visible even with NO pages yet. Pressing it starts recording — one click, no dialog, no source picker first.
3. Talk. The transcript fills; after a pause, insights appear. Press the nudge control and one arrives immediately.
4. Press Stop. A new page appears in the tree, selected, titled after the topic and the date.
5. Open that page. The topic and the discussion points are at the top; the transcript is below, under a heading saying it is a recording of several people. Each point that came from one of your pages names it.
6. Confirm the new page is an ORDINARY page: it is not badged as generated, and its material is eligible for résumé tailoring and interview answers like any other page.

**Expected:** All suites pass and the manual steps read as described.

**The saved meeting is deliberately NOT marked `generated_kind`.** User instruction, verbatim: *"don't distinguish between my experience and not my experience when using meetings or pages to tailor resumes or respond in interviews. if it's recorded, it's because it's my exp and i want it used."* Both `lib/copilot/projectStories.js` and `lib/experience/tailorSources.js` skip any row with that column set, so marking it would have made the feature useless for its main purpose while looking correct. This reverses the architecture's own recommendation, on the user's explicit direction.

**That moves the honesty burden onto the page's SHAPE, and this is where it lives.** A transcript contains other people's words, and `/api/copilot/answer` instructs the model to speak project-page material as the candidate's own experience. So the body leads with the topic and the user's own discussion points — the part that is genuinely theirs and the part worth mining — and the transcript sits below under a heading that says plainly it is a recording of everyone in the room or on the call. **Nothing is withheld; it is labelled.** The research-page exclusion was deliberately NOT reversed on the same instruction: that filter exists because a research page is model-written web research whose claims a user "cannot defend in an interview and did not write", which protects the user rather than filtering them.

**A `"room"` turn is written into the page with no speaker label at all.** Not "Room:", not "Speaker:". One shared microphone genuinely cannot attribute a turn, and inventing an attribution inside a page that later becomes interview material is exactly the failure this whole feature has been avoiding. A call's two structural streams do get "You" and "Others", through the one shared `meetingSpeakerLabel` — `buildTranscriptText` was exported rather than reimplemented so that rule has one home.

**Stopping is one action and the microphone stops first.** `stop()` is called unconditionally and before anything that can fail; leaving the mic recording because a POST failed is the worst possible coupling, and a test asserts it. There is no confirmation dialog: the result is an ordinary editable page, so a dialog would tax the common correct case to guard a slip that costs nothing.

**A failed save keeps the entire meeting on screen and offers Retry.** There is no server-side record of a meeting until that POST succeeds — losing the transcript because the last step failed would be the most destructive thing this feature could do. State is cleared only once a save has actually returned a page.

**The page tree learns about the new page through a callback, and that is the whole mechanism.** `MeetingPanel` creates the page entirely server-side and cannot update `pages`, because that state lives in the `useExperiencePages` instance `ExperienceTab` owns. This repo has already shipped this exact bug once — `BulkActionsBar` generates research pages and takes `onPagesChanged` for precisely this reason, its own comment saying it "cannot, without holding the page list itself, update `pages` in place". `onMeetingSaved` is **hard-called, never `?.()`**: optional chaining on a callback converts a wiring bug from a loud crash into a silent no-op, and this repo has lost a feature to that before.

**Two anti-inert tests exist because a refactor here has already shipped dead.** `MeetingPanel.test.js` mocks the two views and asserts the panel actually renders them — every one of their own tests passes whether or not anything imports them. `ExperienceTab.meeting.test.js` does the same one level up, and additionally drives `onMeetingSaved` and asserts a second page-list GET is issued, which is the seam above.

**The panel is rendered OUTSIDE the zero-pages early return**, so a brand-new user with nothing in their knowledge base can still record a meeting — and their first page can be one.

### R-250 | area: meeting-copilot | parallel-safe: yes | automatable: partly

**Summary:** A meeting discussion point can be backed by reference links that are checked against pages a search actually visited — and anything that cannot be verified is refused, with the refusal stated on screen.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/llm/ lib/meeting/ app/meeting/ app/api/meeting/ --no-file-parallelism`.
2. In a live meeting, press the find-sources control on a point. **Verified links must actually appear** — the failure this feature shipped with was returning an empty list forever, so an empty result is the thing to be suspicious of.
3. Confirm the card says how many suggestions were refused, rather than silently showing a shorter list.
4. Switch to the embedded engine and press it again: it must refuse with a clear message, not fall back to links from the model's memory.
5. Two points must not share each other's links; a failed lookup must keep what is on screen and offer Retry; and the Retry on each card must be distinguishable by name.

**Expected:** All suites pass and the manual steps read as described.

**The premise: language models invent plausible URLs.** A fabricated link read aloud in a real meeting is far worse than no link, because the user stakes their credibility on it in front of colleagues. The default is refusal; a link earns its place only by corroboration.

## The defect that made this feature ship dead, and why every test passed

`normalizeReferences` compared the MODEL's url against the RAW grounding uris. Google's grounding metadata routinely holds `vertexaisearch.cloud.google.com/grounding-api-redirect/...` links, which are not comparable to a publisher url — so the comparison was false for every link, forever. Every card would have read "N suggestions could not be verified" with no links, and **that is indistinguishable from the model behaving badly**, so nobody would have suspected the code.

**All 100 tests passed because every fixture used the SAME array for both the model's links and the grounding.** Two agents built correct halves against opposite beliefs about one field, and each half's tests described a world in which the other could not exist. `referenceContract.test.js` now carries a fixture policy forbidding a self-grounded case, and keeps a `describe("the publisher world")` block so both readings stay covered.

**This could not be settled empirically here: there is no Gemini API key in this environment, so no grounded feature can be exercised locally.** The fix therefore works under BOTH readings.

**The pipeline is RESOLVE, THEN CORROBORATE**, in this order:
1. Every grounded uri is fetched and replaced by its `finalUrl` (a publisher uri resolves to itself; a redirect resolves to the real page). Unresolvable uris fall back to themselves rather than losing that evidence — `enrichArticles`' policy, taken exactly.
2. The model's links are de-duplicated by normalized key.
3. Each distinct link is corroborated against the RESOLVED set.
4. **The url that was corroborated is the url that ships.** There is no later step that can rewrite it.

That last point closes a second defect: the original code corroborated the model's url and then overwrote it with wherever a second fetch landed, unchecked — so a publisher 301 to a marketing homepage, a rebrand, or an open redirect on a grounded host became a link the user read aloud believing it was verified.

## What corroboration compares, and what it deliberately does not fold

`isGroundedHost` (six existing consumers, unchanged) asks "did the model touch this site". That is the wrong question here: a model that genuinely searched `react.dev` will happily cite `react.dev/learn/a-page-that-never-existed`.

`pageIdentityKey` compares **protocol, host, port, path and query**.

- **The query is part of the identity.** Folding it out let `en.wikipedia.org/w/index.php?title=Totally_Invented_Page` pass when grounding held `?title=Kubernetes`, and `youtube.com/watch?v=FAKE` pass for `?v=REAL`. For a query-addressed site the query IS the page. Only known tracking parameters (`utm_*`, `gclid`, `fbclid`, `ref`) are folded.
- **The path is case-SENSITIVE**, and this was reverted after first being folded. A path is case-sensitive by specification — only the host is not — and most documentation sites 404 on the wrong case. Folding it would mean a model citing `/Learn/X` against a grounded `/learn/X` passes and the user opens a dead link **having been told it was verified**. A real link honestly refused is the smaller harm, and it is the direction every other decision here leans.
- Host case, a leading `www.`, a trailing dot on the host and a doubled slash ARE folded — those genuinely resolve to the same resource.
- Userinfo (`user:pw@host`) is refused outright; scheme and port are compared, so a TLS downgrade or a surprise port cannot pass while the UI's host chip still reads the bare domain.
- Never `startsWith`: `/horizontal-pod-autoscale-walkthrough/` must not pass on the strength of `/horizontal-pod-autoscale/`.

## Refusal, honesty and the messages

Uncorroborated links are **dropped, not demoted** to plain text as `reconcileCitations` does — the user asked for something they could open and quote, so an unverifiable reference has no value as text either.

`dropped` counts **distinct** refused links. It originally incremented before dedup, so one fabricated url cited three ways (trailing slash / `www.` / `?utm=`) reported "3 suggestions could not be verified" — the sentence that exists to be honest about integrity, inflating.

Three distinct messages for three distinct facts: N refused, nothing citable found, and no search happened at all.

## The cache, which took three corrections

1. **The raw insight sentence**, copied from `techwatch/lifecycle`'s global-key reasoning. That does not transfer: that route keys on a technology id, while an insight is a sentence about ONE meeting. It would essentially never hit — defeating the only reason to cache — and it wrote private meeting content into a shared, non-user-scoped key under a comment claiming it was "the same fact for every user".
2. **Sorted significant terms** fixed the hit rate and destroyed word order but not the words. A "4+ characters, not a stopword" filter makes a term long, not generic: an employer name, a codename or a colleague's surname all clear it.
3. **A digest of the terms**, so equivalent questions share a bucket and nothing readable reaches shared storage. It is a 128-bit SHA-256 truncation, NOT `insightId` — that is a 32-bit FNV-1a whose birthday bound is ~77k in a shared week-long namespace, and a collision means one topic's links served for an unrelated one. `insightId` was deliberately not widened: it is a persisted identity clients round-trip as `knownInsightIds`, so widening it would invalidate every id in flight.

**The tokenizer keeps what distinguishes a documentation page.** `/[a-z0-9]{4,}/` dropped every token under four characters, so "Java 17" and "Java 21" shared a bucket — as did Kubernetes 1.29/1.31, React 18/19, HTTP/2 and HTTP/3, and, worst, "does support" and "does **not** support", because "not" is three letters. Someone would have asked about a Java 21 migration and been served the Java 17 docs from a global week-long cache, presented as verified. Versions are kept whole, negations are significant, and the cap takes terms in **document order** — sorting before slicing meant two long insights differing only past the twelfth term collided.

**A failed lookup is never cached.** The producer returns an error object that `cached()` treats as truthy, so one upstream blip poisoned that bucket for a week, globally, and Retry re-served the failure. It now throws, which `cached()` never writes.

**An empty term set skips the cache entirely** rather than hashing `""`, which would collapse every such request onto one shared bucket.

## The client and the card

**A 200 carrying `error` is a failure.** The route deliberately answers 200-with-error (progressive enhancement; a 5xx would read as the whole meeting breaking), and the client only checked `!res.ok` — so with Gemini down the card rendered the confident claim "this point could not be checked against search results" with **no error and no Retry**, and with the failure cached for a week it stayed that way.

**Each card's Retry names its own point.** `Retry finding sources for: <insight text>`. Two cards in an error state previously produced two identical "Retry" controls plus the list-level one — the exact bug that file's own comment forbids repeating.

**The interaction is audible.** `aria-busy` on the control, a named spinner, an accessible name that changes while loading (an `aria-label` overrides the visible text node, so the visible change alone was invisible), and a polite live region for progress and results. A failure is announced only by its `role="alert"`, never twice.

**The request has a deadline** (25s) and a timeout is an ordinary retryable failure. A grounded search plus several page fetches could otherwise sit on "Finding sources…" through the part of the meeting the user wanted it for.

**A stale lookup cannot land in a later meeting.** Insight ids are a deterministic hash of normalized text, so the same point in two meetings has the same id — an in-flight lookup from a previous meeting would otherwise resolve straight into the new one's state. Guarded by the session id, the same idiom the insight loop uses.

## Why links are not attached to every insight automatically

Nothing in this repo can produce a verified url quickly: a grounded search takes tens of seconds by this repo's own repeated measurement, and the insight loop's floor is 20 seconds. Doing it inline would mean either shipping fabricated citations or collapsing the loop to roughly one read per 30 seconds and making the panel visibly lag the room. So it is a per-point action, the same "progressive enhancement over an already-rendered panel" shape `techwatch/lifecycle` uses.

## Open question this raised about EXISTING features

If grounding uris really are redirects, then `lib/techwatch/lifecycleSearch.js` and `lib/feed/llmSearch.js` — which match on host only, presuming publisher hosts — have been silently discarding every result. That would also explain why `company-research` built title-token-overlap matching instead of comparing urls. **Unverified**: it needs one live grounded call, which this environment cannot make. Worth checking against a deployment before trusting either feature's output.

### R-251 | area: shared-text | parallel-safe: yes | automatable: yes

**Summary:** One `significantTerms` tokenizer instead of four — with the one copy that was never a duplicate deliberately left alone, and both halves of that pinned.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/ lib/meeting/ app/api/meeting/ --no-file-parallelism`.
2. Confirm `lib/copilot/projectStories.js` exports `significantTerms` and `overlapScore`, and that `lib/meeting/insightsLocal.js` and `lib/meeting/meetingContext.js` import them rather than defining their own.
3. Confirm `lib/copilot/resumeAnchor.js` STILL defines its own, with a comment saying why.

**Expected:** All suites pass and the three points above hold.

**Three copies were byte-identical; the fourth was not, and that is the whole story.** `projectStories.js`, `insightsLocal.js` and `meetingContext.js` each had the same lowercase-and-match-`/[a-z0-9]{4,}/g` tokenizer, with `overlapScore` beside it. Both were consolidated into `projectStories.js` — both, because leaving one duplicated keeps exactly the drift risk the exercise removes, and `overlapScore`'s body is a call to `significantTerms`.

**`resumeAnchor.js`'s copy is a deliberate variant and merging it would silently reintroduce a fixed bug.** It differs three ways: a **three**-character floor instead of four, a **stopword** filter, and a **bare-number** filter. Its own comment records the regression that last one exists for — an unrelated Barista role scored a match on a systems-design question purely because both mentioned "200". Folded into the shared four-character unfiltered version, all three protections vanish and nothing about the shared function's own tests would notice.

**The task described all four as "near-identical".** They are not, and the difference is invisible unless the bodies are read side by side. That is the general hazard in any de-duplication: the copies that look alike get merged, and the one that was carefully different gets merged too.

**So the guard pins BOTH halves.** `significantTerms.shared.test.js` asserts the merge really happened — no private `function significantTerms` remains in the two consumers, AND they import from the canonical home, because "no local copy" is equally true of a module that stopped using the tokenizer at all. It then asserts the holdout still EXISTS, still has its three-character floor and stopword filter, and carries its comment. `resumeAnchor.test.js`'s pre-existing "C3 regression" case pins what the variant DOES; this file pins that it is still there to do it.

**The shared implementation is checked against a frozen literal oracle**, inlined rather than imported — the pre-consolidation body, run over eight inputs. A test that merely called the shared function could never notice it drifting, because it would drift with it.

**Mutation-proven.** Three mutations, all killed by their own named tests: the shared tokenizer drifting to a three-character floor; a consumer quietly regrowing its private copy (killed by both halves of the anti-duplication pair); and someone "finishing the job" by merging `resumeAnchor` (killed by the holdout assertion).

**A test example that proved nothing, caught by the implementer.** The contrast case originally used `"200"` — three characters, which the shared tokenizer drops on its LENGTH floor and the variant drops on its bare-number FILTER. Same outcome, different reasons, no difference demonstrated. It now uses a four-digit run, which clears the shared floor and isolates the filter as the thing that actually differs. The implementer refused to edit the test and reported it, which is what surfaced it.

**Home choice.** `projectStories.js` is a feature module, and generic text helpers living there is a little odd — but it is where they were established, `insightsLocal.js` already imported from `lib/copilot/`, and crucially that file has **no imports of its own**, so importing from it pulls in nothing else. Dependency direction after the change is strictly one-way: `insightsLocal.js → meetingContext.js → projectStories.js`, with no cycle.

**Deliberately not consolidated:** `app/api/meeting/references/route.js`'s `cacheTerms` (a superset — stopwords, sorting and a cap, for a deterministic cache key), and `MIN_BULLET_LENGTH`/`BULLET_LINE_RE`, whose duplication `insightsLocal.js` already justifies in its own comment.

### R-252 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** The interview copilot picks the project pages that answer the question being asked, instead of whichever pages happen to sit at the top of the sidebar.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/knowledgeBase.test.js lib/copilot/projectStories.relevance.test.js app/api/copilot/answer/route.knowledgeBase.test.js`.
2. Read `buildKnowledgeBaseBlock` in `hello-world/lib/experience/knowledgeBase.js`.

**Expected:** All tests pass. Reported: "the sample answers and live interview answers need to do a much better job of drawing from the knowledge base."

**The cause was structural, not editorial.** `app/api/copilot/answer/route.js` called `buildProjectStoriesBlock(pages)` with **no question**. `lib/supabase/experiencePages.js`'s `listPages` orders by `position`, so the pages handed to the model were the top of the user's own sidebar tree, cut off at 6000 characters — byte-identical for every question ever asked, and for a knowledge base of any size most of it was permanently invisible. The résumé got 12000 characters and the job posting 20000 over the same request.

Ranking is now overlap of `significantTerms` against `title + body`, descending, ties broken by the page's own `position` — **the same rule `lib/meeting/meetingContext.js` already used**, which is now a fact rather than a wish: `rankMeetingPages` is `rankPagesByRelevance`, one function imported by both, so the two surfaces cannot disagree about what "relevant" means. The budget rose to 12000, at parity with the résumé.

**A page that does not fit whole is EXCERPTED by whole blocks, never cut mid-sentence.** Blocks are headings, paragraphs, list items and fenced code, each an exact contiguous substring of the page's own source; they are scored with the same overlap rule one level down, emitted in document order, with the heading a selected block sits under restored above it and `[…]` marking a gap. Two implementations were considered and rejected for verified reasons, both recorded here because both look right: `lib/text/summarize.js`'s `rankSentences` opens with `.replace(/\s+/g, " ")` and splits only on `[.!?]` followed by a capital, so a bullet list — which is what an engineering notebook page mostly is — collapses into ONE "sentence"; and `lib/experience/markdown.js`'s `parseMarkdown` carries **no source offsets**, so anything rebuilt from its tokens is a re-rendering that drops `**`, link hrefs and list markers, putting text in the prompt the user never wrote and silently breaking `BULLET_LINE_RE` for the deterministic engine.

**Packing STOPS at the first page that does not fit; excerpting SKIPS within a page.** The asymmetry is deliberate. `buildProjectStoriesBlock` could skip because its list was unranked, so skipping cost nothing; a *relevance-ranked* list that skips silently promotes a shorter, less relevant page over a longer, more relevant one and neither the model nor the user can tell. Inside a page the opposite holds: the page is already labelled an excerpt and its gaps are already marked, so taking a smaller lower-ranked block after skipping an oversized one misleads nobody and recovers real material.

**Eligibility is a REQUIRED parameter with no default, and that is what keeps two rules from being harmonised by accident.** The copilot passes `isEligiblePage` (archived *and* model-generated pages excluded — a research report spoken aloud as your own experience is a lie you do not know you are telling); the meeting copilot's rule is archived-only, because the user directed that any page in their tree is theirs. The module itself decides neither. Meeting notes saved back into the knowledge base deliberately do not set `generated_kind` (`app/api/meeting/save/route.js`), so they still flow into interview answers.

### R-253 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** The live answer ranks against what was actually said, not against the word "Them".

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/copilot/answer/route.knowledgeBase.test.js -t "speaker labels"`.
2. Read `stripLinePrefixes` in `hello-world/lib/experience/knowledgeBase.js` and the ranking query in `app/api/copilot/answer/route.js`.

**Expected:** All tests pass. **This defect was caught in design and never shipped, which is the only reason it is cheap.** Live mode sends `context` as a labelled transcript — `useLiveSession.js`'s `resolveTranscriptLabel` writes `"Them: "`, `"You: "`, or a user-entered display name. `significantTerms` tokenises `/[a-z0-9]{4,}/`, so `"them"` clears the four-character bar, appears once per interviewer turn, and becomes the single most frequent token in the whole ranking query — scoring every page containing the word "them" above zero and surfacing a page whose only overlap with the interview is a label this app itself wrote. Named speakers are worse, because they are unbounded.

`lib/meeting/meetingContext.js`'s `stripSpeakerLabels` exists for exactly this, one domain over, and **could not be reused**: it is anchored on `MEETING_LABELS` (`"Others"`/`"You"`), a closed set containing neither `"Them"` nor a display name. `stripLinePrefixes` is the label-agnostic generalisation — it drops a leading `"<prefix>: "` only when the colon is followed by a space, the prefix is at most five words and forty characters, and the prefix contains none of `.` `!` `?`. All four clauses have their own case: an earlier draft covered only the word count, and a mutation harness proved the other three could be deleted with every test still green.

**Stripping applies to the RANKING QUERY ONLY.** The prompt's own conversation block keeps its labels, because who said what is real information to a reader. A case pins that too.

**Why this needed its own case at all:** a poisoned ranking does not throw, does not warn, and still returns pages. It returns the wrong ones. Only an ordering assertion catches it, and only if both pages are asserted present first — comparing two `indexOf` results is satisfied by `-1` when a heading is missing altogether.

### R-254 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** A page is never named in the prompt without something under it, and never cited back unless it was really shown.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/knowledgeBase.test.js lib/copilot/pageCitations.test.js lib/copilot/answerLines.pageSources.test.js lib/copilot/sampleAnswerState.pageSources.test.js`.
2. Read `resolvePageSources` in `hello-world/lib/copilot/pageCitations.js`.

**Expected:** All tests pass.

**Each point now reports the page it came from**, using `lib/meeting/insightContract.js`'s proven pattern: every included page carries its own id in its prompt heading, the model is asked which page each point drew on, and **every returned id is validated against the ids actually shown**. Anything else becomes no citation at all. One rule is stricter than the meeting copilot's: the **title comes from what was shown, never from the model**, because a model that copies an id correctly and paraphrases the title produces a citation the user cannot recognise as their own page, and we already hold the real value. The deterministic engine reports its source directly and is deliberately NOT whitelist-validated — its citation is true by construction, and re-validating it against a prompt budget that was never applied would downgrade a real citation and tell the user the model invented a line they wrote themselves.

**A page heading with nothing under it is never emitted, and this one nearly shipped.** At a tight budget an early implementation emitted `## Payments migration (page id: p1) — excerpted; this page continues beyond what is shown here.` and no body: a real page title, a real citable page id, an explicit claim that the page continues, and zero content — an invitation to invent a project and attribute the invention to a page the candidate really has, which they then read aloud in an interview. The honest outcome is to say nothing about that page at all. `formatAttachment` takes the same position when it states in words that a video was not watched rather than leaving a bare filename.

**The test that caused it is the more useful lesson.** A budget assertion (`block.length <= budget`) is vacuously true against an empty block, so it was paired with a positive control (`block.length > 0`) — correct instinct. But the fixture's page bodies were a single unbroken 1200-character line, which no honest excerpt can fit into a small budget, so the only way to satisfy both was to invent the heading-only block. The control now uses prose-plus-bullets, which is what a project page actually is, and it is paired with a case asserting the opposite boundary: an unsplittable page that cannot fit yields an empty block. **Whenever a control asserts "it must say something", the case asserting "and here it must say nothing" is what pins the boundary.**

**Citations must survive the cache.** `pageSources` is written to and read from both caches alongside `cues`/`buzzwords`/`anchor`/`idealProject`, defaulting to `[]` for entries cached before the field existed. A field that reaches the renderer but not the cache produces an answer that shows its sources when freshly drafted and loses them on the second ask, for the same question, with nothing on screen explaining why — the failure `useDraftAnswer.js` already names for `cues`.

**What was deliberately NOT done, with the reason.** `lib/copilot/answerGrounding.js`'s `groundingFor` did not grow a knowledge-base field. It runs on the CLIENT at cache-read time, and the client has no view of the knowledge base by design; a route-returned fingerprint stored on the entry would be compared against itself and always match — a field that looks like a guard and is not, which is worse than none. So editing a project page does not invalidate an answer already cached in the same live session. If that is ever fixed, the fix is a server-side max-`updated_at` endpoint, not a fourth client-side field.

### R-255 | area: copilot-knowledge-base | parallel-safe: yes | automatable: no

**Summary:** With a real knowledge base, a behavioural answer names one of your actual projects and its actual numbers.

**Steps:**
1. Sign in and open Professional Experience. Ensure at least eight project pages exist, with the one relevant to the question you will ask placed **low in the sidebar**, not at the top. Give it markdown bullets carrying a concrete metric.
2. Attach a PDF to that page and write a note on the attachment naming a number.
3. Open `/copilot`, select the posting, and ask a "tell me about a time" question that matches that page.
4. Confirm the drafted answer names that project and uses its own detail, not a generic résumé line.
5. Confirm each answer line shows which page it came from, as readable text — not colour alone — with no extra click to reveal it.
6. Ask the same question again and confirm the sources are still shown on the cached answer.
7. Switch the engine to embedded and repeat step 3. Confirm the answer is still built from that page, and that every word of it literally occurs on the page.
8. Ask a question that matches NO page. Confirm no page is cited and no unrelated page is spoken as your story.

**Expected:** Step 4 is the whole point of the feature and is what the original report was about. Step 8 is the honesty half: `matched: false` means the page was merely the first eligible one on file, not the one the question is about, and presenting it as a story is the deterministic engine's version of inventing relevance — before this change a beekeeping-club page was drafted as `"Situation: Beekeeping club minutes."` in answer to a question about migrating a payments ledger.

**Manual because this repo structurally cannot test it:** `vitest.config.js` defaults to `environment: "node"`, and the automated cases above verify the retrieval and the citation logic, not what a candidate actually reads on screen mid-interview.

### R-256 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** A page the model was shown but that said nothing is never in the prompt, and never citable.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/knowledgeBase.test.js lib/copilot/pageSourceTitle.test.js app/api/copilot/answer/route.knowledgeBase.test.js`.
2. Read `contributesMaterial` and `hasProseContent` in `hello-world/lib/experience/knowledgeBase.js`.

**Expected:** All tests pass. Every case below was found by a whole-diff review AFTER the feature was built, tested and green, and every one of them reached the model at the real production budget of 12000 characters. They share one shape: **the prompt names a page and gives the model nothing to say about it**, in a prompt that also demands the model cite page ids — so the citation validates, and the user is told a fabricated point came from a page they really own.

**Four ways an empty page reached the prompt.**

1. **Page stubs.** The block builder this replaced filtered on `p.title || p.body`; the port dropped that guard and nothing replaced it. Creating a page and filling it in later is the ordinary way to use the tree, so `## Draft page I never wrote (page id: empty2)` shipped to the model with nothing behind it. Eligibility now requires a non-empty body **or** at least one attachment line. The check sits at the eligibility stage, not in the packing loop, deliberately: an empty stub must not be counted into "N pages not included to fit the budget", because the budget is not why it was left out.
2. **A table of contents as an excerpt.** Block packing is skip-and-continue, so when every *content* block exceeds a page's share, the only blocks that fit are the page's own `##` headings. A 26863-character page produced **186 characters** of headings and elision markers. An excerpt must now contain prose, or the page is skipped.
3. **Rationing against pages that do not exist.** `EXCERPT_SHARE_DIVISOR` stops a long top-ranked page starving pages two and three. It was applied unconditionally, so a single relevant page got **3973 of 12000 characters** — less than the 6000-char cap this whole change exists to raise, in exactly the one-relevant-page case the feature is about. The divisor now applies only while another candidate could still use the budget.
4. **A citation with no name.** A page needs a title *or* a body to be eligible, so a blank title with a real body is legitimate and common. The deterministic engine passed `title: ""` through to the renderer, producing **"From your  page."** — the sentence with its subject missing — read aloud mid-interview. `buildKnowledgeBaseBlock` already defended the identical field with `"Untitled project"`; that asymmetry is what marked it as a bug rather than a choice. Both paths now share the constant.

**Also fixed here, all found by the same pass:** a blank point returned by the model voided **every** citation on the answer, because `points` was filtered and sliced while `pageIds` was passed through untouched and the length check then failed (the all-or-nothing pairing rule is right; normalising only one of the two arrays was the bug — they are now paired by index *before* filtering); an elision marker claimed material was dropped between two blocks when the only thing between them was a restored heading; the honesty sentence was assembled last, so a clamp would have eaten it while the attachment lines it guards survived; a heading indented two spaces was a heading to the renderer and a paragraph to the segmenter, silently breaking heading-context restoration; and a body line of three dashes was indistinguishable from the page separator, letting the model read one page as two and attribute the second half to no id.

**The test that could not catch case 2 is the lesson worth keeping.** A case named "never emits a page heading with nothing under it" already existed and passed. Its fixture was a body with **no headings at all**, so `splitBlocks` yielded one oversized paragraph, the excerpt came back empty, and the guard fired — exercising a different branch from the one the defect lives in. A test can assert exactly the right rule against a state the system never reaches and stay green forever while the real state goes unhandled.

### R-257 | area: copilot-knowledge-base | parallel-safe: yes | automatable: no

**Summary:** The ranker cannot see the subject of a technical question, and this is knowingly unfixed.

**Steps:**
1. From `hello-world`, write a throwaway vitest file importing `significantTerms` from `lib/copilot/projectStories.js` (the repo alias needs vitest to resolve) and run it over: `"Walk me through how you scaled our API to handle 10x traffic using AWS, SQL and Go."`
2. Confirm the result is `["walk","through","scaled","handle","traffic","using"]`.

**Expected:** It is. **`API`, `AWS`, `SQL`, `Go` and `10x` are all dropped**, by the tokenizer's four-character floor, symmetrically on the query side and the page side — so for a technical interview the highest-signal tokens in the entire corpus are exactly the ones the ranker throws away, and every term that survives is a non-discriminating verb.

The same measurement on a behavioural question shows the second half of the problem: scoring a page of pure interview boilerplate ("a time when... the approach... the situation...") against a page that really documents convincing a skeptical stakeholder gives the **boilerplate 6 and the real page 4**. Unweighted set-overlap has no way to know that "time", "about", "what" and "situation" carry no information.

**This is recorded rather than fixed, deliberately, and it is the next chunk.** The fix is BM25 over the pages already in memory — no vector store, no embeddings, no new dependency — shipped together with lowering the token floor, because dropping the floor is only safe once IDF exists to discount common terms. It changes `significantTerms`/`overlapScore`, which `lib/meeting/insightsLocal.js` and `lib/meeting/meetingContext.js` both import, so it is a shared-contract change across two domains and gets its own acceptance criteria, tests and review rather than being bolted onto the end of this one.

**One thing it does NOT subsume, contrary to the obvious reading:** `stripLinePrefixes`. The argument that IDF would handle "Them" appearing once per interviewer turn is wrong — BM25 weights a query term by how many *documents* contain it, not by how often it repeats in the query, so if few pages contain "them" its IDF is *high* and it would poison the ranking exactly as before. The stripper stays.

**Also deferred, with reasons, so none of it is silently dropped:** restating the interview question at the tail of the prompt (Google's published guidance is explicit that the query belongs after long context, and roughly 11000 tokens currently sit between them — but it changes the prompt for users with no knowledge base at all, breaking a pinned byte-identity guarantee, and it is general prompt work rather than knowledge-base work); reordering the stable blocks so the prompt has a cacheable prefix (void while the question sits at position 1, so it must ship with the item above); `thinkingConfig` with a zero budget, which is likely the largest latency lever on this route but needs an A/B, because thinking may be buying the answer quality this work exists to improve; migrating to `responseSchema`, which cannot express the arity constraint the citation safety property rests on and risks stalling the first streamed frame without `propertyOrdering`; and narrowing the `select("*")` projections in `listPages`/`listAttachmentsByPage`, which are shared data-access functions where narrowing for two known callers is how a third breaks silently.

### R-258 | area: copilot-knowledge-base | parallel-safe: yes | automatable: yes

**Summary:** The deterministic engine will not speak one of your pages unless the question is really about it — and will not stay silent about a page just because a boilerplate page outscored it.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/storyMatchHonesty.test.js lib/copilot/starBeatOrder.test.js app/api/copilot/answer/route.knowledgeBase.test.js`.
2. Read `clearsHonestyGate` and the selection loop in `hello-world/lib/copilot/projectStories.js`.

**Expected:** All tests pass. **`matched` is not a relevance score — it is the gate that decides whether the app may speak one of the candidate's own pages as their experience, and (since this group) whether it tells them in writing which page an answer came from.** It took four attempts to get right, and the failures are recorded because each looked correct when it shipped.

**Attempt 1 — `overlapScore > 0`.** Bare set overlap on `/[a-z0-9]{4,}/`. Asked *"Tell me about a time you disagreed with your manager"*, it answered with a **beekeeping page**, because "time" and "with" occur on it:
```
Situation: Beekeeping club minutes.
Action: We spent time each spring checking the hives with the club members.
```
**Attempt 2 — document frequency plus a hand-written boilerplate list.** Still opened on `"time"` alone (*"Tell me about a time you failed"* → an unrelated Settlement pipeline page), still opened on `"worked"` + `"project"`, and now also **rejected genuine matches**: two pages both mentioning Kafka made "kafka" look common, so *"Tell me about your Kafka experience"* matched nothing.

**Attempt 3 — the current rule.** Question terms minus the repo's existing 169-word stopword list (the same list `lib/copilot/resumeAnchor.js` already uses for the same reason — see its "C3 regression" comment), minus a small `INTERVIEW_SCAFFOLDING` set for words that are content-free *specifically in an interview question* and so are absent from a general-purpose list. Match on **two distinctive terms, or one that appears in the page's TITLE**. The document-frequency map is gone: over a few dozen personal pages it carries no information and was the direct cause of the Kafka rejection.

**Attempt 4 — ask the gate about the right page.** The selection loop still picked its winner on the RAW score, scaffolding included, and only then applied the gate — so a page called **"Interview prep"** (a page real users keep) took the argmax on "time"/"difficult"/"problem", failed the gate, and the genuinely relevant page was never considered. The loop now tracks both the raw argmax and the best gate-clearing candidate, and prefers the latter.

**Known and accepted, not a defect to re-fix:** a codenamed page ("Project Northstar", with Kubernetes only in the body) still fails a one-term question, because the single-term branch requires the term to be in the title. Declining to speak is the safe direction; the real answer is R-257's ranking work.

**Two other fixes ride here.** The STAR **Result** beat could be a bullet appearing *earlier* in the page than the Action it supposedly resulted from — it is now chosen by document position after the Action, or omitted entirely, because two honest beats beat three with a false one. And `grounding.pages` — which drives the sample-answer caption — was derived from `matched`, so a page that cleared the gate but yielded no bullets (any page written as prose rather than a list, which is the common case) produced a caption claiming "and your own project pages" over an answer containing none of them. It is now `pageSources.some(Boolean)`: true by construction.

**A fix nothing can catch is a fix nobody can keep.** That last one survived a sabotage run — reverting it left the whole suite green — because every existing fixture used a bulleted page, where the two derivations agree. The prose-page case now has its own test, and it was sabotage-checked before being believed.

### R-259 | area: copilot-privacy | parallel-safe: yes | automatable: yes

**Summary:** Both copilot surfaces tell you that your project pages and attachment file names are sent, and the sentence is true wherever it appears.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/knowledgeBaseDisclosure.test.js lib/copilot/practiceNotices.test.js lib/copilot/practiceNotices.noPreDraft.test.js lib/copilot/groundingNotice.test.js`.
2. Read `KNOWLEDGE_BASE_CLAUSE` in `hello-world/lib/copilot/practiceNotices.js` and its three importers.

**Expected:** All tests pass. This is the `BUG-H5` class the notice modules already name in their own headers — **a new feature silently falsifying an existing disclosure** — and this group shipped it twice before catching it.

**First: the payload changed and no notice said so.** The answer route now sends up to 12000 characters of project-page prose *and an inventory of attachment file names, kinds and saved notes*, on every non-embedded draft, whether or not a posting is selected. The attachment inventory is a new **category** of data, and file names are sensitive in a way page bodies are not — `2024-severance-agreement.pdf`, `offer-letter-competitor.pdf`. The clause is unconditional on the Gemini path, because gating it on whether the user has pages would need a count the client does not have until after the first send — too late to disclose anything.

**Second: only half the pair was fixed.** Practice mode got the clause; **live mode did not**, and `postingGroundingNotice` returns the empty string outright when no posting is selected — the ordinary live state. So live mode disclosed *nothing* about a transfer it performs on every drafted answer. Same route, same payload, one surface telling the truth.

**Third: the sentence was true only where it happened to land.** It opened "It also sends…", and on most branches the preceding sentence is not an act of drafting. On one branch the result was outright false: *"…asking to research the company also sends its name, this job's title and the posting text to Google Gemini. **It** also sends your project pages…"* — telling the user their pages leave the browser when they request company research, when they actually go on every answer. A pinned test asserted that exact string as correct. **The clause now names its own subject**, so it is true wherever it is appended, and there is still exactly one description of the payload, imported by all three callers rather than copied.

**Also here:** the sample-answer panel used to contradict itself — bullets reading "From your Payments migration page." above a caption reading "from your prep context **only** — no submitted resume or cover letter was found." And the citation itself failed contrast at **3.90:1** against the 4.5:1 required for 12px text on the panel fill it renders on, in the default light theme; R-228 had already settled that rule and stated that new surfaces use `--text-secondary` (6.67:1).

### R-260 | area: regression-process | parallel-safe: yes | automatable: no

**Summary:** The stage-10 workflow cannot parse this document any more, and two cases had been unrunnable for months.

**Steps:**
1. Run the stage-10 regression workflow against this document.
2. Read its failure output, not only its summary.

**Expected:** It fails, and **its summary is misleading**: it reports `"No regression document at docs/REGRESSION.md"`. The document exists. The real cause is in the failure log — the enumeration agent exceeds a 64000-token output cap trying to turn ~3900 lines into executable cases. Taken at face value the summary would lead someone to recreate a document that is already there, or to skip the gate.

**Until it is chunked, drive it directly.** The automatable cases name their own commands: `grep -o "npx vitest run [^\`]*" docs/REGRESSION.md`, collect the distinct paths, check each exists, and run them in one invocation. As of this group that is 175 commands naming 191 paths across 187 `automatable: yes` cases, and it completes in about three minutes.

**Doing that surfaced two cases that could never have failed.** `lib/copilot/deepgram.test.js` moved under `lib/copilot/stt/` when speech-to-text became pluggable, and `app/components/TrackingTab.test.js` was split into `TrackingTab.digest.test.js`. Both were still named here, so those two cases had been silently vacuous since those commits. Paths corrected. **A case naming a file that does not exist is not a passing case.**

**And the workflow never runs `automatable: no` cases at all** — four occurrences now, once against an explicit instruction. Its "all passing" covers the automatable subset only. The manual cases in the changed area have to be fanned out to adversarial reviewers by hand, **grouped by defect rather than by file**: in this group that pass found the honesty-gate hole, both privacy-notice failures, the contrast failure and the self-contradicting caption — every one of them invisible to the 5409 automated tests that were green throughout.

### R-261 | area: stt-elevenlabs | parallel-safe: yes | automatable: yes

**Summary:** One ElevenLabs commit produces one utterance, not two — the defect that silently doubled every question and every model call in a real interview.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/stt/elevenlabs.commitPair.test.js lib/copilot/stt/elevenlabs.test.js`.
2. Read `_emitTranscript` in `hello-world/lib/copilot/stt/elevenlabs.js`.

**Expected:** All pass. **This amends R-127, whose stated rule is now wrong** — R-127 says a re-delivery "requires all three fields" and that "a frame with no usable `words` array is never treated as a match either". That rule cannot see the case that actually occurs.

A live session recorded on 2026-08-25 (`interview-log-live-2026-08-25-1644.json`) shows every one of its five utterances delivered **twice**, 66–114ms apart, both frames carrying `speechFinal: true` — so both came from the `committed_transcript` / `committed_transcript_with_timestamps` branches. ElevenLabs emits BOTH members of that pair for one commit when `include_timestamps` is on. The first carries no `start`/`duration` at all; the second carries both. R-127's rule requires numeric spans on *both* sides, so the untimed member defeated it on 100% of finals. The module's own comment called this "a rare residual double-count".

What it cost, measured in that log: **six `question.added` events for three spoken questions, and six drafted answers** — two concurrent model calls per question, contending with each other (ids 5 and 6 are the same question; one took 4.0s, its twin 9.2s). Every downstream dedupe is defeated by construction: `acceptQuestion` in `useLiveSession.js` deliberately falls THROUGH its back-to-back guard when the prior card is still `loading` (AC-P4.4), and the twin always arrives ~70ms later, always while loading. For the first question the two copies did not even share text — the heuristic missed "Talk to me about…", so both went to the remote confirm, which rewrote one to "Tell me what appealed…" and the other to "Talk to me about what appealed…": two normalized keys, two cards, two drafts, from one sentence.

**The corrected rule is text-first.** Text equality decides whether two finals are candidates at all; the span decides only among those. Both spans numeric → re-delivery iff equal (R-127's case, unchanged). Exactly one side numeric → re-delivery (the commit pair). Neither numeric → unproven, delivered (unchanged). ElevenLabs' published AsyncAPI spec carries **no id, sequence number or utterance marker** on any transcript message, so text is not a shortcut here — it is the only correlation the protocol offers.

**And the remembered final always holds the best span known for its commit.** Two halves, in opposite directions, and a peer review with a 31-mutant harness found the second one by building the implementation the first draft of this rule admitted:
- A suppressed frame must not overwrite the remembered final. Otherwise `timed(1) → untimed → timed(12)` compares the third frame against the untimed twin, matches, and a real utterance vanishes.
- **Except that it upgrades the remembered span when the suppressed twin has one the remembered frame lacks.** Otherwise `untimed → timed(1) → timed(30)` — the order this provider actually delivers — leaves the memory untimed, so the third frame also matches "exactly one side has a span" and a real utterance vanishes here instead. "Keep the richer original" is only correct when the timed member leads.

Accepted residual, stated rather than rediscovered: two identical utterances that each arrive with **no** timed member cannot be told apart and the second is suppressed. Unreachable while `INCLUDE_TIMESTAMPS` is on, since every commit then has a timed member whose span differs.

**Also here:** `message_type: "warning"` is in ElevenLabs' documented server-to-client list and was unhandled, so a real warning arrived as "this module … has not been verified against the live service" — telling the user their wire format had drifted when it had not. It now has its own case and is deliberately NOT in `ERROR_MESSAGE_TYPES`.

### R-262 | area: copilot-questions | parallel-safe: yes | automatable: yes

**Summary:** The question that reaches the model is the question that was asked — `cleanQuestion` no longer deletes the verb.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/questions.fidelity.test.js lib/copilot/questions.test.js lib/copilot/localDetection.test.js lib/copilot/localDetection.openers.test.js`.
2. Read `HESITATION_RE`, `DISCOURSE_MARKER_RE` and `PREAMBLE_RE` in `hello-world/lib/copilot/questions.js`.

**Expected:** All pass. `cleanQuestion`'s header promised it was "purely cosmetic — never changes the substance of the ask". In the 2026-08-25 session it turned **"What do you know about Purple Wave?" into "What do about Purple Wave?"** — `FILLER_RE` stripped "you know" unconditionally as hesitation filler, deleting the main verb. The model was then asked to answer a sentence with no verb, which is a large part of why the four bullets it returned contained no fact about the company.

**The rule is structural, not a longer exception list.** Hesitations (`um`, `uh`, `erm`, `hmm`, `kind of like`, `sort of like`) are never content and stay unconditional. The multi-word discourse markers `you know` and `i mean` are filler ONLY at a clause boundary — opening the utterance, or touching a comma on at least one side — and content everywhere else. The strip consumes one adjacent comma, or "when, you know, a deadline" cleans to "when,, a deadline".

**All three boundary shapes need their own case.** A fixture set where every marker happens to carry a trailing comma is satisfied by a comma-after-only rule, which leaves "I mean how would you approach it?" untouched. And **every marker needs its own positive control**: a test titled "the same rule applies to 'I mean'" originally had two assertions that both passed against the unmodified source ("what did you *mean*" was never what `FILLER_RE` matched; "So, I mean," is stripped identically by the old rule), and a mutation harness shipped an implementation that left `i mean` unconditional straight past it.

**The preamble strip is anchored at `^`, and that anchor is load-bearing.** An interviewer's "That's a great question." was being stored as part of the question — which also gave it a different normalized key from the identical question asked 16 seconds earlier, so the answer cache missed and the copilot paid for a model call it had already made. Unanchored, the same rule deletes the ask out of the middle of "What makes a great question in a design review?" and "Tell me about a time you asked a really good question." Three separate mutants collapsed the rule to "keep only the last sentence", passed every other case, and destroyed the context in "We use Kafka. How would you scale the consumer group?" — so the corpus must contain a multi-sentence question whose first sentence is content.

**Also here:** `STARTERS` gained "talk to me", the missing member of a family it already had ("talk about", "talk me through", "talk us through"). Its absence cost a 1.4-second network round trip on the first question of that session — every other question was detected in 0ms — and cost the question's wording, since the remote confirm rewrote it.

### R-263 | area: copilot-live | parallel-safe: yes | automatable: yes

**Summary:** A spoken hold cue works when the speech-to-text provider cannot tell voices apart — the state in which it was previously unreachable, silently.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/cuePolicy.test.js app/copilot/useLiveSession.attribution.test.js app/copilot/useLiveSession.cues.test.js app/copilot/VoiceCueSidebar.test.js lib/copilot/session.inperson.test.js lib/copilot/session.meeting.test.js`.
2. Read `qualifiesForCue` and `resolveCueAction` in `hello-world/lib/copilot/cuePolicy.js`.

**Expected:** All pass. **This amends R-151, which recorded two accepted consequences of a non-diarizing session — turns cannot be attributed, and pace/filler readings are not measured — and missed a third: no voice cue could fire at all.**

ElevenLabs Scribe v2 Realtime has no realtime diarization, so `_resolveSpeakerLabel` resolves every frame to `"them"`, including the candidate's own speech. `useVoiceCues` refused any frame where `speaker !== "you"`. In the 2026-08-25 session the log therefore contains **zero `cue.matched` and zero `cue.ignored` events** — the interviewer said "That's a great question." twice and the candidate spoke throughout. The feature was not misfiring; it was unreachable, and the user had no way to find that out from their own log.

**The attribution axis has FIVE values, not two.** `attributeSpeakers` defaults true on every source and only in-person can ever earn `diarizationActive`, so the naive two-value derivation marks tab/system `"unavailable"` — and then relaxes the speaker gate on exactly the two sources where "you" comes from a physically separate microphone socket. `active` / `unavailable` / `off` (the meeting copilot, which asks for one undivided voice) / `not-applicable` (tab and system) / `pending` (before the socket reports).

**Relaxing only the speaker gate leaves the feature exactly as dead.** Without diarization there are no speaker tags, so `confidence` can never leave `"unknown"` and there is no tag for a manual override to name — the in-person identity gate is unsatisfiable by construction in precisely the sessions this change exists to rescue. Both gates are skipped for `unavailable`, and only for `unavailable`.

**Only `pin` may act in that state, and the asymmetry is the reason.** `voiceCues.js` documents it: a false HOLD holds the question the candidate is already reading and expires by itself in 120s; a false RELEASE takes away a deliberate hold mid-answer; a false COMPANY spends an outbound request carrying the posting's details. The refusal happens BEFORE `onCompanyCue()` is called — refusing after it still spends the request.

**Every cue decision is logged, with a distinct reason per refusal path.** Two states sharing a reason string go silent in both a live region and a diagnostic log. The sidebar states the same policy by reading `cueAvailabilityNotice`/`cueRowNote` from the policy module rather than restating it, so widening the policy cannot leave the panel claiming release still works.

### R-264 | area: copilot-answer | parallel-safe: yes | automatable: yes

**Summary:** An answer states a fact about the employer only if that fact was checked against a page the search actually read.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/companyFacts.test.js lib/copilot/companyFactsSource.test.js lib/copilot/companyDirected.test.js lib/copilot/factCitations.test.js lib/copilot/answerPrompts.companyFacts.test.js lib/copilot/answerPrompts.test.js app/api/copilot/answer/route.companyFacts.test.js`.
2. Read `buildCompanyFacts` in `hello-world/lib/copilot/companyFactsSource.js`.

**Expected:** All pass. Asked "What do you know about Purple Wave?" — an online heavy-equipment and farm-machinery auction company — the copilot produced *"Purple Wave is dedicated to delivering innovative solutions and enabling product teams through cutting-edge platform technology"* and *"**My research indicates** a strong focus on continuous improvement."* Not one sentence was a fact about the employer; all of it was job-description vocabulary reflected back, and the second asserted research that never happened, for the candidate to read out loud in an interview.

The cause was structural: `buildPointsPrompt` had **no company source of any kind**. The grounded, link-checked company brief that already existed reached a separate panel opened by a voice cue that (see R-263) could not fire.

**Corroboration reuses the machinery this repo already has for exactly this problem, and the ORDER is not negotiable:** `extractGroundingSources` → **`resolveGroundedSources` first** → `isGroundedUrl`. `lib/meeting/referenceContract.js`'s header documents why: grounding `web.uri` is sometimes a publisher URL and sometimes a `vertexaisearch.cloud.google.com/grounding-api-redirect/…` link, so comparing a model's URL against a raw redirect is false for every link forever — the feature returns zero facts and is indistinguishable from a model that searched nothing.

**A claim that is not corroborated is DROPPED, not softened.** There is no useful weaker version of a fact the candidate cannot stand behind. `referenceContract.js` is the precedent and states the same reasoning for meeting links.

**The prompt has three states and they are genuinely three.** No employer known → nothing added, and `FROZEN_POINTS_PROMPT_NO_PAGES` passes byte-for-byte. Employer known with surviving facts → the block, the authority sentence, and `factIds` in the JSON shape. **Employer known with no surviving facts → no heading, no empty block, no `factIds`, and an explicit instruction to assert nothing about the employer.** Collapsing the last two into the first is the easy way to keep the byte-identity guarantee and it silently removes the only instruction that stops the model inventing. An empty heading is worse than silence — this repo has already shipped a heading-only block that invited fabrication.

**The instruction names the phrasings.** The prompt already said "never invent" about experience and the model still wrote "My research indicates", so that phrase is banned by name.

**`factIds` is validated against the whitelist of facts actually shown**, following `pageCitations.js` exactly, including its four non-obvious rules: the whitelist supplies the displayed values, the positional pairing is all-or-nothing on length, `[]` is not an array of nulls, and it never throws. **`factIds` is declared AFTER `points` in the shape line** — the streaming parser anchors on `/"points"\s*:\s*\[/`, so an earlier field delays the first streamed bullet for no benefit.

**"Is this question about the employer" is a structural rule, not a score.** This repo spent four rounds on a hand-tuned word score for a similar gate and each fix moved the hole rather than closing it. Two conditions only: the employer is NAMED (data from the posting row, so it differs per user and cannot be tuned), or a determiner from the closed set `{the, this, your}` precedes the head noun `{company, organisation, organization}` **and the head noun ends the phrase** — without that boundary guard, which `voiceCues.js` already solved for its own cue, "What is the company culture like?" reads as a question about the employer and so does "the company you worked for".

**`buildCompanyFacts` never rejects.** Every failure — no company, no key, a network error, unparseable output, no grounding metadata, every fact dropped — returns `[]`. It rides beside an answer the candidate is waiting on and must never be able to fail the request it rides beside.

### R-265 | area: copilot-answer | parallel-safe: yes | automatable: yes

**Summary:** The live answer path stops paying for work it already did — thinking it does not need, and Supabase queries whose answers cannot have changed.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/api/copilot/answer/ lib/copilot/answerSessionCache.test.js lib/copilot/answerAids.test.js`.
2. Read the streaming call's `config` in `hello-world/app/api/copilot/answer/route.js` and `createTtlCache` in `hello-world/lib/copilot/answerSessionCache.js`.

**Expected:** All pass. Measured from the 2026-08-25 session: 4–10 seconds from a detected question to a drafted answer. Three contributors sat in front of the first token, and R-261 removed the largest (two model calls per spoken question). The other two are here.

**`gemini-2.5-flash` defaults to dynamic thinking**, and the route passed no `thinkingConfig`, so every live answer burned thinking time before emitting anything — and because the response is streamed JSON, that is time the candidate spends looking at an empty card. `config.thinkingConfig.thinkingBudget: 0`, verified against Google's own documentation for the Generate Content API this route calls: range 0–24576 for this model, 0 documented as turning thinking off and reducing latency. **The newer Interactions API's `thinking_level` is a different API with no "off" for this model — do not substitute it.** Scoped to the streaming points call, the one the candidate waits on mid-interview; practice mode is deliberately untouched.

**`auth.getUser()` plus four Supabase queries ran on every question**, for data that cannot change during an interview. They now run once per `${userId}::${applicationId}`, TTL 10 minutes against an injected clock.

**`kb`, `story` and `grounding` are deliberately NOT cached.** `buildKnowledgeBaseBlock` ranks pages against the question, so a cached block answers question two with question one's page selection — an answer built from the wrong project, with every test green. This is the single most likely way to get the cache wrong, which is why it is asserted on ORDER (the page the question is about is the first heading in that question's block), not on presence: both pages fit the budget, so a presence assertion passes against a question-blind block.

**Stale and miss are the same event.** A stale entry is deleted and reloaded, never served once and never served-then-refreshed in the background — serving a résumé the user has since edited is exactly what the correctness clause forbids. A rejected load is not cached, or one bad round trip becomes ten minutes of answers built from nothing. The cache stores the **promise**, so two questions detected within a second of each other collapse into one round trip.

**`auth.getUser()` is NOT cached, and that is not an oversight** — its result is what produces the cache key. Keying on the access token instead would be a correctness regression.

**Also here:** `normalizeModelPoints`, `generateIdealProjectExample` and `answerAids` moved out of the route into `lib/copilot/answerAids.js` — the same extraction `answerPrompts.js` already made from the same file, taking it from 804 lines to 663. The proof that it is behaviour-preserving is that the pre-existing route tests pass unchanged on both sides of it.

### R-266 | area: interview-copilot | parallel-safe: yes | automatable: yes

**Summary:** Every downloaded live session log named the consequence and withheld the cause: "- Provider: unknown" rendered directly above "Your configured speech-to-text provider can't tell speakers apart on a single microphone" — a warning that only makes sense once you know which provider it is talking about.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/copilot/stt/index.providerName.test.js lib/copilot/sessionLog.provider.test.js app/copilot/useLiveSession.provider.test.js`.
2. Read `createSttStream` in `hello-world/lib/copilot/stt/index.js`, `setProvider` in `hello-world/lib/copilot/sessionLog.js`, and the `onSttProvider` wiring through `hello-world/lib/copilot/session.js`, `hello-world/app/copilot/useSessionLogRecorder.js` and `hello-world/app/copilot/useLiveSession.js`.

**Expected:** All tests pass. `createSttStream` already computed which provider it selected and threw the answer away; it now records it as `providerName` on the returned stream, on the same lines that already set `diarizationActive` and for the same reason: it has to be the provider **actually selected**, not the one the server preferred, so a failed token fetch that falls through to the Deepgram default reports `"deepgram"`, not whatever `STT_PROVIDER` says — a log naming the configured provider would be wrong precisely when someone downloads it to find out what went wrong.

**Two corrections to how this defect was first reported, both settled by reading the code before writing the fix.** The gap is not `useSessionLogRecorder.js`'s `provider: null` fallback (that is only the catch-block stand-in inside `sessionLogSnapshot`) — it is `startLog()` never passing `provider` to `createSessionLog({ mode, source, startedAt })` at all. And practice mode was never broken: it already passes `provider: "practice"` and renders correctly, so the fix touches only the live path.

**The live path's timing is the reason a setter exists rather than a constructor argument.** `startLog()` runs at the very top of `start()`, deliberately, so a session that fails moments later still has a `session.start` entry explaining what it was — but the provider isn't known until a network round trip after that, inside `createSttStream`. `sessionLog.js` now exposes `setProvider(name)` so the log can be told once, later, without disturbing the events already recorded or moving `startLog()` and trading the whole failed-session diagnostic path for one field. It refuses a blank or non-string value rather than storing it, so the markdown never regresses to rendering "- Provider: " with nothing after it.

`session.js` surfaces the new fact the same way `speakerAttribution()`/`onAttribution` already surface diarization: an `onSttProvider` callback plus an `sttProvider()` getter, fired from `_addSource` — the ONE method every source (tab, system, inperson, meeting) opens its stream through — rather than from `_startInPerson` alongside `onAttribution`, which source-restriction would have wrongly withheld the provider name from every non-inperson session. `useSessionLogRecorder.js` gained `logProvider(name)`, and `useLiveSession.js` routes `onSttProvider` into it, so the field now reaches the download the same network round trip after `start()` that it always took to become knowable.

**Sabotage confirmed each seam is load-bearing.** Dropping the `providerName` assignment in `stt/index.js` failed all 7 cases in `index.providerName.test.js` (the rest of that suite stayed green). Letting `setProvider` accept a blank string failed exactly the one `sessionLog.provider.test.js` case written for it. Removing `onSttProvider` from `useLiveSession.js`'s `CopilotSession` construction failed 3 of the 4 cases in `useLiveSession.provider.test.js` — the 4th, asserting the honest "unknown" fallback when no provider is ever reported, is unaffected by that particular mutation and correctly stayed green.


### R-267 | area: llm-grounding | parallel-safe: yes | automatable: yes

**Summary:** Every grounded Gemini call in the app now actually asks for its tool on the wire. Until this case, none of them did.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/llm/tailorResume.wire.test.js lib/feed/llmSearch.wire.test.js app/api/application-digest/route.wire.test.js app/api/company-research/route.wire.test.js app/api/experience/research/route.wire.test.js app/api/meeting/references/route.wire.test.js app/api/posting-from-image/route.wire.test.js app/api/techwatch/lifecycle/route.wire.test.js`.
2. From `hello-world`, run `npx vitest run --no-file-parallelism app/api lib/llm lib/feed lib/meeting lib/techwatch`.
3. Read any `generateContent` call that passes `googleSearch` or `urlContext` in `hello-world/app/api/` or `hello-world/lib/`.

**Expected:** All pass, and every one of those calls passes its tools as `config: { tools: [...] }` — never at the top level.

**`GenerateContentParameters` has exactly THREE properties — `model`, `contents`, `config` — and `tools` belongs to `GenerateContentConfig`.** The `@google/genai` parameter transformer reads only those three keys and DISCARDS everything else before building the request body, with no error and no warning. Proven on the wire twice independently, by stubbing `globalThis.fetch` around the real SDK and reading `init.body`: `{model, contents, tools, config:{systemInstruction}}` produces a body with no `tools` at all, while `{model, contents, config:{systemInstruction, tools}}` produces `"tools":[{"googleSearch":{}}]`.

**Eleven call sites across eight files used the dropped position, so every grounded feature in this app had been running ungrounded** — `app/api/company-research/route.js` (x2), `app/api/experience/research/route.js`, `app/api/application-digest/route.js`, `app/api/meeting/references/route.js`, `app/api/posting-from-image/route.js`, `app/api/techwatch/lifecycle/route.js`, `lib/feed/llmSearch.js`, and `lib/llm/tailorResume.js` (x3). (`lib/copilot/companyFactsSource.js` was fixed earlier, under R-264.)

**The failure is total and invisible, which is why it survived so long:** no `tools` on the wire → no search → no `groundingMetadata` → `extractGroundingSources` returns `[]` → every corroboration step drops every claim → the feature returns nothing while still paying for a full model call. It is indistinguishable from a model that searched and found nothing. Tech Watch lifecycle and the meeting reference panel returned literally zero rows and cached that emptiness against a global key; the AI job-search ingest yielded zero postings per query on every scheduled run; the company-research route emitted its "could not confirm these via live search" warning on every response forever.

**The tests that were supposed to pin the request shape asserted it against an INJECTED FAKE client, and that is the deeper lesson.** A fake sees whatever object the caller hands it and cannot observe the layer that drops the key, so five assertions across five files were permanently green against requests that never carried `tools` — including one sitting directly under a comment explaining why the tool was indispensable. Dependency injection is the right pattern for the pipeline and the wrong instrument for the transport. **Whenever a test's claim is "we asked the service for X", it has to drive the real SDK and read the bytes.** Those five now assert `config.tools` AND `expect(call.tools).toBeUndefined()` beside it, so the old shape cannot come back green; the eight `*.wire.test.js` files above are the real proof, built on the shared `lib/llm/geminiWireProbe.js` capture helper, and each carries a standing negative control pinning the top-level form as dropped — if a future SDK starts honouring it, those go red and every comment written about this is stale.

**`lib/llm/tailorResume.js` was the highest-risk of the eleven and its conditional must not be collapsed.** Two of its sites carry a comment that `urlContext` is not compatible with `response_mime_type`, so JSON is forced only when no URL is being fetched. With `tools` silently dropped, the URL branch was sending NEITHER a tool NOR a JSON mime type — a third mode nobody designed, surviving only because `parseStructuredResult` is defensive about prose. The gate pins both directions: URL branch gets `tools` and no JSON mime, no-URL branch keeps JSON mime and no tools.

**Also watch the discriminators.** Tests that tell one model call from another by `args?.tools` silently change which branch they exercise when `tools` moves, and keep passing while testing the wrong thing. `app/api/copilot/answer/route.companyFacts.test.js` and `route.latency.test.js` both use `args?.config?.tools` for exactly this reason; a sweep of the repo found no others.

**Sabotage confirmed all eleven seams are load-bearing.** Moving `tools` back to the top level at each site in turn — one exact-string replacement, occurrence count asserted at exactly 1, byte-snapshot restore — turned that site's own wire test red and only that site's, in all eleven cases.

### R-268 | area: copilot-live | parallel-safe: yes | automatable: yes

**Summary:** The question pipeline left `useLiveSession.js`, and actually left — the file has headroom again.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/useLiveSession.split.test.js app/copilot/useLiveSession.manual.test.js app/copilot/useLiveSession.cues.test.js app/copilot/useLiveSession.attribution.test.js`.
2. Read the header of `hello-world/app/copilot/useQuestionPipeline.js`.

**Expected:** All pass. `useLiveSession.js` reached **999 of this project's hard 1000-line cap** during R-261..R-266 — the last change to it got back under by tightening prose written moments earlier, which is not repeatable, so the next feature to touch it would have failed verification before it started. `addQuestion`, `addManualQuestion`, `acceptQuestion`, `evaluateUtterance` and `handleUtterance` moved to `useQuestionPipeline.js`: one job (turn a finished utterance into an answered card), and the largest coherent block after `start`, which is the session lifecycle and is entangled with every callback `CopilotSession` takes. 999 -> **773**, new module **289**. This is the sixth extraction out of that file, after `useSessionLogRecorder`, `useDraftAnswer`, `useQuestionPin`, `useVoiceCues` and `useCueActions`, and like all of them it left for the line cap rather than for a design boundary.

**A refactor can ship inert, which is what `useLiveSession.split.test.js` exists to prevent.** Piece-level tests import the extracted module DIRECTLY, so every one of them passes whether or not the caller ever wired it up — this repo has an instance where 27 tests passed against a component extraction whose caller was still 1320 lines and never imported any of the three new components. The guard is therefore a SOURCE-TEXT test, which is normally a poor instrument and is right here because the property under test IS the shape of the source: the caller imports the hook, CALLS it, and no longer defines any of the five callbacks itself, while the new module does define all five. Sabotage confirms both halves are load-bearing — deleting the import breaks 13 unrelated behavioural cases outright, while keeping the import and making the call indirect breaks NOTHING except the guard's own "calls it" assertion.

**The line assertion is a ceiling with headroom, not a number tuned to today's file.** Two failures pull in opposite directions and both have been suffered here: a bound set to the freshly-extracted size goes red on the next legitimate change and the reflex is to shave comments to hit it, while "under 1000" is satisfied by a token extraction that moves nothing. 880 is far enough out that only real drift reaches it. Note the helper subtracts the trailing newline so it agrees with `wc -l` — a bare split count reports 1000 for a 999-line file, landing exactly on the boundary it polices.

**Behaviour preservation is proven by the counts, not asserted.** `lib/copilot` + `app/copilot` were 162 files / 3019 tests before and after, with no existing assertion touched. The only differences in the moved code are four dependency arrays gaining the now-passed-in refs (required by `react-hooks` exhaustive-deps, exactly as `useCueActions.js` already lists its own) and `DEFAULT_SPEAKER_SNAPSHOT` becoming a passed parameter rather than a second literal. All four refs stay declared in `useLiveSession.js`, whose `start`/`clearAll` remain their only reset sites.

**Also worth knowing, and it cost an agent a long detour:** running `npx vitest` from the repo ROOT rather than from `hello-world/` silently resolves a different vitest out of the npx cache and reports 44 failed files against a missing `jsdom` — a convincing false red. Every command in this document runs from `hello-world/` for that reason.

### R-269 | area: interview-type | parallel-safe: yes | automatable: partly

**Summary:** One interview-type selection is shared by both copilot tabs, persists and cross-tab-syncs the way the practice type selection already did, and degrades honestly when storage refuses to cooperate — with a documented, load-bearing obligation on whoever ships the code-bearing follow-on.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/interviewTypes.test.js app/copilot/useInterviewType.test.js lib/copilot/choiceStore.test.js app/copilot/InterviewTypePicker.test.js app/copilot/SessionSetup.test.js app/copilot/CopilotClient.interviewTypeWiring.test.js app/copilot/practice/PracticeClient.interviewTypeWiring.test.js`.
2. Manual (`automatable: no`): at `/copilot`, with no session running, confirm the live picker renders above `PostingPicker` in the setup block with the accessible name "Interview type"; select a value, switch to the practice tab and confirm it shows there with no reload. Then start a live session — the collapse toggle only exists once `live` is true (`SessionSetup.js:126`; before a session starts the setup block always renders expanded, by design) — and confirm the collapsed block's summary line reads `Posting: {title} · Interview type: {label} · Mic: {micLabel}`.
3. Manual (`automatable: no`): force `localStorage.setItem` to throw in one tab (devtools override, or fill the quota) and select a type there — confirm the picker's helper text says the choice will not survive a reload while the selection still applies for the rest of that tab. In a second, healthy tab, select a different type and confirm the throwing tab still adopts it.

**Expected:** All automated files pass. The registry is the single edit point: the predicate, the picker's options and every consumer read from `INTERVIEW_TYPES`, and `interviewTypes.test.js:101` pins the option count at exactly 7. **While chunk A ships standalone, the `technical` blurb still ends "Answers are spoken points, not written code.", and the same file's tripwire `it` block pins that exact string — chunk B must delete the sentence and the tripwire together, in the same change.** Deleting the test without the sentence leaves a confident falsehood under a control that produces code; deleting the sentence without the test turns the suite red, which is the intended and harmless order. One value is shared by both tabs — two independent mounts of `useInterviewType()` always agree — and it persists under the unchanged `copilot-practice-interview-type` key, defaulting to `general` and reading back `general` for anything outside the vocabulary or for empty storage. A change in another window reaches this one through a `storage` listener that filters on the key, re-reads storage rather than trusting the event's `newValue`, and treats `e.key === null` (a foreign `clear()`) as a real change rather than stranding the tab. Re-selecting the already-selected value notifies nobody and invalidates nothing. When `setItem` throws, the selection still applies in the tab that made it — driving the request body and the cache key exactly as a persisted choice would, and reported through a primitive flag surfaced as helper text on the control (`useInterviewTypeStorageBlocked`, a `useSyncExternalStore` snapshot, never a fresh object) — without reverting to the default the moment the write fails, and that tab still adopts a later, genuine write from another, healthy window. Step 1's picker-placement and accessible-name checks are source text only; the true computed accessible name and the rendered summary line are what steps 2 and 3 exist to cover.

### R-270 | area: copilot-answer-cache | parallel-safe: yes | automatable: yes

**Summary:** Live mode's answers are drafted, cached and superseded with the interview type as a first-class part of the mechanism — read synchronously at the capture point, folded into the cache key, and protected by a second, independent guard from the same per-entry token that protects the wider posting/profile-change race.

**Steps:**
1. Read `getInterviewType()`'s call site at the top of `runDraft`, and where `draftToken` is stamped relative to the `if (!force)` cache branch, in `hello-world/app/copilot/useDraftAnswer.js`. Read `groundingFor` in `hello-world/lib/copilot/answerGrounding.js`.
2. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/useDraftAnswer.interviewType.test.js lib/copilot/answerGrounding.test.js`.

**Expected:** All pass. The live request body carries `interviewType`, read by a synchronous `getInterviewType()` call at the top of `runDraft` — not mirrored into a ref — proven by changing the type and starting a draft inside the SAME synchronous turn and reading the outbound body before any flush; a test that only asserts the body eventually carries the selected type would pass against a ref implementation too, so that alone does not discharge this. The live grounding key folds `interviewType` and `codeLanguage` in alongside `profile` and `applicationId` — a four-field key — built through the shared `groundingFor`, not a hand-rolled comparison; re-asking the same question after switching from `general` to `technical` is a MISS, never a "reused" hit, and the same-type re-ask stays a hit. `draftToken` is stamped as a field on the question entry BEFORE the `if (!force)` cache branch, and the cache-hit write itself advances it — so an older in-flight draft holding the OLD token can no longer land over an answer just served from cache. A superseded draft writes nothing on any of its post-await exits: it does not overwrite a newer answer that already landed, it does not flip a correct `done` answer back to `idle` on a late success, and it does not do so on a late rejection either — each proven against a positive control that DOES still revert when the entry has no newer owner.

### R-271 | area: interview-type | parallel-safe: yes | automatable: partly

**Summary:** A room question carries the selected interview type; changing the type invalidates the room's drafted answers and nothing else, keeping the questions other people in the room actually asked.

**Steps:**
1. Read `invalidateDrafts` and the generation guard inside `runDraft` in `hello-world/app/copilot/practice/useRoomQuestions.js`.
2. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/practice/useRoomQuestions.interviewType.test.js`.
3. Manual (`automatable: no`): with a room session active and at least one detected question showing a drafted answer and its type chip (e.g. "Technical"), change the interview type. Confirm the question and its text stay on screen and the drafted answer resets to the same empty shape a fresh question is seeded with, never disappearing from the list. The type chip disappears when this happens — `QuestionFeed.js:195` gates it on `status === "done"`, and invalidation resets status to `idle` — even though the classification itself is retained internally (untouched by `invalidateDrafts`, per step 2's `after.type === before.type` assertion) and reappears once the question is redrafted. **This is the observed, current behaviour, recorded here so it reads as verified rather than overlooked** — measured `["Technical"]` before the change, `[]` after.

**Expected:** All automated cases pass. A room-question draft request carries the selected type, read synchronously at the capture point (AC-A20's same rule, applied here) — and the same request now carries the selected code language too, read synchronously off `getCodeLanguage()` at the identical capture point (no separate ref, no separate capture site). Changing the type invalidates the DRAFTS — every entry's answer payload, including one left in the error state, resets to the shape a fresh entry is seeded with — and keeps the QUESTIONS: their ids, their text and their classification all survive untouched **as data**, because they are questions other people in the room actually asked and a type change does not make them un-asked. Changing the LANGUAGE goes through the identical `invalidateDrafts` and produces the identical paired result — the room's drafted answers reset, the questions' ids, text and classification survive untouched — which is the narrower seam A17 created (`discardDraftedAnswers`, never `resetQuestions`) applied on this surface: a language change has no more claim on a question someone else in the room asked than an interview-type change does. This is a data-level guarantee, not a rendering one: the classification's on-screen chip is gated on `status === "done"` (`QuestionFeed.js:195`) and disappears once invalidation drops status to `idle`, reappearing only once the question is redrafted — see step 3. `resetForSession()` — which empties the list entirely — is not called by the invalidation, proven against its own positive control, and the dedupe guard (`lastQNormRef`) is not reset either, so a question already on screen cannot be silently re-added as if new. A draft resolving AFTER the invalidation writes nothing on either its success path or its rejection path — the unguarded catch is half the hazard a generation guard alone would miss — while an un-invalidated draft still lands on both paths, and an older draft never overwrites a newer one for the same entry. The comment that used to say this hook sends no interview type is corrected.

### R-272 | area: interview-type | parallel-safe: yes | automatable: partly

**Summary:** The practice session's running score average is cleared by an interview-type change, on both a local pick and a foreign one, and by nothing else — protecting against a mean that silently mixes two incommensurable rubrics.

**Steps:**
1. Read `clearSessionScores` in `hello-world/app/copilot/practice/usePracticeAnswer.js`, and where `discardQuestionAndScoreWork` in `hello-world/lib/copilot/choiceChangeInvalidation.js` calls it — origin-blind, unlike `resetQuestions`/`markQuestionsStale` beside it.
2. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/choiceChangeInvalidation.test.js app/copilot/practice/PracticeClient.interviewTypeWiring.test.js`.
3. Manual (`automatable: no`): mid-session, answer at least one question under `general`, note the running average, switch to `technical`, and confirm the average resets to empty rather than continuing to include the prior score. Separately, confirm pressing "Next question" or "Try again", or changing the posting, leaves a non-empty average exactly as it was.

**Expected:** All automated cases pass. `clearSessionScores` is a new, additive export of `usePracticeAnswer.js` — `resetAnswerState` does not call it, asserted directly against the hook's own source — so "Next question", "Try again" and the posting change all leave the running average alone. An interview-type change clears it on BOTH origins: a local pick and a foreign `storage` event both reach `clearSessionScores` through `discardQuestionAndScoreWork`, unlike the question-side duties beside it, which differ by origin. This is origin-blind because the rubric moves either way — `lengthTarget` and `expectations` both change with the type — and a surviving average would silently average two incommensurable scales into one number the user reads as a single measure. It is a fix to a defect reachable today, independent of this feature: `questionScores` was previously reset only inside `resetForSession`, so a mid-session type change left a mean mixing two rubrics with nothing on screen saying so.

### R-273 | area: interview-type | parallel-safe: yes | automatable: no

**Summary:** An interview-type change arriving from another browser window never destroys work in this one — no abandoned recording, no torn-down review, no unmounted focus, no swapped-out practice question — even though the value, the control, the summary line, the cache key, the room drafts and the session average all still update.

**Steps:**
1. Read the origin split in `hello-world/lib/copilot/choiceChangeInvalidation.js`: `discardAnswerWork`'s `if (origin === "local")` guard around `abandonInProgressAnswer()`/`resetAnswerState()`, and the module header's reasoning for why the split exists on the answer side and not the live side. Read `judgedInterviewType`'s capture in `hello-world/app/copilot/practice/usePracticeAnswer.js` and its use as `judgedInterviewTypeLabel` in `hello-world/app/copilot/practice/PracticeClient.js`.
2. Open two browser windows/tabs on the same origin, both at `/copilot` in practice mode. In window A, start recording an answer to the current question. In window B, select a different interview type.
3. Confirm in window A: the recording keeps running (not abandoned), the current practice question stays on screen, and nothing holding focus unmounts.
4. Confirm in window A the value, the picker, the collapsed summary line, the live/practice cache key and the room-question drafts all reflect window B's change, and the session's running score average is cleared.
5. Finish the answer in window A, open its review, then select yet another type in window B. Confirm the review's critique is labelled with the type the answer was JUDGED under (window A's type at the time it was submitted), not the type now selected.
6. Repeat with a live session running in window A instead of a recording in progress: after window B's change, confirm the current live answer's card stands and reads "Drafted before the interview type changed." rather than being cleared, replaced, or the panel unmounting.

**Expected:** Every step passes. The mechanism is readable in `discardAnswerWork`'s origin split — `abandonInProgressAnswer`/`resetAnswerState` run only for `origin === "local"`, never for a `storage` event from another window — while `discardDraftedAnswers`/`invalidateRoomDrafts`, `clearSessionScores` and the live-side `invalidateLiveAnswers` are all origin-blind, because none of them destroys user-authored content or unmounts anything. A stale-rubric score is made visibly stale rather than silently mixed: `judgedInterviewType` is state captured at the point a critique's inputs are assembled, not a ref, so a critique already on screen keeps the label it was actually judged under even after the shared selection moves on. `automatable: no` because the defect this protects against only manifests with two real windows; the invariant is proven by reading the origin split at source, not by a runnable assertion.

### R-274 | area: copilot-code-language | parallel-safe: yes | automatable: yes

**Summary:** The per-application programming language is resolved by its own model call, admitted only when the model quotes a span the posting actually contains, cached for 30 minutes, and reaches the answer prompt as a single token that is never a claim about the employer.

**Steps:**
1. Read the four gates as the first statement of `startCodeLanguageResolution`, and the explicit `hit.language === NONE` check inside `peekCodeLanguage`, in `hello-world/lib/copilot/answerCodeLanguage.js`. Read the six-step algorithm's comment block above `validateResolvedLanguage` in `hello-world/lib/copilot/codeLanguagePrompt.js`.
2. From `hello-world`, run `npx vitest run --no-file-parallelism lib/copilot/codeLanguages.test.js lib/copilot/codeLanguagePrompt.test.js lib/copilot/answerCodeLanguage.test.js lib/copilot/answerSessionCache.test.js lib/copilot/answerPrompts.test.js app/api/copilot/answer/route.codeLanguage.test.js app/api/copilot/answer/streaming.test.js`.

**Expected:** All pass. The resolver runs beside the answer request and is never awaited — `startCodeLanguageResolution` returns `void`, so a cold cache falls through to pseudocode and delays nothing on the answer path. The four start gates run in order, before any client is constructed: the embedded engine (`AC-C21`), a non-code-bearing interview type read off the registry's own `codeBearing` field, an explicit override other than `auto` (`AC-C11c` — a stated preference is never second-guessed by a model call), and a missing `applicationId` or blank posting description. The validator is an exact substring check against whitespace-collapsed operands and nothing else — no regex, no alias table, no word-boundary, no case-folding — replacing four earlier rounds of tuned pattern-matching that a hyphen inside "C#" and a generic term like "node" both defeated in different ways. `"none"` is cached for the full 30-minute TTL exactly like a real language, so a transient network failure and an honest abstention are indistinguishable from the outside for half an hour; `peekCodeLanguage` treats a cached `"none"` as a miss on purpose (never serving it as a resolved token) but does not shorten its TTL or retry it early. The language-evidence link is not machine-checked — the validator confirms the quoted span is real and the language is a member of the allowed seven, but ties neither to the other semantically — so the single `console.info("[copilot:code-language]", …)` line in `answerCodeLanguage.js`, carrying `applicationId`, the raw pre-validation language, the validated language, an `admitted` boolean, and the evidence span, is what a reviewer reads instead of a machine check. `buildPointsPrompt.length` is still exactly `7`. The emitted "--- CODE LANGUAGE ---" block carries the LABEL (e.g. "C#") on both the preference line and the posting-inferred line, never the stored slug (`csharp`) — and the posting-inferred line is worded as a guess ("reads as a … role … treat it as a guess, never as a fact about the employer") rather than an assertion about the employer's actual stack. The posting description provably never reaches `buildPointsPrompt` or `buildAnswerPrompt` — only the resolved token and the override slug cross that boundary, on both the points path and the streaming path.

### R-275 | area: copilot-code-language | parallel-safe: yes | automatable: partly

**Summary:** The "Code language" control appears on both tabs exactly when it can do something, persists and cross-tab-syncs under its own key, joins every answer cache key so a re-asked question redrafts under the new language, and never yanks focus out from under a keyboard user — while destroying nothing the candidate produced and claiming nothing the user can't yet see.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/copilot/useCodeLanguage.test.js app/copilot/CodeLanguagePicker.test.js app/copilot/CodeLanguageField.test.js app/copilot/InterviewTypePicker.test.js app/copilot/SessionSetup.test.js app/copilot/practice/PracticeSetup.test.js app/copilot/useDraftAnswer.codeLanguage.test.js app/copilot/useLiveCodeLanguageChange.test.js app/copilot/practice/usePracticeCodeLanguage.test.js app/copilot/practice/PracticeClient.codeLanguageWiring.test.js app/copilot/practice/useRoomQuestions.codeLanguage.test.js lib/copilot/answerGrounding.test.js lib/copilot/sampleAnswerState.test.js`.
2. Manual (`automatable: no`): at `/copilot`, select "Technical / coding" and confirm the "Code language" control appears **between** the interview-type picker and the posting picker on both the live and practice tabs, disappears entirely (not greyed out) when the interview type is switched back to "General / mixed", and never appears at all on the embedded engine.
3. Manual (`automatable: no`): start a live answer under `Auto`, switch the language to Java, and confirm the on-screen answer redrafts. Repeat the language change from a second window on the same origin and confirm the first window's answer does **not** redraft.
4. Manual (`automatable: no`): on the practice tab, reveal a sample answer, change the language, and confirm the answer stays on screen unchanged and uncaptioned, that the recording and its review are untouched, and that pressing Regenerate (or re-asking the same question) produces a fresh draft rather than serving the cached one.
5. Manual (`automatable: no`): with the "Code language" select focused, change the interview type to "General / mixed" **from a second window**, and confirm focus is not thrown to the top of the document or to `<body>` — the control stays mounted until you tab or click away from it, then disappears.

**Expected:** All automated cases pass. The control's value is read by a synchronous `getCodeLanguage()` at each capture point (`useDraftAnswer.js`'s `runDraft`, `useRoomQuestions.js`'s `runDraft`), proven by changing the language and starting a draft inside the same synchronous turn. The language joins `groundingFor`'s key through the shared `normalizeField`, alongside `profile`, `interviewType` and `applicationId`, so an omitted field and an explicit `"auto"` stay distinguishable; re-asking a question after a language change is a cache MISS, never a reused hit. On the practice tab the language subscriber calls `discardDraftedAnswers` and nothing else — no `resetAnswerState`, no `abandonInProgressAnswer`, no `clearSessionScores`, no `resetQuestions` — and no staleness caption is added anywhere, because chunk C resolves a language but emits no code, so there is nothing on screen yet for a caption to describe a difference in (the visible mark is a later feature; `PracticeClient.js` still renders `<CopilotDashboard>` passing no `staleTypeChangeAt`, so that slot is untouched and free). On the live tab the subscriber is origin-blind by design — a change from another window still leaves the current window's cached answer stale under the language actually selected — and clears the cache and bumps the draft generation unconditionally, redrafting only when the caller's own `canRedraft` allows it. The storage-blocked sentence renders exactly once per surface, by construction rather than coordination: `InterviewTypePicker` keeps reading its own store unchanged, and `CodeLanguagePicker` appends the sentence only when the language store is blocked and the interview-type store is not, so both-blocked yields one sentence (from the interview-type picker) and neither-blocked yields none — there is no shared latch for the two to disagree over. Step 5's property is `CodeLanguageField`'s deferred-unmount: a foreign interview-type change that would close the gate while the control is focused sets a deferred flag instead of unmounting immediately, and the deferral clears (re-evaluating the gate normally) the moment focus leaves the control — the same class of failure `SpeakerChip.js`'s BUG-2 names for `document.activeElement` falling back to `<body>`.

### R-276 | area: page-ranking | parallel-safe: yes | automatable: yes

**Summary:** `rankPagesByRelevance` now picks the page that answers the question rather than the page that happens to share the most words with it. Four failures that were MEASURED before they were fixed — invisible acronyms, interview boilerplate counted as evidence, a long page winning a tie it reached by being long, and a common term outvoting a rare one — are pinned as fixtures that fail under the old rule and pass under the new one. This replaces the ranking rule R-252 recorded, and it moves three surfaces at once.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/rankingQuality.test.js`.
2. From `hello-world`, run `npx vitest run lib/experience/knowledgeBase.test.js lib/meeting/meetingContext.test.js lib/copilot/storyMatchHonesty.test.js app/api/copilot/answer/route.roleTermsUnbacked.test.js`.
3. Read `hello-world/lib/experience/pageRanking.js`: `K1`/`B`, `RANKING_TOKEN_RE`, `RANKING_STOPWORDS`, the character-length loop in `documentStats`, and the idf line inside `rankPagesByBm25`. Read `rankPagesByRelevance` in `hello-world/lib/experience/knowledgeBase.js` and confirm it is a one-line delegation.

**Expected:** All pass — step 1 was 6/6 and step 2 was 101/101 when this case was written. The rule is Okapi BM25 at `k1 = 1.2`, `b = 0.75`, a 2-character token floor, no stemmer, query terms filtered through `lib/llm/engines/tailor-lite/data/stopwords.json`, document length in CHARACTERS, smoothed idf `ln(1 + (N - df + 0.5) / (df + 0.5))`, and ties still broken on `position` ascending.

**The four behaviours, each separately checkable, each with what the OLD rule scored.** They are the four `it` blocks in `rankingQuality.test.js`; each one fails if you restore the old distinct-term overlap count, which is how the fixtures were validated in both directions.

1. **Short technical tokens are no longer invisible.** "…scaled our API to handle 10x traffic using AWS, SQL and Go" finds the page that names AWS, SQL and Go (`:52`). The old 4-character floor deleted `aws`, `sql`, `go` and `10x` from BOTH sides symmetrically, so the target scored **0** and a "Traffic planning notes" decoy won outright on **2** (`traffic`, `using`). Now 2.004 vs 0.978.
2. **Interview boilerplate is not evidence.** A "Billing rewrite sign-off" page beats an "Interview prep" page on a behavioural question (`:90`). The old rule scored the boilerplate **6** and the real page **4**, because `time`, `about`, `what` and `situation` counted. Now 2.619 vs 1.711 — and note it is NOT won by silencing those words: `time` and `situation` are not in the stopword list and still score. It is won by df (`approach` sits on both pages) plus length normalisation.
3. **A long page cannot win a tie it only reached by being long.** A 60-bullet "Platform notes" page that mentions ledger sharding once loses to a 70-character "Ledger sharding" page (`:114`). Both carry both query terms, so the old rule scored them **2 and 2** and the tie fell to `position` — which the sprawling page won by sitting higher in the sidebar. Now 0.645 vs 0.262.
4. **A term on most pages loses to a rare one.** Across five pages where four say "ledger" and "built" and one says "reconciliation", the reconciliation page wins (`:139`). The old rule scored the platform page **2** and the answer **1**. Now 1.278 vs 0.722: one occurrence of a term on 1-of-5 pages outweighs three occurrences of a term on 4-of-5.

Two more cases guard the change from being a trade. `:157` is the control — the obvious case the old scorer already got right, whose LOSER must still score non-zero (0.178) or it can only detect a ranker that has stopped working entirely. `:174` is AC-1.4's byte-identity guarantee: an empty query produces an empty term set, `weights` stays empty, every page scores literal 0 before any arithmetic runs, and the stable sort falls through to `position`.

**THE PROPERTIES THAT WOULD SILENTLY RE-BREAK THIS, and every one of them looks like an improvement.** This is the most valuable part of the case: each was verified by actually flipping it, and each leaves the code looking better while a fixture quietly inverts.

* **Adding a stemmer.** Cases 1, 2 and 3 depend on `scaled` ≠ `scale`, `convince` ≠ `Convinced` and `sharding` ≠ `Sharded`. **The distinction is finer than the test file's own comment at `:69-72` says, and that comment is slightly wrong** — a naive trailing `-ed`/`-ing`/`-s` strip does NOT break case 1 (it makes the query `scal` while the decoy's page still reads `scale`; the target wins all 12 `(k1, b)` combos at floor 2). What breaks it is a **Porter-class** stemmer that also folds a silent `e`, so `scale` → `scal` matches `scaled` → `scal`: the decoy regains the term and takes the win at the shipped `k1 = 1.2`, `b = 0.75`, in 4 of 12 combos at floor 2 and 29 of 36 across the floor sweep. "I only strip suffixes, I didn't add a real stemmer" is not a defence — check whether the rule folds `e`.
* **Measuring document length in tokens instead of characters.** `knowledgeBase.test.js`'s "STOPS at the first page it cannot fit" case (`:412`, a recorded mutation SURVIVOR) has an `unsplittable` fixture that is four real words plus an 800-character run of the letter `w` — ONE token. Under token length it reads as short and dense, outranks a shorter and more relevant page, is attempted first, cannot be excerpted, and packing stops having included nothing. Reproduced, not hypothesised.
* **Dropping the `1 +` from the idf.** The classic `ln((N - df + 0.5) / (df + 0.5))` goes NEGATIVE whenever a term is on more than half the candidates. Case 3's two pages both carry `ledger` and `sharding` (df 2 of 2), which sends the weight to `ln(0.5/2.5) = -1.609` and makes matching a query term LOWER a page's score, inverting the winner. The `+ 1` is what guarantees containing a query term is never a penalty.
* **Raising the token floor.** `aws` and `sql` need ≤ 3; `go` needs 2. Case 1 is unsatisfiable at floor 4 and barely satisfiable at floor 3 — its margin there collapses to a few hundredths at high `k1`/`b`, and under a stemmer it inverts outright.
* **Computing df over anything other than the array passed in.** `rankPagesByRelevance` is called with an already-filtered `usable` list; every fixture's arithmetic assumes df and avgdl are scoped to exactly that call's own candidates. Widening it to all of the user's pages, or memoising it across calls, silently changes every case's numbers. This is also why `weights` is rebuilt per call rather than cached.
* Two smaller ones with the same character, for completeness: **changing the tie-break away from `position` ascending** turns case 6 and `knowledgeBase.test.js:72-86` red, and **an early `return pages` on an empty query** looks like a free optimisation while silently dropping the position sort every current caller gets.

**The narrowest margin, named, so a future change knows what breaks first: case 3, "does not let a long page win a tie it only reached by being long."** It is the only case whose separation comes entirely from length normalisation — both terms have df 2 of 2, so idf is identical and cannot separate anything — which means its margin is a direct function of `b`. At the shipped `b = 0.75` the gap is 0.383; in the independent `k1`/`b` sweep it narrows monotonically as `b` falls and reaches **0.036 at `b = 0`, `k1 = 0.5`**, the smallest margin anywhere in the 25-combination sweep. Every combination still passes, so the rule is not tuned to a lucky constant — but anyone lowering `b` is spending this case's headroom first, and should re-run step 1 rather than reason about it.

**THIS IS A SHARED RANKING CONTRACT — a change here moves three surfaces, deliberately.** `lib/meeting/meetingContext.js:139` is `export const rankMeetingPages = rankPagesByRelevance` — a direct alias, so the interview copilot and the meeting copilot cannot disagree about what "relevant" means. `app/api/copilot/answer/route.js` reaches the same function through `buildKnowledgeBaseBlock`. Ranking changed for all three at once, which is the point: the alternative is two rankers drifting apart. It is equally the hazard — a tweak made to fix one surface's fixture silently re-orders the other two, so step 2 exists to be run beside step 1, never instead of it. The scorer lives in its own module because the obvious place to put it is `lib/copilot/projectStories.js`'s `significantTerms`, which is pinned byte-for-byte by a frozen oracle, shared with the embedded engine's honesty gate, and shipped into the browser bundle; `pageRanking.js` is imported by nothing client-side.

**One fixture was rebuilt, and the property that moved is recorded rather than quietly dropped.** `app/api/copilot/answer/route.roleTermsUnbacked.test.js`'s `FILLER_PAGE` had been engineered against the OLD scorer: it out-ranked by repeating ten words that are all stopwords or interview scaffolding — exactly the defect this change removes. Under BM25 eight of those ten are deleted from the query outright, the filler fell to 0.996 against 10.588, and the file's own tripwire self-check went red. **Sabotage proved this was not cosmetic:** patching the route to read from `kb.block` instead of the story text was CAUGHT under the old ranker (2 failures) and SURVIVED under the new one — `:388` and `:544` had become tautologies that still passed. The rebuilt body repeats eight of the question's own terms that the real page does not carry, which restores the divergence through the gap between BM25 (rewards term frequency) and `overlapScore` (counts distinct terms): filler 11.99 vs 9.75 on BM25, 8 vs 9 on `overlapScore`, and the same sabotage fails 2 tests again. **What genuinely changed: the starving page used to be boilerplate that could never be spoken as the candidate's own experience — it now clears `clearsHonestyGate` with `distinctiveCount 8` and loses `selectBestStory` on SCORE, not on eligibility.** In that file eligibility was only ever a means to the divergence, never the assertion. The displaced property is still pinned directly and by name in `hello-world/lib/copilot/storyMatchHonesty.test.js` at `:56`, `:92`, `:137`, `:167` and `:245`, each a `matched === false` on a boilerplate page. Note the new premise is a ONE-term `overlapScore` margin, asserted outright in the self-check at `:332` rather than left implicit: push the filler to 9 and it becomes the story, and `:388`/`:544` fail loudly instead of going quiet.

### R-277 | area: gmail-oauth | parallel-safe: yes | automatable: partly

**Summary:** The Gmail OAuth `state` is now HMAC-signed, bound to provider + user + session, expiring and single-use, and it is verified BEFORE the authorization code is exchanged — while the user id that receives the tokens comes from `supabase.auth.getUser()` and never from the URL. Previously the callback decoded an unsigned base64url `{userId}` out of the `state` parameter and called `saveTokens(decoded.userId, tokens)` with it, so an attacker could hand-craft a state naming their OWN user id, send a victim a GENUINE Google consent link, and have the VICTIM's Gmail tokens stored under the ATTACKER's account. Tokens live in Redis keyed by user id, so the app's row-level security was irrelevant to the blast radius, and the victim never needed a session with this app at all.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/oauth/state.test.js app/api/gmail/connect/route.test.js app/api/gmail/oauth2callback/route.test.js` — 3 files, **44 tests**. Full suite at the time of writing: `Test Files 396 passed (396)` / `Tests 6599 passed (6599)`.
2. Read `verifyOAuthStateInner` in `hello-world/lib/oauth/state.js` — the check order, what `computeMac` is fed, what `replayKey` is derived from, and the module-level `throw` at `:17-21`. Then read `hello-world/app/api/gmail/oauth2callback/route.js:35-64` and confirm the id passed to `saveTokens` at `:77` is `user.id` from the session, with no reachable path from `stateParam` to a user id.
3. Manual (`automatable: no`): connect Gmail end to end against a **deployed** instance — sign in, hit `/api/gmail/connect`, complete Google consent, and confirm the callback lands on `?gmail_status=connected` and that `/api/gmail/status` reports connected afterwards. **No test in this repo can reach this**, and it is the single load-bearing assumption of the whole fix; see the SameSite paragraph below.

**Expected:** All 44 automated cases pass, and step 3 succeeds. The wire format is `PAYLOAD_B64 "." MAC_B64`, the MAC key is `HMAC(secret, "oauth-state-v1")` so the raw `GOOGLE_CLIENT_SECRET` is never itself the signing key, the state TTL is 10 minutes and the replay key is `oauth_state:<hex of the verified MAC bytes>` at a 15-minute TTL. Verification order matters and is asserted: signature first, untrusted JSON parsed only after it passes, then expiry, provider, user, session, then the atomic `SET … NX` replay claim — which runs BEFORE `getToken`, so a Google-side exchange failure burns the state (deliberate; T28 pins it).

**The eight tests that must go red on a route-only revert** — both routes to HEAD, `lib/oauth/state.js` kept in place — are **T12, T13, T14, T15, T16, T19, T22, T23**. That revert was actually run and reds 16 tests in total. This is the list to check first if this case ever needs re-validating: `lib/oauth/state.test.js`'s T1-T11 all stay GREEN under a route-only revert, because the helper still exists and still works — they are not wiring evidence, and treating them as such is exactly how a correctly-built control ships un-wired. **The positive controls that must stay green against any fix preserving the happy path are T17, T18, T20 and T21**, and both over-fix directions were run to prove they bite: a callback that rejects everything reds T17/T17b, and a connect route that refuses everyone reds T21 (T20's 401 correctly stays green, since refusing everyone is what it asserts).

**THE PROPERTIES THAT WOULD SILENTLY RE-BREAK THIS.** Fifteen mutations were run against the real implementation, not a reference; fourteen went red. The ones that teach something:

* **Keying the replay store off the raw `state` string instead of the hex of the VERIFIED MAC bytes.** base64url is non-canonical: a trailing `=`, `==`, `\n` **or a space** all decode to byte-identical MAC bytes, so a state-string-keyed replay check is bypassed by appending one character. Reds the four T7b malleability cases and route-level T16b. The hex of the verified 32 bytes is canonical, which is the whole reason the key is derived from it.
* **Computing the MAC over the DECODED payload bytes instead of the payload segment string AS RECEIVED.** This is the other malleability direction, and it is independently detected — appending `=` to the payload segment must come back `bad-signature`, which it only does because `computeMac` is fed `payloadB64` verbatim. Reds T7b's payload case plus T8 and T9.
* **`secret || ""`.** `createHmac("sha256", "")` does not throw — it SUCCEEDS and yields a valid MAC under an empty, publicly-known key, so every attacker can mint states. `undefined` and `null` throw loudly; the natural defensive `|| ""` is the silent total defeat. `readSigningSecret` returns null for missing, empty and whitespace-only, and reds T27 when mutated to default.
* **Caching the signing key in a module-level `const`.** The secret must be read from `process.env` AT CALL TIME. Caching it reds 38 of the 44 tests, so this one at least fails loudly.
* **`if (!result)` where `if (!result.ok)` was meant.** Fail-OPEN, because `{ok:false}` is truthy. The discriminated result does not structurally prevent this — T26 is the only thing that catches it, and the mutation reds 10 tests.
* **Losing `nx` on the replay claim** (reds 8 — the claim stops being atomic and stops being single-use) and **removing the 32-byte MAC length check** (reds T3 only, and by a degraded reason code rather than an accept — `timingSafeEqual` throws on a length mismatch, and the outer catch turns that into `malformed` anyway, so the check is load-bearing for the reason, not for the rejection).

**The one mutation that stayed green, and what closed it.** Lowering the replay TTL below the state TTL left all 44 tests passing: the test fakes ignore the `ex` option, so a still-signature-valid state becoming replayable once its replay key expired was an invariant enforced by nothing in the tree. It is now a module-level `throw` at import time in `lib/oauth/state.js:17-21`, proven the only way it can be — mutate `REPLAY_TTL_SECONDS` below `STATE_TTL_MS` and assert the import itself rejects. There is no `it` block for it and there cannot usefully be one; the guard is the code.

**`NextResponse.redirect` defaults to 307, not 302** (`node_modules/next/dist/server/web/spec-extension/response.js:99`). A rejection is observable as `gmail_status=error` in the `Location` and `saveTokens` never being called — **not** as a status code, and an entry or test written to assert 302 fails against both HEAD and the fix. **No `NextResponse.redirect` call in this repo may gain an explicit status argument**; a repo-wide sweep confirms all nine sites pass no init and therefore default to 307.

**Why deriving the user from the session works at all on Google's cross-site redirect:** the Supabase auth cookie is `sameSite: "lax"`, hardcoded at `node_modules/@supabase/ssr/dist/main/utils/constants.js:6` with no override anywhere in this repo, and `Lax` is sent on a top-level cross-site GET. **This is verified statically only and NO TEST CAN REACH IT** — every test in all three files mocks Supabase. If it were wrong, Gmail connect would fail for 100% of users with a silent `reason=no-session`. That is what step 3 exists for, and it is the reason this case is `automatable: partly` rather than `yes`.

**What this does NOT fix, recorded so it is not mistaken for closed.** An attacker who can READ a victim's unused state — shared machine, browser history, a malicious extension, a proxy, log access — can still force-connect their own Google account within the 10-minute TTL: there is no PKCE and no HttpOnly double-submit cookie, and the state travels in the URL. Single-use bounds this to one shot only when Redis is live. Separately, **rejections are silent to the user**: nothing in the tree reads `?gmail_status=`, verified with three independent instruments including a sweep of the compiled `.next/` bundle, so a rejected callback shows the user nothing at all — expired state, session blip, account switch mid-flow and a burned state are four indistinguishable silences, and the server log is the only place they differ. Finally, single-use degrades open when the replay store is unavailable. That is deliberate and structurally sound — the replay branch is reached only after every other check has passed, so it can only ever ADD a rejection, never authorise one — and both the helper and the callback now log when it happens, which is the difference between an accepted degradation and an invisible one.

**One side effect worth knowing, with no test pinning it.** The old `console.error("Gmail OAuth2 callback error:", err)` was `util.inspect`-ing a `GaxiosError` whose `config` is a deep copy of the request, so the authorization code, `client_id`, `redirect_uri` and potentially `client_secret` were written to the logs on every failed token exchange. The new message-only log at `oauth2callback/route.js:81` fixes that as a side effect. **Nothing pins it** — T19 covers only the verify-rejection log, and T28 drives the exchange branch with a synthetic `Error`, so a future change reverting to logging the whole error object would go unnoticed.

### R-278 | area: document-preview-versions | parallel-safe: yes | automatable: partly

**Summary:** Picking an older version in the preview's version control now actually serves that version's document. `selectDocumentVersion` rewrote `result`/`resultLines` and cleared the cached HTML but never touched `entry.docxB64`, so `resolveDocumentBlob` kept handing back the NEWEST generation's bytes — the preview and the download both showed a different document than the one selected, and the control was effectively inert. **No test anywhere referenced `selectDocumentVersion`.** The fix repoints the résumé at the selected version's own `docx_path` and clears the cover letter's stale bytes; a second fix threads that pointer through both download entry points, which were quietly using the same field as their rebuild template. Ships in the same wave as the extraction of `buildPreviewBlob`, `previewBlobArgs`, `editedForScope`, `withEditedScope` and `scopeText` out of `app/hooks/useDocumentPreview.js` (963 → 934 lines) into the new `lib/document/previewBlob.js`.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism lib/document/previewBlob.test.js lib/supabase/documentVersions.test.js app/hooks/useDocumentPreview.wiring.test.js app/hooks/useDocumentPreview.download.test.js`. Full suite at the time of writing: `Test Files 400 passed (400)` / `Tests 6695 passed (6695)`.
2. Read `selectDocumentVersion` in `hello-world/app/hooks/useDocumentPreview.js` and confirm BOTH branches write the byte source, not only the text: the résumé branch sets `docxB64: ""` **and** `docxPath: version.docx_path || ""`, the cover branch sets `coverLetterDocxB64: ""`. Read `COLUMNS_BY_SCOPE` in `hello-world/lib/supabase/documentVersions.js` and confirm `docx_path` is in the résumé select string only.
3. Read the résumé branch of `downloadDocxFiles` in `hello-world/lib/document/docx.js` — `docxPath: docxPath || templateDocxPath || ""` beside `edited: !docxB64 && !docxPath` — then confirm both callers that can see a version-switched `tailoringMap` entry pass it **unconditionally**: `useDocumentPreview.js:535` and `docx.js:702` (`downloadResumeForChipJob`).
4. Read `hello-world/lib/document/previewBlob.js` and confirm the hook imports and calls all five symbols and defines none of them, and no longer calls `resolveDocumentBlob` itself.
5. Manual (`automatable: no`): against a running app with a signed-in user and a posting that has several generations — open the preview, switch to an older résumé version, and confirm the rendered document AND the downloaded `.docx` are that version's content in the engine's formatting. Then hand-edit a line and download again: the edit must be present and the formatting must still be the engine's, not your uploaded résumé's. **No test can reach the real storage fetch**; the suite proves the pointer is threaded and used, not that Supabase returns the right object.

**Expected:** All automated cases pass, and step 5 shows the selected version in both surfaces. After a switch the résumé entry carries `docxB64: ""` with `docxPath` pointing at that generation's stored document, so `resolveDocumentBlob` fetches and serves (unedited) or fetches and rebuilds onto (edited) the correct engine doc. Switching back to the newest version serves the newest bytes again. A résumé switch never disturbs the cover letter's bytes and vice versa, and `withEditedScope` still clears only the switched scope's edited flag.

**THE PROPERTIES THAT WOULD SILENTLY RE-BREAK THIS.** Two independent verification passes ran 12 and 4 mutations against the real implementation; every one reddened the suite except one, which is now closed. The ones that teach something:

* **Leaving the inline copies in the hook and never importing the new module.** Reds five assertions in the adoption block — *including the shrink ratchet*. This is the load-bearing half: this project once shipped 27 green tests for a component extraction against a caller that imported none of them. An extraction suite that only tests the new module proves nothing about the old one.
* **`editedForScope` reduced to `return !!entry.edited`.** Reds **26** tests. `edited` is a PER-SCOPE OBJECT (`{ resume, cover }`) and an object is always truthy, so this reads as "edited on both scopes" forever. Never `if (entry.edited)`.
* **The résumé default text reduced to `scopeText(entry, scope)`.** Looks like removing a duplicate. With an empty `result` and a populated `resultLines` it yields `""`, which flips `resolveDocumentBlob`'s `hasText` to false and serves the engine doc verbatim instead of rebuilding the edited text onto it. The correct formula, preserved from before the extraction, is `entry.result || lines.join("\n")` — and `scopeText` is deliberately NOT it.
* **Adding `docx_path` to a SHARED select string instead of per-scope.** `generated_cover_letters` has no such column, so the cover query fails with PostgREST `42703`, which `documentVersions.js:61-64` SWALLOWS (`console.warn` then `return []`) — the cover letter's entire version history vanishes with no error anywhere. The test that catches it asserts a **non-empty** cover list and is backed by a lenient-client positive control proving the fixture can produce cover rows at all; a "does not throw" assertion would prove nothing here, because not throwing is the defect.
* **"Just clear `docxB64`" without writing `docx_path`.** Reds the reloaded-entry route, which otherwise falls through to `docx.js:489` and serves the pointer generation.
* **Blanking the byte source unconditionally for both scopes.** Passes the two routes above and reds "switching back to the newest version serves the newest bytes again".

**The one mutation that stayed green, and what closed it.** Deleting the `templateDocxPath` argument at `docx.js:702` (`downloadResumeForChipJob`) left all 400 files / 6694 tests passing — nothing in the tree called that entry point. It is now pinned by a second `it()` in `app/hooks/useDocumentPreview.download.test.js` that drives the chip download directly; deleting the argument now fails with `expected [] to include 'user-1/generated/r1.docx'`. This is exactly what the project's "Download rebuild formatting" note exists for: multiple download entry points, and this is the one that keeps getting missed.

**The regression the D-1 fix itself introduced, recorded because it is the shape of the next one.** `entry.docxB64` is not only the preview's byte source — it is also the REBUILD TEMPLATE the download uses (`useDocumentPreview.js:528` sets `templateDocxB64` from it), and `docxPath` was previously supplied only when serving an UNEDITED document. So *generate → switch to an older version → hand-edit → Download* fell through to the user's generic uploaded résumé (engine formatting lost) or returned `null` with "Upload the source resume as .docx to download." Before the fix that same click produced the wrong pointer with right formatting; after it, right content with wrong formatting. Both wrong. **All 7 call sites of `downloadDocxFiles` were enumerated by search, with a verdict each**: two can see a version-switched `tailoringMap` entry (the preview download and the chip download) and both now pass `templateDocxPath`; the other five build their arguments from database rows and are unreachable by the clear. `downloadAutoTailoredResume` is exempt BY CONSTRUCTION, not by luck: `docx.js:609-616` selects from `generated_resumes` by `row.resume_used_id`, so it never sees `tailoringMap` at all.

**The download test is not vacuous.** It unzips the produced Blob and reads `word/document.xml`, asserting the hand-edited lines are physically present and that the generic template's `4A5568` colour marker is absent. Both fixtures were pushed through the real `buildDocxFromUploadedTemplate` to confirm the marker survives the exact transformation the assertion depends on — the strong form of the check this repo's "fixture pair that normalised to the same thing" history demands. Note the storage-read probe fires first under a revert of either half of the fix; the `4A5568` assertion is what separates "asked storage" from "used what storage returned", since `resolveDocumentBlob` falls through to the uploaded template silently when the fetch fails.

**Two degradations, accepted, recorded so they are not mistaken for bugs.** `generated_cover_letters` has no `docx_path` column, so a switched-to cover-letter version renders from the uploaded cover template — or as plain text when none is uploaded — for the rest of the session. Accepted: right content unformatted beats wrong content formatted, which is what shipped before. The comment at the clearing site names both wrong "fixes" (restoring the stale bytes; adding the column here). **The same degradation reaches résumés** for pre-migration rows: `docx_path` is nullable with no backfill and is written only when a `docxB64` existed (`persistGeneration.js:65`), so those switches have no pointer to thread and land on the uploaded template too.

**`editedForScope` now exists in two modules and cannot be trivially deduped.** `lib/document/previewBlob.js` (exported) and `lib/document/docx.js` (private). The count was 2 before this change and is 2 after, so it is not a regression — but `previewBlob.js` imports `docx.js`, so importing back is a cycle. Deduping needs a third shared module and is its own change; do not attempt it as a drive-by.

**The hook sits at 934 against a `toBeLessThan(935)` ratchet — one line of margin.** The room came from real extraction, not from trimming: comments removed 18 / added 21, code removed 46 / added 16, and the hook's OWN comment count went UP, 246 → 249. The next change that touches `useDocumentPreview.js` must extract into `lib/`. Do not delete comments to fit, do not raise the constant, and do not move lines into another file that has its own cap.
