# SESSION-HANDOFF

**Purpose:** the loop's VOLATILE head-state — the things a cold restart loses because they live in the orchestrator's working memory, not in git, `backlog.yml`, or `docs/loop/*.md`. Read this at session start (step 0) alongside `docs/BACKLOG.md`. Update it at the end of any turn where this state changed. Keep it SHORT: only state not already durable elsewhere. Settled per-chunk work → `docs/loop/*.md`; priority queue → `backlog.yml`; history → `git log`.

_Last updated: 2026-10-04 by the orchestrator._

---

## 1. In-flight uncommitted work (the dirty tree)
- None. N83 (live-draft Copy/Download fix) landed and pushed as `fa5635e` (full suite 16738/16738 green). Tree is clean of code changes.

## 2. Mid-flight waves / active dispatches
- **N83 fresh verifier** — `loop-checker` (agent a6f927aec2b359a34) on `fa5635e`. Read-only. Key attack: illegal-char download fidelity (copy==download), the one seam the jsdom suite used a clean draft for.
- **N105 AC checker** — `loop-checker` (agent a16b0a450b51d775e) on `docs/loop/N105.ac.r1.md`. Re-grepping the CITED line refs (docx.js:653, strategy.js:614) + safety-AC power.
- **N105 AC is COMPLETE** (`docs/loop/N105.ac.r1.md`, 17 criteria, 15 RED). BLOCKED on owner decisions OD-1..OD-4 (see §5) before the design wave (1b structure + 1c experience) can run. Also BL-2: step-3b primary-source research on the gemini/external 8-step call shape.

## 3. Killed / stalled sub-agent residue
- Resolved. The two killed N83 implementers' edits were verified and landed in `fa5635e`.
- **Standing hazard (keep):** implementer sub-agents stall waiting on a full-suite vitest run they backgrounded. The full suite is ORCHESTRATOR-OWNED at integration — never have a package/implementer agent run it; they run only touched files and hand back.

## 4. Per-activity round counters (round-2-escalation cap = 2)
- N83: CLOSED (landed `fa5635e`; fresh verify in flight).
- N97 verify: CLOSED (SHIP; gaps filed as N101).
- ORCH-kanban review: CLOSED (adopted SESSION-HANDOFF.md only).
- Retro-roles review: CLOSED (adopted: `loop-retro` author file + reuse loop-top; trigger = Next-drain; shipped this session).
- N105 AC: round 1 done; AC checker in flight = round 2. A third pass must be a decision that ENDS AC authoring, not another round.

## 5. Immediate next actions
- **N105 owner decisions ALL RESOLVED (2026-10-04):** OD-1 new level = top option in existing tailoring-level selector, two distinct output files. OD-2 embedded REFUSES honestly; level requires an LLM engine. OD-3 the shared adversarial-reviewer primitive (N103/N104/N105 step-6) is its OWN foundational chunk, built first. OD-4 NO in-document label; the hypothetical is distinguished by a FILENAME marker ("HYPOTHETICAL") + UI only.
- **N105 AC DISPOSED** — final at `docs/loop/N105.ac.r2.md` (17 ACs, 15 RED; AC-12b INVALID-until-rendered; AC-17 vacuous). 4 majors fixed, 4 ODs baked, no open AC questions. Design inputs carried downstream: I1 (1b/1d: do structured employer/date/education records exist for AC-10 exact-match?), I2 (3b/BL-2: gemini/external 8-step call shape — THE plan blocker), I3 (1b: filename-"HYPOTHETICAL"-marker injection point + combine/set-default refusal of the hypothetical), I4 (1b: two-file + UI-marker composition into the preview). OD-5 (teaching-CL) deferred sub-feature.
- **N105 STRUCTURE design (1b) COMPLETE** — `docs/loop/N105.design.r1.md` (16 ledger lines D-1..D-16). Key: no server-side structured chronology (truthfulness corpus = uploaded résumé text → app-minted spans); single `ensureHypotheticalMarker` choke point on resolveDocumentFileName (docx.js:68) + driveDocName (closes an override-branch leak); hypothetical = new DOCX scope; distinct `tailorMode` field (NOT aggressiveness=6, clamped at route.js:111); embedded refuses via a `supportsIdeal` capability flag; shared-reviewer contract `reviewDocuments(...)` defined (§6). Many line refs are CITED-SUBAGENT — a checker MUST re-grep; the load-bearing one: confirm NO server-side structured employer/date/education store exists (if it does, §4/AC-10 revise).
- **DISPATCHED in parallel:** (1) structure design CHECK (loop-top, G1) — re-grep all CITED refs + attack the single-choke-point and shared-reviewer-contract claims; (2) 3b RESEARCH for I2 (loop-seat) — the sharpened Gemini 8-step call-shape question (composite structured call vs chain; responseSchema vs urlContext incompatibility; external docxB64 mapping).
- On both hand-backs: 1c experience wave; scope the OD-3 shared-reviewer foundational chunk from the pinned contract; then plan (I2 is the plan blocker).
- N83 verified SHIP (fa5635e); minors filed N83-F1/N83-F2.
- The `loop-retro` role fires on the NEXT BACKLOG Next-drain (not yet).
