-- N60: does the live `saved_searches` table carry the columns the auto-tailor
-- cron depends on? No migration creates this table -- only `alter table ... add
-- column if not exists` -- so the checkout cannot answer this. Run as the owner.
--
-- Why it matters: app/api/cron/tailor/route.js selects `auto_tailor_enabled`
-- and `email_on_new_jobs` in ONE `.or()` query. If either column is absent the
-- query 400s, the route 500s, and the email-only alerts stop too -- an outage
-- no test in the repo can see.

-- 1. Which of the expected columns exist, and which are missing.
with expected(column_name, needed_by) as (
  values
    ('id',                     'all'),
    ('user_id',                'all'),
    ('auto_tailor_enabled',    'auto-tailor kickoff'),
    ('auto_tailor_daily_cap',  'auto-tailor spend cap'),
    ('email_on_new_jobs',      'email alerts'),
    ('notify_email',           'email alerts (recipient override -- being REMOVED)'),
    ('last_tailor_run_at',     'auto-tailor scheduling, if present')
)
select
  e.column_name,
  e.needed_by,
  case when c.column_name is null then 'MISSING' else 'present' end as status,
  c.data_type,
  c.column_default,
  c.is_nullable
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name   = 'saved_searches'
 and c.column_name  = e.column_name
order by status desc, e.column_name;

-- 2. Every column actually on the table, in case the names differ from the above.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'saved_searches'
order by ordinal_position;

-- 3. Does the table exist at all, and does it carry RLS?
select
  c.relname,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'saved_searches') as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'saved_searches';

-- 4. Live state: is auto-tailor on for anyone, and what caps are set?
-- Expected today: enabled_count = 0, because no UI can switch it on.
select
  count(*)                                            as saved_search_rows,
  count(*) filter (where auto_tailor_enabled)         as auto_tailor_enabled_rows,
  count(*) filter (where email_on_new_jobs)           as email_alert_rows,
  count(distinct user_id)                             as distinct_users,
  min(auto_tailor_daily_cap)                          as min_cap,
  max(auto_tailor_daily_cap)                          as max_cap
from public.saved_searches;

-- 5. Recipient overrides in use -- these stop being honoured when the override
-- is removed in favour of the account email. Non-zero means a real user would
-- see their alerts change inbox, which is worth knowing before shipping.
select count(*) as rows_with_notify_email_override
from public.saved_searches
where notify_email is not null and notify_email <> '';
