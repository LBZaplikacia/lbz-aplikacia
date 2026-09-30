-- =========================================================================
-- 39) AUTOMATICKÝ PRACOVNÝ ČAS podľa práce v appke (v0.26) – 30. 9. 2026
--   Pre osoby s rozpis_osoby.auto_cas (Natka – customer service): čas sa ráta, kým má appku otvorenú
--   na obrazovke a pracuje v nej. Po 5 min nečinnosti, minimalizovaní alebo zavretí sa rátanie zastaví.
--   Appka posiela „ping“ každú minútu; úseky sa ukladajú do aktivita_useky a každý deň sa z nich
--   automaticky zostaví riadok v dochádzke (zdroj 'import', poznámka „automaticky – práca v appke“).
-- =========================================================================
alter table public.rozpis_osoby add column if not exists auto_cas boolean not null default false;
update public.rozpis_osoby set auto_cas = true where meno in ('Natka', 'Natália');

create table if not exists public.aktivita_useky (
  id        bigint generated always as identity primary key,
  osoba_id  bigint not null references public.rozpis_osoby(id),
  datum     date not null,
  zaciatok  timestamptz not null,
  koniec    timestamptz not null,
  zariadenie text
);
create index if not exists aktivita_useky_osoba_datum on public.aktivita_useky (osoba_id, datum, koniec desc);
alter table public.aktivita_useky enable row level security;
grant select, insert, update, delete on public.aktivita_useky to service_role;

-- zostaví / obnoví riadok v dochádzke za deň z úsekov aktivity
create or replace function public.aktivita_do_dochadzky(p_osoba bigint, p_datum date) returns int
language plpgsql security definer set search_path = public as $$
declare v_od timestamptz; v_do timestamptz; v_min int; v_id bigint;
begin
  select min(zaciatok), max(koniec), coalesce(round(sum(extract(epoch from (koniec - zaciatok))) / 60.0), 0)::int
    into v_od, v_do, v_min from public.aktivita_useky where osoba_id = p_osoba and datum = p_datum;
  select id into v_id from public.dochadzka
    where osoba_id = p_osoba and datum = p_datum and zdroj = 'import' and poznamka like 'automaticky – práca v appke%' limit 1;
  if v_od is null or v_min < 1 then
    if v_id is not null then delete from public.dochadzka where id = v_id; end if;
    return 0;
  end if;
  if v_id is null then
    insert into public.dochadzka (osoba_id, datum, typ, miesto, prichod, odchod, prestavka_min, odpracovane_min, zdroj, poznamka)
      values (p_osoba, p_datum, 'praca', 'online', v_od, v_do, 0, v_min, 'import', 'automaticky – práca v appke');
  else
    update public.dochadzka set prichod = v_od, odchod = v_do, odpracovane_min = v_min, upravene = now() where id = v_id;
  end if;
  return v_min;
end $$;
revoke all on function public.aktivita_do_dochadzky(bigint, date) from public, anon, authenticated;

-- ping z appky (každú minútu, keď je appka na obrazovke a používateľ je aktívny)
create or replace function public.aktivita_ping(p_zariadenie text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_os bigint := public.rozpis_moja_osoba(); v_auto boolean; v_dnes date := public.dnes_sk(); v_id bigint; v_min int;
begin
  if v_os is null then return jsonb_build_object('ok', false, 'vypnute', true); end if;
  select auto_cas into v_auto from public.rozpis_osoby where id = v_os;
  if not coalesce(v_auto, false) then return jsonb_build_object('ok', false, 'vypnute', true); end if;
  select id into v_id from public.aktivita_useky
    where osoba_id = v_os and datum = v_dnes and koniec >= now() - interval '150 seconds'
    order by koniec desc limit 1 for update;
  if v_id is null then
    insert into public.aktivita_useky (osoba_id, datum, zaciatok, koniec, zariadenie) values (v_os, v_dnes, now(), now(), left(p_zariadenie, 120));
  else
    update public.aktivita_useky set koniec = now() where id = v_id;
  end if;
  v_min := public.aktivita_do_dochadzky(v_os, v_dnes);
  return jsonb_build_object('ok', true, 'dnes_min', v_min);
end $$;
revoke all on function public.aktivita_ping(text) from public, anon;
grant execute on function public.aktivita_ping(text) to authenticated;
