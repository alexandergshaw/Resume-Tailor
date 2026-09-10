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

