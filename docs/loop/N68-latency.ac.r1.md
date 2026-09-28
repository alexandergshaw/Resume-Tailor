# Acceptance criteria — backlog N68 (LATENCY audit: background loading to cut wait times)

Seat: AC (1). Round: r1. Author artifact only. No source edited, no git writes.

## 0. Card identity and the two-artifact divergence (RESOLVED)

- **Card: N68** (`docs/backlog.yml:296-306`). Owner request 2026-09-27, owner's own words:
  *"identify all places in the app where loading in the background would cut down on wait
  times."* The card's `owed_by` names the deliverable exactly: *"instrument real wait times …
  enumerate every blocking await in the UI layer, and rank by … latency before any backgrounding
  work is designed."* This is a **LATENCY** audit — about making the user WAIT LESS by starting
  work earlier, in parallel, or speculatively.
- **This artifact is the latency one.** A previous round mis-scoped N68 as a loading-STATE-LEGIBILITY
  audit (is the spinner announced, is empty distinguishable from loading). That work was real, found
  real defects, and was split out to **N84** (`docs/backlog.yml:155`), whose artifact — confusingly —
  lives at `docs/loop/N68.ac.r1.md`. **I read N84's artifact in full this round and this document
  deliberately does NOT touch its subject** (announcement, empty-vs-loading, retry, silent-swallow
  as a *legibility* problem). My subject is TIME. Where the two meet, I cross-reference (§7).
- Filename note: I wrote to `docs/loop/N68-latency.ac.r1.md` rather than `docs/loop/N68.ac.r1.md`
  precisely so I do not overwrite N84's artifact. The orchestrator should be aware both files exist.

## 0.1 Provenance (standing rule: re-read, or mark CITED)

- **Personally read against HEAD 2026-09-28, this round:** the login load chain
  (`page.js:371-458`), the tracking-table load (`page.js:1080-1179`), the manual-tailor flow end to
  end (`useManualTailor.js:40-320`), the preview-open path (`useDocumentPreview.js:146-209,287-314,
  405-433,883-904`), the saved-search Greenhouse prewarm (`page.js:677-738`), the tailor route's
  generation sequence and its grounding dependencies (`app/api/tailor/route.js:405-537`), the
  live-feed / auto-apply-queue load triggers (`LiveFeedTab.js`, `AutoApplyQueueTab.js` grep + effect
  lines), and the `Promise.all` census across `app/` and `lib/`.
- **CITED, NOT re-verified this round:** the interview-prep route's "thirteen gates" cost (from N45/N50
  cards), and the `getSession()`-makes-zero-requests fact (from the `supabase-auth-probes` memory,
  used only to note the auth gate is instant — not load-bearing to any criterion).

## 0.2 The honesty caveat, up front (the card's hardest demand)

The card demands latency ranked by **measured** wait time, and cites this repo's own repeated lesson
(N32/N49) that asserted numbers are untrustworthy until instrumented. **I did NOT measure wall-clock
times, and I state that plainly rather than quoting a fabricated millisecond figure.** Two reasons,
both structural:

1. **jsdom cannot measure wall-clock or true concurrency** (backlog N74, verified there against
   `vitest.config.js`'s `environment: "jsdom"`). It proves ORDERING and INITIATION-ORDER, never
   elapsed time and never a true mid-flight race.
2. There is no production telemetry in this repo that records real provider/DB round-trip times per
   surface (grep for timing/`performance.now`/latency instrumentation in `app/` returns only unrelated
   hits).

So I ranked by **round-trip STRUCTURE** — a reasoned proxy the card's own evidence already uses:
provider (LLM/external) round-trips dominate DB round-trips dominate local CPU, and *N* serial
independent round-trips cost the SUM where they could cost the MAX. This is a defensible ordering and
I say exactly what it is. **True wall-clock ranking remains named gated work** (AC-L10): it needs
production instrumentation or a real browser with the Network panel, neither available to this seat.

## 0.3 The headline finding (it reframes the problem, like N84's did)

Going in, the obvious guess — from the card itself — is that the dominant wait is generation, so the
lever is "parallelize the tailor request." **That guess is wrong, and the reason is domain-specific.**
The tailor route runs three provider calls strictly in series (`route.js:409` résumé → `:450` cover
letter → `:517` hiring email), but **the cover letter and the email are deliberately grounded in the
TAILORED résumé** (`route.js:441` `pickTailoredResume(tailoredResumeLines, result)`, passed as
`tailoredResume` into both, `:456`/`:523`; the `:460-462` comment says the letter "draws its substance
from the same tailored résumé"). Parallelizing résumé-with-cover would produce an **ungrounded** cover
letter — a generic letter about the wrong tailored content, exactly the failure this app exists to
prevent. So the biggest single wait is **largely irreducible by parallelization**, and the audit's real
value is elsewhere:

- the **DB-load serial chains** at login and tracking-load (independent round-trips run in series — the
  highest-value *safe* wins, because they touch only the user's own Redis/Supabase, so no provider
  quota is spent), and
- **work serialised onto the critical path that need not be** — persistence blocking the preview open;
  and one narrow, domain-SAFE server parallelization (cover ∥ email, since both depend only on the
  résumé, not on each other).

## 1. The wait-point enumeration, ranked by reasoned latency (the card's core deliverable)

"Serial hops" = independent round-trips that today run one-after-another on the path the user waits on.
Tier by round-trip class. Every row cites file:line I read this round.

| # | Wait point | Where | Class | Serial hops reducible? | Already addressed? |
|---|---|---|---|---|---|
| **W1** | Résumé + cover + hiring email generation | `route.js:409,450,517` | provider ×3 (server, serial) | **résumé→cover NO** (grounding, :441/:456); **cover∥email YES** (both depend only on résumé, :450 vs :517) | partial — see AC-L5 |
| **W2** | Company research (external + grounding) | `useCompanyResearch` `openCompanyResearch` → `/api/company-research` | provider | start-earlier: **owned by N61/N72/N73** | **YES — N73 warm already lands** (`useManualTailor.js:257`, `useDocumentPreview.js:307,903`), deduped fire-and-forget |
| **W3** | Interview-prep pack generation (POST) | `usePrepGeneration.js:55` → `/api/interview-prep` | provider (multi-stage) | prefetch = **SPECULATIVE SPEND** — owner decision (AC-L8) | user-fired; not on any auto path |
| **W4** | Login load chain | `page.js:381,394,425,434-loop` | DB/Redis ×5 (serial, independent) | **YES — fully** (AC-L2) | no |
| **W5** | Tracking-table load | `page.js:1102,1117,1133,1153` | DB ×4 (query + 3 serial independent sub-fetches) | **YES — sub-fetches** (AC-L3) | sub-fetches already batched with `.in()`, not N+1 (credit); only the 3-way serialization remains |
| **W6** | Preview open blocked behind persistence | `useManualTailor.js:271-303` then `:307` | DB ×3 serial, gating a synchronous modal open | **YES** (AC-L4) | no |
| **W7** | Live-feed load on tab open | `LiveFeedTab.js:143,166,218` | external/DB | prefetch = SPECULATIVE (external) — owner decision (AC-L8) | 3 loads already concurrent (separate effects); Job-Search feed is prewarmed (P1) but the Live-Feed tab is not |
| **W8** | Interview-prep pack READ on dialog open | `AppViewDialog.js:95` | DB read | prefetch-on-hover possible (read-only, no LLM spend) — low value, gated | row-level pack-existence prefetch already exists (`ApplicationCard.js:205`) — credit |
| **W9** | `buildTemplateLinesForUpload` ×2 before tailor POST | `useManualTailor.js:130,136` | local CPU ×2 serial | **YES — precompute at upload** (AC-L6) | no; LOW value |
| **W10** | Preview docx model build per open | `useDocumentPreview.js:411` `parseDocxToModel` | local CPU, rebuilt each open | cache-per-version possible — low value, gated | no |
| **W11** | Version-history load on preview open | `useDocumentPreview.js:202-209` | DB | already non-blocking | **YES — fire-and-forget** `loadVersionsForJob`, never blocks the open (credit) |

## 2. Already parallel / already prefetched — DO NOT REBUILD (this repo has nearly-rebuilt what it had)

- **P1 — Saved-search Greenhouse PREWARM** (`page.js:677-738`). The reference implementation of exactly
  what the owner is asking for: on mount, each saved search's Greenhouse results are fetched in the
  background by a **concurrency-limited worker pool** (`PREWARM_CONCURRENCY`, `Promise.all(workers)` at
  `:736`), **TTL-cached** (`PREWARM_FRESH_MS`, skipped if fresh, `:686`) into `prewarmedResults`, and
  consumed later so the Job-Search tab is instant. This — alongside the cron route the card names
  (`app/api/cron/tailor/route.js`) — is the in-app precedent any backgrounding design must model on,
  not reinvent.
- **P2 — Company-research WARM (N73)**, fire-and-forget and deduped, at generation-complete
  (`useManualTailor.js:257-268`) and preview-open (`useDocumentPreview.js:307,903`), keyed on the run's
  own `jobId` so the two warms collapse to one paid call (`researchStartedRef`). Do not duplicate;
  the *residual* (starting it at generation-START) is N61's, §7.
- **P3 — Version history** loads fire-and-forget and never blocks the preview (`useDocumentPreview.js:
  202-209`).
- **P4 — Mount loads are concurrent RELATIVE TO EACH OTHER.** `loadUserData`, `loadApplications`,
  `loadGmailMessages`, and the prewarm live in **separate** `useEffect`s (`page.js:371,1080,934,677`),
  so none awaits another; the serialization in W4/W5 is strictly *within* one function.
- **P5 — Server routes already parallelize their own internal reads** where independent
  (`auto-apply-queue/route.js:53`, `library/route.js:18`, `copilot/ask/route.js:148`,
  `interviewPrep/prepRevisionStore.js:297,458`, and ~50 more `Promise.all` sites). Server-internal
  read fan-out is not a gap.
- **P6 — Tracking sub-fetches are batched** (`.in(ids)`, `page.js:1117,1133,1153`), not per-row N+1.
  The only defect in W5 is that the three batches run in series.

## 3. Acceptance criteria

Scope of a criterion = the enumerated wait points (§1). Written so the SAFE direction passes. Each
names its instrument and its RED-on-HEAD status. The concurrency criteria are proven by an
**initiation-order** instrument, explained once here and referenced by each:

> **The initiation-order instrument (and why it is real, not zero-power, and not blocked by N74).**
> Mock each endpoint/round-trip to return a promise the test controls (a deferred). Invoke the load.
> **Before resolving any deferred, assert that all N calls have already been issued.** Under today's
> serial `await`s only the first call fires before the first resolves, so the assertion **FAILS on
> HEAD** (RED). Under a correct `Promise.all`, all N fire before any resolves, so it PASSES. This is a
> pure ordering/initiation assertion — squarely within jsdom's power. It is NOT the thing N74 says
> jsdom cannot do: N74 is about a true mid-flight *edit race* (two writes genuinely interleaved), which
> `act()` serialises. Initiation-order is not a race; it is which calls exist at a point in time. Each
> criterion below that uses it must say so, so the 4b/9 seats do not mis-file it as an N74 violation.

**AC-L1 — the audit enumeration is complete and honest.** §1 IS the required enumeration and §2 the
already-done list. Any design round consuming this MUST (a) re-read `route.js:441,456,523` before
acting on W1 (the grounding dependency is the whole reason W1 is not a free win), and (b) confirm no
candidate-waited-on `await fetch(` / awaited DB round-trip in `app/hooks/*` or `app/components/*` is
missing from §1, via a canaried grep (census this round: 28 `await fetch(` in hooks, 34 in components,
105 total `fetch(` non-test in `app/`; canary — the same grep restricted to `/api/tailor` returns the
two known call sites, so the instrument sees them). Instrument: the tables + the canaried census. RED
on HEAD: **n/a — this is the audit deliverable itself**; it is a non-regression guard against a new
un-enumerated wait point, not a behavioural claim.

**AC-L2 — the login load chain runs its independent loads concurrently, not in series.**
`loadUserData` (`page.js:374-451`) issues **five** mutually independent round-trips strictly serially:
user-context (`:381`), user-prefs (`:394`), applied-or-later ids (`:425`), résumé download and
cover-letter download (`:434`, the `for…of` loop's two iterations). None consumes another's result.
On the SAFE (passing) design they are initiated concurrently (e.g. one `Promise.all`), so the login
wait is the MAX of the five, not the SUM.
- Instrument: the initiation-order instrument, with all five endpoints mocked as deferreds; assert all
  five requests are in flight before the first resolves. Mount the real effect (or extract
  `loadUserData` behind a seam the test can drive) — assert off the calls actually issued, not a flag.
- RED on HEAD: **YES** — verified serial at `page.js:381→394→425→434`; the second call is provably not
  issued until the first resolves.
- **Spend: none.** All five are the user's own Redis (`/api/user-context`, `/api/user-prefs`) and
  Supabase (`loadAppliedOrLaterExternalIds`, two Storage downloads). No provider quota. This is the
  cleanest, highest-value, zero-risk win in the audit.
- Failure direction: the harm is a needlessly slow login; the passing state fires them concurrently. A
  regression that reintroduces a serial `await` between any two of the five FAILS.

**AC-L3 — the tracking-table load's three independent sub-fetches run concurrently.** After the
applications query resolves (`page.js:1102`), the résumé fetch (`:1117`), cover-letter fetch (`:1133`)
and interview-stages fetch (`:1153`) run in series though each depends ONLY on the first query's output
(`resumeIds`, `coverIds`, and `appIds` — all derivable from `appRows` directly; `appIds` does not
depend on `resumeMap`/`coverMap`). On the SAFE design the three are one `Promise.all` after the query.
- Instrument: initiation-order instrument; mock the three `.in(...)` queries as deferreds and assert
  all three are issued before any resolves. Mount the real effect / drive the real `loadApplications`.
- RED on HEAD: **YES** — verified serial at `page.js:1117→1133→1153`.
- **Spend: none** (user's own Supabase). Credit already-good: the sub-fetches are batched (`.in`), so
  this is a 3→1 round-trip win, not an N+1 fix.
- Failure direction: passing = three in flight together; regression to serial FAILS. **Interaction with
  N84:** N84 owns the swallowed sub-fetch failures (`:1122,1138,1160`) and the refresh-blank; making
  these concurrent must NOT convert three independently-handled failures into one all-or-nothing
  `Promise.all` rejection that loses the partial data — use `Promise.allSettled` or per-fetch catch so
  a résumé-fetch failure still lets covers/stages land. State this in the design; it is the exact
  "a flag makes a consumer skip a frame — enumerate what else it was carrying" trap.

**AC-L4 — the preview modal opens without waiting on post-generation persistence.** In
`useManualTailor.js`, the generated content is in client state by `:240`, but the modal open
(`finishByOpeningPreview`, `:307`) runs only AFTER up to three serial Supabase round-trips —
`upsertPosition` (`:273`), `upsertApplication` (`:290`), `persistGeneratedDocuments` (`:292`). Since
`finishByOpeningPreview` itself is synchronous (`useDocumentPreview.js:886-904` sets `open:true` and
fires version-load/research warm fire-and-forget), the persistence is pure dead time the candidate
waits through with a finished document already in hand. On the SAFE design the modal opens as soon as
content is ready and persistence runs in the background.
- Instrument: mount the real hook (via a harness that supplies the real `finishByOpeningPreview` from
  `useDocumentPreview`), mock the persistence helpers as an unresolved deferred, drive `tailorPosting`,
  and assert `resumePreview.open === true` (the rendered hop, not a flag) **before** the persistence
  deferred resolves. This mounts the real parent and asserts on the state that reaches the screen
  (echoing N84's last-hop discipline).
- RED on HEAD: **YES** — `finishByOpeningPreview` is textually after the awaited persistence block.
- **Spend: none.** Failure direction: passing = modal open precedes persistence completion.
- **Design consideration to flag, not decide (two real risks):** (1) `loadVersionsForJob` re-resolves
  `positionId` by `external_id` lookup (`useDocumentPreview.js:150`), so if persistence has not yet
  created the row the first version-history load returns empty — acceptable (it is fire-and-forget and
  re-runnable) but the design must confirm it, not assume it. (2) Backgrounding persistence must NOT
  silently swallow a persistence FAILURE — a document that appears saved but is not is a data-loss
  harm; the failure must still surface (this is where AC-L4 hands off to N84's legibility/decision-log
  criteria — reference, do not re-specify here).

**AC-L5 — the tailor route runs the hiring email concurrently with the cover letter (never the résumé
concurrently with either).** The résumé (`route.js:409`) MUST precede both the cover letter and the
email because both are grounded in `tailoredResume` (`:441,:456,:523`) — parallelizing the résumé away
is a QUALITY regression and is explicitly OUT of scope (§7). But the cover letter (`:450`) and the
email (`:517`) depend only on the résumé result and **not on each other**, yet run serially. On the
SAFE design they run concurrently after the résumé (`await Promise.all([cover, email])`), removing one
provider round-trip from the tailor request's wall-clock without changing what is generated or how it
is grounded.
- Instrument: a server-route test (or a test of the extracted orchestration) with `tailorResume`,
  `tailorCoverLetter`, `tailorHiringEmail` each a controllable deferred; assert (i) neither cover nor
  email is invoked until `tailorResume` resolves, AND (ii) both cover and email are invoked before
  either resolves. Both halves are RED-detectable initiation-order assertions.
- RED on HEAD: **YES for (ii)** — cover and email are serial (`:450` awaited before `:517`). (i) already
  holds and is a GUARD that the fix does not over-correct by parallelizing the résumé away.
- **Spend: none extra** — same three calls, run concurrently, not more of them.
- **Failure direction & the trap:** the dangerous over-correction is running the résumé concurrently
  (ungrounded letter) — so (i) is written as a passing guard specifically to forbid it. Also: the
  route's warning aggregation and error attribution (`route.js:567-579`, plus the per-call `try/catch`
  at `:449-491` and `:516-536`) assume sequential completion; a `Promise.all` must preserve
  per-artifact error isolation (a failed email must not fail the cover letter, and vice versa) — use
  `Promise.allSettled` semantics. This is the same "enumerate what else the frame carried" trap as
  AC-L3.

**AC-L6 — (LOW value; included for completeness, flagged as marginal) template-line parsing is off the
submit critical path.** `buildTemplateLinesForUpload(resumeFile)` (`useManualTailor.js:130`) and the
cover-letter equivalent (`:136`) are two serial local docx parses awaited *before* the `/api/tailor`
POST (`:141`). They depend only on `resumeFile`/`coverLetterFile`, which are set at upload/mount
(`page.js:434-438`), so they can be computed once when the file is set, cached, and reused at submit —
removing two serial parses from the click-to-generation path.
- Instrument: assert that on submit with an unchanged file, `buildTemplateLinesForUpload` is NOT called
  on the submit path (the value is read from cache). Caveat: this is local CPU, not a round-trip, so
  the win is small (docx parse of one file, tens of ms) and jsdom cannot time it — the criterion pins
  the *structure* (precompute-and-reuse), not a duration.
- RED on HEAD: **YES** structurally (the parse is inline on the submit path today). **I flag this as low
  priority** — it should not displace L2/L3/L4/L5 and a design round may reasonably defer it. It is here
  so the enumeration is honest, not to pad the count.

**AC-L7 — company-research concurrency is OWNED BY N61/N72/N73; this chunk does not re-specify it.**
The residual latency gap — research today starts at generation-COMPLETE (`useManualTailor.js:257`, after
`/api/tailor` returns the company at `:150`), not at generation-START — belongs to N61's "have the facts
researched at the same time the résumé and cover letter are being generated" (owner-decided (b),
`BACKLOG.md:80`; split into N72 auto-insert function and N73 coordinating trigger). Closing that gap
requires resolving the company from the posting text before generation, or kicking research off
server-side inside `/api/tailor` — both N61/N72/N73 territory. **Non-duplication guard.** RED on HEAD:
n/a here.

**AC-L8 — speculative prefetch of PROVIDER/EXTERNAL work is an OWNER SPEND DECISION, not decided here,
and no criterion in this document forces it.** Candidates for start-earlier prefetch that would spend
real quota or external round-trips on results the user may never look at:
- Live-Feed tab data (`/api/feed`, `LiveFeedTab.js:218`) prefetched on mount/idle/hover — external
  Greenhouse ingest (the Job-Search tab is already prewarmed, P1; the Live-Feed tab is not).
- Interview-prep pack GENERATION (`/api/interview-prep` POST) prefetched — LLM spend, multi-stage.
- Any research/generation warmed for a posting the candidate never opens.
The owner has set spend bounds elsewhere (20 tailors/user/day, 4 mails/address/day, 10 mails/account/day
— per this seat's brief). **Escalation:** whether to spend provider/external quota speculatively to cut
wait time is exactly the irreversible/spend-posture class that is the owner's to decide, not this
seat's. Recorded as **named gated work with an owner spend decision attached**; deliberately NOT written
as an implementation criterion. (Read-only prefetches — e.g. the interview-prep pack GET at
`AppViewDialog.js:95`, or the tracking sub-fetches — are DB reads, no provider spend, and could be
prefetched safely, but are low-value and left as gated work, not forced.)

**AC-L9 — (PROVISIONAL; gated) reuse rather than refetch on refresh.** `loadApplications` refetches
applications + all three sub-fetch batches on every `applicationsRefreshKey` bump (`page.js:1179`
dependency), even when a single row changed. An incremental/targeted refresh would cut the post-action
wait. Instrument: assert a single-row status change does not trigger a full re-query of all three
tables. **Provisional and left gated:** the value depends on how often the key bumps and how large the
table is, which I did not measure; and the change interacts with N84's refresh-blank finding. I record
it as an opportunity, not a RED criterion I am confident carries its weight.

**AC-L10 — the instrument/honesty constraint (the N74/N32/N49 guard).** Every concurrency criterion
(L2, L3, L4, L5) is proven by the **initiation-order** instrument (all-in-flight-before-any-resolves),
NEVER by a wall-clock/elapsed-time assertion — jsdom cannot measure time or a true race (N74). No
criterion in this document quotes a measured-millisecond latency, because none was measured (§0.2).
**True wall-clock ranking of §1 remains named gated work** requiring production telemetry or a real
browser Network panel; a later round must not present an initiation-order test, or my structural
ranking, as if it were a measured duration. Failure direction: a downstream test that asserts "faster"
via a timer, or a report that quotes an invented millisecond figure, FAILS this guard.

## 4. Spend and escalation summary

- **No-spend, safe, high-value (decide-and-build without the owner):** L2 (login chain), L3 (tracking
  sub-fetches), L4 (preview-before-persistence), L5 (cover ∥ email). All touch only the user's own
  Redis/Supabase or re-order existing provider calls without adding any.
- **Owner spend decision (escalated, not decided here):** L8 — any speculative prefetch that spends
  provider/external quota (Live-Feed prefetch, interview-prep generation prefetch, research for
  unopened postings).
- **Owned elsewhere (reference, do not duplicate):** L7 → N61/N72/N73 (research concurrency); Gmail
  latency/failure → N79/N80; loading legibility → N84.

## 5. Explicitly OUT of scope

- **Parallelizing the résumé generation with the cover letter or email** — the cover letter and email
  are deliberately grounded in the tailored résumé (`route.js:441,456,523,460-462`); doing so degrades
  output quality. Only cover ∥ email is in scope (L5), and only because they are mutually independent.
- **Loading legibility** (announcement, empty-vs-loading, retry, silent-swallow AS a legibility defect)
  — N84 (`docs/loop/N68.ac.r1.md`). This document references N84 only where a latency change could
  regress legibility (L3, L4).
- **The Gmail surface's latency and failure handling** — N79/N80.
- **Company-research concurrency at generation-START** — N61/N72/N73 (L7).
- **Server-internal read fan-out** — already parallel (P5); not a gap.
- **Rebuilding the saved-search prewarm** (P1) or the research warm (P2) — they exist and work; they are
  the precedent, not a target.
- **Any wall-clock measurement or ranking presented as measured** — not doable by this seat; gated
  (L10).

## 6. What I could not verify / could not make falsifiable, stated plainly

- **I did not measure real wait times** (§0.2). The §1 ranking is by round-trip structure, a reasoned
  proxy, not instrumentation. The card asked for measurement; this is the one place I am honestly short
  of its literal ask, and I say so rather than quote a number I did not take.
- **W1's email dependency:** I verified the email reads `tailoredResume` and `result.*`
  (`route.js:520-523`) so it depends on the résumé; I did NOT trace whether the underlying
  `tailorHiringEmail` engine implementation has any hidden dependence on the cover letter. The design
  seat must confirm cover-and-email independence before pinning L5(ii) — if the email ever consumes the
  cover letter, L5's parallelization is wrong. Attack this first.
- **L6/L9 are low-value/provisional** and marked as such; they are in the enumeration for honesty, not
  to inflate the criteria count. A design round may defer both.
- **L10 wall-clock ranking** is unfalsifiable in this environment by construction; it is named gated
  work, not a criterion I claim to have satisfied.

## Proposed ledger lines

| ID | Requirement (checkable) | Instrument | RED on HEAD? | Evidence | Spend |
|----|-------------------------|------------|--------------|----------|-------|
| AC-L1 | §1 wait-point enumeration + §2 already-done list complete; W1 grounding dependency re-read before action; canaried census guards against a new un-enumerated wait point | the tables + canaried grep (28 hooks / 34 components `await fetch(`) | n/a (audit deliverable + guard) | §1, §2; `route.js:441,456,523` | — |
| AC-L2 | Login chain's 5 independent loads initiated concurrently, not serially | initiation-order (5 deferreds; all in flight before first resolves); mount real effect | **RED** | `page.js:381,394,425,434` (serial) | none (Redis/Supabase) |
| AC-L3 | Tracking-table résumé/cover/stage sub-fetches initiated concurrently after the applications query; partial-failure isolation preserved | initiation-order (3 deferreds) + `allSettled`/per-catch assertion | **RED** | `page.js:1102,1117,1133,1153`; batched `.in` credited | none |
| AC-L4 | Preview modal opens before post-generation persistence resolves; persistence backgrounded without swallowing a persist failure | mount real hook; assert `resumePreview.open` true before persistence deferred resolves | **RED** | `useManualTailor.js:271-303` then `:307`; `useDocumentPreview.js:886-904` | none |
| AC-L5 | Tailor route runs cover ∥ email (both after résumé); résumé never concurrent with either; per-artifact error isolation kept | server-route test, 3 deferreds: (i) neither before résumé resolves [guard], (ii) both before either resolves [RED] | **RED (ii); guard (i)** | `route.js:409,441,450,456,517,523,567-579` | none extra |
| AC-L6 | Template-line parsing precomputed at upload, off the submit path (LOW value) | assert `buildTemplateLinesForUpload` not called on submit with unchanged file; structure-only (local CPU) | RED (structural) | `useManualTailor.js:130,136` vs `page.js:434-438` | none |
| AC-L7 | Research-concurrency-at-generation-start is N61/N72/N73's; not re-specified here | non-duplication guard | n/a (owned elsewhere) | `useManualTailor.js:257`; `BACKLOG.md:80`; N72/N73 | — |
| AC-L8 | Speculative PROVIDER/EXTERNAL prefetch (feed, prep generation, unopened-posting research) is an OWNER spend decision; not forced by any criterion here | escalation, not a test | n/a (gated, escalated) | `LiveFeedTab.js:218`; `usePrepGeneration.js:55`; spend bounds per brief | OWNER decision |
| AC-L9 | Reuse-not-refetch on `applicationsRefreshKey` (PROVISIONAL, gated) | assert single-row change does not full-refetch all 3 tables | RED (structural) — provisional | `page.js:1179` | none |
| AC-L10 | Concurrency proven by initiation-order only, never wall-clock; no measured-ms figure claimed; true latency ranking is gated | constraint on L2–L5's tests + honesty guard | guard (not independently RED) | N74 (jsdom limit); N32/N49; §0.2 | — |
