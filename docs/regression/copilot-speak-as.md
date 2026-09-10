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

