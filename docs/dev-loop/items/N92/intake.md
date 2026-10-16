# N92 current-tree intake

Read-only intake by `/root/n92_intake`, 2026-10-16, candidate
`7bb3f97ef0042a484d692d71bd031ed8062735b4`. No tests, model calls, source
edits, or backlog/state edits were performed. Initial `git status --short`
reported no changed files (Git also reported inability to read the global ignore
file). This artifact needs independent acceptance before downstream use.

## Priority and admission

N92 was the first authoritative YAML row at intake: actionable, no blockers,
but `owns`, `verify`, and proof are null. That is not an executable grant.
The coordinator subsequently reported a new owner top-priority camera-question
request, proposed as N166. Therefore this is preparation for later N92 work;
do not admit or implement N92 ahead of the owner's new priority. Preserve YAML
order and history; this report does not rewrite either.

## Objective and settled boundaries

The owner's two-part request is three coherent cover-letter controls: move an
inserted fact one sentence backward/forward; explicitly request an LLM smoothing
of the fact and immediate neighbouring sentences; persist an optional single
forward nudge for future client-generated insertions. Reuse one move primitive.
The advantage over direct chat is positioning a located fact in the actual
versioned document while preserving source provenance and a reviewable download.

`docs/loop/N92.ac.r1.md` actually identifies itself as the round-2 settling
artifact. It defines A1–A13, B1–B12, C1–C9, X1–X4 and these binding decisions:
body-only cross-paragraph movement, atomic multi-sentence facts, span-local
whitespace handling, placement plus an independent boolean nudge, safe false on
pending/failed preference load, automatic client insertion only, and smoothing
only after a user click with confirm-before-persist. Automated scope/added-token
guards do not establish semantic faithfulness; the shown before/after and user
approval are the meaning safeguard. Embedded smoothing defaults disabled with an
honest reason; no fallback model or spending is authorized here. Resume/email,
arbitrary dragging, cron insertion, a new preference system, and global LLM fact
placement are excluded. The latter belongs to the separately requested N165.

## Reuse survey: existing capability, not a blank implementation

The YAML description predates substantial implementation:

- `hello-world/lib/acceptedFacts/factMove.js` implements the shared positioning
  primitive; `factInsertion.js` applies its forward nudge. Named segmentation,
  byte identity, identical-text and date tests already exist.
- `app/hooks/useCompanyResearch.js` implements move, automatic insertion and
  confirmed smoothing persistence. `commitFactMove.js`, `moveOptimism.js`, and
  `commitSmoothedFact.js` own the I/O and reconciliation seams.
- `app/components/DocumentPreviewMount.js` and
  `app/components/preview/InsertedFactsStrip.js` already expose backward,
  forward, Smooth, confirmation, discard and post-apply Undo controls.
- `lib/coverFacts/smoothTransition.js` implements proposal, guards, confirmation,
  decline and undo. `app/api/cover-fact-smooth/route.js` is the model seam.
- `app/hooks/useCoverFactPlacement.js` already reads/writes `coverFactForward`
  through the existing user-prefs route. `CoverFactPlacementSetting.js` and
  `page.js` consume it.
- Historical `N92.verify.w2.r2.md` accepted the fix that made nudge edits reach
  real DOCX bytes. `N92.verify.w3.r1.md` identified follow-ups, but its B6 undo,
  provenance, embedded reason and false-success ledger observations are no longer
  current absence claims: present source and dedicated undo/provenance/ledger/
  disabled-reason tests implement those follow-ups (N93/N94/N122 comments).
- N97 added original-template recovery and a shared durable fact-document writer
  in `lib/document/defaultTemplateCapture.js`; rebuilding that infrastructure is
  unnecessary. Its `commitFactMove.originalTemplate.test.js` includes confirmed
  smoothing storage assertions.

Historical tests and reports are useful designs, not fresh measurements of this
candidate. No N92 criterion is newly declared passed by this intake.

## Current gaps requiring bounded measurement

**Primary source-grounded concern: final client reconciliation after smoothing.**
`commitSmoothedFact.js` receives `commit.coverDocxPath` from the shared writer but
does not put it into `setTailoringMap`. It stores fresh bytes only when the
pre-operation `hasCoverBytes` was true. N97's writer can now rebuild and upload a
fresh original-template document when no engine bytes exist, including an edited
cover, and returns both fresh bytes and path. The smoothing patch can therefore
leave the client reading an earlier pointer or omit freshly rebuilt bytes while
the accepted-facts store contains the correct new document. `previewBlob.js`
passes the entry's current bytes/path to the document resolver, so successful
storage alone is insufficient evidence for X3's repaint/download requirement.
The existing N97 smoothing test mocks `setTailoringMap` and examines stored bytes;
it does not observe this last hop. This is a credible defect mechanism, not an
executed reproduction yet.

The sibling `moveOptimism.js` also assumes edited/no-byte commits cannot create
a fresh document: `resolveMoveDocxPath` restores the pre-move path when edited
and returns null without prior bytes; `moveSuccessPatch` ignores newly rebuilt
bytes without prior bytes. Reassess that old assumption against N97's writer in
the same bounded reconciliation chunk. Do not change stale-state/concurrency
rules without an independently checked plan.

**Retained separate concern:** two mounted `useCoverFactPlacement` instances still
each issue their own initial GET. Sharing forward with placement in each instance
did not fix N86. Historical N92 structure explicitly carried N86 separately.
Do not silently add shared preference ownership or declare N86 solved while
closing a DOCX reconciliation chunk.

**Unmeasured experience/integration:** current DOM tests cannot establish actual
Word pagination, browser layout/keyboard focus under the cumulative fact strip,
live model response quality, Redis/Supabase authorization or network durability.
Keep those limits distinct from deterministic local evidence.

## Proposed next deliverable after owner priority

Bound N92 follow-up to: after a successful move, confirmed smooth, or undo using
an original recovered cover template, the current preview/download references
the exact fresh document persisted with current lines and provenance; a refused
save does not claim success or publish replacement pointers. First reproduce
the suspected mismatch through real state updaters and actual DOCX parsing.
If reproduction disproves it, retain that result and perform the current-tree
closure audit rather than invent an implementation task.

Likely exact source write set (proposal, not grant):

- `hello-world/lib/acceptedFacts/commitSmoothedFact.js`
- `hello-world/lib/acceptedFacts/moveOptimism.js`

Likely exact affected test write set, subject to independent test design:

- `hello-world/lib/acceptedFacts/commitFactMove.originalTemplate.test.js`
- `hello-world/lib/acceptedFacts/moveOptimism.test.js`
- `hello-world/app/hooks/moveInsertedFact.rc.test.js`

The last path must be checked for existence before admission; new dedicated test
paths may be preferable and must be named explicitly by the checked plan.
Affected read-only callers and invariants: `useCompanyResearch.moveInsertedFact`,
its `applySmoothedFact`, mount Apply/Undo, `previewBlob.js`, `docx.js`,
`defaultTemplateCapture.persistCoverFactDocument`, original-template markers,
accepted-facts revision refusal, fact locators/highlights and download bytes.
Do not grant whole directories, routes, database migrations, template libraries,
LLM prompt changes, preference state, or backlog writers on this proposal.

## Instruments and triggered review

Independent test design should cover native and recovered templates; edited and
unedited covers; existing path and no-byte shapes; success and upload/PUT failure;
Apply and Undo; actual parsed DOCX text/style plus pointer identity; preservation
of unrelated state. Mutations should suppress fresh path and fresh-byte
reconciliation separately, with original/no-op/restored controls. Existing
move/confirm/undo/provenance guards must remain intact.

Use app Vitest for focused and full regression, ESLint, Next build, backlog check
and mandatory `npm.cmd run loop:test` under the root's serialized gate policy.
No standalone app typecheck exists. This intake ran none of these commands.
Security review is triggered by immutable document provenance and authenticated
storage boundaries; reliability by successful-write/last-hop agreement and
revision failure; UX/accessibility by visible success/error and review controls.
No provider, credential, deployment or live-browser authority is created here.

Close N92 only after all 38 retained criteria have current evidence or explicit
owner-authorized dispositions, including the known N86 boundary. Root owns any
YAML reconciliation and generated backlog rendering. Each verified chunk must
still receive independent implementation/verification/final checks, normal main
push and live `loop:delivery` proof.
