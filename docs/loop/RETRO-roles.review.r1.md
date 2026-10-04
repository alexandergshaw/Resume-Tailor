# RETRO-roles — adversarial review (r1)

Reviewer: fresh orchestration reader. Proposes, never implements. Scope: the owner's proposal to
add a **retrospective** role (writes lessons-learned across the past loop + improvement areas) and
a **retro-reviewer** role (reviews it), both reporting to the owner and making no changes. Grounded
in what already ships. Precedent followed, not re-derived: `ORCH-kanban.review.r1.md`,
`qa-roles.proposal.r1.md`.

**Verdict in one line: ADOPT-WITH-CHANGES. The retrospective is NET-NEW only as a PERIODIC
cross-chunk synthesis that proposes control-surface changes — a duty the loop already names
(`development-loop` "Measure it") but which the never-stop rule guarantees is never executed. The
retro-REVIEWER is NOT net-new: it is `loop-top` pointed at the retro artifact — reuse it, add a new
role file only for discoverability. Add ZERO new reviewer role files, at most ONE thin author file.**

---

## 0. Shape check (confirm/correct)

The brief's two-role shape is right. One correction the owner should hear: of the two roles, **only
one is arguably net-new, and even that one already exists as an un-executed orchestrator duty.** The
reviewer half is the exact question `qa-roles.proposal.r1.md:31` already answered (reuse
`loop-checker`/`loop-top` with role-specific brief questions; DRY default) and `ORCH-kanban`
rejected cloning near-duplicates. Do not re-derive it — apply it.

## 1. What the proposal gets right (against the existing loop)

- **Read-only / propose-only is the loop's own grain.** It matches `loop-top.md:21` ("You propose;
  you never apply") and `round-2-escalation` (a decision that ends an activity is the owner's, not a
  seat's). The instinct to report-not-change is correct and already enforceable by reusing `loop-top`.
- **A fresh reviewer of the retro matches the loop's universal invariant** — `development-loop.md:34`
  "neither are the author and the checker of ANY artifact." A retro is an artifact; it must be checked
  by someone who did not write it. The proposal is pushing on the grain here too.
- **There IS a real gap.** `development-loop.md:487-490` ("Measure it": *"After three chunks, compare
  cost per chunk against defects caught at each stage. A triaged-out seat whose defect class surfaces
  at 8x/9c/regression widens its trigger…"*) is a cross-chunk retrospective duty **owned by the
  orchestrator and structurally never run** — because `never-ask-to-continue` + the never-stop rule
  (`development-loop.md:676`) pull the orchestrator straight from a push to the next backlog item. The
  one periodic-synthesis duty the loop already has is the one thing it never stops to do. A dedicated
  role is a legitimate fix *for that specific gap*.

## 2. Delta analysis — what a retrospective role ADDS over existing capture

| Existing mechanism | What it captures | Net-new vs a retro? |
|---|---|---|
| RCA (`N89.diagnosis.r1.md`; `loop-seat`, step 11) | ONE defect's root cause, reactive, single bug | No overlap — per-defect, not cross-loop |
| `docs/loop/*.verify.r1.md` | ONE chunk's defect findings | No overlap — per-chunk |
| memory `feedback` files (`stated-plan-vs-executed`, `disjoint-subagents`, `round-2-escalation`, `loop-traps-*`) | Continuous lessons, written by whoever hit the pain | **This is the collision.** These ARE the lessons-learned, written continuously |
| `consolidate-memory` skill | Merge dupes, fix stale facts, prune index | Adjacent — memory *hygiene*, not loop-process synthesis |
| `cost.md` per chunk + "Measure it" §487 | Per-chunk cost/triage-miss rows; a *named* cross-chunk comparison duty | **The un-executed duty a retro would actually perform** |

**Plain statement on the retrospective:** it is NET-NEW **only** if scoped as a *periodic synthesis
across many chunks that outputs change-proposals to the loop's control surfaces* (0e triggers, briefs,
caps, tiers) — which no current artifact produces as a discrete fresh-agent deliverable. If scoped as
"write down lessons," it is a **re-skin**: a second, drift-prone copy of the memory `feedback` files
and the RCA, and the loop already forbids that shape — `session-handoff.md:18` ("Do NOT duplicate
those here — that was the rejected archiver's failure mode") and the "no diary" rule
(`development-loop.md:674`). The memory files are *already* the continuously-written lessons-learned;
a retro that restates them adds tokens and a second source to drift.

**Plain statement on the retro-reviewer:** it is **nothing `loop-top` is not already** —
`loop-top.md:17` "Delta review… report EVERY item as applied / not applied / applied differently."
Checking one authored artifact adversarially, fresh, propose-never-apply, is its whole job. A second
new role file here is the near-duplicate-checker clone both precedents rejected (`qa-roles:31`,
`ORCH-kanban:139`).

## 3. Adversarial failure modes (core)

### (i) CADENCE — the load-bearing defect: "across the past loop" has no boundary

The loop is a continuous priority queue with **no milestone concept** — `ORCH-kanban.review.r1.md:106`
already proved `grep -rin milestone docs/` returns zero, and `BACKLOG` rule 5 / `development-loop.md:676`
make the queue continuous and the loop non-stopping. So "the past loop" names a window with no edges,
and a retro role has no natural firing point. Two symmetric failure modes:

- **Fires every chunk** → it becomes a third per-chunk gate alongside verify + RCA, at ~$1.3–1.4 per
  `loop-top` run (`development-loop.md:120`), for a backward look that mostly restates memory. Pure cost,
  near-zero marginal signal.
- **Never fires** → exactly the fate of the "Measure it after three chunks" duty today: the never-stop
  rule (`never-ask-to-continue`; `development-loop.md:691` "a turn ends only after the loop advanced an
  actionable item or escalated a blocked one") routes the orchestrator to the next backlog item, and the
  retro is forever deferred.

**The loop DOES have one real, mechanical boundary: the push** (`development-loop.md:366` "The loop ends
at the push"). A bounded trigger must hang off that, not off "between milestones." And it needs an
*admission rule* or it fires at the wrong time — cf. the composite-legibility lesson
(`development-loop.md:432`): a proposed registry-and-trigger "would have fired at ZERO commits (no
admission rule, so the registry is empty until someone already noticed)." Concrete options in §4.

### (ii) REDUNDANCY / DRIFT — orthogonality to memory is not optional

A retro that re-states the `feedback` files violates the loop's own "no diary" rule and reproduces the
archiver failure mode `session-handoff.md:18` names. Worse, **memory already carries FALSE claims that
survived because they were adversarial-sounding** — `development-loop.md:432-440` records a refutation
that cited `citations.test.js:182-198` and was simply wrong ("a refutation that cites file:line was not
verified just because it was adversarial"). A retro that copies memory inherits and amplifies that. The
orthogonality rule has to be structural: **the retro's OUTPUT is change-proposals against named control
surfaces** (a 0e trigger to widen, a brief line to add, a cap to adjust, a cost trend), each tied to
evidence — **never a restatement of a lesson memory already holds.** "We already know X" is not a retro
finding; it is noise.

### (iii) CONSUMPTION — report-only is correct, but an accepted finding must not evaporate

"Report to the owner without making changes" is right and matches `loop-top`. But the loop has a scar
here: `development-loop.md:656-666` (the whole reason `BACKLOG.md` is read at step 0) — *"a finding
disposed of as 'later' has lived in a scratchpad artifact or a subagent report, and nothing reads any of
those at the start of the next piece of work… a residual recorded only there is a deletion with extra
steps… nine majors sat unrouted through three contract revisions."* A retro that reports to the owner and
stops, with no routing, repeats exactly that. Required closure path, which keeps the retro read-only:
**accepted retro finding → a `BACKLOG.md` entry (actionable or owner-decision) → each memory/0e/brief/agent
edit is itself a chunk through the loop** (the `T1–T6` tooling-backlog pattern, `development-loop.md:502`).
The orchestrator — not the retro role — makes the edit, via that chunk. Retro proposes; owner accepts;
backlog carries; a normal chunk applies and is checked.

### (iv) POWER — what stops a zero-power "tests were green, good job"

A retro with no evidence bar is worthless. It must cite HARD artifacts over the window:

- **git log** over the window (the only authority for "what happened"; `development-loop.md:700` "do not
  cite a number from this file without re-running its instrument" applies to the retro too).
- **`cost.md` triage-miss rows** — a forced seat is a logged triage miss (`development-loop.md:307` "log it
  in `cost.md` and widen that trigger"); recurrence across chunks is a prime retro finding.
- **round-count overruns** — `round-2-escalation` records N49 plan r4, N50 r8, N54 eight verification rounds
  then dropped. A retro that spots a *class* of chunk burning rounds is non-trivial.
- **stall / killed-agent incidents** — `development-loop.md:458` ("stalled waiting on it… three times on
  2026-09-14"); `session-handoff.md:13` (this very session resumed with "4 modified + 1 untracked file
  owned by no artifact"). These are the incidents a retro exists to surface.

**Non-triviality bar (make it a rule):** a retro finding must name either a RECURRENCE (same class in ≥2
chunks over the window) or a MEASURED regression (cost or round-count), each bound to the specific control
surface it proposes to change. And per `development-loop.md:560` ("generated-not-authored disposition
sections"), the evidence table should be generated from git/`cost.md`, not free-authored, so it cannot
quietly become praise.

### (v) RETRO-REVIEWER INDEPENDENCE — fresh instance, not a different model

Can the reviewer be the same as the author? **Same INSTANCE: no** — `development-loop.md:34` and
`loop-checker.md:8` ("If your brief suggests you authored the artifact, stop and say so") forbid it.
**Same MODEL: yes, and it is already the norm** — the entire loop runs author and checker on the same
model family; the guarantee is a FRESH instance + an adversarial, rival-vendor brief, not a different
vendor (the "rival company's AI model" framing in every `loop-*` definition is a *stance*, not a second
provider). So reviewer independence = a fresh `loop-top` instance, never the retro's author. No new model,
no new role file required.

## 4. Verdict — ADOPT-WITH-CHANGES (minimal design)

Adopt the retrospective **as a periodic process-synthesis**, reject it as a lessons-diary, and reuse
`loop-top` for the review. Minimal design:

- **Author seat: reuse `loop-seat` (Sonnet) with a retro brief** — the retro is RCA-shaped backward
  analysis (RCA already runs on `loop-seat`, `development-loop.md:71`), and its proposals go to the
  OWNER who gates them, so they are *not* silently inherited downstream — Sonnet authoring + Opus review
  is the correct split under the option-A ruling (`development-loop.md:535`, seats Sonnet / checkers Opus).
  A thin `.claude/agents/loop-retro.md` is justified ONLY if the owner wants it discoverable as a dispatch
  type; the brief content is the same either way.
- **Reviewer: reuse `loop-top` (fresh instance), no new file** — add retro-specific checker questions to
  `loop-seat-briefs.md` ("Checker questions by artifact"). This is exactly `qa-roles:31` / `ORCH-kanban:139`.
- **Trigger/cadence (concrete, bounded, mechanical — pick one, owner's call):**
  (a) every Nth push to main (e.g. N=10), counted from git; or (b) when a `BACKLOG.md` "Next" section
  drains to empty; or (c) owner-invoked only. All three hang off a real boundary (the push / the queue),
  none off a non-existent "milestone." Whichever is chosen gets an admission rule so it cannot fire at zero
  (cf. `development-loop.md:432`) and its firing is logged so it cannot silently never-fire.
- **Window = commits since the previous retro's end sha** (recorded in the retro artifact), bounded by
  `git log`. Concrete, re-derivable, no overlap, no gaps. The first retro's window is owner-set.
- **Artifact: `docs/loop/RETRO.<end-sha|date>.r1.md`** (matches the `docs/loop/` convention; carries the
  window's start+end sha so the next retro scopes from it — the same self-chaining trick the handoff file
  uses).
- **Evidence it must cite:** git log over the window + `cost.md` triage-miss/round rows + verify/RCA
  findings + stall/killed-agent incidents, under the §3(iv) non-triviality bar; disposition table generated,
  not authored.
- **Consumption (keeps it read-only):** accepted finding → `BACKLOG.md` entry → each resulting
  memory/0e/brief/agent edit is a normal chunk through the loop, applied by the orchestrator and checked.
  The retro and its reviewer touch nothing but their own artifacts.

Net: adopt a **periodic, push-triggered, evidence-barred process-retrospective authored by `loop-seat`**
and **reviewed by a fresh `loop-top`**; add **no new reviewer role file** and at most one thin author file.

## 5. Open questions for the owner (genuine forks)

1. **Cadence fork:** every-N-pushes, every-backlog-"Next"-drain, or owner-invoked-only? The loop has no
   milestone, so the boundary must be one of these three mechanical events — which do you want, and (if N
   pushes) what is N?
2. **Scope fork:** is the retro's remit the LOOP PROCESS only (triggers, briefs, caps, tiers, cost/round
   trends), or also PRODUCT lessons? If product, it overlaps RCA/verify and should be explicitly bounded to
   process, or it becomes a second bug-finding pass.
3. **Role-file fork:** new `loop-retro.md` + reuse `loop-top` for review (discoverable, one new file), or
   reuse `loop-seat` + `loop-top` with retro briefs and zero new files (strict DRY, matching both prior
   precedents)?
