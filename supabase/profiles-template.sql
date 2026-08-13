insert into public.profiles (id, display_name, role)
select id,
  case email
    when 'agi@kassza.diszkertek.hu' then 'Ági'
    when 'bendeguz@kassza.diszkertek.hu' then 'Bendegúz'
    when 'marci@kassza.diszkertek.hu' then 'Marci'
    when 'mark@kassza.diszkertek.hu' then 'Márk'
    when 'tamas@kassza.diszkertek.hu' then 'Tamás'
  end,
  case when email in ('agi@kassza.diszkertek.hu','tamas@kassza.diszkertek.hu') then 'manager' else 'worker' end
from auth.users
where email in ('agi@kassza.diszkertek.hu','bendeguz@kassza.diszkertek.hu','marci@kassza.diszkertek.hu','mark@kassza.diszkertek.hu','tamas@kassza.diszkertek.hu')
on conflict (id) do update set display_name=excluded.display_name, role=excluded.role;
