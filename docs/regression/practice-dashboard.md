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

### R-122 | area: practice-dashboard | parallel-safe: yes | automatable: no

**Summary:** Revealing the practice dashboard's current answer moves focus into it instead of dropping it to `<body>`.

**Steps:**
1. In practice mode, with a current question on screen and its answer still hidden, Tab to the dashboard's "Show sample answer" button (`CurrentAnswerPanel` in `hello-world/app/copilot/dashboard/CopilotDashboard.js`) and press Enter/Space.
2. With a screen reader running (NVDA/JAWS) or by watching the visible focus outline, note where focus lands immediately after the press.
3. Repeat for a question whose answer is already cached (R-111), so the reveal resolves straight to `done` with no visible loading spinner in between.
4. Read `CopilotClient.js`'s `CopilotDashboard` call site (`hello-world/app/copilot/CopilotClient.js`) and confirm it passes neither `answerHidden` nor `onRevealAnswer`. Separately, read the effect's guard condition in `CurrentAnswerPanel` and confirm it still checks `typeof onReveal === "function"` in addition to the `true -> false` transition — then construct the case that check alone defends: `answerHidden` transitioning true -> false while `onReveal`/`onRevealAnswer` is not a function (neither of today's two real call sites can produce this; it would take a future caller passing `answerHidden` without also passing `onRevealAnswer`). Confirm the guard's condition would block `revealedRef.current?.focus()` in exactly that constructed case.

**Expected:** The button the user just activated is replaced by the drafted answer's container, and focus moves into that container in the SAME interaction — never falling back to `<body>`, which used to leave a keyboard/screen-reader user with no cue except silence and a Tab from the top of the document. `CurrentAnswerPanel` puts a single wrapping `Box` (`revealedRef`, `tabIndex={-1}`) around every post-reveal branch (loading spinner, error Alert, drafted bullets, and the "no points" empty text) — not only the `done` branch — so focus lands there and stays valid across the loading -> done transition without needing to move a second time, and lands there just as correctly on a cache hit that never shows a spinner at all. `tabIndex={-1}` makes the container programmatically focusable without adding a new Tab stop. The move happens only on the `answerHidden` TRUE -> FALSE transition, tracked by a ref that starts equal to the current value (so the effect never fires on mount). These are three SEPARATE protections, and step 4 must not credit one with another's job: (a) the seeded ref is what stops a mount-time false positive, in every mode; (b) live mode passes neither `answerHidden` nor `onRevealAnswer`, so `answerHidden` holds its `false` default for the panel's entire life and the `true -> false` transition never occurs there AT ALL — that absence of any transition is what excludes live mode, independent of guard (c); (c) the `typeof onReveal === "function"` check is defence-in-depth for a hypothetical future caller that passes `answerHidden` without `onRevealAnswer` — it protects nothing in either of today's two real call sites, since neither can reach the state it defends against, so "open the live dashboard and confirm nothing fires" (the previous version of step 4) passes no matter what that check does and therefore tests nothing. `CurrentAnswerPanel`'s branch order is unchanged: `!current`, then `answerHidden`, then the status branches, now nested one level inside the focus container rather than flattened — R-110's "the `answerHidden` check comes BEFORE any status branch" still holds. Related: R-109, R-110, R-113.

