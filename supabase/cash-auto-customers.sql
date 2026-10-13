begin;
alter table munkalap.customers add column if not exists source_app text;
create or replace function public.list_cash_customers()
returns table(full_name text, is_new boolean)
language sql stable security definer set search_path = ''
as $$
 select c.full_name,(c.review_status='pending' or (c.source_app='kassza' and c.updated_at=c.created_at))
 from munkalap.customers c
 where auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid())
 and c.active and c.archived_at is null order by c.full_name;
$$;
revoke all on function public.list_cash_customers() from public,anon;
grant execute on function public.list_cash_customers() to authenticated;
create or replace function public.add_cash_customer(p_name text,p_address text default '')
returns table(full_name text,is_new boolean)
language plpgsql security definer set search_path = ''
as $$
declare actor uuid:=auth.uid(); customer uuid; clean_name text:=regexp_replace(btrim(coalesce(p_name,'')),'[[:space:]]+',' ','g'); clean_address text:=btrim(coalesce(p_address,''));
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor) then raise exception 'Nincs jogosultság.' using errcode='42501'; end if;
 if length(clean_name)<2 or length(clean_name)>160 then raise exception 'Az ügyfél neve 2–160 karakter lehet.'; end if;
 if length(clean_address)>500 then raise exception 'A cím legfeljebb 500 karakter lehet.'; end if;
 insert into munkalap.customers(full_name,review_status,created_by,source_app)
 values(clean_name,'approved',actor,'kassza') on conflict(normalized_name) do nothing returning id into customer;
 if customer is null then
 select c.id into customer from munkalap.customers c where c.normalized_name=lower(clean_name);
 if not exists(select 1 from munkalap.customers c where c.id=customer and c.active and c.archived_at is null) then raise exception 'Ez az ügyfél inaktív. Kérd az irodától az ellenőrzését.'; end if;
 end if;
 if clean_address<>'' then
 insert into munkalap.customer_locations(customer_id,address,review_status,created_by)
 select customer,clean_address,'approved',actor where not exists(select 1 from munkalap.customer_locations l where l.customer_id=customer and l.normalized_address=lower(clean_address))
 on conflict do nothing;
 end if;
 return query select c.full_name,(c.review_status='pending' or (c.source_app='kassza' and c.updated_at=c.created_at)) from munkalap.customers c where c.id=customer;
end;
$$;
revoke all on function public.add_cash_customer(text,text) from public,anon;
grant execute on function public.add_cash_customer(text,text) to authenticated;
commit;
