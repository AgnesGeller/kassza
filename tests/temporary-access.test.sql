-- Run ONLY on an isolated database copy, not repeatedly against production.
-- Always rolls back: no probe entry, account change or revoked session persists.
begin;
set local lock_timeout='2s';
set local statement_timeout='25s';
create temporary table cash_visibility_test(stage text,display_name text,entry_count bigint,profile_count bigint,customer_count bigint,is_manager boolean) on commit drop;
create temporary table cash_data_test as
 select md5(coalesce(string_agg(to_jsonb(e)::text,'|' order by id),'')) fingerprint from public.entries e;
create temporary table cash_other_profiles_test as
 select md5(string_agg(to_jsonb(p)::text,'|' order by id)) fingerprint from public.profiles p where display_name<>'Ferenc';
-- Validate the actual active manager profile and its original configured deadline.
do $$ declare f uuid; r record; begin
 select p.id into strict f from public.profiles p join auth.users u on u.id=p.id
 where p.display_name='Ferenc' and p.role='manager' and u.email='ferenc@kassza.diszkertek.hu'
 and (u.raw_app_meta_data->>'cash_access_until')::timestamptz='2026-12-22T23:00:00Z'::timestamptz;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f,'role','authenticated')::text,true);
 set local role authenticated;
 select public.is_manager() m,(select count(*) from public.entries) e into r;
 reset role;
 if not r.m or r.e<>(select count(*) from public.entries) then raise exception 'Active manager access failed'; end if;
 perform set_config('request.jwt.claims','{}',true);
 insert into public.entries(user_id,leader_name,direction,category,entry_date,amount,note)
 values(f,'Ferenc','income','Egyéb bevétel',current_date,1,'Rollback-only expiry preservation probe');
end $$;
create temporary table cash_probe_data_test as
 select md5(string_agg(to_jsonb(e)::text,'|' order by id)) fingerprint from public.entries e;

do $$ declare person record; r record; begin
 for person in select * from public.profiles where display_name<>'Ferenc' order by display_name loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',person.id,'role','authenticated')::text,true);
  set local role authenticated;
  select (select count(*) from public.entries) e,(select count(*) from public.profiles where display_name<>'Ferenc') p,(select count(*) from public.list_cash_customers()) c,public.is_manager() m into r;
  update public.entries set note=note where false;
  delete from public.entries where false;
  reset role;
  insert into cash_visibility_test values('before',person.display_name,r.e,r.p,r.c,r.m);
 end loop;
 perform set_config('request.jwt.claims','{}',true);
end $$;

do $$ declare f uuid; r record; begin
 select id into strict f from public.profiles where display_name='Ferenc';
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{cash_access_until}',to_jsonb((now()-interval '1 second')::text)) where id=f;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f,'role','authenticated')::text,true);
 set local role authenticated;
 select public.is_manager() m,(select count(*) from public.entries) e,(select count(*) from public.profiles) p,(select count(*) from public.list_cash_customers()) c into r;
 if r.m or r.e<>0 or r.p<>0 or r.c<>0 then raise exception 'Expired Ferenc still has read access'; end if;
 begin
  update public.entries set note=note where false;
  raise exception 'Expired write not rejected';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.entries where false;
  raise exception 'Expired delete not rejected';
 exception when insufficient_privilege then null; end;
 begin
  perform public.add_cash_customer('Rollback-only forbidden customer','');
  raise exception 'Expired customer creation not rejected';
 exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claims','{}',true);
 perform kassza_private.revoke_expired_cash_access();
 if (select md5(string_agg(to_jsonb(e)::text,'|' order by id)) from public.entries e)<>(select fingerprint from cash_probe_data_test) then raise exception 'Entries changed by expiry'; end if;
 if not exists(select 1 from auth.users where id=f and banned_until>now() and raw_app_meta_data->>'cash_access_revoked'='true') then raise exception 'Account not disabled'; end if;
 if not exists(select 1 from public.profiles where id=f and role='worker') then raise exception 'Manager role not revoked'; end if;
 if not exists(select 1 from public.entries where user_id=f) then raise exception 'Ferenc data not preserved'; end if;
 if exists(select 1 from auth.sessions where user_id=f) then raise exception 'Sessions not revoked'; end if;
end $$;

do $$ declare person record; r record; begin
 for person in select * from public.profiles where display_name<>'Ferenc' order by display_name loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',person.id,'role','authenticated')::text,true);
  set local role authenticated;
  select (select count(*) from public.entries) e,(select count(*) from public.profiles where display_name<>'Ferenc') p,(select count(*) from public.list_cash_customers()) c,public.is_manager() m into r;
  update public.entries set note=note where false;
  delete from public.entries where false;
  reset role;
  insert into cash_visibility_test values('after',person.display_name,r.e,r.p,r.c,r.m);
 end loop;
 perform set_config('request.jwt.claims','{}',true);
end $$;

do $$ begin
 if exists(select display_name,entry_count,profile_count,customer_count,is_manager from cash_visibility_test where stage='before'
 except select display_name,entry_count,profile_count,customer_count,is_manager from cash_visibility_test where stage='after')
 then raise exception 'Existing users access changed'; end if;
 if (select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from public.profiles p where display_name<>'Ferenc')<>(select fingerprint from cash_other_profiles_test)
 then raise exception 'Other profiles changed'; end if;
end $$;
select 'PASS: active manager; expired reads/writes/deletes/customer creation denied; sessions revoked; account disabled; all cash data preserved; all seven other users unchanged; rollback' result;
rollback;
