# N170 authenticated runtime verification

The original D4 schema and runtime obligations are now evidenced: the reviewed schema is deployed, actual signed-in application saves/reloads preserve legacy and both supported document modes, and the bounded database SELECT RLS probe returns the required owner-positive/other-claims-negative behavior. Purpose-built verification rows were removed with exact guards and zero remaining records confirmed. Independent acceptance of these actual outcomes and this report, followed by root backlog/state reconciliation and documentation publication, remains required; this report does not itself close D4 or claim a new Git delivery.

## Actual signed-in application roundtrips

The coordinator used the user's actual signed-in in-app browser at https://resume-tailor-tan-psi.vercel.app/ on observed source `9a821a895fc9ef27e2645f5597b0f76c4720483c`. Ordinary visible controls, real Save actions, full-page reloads and exact saved option IDs established three sequential purpose-built search records:

| Stored mode | Actual application flow |
|---|---|
| NULL / legacy | Filters → save current feed search → full reload → Setup chat → copy exact entry; legacy document option retained. |
| `resume_only` | Copy seed → select Resume only → Save new search → full reload → reopen exact new option ID; Resume only retained. |
| `resume_cover` | Copy persisted resume-only entry → select both required → Save → full reload → reopen exact new option ID; both-required option retained. |

`live-mode-browser-observations.json` is explicitly a root CUA observation transcription, not an independently rerun browser trace or native attestation. Two retained scrolled screenshots show the reopened explicit modes. Screenshot hashes and authoritative `live-saved-search-readback.json` match the separately checked evidence: exactly the three known record IDs, NULL/resume_only/resume_cover, `auto_tailor_enabled=false`, `email_on_new_jobs=false`, interval60. Exact-ID observations plus database readback provide the save/reload link; screenshots alone do not prove ID or network success. Independent browser-artifact check565A... accepted this bounded evidence.

No Send message, application model call, tailoring/generation, auto-enable or cost-confirmation action was invoked. The seed was created manually and copied/edited through the actual Setup chat review. Existing authorization was not converted into provider spending or alert delivery work.

## Database account isolation probe

The read-only SQL probe SHA256 `D4E2027464FB97F15DA6260C77DBE0707434C35113D9E1381D6028758F4D2FB6` was independently accepted0A4B... before execution on the verified project `cglqscthbalfaefiigso`. It guards the exact three records, modes, name/timestamps/off flags/interval and single owner; requires authenticated nonsuperuser/non-bypass role and RLS; validates `auth.uid()` for the owner then a distinct generated subject. Its checked DO block requires owner visibility3 and other-claims visibility0, then rolls back the read-only transaction.

Actual `live-mode-rls-result.json` reports successful execution and an empty result. No notices were returned or claimed observed. Success of the guarded block establishes both required classifications. This is real database SELECT RLS role/local-claims behavior, **not** a second browser account/JWT authentication test, all-DML RLS proof or a second user login. No auth account, policy, role or grant was created or weakened.

## Exact verification-row cleanup

The original cleanup proposal was rejected because its foreign-key `ON DELETE SET NULL` could indirectly modify application rows. Corrected SQL SHA256 `D2A311C1F7B79F847C3BCA0FAC3BA63047C34C2E351D5F4F47A9045687289F99`, acceptedC0F523..., locks the exact three fixture rows, revalidates immutable field/single-owner guards and requires no referencing `applications.auto_search_id` before deleting. The row locks prevent a new FK reference racing that guarded deletion. The delete requires exactly three affected rows or aborts; no broad name-only deletion or unrelated application write was authorized.

`live-mode-cleanup-result.json` records actual successful execution of that exact corrected SQL. The separate authoritative `live-mode-cleanup-readback.json` reports `remaining_exact_ids=0` and `remaining_test_name=0`. No notices or unreturned delete rows are invented. The three purpose-built saved searches were created for the authorized runtime verification and removed; no account was created and no unrelated user/application row was changed by this bounded cleanup.

## Preserved limitations and recovery observations

The earlier [schema verification](schema-verification.md) documents actual deployed column/CHECK and the prior constraint-only, nonpersistent probe. This report supplies the subsequent real signed-in create/reload and legacy-compatibility evidence, plus the bounded SELECT RLS test. Earlier [schema handoff](schema-handoff.md) and source verification reports remain historical, with their former schema/access blockers superseded by these later observations.

Browser/tool failures remain preserved: a prior tab expired between turns; a new tab reused the authenticated cookies. A select operation timed out after the visible choice changed, so the coordinator re-read actual state before the separate successful Save. A post-reload wait targeted an Automation switch while Feed was selected; visible Setup chat navigation resolved it. An initial screenshot omitted document controls and was excluded as mode proof. These are distinct instrument/navigation observations, not silently relabelled passes. No browser fetch/token/storage access or console/network transcript was used or claimed.

The live feed's source-error badge was observed; ingest freshness, alert delivery and source-provider quality were not tested or modified. Real model semantic quality, generation/cron execution and provider delivery remain unproven; the runtime verification deliberately left automation and email off. A true second-browser JWT login remains untested and is not required to reinterpret the narrower proven database isolation claim as something broader. Existing automatic dispatch authority remains expired; none of these operations renews it.

The original D4 requirements—authorized target/schema setup, actual supported and legacy save/reload, and bounded account-row isolation—have evidence at their stated boundaries. Root may remove active D4 only after independent acceptance of actual outcomes/report and preserve this history. Subsequent visual-overhaul request N171 is separate and no UI edit or implementation work is authorized by this report.

This author wrote only this report from actual retained receipts and independent pre-use/evidence checks; no SQL, browser action, tests, application-source edit, model invocation or Git write was performed during report authorship. Final independent check and root normal documentation push/live `npm.cmd run loop:delivery` guard remain pending publication steps.

Actual-result acceptance: retained `live-mode-results.check.md`, F16276..., independently accepts the executed guarded RLS/cleanup results and zero-ID/name readback, with no inferred notices, second JWT or all-DML claim. Independent judgment of this final report and root publication/reconciliation remain separate prerequisites.
