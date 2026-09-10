begin;

create or replace function public.list_approved_cash_customers()
returns table (full_name text)
language sql
stable
security definer
set search_path = pg_catalog, public, munkalap
as $$
  select c.full_name
  from munkalap.customers c
  where auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid())
    and c.active = true
    and c.review_status = 'approved'
  order by c.full_name;
$$;

revoke all on function public.list_approved_cash_customers() from public, anon;
grant execute on function public.list_approved_cash_customers() to authenticated;

commit;
