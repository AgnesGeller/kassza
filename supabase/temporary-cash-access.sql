-- Kassza-only expiry, read from server-owned app metadata, never user_metadata/JWT claims.
begin;
create or replace function kassza_private.cash_access_active()
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid() is not null and not exists(
   select 1 from auth.users u where u.id=auth.uid() and u.id='7a44a4a3-19cd-4bba-a3a2-c8a0b9b9709a'::uuid
   and (u.raw_app_meta_data->>'cash_access_until' is null
     or (u.raw_app_meta_data->>'cash_access_until')::timestamptz<=statement_timestamp()
     or u.raw_app_meta_data->>'cash_access_revoked'='true')
 );
$$;
revoke all on function kassza_private.cash_access_active() from public,anon;
grant usage on schema kassza_private to authenticated;
grant execute on function kassza_private.cash_access_active() to authenticated;

create or replace function kassza_private.require_cash_access()
returns void language plpgsql security invoker set search_path=''
as $$ begin
 if not kassza_private.cash_access_active() then
   raise exception 'A Kassza-hozzáférés lejárt vagy nem érvényes.' using errcode='42501';
 end if;
end $$;
revoke all on function kassza_private.require_cash_access() from public,anon;
grant execute on function kassza_private.require_cash_access() to authenticated;

-- Restrictive policies are AND-ed with the existing ownership/office policies.
do $$ declare target text; begin
 foreach target in array array['entries','profiles','cash_push_subscriptions','cash_protected_date_attempts'] loop
   execute format('drop policy if exists cash_access_not_expired on public.%I',target);
   execute format('create policy cash_access_not_expired on public.%I as restrictive for all to authenticated using ((select kassza_private.cash_access_active())) with check ((select kassza_private.cash_access_active()))',target);
 end loop;
end $$;

-- Statement trigger also protects SECURITY DEFINER write paths, without rewriting
-- historical-entry/VAT functions or changing their existing PIN/date logic.
create or replace function kassza_private.check_temporary_cash_write()
returns trigger language plpgsql security invoker set search_path=''
as $$ begin
 if auth.uid() is not null then perform kassza_private.require_cash_access(); end if;
 return null;
end $$;
revoke all on function kassza_private.check_temporary_cash_write() from public,anon,authenticated,service_role;
drop trigger if exists entries_00_temporary_cash_access on public.entries;
create trigger entries_00_temporary_cash_access before insert or update or delete on public.entries
for each statement execute function kassza_private.check_temporary_cash_write();

create or replace function public.list_cash_customers()
returns table(full_name text,is_new boolean) language sql stable security definer set search_path=''
as $$
 select c.full_name,(c.review_status='pending' or (c.source_app='kassza' and c.updated_at=c.created_at))
 from munkalap.customers c
 where kassza_private.cash_access_active() and auth.uid() is not null
 and exists(select 1 from public.profiles p where p.id=auth.uid())
 and c.active and c.archived_at is null order by c.full_name;
$$;

create or replace function public.add_cash_customer(p_name text,p_address text default '')
returns table(full_name text,is_new boolean) language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); customer uuid; clean_name text:=regexp_replace(btrim(coalesce(p_name,'')),'[[:space:]]+',' ','g'); clean_address text:=btrim(coalesce(p_address,''));
begin
 perform kassza_private.require_cash_access();
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

-- This helper belongs to the existing Kassza profile/role system.
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path=''
as $$ select kassza_private.cash_access_active() and exists(
 select 1 from public.profiles where id=auth.uid() and role='manager'
); $$;

create or replace function kassza_private.revoke_expired_cash_access()
returns void language plpgsql security definer set search_path=''
as $$ declare target uuid; begin
 for target in select u.id from auth.users u join public.profiles p on p.id=u.id
   where u.id='7a44a4a3-19cd-4bba-a3a2-c8a0b9b9709a'::uuid
   and u.raw_app_meta_data->>'cash_access_until' is not null
   and (u.raw_app_meta_data->>'cash_access_until')::timestamptz<=statement_timestamp()
   and coalesce(u.raw_app_meta_data->>'cash_access_revoked','false')<>'true'
 loop
   update auth.users set banned_until=now()+interval '100 years',
     encrypted_password=extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf')),
     raw_app_meta_data=raw_app_meta_data||'{"cash_access_revoked":true}'::jsonb,updated_at=now()
   where id=target;
   delete from auth.sessions where user_id=target;
   update public.profiles set role='worker' where id=target;
   update public.cash_push_subscriptions set enabled=false where owner_id=target;
 end loop;
end $$;
revoke all on function kassza_private.revoke_expired_cash_access() from public,anon,authenticated,service_role;
select cron.schedule('kassza-ferenc-access-expiry','* * * * *','select kassza_private.revoke_expired_cash_access();');
commit;
