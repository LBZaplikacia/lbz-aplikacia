-- s30: TESTOVACÍ zamestnanec pre účet krojrentaren@gmail.com (Terézia si ním skúša, čo vidí zamestnanec)
-- Pred ostrým spustením zmazať spolu s ostatnými TEST údajmi (osoba „Test“, e-mail krojrentaren@gmail.com).
do $$
declare v_os bigint; d date;
begin
  select id into v_os from public.rozpis_osoby where lower(email) = 'krojrentaren@gmail.com' or lower(email2) = 'krojrentaren@gmail.com' limit 1;
  if v_os is null then
    insert into public.rozpis_osoby (meno, farba, email, aktivny, poradie, norma_h) values ('Test', '#b4a7d6', 'krojrentaren@gmail.com', true, 999, 8) returning id into v_os;
  end if;
  insert into public.zamestnanci (osoba_id, meno, priezvisko, telefon, email, ulica, psc, obec, vzdelanie, typ_vztahu, pozicia, druh_prace, miesto_vykonu, nastup, stav,
      rozsah_hodin, pracovne_dni, pracovny_cas, typ_prijmu, zdrav_preukaz_do, poznamka)
    values (v_os, 'Testovací', 'Zamestnanec', '0900 000 000', 'krojrentaren@gmail.com', 'Testovacia 1', '980 61', 'Tisovec', 'Stredné s maturitou', 'DPČ', 'Pomocný pekár a predavač',
      'pečenie a predaj', 'Zbojská 1960/14, Tisovec', date '2026-09-01', 'aktivny', '20', 'podľa rozpisu', 'nerovnomerný', 'Nepravidelný', public.dnes_sk() + 20,
      'TESTOVACÍ ZÁZNAM – zmazať pred ostrým spustením')
  on conflict (osoba_id) do nothing;
  -- dochádzka v septembri (príchod 7:00, odchod 15:00) + jeden deň dovolenky
  foreach d in array array[date '2026-09-22', date '2026-09-23', date '2026-09-25', date '2026-09-26', date '2026-09-29'] loop
    if not exists (select 1 from public.dochadzka where osoba_id = v_os and datum = d) then
      insert into public.dochadzka (osoba_id, datum, typ, miesto, prichod, odchod, prestavka_min, odpracovane_min, stravne, zdroj, poznamka)
      values (v_os, d, 'praca', 'ZBOJSKÁ', (d + time '07:00') at time zone 'Europe/Bratislava', (d + time '15:00') at time zone 'Europe/Bratislava', 30, 450,
              public.dochadzka_stravne('ZBOJSKÁ', 450), 'rucne', 'test');
    end if;
  end loop;
  if not exists (select 1 from public.dochadzka where osoba_id = v_os and datum = date '2026-09-24') then
    insert into public.dochadzka (osoba_id, datum, typ, odpracovane_min, zdroj, poznamka) values (v_os, date '2026-09-24', 'dovolenka', 480, 'rucne', 'test');
  end if;
  -- smeny v rozpise na najbližšie dni (pečenie, miesto 20 – mimo bežných miest)
  foreach d in array array[public.dnes_sk(), public.dnes_sk() + 1, public.dnes_sk() + 3, public.dnes_sk() + 6] loop
    insert into public.rozpis_miesta (datum, pozicia, miesto, osoba_id, cas_od, cas_do, poznamka)
      values (d, 'pecenie', 20, v_os, time '07:00', time '15:00', 'test') on conflict (datum, pozicia, miesto) do nothing;
  end loop;
end $$;
select o.id, o.meno, (select count(*) from public.dochadzka where osoba_id = o.id) dochadzka, (select count(*) from public.rozpis_miesta where osoba_id = o.id) smeny
from public.rozpis_osoby o where o.email = 'krojrentaren@gmail.com';
