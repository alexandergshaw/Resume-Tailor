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

Both functions live in `lib/copilot/answerProvenance.js` rather than inside `AnswerFeedback.js` for the same reason `answerPoints.js` and `answerWindow.js` do: `vitest.config.js` runs `environment: "node"` by DEFAULT, so a decision extracted into `lib/` is exercised by the whole suite without any per-file setup, and that extraction should not be reversed. **Amended: the justification this paragraph used to give — "no jsdom, so a claim that lives inside a component module cannot be exercised by any test" — is false and must not be cited as a current fact.** `jsdom` (`^29.1.1`) is a devDependency, `vitest.config.js`'s `oxc: { lang: "jsx", include: /\.js$/ }` block lets a JSX-bearing `.js` component be imported at all, and any single file opts into a DOM with a `// @vitest-environment jsdom` docblock on its first line (R-172); `app/copilot/AnswerLines.pageSources.test.js` mounts a real component that way with `createRoot` + `act`. Nothing about this case's claim depended on that sentence — the provenance rule is a pure decision and belongs in `lib/` on its own merits — so the case is unchanged; what is struck is only the "untestable" reason.

The write happens on BOTH the success and the error settle, inside the same `answerGenRef.current === gen` guard as the other UI writes, so an abandoned or superseded request never repaints it; `resetAnswerState` clears it. `framesWillUpload` is deliberately UNCHANGED for the privacy notice and for the `includeFrames` argument built inside `onDoneAnswer`/`onRetryCritique` — those describe what will happen on the NEXT request and must keep reading live state (R-057, R-064). Only the retrospective caption reads the recorded value. Related: R-057, R-064, R-073.

