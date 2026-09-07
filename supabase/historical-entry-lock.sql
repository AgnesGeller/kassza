-- A 14 napnál régebbi Kassza-tételek szerveroldali lezárása.
-- A külön feloldó PIN hash-e csak a Supabase-ben tárolható; ebbe a fájlba nem kerül titok.

begin;

create schema if not exists kassza_private;
revoke all on schema kassza_private from public, anon, authenticated;

create table if not exists kassza_private.settings (
  setting_key text primary key,
  secret_hash text not null,
  updated_at timestamptz not null default now()
);
revoke all on kassza_private.settings from public, anon, authenticated;

create or replace function kassza_private.valid_override_pin(p_pin text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from kassza_private.settings
    where setting_key = 'historical_entry_pin'
      and secret_hash = extensions.crypt(coalesce(p_pin, ''), secret_hash)
  )
$$;
revoke all on function kassza_private.valid_override_pin(text) from public, anon, authenticated;

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own" on public.entries for insert to authenticated
with check (
  entry_date > current_date - 14
  and (
    (user_id = auth.uid() and leader_name = (select display_name from public.profiles where id = auth.uid()))
    or
    (public.is_manager() and leader_name = (select display_name from public.profiles where id = user_id))
  )
);

drop policy if exists "entries_update" on public.entries;
create policy "entries_update" on public.entries for update to authenticated
using (
  entry_date > current_date - 14
  and (user_id = auth.uid() or public.is_manager())
)
with check (
  entry_date > current_date - 14
  and (user_id = auth.uid() or public.is_manager())
);

drop policy if exists "entries_delete" on public.entries;
create policy "entries_delete" on public.entries for delete to authenticated
using (
  entry_date > current_date - 14
  and (user_id = auth.uid() or public.is_manager())
);

create or replace function public.save_historical_cash_entry(
  p_entry_id uuid,
  p_user_id uuid,
  p_leader_name text,
  p_entry jsonb,
  p_pin text
) returns public.entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.entries%rowtype;
  saved public.entries%rowtype;
  requested_date date;
  requested_amount bigint;
begin
  if auth.uid() is null then
    raise exception 'Nincs bejelentkezve.' using errcode = '42501';
  end if;
  if not kassza_private.valid_override_pin(p_pin) then
    raise exception 'Hibás feloldó PIN-kód.' using errcode = '42501';
  end if;

  requested_date := (p_entry->>'entry_date')::date;
  requested_amount := (p_entry->>'amount')::bigint;
  if requested_amount <= 0 then raise exception 'Az összeg nem megfelelő.'; end if;
  if coalesce(p_entry->>'direction', '') not in ('income', 'expense') then raise exception 'A típus nem megfelelő.'; end if;
  if btrim(coalesce(p_entry->>'category', '')) = '' then raise exception 'A kategória kötelező.'; end if;

  if p_entry_id is null then
    if requested_date > current_date - 14 then
      raise exception 'Ez a dátum még nincs lezárva; használd a normál mentést.';
    end if;
    if not (
      (p_user_id = auth.uid() and p_leader_name = (select display_name from public.profiles where id = auth.uid()))
      or
      (public.is_manager() and p_leader_name = (select display_name from public.profiles where id = p_user_id))
    ) then raise exception 'Nincs jogosultság ehhez a kasszához.' using errcode = '42501'; end if;

    insert into public.entries (
      user_id, leader_name, direction, category, transfer_type, designation,
      receipt, entry_date, amount, partner, address, note
    ) values (
      p_user_id, p_leader_name, p_entry->>'direction', p_entry->>'category',
      coalesce(p_entry->>'transfer_type', ''), coalesce(p_entry->>'designation', ''),
      coalesce(p_entry->>'receipt', ''), requested_date, requested_amount,
      coalesce(p_entry->>'partner', ''), coalesce(p_entry->>'address', ''),
      coalesce(p_entry->>'note', '')
    ) returning * into saved;
  else
    select * into existing from public.entries where id = p_entry_id for update;
    if not found then raise exception 'A tétel már nem található.'; end if;
    if existing.user_id <> auth.uid() and not public.is_manager() then
      raise exception 'Nincs jogosultság ehhez a tételhez.' using errcode = '42501';
    end if;
    if existing.entry_date > current_date - 14 and requested_date > current_date - 14 then
      raise exception 'Ez a tétel még nincs lezárva; használd a normál mentést.';
    end if;

    update public.entries set
      direction = p_entry->>'direction', category = p_entry->>'category',
      transfer_type = coalesce(p_entry->>'transfer_type', ''),
      designation = coalesce(p_entry->>'designation', ''),
      receipt = coalesce(p_entry->>'receipt', ''), entry_date = requested_date,
      amount = requested_amount, partner = coalesce(p_entry->>'partner', ''),
      address = coalesce(p_entry->>'address', ''), note = coalesce(p_entry->>'note', '')
    where id = p_entry_id returning * into saved;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_historical_cash_entry(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.save_historical_cash_entry(uuid, uuid, text, jsonb, text) to authenticated;

create or replace function public.delete_historical_cash_entry(p_entry_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare existing public.entries%rowtype;
begin
  if auth.uid() is null then raise exception 'Nincs bejelentkezve.' using errcode = '42501'; end if;
  if not kassza_private.valid_override_pin(p_pin) then
    raise exception 'Hibás feloldó PIN-kód.' using errcode = '42501';
  end if;
  select * into existing from public.entries where id = p_entry_id for update;
  if not found then raise exception 'A tétel már nem található.'; end if;
  if existing.user_id <> auth.uid() and not public.is_manager() then
    raise exception 'Nincs jogosultság ehhez a tételhez.' using errcode = '42501';
  end if;
  if existing.entry_date > current_date - 14 then
    raise exception 'Ez a tétel még nincs lezárva; használd a normál törlést.';
  end if;
  delete from public.entries where id = p_entry_id;
end;
$$;
revoke all on function public.delete_historical_cash_entry(uuid, text) from public, anon;
grant execute on function public.delete_historical_cash_entry(uuid, text) to authenticated;

commit;

