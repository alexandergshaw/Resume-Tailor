# N176 corrected design and bounded implementation plan

Author /root/prep_contract; model observation unknown, usage unavailable. Proposed combined scope/criteria/design/plan input, not implementation or engine acceptance. Owner-approved NEW manual window begins 2026-10-23T18:10:07Z and ends **19:40:07Z**. Root controls the corrected environment/new store and remaining assignment budget; this document does not create or modify policy. No code/tests/gates/Git/provider calls by this author.

Accepted inputs retained: original contract383D291A…, grounding amendment4231C4B6… with check3F4519…, adversarial amendmentE63E16D9… with checkB6AA…. Original N176-01..15 plus N176-16..25 remain obligations, not replaced by a narrower checklist. Source semantic R1/R2 four-class review and distinct integration formatting check remain CLOSED; this owner scope addition has its own author/check chain, maximum two substantive rounds. No new SDK/install/schema/auth system, external messaging, deployment or paid developer/provider dispatch authority.

## Bounded architecture

Keep existing twelve-stage workbench/local generators/persistence and original Copilot/Tracking behavior. Add ONE owned context endpoint plus ONE explicit semantic-review action on that same new route; a pure shared context/evidence policy and review contract; visible source and review panels. No migration or general agent framework. Root wires the existing real aggressiveness and tailorMode props; Preparation shows these values and navigates to Materials for the SAME existing slider. No independent Preparation slider/store.

### Exact application-ready source context

New server-only `lib/interviewPreparation/candidateContextStore.js` takes injected authenticated Supabase client and userId/applicationId. It queries owned applications(id,resume_used_id,cover_letter_id), then the exact selected generated_resumes/generated_cover_letters rows with id,content,created_at,user_id and explicit matching user_id. Re-read application pointers after document load; mismatch returns stale-context/retry, never a mixed pair. Do not fetch latest per company/position. Return distinct ready/missing/error per document; same-ID content binds SHA256 of exact UTF8 text. Missing timestamps remain unknown. No imagined generation-strength columns: historical resume/cover strength explicitly unknown unless actual existing authoritative metadata is discovered and separately admitted. No existing text-only applicationDocs signature changes.

New `app/api/interview-preparation/route.js` GET authenticates with existing createSupabaseServerClient/getUser before source work. Takes an applicationId only, returns owned exact source context with document IDs/content identities/date/text and explicit failures. No arbitrary URL/server fetch. Manual workspace also supports an explicit Use supplied resume and cover action: user-pasted public document text receives separate manual-source IDs and exact content identities, with origin USER-SUPPLIED DOCUMENT rather than database-generated/application-selected. Manual evidence and reviewed acceptance are visibly against those supplied documents, not certified as an owned generated application pair. This enables the bounded Cedar fixture without a database write. Both source modes retain missing/error diagnostics; an owned application cannot silently substitute unrelated manual text for a missing generated version. Manual context remains scoped to the signed-in account/manual workspace and does not falsely satisfy the application-owned branch of N176-16. All twelve manual tools remain usable as unreviewed drafts if semantic capability/authority is unavailable.

Pure `candidateContext.js` creates evidence records from BOTH resume and cover, retaining document kind/ID/contentIdentity, exact excerpt and stable source IDs. Same-text evidence can link to both documents rather than drop cover. Supplemental experience requires explicit checkbox confirmation and separate user-origin ID. Generated-document assertions remain source claims, not independent truth. Conservative contradiction detection flags directly conflicting sourced numbers/dates/ownership for review; do not claim a complete semantic contradiction detector. Semantic review supplies deeper conflict judgment.

Context identity includes account/application, both document identities/content hashes, job text, confirmed supplement IDs/text and actual requested strength/mode. Client source hook fences account/application/input generations; one context snapshot is consumed by every personal-output path. Original local workspace schema extends additively with guarded optional context/review fields and defaults for valid legacy data; legacy drafts are retained but unlinked/stale. Keep prior read-retry/conflict-choice, malformed nested recovery, history refusal and role-priority protections.

### Strength and grounded local generation

Page passes `aggressiveness`, `tailorMode` and `onChangeStrength` navigation callback into InterviewPreparation, through keyed account/workspace boundaries. Existing `tailorLevel.js` constants/levelAriaValueText are reused; Ideal remains separate from standard1..5. UI explicitly contrasts Current requested strength with Historical document-generation strength: unknown. Change strength action uses nav.goMainTab('applying') and opens existing options if required; returning observes actual page state. Do not imply saved global slider value is historical per-document provenance.

Local generation is deterministic authorship, semantically reviewed later by a fresh model context. Light selects the strongest one/two exact supported anchors and close-to-source framing; Balanced selects a small varied evidence set; Strong may use a broader relevant supported set and more direct role alignment. Intermediate levels preserve ordered existing1..5 vocabulary. Counts are implementation policy, not semantic truth; tests assert meaningful supported contrast and invariant facts rather than arbitrary exact phrases. Ideal uses only the application-ready resume and actual cover for autobiography, with a visible hypothetical-study exclusion. It never becomes aggressiveness6 or license for invented experience. No hypothetical slot is accepted as a source.

Workbench `buildTool` receives an optional/shared candidate context, not loose resume||background for personal facts. Role evidence checks BOTH documents. Story tool auto-proposes anchors from actual role-relevant excerpts, linked to sources; missing context/ownership/decision/action/result/learning stays a question/Needed. User edits supply missing detail, eligible for generated first-person assertions only when explicitly confirmed as supplemental experience. Cover-only supported motivation/experience has a measurable effect on introduction/why-company/story/fit output. Company/job facts can motivate questions but cannot become “I did X.” Practical salary/authorization remain supplied preferences.

Every personal output returns a claim/evidence map and context basis: introduction, story/sample answer, fit, repair suggestion, reference and follow-up. Pure source-derived first-person suggestions quote or conservatively reframe supplied statements; unsupported background is marked supplemental/unconfirmed, not silently blended. Contradictions stay visible/unresolved. Actual typed rehearsal answer and parent versions remain unchanged; a new **Build grounded sample answer** suggestion and **Suggest grounded repair** are separate draft artifacts with the same context. Old local rubric remains a heuristic practice aid, not semantic approval.

Remove/disable only the NEW TAB'S strength-unaware **Generate existing prep** control, replacing it with a clear legacy-generation-not-context-bound explanation. Historical existing prep and Open Tracking prep can remain source-only/history with unknown document/strength/review basis. Do not change shared old /api/interview-prep, usePrepGeneration or Copilot routes in this bounded wave. Fresh authoring from THIS tab flows through its own context-bound local generators plus review, so no hidden fresh-generation bypass claims fulfillment. Opening Tracking is clearly leaving the reviewed preparation pipeline, not a reviewed-generation action.

### Stateless distinct adversarial review

New route POST uses existing getServerEnv/getGeminiClient/parseModelJson and the installed @google/genai client. No new provider SDK. Auth first, validate and cap streamed body before parse (128KiB), owned application ID, bundle/target IDs/text, requested1..5/mode and confirmed supplemental input. For an owned application, server reloads authoritative current docs and compares expected document/context identities before dispatch; never trust client text labeled generated docs. For explicit MANUAL source mode with no applicationId, validate both user-supplied document texts and compute content identities server-side, mark every source manual/user-supplied, and bind review to that exact pair; do not query/create a database fixture or silently promote manual origins to generated provenance. Selected Embedded returns explicit semantic-review-unavailable with zero model calls; provider missing configuration/failure yields failed/unreviewed, NEVER deterministic-clean fallback.

Author is the deterministic tool/user draft, reviewer is a separate stateless generateContent invocation with fresh system reviewer role and no author conversation/history. Existing Gemini model may be reused: different model not required, different invocation/context is required and disclosed. Requested model comes from configured geminiModel; observed model/version only when actual response reports it, otherwise unknown. Reviewer input contains actual CURRENT bundle texts, context evidence, job, requested strength and source-claim caution. All supplied material/past findings is delimited DATA; no embedded instruction can redefine role/gates/budget. Do not reuse the general copilot critique endpoint because its heuristic fallback and missing context/version contract cannot satisfy this review.

`reviewPrompt.js` defines role and structured response contract; `reviewContract.js` validates actual bound target/context hash, complete target coverage, verdict clean/changes-required/advisory and bounded findings. Each finding has severity/blocking flag/class/reason/recommendation, actual draft ID+exact quote, and supporting/conflicting source IDs+exact source quotes or explicit missing-evidence reason. Bundle findings can cite multiple draft IDs/quotes. Validate all citations against actual snapshots; invalid schema/coverage/quote/source means review error, not clean. A clean verdict with hard-blocking findings is invalid. Return probing interviewer follow-ups tied to actual gaps/claims. “No issues found” is a bounded observation, not guaranteed truth.

Bound each explicit click to ONE review call, no automatic loop or mount/reopen call. Proposed product limiter: six attempts/10min/authenticated user/per instance using existing createRateLimiter/identify/rateLimitHeaders at module scope; one concurrent semantic request per user/per instance. Disclose per-instance/fleet limitation, not a global spend guarantee. UI retains at most three visible review attempts per current review sequence before requiring user to start a new explicitly visible sequence; it never silently auto-repairs or switches engine. Server rate limit remains across sequences. These are bounded product policies subject to independent design acceptance, not paid development-call authorization. A 45sec request watchdog fails review and fences acceptance; if installed SDK cannot guarantee cancellation, retain the server in-flight lease until underlying call settles, never claim timeout proves termination. Client AbortController cancels local adoption and marks cancelled; do not claim sunk provider work/cost is cancelled unless observed.

### Review UX, acceptance and history

New `PreparationReview.js` is common to all generated personal suggestions. Show Draft/unreviewed, Reviewing, Findings, Review failed/unavailable/cancelled, Stale, Reviewed or Accepted-with-advice honestly. Display evidence/source links/excerpts, reviewer identity/limits, severity/reasons, concrete revisions and probing follow-ups. User can save/edit/export any draft regardless of review status; only **Accept reviewed suggestion** is gated on fresh valid independent review with no hard blockers. Acknowledge style-only advice explicitly records finding IDs and reason; never relabel it clean or waive unsupported personal claims. For blocked output, user edits/revises or adds confirmed real fact, then explicitly requests new independent review. Previous draft/findings/review identity remain in before/after history, within existing bounded/refusal behavior.

Review target includes current bundle IDs/text (accepted/editable artifacts and active suggestion, plus the selected sample/repair). Exact draft edit or doc/job/strength/supplement change immediately makes verdict stale. A batch bundle review is one call, not25 calls. Any accepted artifact uses its exact current reviewed text identity; copying a reviewed paragraph into a different bundle does not certify contradictory surrounding material. Context/target hashes and citation validation enforce recorded freshness but cannot prove semantic judgment quality; actual adversarial fixtures/provider qualification remain separate.

## Exact proposed write ownership

Existing product paths (semantic/integration accepted baseline plus amended owner scope):

1. hello-world/app/page.js
2. hello-world/app/components/BackButton.js (existing sibling label only; preserve)
3. hello-world/app/preparation/InterviewPreparation.js
4. hello-world/app/preparation/PreparationWorkspace.js
5. hello-world/app/preparation/PreparationTools.js
6. hello-world/app/preparation/PreparationRehearsal.js
7. hello-world/app/preparation/PreparationReference.js
8. hello-world/app/preparation/usePreparationWorkspace.js
9. hello-world/app/preparation/usePreparationSources.js
10. hello-world/app/preparation/preparation.module.css
11. hello-world/lib/interviewPreparation/workbench.js
12. hello-world/lib/interviewPreparation/workspaceStore.js

New product paths:

13. hello-world/lib/interviewPreparation/candidateContext.js
14. hello-world/lib/interviewPreparation/candidateContextStore.js
15. hello-world/lib/interviewPreparation/reviewContract.js
16. hello-world/lib/interviewPreparation/reviewPrompt.js
17. hello-world/app/api/interview-preparation/route.js
18. hello-world/app/preparation/PreparationReview.js
19. hello-world/app/preparation/usePreparationReview.js

Independent test paths:

20. hello-world/lib/interviewPreparation/workbench.test.js
21. hello-world/lib/interviewPreparation/workspaceStore.test.js
22. hello-world/app/preparation/InterviewPreparation.test.js
23. hello-world/app/preparation/PreparationRehearsal.test.js
24. hello-world/app/preparation/usePreparationSources.test.js
25. hello-world/app/page.preparation.wiring.test.js
26. hello-world/app/components/BackButton.test.js
27. hello-world/lib/interviewPreparation/candidateContext.test.js
28. hello-world/lib/interviewPreparation/candidateContextStore.test.js
29. hello-world/lib/interviewPreparation/reviewContract.test.js
30. hello-world/app/api/interview-preparation/route.test.js
31. hello-world/app/preparation/PreparationReview.test.js

Conditional exact measured accounting only (no allowance/classifier weakening):

32. hello-world/lib/sourceScan/exportReachability.sweep.test.js
33. hello-world/lib/sourceScan/exportReachability.ledger.md
34. hello-world/lib/sourceScan/exportReachability.ledger.history.md

Root-only versioned scope/state/backlog/report paths require separate root admission; author does not own them. This is proposed scope until checked and packet-admitted. Read-only callers: existing owned application/document functions, ApplyingControls/tailorLevel/tailorLevelRequest, engine selector, llm/client/config, rateLimiter, Supabase server client, navigation. No changes to schema, auth contracts, shared copilot/prep APIs, provider configuration or deployment config. Page MUST remain STRICT<3015 newline-split lines; keep already accepted compact new wiring/scanner-safe JSX strings. Extract context/review logic to new modules instead of growing page or weakening ceilings.

## Triggered specialist triage

- Security/privacy REQUIRED: server authenticates and re-loads exact owned pair, explicit user filters; untrusted source/draft instructions; safe evidence locators/no unsafe URL; no browser importing server store/SDK; no sensitive raw prompts in logs; body limits and cross-account race controls.
- Reliability/operations/cost REQUIRED: partial source failure vs missing; pointer/content coherence; current context/target freshness; malformed result fail closed; rate/concurrency/watchdog/abort semantics; no unbounded loops or fake timeout termination; per-instance limits disclosed; storage history/read recovery preserved.
- UX/accessibility REQUIRED: twelve tools remain discoverable; source provenance and requested-vs-historical level clear; conflicts/missing STAR prompts; review stages/reasons/probes, keyboard controls/status and draft preservation; mobile/print. No legal/medical/payments specialist triggered because none implemented; practical answers remain supplied preferences.

## Build/test/gate/live waves

1. Independently accept this corrected combined architecture/plan and amended independent oracle design. Root admits exact role packets. The old contracts remain accepted historical inputs; no self-check or fabricated engine publication.
2. Implement pure context/evidence/strength policy plus owned loader and review contract/prompt/route. Independent tests mock only existing Supabase/Gemini/rate/time boundaries, keep actual new producer/validator. In parallel only disjoint paths after exact scope/caller comparison: UI/workbench author can proceed from frozen interfaces; test author distinct from source author. Root serializes common source/record writes and all gates/caches.
3. UI integration reuses twelve tools, real strength props, new context loader, evidence/story/sample/repair suggestions and common semantic review/acceptance. Disable legacy fresh bypass in new tab explicitly. Preserve previous fixes and user edits/history. Target source freeze by18:50Z to retain actual gate/live time, not a promise of completion.
4. Independent source/security/UX whole-diff review plus actual focused fixtures for ALL25criteria. Required negatives: resume-only and cover-only changes, two accounts/apps, unknown historical level, levels1/3/5 meaningful supported contrast, hypothetical exclusion, missing STAR/supplement confirmation/conflict, current typed originals, wrong-source citations, stale edits/level/context/verdict, failed/cancelled/unavailable semantic review and valid clean control. Server reviewer must be actual distinct invocation; deterministic tests cannot prove live semantic quality.
5. Isolated source-bound mutants: omit cover; ignore shared real strength; quote wrong doc/version; admit hypothetical or unconfirmed personal fact; bypass stale review/citation validation; accept semantic failure or author self-verdict; omit bundle conflict. Actual intended assertion failure, baseline/no-op/restored controls, terminal process reconciliation. Prior mutations may be retained only as historical or with independently checked exact executed-path reuse; never relabel all old evidence current.
6. Root's corrected fixed environment includes inherited PATHEXT as separately approved; exact current policy/store must be observed before execution. Serialize actual mandatory engine, verification, regression, lint, build, backlog; no tsc. Existing tests/scanners/strict caps remain. A failing gate is not waived by source review. Keep environmental failures diagnosed separately, not fabricated baseline passes.
7. Normal verified scoped main push + fresh loop:delivery. Deployed canonical revision must contain candidate before live claims. Actual authorized live flow: bounded Cedar public manual resume+cover pair with explicit user-supplied origin/content identities, plus separately read-only owned tracked-application exact-generated-version loading if available; no new database fixture write. Then real Materials slider change/return, stories/sample/repair and before/after stale/review, current bundle semantic findings/revision/re-review/acceptance, all twelve stage outputs, save/reopen, missing/recovery and mobile/keyboard/print, exact cleanup. No paid development semantic call authorized: if configured live reviewer use would spend unapproved resources, record that branch pending and request exact authority separately rather than falsely certify it. Source delivery may be reported separately from pending semantic live verification; full shipped requires current independently accepted live evidence and every store completion guard.

Status: corrected proposed design/plan only, all25criteria retained. Owner approval is for the corrected90-minute manual run/PATHEXT only. Provider capability/semantic qualification and actual live paid-call authority are measurement obligations, not assumptions; ask for bounded explicit semantic live-review approval at the concrete deployed UI action if needed. No new login, schema/deployment or paid development call is inferred. No implementation or test execution by this author.
