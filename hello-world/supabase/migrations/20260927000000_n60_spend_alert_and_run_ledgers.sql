-- N60 S4. The ledgers and the two atomic reserve functions that make the
-- auto-tailor and alert-mail ceilings actually bind.
--
-- WHY A FUNCTION AT ALL. The ceilings are aggregate daily counts. The Supabase
-- client can only send literal payloads, so it cannot express
-- "increment where the count is still under the cap" in one statement, and the
-- admin client has no raw-SQL escape hatch. An rpc is therefore the only atomic
-- primitive available. Reading a count, deciding, then writing is the
-- double-spend this whole step exists to remove: two overlapping cron runs both
-- read the same number and both spend against it. Cron delivery is
-- at-least-once and a run can outlive its own cadence, so the overlap is
-- reachable rather than theoretical.
--
-- WHY security invoker, NOT security definer. The older prep-slot reserve in
-- this schema is definer because its caller is a browser client that must
-- bypass RLS on a shared table. That is also why it later needed an ownership
-- check and an explicit revoke of the anonymous role: a definer function
-- reachable by a low-privilege role is a privilege-escalation surface. These
-- two functions are called only by the cron, as the service role, which already
-- bypasses RLS and holds DML on these tables. Definer would buy nothing for
-- access and would add that surface back. Invoker is both sufficient and
-- strictly safer here: if the execute grant were ever widened by mistake, a
-- stray caller runs as itself, meets RLS and the absent table grants, and the
-- write simply fails. Please do not "fix" this back to definer.
--
-- WHY NO CHECK CONSTRAINT holds a ceiling. Owner ruling: the numbers live in
-- one JS constant per ceiling and arrive here as parameters. A ceiling welded
-- into the schema cannot be lowered by a user or raised by the owner without a
-- migration, and an earlier chunk had to remove exactly that.
--
-- SAFE TO APPLY TO A LIVE DATABASE WITH ROWS: six brand-new tables guarded by
-- if-not-exists; four column adds guarded the same way, whose non-volatile
-- defaults apply without a table rewrite; no check constraint, so nothing can
-- fail against an existing row; replace-function, grant, revoke and
-- do-nothing seeds are all idempotent. If a column already exists from schema
-- drift, the add is skipped and is NOT re-typed or backfilled, which is why
-- every read of these four columns tolerates null.
--
-- notify_email is deliberately NOT dropped. The table it lives on has no
-- creating migration and its live shape is unverified, so dropping a column
-- here is the drift hazard itself. The application stopped reading and writing
-- it in an earlier step; it is left orphaned on purpose.

-- ---------------------------------------------------------------------------
-- Counters. One row per user per UTC day, incremented atomically.
-- ---------------------------------------------------------------------------

create table if not exists public.auto_tailor_spend_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  tailored_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.alert_mail_spend_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  recipient text not null,
  sent_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day, recipient)
);

-- The per-account mail ceiling needs its own incrementable row. Summing the
-- per-recipient rows to get an account total would be a read, and deciding on
-- a read is the read-modify-write this step removes.
create table if not exists public.alert_mail_account_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  sent_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- What a run did, so a user can see why nothing was generated.
-- ---------------------------------------------------------------------------

create table if not exists public.auto_tailor_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ran_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists auto_tailor_runs_user_ran_at_idx
  on public.auto_tailor_runs (user_id, ran_at desc);

-- ---------------------------------------------------------------------------
-- One account-level pause, written by the user through their own client.
-- ---------------------------------------------------------------------------

create table if not exists public.user_alert_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  alerts_paused boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The rollback lever. Flipping a row here stops the producer within one cron
-- period, with no deploy and without changing anyone configuration. It carries
-- no policy at all on purpose: a user must never be able to flip it.
-- ---------------------------------------------------------------------------

create table if not exists public.feature_kill_switches (
  key text primary key,
  disabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

insert into public.feature_kill_switches (key, disabled)
values ('auto_tailor', false)
on conflict (key) do nothing;

insert into public.feature_kill_switches (key, disabled)
values ('alert_mail', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security. Every table below is written only by the cron as the
-- service role, which bypasses RLS, except user_alert_settings.
-- ---------------------------------------------------------------------------

alter table public.auto_tailor_spend_daily enable row level security;
alter table public.alert_mail_spend_daily enable row level security;
alter table public.alert_mail_account_daily enable row level security;
alter table public.auto_tailor_runs enable row level security;
alter table public.user_alert_settings enable row level security;
alter table public.feature_kill_switches enable row level security;

drop policy if exists auto_tailor_spend_daily_select_own on public.auto_tailor_spend_daily;
create policy auto_tailor_spend_daily_select_own
  on public.auto_tailor_spend_daily
  for select
  using (auth.uid() = user_id);

drop policy if exists alert_mail_spend_daily_select_own on public.alert_mail_spend_daily;
create policy alert_mail_spend_daily_select_own
  on public.alert_mail_spend_daily
  for select
  using (auth.uid() = user_id);

drop policy if exists alert_mail_account_daily_select_own on public.alert_mail_account_daily;
create policy alert_mail_account_daily_select_own
  on public.alert_mail_account_daily
  for select
  using (auth.uid() = user_id);

drop policy if exists auto_tailor_runs_select_own on public.auto_tailor_runs;
create policy auto_tailor_runs_select_own
  on public.auto_tailor_runs
  for select
  using (auth.uid() = user_id);

drop policy if exists user_alert_settings_select_own on public.user_alert_settings;
create policy user_alert_settings_select_own
  on public.user_alert_settings
  for select
  using (auth.uid() = user_id);

drop policy if exists user_alert_settings_insert_own on public.user_alert_settings;
create policy user_alert_settings_insert_own
  on public.user_alert_settings
  for insert
  with check (auth.uid() = user_id);

-- The one for-update policy in this file. It carries with check as well as
-- using, so a row cannot be updated into someone else ownership.
drop policy if exists user_alert_settings_update_own on public.user_alert_settings;
create policy user_alert_settings_update_own
  on public.user_alert_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- The atomic reserves.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_auto_tailor_slot(
  p_user_id uuid,
  p_day date,
  p_cap integer
) returns table (reserved boolean, used_today integer)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  -- Defend the floor here rather than trusting the caller. The insert below
  -- writes 1 unconditionally on the first call of a day, because the guard
  -- only governs the conflict path, so a cap below 1 would let exactly one
  -- reservation through. The caller never passes one today; a later caller
  -- might.
  if p_cap < 1 then
    return query select false, 0;
    return;
  end if;

  -- The whole ceiling in one statement. The row lock taken on conflict
  -- serialises concurrent callers, and the where on do update is how the cap
  -- refuses atomically: when the guard is false no row comes back.
  insert into public.auto_tailor_spend_daily as s (user_id, day, tailored_count, updated_at)
  values (p_user_id, p_day, 1, now())
  on conflict (user_id, day) do update
    set tailored_count = s.tailored_count + 1,
        updated_at = now()
    where s.tailored_count < p_cap
  returning s.tailored_count into v_count;

  if found then
    return query select true, v_count;
  else
    select s.tailored_count into v_count
      from public.auto_tailor_spend_daily s
      where s.user_id = p_user_id and s.day = p_day;
    return query select false, coalesce(v_count, 0);
  end if;
end;
$fn$;

create or replace function public.reserve_alert_mail_slot(
  p_user_id uuid,
  p_day date,
  p_recipient text,
  p_address_cap integer,
  p_account_cap integer
) returns table (reserved boolean, blocked_by text)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_acct integer;
  v_addr integer;
begin
  -- Make both counter rows exist BEFORE locking them. A for-update on a row
  -- that does not exist locks nothing, so without this every concurrent first
  -- send of the day would read zero and pass the guard together -- the caps
  -- would only become hard once a row happened to exist. Seeding at zero first
  -- means the lock below always has something to take, so concurrent senders
  -- serialise from the very first message. Both seeds are no-ops once the row
  -- is there.
  insert into public.alert_mail_account_daily (user_id, day, sent_count)
  values (p_user_id, p_day, 0)
  on conflict (user_id, day) do nothing;

  insert into public.alert_mail_spend_daily (user_id, day, recipient, sent_count)
  values (p_user_id, p_day, p_recipient, 0)
  on conflict (user_id, day, recipient) do nothing;

  -- Account row first, then the address row: a fixed order, so two callers
  -- cannot deadlock against each other.
  select a.sent_count into v_acct
    from public.alert_mail_account_daily a
    where a.user_id = p_user_id and a.day = p_day
    for update;
  v_acct := coalesce(v_acct, 0);
  if not (v_acct < p_account_cap) then
    return query select false, 'account'::text;
    return;
  end if;

  select m.sent_count into v_addr
    from public.alert_mail_spend_daily m
    where m.user_id = p_user_id and m.day = p_day and m.recipient = p_recipient
    for update;
  v_addr := coalesce(v_addr, 0);
  if not (v_addr < p_address_cap) then
    return query select false, 'address'::text;
    return;
  end if;

  insert into public.alert_mail_account_daily as a (user_id, day, sent_count, updated_at)
  values (p_user_id, p_day, 1, now())
  on conflict (user_id, day) do update
    set sent_count = a.sent_count + 1,
        updated_at = now();

  insert into public.alert_mail_spend_daily as m (user_id, day, recipient, sent_count, updated_at)
  values (p_user_id, p_day, p_recipient, 1, now())
  on conflict (user_id, day, recipient) do update
    set sent_count = m.sent_count + 1,
        updated_at = now();

  return query select true, null::text;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Execute is granted to the service role alone. Postgres grants execute to
-- PUBLIC by default on a new function, and the anonymous and authenticated
-- roles inherit from PUBLIC, so an omission here is not an absence: this schema
-- already carries a repair migration that exists only because that default was
-- left in place on other functions. Revoke explicitly.
-- ---------------------------------------------------------------------------

revoke execute on function public.reserve_auto_tailor_slot(uuid, date, integer) from public;
revoke execute on function public.reserve_auto_tailor_slot(uuid, date, integer) from anon;
revoke execute on function public.reserve_auto_tailor_slot(uuid, date, integer) from authenticated;
grant execute on function public.reserve_auto_tailor_slot(uuid, date, integer) to service_role;

revoke execute on function public.reserve_alert_mail_slot(uuid, date, text, integer, integer) from public;
revoke execute on function public.reserve_alert_mail_slot(uuid, date, text, integer, integer) from anon;
revoke execute on function public.reserve_alert_mail_slot(uuid, date, text, integer, integer) from authenticated;
grant execute on function public.reserve_alert_mail_slot(uuid, date, text, integer, integer) to service_role;

-- Table privileges. Supabase does not auto-grant a new table to the service
-- role, and relying on an unstated default is how the drift in this schema
-- started, so every grant is written out.

grant select on public.auto_tailor_spend_daily to authenticated;
grant all on public.auto_tailor_spend_daily to service_role;

grant select on public.alert_mail_spend_daily to authenticated;
grant all on public.alert_mail_spend_daily to service_role;

grant select on public.alert_mail_account_daily to authenticated;
grant all on public.alert_mail_account_daily to service_role;

grant select on public.auto_tailor_runs to authenticated;
grant all on public.auto_tailor_runs to service_role;

grant select, insert, update on public.user_alert_settings to authenticated;
grant all on public.user_alert_settings to service_role;

revoke all on public.feature_kill_switches from anon;
revoke all on public.feature_kill_switches from authenticated;
grant all on public.feature_kill_switches to service_role;

-- ---------------------------------------------------------------------------
-- The four saved-search columns the cron reads. Added with if-not-exists and
-- never re-forced not null afterwards: if one already exists as nullable from
-- drift, re-forcing it would fail against existing null rows, so the reads
-- tolerate null instead.
-- ---------------------------------------------------------------------------

alter table public.saved_searches add column if not exists auto_tailor_enabled boolean not null default false;
alter table public.saved_searches add column if not exists auto_tailor_daily_cap integer not null default 10;
alter table public.saved_searches add column if not exists auto_tailor_min_interval_minutes integer not null default 60;
alter table public.saved_searches add column if not exists last_run_at timestamptz;
