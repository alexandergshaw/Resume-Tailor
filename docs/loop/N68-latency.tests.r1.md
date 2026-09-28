# N68 latency — TDD test hand-off (seat 4b, round r1) — STEP 1 / L5(ii) ONLY

Seat: TDD (4b). Scope: **AC-L5 / DS-2 / DS-3 / PL-2 / PL-3 only** — the tailor route running the
cover letter concurrently with the hiring email, in `app/api/tailor/route.js`. Steps 2–5 (L4/L2/L3,
held files) are explicitly OUT of scope this round. Inputs consumed: `N68-latency.ac.r1.md` (AC-L5,
AC-L10 bind), `N68-latency.design-structure.r1.md` (DS-1..DS-3), `N68-latency.plan.r1.md`
(Step 1, R-1). No source/production code written. No git writes.

## Files created / edited (tests + fixtures only)

| File | Lines | Status |
|---|---|---|
| `app/api/tailor/route.coverEmailConcurrency.test.js` | 325 | NEW — 6 tests |
| `app/api/tailor/route.test.js` | 451 (was 440) | EDITED — R-1 adoption of the shipped `mock.calls[1]` assertion |

## The one RED test on HEAD, and WHY it is red

**`issues the cover letter and the hiring email concurrently — both in flight before either resolves`**
is RED on HEAD. Verbatim failure (working tree, HEAD): `AssertionError: expected [ 'resume', 'cover' ]
to include 'email'` at line 195. Reason: HEAD awaits `tailorCoverLetter` (route.js:450) strictly before
it reaches `tailorHiringEmail` (route.js:517), so after the résumé deferred resolves only the cover
letter is in flight — the email is never initiated until the cover letter resolves. The test resolves
the résumé, flushes, and asserts BOTH engine methods have been invoked while both their deferreds are
still pending (a pure initiation-order assertion — see AC-L10 / N74 note below).

The other 5 tests in the file PASS on HEAD by design — they are **guards / controls**, not reds. They
protect the properties the L5 change must not break; each has a proven-lethal mutant (below). They are
disclosed as guards, not counted as coverage of a missing feature.

## Working-tree run (HEAD), verbatim

```
 ❯ app/api/tailor/route.coverEmailConcurrency.test.js (6 tests | 1 failed)
     × issues the cover letter and the hiring email concurrently — both in flight before either resolves
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 19 passed (20)
```
(19 passed = my 5 guards + all 14 route.test.js tests including the R-1-adopted one.)

## Reachability

Every test drives the **real production entry point `POST`** with a real `FormData` request, exactly
as the Next.js runtime does. The three engine methods are reached only through the route's own injected
seam `getEngine(engineName)`, supplied via the **public `registerEngine` contract** — the same seam the
shipped `route.test.js` already uses. No route-internal function is imported or called directly; nothing
was exported to make a test reach it (no export sweep moved — verified: only `POST` and the pre-existing
`pickTailoredResume` are exported from route.js, unchanged).

## The initiation-order instrument (AC-L10 / N74) — stated plainly

Every concurrency assertion proves **INITIATION ORDER** (which engine methods have been invoked at a
point in time, before any deferred result resolves), never wall-clock and never a true mid-flight race.
Mechanism: each engine method returns a test-controlled deferred; the test resolves the résumé, lets
already-schedulable continuations run (four real macrotask boundaries, no fixed wait on a duration),
and asserts on the call log while cover/email deferreds are still pending. **This proves INITIATION,
NOT parallel execution of the provider work itself** — a later seat must not over-read it as a timed
race. This is inside the runner's power and is not the thing N74 says jsdom/node cannot do.

## R-1 ADOPTION (shipped test changed — disclosure)

I edited the shipped `route.test.js:277-280` ("also grounds the cover letter in the project pages").
It read `generateContent.mock.calls[1][0].contents` with the comment "Second generateContent call is
the cover letter draft" — an ORDER-dependent index that becomes non-deterministic under L5 (cover and
email both call `generateContent` after the résumé, in unspecified order; the email prompt receives no
`contextDocuments` and would not contain "Payments migration"). Per the plan's R-1 ruling (ADOPT, not
defer), I replaced the fixed index with a **content-based lookup**: find the `generateContent` call
whose `contents` include the section header `"Cover letter template"`. Verified against
`lib/llm/tailorResume.js`: only `buildCoverLetterPrompt` emits that header (`:436`) and the template
lines; `buildHiringEmailPrompt` and the résumé prompt never do — so it uniquely marks the cover call
regardless of dispatch order. The assertion's INTENT (cover letter grounded in project pages) is
unchanged; only the order-coupled mechanism changed. Canary run (`grep -n "mock.calls\[" route.test.js`):
the only index > 0 was line 279; all other sites use `[0]` (the résumé call, always first — safe). This
test stays GREEN on HEAD and under the concurrent reference impl (order-independent — re-verified: it
passes under the SERIAL mutant too).

## Satisfiability — reference implementation (isolated scratchpad, never the working tree)

I built a concurrent reference implementation in an isolated scratchpad copy of the tree (source copied,
`node_modules` junctioned, junction removed afterward without following it — real modules intact). The
reference wraps the cover block and email block in two never-rejecting local async tasks
(`runCoverLetter()`, `runHiringEmail()`), each keeping its OWN `try/catch`, and runs
`await Promise.all([runCoverLetter(), runHiringEmail()])` placed BELOW `pickTailoredResume`, with
`tailorResume` never inside the `Promise.all`. Results:

- New file + `route.test.js`: **20/20 passed** (the RED test turns green; all guards + R-1 stay green).
- Neighbour suite `lib/llm/tailorResume.wire.test.js` (gemini config/tools nesting): **10/10 passed** —
  L5 does not disturb the per-call wire shape.

So the reds describe a build that provably exists, and that build does not break the neighbouring suites.

## Mutation results — WATCHED, against the scratchpad reference impl (never the working tree)

Every mutant ran and produced a runner summary (assertion failures, not module-load errors), so each was
a faithful behavioural change — an instrument, not a broken build. NO-OP control included per the
standing rule. No mutant round-tripped clean; none had to be rebuilt.

| Mutant (faithful change to behaviour under test) | Watched result |
|---|---|
| **NO-OP control** — reorder two independent `const` declarations | **SURVIVED, 20/20** (suite is not vacuously green) |
| **SERIAL** — replace `Promise.all([...])` with two sequential `await`s (revert to today's order) | KILLED **only** the concurrency test (1 failed / 19 passed); route.test.js all green → proves the RED test's power AND that R-1 is order-independent |
| **GROUNDING** — `pickTailoredResume(tailoredResumeLines, {})` (ground both docs in an empty résumé — models the ungrounded-cover risk row) | KILLED **only** `grounds both … in the tailored résumé's content` (1/6) |
| **WARNING mis-attribution** — feed `emailOutcome.warnings` into `coverLetterWarnings` (models a concurrency wiring swap) | KILLED **only** `preserves warning order and per-document attribution` (1/6) |
| **ISOLATION-LOST** — rethrow from both task `catch`es (models raw `Promise.all` without per-task isolation) | KILLED **both** isolation tests (2/6): the whole request 500s when either task rejects |

## Risk rows the brief required power over — covered

- **Ungrounded cover/email (200 with wrong content):** the grounding guard asserts on the CONTENT handed
  to each engine call (`tailoredResume.result` contains the résumé sentinel), not just on status; proven
  lethal by the GROUNDING mutant. The résumé-precedes-both guard forbids the dangerous over-correction.
- **Warning/error ordering or attribution drift under concurrency:** the warning-order guard pins the
  exact `[résumé, "Cover letter: …", "Hiring email: …"]` array; proven lethal by the WARNING mutant.
- **Per-artifact error isolation:** both isolation guards (cover-throws, email-throws) assert 200 + the
  surviving document + the correct error field; proven lethal by the ISOLATION-LOST mutant.

## Gate results (verbatim)

- ESLint on both files: **no output → 0 errors, 0 warnings.** (I removed an `eslint-disable` I had
  briefly added to a flush loop and unrolled the loop instead — no suppression used, per standing rule 3.)
- Emoji scan (Node, with a canary that HIT on a known emoji): **0 emoji in the new file.** Two hits in
  `route.test.js` are the pre-existing typographic arrow `→` (U+2192) inside shipped assertion strings
  ("recurring edit: X → Y") that must match real engine output — NOT emoji, NOT introduced by me, on
  lines (364/370) outside my R-1 edit region.

## What I could NOT verify / left to a later seat (stated plainly)

- **Parallel EXECUTION** (a true race) is not proven and cannot be here (N74). Only initiation order is.
- **The three engine `tailorHiringEmail` bodies take no cover-letter input** is INHERITED from DS-1 (the
  design traced embedded/gemini/external; I did not re-trace them). My isolation + grounding tests are
  the backstop: if the email engine ever began consuming the cover letter, the concurrent dispatch would
  still pass these tests (they assert at the route seam, not inside the engine) — so this remains an
  inherited assumption, not one I independently re-proved. Flagged for the checker.
- **The implementer must run the FULL suite + full ESLint gate** at landing; I ran the two affected test
  files (working tree), the reference impl + `route.test.js` + the wire neighbour (scratchpad), and
  ESLint on my two files only.

## Proposed ledger lines

| ID | Requirement (checkable) | Instrument | RED on HEAD? | Evidence |
|----|-------------------------|------------|--------------|----------|
| T-L5-1 | Cover letter and hiring email are both INITIATED (before either resolves) after the résumé resolves | initiation-order test at the `registerEngine` seam, driving real `POST`; SERIAL mutant is its control | **RED** (`expected ['resume','cover'] to include 'email'`) | new file; killed by SERIAL mutant, green under reference impl |
| T-L5-2 | Neither cover nor email is initiated until the résumé resolves (guard vs parallelizing the résumé away) | initiation-order guard | guard (green on HEAD) | killed by a résumé-parallelizing build; grounding mutant demonstrates the harm |
| T-L5-3 | Both documents are grounded in the tailored résumé's CONTENT, not an empty one | assert `tailoredResume.result` contains the résumé sentinel at each engine call | guard | killed by GROUNDING mutant |
| T-L5-4 | Warnings stay in résumé→cover→email order with correct per-document attribution | `toEqual` on the assembled `warnings` array via real embedded aggregation path | guard | killed by WARNING mis-attribution mutant |
| T-L5-5 | Per-artifact error isolation: a throwing cover letter or email still yields 200 + the other document | inject a throwing engine method; assert 200 + surviving doc + correct error field | guard (×2) | both killed by ISOLATION-LOST mutant |
| T-L5-6 | R-1: shipped `route.test.js` cover-grounding assertion is order-INDEPENDENT (content-based, not `mock.calls[1]`) | content lookup for the `"Cover letter template"` prompt section | n/a (adoption; green on HEAD + serial + concurrent) | disclosed shipped-test change; passes under SERIAL mutant |
| T-L5-7 | Satisfiability: a `Promise.all` reference impl turns T-L5-1 green without breaking route.test.js or the wire suite | scratchpad reference tree | n/a | 20/20 + wire 10/10 |
