begin;
alter table public.entries add column if not exists vat_rate numeric(5,2);
alter table public.entries add constraint entries_vat_rate_range check(vat_rate is null or vat_rate between 0 and 100);
create or replace function kassza_private.apply_cash_vat_rate()
returns trigger language plpgsql security definer set search_path='' as $$
declare office boolean;
begin
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='manager' and p.display_name in ('Ági','Tamás')) into office;
 if new.receipt <> 'Számlás' then new.vat_rate:=null; return new; end if;
 if tg_op='INSERT' then
   new.vat_rate:=coalesce(new.vat_rate,27);
   if not office and new.vat_rate<>27 then raise exception 'Az áfakulcsot csak Ági vagy Tamás módosíthatja.' using errcode='42501'; end if;
 elsif old.receipt is distinct from new.receipt then
   if office then new.vat_rate:=coalesce(new.vat_rate,27); else new.vat_rate:=27; end if;
 elsif not office and new.vat_rate is distinct from old.vat_rate then
   raise exception 'Az áfakulcsot csak Ági vagy Tamás módosíthatja.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function kassza_private.apply_cash_vat_rate() from public,anon,authenticated;
create trigger entries_apply_cash_vat_rate before insert or update on public.entries
for each row execute function kassza_private.apply_cash_vat_rate();
create or replace function public.set_cash_vat_rate(p_entry_id uuid,p_rate numeric,p_pin text default '')
returns public.entries language plpgsql security definer set search_path='' as $$
declare entry public.entries%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='manager' and p.display_name in ('Ági','Tamás')) then
 raise exception 'Az áfakulcsot csak Ági vagy Tamás módosíthatja.' using errcode='42501'; end if;
 if p_rate is null or p_rate<0 or p_rate>100 or p_rate<>round(p_rate,2) then raise exception 'Az áfakulcs 0 és 100 közötti szám lehet, legfeljebb két tizedesjeggyel.'; end if;
 select * into entry from public.entries where id=p_entry_id for update;
 if not found then raise exception 'A tétel nem található.'; end if;
 if entry.receipt<>'Számlás' then raise exception 'Áfakulcs csak számlás tételnél adható meg.'; end if;
 if coalesce(entry.source_type,'')<>'' then raise exception 'Ezt a tételt a kapcsolódó elszámolás kezeli.'; end if;
 if (entry.entry_date<=current_date-14 or entry.entry_date>=current_date+7) and not kassza_private.valid_override_pin(p_pin) then
 raise exception 'Ehhez a dátumhoz érvényes feloldó PIN-kód szükséges.' using errcode='42501'; end if;
 update public.entries set vat_rate=p_rate where id=p_entry_id returning * into entry;
 return entry;
end $$;
revoke all on function public.set_cash_vat_rate(uuid,numeric,text) from public,anon;
grant execute on function public.set_cash_vat_rate(uuid,numeric,text) to authenticated;
commit;
