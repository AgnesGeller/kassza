-- Mobilriasztás a 14 napnál régebbi vagy 7 nappal későbbi mentési kísérletekről.
-- A Kassza meglévő dátumhatárait és a tételeket ez a migráció nem módosítja.

begin;

create table if not exists public.cash_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_name text not null default '',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_protected_date_attempts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  actor_name text not null,
  attempted_action text not null check (attempted_action in ('create', 'update')),
  entry_date date not null,
  direction text not null check (direction in ('income', 'expense')),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists cash_attempts_actor_created_idx
  on public.cash_protected_date_attempts (actor_id, created_at desc);

alter table public.cash_push_subscriptions enable row level security;
alter table public.cash_protected_date_attempts enable row level security;

drop policy if exists "cash_managers_read_own_push" on public.cash_push_subscriptions;
create policy "cash_managers_read_own_push" on public.cash_push_subscriptions
for select to authenticated using (owner_id = auth.uid() and public.is_manager());

drop policy if exists "cash_managers_manage_own_push" on public.cash_push_subscriptions;
create policy "cash_managers_manage_own_push" on public.cash_push_subscriptions
for all to authenticated using (owner_id = auth.uid() and public.is_manager())
with check (owner_id = auth.uid() and public.is_manager());

drop policy if exists "cash_managers_read_attempts" on public.cash_protected_date_attempts;
create policy "cash_managers_read_attempts" on public.cash_protected_date_attempts
for select to authenticated using (public.is_manager());

grant select, insert, update, delete on public.cash_push_subscriptions to authenticated;
grant select on public.cash_protected_date_attempts to authenticated;

do $$
declare
  source_public text;
  source_private text;
begin
  select max(case when name = 'napi_vapid_public_key' then decrypted_secret end),
         max(case when name = 'napi_vapid_private_key' then decrypted_secret end)
    into source_public, source_private
  from vault.decrypted_secrets
  where name in ('napi_vapid_public_key', 'napi_vapid_private_key');

  if source_public is null or source_private is null then
    raise exception 'A meglévő Web Push kulcsok nem érhetők el.';
  end if;
  if not exists (select 1 from vault.secrets where name = 'cash_vapid_public_key') then
    perform vault.create_secret(source_public, 'cash_vapid_public_key', 'Kassza Web Push nyilvános kulcs');
  end if;
  if not exists (select 1 from vault.secrets where name = 'cash_vapid_private_key') then
    perform vault.create_secret(source_private, 'cash_vapid_private_key', 'Kassza Web Push privát kulcs');
  end if;
end $$;

create or replace function public.cash_get_web_push_secrets()
returns table(public_key text, private_key text)
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
    max(case when secret.name = 'cash_vapid_private_key' then secret.decrypted_secret end)
  from vault.decrypted_secrets secret
  where secret.name in ('cash_vapid_public_key', 'cash_vapid_private_key');
end;
$$;

revoke all on function public.cash_get_web_push_secrets() from public, anon, authenticated;
grant execute on function public.cash_get_web_push_secrets() to service_role;

create or replace function public.cash_date_requires_override(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_date <= current_date - 14 or p_date >= current_date + 7
$$;
revoke all on function public.cash_date_requires_override(date) from public, anon, authenticated;
grant execute on function public.cash_date_requires_override(date) to service_role;

commit;
