-- Célzott Web Push értesítés, ha Ági vagy Tamás más személy kasszáját módosítja.

begin;

create schema if not exists kassza_private;
revoke all on schema kassza_private from public, anon, authenticated;

create table if not exists kassza_private.cash_entry_notification_events (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  actor_name text not null,
  action text not null check (action in ('create', 'update', 'delete')),
  entry_date date not null,
  direction text not null check (direction in ('income', 'expense')),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  processing_at timestamptz,
  sent_at timestamptz,
  delivered_count integer not null default 0,
  last_error text not null default ''
);

create index if not exists cash_entry_notification_pending_idx
  on kassza_private.cash_entry_notification_events (created_at)
  where sent_at is null;
create index if not exists cash_entry_notification_owner_idx
  on kassza_private.cash_entry_notification_events (owner_id);
create index if not exists cash_entry_notification_actor_idx
  on kassza_private.cash_entry_notification_events (actor_id);
create index if not exists cash_push_subscriptions_owner_idx
  on public.cash_push_subscriptions (owner_id);

revoke all on kassza_private.cash_entry_notification_events from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cash_entry_webhook_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cash_entry_webhook_secret',
      'Kassza tételértesítési webhook hitelesítése'
    );
  end if;
end $$;

create or replace function public.cash_get_notification_secrets()
returns table(public_key text, private_key text, webhook_secret text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Nincs jogosultság.' using errcode = '42501';
  end if;
  return query
  select
    max(case when secret.name = 'cash_vapid_public_key' then secret.decrypted_secret end),
    max(case when secret.name = 'cash_vapid_private_key' then secret.decrypted_secret end),
    max(case when secret.name = 'cash_entry_webhook_secret' then secret.decrypted_secret end)
  from vault.decrypted_secrets secret
  where secret.name in (
    'cash_vapid_public_key', 'cash_vapid_private_key', 'cash_entry_webhook_secret'
  );
end;
$$;

revoke all on function public.cash_get_notification_secrets() from public, anon, authenticated;
grant execute on function public.cash_get_notification_secrets() to service_role;

create or replace function public.cash_claim_entry_notification_event(p_event_id uuid)
returns table (
  id uuid,
  entry_id uuid,
  owner_id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  entry_date date,
  direction text,
  amount bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Nincs jogosultság.' using errcode = '42501';
  end if;
  return query
  update kassza_private.cash_entry_notification_events event
  set processing_at = now(), last_error = ''
  where event.id = p_event_id
    and event.sent_at is null
    and (event.processing_at is null or event.processing_at < now() - interval '5 minutes')
  returning event.id, event.entry_id, event.owner_id, event.actor_id,
    event.actor_name, event.action, event.entry_date, event.direction, event.amount;
end;
$$;

revoke all on function public.cash_claim_entry_notification_event(uuid)
  from public, anon, authenticated;
grant execute on function public.cash_claim_entry_notification_event(uuid) to service_role;

create or replace function public.cash_complete_entry_notification_event(
  p_event_id uuid,
  p_delivered_count integer,
  p_last_error text default ''
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Nincs jogosultság.' using errcode = '42501';
  end if;
  update kassza_private.cash_entry_notification_events
  set sent_at = now(),
    delivered_count = greatest(coalesce(p_delivered_count, 0), 0),
    last_error = left(coalesce(p_last_error, ''), 1000)
  where id = p_event_id;
end;
$$;

revoke all on function public.cash_complete_entry_notification_event(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.cash_complete_entry_notification_event(uuid, integer, text)
  to service_role;

create or replace function kassza_private.dispatch_cash_entry_notification(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  select secret.decrypted_secret into webhook_secret
  from vault.decrypted_secrets secret
  where secret.name = 'cash_entry_webhook_secret';
  if webhook_secret is null then
    raise exception 'A Kassza értesítési webhook kulcsa hiányzik.';
  end if;
  perform net.http_post(
    url := 'https://wojgdfojupnfldrmqaht.supabase.co/functions/v1/cash-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cash-webhook-key', webhook_secret
    ),
    body := jsonb_build_object('action', 'entry-event', 'eventId', p_event_id),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function kassza_private.dispatch_cash_entry_notification(uuid)
  from public, anon, authenticated;

create or replace function kassza_private.capture_cash_entry_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_entry public.entries%rowtype;
  actor_profile public.profiles%rowtype;
  event_id uuid;
begin
  changed_entry := case when tg_op = 'DELETE' then old else new end;

  if auth.uid() is null or auth.uid() = changed_entry.user_id then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into actor_profile
  from public.profiles
  where id = auth.uid() and role = 'manager';
  if not found or actor_profile.display_name not in ('Ági', 'Tamás') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into kassza_private.cash_entry_notification_events (
    entry_id, owner_id, actor_id, actor_name, action,
    entry_date, direction, amount
  ) values (
    changed_entry.id, changed_entry.user_id, actor_profile.id, actor_profile.display_name,
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    changed_entry.entry_date, changed_entry.direction, changed_entry.amount
  ) returning id into event_id;

  perform kassza_private.dispatch_cash_entry_notification(event_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function kassza_private.capture_cash_entry_notification()
  from public, anon, authenticated;

drop trigger if exists entries_capture_owner_notification on public.entries;
create trigger entries_capture_owner_notification
after insert or update or delete on public.entries
for each row execute function kassza_private.capture_cash_entry_notification();

create or replace function kassza_private.retry_cash_entry_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending record;
begin
  for pending in
    select event.id
    from kassza_private.cash_entry_notification_events event
    where event.sent_at is null
      and (event.processing_at is null or event.processing_at < now() - interval '5 minutes')
      and event.created_at > now() - interval '7 days'
    order by event.created_at
    limit 20
  loop
    perform kassza_private.dispatch_cash_entry_notification(pending.id);
  end loop;
end;
$$;

revoke all on function kassza_private.retry_cash_entry_notifications()
  from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job
  where jobname = 'cash-entry-notification-retry';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'cash-entry-notification-retry',
    '* * * * *',
    'select kassza_private.retry_cash_entry_notifications();'
  );
end $$;

drop policy if exists "cash_managers_read_own_push" on public.cash_push_subscriptions;
drop policy if exists "cash_managers_manage_own_push" on public.cash_push_subscriptions;
drop policy if exists "cash_users_read_own_push" on public.cash_push_subscriptions;
drop policy if exists "cash_users_manage_own_push" on public.cash_push_subscriptions;
create policy "cash_users_manage_own_push" on public.cash_push_subscriptions
for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

commit;
