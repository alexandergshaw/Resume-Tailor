# ORCH-kanban — adversarial review (r1)

Reviewer: fresh orchestration reader. Proposes, never implements. Scope: the owner's
proposal to add a persistent kanban of work-package `.md` files + archiver/cleanup agents
to the dev loop. Grounded in what already ships.

**Verdict in one line: ADOPT-WITH-CHANGES, but the kanban-md board and the archiver are
largely a RE-SKIN of `docs/backlog.yml` + `docs/loop/*.md` + git — adopt only the one thing
genuinely missing (an explicit session-handoff state file), and REJECT the archiver.**

---

## 0. Interpretation check (confirm/correct)

The brief's interpretation is accurate, with one correction the owner should hear: **three of
the four proposed pieces already exist** under different names. The proposal reads as new
because it describes the *capability* (persistent board, per-agent small context, compaction)
without knowing the loop already implements each. The one net-new idea — capturing the
orchestrator's in-flight head-state for a cold restart — is real and unaddressed today.

---

## 1. What the proposal gets right (against the existing loop)

- **The goal is the loop's own stated goal.** `docs/BACKLOG.md` rule 5: "The loop does not
  stop while this file has entries"; `MEMORY.md` + 30+ memory files exist precisely so a new
  session resumes without re-deriving context. The owner is pushing on the grain, not against it.
- **Per-agent small context is already the design.** Seats are briefed by "card sections, never
  paste" (`development-loop` memory; `loop-seat-briefs.md`), and each seat gets one artifact's
  slice, not the whole repo. The proposal correctly identifies that a sub-agent should carry
  only its package — the loop agrees.
- **Token pressure is a real, recurring cost.** `loop-iteration-caps`: "a single AC round ran
  ~960k subagent tokens." Anything that reduces re-briefing is worth taking seriously.
- **Frequent session restarts are already a supported mode.** The round/wave suffixes on
  artifacts (`N92.tests.w2.r2.md`, `N92.verify.w3.r1.md`) already persist *where in the loop*
  a chunk is, across restarts, in the filename itself.

## 2. Delta analysis — what kanban-md + archiver/cleanup actually ADD

Mapping the proposal's four pieces onto what ships:

| Proposed piece | Already exists as | Net-new? |
|---|---|---|
| Persistent kanban board | `docs/backlog.yml` → rendered `BACKLOG.md`. Per-item `state` field is literally a WIP column (`actionable`/`owner`/`verification`); `blocked_by` is the blocked lane; array order IS priority (R-BL-1); `owns`/`verify`/`evidence`/`owed_by` are the card body. | **No — re-skin.** |
| Work-package `.md` files | `docs/loop/<id>.<activity>.<wave>.<round>.md` — the AC/design/plan/tests/verify artifacts, one set per item, already round/wave-scoped. 50 files in `docs/loop/` today. | **No — re-skin.** |
| Cross-session durable context | `MEMORY.md` index + 30+ memory files (the orchestration realities, traps, ledgers). | **No — exists.** |
| Archiver (compact between milestones) | `BACKLOG.md` rule 3: "No diary. Closed items are deleted, not archived. **Use git log for history.**" | **No — and the loop deliberately REJECTS it (see 3.iii).** |
| Cleanup agent (prune workspace) | Partially: disposal rounds (`loop-iteration-caps`) prune *re-litigation*; closed backlog items are deleted. | Thin net-new (housekeeping of stale `docs/loop/*` after close), low value. |

**Plain statement: the kanban-md + archiver proposal is ~85% a rename of `backlog.yml` +
`docs/loop/*.md` + git history.** What a work-package `.md` would add over a `backlog.yml`
row is nothing the row lacks — the row already carries title, owner-ruling, evidence (with
file:line), `owned_by` successor, `owns` file-globs, `verify` command, `blocked_by`. Splitting
each row into its own file would LOSE the one property the single file is built to provide:
**hand-ordered global priority in one place** (R-BL-1). N separate md files have no array order.

## 3. Adversarial failure modes (the core)

### (i) "No context loss on session restart" — what silently falls out of md files

Markdown work-packages capture *settled* state. They do **not** capture the orchestrator's
in-flight head-state, which is exactly what a cold restart needs and what the owner is really
asking for. Concretely, at THIS session's start the git status showed four modified files and
one untracked test (`DocumentPreviewDialog.*`, `useDocumentPreview.js`,
`documentScopes.js`, `?? …fileNameStaleness.test.js`) — **uncommitted, mid-chunk, owned by no
md file.** A new session inherits a dirty tree with no record of which item dirtied it, which
wave is mid-flight, or whether a sub-agent was killed (`TaskStop`) mid-edit leaving a partial
write (`subagent-edit-hazards`: `.original` backups, half-applied edits). None of that lives
in a package md; it lives in the orchestrator's head and in `git status`. **A kanban of md
files gives a false sense of "zero loss" while the genuinely volatile state — dirty tree,
in-flight wave, killed-agent residue, which activity-round is live — is precisely what it
omits.** This is the finding that matters: the proposal names the right goal and then stores
the wrong things.

Compounding: `round-2-escalation` caps every activity at TWO rounds. A restart that re-derives
state from md files but loses the round counter can silently **re-open a capped activity** and
run round 3+ — the exact failure that memory exists to prevent. Round state must survive the
restart as data, not inference. (The filename suffix `.w2.r2` helps, but only for artifacts
that were written; an activity abandoned mid-round leaves no file.)

### (ii) "Small per-package context" vs disjoint-subagents + the full-suite stall

This is where the proposal is actively unsafe if taken literally.

- **Blast radius is invisible from inside a package.** `disjoint-subagents` (2026-09-29):
  concurrent implementers are risky because "any of them may touch a shared god-component
  (app/page.js especially — nearly every feature threads a prop there)." A sub-agent given
  ONLY its work-package cannot see that its one-line change collides with another package's
  file. Disjointness is a *cross-package* property that only the orchestrator holds. A pure
  small-context model has no place to compute it. The loop already solves this by keeping
  fan-out at AC/design/TDD and serialising implementers over shared god-components — knowledge
  that is orchestrator-level, not package-level.
- **The full-suite gate is the lived pain, and the proposal doesn't place it.** This session,
  multiple implementers stalled on their own backgrounded ~23-min vitest runs and had to be
  `TaskStop`ped. Memory already diagnoses and solves this (`disjoint-subagents` §"Never let
  parallel agents each run the full suite"; `never-ask-to-continue` §"run the full suite in
  the FOREGROUND … The orchestrator runs the full gate once at integration"). **The fix is a
  brief-contract rule — the gate belongs to the orchestrator at integration, not to any
  package.** A "small per-package context" agent that doesn't carry this rule will re-background
  a full suite and stall again — so the proposal, if it means "each package self-verifies,"
  REPRODUCES the exact pain it's pitched to relieve. Any adopted design MUST state: packages
  run only their own touched files; the full suite runs once, orchestrator-owned, at integration.
  If the proposal is silent on this (it is), **that is the central finding.**

### (iii) Archiver/cleanup "between milestones" — data-loss / race / git

- **There is no "milestone" concept in the loop.** `grep -rin milestone docs/` → zero hits.
  The loop is a continuous priority queue (`BACKLOG.md` rule 5), not a milestone cadence. The
  archiver's trigger boundary is undefined on arrival.
- **The loop already ruled against an archiver.** `BACKLOG.md` rule 3: closed items are
  **deleted, not archived**; history is `git log`. An archiver that compacts closed packages
  into a store duplicates git and creates a second, drift-prone history — the precise thing the
  "no diary" rule forbids. Git is the source of truth; an md archive is a stale copy.
- **Race / data-loss if it runs while a package is open.** A cleanup agent compacting the
  workspace mid-wave is `disjoint-subagents`' overwrite hazard at the workspace level: it may
  prune a `docs/loop/*.md` an in-flight checker is still reading, or (worse) touch the dirty
  working tree. Hard rule for any adopted cleanup: **never touch git-tracked source, never touch
  an uncommitted tree, operate only on items `git log` proves are closed+pushed, and never run
  while any sub-agent is live.** That leaves it with almost nothing to do that `rm` + a commit
  wouldn't — i.e. low value for real race risk.

### (iv) "Token efficient" — vs what baseline, and the hidden costs

- **Baseline unstated.** Efficient vs a single monolith session that re-reads the repo each
  turn? Plausibly yes. Efficient vs *today's* loop (card-section briefs + memory index +
  per-activity artifacts)? **No evidence — the loop already does small-context briefing.** The
  claim needs a measured comparison, not an assertion.
- **Hidden costs the proposal adds:** (a) board read+write every orchestrator turn (today the
  board is read at step 0 and edited at disposal, not every turn); (b) re-briefing each
  small-context agent — and these briefs are NOT small (N97's `owed_by` alone is ~1.5k tokens
  of reconciliation context); a package too small to carry blast-radius forces MORE orchestrator
  re-briefing, not less; (c) **triple-bookkeeping**: the same fact in a work-package md, in
  `backlog.yml`, and in git — three places to drift, which `schema-migration-drift` and the
  "no diary" rule both warn against. Splitting the board into N files multiplies write points
  and kills the single-file priority ordering that `pick.mjs`/`wave.mjs` depend on (R-BL-1).

## 4. Verdict — adopt-with-changes (mostly reject-as-redundant)

**Reject** the work-package-md board (redundant with `backlog.yml`; would destroy R-BL-1 global
ordering and tooling) and **reject** the archiver (forbidden by the "no diary" rule; duplicates
git). **Adopt** exactly one net-new piece the proposal correctly implies but no current file
holds: a single **session-handoff state file** for the orchestrator's volatile head-state.

Minimal concrete design:

- **Board stays `backlog.yml`.** It already IS the kanban (states = columns, `blocked_by` =
  blocked lane, order = priority, `owns`/`verify`/`evidence` = card). No per-item md split.
- **Per-package context stays `docs/loop/<id>.<activity>.<wave>.<round>.md`.** It already IS the
  small per-package context. Formalise naming only if inconsistent; do not multiply files.
- **NET-NEW: `docs/loop/SESSION-HANDOFF.md`** (single file, overwritten each orchestrator turn,
  never archived). It captures ONLY what git + backlog can't: the live item id(s), which wave is
  mid-flight and over which file-set, each in-flight sub-agent's assigned files + liveness, the
  expected dirty-tree shape (so a restart can tell intended edits from a killed-agent residue),
  and the current activity-round per live item (so `round-2-escalation`'s cap survives restart).
  This directly answers claim (a) "no context loss" where md packages fail it.
- **Full-suite gate is orchestrator-owned at integration** — written into every implementer
  brief: touched-files only per package; no backgrounded full suite; the one full run is the
  orchestrator's at integration on a settled tree. (Already memory; make it a brief invariant.)
- **Cleanup = a bounded `rm`, not an agent.** Delete `docs/loop/*` for items `git log` proves
  closed+pushed, as an orchestrator step between items, never while a sub-agent is live, never
  on tracked source or a dirty tree. No "archiver"; git is the history.

Net: adopt the **handoff-state file** and the **gate-ownership invariant**; everything else the
loop already has under a different name.

## 5. Open questions for the owner (genuine forks)

1. **Does "no context loss" mean the volatile head-state (dirty tree, in-flight wave, killed
   agents)?** If yes, `SESSION-HANDOFF.md` is the fix and the md-board is beside the point. If
   you specifically want closed-work *browsability* beyond `git log`, that's a different ask —
   say so, because it reverses the "no diary" rule.
2. **What is a "milestone"?** The loop has no such boundary today (continuous queue). If you
   want a cadence for cleanup/compaction, define the trigger — e.g. "every push to main", "every
   N closed items" — or cleanup stays a per-item orchestrator step.
3. **Is the token-efficiency claim measured against today's loop, or against a monolith
   session?** If the former, a quick before/after token count on one chunk would settle whether
   any restructuring is worth its bookkeeping cost; if the latter, today's loop already captures
   most of the win.
