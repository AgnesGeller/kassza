-- DÍSZKERTEK KASSZA – havi fix kiadások vezetői kezelése.

begin;

alter table munkalap_private.recurring_cash_expenses
  add column if not exists deleted_at timestamptz;

create or replace function public.list_recurring_cash_expenses()
returns table (
  code text,
  designation text,
  category text,
  note text,
  amount bigint,
  start_month date,
  active boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select rule.code, rule.designation, rule.category, rule.note, rule.amount,
    rule.start_month, rule.active, rule.updated_at
  from munkalap_private.recurring_cash_expenses rule
  where rule.deleted_at is null
    and auth.uid() is not null
    and public.is_manager()
  order by rule.designation
$$;

revoke all on function public.list_recurring_cash_expenses() from public, anon;
grant execute on function public.list_recurring_cash_expenses() to authenticated;

create or replace function public.save_recurring_cash_expense(
  p_code text,
  p_designation text,
  p_category text,
  p_note text,
  p_amount bigint,
  p_start_month date,
  p_active boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_code text := nullif(btrim(p_code), '');
  normalized_month date := date_trunc('month', p_start_month)::date;
  previous_sync_setting text := current_setting('munkalap.recurring_sync', true);
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'A havi fix kiadások szerkesztéséhez vezetői jogosultság szükséges.'
      using errcode = '42501';
  end if;
  if btrim(coalesce(p_designation, '')) = '' or length(btrim(p_designation)) > 200 then
    raise exception 'A megnevezés kötelező, és legfeljebb 200 karakter lehet.';
  end if;
  if btrim(coalesce(p_category, '')) = '' then
    raise exception 'A kategória kötelező.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Az összegnek nullánál nagyobbnak kell lennie.';
  end if;
  if p_start_month is null or p_start_month <> normalized_month then
    raise exception 'A kezdő hónap első napját add meg.';
  end if;

  if saved_code is null then
    saved_code := 'fixed_' || replace(gen_random_uuid()::text, '-', '');
    insert into munkalap_private.recurring_cash_expenses (
      code, designation, category, note, amount, start_month, active
    ) values (
      saved_code, btrim(p_designation), btrim(p_category), coalesce(btrim(p_note), ''),
      p_amount, normalized_month, coalesce(p_active, true)
    );
  else
    update munkalap_private.recurring_cash_expenses
    set designation = btrim(p_designation),
      category = btrim(p_category),
      note = coalesce(btrim(p_note), ''),
      amount = p_amount,
      start_month = normalized_month,
      active = coalesce(p_active, true),
      updated_at = now()
    where code = saved_code and deleted_at is null;
    if not found then raise exception 'A havi fix kiadás már nem található.'; end if;
  end if;

  perform set_config('munkalap.recurring_sync', 'on', true);
  update public.entries entry
  set designation = rule.designation,
    category = rule.category,
    note = rule.note,
    amount = rule.amount
  from munkalap_private.recurring_cash_expense_entries link
  join munkalap_private.recurring_cash_expenses rule on rule.code = link.expense_code
  where link.entry_id = entry.id
    and link.expense_code = saved_code
    and link.expense_month >= date_trunc('month', current_date)::date;
  perform set_config('munkalap.recurring_sync', coalesce(previous_sync_setting, ''), true);

  if coalesce(p_active, true) and normalized_month <= date_trunc('month', current_date)::date then
    perform munkalap_private.generate_recurring_cash_expenses_internal(
      date_trunc('month', current_date)::date
    );
  end if;
  return saved_code;
exception
  when others then
    perform set_config('munkalap.recurring_sync', coalesce(previous_sync_setting, ''), true);
    raise;
end;
$$;

revoke all on function public.save_recurring_cash_expense(text,text,text,text,bigint,date,boolean)
  from public, anon;
grant execute on function public.save_recurring_cash_expense(text,text,text,text,bigint,date,boolean)
  to authenticated;

create or replace function public.delete_recurring_cash_expense(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'A havi fix kiadás törléséhez vezetői jogosultság szükséges.'
      using errcode = '42501';
  end if;
  update munkalap_private.recurring_cash_expenses
  set active = false, deleted_at = now(), updated_at = now()
  where code = p_code and deleted_at is null;
  if not found then raise exception 'A havi fix kiadás már nem található.'; end if;
end;
$$;

revoke all on function public.delete_recurring_cash_expense(text) from public, anon;
grant execute on function public.delete_recurring_cash_expense(text) to authenticated;

create or replace function public.generate_recurring_cash_expenses_for_cash()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'A havi fix kiadások létrehozásához vezetői jogosultság szükséges.'
      using errcode = '42501';
  end if;
  return munkalap_private.generate_recurring_cash_expenses_internal(
    date_trunc('month', current_date)::date
  );
end;
$$;

revoke all on function public.generate_recurring_cash_expenses_for_cash() from public, anon;
grant execute on function public.generate_recurring_cash_expenses_for_cash() to authenticated;

create or replace function munkalap_private.protect_linked_cash_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recurring_linked boolean := false;
begin
  if tg_op <> 'INSERT' then
    select exists(
      select 1
      from munkalap_private.recurring_cash_expense_entries link
      where link.entry_id = old.id
    ) into recurring_linked;
  end if;

  if (
      current_setting('munkalap.cash_sync', true) is distinct from 'on'
      and (
        (tg_op <> 'INSERT' and old.source_type = 'munkalap_settlement')
        or (tg_op <> 'DELETE' and new.source_type = 'munkalap_settlement')
      )
    )
    or (
      recurring_linked
      and current_setting('munkalap.recurring_sync', true) is distinct from 'on'
    ) then
    raise exception using
      errcode = '42501',
      message = 'Ezt a Kassza-tételt az automatikus kapcsolat kezeli. A módosítást a vezetői beállításoknál végezd.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function munkalap_private.generate_recurring_cash_expenses_internal(
  p_through_month date
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  recurring record;
  month_start date;
  owner_id uuid;
  new_entry_id uuid;
  created_count integer := 0;
begin
  select profile.id into owner_id
  from public.profiles profile
  where profile.display_name = 'Tamás' and profile.role = 'manager'
  limit 1;
  if owner_id is null then
    raise exception 'Tamás vezetői Kassza-profilja nem található.';
  end if;

  for recurring in
    select * from munkalap_private.recurring_cash_expenses
    where active and deleted_at is null and start_month <= p_through_month
    order by code
    for update
  loop
    for month_start in
      select generated::date from generate_series(
        recurring.start_month,
        least(coalesce(recurring.end_month, p_through_month), p_through_month),
        interval '1 month'
      ) generated
    loop
      if exists (
        select 1 from munkalap_private.recurring_cash_expense_entries link
        where link.expense_code = recurring.code and link.expense_month = month_start
      ) then continue; end if;

      insert into public.entries (
        user_id, leader_name, direction, category, transfer_type, designation,
        receipt, entry_date, amount, partner, address, note
      ) values (
        owner_id, 'Tamás', 'expense', recurring.category, '', recurring.designation,
        '', month_start, recurring.amount, '', '', recurring.note
      ) returning id into new_entry_id;

      insert into munkalap_private.recurring_cash_expense_entries
        (expense_code, expense_month, entry_id)
      values (recurring.code, month_start, new_entry_id);
      created_count := created_count + 1;
    end loop;
  end loop;
  return created_count;
end;
$$;

create or replace function public.list_recurring_cash_entry_links()
returns table(entry_id uuid, expense_code text, expense_month date)
language sql
stable
security definer
set search_path = ''
as $$
  select link.entry_id, link.expense_code, link.expense_month
  from munkalap_private.recurring_cash_expense_entries link
  where auth.uid() is not null and public.is_manager();
$$;

revoke all on function public.list_recurring_cash_entry_links() from public, anon;
grant execute on function public.list_recurring_cash_entry_links() to authenticated;

commit;
