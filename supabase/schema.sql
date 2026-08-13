create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null unique,
  role text not null default 'worker' check (role in ('worker', 'manager')),
  created_at timestamptz not null default now()
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  leader_name text not null,
  direction text not null check (direction in ('income', 'expense')),
  category text not null,
  transfer_type text not null default '',
  designation text not null default '',
  receipt text not null default '',
  entry_date date not null,
  amount bigint not null check (amount > 0),
  partner text not null default '',
  address text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entries_user_date_idx on public.entries (user_id, entry_date desc);
create index if not exists entries_date_idx on public.entries (entry_date desc);

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'manager') $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists entries_touch_updated_at on public.entries;
create trigger entries_touch_updated_at before update on public.entries
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.entries enable row level security;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_manager());

drop policy if exists "entries_read" on public.entries;
create policy "entries_read" on public.entries for select to authenticated
using (user_id = auth.uid() or public.is_manager());

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own" on public.entries for insert to authenticated
with check (
  user_id = auth.uid()
  and leader_name = (select display_name from public.profiles where id = auth.uid())
);

drop policy if exists "entries_update" on public.entries;
create policy "entries_update" on public.entries for update to authenticated
using (user_id = auth.uid() or public.is_manager())
with check (user_id = auth.uid() or public.is_manager());

drop policy if exists "entries_delete" on public.entries;
create policy "entries_delete" on public.entries for delete to authenticated
using (user_id = auth.uid() or public.is_manager());

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.entries to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
end
$$;
