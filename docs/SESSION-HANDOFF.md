# SESSION-HANDOFF

**Purpose:** the loop's VOLATILE head-state — the things a cold restart loses because they live in the orchestrator's working memory, not in git, `backlog.yml`, or `docs/loop/*.md`. Read this at session start (step 0) alongside `docs/BACKLOG.md`. Update it at the end of any turn where this state changed. Keep it SHORT: only state that is not already durable elsewhere. Settled per-chunk work goes in `docs/loop/*.md`; the priority queue is `backlog.yml`; history is `git log`. This file is none of those — it is the "what was in flight when the last turn ended" note.

_Last updated: 2026-10-04 by the orchestrator._

---

## 1. In-flight uncommitted work (the dirty tree)
Git-tracked source that is modified/untracked but NOT yet committed, and why:

- **N83 — live-draft Copy/Download fix — CODE-COMPLETE, uncommitted, un-gated.**
  Files (all uncommitted in the working tree):
  - `hello-world/app/components/DocumentPreviewDialog.js` (M) — `handleDownload` conveys `fileName: fileNameDraft.trim()`; `activeTitle` uses `resolveActiveDocumentTitle(...)`.
  - `hello-world/lib/tailor/documentScopes.js` (M) — new `resolveActiveDocumentTitle` + `resolveDownloadPayload`; `buildDownloadArgs` takes `fileNameOverride` (raw; `docx.js:749-750` re-resolves).
  - `hello-world/app/hooks/useDocumentPreview.js` (M) — uses `resolveDownloadPayload(payload)`; now **933 lines** (under the 935 ceiling — the ceiling breach is already fixed).
  - `hello-world/app/components/DocumentPreviewDialog.titleCopy.test.js` (M) — N63-T5 inverted to assert live-draft copy.
  - `hello-world/app/components/DocumentPreviewDialog.fileNameStaleness.test.js` (?? untracked) — the N83 RED tests, now green.
  Status: targeted suites were GREEN (112/112: fileNameStaleness, titleCopy, drive, copy) BEFORE the `resolveDownloadPayload` extraction. The extraction (by a since-killed implementer) fixed the line ceiling but has NOT been re-verified.
  **Next action:** re-run the 4 docx targeted suites + `app/hooks/useDocumentPreview.wiring.test.js` + `lib/drive/lineCeiling.test.js`, then the FULL suite to **0 failures**, then commit ALL 5 N83 files in one commit + push, then dispatch a fresh N83 verifier.

- **`docs/loop/ORCH-kanban.review.r1.md` (?? untracked)** — the adversarial review of the orchestrator-kanban proposal. Safe to commit anytime (docs only).

- **This file (`docs/SESSION-HANDOFF.md`)** — new; commit with the orchestration change.

## 2. Mid-flight waves / active dispatches
- **N105 (new highest tailoring level) — AC seat LIVE** (`loop-ac`, agent a54b7d2f7a54df414). Writing `docs/loop/N105.ac.r1.md`. On hand-back: dispatch the design wave (1b structure + 1c experience), then plan → TDD → implement → verify. Safety ACs (hypothetical unmistakably labeled not-for-submission; application-ready truthful/supported only; step-6 flags unsupported authority) are FIRST-slice, never deferred.
- Backlogged (NOT started): N102 (answer-as-me chat toggle), N103 (adversarial-review button, modal + chat), N104 (weakness-summary + regenerate-to-fill). N103/N104/N105-step-6 share ONE adversarial-reviewer primitive — coordinate.

## 3. Killed / stalled sub-agent residue (check before trusting the tree)
- `a7c8c9357338fe1fa` (N83 implementer) — TaskStop'd after stalling on its own backgrounded full-suite run. Left the N83 fix in the tree, uncommitted.
- `a7be61fd90cf7980b` (N83 ceiling-fix implementer) — killed; but it DID land the `resolveDownloadPayload` extraction (hook now 933). Verify its edits before committing (subagent-edit-hazards: quote corruption, `.original` backups, import depth).
- **Standing hazard:** implementer sub-agents repeatedly STALL waiting on a full-suite vitest run they backgrounded themselves. **The full suite is ORCHESTRATOR-OWNED at integration** — do not ask a package/implementer agent to run it; have them run only their touched files and hand back.

## 4. Per-activity round counters (round-2-escalation cap = 2)
- N83 implementation: round 2 consumed (impl + ceiling-fix). Next failure is a decision that ENDS it, not a round 3.
- N97 verify: DONE (SHIP). Coverage gaps filed as N101.
- ORCH-kanban review: round 1 DONE; owner decided (adopt only `SESSION-HANDOFF.md`; reject archiver; keep single-file board). Activity CLOSED.

## 5. Immediate next action
Owner's TOP PRIORITY is N105 (new highest tailoring level) — AC seat is live. Drive N105 through the loop.
Parallel parked work (do when it won't collide with N105's files): finish N83 — verify (targeted + full suite → 0 failures) → commit all 5 files + push → fresh verifier. N83 is code-complete, so this is verify+land only.
