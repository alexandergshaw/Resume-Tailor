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

