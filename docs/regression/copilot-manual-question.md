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

