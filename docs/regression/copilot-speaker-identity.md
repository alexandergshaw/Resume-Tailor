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

**Summary:** The transcript shows who it thinks is speaking, admits when it does not know, and lets the user correct it. Manual because steps 3-6 need two real people speaking into one microphone through a live STT provider, a real screen reader, and a pixel comparison against a pre-feature screenshot — none of which any test can supply.

**Steps:**
1. Start the app, open the interview copilot, and select the in-person interviewer-audio option.
2. Before starting a session, confirm the share instructions do not mention sharing a tab or screen, and that "Chrome or Edge only" is absent.
3. Start a session with two people speaking into the one microphone. Watch the transcript labels and the always-visible "Who's talking" bar.
4. Activate the correction control on the other person's chip and confirm every earlier turn from that voice relabels.
5. Repeat with a keyboard only. Then repeat with a screen reader listening.
6. Switch the source back to browser tab and compare the transcript against a pre-feature screenshot.

**Expected:** A speaker label never falls back to "You" -- an unresolved voice reads "Unknown speaker", and a third voice reads "Speaker N" with a number that stays stable as more voices appear. While confidence is low the UI says it is still working out who is who. The correction control is a real button, reachable by keyboard with a visible focus ring, with an accessible name naming both the voice and the action, and it is reachable WITHOUT expanding the transcript disclosure (which live mode collapses by default). The chip for the voice already resolved as the user is NOT interactive -- there is no "mark yourself as yourself" action, and making it one adds a pointless tab stop on every one of the user's own turns. A correction is announced through a polite live region from EITHER surface it can be made from. The recording notice states plainly that everyone in the room is being recorded, and does not live only inside the dismissible consent alert. In tab and system mode nothing new renders at all and the transcript is pixel-identical to before.

**Amended — the old justification was false, and it had been keeping this case unrun.** The summary line used to read "Manual because this repo runs vitest with `environment: "node"` and has no jsdom, so no component here can be rendered by a test." That is false: `jsdom` (`^29.1.1`) is a devDependency, `environment: "node"` is only the suite DEFAULT, `oxc: { lang: "jsx", include: /\.js$/ }` lets a JSX-bearing `.js` component be imported, and a file opts into a DOM with a `// @vitest-environment jsdom` docblock on its first line (R-172); over a hundred test files here already do. Because stage 10 does not execute `automatable: no` cases, a false reason on this line is not a documentation defect — it is a case that stops being checked.

**The flag nevertheless STAYS `no`, for a different and real reason.** This case's oracle is live two-speaker audio: steps 3-5 require two people talking into one microphone through a real STT provider so that diarization tags actually arrive and earlier turns actually relabel, a keyboard pass, and a screen reader; step 6 is a pixel comparison against a pre-feature screenshot. No mounted test supplies any of that, and R-150 already records that diarization against the live service has never been verified at all. Do not flip this flag until something can run.

**What IS now automatable, and is the follow-up this amendment opens.** The label DECISION is already pure and covered (`lib/copilot/speakerIdentity.js`'s `speakerDisplayLabel`/`createSpeakerIdentity`, `lib/copilot/speakerIdentity.test.js`, `lib/copilot/speakerIdentity.deafness.test.js`) — never "You" for an unresolved voice, "Unknown speaker" instead, stable "Speaker N". What is unasserted is purely the MARKUP, which is exactly what jsdom now reaches: `app/copilot/SpeakerChip.js` and `app/copilot/SpeakerBar.js` have NO test file of any kind. A `app/copilot/SpeakerChip.test.js` and `app/copilot/SpeakerBar.test.js` mounting them with `createRoot` + `act` under the docblock could pin the Chip-vs-`<button>` gate on `onActivate` (the resolved-as-user chip must NOT be interactive — no tab stop on every one of the user's own turns), the correction control's accessible name naming both voice and action, the `disabled` case still rendering a real `<button>` rather than dropping the element (BUG-2, named in `SpeakerChip.js`'s own header), and `SpeakerBar` rendering nothing until a second voice is observed and nothing at all for tab/system. Those tests do not exist today, so they are named here as work, not cited as coverage.

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

