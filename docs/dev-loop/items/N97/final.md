# N97 delivery report — draft pending acceptance and delivery

Status: implementation independently accepted; independent verification records local PASS and has independent checker acceptance. Final report acceptance and repository delivery remain PENDING. The coordinator completed reconciliation and its registered backlog gate. This document is a draft handoff, not a shipped-state or remote-delivery receipt. Author: /root/n97_author. No source/state/backlog edits accompany this report.

## Delivered behavior in the candidate

Setting a résumé or cover template from preview makes that saved template active, including when a different library template was previously selected. The next output uses its formatting with the new document text. Selection failure reports an activation error rather than success. Email remains outside template promotion.

Gemini generations retain the exact uploaded original under an immutable, authenticated per-version attachment in the existing private resumes bucket. Reload, history selection, revise and output rebuilding use that original without borrowing today's unrelated upload. Same-run original Files remain usable after a snapshot-upload failure, with an explicit durability notice; unknown ownership fails closed. Embedded/external and native N151 versions capture their faithful current document. Existing library selection and active-formatting override precedence are preserved.

N89 cover-fact acceptance and auto-insertion rebuild from the saved original. Acceptance, auto-insertion, removal, movement and smoothing preserve a closed reference to the verified original base version in each finished derived DOCX, including edited line branches. A fresh derived-version reload can capture the exact raw original rather than the filled fact-bearing output. Pending original identity, missing/corrupt/foreign provenance, or output-upload failure refuses a source-aware document mutation before the facts RPC. Unchanged acceptance performs only its facts update. N151 regeneration removes inherited original-provenance metadata from its new native document.

The advantage over manual chat is automatic, durable formatting selection plus recovery of the actual original across sessions and fact-derived versions; users need not re-upload the file or track template identity in prompts. This makes no claim about model quality.

## Candidate and independent acceptance

- Current complete 36-file candidate: [implementation.md](implementation.md), SHA256 C63CE25FC02AEC727CD86CCFBD13F013331F53B5D3679BB55B00043F597F5D26. The report preserves historical manifests separately; the current round-2 manifest plus exact census addition govern. Independent candidate-final.json binds all 36 identities (SHA256 ABFA5DB629321CB9D502140C57AB8866B5F35530723C6A53E1CF52D10D2742D8).
- Independent implementation acceptance: [implementation.check.md](implementation.check.md), SHA256 6D134436B44A0170BDFB157006A21664C75187338236149A197547288C3B2897, including accepted mechanical census fidelity. Both bounded round-1 findings are closed in final round 2.
- Accepted scope/design: [contracts.md](contracts.md), [persistence-plan.md](persistence-plan.md), [drive-hash-plan.md](drive-hash-plan.md), [drive-freshness-plan.md](drive-freshness-plan.md), [fact-version-plan.md](fact-version-plan.md), with their independent checks. Their identities and exact admission history are recorded in the implementation report and coordinator records.
- Independent measurement report: [verification.md](verification.md), SHA256 F912986C15B28F2DFBAAF3CBD4109E251CEC27887AD6005A77B5368E5AE8513F. Independent acceptance: verification.check.md SHA256 54F358D1A5AD35EE2526BD0D06505CBA1BF9F7852D8C6ABF0912DE3E27953EF9, binding the report, all 36 candidate files and 12 evidence artifacts.
- Final commit and exact remote identity: PENDING coordinator completion.

## Criterion mapping

The independently accepted verifier report establishes PASS for each named local instrument below. Live production, browser/device and Word observations remain outside these local verdicts.

| Criterion | Candidate mechanism and relevant evidence | Final measurement |
| --- | --- | --- |
| C1 Active promotion | Public POST activates its saved row; POST → fresh GET → real resolver integration for résumé and cover distinguishes old selected A from promoted B; activation failure/retry and unsupported email controls. route.promoteToActive.test.js. | PASS local |
| C2 Correct capture | Per-scope capture distinguishes immutable original from faithful native output. Hook tests cover original byte identity and Gemini → N151 regeneration → stored selection → promotion/revise of native bytes; derived-row capture tests distinguish raw original from filled output. | PASS local |
| C3 Next output consumes choice | Real DOCX font/paragraph plus NEW text assertions after public promotion/read; each job/feed download egress and Drive SAVE is checked separately. Drive output/hash use the same freshly read effective template and fence late reads/user changes. | PASS local |
| C4 Persistence and N89 | Public generation persistence → fresh restore/rebuild; per-version originals and missing/cross-user negatives. Actual accept/auto/remove hooks and move/smooth shared writer tests preserve current text/style and original base identity. New derived UUID → stored finished path → fresh resolver/capture recovers exact raw original; corrupt/foreign/missing/pending/upload-failure controls refuse before RPC. Real ZIP splice preserves the marker. | PASS local |
| C5 Ownership and boundaries | Authenticated user plus explicit owned-row predicates precede storage access; strict kind/string UUID/path validation; marker base revalidated without recursive chains. Source-bound ownership/auth mutations complement two-user fake tests. Live RLS is separate below. | PASS local |
| C6 Compatibility | Null/default output controls, immutable snapshots, existing N151 regeneration/history tests, faithful native capture despite stale shared engine, source precedence and no-op facts-only acceptance. Previous versions are not rewritten. | PASS local |
| C7 Honest diagnostics | Existing per-scope busy/error/notice path reports capture/refusal/upload/activation failures; no false success, email omission and retry/lock recovery tests. Browser/phone/Word measurements remain separate below. | PASS local |

## Gates and controls

Independent focused measurement passed 16 files/112 tests against the unchanged candidate. Author-only focused results remain separately attributed in implementation.md; they do not substitute for independent measurements.

| Producing command | Independent observed outcome |
| --- | --- |
| node tools/repository-gate.mjs test — first run | FAIL: 2 failed/20487 passed/9 skipped tests; 2 failed/1305 passed/1 skipped files. |
| Same complete test gate after accepted inventory correction | PASS: 20489 passed/9 skipped tests; 1307 passed/1 skipped files; exit 0. This instrument supplies verification and regression. |
| node tools/repository-gate.mjs lint | PASS, exit 0. |
| node tools/repository-gate.mjs build | PASS, exit 0; local production compilation/static generation only. |
| node tools/repository-gate.mjs backlog | PASS, 159 items/0 violations, generated document matched. After root removed exactly N97/N89/N101 and rendered from YAML, the registered backlog gate again passed: 156 items/0 violations, generated document matched (coordinator observation). |
| npm.cmd run loop:test | Authorized reuse of independent adapter/core result: 20 files, 154 passed/2 skipped, exit 0; unchanged relevant core/provider bytes. Not rerun by the N97 verifier. |

The initial full-suite failure is retained. The census correctly discovered the newly admitted defaultTemplateCapture.js; an independently checked one-row expected-inventory correction preserved parser, exact equality, canaries, exclusions and timeouts. The unrelated grounding source-copy test exceeded its unchanged 5000 ms timeout under load. The complete rerun passed both without changing the grounding source or timeout; an isolated pass was not used to dismiss the failed mandatory run.

Independent controls measured 17 runtime/compiled-source mutation families plus four exact call-site source controls. Valid positive/harmless/restored runs pass and intended defects fail; module-discovery/instrument failures and an initially surviving weak guard oracle remain preserved and excluded. The corrected marker-guard instrument exercises real ownership/ZIP parsing with a faithful renderer boundary; the output-marker failure is a causal missing-ZIP-part oracle, not a module failure. Exact receipts and limitations are in verification.md and ignored .agnostic-loop/N97-verification/. Page controls prove exact arguments, while real hook/ZIP/route controls supply separate runtime/output evidence. Author's 18 families remain separately attributed.

Final-report acceptance, main commit/normal push and live npm.cmd run loop:delivery proof of exact local/remote equality and clean checkout remain PENDING. No deployment was performed or authorized by this work.

## Residuals and measurement ownership

| Obligation | Owner and instrument | Required next measurement / current limit |
| --- | --- | --- |
| Live schema/storage/RLS enforcement | Deployment/environment owner; separately authorized authenticated application/Supabase integration in the intended environment, with two distinct users. | Confirm resume_templates/template_selections and private resumes namespace operate; prove each user cannot read/write the other's original/derived/default rows or objects, including new generated-template paths. No live DB or credential operation was performed here. Fixture ownership checks are not RLS proof. |
| Browser/phone/accessibility | Product owner with available browser/phone instrument. | Exercise preview promotion and failure/retry notices, keyboard focus and scope controls on résumé/cover; confirm email lacks promotion. Rendered React behavioral tests do not establish actual phone layout or full accessibility. Existing N151 owner phone obligation remains. |
| Word formatting fidelity | Product owner using Microsoft Word and representative real DOCX files. | Open promoted/new outputs and post-reload fact-derived versions; inspect layout/font/paragraph fidelity and current text. ZIP/XML assertions do not prove Word rendering. Existing N151 document-fidelity obligation remains. |
| Missing historical originals | Product owner; historical version restore with intentionally absent original. | Honest refusal is supported; preexisting lost uploaded bytes cannot be reconstructed. New attachments do not retroactively recover legacy files. |
| Upload/RPC partial persistence | Maintainer; fake failure tests and authorized environment failure measurement if needed. | RPC failure after finished-output upload may leave an unreferenced object; no atomic rollback or cleanup implementation is claimed. Retention/cleanup remains separate. |

These residuals delimit claims outside the accepted local instruments; they do not waive a mandatory local gate or promise production enforcement. Existing owner/environment measurement obligations remain assigned above. The local implementation can be assessed separately from live-substrate/browser/Word proof; overall repository delivery still requires its explicit guard.

## Backlog reconciliation

Independent verification and its checker accepted C1–C7 local, the exact N89 Part 2 scope, and N101 G1–G4 closure. The coordinator removed exactly N97, N89 and N101 from the active YAML backlog, retained all other entry bytes/order and rendered the generated document. The registered backlog gate passed with 156 items/0 violations and generated-document agreement. Closure covers newly persisted originals and every fact-derived writer above; it does not claim a legacy-data backfill. N64's mechanism is reused rather than replaced; retain the later N151 library ruling and its existing owner checks.

N101's G1/G2 exact egress and G3/G4 client/handler coverage are now represented by dedicated call-site/behavior tests and isolated mutation controls. The accepted independent verification confirms that exact mapping, and the coordinator completed the corresponding reconciliation. This report does not expand N97 into unrelated work. Preserve unrelated/deferred obligations, authoritative backlog order and blockers. No backlog or state file is edited by this author.
