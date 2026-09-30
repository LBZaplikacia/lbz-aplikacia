-- =========================================================================
-- 46) OBJEDNÁVKY – celý rok 2026 v appke (v0.28.2) – 30. 9. 2026
--  a) obj_import_historia: jednorazový prenos starších objednávok z Upgates (len doplní chýbajúce, nič neprepíše)
--  b) furmanky_prirad: staré objednávky (> 75 dní, bez zaradenia) sa do furmaniek NEzaraďujú
--  c) obj_zoznam: počet nájdených + „načítať ďalšie“ (limit)
-- =========================================================================
create or replace function public.obj_import_historia(p_obj jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  create temp table if not exists _hist (x jsonb, cislo text primary key) on commit drop;
  truncate _hist;
  insert into _hist select distinct on (trim(x->>'cislo')) x, trim(x->>'cislo')
    from jsonb_array_elements(coalesce(p_obj, '[]'::jsonb)) x where coalesce(trim(x->>'cislo'), '') <> ''
      and not exists (select 1 from public.objednavky o where o.cislo = trim(x->>'cislo'))
    order by trim(x->>'cislo'), x->>'zmenena' desc nulls last;
  insert into public.objednavky (cislo, zdroj, status, meno, firma, telefon, email, ulica, psc, mesto, doprava, platba_nazov,
                                 platba, suma, faktura, poznamka, vytvorena, zmenena, stiahnuta, odber_oznameny)
  select s.cislo, 'upgates', s.x->>'status', s.x->>'meno', s.x->>'firma', s.x->>'telefon', s.x->>'email', s.x->>'ulica', s.x->>'psc', s.x->>'mesto',
         s.x->>'doprava', s.x->>'platba_nazov', s.x->>'platba', nullif(s.x->>'suma', '')::numeric, nullif(s.x->>'faktura', ''), nullif(s.x->>'poznamka', ''),
         nullif(s.x->>'vytvorena', '')::timestamptz, nullif(s.x->>'zmenena', '')::timestamptz, now(), now()
  from _hist s
  on conflict (cislo) do nothing;
  get diagnostics v_n = row_count;
  insert into public.objednavky_polozky (cislo, kod, nazov, mnozstvo, cena)
  select s.cislo, trim(i->>'kod'), max(i->>'nazov'), sum(coalesce(nullif(i->>'mnozstvo', '')::numeric, 0)), max(nullif(i->>'cena', '')::numeric)
  from _hist s cross join lateral jsonb_array_elements(coalesce(s.x->'polozky', '[]'::jsonb)) i
  where coalesce(trim(i->>'kod'), '') <> ''
  group by s.cislo, trim(i->>'kod')
  on conflict (cislo, kod) do nothing;
  update public.objednavky o set region = public.region_pre(o.doprava, o.mesto, o.psc) from _hist s where o.cislo = s.cislo;
  insert into public.furmanky_log (typ, ok, text, pocet) values ('import', true, 'Staršie objednávky z Upgates (história 2026): ' || v_n, v_n);
  return jsonb_build_object('ok', true, 'nove', v_n);
end $$;
revoke all on function public.obj_import_historia(jsonb) from public, anon, authenticated;
grant execute on function public.obj_import_historia(jsonb) to service_role;

-- staré objednávky (história) nechodia do furmaniek
create or replace function public.furmanky_prirad() returns int
language plpgsql set search_path = public as $$
declare r record; v_ciel bigint; v_n int := 0;
begin
  for r in
    select o.cislo, o.region, public.ziva_objednavka(o.status) as ziva, z.furmanka_id, coalesce(z.rucne, false) as rucne, f.stav as fstav
    from public.objednavky o
    left join public.zaradenia z on z.cislo = o.cislo
    left join public.furmanky f on f.id = z.furmanka_id
    where o.zdroj = 'upgates'
      and (z.cislo is not null or o.vytvorena is null or o.vytvorena >= now() - interval '75 days')
  loop
    continue when r.rucne;                                   -- ručné rozhodnutie má prednosť
    continue when r.fstav in ('full', 'rozvezena');          -- uzavretá furmanka sa už nemení
    if not r.ziva then
      delete from public.zaradenia where cislo = r.cislo;
      continue;
    end if;
    v_ciel := public.furmanka_pre_region(coalesce(r.region, 'NEZARADENÉ'));
    if r.furmanka_id is distinct from v_ciel then
      insert into public.zaradenia (cislo, furmanka_id, rucne, kedy) values (r.cislo, v_ciel, false, now())
        on conflict (cislo) do update set furmanka_id = excluded.furmanka_id, rucne = false, kedy = now();
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.obj_zoznam(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_text(coalesce(p->>'hladaj', '')); v_st text := nullif(p->>'stav', '');
  v_dop text := nullif(p->>'doprava', ''); v_pl text := nullif(p->>'platba', '');
  v_od date := nullif(p->>'od', '')::date; v_n int;
  v_lim int := least(greatest(coalesce(nullif(p->>'limit', '')::int, 300), 50), 3000); v_do date := nullif(p->>'do', '')::date;
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Objednávky nemáte povolené'); end if;
  select count(*) into v_n from public.objednavky o
      where (v = '' or public.norm_text(o.cislo) like '%' || v || '%' or public.norm_text(coalesce(o.meno,'')) like '%' || v || '%'
             or public.norm_text(coalesce(o.firma,'')) like '%' || v || '%' or public.norm_text(coalesce(o.email,'')) like '%' || v || '%'
             or (length(regexp_replace(v, '\D', '', 'g')) >= 4 and regexp_replace(coalesce(o.telefon, ''), '\D', '', 'g') like '%' || regexp_replace(v, '\D', '', 'g') || '%'))
        and (v_st is null or o.status = v_st)
        and (v_dop is null or o.doprava = v_dop)
        and (v_pl is null or o.platba_nazov = v_pl or o.platba = v_pl)
        and (coalesce((p->>'osobny')::boolean, false) = false or public.obj_je_osobny(o.doprava))
        and (v_od is null or o.vytvorena >= v_od) and (v_do is null or o.vytvorena < v_do + 1)
;
  return jsonb_build_object('ok', true, 'ostry', public.obj_ostry(), 'najdenych', v_n, 'limit', v_lim,
    'stavy', (select coalesce(jsonb_agg(distinct o.status), '[]') from public.objednavky o where o.status is not null and o.status <> ''),
    'dopravy', (select coalesce(jsonb_agg(distinct o.doprava), '[]') from public.objednavky o where o.doprava is not null and o.doprava <> ''),
    'platby', (select coalesce(jsonb_agg(distinct o.platba_nazov), '[]') from public.objednavky o where o.platba_nazov is not null and o.platba_nazov <> ''),
    'pocty', (select coalesce(jsonb_object_agg(s, n), '{}') from (select o.status s, count(*) n from public.objednavky o where o.status is not null and o.status <> '' group by o.status) q),
    'spolu', (select count(*) from public.objednavky),
    'farby', (select coalesce(jsonb_object_agg(c.nazov, c.data->>'farba'), '{}') from public.upgates_ciselnik c where c.typ = 'stav' and nullif(c.data->>'farba', '') is not null),
    'caka', (select count(*) from public.obj_fronta where stav = 'caka'),
    'objednavky', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('cislo', o.cislo, 'zdroj', o.zdroj, 'status', o.status, 'meno', coalesce(nullif(o.meno, ''), o.firma),
        'mesto', o.mesto, 'suma', o.suma, 'platba', o.platba, 'platba_nazov', o.platba_nazov, 'doprava', o.doprava, 'email', o.email, 'poznamka', o.poznamka,
        'poloziek', (select count(*) from public.objednavky_polozky p where p.cislo = o.cislo), 'vytvorena', o.vytvorena,
        'osobny', public.obj_je_osobny(o.doprava), 'faktura', o.faktura, 'dobropis', o.dobropis,
        'caka', (select count(*) from public.obj_fronta f where f.cislo = o.cislo and f.stav in ('caka','chyba')),
        'furmanka', (select public.furmanka_nazov(fu.region, fu.datum) from public.zaradenia z join public.furmanky fu on fu.id = z.furmanka_id where z.cislo = o.cislo)) x
      from public.objednavky o
      where (v = '' or public.norm_text(o.cislo) like '%' || v || '%' or public.norm_text(coalesce(o.meno,'')) like '%' || v || '%'
             or public.norm_text(coalesce(o.firma,'')) like '%' || v || '%' or public.norm_text(coalesce(o.email,'')) like '%' || v || '%'
             or (length(regexp_replace(v, '\D', '', 'g')) >= 4 and regexp_replace(coalesce(o.telefon, ''), '\D', '', 'g') like '%' || regexp_replace(v, '\D', '', 'g') || '%'))
        and (v_st is null or o.status = v_st)
        and (v_dop is null or o.doprava = v_dop)
        and (v_pl is null or o.platba_nazov = v_pl or o.platba = v_pl)
        and (coalesce((p->>'osobny')::boolean, false) = false or public.obj_je_osobny(o.doprava))
        and (v_od is null or o.vytvorena >= v_od) and (v_do is null or o.vytvorena < v_do + 1)
      order by o.vytvorena desc nulls last limit v_lim) q), '[]'));
end $$;
