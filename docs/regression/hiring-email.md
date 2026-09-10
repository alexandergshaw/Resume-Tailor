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

