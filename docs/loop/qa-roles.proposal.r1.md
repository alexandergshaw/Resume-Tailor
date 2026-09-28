# Proposal: QA roles in the development loop

## Why (the gap these fill)

Every test in this repo today is written by the TDD seat and runs in jsdom or node. That layer is strong at logic and wiring, but it is structurally blind to a whole class of defect, and that class keeps shipping:

- **The Gemini fact-insert bug (N89), today.** Facts refused on every Gemini cover letter because no test ever drove the real user shape (a letter with its uploaded template present) against the running app. Every fixture set `coverLetterFile: null`. 16,000+ passing tests, feature broken for the owner.
- **N36, earlier.** A `<ul>` with correct grouping and markers passed the suite and put a visible margin gap in a real Word document, because jsdom does no layout.
- The recurring class in one line: **"a complete, correct mechanism ships with the last hop to the user missing, hidden by a green suite."**

QA here means **behavioral verification against the actually-running app** — the preview/browser pane, real documents, real engine choices, fresh-vs-reloaded sessions, real clipboard and layout — exercising what a user does, not what a unit test calls. It is a distinct gate from the TDD seat's automated tests, not a replacement.

## The three roles + their checks

### 1. QA design — `loop-qa-design` (Opus, elevated)
Designs the QA test plan for a chunk: concrete, scripted user-flow scenarios to run against the running app, each with an explicit observable pass/fail condition and the evidence that would prove it. Enumerates the shapes unit tests miss — engine variants (embedded / Gemini / external), fresh vs reloaded session, real docx render, real clipboard, real responsive/dark layout, the actual click path a human takes. Output: a QA plan artifact, no code.
- **Elevated (Opus), like the TDD seat**, because a QA plan that omits the real shape is inherited by the run and the fix — exactly how N89 shipped.
- **Check (fresh, Opus):** does the plan cover the shapes that would have caught this chunk's own defect class? Is any scenario degenerate — would it "pass" without the feature present, or assert something a blank/hidden/absent state also satisfies? Does each scenario drive the real path a user takes, not a shortcut?

### 2. QA execution — `loop-qa-run` (Sonnet seat)
Executes each scenario against the running app using the preview/browser tools, and reports pass/fail **with captured evidence** — screenshot, DOM/read_page, network, console — per scenario. Output: a QA run report keyed to the plan.
- **The one non-negotiable rule: no claimed result without captured evidence.** A "pass" that did not actually run, or whose evidence does not show the asserted thing, is worse than no QA — it is a green light over a broken feature, the same failure mode the whole role exists to kill. The seat must start the app (preview_start), drive it, and attach real tool output; "it should work" is a fail-to-run, reported as such.
- **Check (fresh, Opus):** did every scenario actually execute? Is each piece of evidence real and does it actually show the asserted condition (not an adjacent one)? Was any pass inferred rather than observed?

### 3. QA fix — `loop-qa-fix` (Sonnet seat)
Fixes the defects the QA run confirmed. Implementer-class, scoped to QA findings. Writes a failing automated test first where one can exist (so the defect is guarded going forward, not just hand-fixed), applies the fix, and hands back for a QA re-run.
- **Check (fresh, Opus):** a fresh verifier confirms the fix resolves the QA finding **by a QA re-run**, not just by the new unit test, and that it regresses nothing. This is the loop's existing fresh-verifier discipline applied to a QA-found defect.

## Where the checks come from

The existing `loop-checker` (Opus, fresh, checks one artifact and never edits it) and `loop-top` (Opus, for what's inherited by everything) already do exactly this job for every other artifact type. **Rather than three near-duplicate checker role files, the QA checks are performed by these existing fresh-checker roles, with QA-specific checker questions added to the briefs.** This matches how the loop already works — one checker role checks AC, plans, tests, verification, adjudications. (If the owner prefers dedicated `loop-qa-*-check` files, they are trivial to add later; DRY is the default.)

## Where QA sits in the loop

QA is a **post-implementation behavioral gate**, after the implementer + fresh verifier have landed a chunk. Sequence:

> AC → design → plan → TDD (red) → implement → fresh verify → **QA design → QA design check → QA run → QA run check → (if defects) QA fix → QA fix check → QA re-run**

- **It runs only when the change is observable in the running app** — same discrimination as the existing preview-verification rule. A pure refactor, a types-only change, or work that the preview cannot exercise skips QA (and the QA-design seat says so and stops, rather than inventing scenarios).
- **QA findings that are out of the chunk's scope become backlog items**, not scope creep — the existing rule.
- **Iteration cap:** QA fix → re-run is bounded like every other activity — two rounds, a third is a decision that ends it (open items leave as gated backlog work). Prevents an endless QA loop.

## Model / effort tiering (matches the 2026-09-13 owner ruling)
- QA design: **Opus / high** (elevated authoring seat — its mistakes are inherited).
- QA run: **Sonnet** (a seat; mechanical driving, but the anti-fabrication rule is enforced by its Opus check).
- QA fix: **Sonnet** (implementer-class).
- All three checks: **Opus** (fresh checker / top reader).

## What gets implemented
1. `.claude/agents/loop-qa-design.md` — new role file (mirrors `loop-tdd.md`'s structure and standing rules; domain-expert framing; the elevated-seat rationale).
2. `.claude/agents/loop-qa-run.md` — new role file (the evidence-or-it-didn't-happen rule is its spine).
3. `.claude/agents/loop-qa-fix.md` — new role file (implementer standing rules + QA-finding scope + test-first-where-possible).
4. Memory updates: a new `loop-qa-seats` memory (the three briefs + their checker questions), a pointer line in `MEMORY.md`, and an edit to `development-loop.md` inserting the QA gate into the sequence with the "only when observable" discrimination and the iteration cap. The `loop-seat-briefs` index gains the three new seats.

## Open questions for the reviewer
- Should QA run be Opus rather than Sonnet, given today's stakes? (Proposed Sonnet + Opus check; the check is where fabrication is caught.)
- Dedicated checker role files vs. reusing `loop-checker`/`loop-top`? (Proposed reuse.)
- Per-chunk QA vs. a periodic full-app QA sweep? (Proposed per-chunk, gated on observability; a periodic sweep can be a separate future role.)

---

## STATUS: ON HOLD (owner dismissed provisioning questions 2026-09-28)

The top-tier review (verdict RECONSIDER — implement with ranked changes B1–B8) is folded into the design intent below; do NOT implement the role files until the owner returns to this. The blockers are owner-only environment decisions:

- **B1 auth:** QA execution cannot reach any flow past the Supabase login without a seeded test user + a localhost login/storage-state helper, or a localhost-only dev auth bypass. Credential entry into the hosted endpoint is not available to an agent.
- **B2 engine:** the motivating bug is Gemini-only; catching that class needs live-engine access + a determinism story, else QA covers only deterministic embedded paths.
- **B3 pane:** QA-run needs a foregrounded browser pane (a hidden pane returns 0/empty) and must not be dispatched headless/background.
- **B4 anti-fabrication:** per-scenario provenance (build SHA/origin) + input-shape proof + a documented control/negative + independent re-execution by an Opus check that itself has environment access.
- **B5:** the two-round cap gets a severity carve-out — a confirmed break of the chunk's own core flow BLOCKS, never leaves as backlog.
- **B6:** "preview cannot exercise → skip" becomes "record + escalate as a gated uncovered-risk," never a silent skip.
- **B7:** drop a dedicated QA-fix role — reuse loop-implementer with a QA-fix brief; move guard-test power-proof into the fix-check. Fix the N36 mis-attribution (it is a .docx-XML instrument, not browser QA) and add a docx-bytes instrument. Provision a QA fixture corpus + test-data isolation.
- **B8:** reconcile with the fresh-verify step; do not cite an unverified "preview-verification rule."
