# N170 document-mode schema verification

The authorized schema prerequisite is applied to the deployed application's verified Supabase target, `cglqscthbalfaefiigso`. Schema inspection and bounded database constraint verification succeeded. Authenticated application save/reload, legacy runtime compatibility and cross-account access verification remain pending under D4; those are runtime-verification/access obligations, not missing owner approval or an unapplied column.

## Target, authority and applied change

The earlier [schema handoff](schema-handoff.md) records historical preparation and the former connection/target blocker. Its authorization remains valid; its statement that the query was not executed is superseded by this report. Source was delivered as `acb6d3560c624a3f86517574f1bac567016c5e31`, with verification bookkeeping `01875a04dbbcce302d4e9895b33ac3b117974c61` and authorized connection handoff `6a489672ff94f34b30002460ee725d24bfc1ab38`. This new report's repository publication is still pending.

The coordinator matched the README's deployed application, https://resume-tailor-tan-psi.vercel.app, to its publicly served application chunks: fourteen scripts were inspected and the configured Supabase host matched the selected connected project. Runtime receipt `schema-deployed-public-target.json` retains URLs and content hashes without credential values. An administrative Vercel project query returned403, but target identity was independently resolved through the deployed public application, so that denial did not remain the schema target blocker. No Vercel configuration/deployment change was made.

Independent pre-apply check15A95... accepted the exact target and bounded preflight. Only the reviewed `hello-world/supabase/queries/auto-applying-chat-document-mode.sql`, SHA256 `22785FA4F731ECF22C0B1C5871D8711B9A621A771133FA0FD8B0C00C45004FAD`, was applied through the connected database migration tool. `schema-live-apply.json` records submitted bytes, target and tool success. The remote migration inventory subsequently lists version `20261017010414`, name `n170_auto_applying_chat_document_mode`. This was the precise reviewed change, not a broad push of unrelated migrations.

## Post-application comparison

Actual `schema-live-post.json` and the independently accepted post-DDL comparison250BB... establish:

- `public.saved_searches.tailoring_document_mode` is nullable text, with no default or backfill.
- The single expected validated CHECK permits NULL, `resume_only` and `resume_cover`.
- Existing primary/foreign keys, RLS flags, four policy definitions and the absence of noninternal triggers are unchanged.
- Before/after advisor results retain the same five pre-existing groups: one INFO and four WARN. They match excluding observation timestamps. This change introduced no new advisor finding and did not fix the existing findings.

No ACL, RLS policy or unrelated schema was weakened to make a probe succeed. Metadata comparison establishes the inspected definitions; it does not establish authenticated account isolation or a successful application write.

## Bounded constraint and access probes

The independently checked constraint-only SQL, runtime `schema-constraint-probe.sql` SHA256 `3D669BFFCFFF883717D172A2D541908F4FF50BD4AF65A4D62EC0A56E5B316C6A`, actually executed successfully on that same target. Its DO block requires four specifically classified failed INSERT attempts: NULL and the two supported values must reach the exact expected user foreign-key violation23503; an invalid mode must hit the exact mode CHECK violation23514. Each caught failure rolls back its subtransaction. Unexpected success, a different constraint/table/schema/error or a classification count other than four raises an uncaught exception. Preflight verified expected defaults, immediate FK and no custom trigger/rule hazards; the generated user UUID was proven absent without creating an auth account.

`schema-constraint-probe-result.json` reports tool success and an empty result. No notices were returned or claimed observed. Successful completion of the checked DO block establishes the four required classifications; it is **not** a persisted insert/read roundtrip. No row or account was created, and no existing row was updated by this probe.

The read-only authenticated-role SQL zero-row column-access probe succeeded with `zero_row_column_access:0`. This tests the database role's zero-row column access, without an authenticated application user/session; it is not authenticated create/reload or cross-account RLS evidence.

The actual public Data API zero-row request returned HTTP401/code42501, permission denied for the anonymous role on `saved_searches`. Anonymous denial is an expected private-data boundary, not evidence that the column failed to deploy. The initial JWT-extraction attempt failed before any request; the subsequent active publishable-key request produced the recorded401. Public credential values were held in memory and are not recorded here. No suggested anonymous grant was executed and no ACL was weakened. Anonymous denial does not prove authenticated Data API success.

## Remaining D4 obligation and delivery boundary

D4 remains active for a safe authenticated account/session and runtime verification: save explicit resume-only and resume-plus-cover searches through the actual application, reload/reopen and verify selections, confirm legacy/default omission compatibility, and verify cross-account isolation using separately authorized accounts. No suitable authenticated test account/session was available in this phase; no account creation or user-data fixture writes were improvised. Real model/queue/cron behavior and provider quality remain outside these schema probes.

The source implementation already has independently verified mocked-boundary coverage and legacy omission behavior. The schema prerequisite is now satisfied on the verified target, but the remaining authenticated runtime checks prevent a claim that every production interaction is verified. Cover-only remains unsupported. Existing automatic dispatch authority remains expired; schema authorization does not renew it or authorize provider spending.

This report was authored from retained actual tool receipts and independent checks, with no additional SQL, tests, application-source changes, deployments or provider invocations by its author. Its independent review and scoped documentation commit/normal push/live `npm.cmd run loop:delivery` guard remain publication prerequisites. Root-owned backlog/state reconciliation must update D4 to runtime verification/access, preserving this distinction and historical evidence.

Independent result acceptance: runtime `schema-constraint-result.check.md`, SHA256 `65EE5BEF52C263FFA280CE11D5576FBF74B6F1841441CA1AE259D830C34E942E`, accepted the actual DO-result inference and privileged authenticated-role zero-row/WHERE-false column compilation only. It does not elevate that probe into a signed-in user operation or persisted roundtrip.
