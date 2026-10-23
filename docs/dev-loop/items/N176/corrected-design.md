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

## Normative frozen wire appendix — bounded design correction R2

This appendix resolves ONLY design classes FROZEN-CONTEXT-REVIEW-WIRE-CONTRACT and OWNED-PAIR-CONTENT-COHERENCE from R1 checkA975C8BCBDF3EF41D39982DFE8C78A5A8B3F62112116ED1986943C4F49DD072D. R1 design bytes15B79675… are preserved as corrected-design-r1.md. In case of an earlier shorthand ambiguity, these exact interfaces control. No additional product criterion, provider authority or write path is introduced.

### Canonical identities and exact value objects

All identity functions below are asynchronous and use SHA-256 over UTF8, never FNV32 as exact-byte proof. Browser implementation uses Web Crypto crypto.subtle.digest; Node route/store may use the same async function through Node's available Web Crypto (or node:crypto with identical UTF8/hash contract). No browser imports server store or SDK. `canonicalJSON(value)` recursively sorts object keys lexicographically, preserves array order, accepts only JSON null/boolean/finite-number/string/array/plain-object, rejects undefined/nonfinite/unsupported values; no whitespace. `sha256(text)` returns lowercase64hex of exact text. Prefix identities `sha256:<hex>`; text is never trimmed/normalized before hashing. Context/target identities hash explicit canonical projections below; changed text or field invalidates identity. Quotes use JS string UTF16 start/end offsets with end exclusive; check `text.slice(start,end)===quote`, never normalized search.

```
Document = {
 kind:'resume'|'cover', state:'ready'|'missing'|'error',
 origin:'generated-application-ready'|'manual-user-supplied',
 documentId:string|null, contentIdentity:string|null,
 text:string, createdAt:string|null, error:string|null
}
SourceSnapshot = {
 accountId:string, applicationId:string|null, mode:'application'|'manual',
 status:'ready'|'partial'|'error'|'stale', resume:Document, cover:Document,
 observedAt:string, consistency:'stable-double-read'|'manual-captured',
 historicalStrength:{resume:null,cover:null}
}
Supplement = {id:string,text:string,confirmed:boolean}
RequestedStrength = {aggressiveness:integer1..5,tailorMode:''|'ideal'}
Evidence = {
 id:string, sourceKind:'resume'|'cover'|'supplement', sourceId:string,
 documentId:string|null,contentIdentity:string,start:integer,end:integer,quote:string
}
CandidateContext = {
 schemaVersion:1,id:string,accountId:string,applicationId:string|null,
 sourceMode:'application'|'manual',resume:Document,cover:Document,
 requestedStrength:RequestedStrength,historicalStrength:{resume:null,cover:null},
 job:{title:string,company:string,description:string},supplements:Supplement[],
 evidence:Evidence[],conflicts:[{id:string,evidenceIds:string[],reason:string}],
 missing:string[],observedAt:string
}
Draft = {
 id:string,kind:string,version:integer>=1,text:string,
 claimEvidence:[{start:integer,end:integer,quote:string,evidenceIds:string[]}]
}
Bundle = Draft[] // unique IDs; canonical target sorts by id, never silently drops a member
Target = {contextId:string,bundleId:string,draftIds:string[],authorContextId:string}
```

Document state ready requires nonempty text/id/contentIdentity, missing requires empty text/null identities and error:null; error requires error string and does not masquerade as missing. For generated documents, documentId is the selected database UUID; for manual document input the server/factory constructs `manual:<kind>:<full-content-hash>` and origin is explicit. Only confirmed supplements become personal evidence; ID `supplement:<full-text-hash>` prevents caller-chosen aliasing. Evidence sourceId is documentId or supplement ID; evidence id deterministically hashes source kind/sourceId/contentIdentity/start/end/quote. No hypothetical document kind or origin is admitted.

Context id hashes canonicalJSON of exactly schemaVersion/accountId/applicationId/sourceMode, each document's kind/state/origin/documentId/contentIdentity (not observedAt/error prose), requestedStrength, historicalStrength, job, and supplements sorted by generated id including text/confirmed. Evidence is recomputed from exact bound text, not trusted from arbitrary client metadata. Source text identity cryptographically binds full bytes. createdAt/observedAt are observation metadata, not fake immutability guarantees. BundleId hashes canonicalJSON({contextId,drafts:sortedByIdDrafts}) including exact text, version and claimEvidence. authorContextId is server-reconstructed `deterministic-author:<bundleId>`; it is NOT accepted from request/model assertions. Current context/target must be recomputed before requesting or accepting review; async hook generation fences make an old identity temporarily ineligible while a newer one is computing.

### Exact pure module exports

`candidateContext.js`:

- `canonicalJSON(value):string`; `sha256(text):Promise<string>` as above.
- `createCandidateContext({snapshot,job,requestedStrength,supplements=[]}):Promise<CandidateContext>` validates shapes, hashes exact text, generates evidence/conflicts/missing and full context identity. A supplied mismatching document contentIdentity is rejected rather than trusted. Unknown historical strength remains null. Manual snapshot accountId comes from current authenticated mode/server capture, not a generated-document claim.
- `candidateSourceText(context):string` returns supported evidence text from BOTH documents plus confirmed supplements, each visibly prefixed with source ID/origin. No hypothetical or unconfirmed supplement text.
- `contextStrength(context):{level:number,mode:string,label:string}` reuses real tailorLevel vocabulary, never level6 aggressiveness.

`workbench.js` retains existing STAGES/createInputs/buildMockQuestions/reviewAnswer/rankRepairs signatures. Compatible extension is `buildTool(stage,inputs,sources={},artifacts={},context=null)`. Context-null preserves useful legacy/manual draft building but returns `groundingStatus:'unlinked'`, no reviewed acceptance. Context-aware output adds `contextId`, `groundingStatus:'linked'|'incomplete'`, `evidenceIds:string[]`, `claimEvidence:[...]`, and `draftKind` while retaining title/text/missing/basis and existing optional themes/facts/stories/questions. Source-linked story/sample/repair candidates use exact evidence anchors; other personal prose attaches claims only when exact support is available. Existing basis may remain UI hint, but review/source exactness uses new SHA256 context/bundle identities. `stage='sample'|'repairSuggestion'` is allowed for separate rehearsal suggestions without adding fake new top-level stages; source-backed draft is separate from the original typed attempt.

`reviewContract.js`:

- `createReviewTarget(context,bundle):Promise<Target>` validates unique bounded draft IDs/version/text/claim locators, sorts canonical projection, hashes target.
- `validateReviewResult(raw,{context,bundle}):{ok:boolean,value:ModelReview|null,error:string|null}` never converts invalid input into clean. Exact model schema/citation rules below.
- `canAcceptReview({envelope,contextId,bundleId,trustedInvocationId,acknowledgedFindingIds=[]}):{allowed:boolean,status:string,reason:string}` requires valid envelope/current exact IDs, current-session trusted receipt identity, no hard blocker, and all retained advisory finding IDs explicitly acknowledged before accepted-with-advice. Clean with no findings can accept; changed bundle/context or no trusted invocation cannot.
- `reviewStatus({envelope,contextId,bundleId,trustedInvocationId}):string` returns unreviewed|stale|reviewed|changes-required|advisory|historical-unattested. UI transport pending/failed/unavailable/cancelled states are separate and must never map to reviewed.

All pure helper exports have actual shipping consumers. No unspecified generic utility exports or new orphan allowance.

### Owned loader: bounded double content and pointer observation

`candidateContextStore.js` exports ONE async `loadCandidateSources(supabase,{userId,applicationId}):Promise<SourceSnapshot>` (injected authenticated client). userId must be the route's authenticated value. Query sequence is fixed:

1. Read OWNED application pointers P1 (`id,resume_used_id,cover_letter_id` with application id AND user_id filters). No row is 404/not-found, query error is source-error.
2. Read exact selected R1/C1 rows (`id,user_id,content,created_at`, id AND user_id filters). Null pointer/absent row is explicit missing; query error is explicit error. Compute exact content hashes.
3. Read the SAME selected R2/C2 document rows a second time with the same filters/projection. Compare ID/state/contentIdentity for each member with first capture, including null/missing/error transitions.
4. Re-read OWNED application pointers P2 and compare both IDs to P1. If any pointer or document content/state changed, return status stale with no usable mixed pair (resume/cover texts empty, actionable reload error), not current. Stable capture returns first exact texts/metadata with consistency stable-double-read and observedAt after final read.

No automatic retry inside this loader: bounded two document passes and two pointer reads only. It is NOT a database transaction or atomic snapshot and cannot prevent edits after the last observation. GET/POST disclose stable-at-observation; review reloads/recompares expected context before dispatch. A same-ID edit during the bounded interval is detected by second content read; a later external edit requires refresh/new server review and invalidates when observed, not magical realtime. No RPC/migration/immutable-version claim.

### Exact HTTP and model/host wire boundary

GET `/api/interview-preparation?applicationId=<id>` has no userId/body. Authenticated account identity comes from getUser; no request can override it. Success200 JSON `{status:'ready'|'partial',snapshot:SourceSnapshot}`. Source stale409 `{status:'stale',error:'Application documents changed while loading. Reload sources.'}`; source fetch error500 `{status:'error',error:string}`; missing application404; unauthenticated401; invalid ID400. Missing resume or cover is successful partial with exact per-document state, not fabricated pair. Manual mode obtains no generated context from GET; its explicit supplied texts go into local factory and POST manual input below.

POST `/api/interview-preparation` body example:

```
{
 "action":"review","engine":"gemini","sourceMode":"application",
 "applicationId":"APP-CEDAR","expectedContextId":"sha256:...",
 "requestedStrength":{"aggressiveness":3,"tailorMode":""},
 "job":{"title":"Engineer","company":"Cedar","description":"..."},
 "supplements":[{"id":"ignored-and-recomputed","text":"I mentored two engineers","confirmed":true}],
 "bundle":[{"id":"candidacy","kind":"candidacy","version":1,
  "text":"I wrote the rollback checklist.",
  "claimEvidence":[{"start":0,"end":31,"quote":"I wrote the rollback checklist.","evidenceIds":["evidence:..."]}]}]
}
```

The example locator's end is illustrative; every actual end MUST equal exact quote.length or request fails validation. Manual POST replaces applicationId with null and adds `manualDocuments:{resume:string,cover:string}`. Server computes manual IDs/hashes/origin using authenticated account and never calls it database-generated. Application POST ignores/rejects manualDocuments; server reloads actual owned pair and never trusts client generated-doc text/ID. `expectedContextId` must equal server-recomputed createCandidateContext snapshot+job+real requested fields+confirmed supplements; otherwise409 stale before model call. The client actual shared slider is the only UI producer of requestedStrength; server validates 1..5/mode but does not pretend to observe past document strength.

All body JSON <=128KiB streamed; max12 bundle members, per-draft text<=12,000 chars, sum bundle text<=24,000; per document<=24,000 and full pair<=48,000; job description<=8,000; max12 supplements each<=1,000. Exceed limit413; no silent truncation that would change review identity. max32 findings/probes each; all finding reason/recommendation/probe strings<=1,200; quote<=4,000. Existing local drafts may exceed review bounds but remain save/exportable with clear shorten-to-review message. Confirmed missing generated/manual document pair422 incomplete-context leaves unreviewed draft, not auto-pass. Embedded503 `{status:'unavailable',error:'Independent semantic review is unavailable on Embedded. Draft retained.'}` with zero provider calls. Gemini config unavailable503; malformed model502; provider error502; watchdog504; rate/concurrency429; auth401; malformed request400. Every failure body `{status:'error'|'unavailable'|'stale',error:string}` and no envelope.

Model response schema (NOT an identity/receipt authority):

```
ModelReview = {
 status:'clean'|'changes-required'|'advisory',
 coveredDraftIds:string[],
 findings:[{
  id:string,severity:'blocker'|'warning'|'advice',
  category:'unsupported-claim'|'ownership'|'invented-detail'|'source-conflict'|'hypothetical'|'relevance'|'evasion'|'repetition'|'framing'|'other',
  reason:string,recommendation:string,
  drafts:[{draftId:string,start:integer,end:integer,quote:string}],
  sources:[{evidenceId:string,quote:string}],missingEvidence:string|null
 }],
 probes:[{draftId:string,question:string}]
}
```

Every finding has at least one resolvable draft citation. Source-conflict/ownership evidence resolves actual source IDs/quotes; missing support may use sources:[] only with explicit nonempty missingEvidence. All source quotes must equal their referenced evidence.quote (or exact contiguous excerpt within it, with deterministic containment check), and draft offsets must match exact current text. coveredDraftIds must equal all bundle IDs with no duplicate/unknown. Category hypothetical/wrong-source/unsupported personal facts cannot be advisory-waived: blocker severity required for those hard classes, and clean cannot contain findings. Warning/advice remain explicit and current acceptance requires acknowledgment; changes-required with hard blockers cannot accept. Invalid categories/quotes/coverage/shapes fail closed; no default empty findings.

Server constructs receipt AFTER a successful distinct stateless SDK response and validated result:

```
200 {
 status:'reviewed',
 envelope:{schemaVersion:1,contextId:'sha256:...',bundleId:'sha256:...',
  host:{invocationId:'server-randomUUID',authorContextId:'deterministic-author:<bundleId>',
   reviewerContextId:'server-randomUUID',role:'adversarial-reviewer',
   provider:'gemini',requestedModel:string,observedModel:string|null,
   separateInvocation:true,createdAt:string},
  review:ModelReview}
}
```

`reviewPrompt.js` exports `buildReviewPrompt({context,bundle,target}):{systemInstruction:string,contents:string}`. Fresh system reviewer role and DATA-only canonicalJSON context/bundle; never include author's conversation. It asks all defect classes, cross-bundle consistency and concrete noninvented revisions/probes. Reviewer does not output host metadata; any model/client author/reviewer IDs are ignored/rejected. Route constructs author context from actual target, reviewer/invocation UUIDs itself per fresh client.models.generateContent call. No client supplied userId/provider/model/role can select trusted receipt values. Existing getGeminiClient/getServerEnv model is the only backend routing, no silent fallback to local or another provider.

Client trust boundary is authenticated server response received by the active hook invocation, not localStorage/model-authored identity strings. `trustedInvocationId` exists only in current hook memory after that exact successful response passes contract validation; it is never restored from persistence. Saved envelopes/history are historical records, not cryptographic attestations. On reload they display Previously reviewed / historical-unattested and retain accepted draft/history, but fresh reviewed acceptance requires an explicit new review (never hidden paid call on mount). This does not claim hostile-client tamper-proofness or external truth. Known server invocation role/context separation is established by actual route execution trace/tests; model identity remains unknown when response omits observation.

### Exact UI/hook/persistence compatibility

- `InterviewPreparation({userId=null,onOpenExisting,aggressiveness=3,tailorMode='',onChangeStrength})`; page passes ACTUAL state, no cloned level state. `PreparationWorkspace` receives same props plus posting. `onChangeStrength()` navigates existing Materials/options control.
- `usePreparationSources(posting,inputRevision=0,manualInputs={},strength={aggressiveness:3,tailorMode:''},supplements=[])` retains docs/brief/pack/read-only legacy source return fields and adds `{candidateContext,contextStatus,contextError,reloadContext,useManualDocuments}`. candidateContext null during new async hashing/load, old context immediately ineligible through revision token; no stale semantic acceptance while recomputing. Explicit useManualDocuments captures manualInputs.resume/coverLetter and recomputes context. Owned app uses GET snapshot and factory. Old generatePrep action is removed/disabled in NEW TAB with diagnostic; no shared hook/API mutation.
- `usePreparationReview({context,bundle,engine})` returns `{status,error,envelope,attempts,trustedInvocationId,reviewNow,cancel,acknowledgeFinding,acknowledgedFindingIds,acceptance}`. status unreviewed|reviewing|failed|unavailable|cancelled|stale|reviewed|changes-required|advisory|historical-unattested. reviewNow creates exact target asynchronously, one POST, verifies response/citations/target and active generation before setting current trusted receipt; synchronous in-flight guard. cancel aborts/fences and retains draft/previous attempts. Context/bundle edits derive stale immediately; no auto request. One visible sequence max3 explicit attempts, resetSequence only explicit and server limiter remains6/10min/per-instance. Each invocation history is preserved within checked bounded refusal, not silently overwritten.
- `PreparationReview({context,bundle,engine,reviewState,onAccept,onRevise})` requires reviewState equal to the actual usePreparationReview return value supplied by PreparationWorkspace (the component does not create a second hook instance), shows evidence/context/current-vs-historical strength, findings/probes, before/after attempts. **Review current preparation** -> explicit POST; **Cancel review**; **Accept reviewed suggestion** only when acceptance.allowed. Advice acknowledgment captures IDs. onRevise returns user to editable draft, never replaces typed original. No reviewed label for local typed rubric.
- Existing stage DraftEditor receives added `reviewRequired`, `canAccept`, `reviewStatus`, `onReview` props. Old generic Accept suggestion is disabled/renamed for all personal fresh suggestions until reviewed gate; Save/edit/Keep current draft remain functional. Nonpersonal blank diagnostics can be retained as unreviewed drafts, not claimed reviewed.
- Workspace additive fields: `candidate:{contextId:string|null,sourceMode:string|null,supplements:Supplement[]}`, `artifact.version:integer`, `artifact.contextId:string|null`, `artifact.claimEvidence:[]`, `artifact.history:[{version,text,contextId,claimEvidence}]`, and `reviewHistory:Envelope[]`. createWorkspace adds defaults. Validator accepts old valid workspace by explicit migration to defaults, does not invent old provenance/review; all new nested structures validated and bounds preserved. Active trustedInvocationId is deliberately NOT persisted. Original typed attempts retain answer/review and parent; new groundedSuggestion/repair fields are separate artifacts.

### Exact role split and tests

Backend implementer owns ONLY new `candidateContextStore.js`, `reviewPrompt.js`, `app/api/interview-preparation/route.js`; reads frozen pure exports above and existing auth/client/rate limiter. Main implementer owns `candidateContext.js`, `reviewContract.js`, workbench/store, eight existing Preparation component/hook/CSS files plus new PreparationReview/usePreparationReview and page wiring; no backend3 writes. Test author owns ONLY exact12 test files, distinct source context. Root exclusively owns policy/store/records/backlog/scanner accounting admission, shared gate resources and source import.

Exact12 test files (all prefix hello-world/): lib/interviewPreparation/workbench.test.js; lib/interviewPreparation/workspaceStore.test.js; app/preparation/InterviewPreparation.test.js; app/preparation/PreparationRehearsal.test.js; app/preparation/usePreparationSources.test.js; app/page.preparation.wiring.test.js; app/components/BackButton.test.js; lib/interviewPreparation/candidateContext.test.js; lib/interviewPreparation/candidateContextStore.test.js; lib/interviewPreparation/reviewContract.test.js; app/api/interview-preparation/route.test.js; app/preparation/PreparationReview.test.js. Actual hook behavior tested through mounted Review component; reviewPrompt through actual route request body tests. Independent accepted behavioral test design remains binding; wire names are now frozen, not author-selected oracle weakening. Source tests must include stable double-read positive and same-ID content edit between read passes negative; no fabricated database atomicity.

POST source-currency boundary: for application mode, after the semantic call settles and its result validates but BEFORE emitting a current envelope, call loadCandidateSources again (same bounded double-read rule), recompute context using the same captured job/strength/supplements, and compare the exact dispatch context id. If it changed or refresh fails/stales, return409 `{status:"stale",error:"Application sources changed during review. Reload and review again.",historicalEnvelope:<validated-old-context-envelope>}`. The optional historicalEnvelope retains actual old findings but is never a current receipt; hook records it only in historical attempts, keeps active trustedInvocationId null and acceptance disabled. Manual mode has no server mutable document source; client active-generation/current exact context+bundle+real slider identity must still match before adoption. A new local input change while review runs fences old response even if server sources stayed stable. Both successful GET capture and POST final check are bounded observations, not atomic transactions or guarantees against edits after their last read. Server createdAt/observedAt disclose this boundary; later refresh/context change invalidates verdict. No RPC or automatic polling/provider rerun is implied.

Status: R2 design-only correction ready for final independent delta check. No production/test implementation begins before acceptance/packet admission; a defective R2 requires terminating owner fork, not third design round.
