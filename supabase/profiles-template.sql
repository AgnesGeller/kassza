insert into public.profiles (id, display_name, role)
select id,
  case email
    when 'adam@kassza.diszkertek.hu' then 'Ádám'
    when 'agi@kassza.diszkertek.hu' then 'Ági'
    when 'bendeguz@kassza.diszkertek.hu' then 'Bendegúz'
    when 'mark@kassza.diszkertek.hu' then 'Márk'
    when 'tamas@kassza.diszkertek.hu' then 'Tamás'
    when 'zsolti@kassza.diszkertek.hu' then 'Zsolti'
  end,
  case when email in ('agi@kassza.diszkertek.hu','tamas@kassza.diszkertek.hu') then 'manager' else 'worker' end
from auth.users
where email in ('adam@kassza.diszkertek.hu','agi@kassza.diszkertek.hu','bendeguz@kassza.diszkertek.hu','mark@kassza.diszkertek.hu','tamas@kassza.diszkertek.hu','zsolti@kassza.diszkertek.hu')
on conflict (id) do update set display_name=excluded.display_name, role=excluded.role;
