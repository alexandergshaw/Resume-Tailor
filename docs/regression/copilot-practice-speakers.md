### R-153 | area: copilot-practice-speakers | parallel-safe: yes | automatable: yes

**Summary:** Practice mode's delivery metrics count only the candidate's own words, now that its single microphone is diarized and another person in the room lands in the same transcript stream.

**Steps:**
1. Read `partitionAnswerFinals` and `answerMetricsInputs` in `hello-world/lib/copilot/answerSpeakers.js`.
2. Read where `doneAnswer` in `hello-world/app/copilot/practice/usePracticeAnswer.js` consumes them.
3. Run `npx vitest run --no-file-parallelism lib/copilot/answerSpeakers.test.js lib/copilot/answerMetricsInputs.test.js lib/copilot/answerWindow.speaker.test.js` from `hello-world/`.

**Expected:** Untagged finals are ALWAYS the candidate's, which is what makes the no-diarization path - every existing practice user - a special case of the general one rather than a separate branch that can drift, and what stops a final the provider could not attribute from being silently dropped from the candidate's word count. Dominance is by WORDS, not by number of finals: an interviewer interjecting "Right" three times must not outrank one long answer. Order within each half is preserved, because the span derivation takes the FIRST timed entry in list order rather than the minimum, so reordering would silently move an answer's start. The input list is not mutated.

Every number derived from the collected finals reads the candidate's half: word count, words per minute, pace label, filler count and rate, discourse-marker count and rate, sentence count, longest sentence, the speech span - and the transcript TEXT that is saved and sent for critique, since another person's sentences would otherwise be graded as the candidate's.

**Both halves of the pair are asserted deliberately.** This is R-127's shape: contamination inflates the WORD COUNT (a sum) while barely moving the SPAN (a min/max), so the two stay superficially coherent while one is wrong. R-127 shipped a 98-word answer measured as 196 words at 367 wpm, and the critique told the user to be more concise and slow down. A span that is merely too LONG makes words-per-minute read too SLOW, which is advice a candidate would act on.

Note the history: this protection originally shipped inside a React hook, where sabotaging it turned NOTHING red across the whole suite - at the time `vitest.config.js` was `environment: "node"` with no jsdom in the repo at all, so no hook could be mounted. The composition was moved into `lib/` for exactly that reason, as `answerWindow.js` and `answerPoints.js` already were. Do not move it back. **Amended: the "no jsdom" half of that sentence is now false and must not be cited as a current fact.** `jsdom` (`^29.1.1`) is a devDependency, `environment: "node"` is only the suite DEFAULT, and any single file opts into a DOM with a `// @vitest-environment jsdom` docblock on its first line (R-172, whose worked example is `app/components/JobDescriptionTab.test.js`; `app/copilot/AnswerLines.pageSources.test.js` is the copilot one). That makes mounting POSSIBLE, not preferable: extracting the decision into `lib/` is still the first choice, this composition stays in `lib/`, and the sabotage result recorded above stands as the reason it was moved.

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

**Known coverage gap:** the hook's wiring of that decision into `onUtterance` is glue reachable only by mounting a hook, which this repo cannot do. Making the detector ignore the rule entirely turns nothing red. The DECISION is pure and tested; its application is verified by reading. **Amended:** the claim that this repo "cannot do" that is no longer true. A hook mounts under a per-file `// @vitest-environment jsdom` docblock (the infrastructure case is **R-172**), so glue like this IS reachable now. **This amendment previously named `app/copilot/useCopilotDashboard.wiring.test.js` and "see R-166"; BOTH were dead.** That file was DELETED in commit c06f9c3 with the retired prediction pair, and R-166 was itself the retired prediction-visibility case (see R-237), never the jsdom-infrastructure one. The live examples are `app/copilot/useCopilotDashboard.noSpeculation.test.js`, which its own header records as the replacement for the deleted file, and — for this case specifically — `app/copilot/practice/useRoomQuestions.ownSpeech.test.js`, which mounts THIS VERY HOOK and asserts on the real `global.fetch`, with the deliberately-unmocked detect/answer clients in the path and a positive control opening each block. **That means this case's gap is at least PARTLY CLOSED, not open as written:** "making the detector ignore the rule entirely turns nothing red" is no longer true — that file asserts silence for the candidate's own speech (untagged, `null`/`undefined` `myTag`, and the learned tag after an answer completes) against positive controls that someone else's question really does reach both routes, so a detector that ignored the rule fails there. Whether EVERY branch of `shouldTreatAsRoomQuestion`'s wiring is covered was not re-audited when this amendment was written; treat that as the open remainder, and close it by adding cases to that same file rather than accepting "verified by reading".

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

