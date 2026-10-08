# SESSION-HANDOFF

**Purpose:** the loop's VOLATILE head-state — things a cold restart loses because they live in the orchestrator's working memory, not in git, `backlog.yml`, or `docs/loop/*.md`. Read at session start (step 0) alongside `docs/BACKLOG.md`. Update at the end of any turn where this state changed. Keep it SHORT; prune superseded sections. A §2 "running/dispatched" line MUST carry the agent ID from a real Agent-dispatch result (N118).

_Last updated: 2026-10-07 by the orchestrator._

---

## 1. In-flight uncommitted work (the dirty tree)
- **N143 build in progress** (big dirty tree): 13 RED acceptance test files are on disk (TDD hand-off, uncommitted — do NOT commit red; green them first). Production code being added wave by wave. All N143 docs (ac r1/r2, design r1/r2, ux r1, plan r1, tests notes) ARE committed+pushed. Nothing is pushed for the CODE until the whole feature is green (single full-suite gate at the end, then one push). If this session dies mid-build: the plan is docs/loop/N143.plan.r1.md (4 waves), the TDD contracts/notes are docs/loop/N143.tests.r1.md.

## 2. Mid-flight waves / active dispatches
- **N143 Wave A** (base modules: migration, storage lib, selector, generation+prompt) — implementer a6af10ac2a4565283. Then Wave B (prewarm route, cost gate, answer-route Row-1, Row-2 sub-route), Wave C (hook+mounts, client threading+fire helper, UI AnswerAids 4 sites), Wave D (sweep recount + adoption.test.js BOUNDED). Full-suite gate after all waves, then push.

## 3. Killed / stalled residue
- None. (N134's first implementer was user-killed mid-work; the partial production edits were valid and were finished by a fresh implementer — N134 shipped.)
- **BACKLOG-STATE TRAP:** N-prefixed backlog ids MUST keep `state: "actionable"` (D→owner, V→verification); record "SHIPPED …" in the TITLE, never by changing `state`. As of N136 this is now ENFORCED PRE-PUSH by the renderGate hook (validateContract.idNamespaceViolation), so a repeat red-main from this cause is blocked at commit.
- There is NO unknown-key ban in the backlog schema (the older "unknown keys break schema" memory is stale — the parser ignores extra keys; `owner_ruling` lives on 4 items harmlessly). N139 tracks the doc-hygiene + a validateContract non-string-verify throw.
- **SHIPPED this session (all full-suite-green on main):** N134 (18453), N133 (18492), N130 pt3 (comment), N136 (18530), N139 (18546). Retro RETRO-695e23d filed + reviewed: N135/N137/N138 APPLIED as loop-memory edits; N136 shipped; R5 rejected.
- **N140 SHIPPED** 2026-10-07 (full suite 18552 green): the answer shape is now question-aware (general/mixed format no longer STAR-shapes non-behavioral questions). This is the D-1/Option B fix the N134 design predicted — the owner re-reported STAR on a "how do you approach..." Technical question and the root cause was format-driven shaping (answerShapeInstruction checked behavioral first; general's groups include behavioral). **OWNER RE-TEST pending (Gemini env):** confirm the main answer now LEADS WITH THE ANSWER on a non-behavioral question — runtime model-obedience is not unit-decidable.
- **N141 SHIPPED** 2026-10-07 (full suite 18296 green): SCORCHED-EARTH removal of the ideal-project / "ready example" feature (owner: "it needs to be gone"). 28 files deleted, 12 shared files un-wired, 24 test files pruned, sweep recounted (65/391/456). The 'Words from the posting' buzzwords aid was KEPT (owner boundary — offer to cut it too still stands). This REVERSED the earlier "DON'T TOUCH THE IDEAL PROJECTS" constraint. N125/N126/N128/N129/N130/N131 are now OBSOLETE (ideal-project tuning). N134/N140 (answer shape) STAY — they are the answer, not the example.
- **N142** filed (low/cosmetic): prune ideal-project case text from docs/regression/*.md (stage-10 reads them; not vitest-gated).
- **Non-owner-gated actionable queue:** N142 (cosmetic docs prune) is the only fresh item; otherwise owner/env-gated (§5). The decisive owner re-test for N134/N140 answer-shape quality still stands — but note the example box the owner was raging at is now simply gone.

## 3a. N134 — SHIPPED 2026-10-07 (full suite 18453 green)
- Direct-answer directive added to POINTS_SYSTEM + ANSWER_SYSTEM in lib/copilot/answerPrompts.js (first point/sentence = direct answer, rest = support; behavioral/STAR carved out). FROZEN_POINTS_SYSTEM/FROZEN_ANSWER_SYSTEM oracles updated; *_PROMPT_NO_PAGES user-prompt oracles byte-identical (no builder touched). New answerPrompts.directAnswer.test.js (54 tests, mutation controls M1-M5). ideal-project feature untouched per owner hard constraint.
- **OWNER RE-TEST (decisive):** whether answers now genuinely answer directly is Gemini-env only. If a non-behavioral question's DEFAULT (general) format still opens with a story, the pre-written follow-up is Option B/D-1 (neutralize the STAR-for-everything line in answerShapeInstruction) — OUT OF SCOPE this chunk, file as new work only after owner confirms.
- **Standing hazards (keep):** (a) full suite is ORCHESTRATOR-OWNED at integration — never have an implementer background it. (b) module-adding chunks must reconcile the two pinned counts in lib/sourceScan/exportReachability.sweep.test.js (now 536 lines; the ledger history lives in exportReachability.ledger.md — update its current-values table). (c) PowerShell cwd goes stale — use an ABSOLUTE `Set-Location "...\hello-world"` (or run render from repo root) to avoid `hello-world/hello-world` path errors. (d) comment-only / byte-identical-code changes can ship on the targeted suite + isolation pass without the 27-min full suite.

## 4. Shipped this session (2026-10-06/07), all full-suite-green on main
- **Copilot example-project quality arc** (owner: "examples are shit / no tailor made option / need it in ms"): N125 (two examples per answer: instant cached READY + question-tailored, prefetch/cache, comp-shaped R-135 guard, infra-regex fix) · N129 (tailored no longer discarded — deadline 6s->20s + maxDuration=30) · N131 (cold-start deterministic example role-neutral + >=2-hit selector bias) · N130-1 (failed tailored no longer poisons retry) · N128 (comp-guard precision: cross-line label inheritance + pay-word magnitude floor, R-135 held) · N126 (ideal-project endpoint rate-limited 40/10min).
- **N123** chat-modal aesthetic + minimize-clicks overhaul (two-row dock, composer/Send clip fix; invariants preserved; preview modal DOM-identical).
- **Infra:** census-timeout flake fix (coverBytePaths) · N127 (exportReachability sweep extracted 1130->536 under cap) · stale-comment cleanup.

## 5. Remaining — OWNER / BROWSER-gated (handed back; do NOT grind without owner direction)
- **OWNER RE-TEST (decisive):** the tailored, question-specific MODEL example now reliably appears + the cold-start placeholder is role-neutral. Whether the tailored example's CONTENT is genuinely good can only be judged in the owner's Gemini env. If still weak -> tune lib/copilot/idealProjectPrompt.js (the generation prompt). This is the next real quality lever and is owner-env-gated.
- **N123 visible-browser pass:** density, the clip-fix payoff at 380x520/280x320/phone, screen-reader reading order (result-outside-landmark), the R6b scroll re-anchor — jsdom can't judge; needs the browser pane or owner eyes.
- **N130 part 2 (low):** two client mounts of useIdealProject fire two HTTP POSTs per question (in-process dedupe already collapses to ONE model call; serverless could hit 2 instances). Fix = lift useIdealProject to a shared provider — a client refactor; deferred (risk vs gain; rate limit makes it non-urgent).
- **N130 part 3:** DONE (comment fixed). Micro-residual: route.test.js describe.skip TITLE still says "6s" (a string literal in a skipped test; cosmetic).
- **Owner-gated / env-gated older items:** N110 (LLM-judge depth, Gemini key), N115 K22/persistence, N112 OBS feed-persist, live Ideal/regenerate runtime confirms, N55/N30/N79/N80 (DB/Gmail env). Plus the large pre-existing standing backlog (N1–N100) — triaged 2026-10-05 as mostly shipped-but-listed / owner-gated / lower-value; needs owner prioritization before grinding.

## 6. Retro recommendations status
- First chunk retro (RETRO-02871af-HEAD.md) + its 5 accepted recs N116–N120 all applied/shipped earlier this session.
