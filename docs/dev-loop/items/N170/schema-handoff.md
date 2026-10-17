# N170 document-mode schema handoff

Status: authorized; blocked on database access and verified target identity. The owner's direct “continue” response to the coordinator's request to apply the reviewed SQL authorizes this precise prerequisite, target inspection and post-schema verification. No further approval of that same change is needed. It does not grant provider spending, automatic dispatch, broad migration/deployment, account installation or unrelated schema changes.

The sole reviewed change is `hello-world/supabase/queries/auto-applying-chat-document-mode.sql`, SHA256 `22785FA4F731ECF22C0B1C5871D8711B9A621A771133FA0FD8B0C00C45004FAD`. Preserve these bytes. It adds nullable text `public.saved_searches.tailoring_document_mode`, with no default or backfill, and named CHECK allowing NULL, `resume_only`, `resume_cover`. NULL preserves legacy behavior. `IF NOT EXISTS` does not establish that an existing column or same-named constraint has the expected definition.

## Access blocker and next action

Coordinator inspection found no usable database administration access: local `hello-world/.env.local` has a placeholder URL and anon configuration; no usable SUPABASE/database environment credentials, Supabase CLI, psql or connected Supabase app. Browser inventory contained no authenticated database tab. These observations establish an access blocker, not a missing owner approval. Never copy credential values into this document or receipts.

Next action: connect the suggested Supabase integration, or provision an existing approved database administration connection. If installation/login requires a separate host authorization, obtain it through that connection flow. Do not install or log in merely because this handoff names the option. Root coordinates connection and delivery; the receiving operator then confirms the actual application deployment environment and its Supabase project identity. A local placeholder is never a valid target. Do not use a convenient unrelated project, infer production from a project name alone, or run broad `db push` with unrelated pending migrations.

## Read-only target and schema preflight

Record the selected deployment environment, deployed app/project identity and its configured Supabase project reference/host (no keys), the matching database connection/project identity, observation time and authenticated administration role. If the deployed app's target cannot be established and matched, stop before any write.

On that verified connection, capture these read-only results before applying SQL:

```sql
SELECT current_database(), current_user, version();
SELECT c.oid::regclass AS relation, c.relkind,
       c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'saved_searches';
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = to_regclass('public.saved_searches')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = to_regclass('public.saved_searches')
ORDER BY conname;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'saved_searches'
ORDER BY policyname;
```

The table must exist as the intended saved-search table. If the mode column is absent, adding the reviewed column is expected. If present, require nullable text with no default; inspect any existing non-NULL mode values for compatibility using a bounded aggregate, without exporting private row contents. Inspect all constraints, especially `saved_searches_tailoring_document_mode_check`: it must enforce the reviewed allowed values on this relation, not merely share a name. RLS flags and policy definitions are baseline snapshots, not evidence that account isolation works. Conflicting type/default/nullability, incompatible existing values, a misleading same-named constraint, unexpected relation, or uncertain ownership means stop and report the concrete mismatch. The reviewed query does not repair those mismatches; do not improvise DDL.

## Apply and verify

Only after safe preflight and target match, execute exactly the reviewed query through the authorized administrative connection. Record its byte hash, actual execution outcome and target identity; preserve errors. Do not edit the query, backfill rows, relax constraints, alter RLS or apply unrelated migrations. If preflight shows the exact desired schema already exists, record verified no-op state rather than inventing a write.

Repeat the read-only column/constraint/RLS queries afterward. Require nullable text/no default, the correct allowed-value CHECK, and unchanged RLS flags/policies. Record authoritative readback; a successful SQL command alone is insufficient. If the application's schema cache is stale, diagnose it through existing approved operations rather than claiming readiness from DDL alone.

Where a real, explicitly authorized disposable account/fixture and connection are available, use a transaction that is always rolled back to exercise actual saved-search persistence: write/read `resume_only`, write/read `resume_cover`, preserve NULL legacy behavior, and reject an invalid mode. Use savepoints for expected constraint errors so the transaction can continue and roll back. Respect actual required fields, ownership and foreign keys discovered from the schema; do not invent a production account or alter an existing user's row. A rollback test proves persistence/readback within that transaction, not durable application create/reload or RLS.

Separately verify account-owned application create/reload and cross-account denial through the deployed app's normal authenticated path only when safe test accounts and that runtime access are available. Administrative/service-role SQL bypasses RLS and cannot establish account isolation. If no safe fixture/account/runtime access exists, leave transaction tests, application create/reload and RLS behavior explicitly UNPROVEN, with their exact receiver/access requirement. Do not mark D4 complete solely from schema readback.

Root records resulting evidence, residuals, backlog/state and scoped main delivery after independent checking. This document performs no SQL, connection, deployment or provider action.
