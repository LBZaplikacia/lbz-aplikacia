-- =========================================================================
-- 52) SMS v Trase a Furmankách + odpovede zákazníkov (30. 9. 2026)
--     trasa_data: pri každej zastávke čas odoslanej SMS (deň vopred / cestou) a odpovede zákazníka
--     sms_odpovede_dnes: odpovede k dnešným rozvozom (úvodná stránka – furman, ZS, CEO, IT)
--     sms_cestou_dalsia: ďalšia zastávka, ktorej sa má poslať SMS „furman je na ceste“ (volá Edge Function gosms)
-- =========================================================================
create or replace function public.trasa_data(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.som_furman() then jsonb_build_object('ok', false, 'text', 'Nemáte prístup k trase') else
  jsonb_build_object('ok', true,
    'trasa', (select jsonb_build_object('id', f.id, 'nazov', public.furmanka_nazov(f.region, f.datum), 'datum', f.datum, 'region', f.region,
                'stav', t.stav, 'odchod', t.odchod, 'navrat', t.navrat, 'hodiny', t.hodiny, 'zacata', t.zacata, 'ukoncena', t.ukoncena)
              from public.trasy t join public.furmanky f on f.id = t.furmanka_id where t.furmanka_id = p_id),
    'zastavky', coalesce((select jsonb_agg(jsonb_build_object('cislo', s.cislo, 'poradie', s.poradie, 'eta', s.eta, 'bez_gps', s.bez_gps,
        'stav', s.stav, 'cas', s.cas, 'poznamka', s.poznamka, 'foto', s.foto, 'presun_datum', s.presun_datum,
        'meno', o.meno, 'firma', o.firma, 'telefon', o.telefon,
        'adresa', concat_ws(', ', nullif(o.ulica, ''), nullif(trim(concat_ws(' ', o.psc, o.mesto)), '')),
        'platba', coalesce(o.platba, 'DOBIERKA'), 'suma', o.suma, 'faktura', o.faktura,
        'pozn_obj', nullif(concat_ws(' | ', nullif(o.poznamka, ''), nullif(o.upozornenie, '')), ''),
        'kusy', (select coalesce(sum(p.mnozstvo), 0) from public.objednavky_polozky p where p.cislo = o.cislo),
        'balenie', (select b.stav from public.balenie b where b.cislo = o.cislo),
        'lat', g.lat, 'lng', g.lng,
        'sms_den', (select max(x.odoslane) from public.sms_odoslane x where x.cislo = s.cislo and x.furmanka_id = p_id and x.typ = 'den_vopred' and x.stav = 'odoslane'),
        'sms_cestou', (select max(x.odoslane) from public.sms_odoslane x where x.cislo = s.cislo and x.furmanka_id = p_id and x.typ = 'cestou' and x.stav = 'odoslane'),
        'odpovede', (select jsonb_agg(jsonb_build_object('text', r.text, 'prijata', r.prijata) order by r.prijata)
                     from public.sms_odpovede r where r.cislo = s.cislo and r.prijata > now() - interval '7 days'))
      order by s.poradie nulls last, s.cislo)
      from public.trasy_zastavky s join public.objednavky o on o.cislo = s.cislo
      left join public.geokody g on g.ok and g.adresa = concat_ws(', ', nullif(o.ulica, ''), nullif(trim(concat_ws(' ', o.psc, o.mesto)), ''))
      where s.furmanka_id = p_id), '[]'::jsonb)) end
$$;

create or replace function public.sms_odpovede_dnes() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.som_furman() then jsonb_build_object('ok', false) else
  jsonb_build_object('ok', true, 'odpovede', coalesce((select jsonb_agg(jsonb_build_object('cislo', r.cislo, 'text', r.text, 'prijata', r.prijata,
        'meno', coalesce(nullif(o.meno, ''), o.firma), 'telefon', r.telefon, 'furmanka', public.furmanka_nazov(f.region, f.datum), 'furmanka_id', f.id,
        'zastavka', (select s.stav from public.trasy_zastavky s where s.furmanka_id = f.id and s.cislo = r.cislo)) order by r.prijata desc)
      from public.sms_odpovede r
      join public.trasy_zastavky z on z.cislo = r.cislo
      join public.furmanky f on f.id = z.furmanka_id and f.datum = public.dnes_sk()
      left join public.objednavky o on o.cislo = r.cislo
      where r.prijata > now() - interval '3 days'), '[]'::jsonb)) end
$$;
revoke all on function public.sms_odpovede_dnes() from public, anon;
grant execute on function public.sms_odpovede_dnes() to authenticated;

-- ďalšia nevybavená zastávka bez SMS „cestou“ (len service_role – volá Edge Function gosms po overení furmana)
create or replace function public.sms_cestou_dalsia(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('ok', true, 'cislo', s.cislo, 'telefon', o.telefon, 'meno', coalesce(nullif(o.meno, ''), o.firma),
      'eta', now() + make_interval(mins => greatest(5, round(coalesce(s.jazda_min, 15))::int)),
      'dobierka', coalesce(o.platba, 'DOBIERKA') not in ('ZAPLATENÉ', 'NA FAKTÚRU'), 'suma', o.suma)
    from public.trasy_zastavky s join public.objednavky o on o.cislo = s.cislo
    join public.trasy t on t.furmanka_id = s.furmanka_id and t.stav <> 'ukoncena'
    where s.furmanka_id = p_id and s.stav = 'caka' and coalesce(o.telefon, '') <> ''
    order by s.poradie nulls last, s.cislo limit 1), jsonb_build_object('ok', false)) ||
    jsonb_build_object('uz', (select count(*) > 0 from public.sms_odoslane x
      where x.furmanka_id = p_id and x.typ = 'cestou' and x.stav = 'odoslane'
        and x.cislo = (select s.cislo from public.trasy_zastavky s join public.objednavky o on o.cislo = s.cislo
                       where s.furmanka_id = p_id and s.stav = 'caka' and coalesce(o.telefon, '') <> '' order by s.poradie nulls last, s.cislo limit 1)))
$$;
revoke all on function public.sms_cestou_dalsia(bigint) from public, anon, authenticated;
grant execute on function public.sms_cestou_dalsia(bigint) to service_role;

-- =========================================================================
-- Denný prehľad objednávok (ako Upgates) – CEO, IT, zákaznícky servis; rozšírené štatistiky len CEO a IT
-- =========================================================================
create or replace function public.obj_statistiky() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_rola text := public.moja_rola(); v_dnes date := public.dnes_sk(); v jsonb;
begin
  if coalesce(v_rola not in ('it','ceo','zakaznicky_servis'), true) then return jsonb_build_object('ok', false); end if;
  create temp table if not exists _st (cislo text, den date, suma numeric, doprava text, platba text, region text) on commit drop;
  truncate _st;
  insert into _st select o.cislo, (o.vytvorena at time zone 'Europe/Bratislava')::date, coalesce(o.suma, 0), o.doprava, coalesce(o.platba_nazov, o.platba), o.region
    from public.objednavky o
    where o.vytvorena >= (v_dnes - 730)::timestamp at time zone 'Europe/Bratislava' and not public.obj_je_storno(o.status) and o.zdroj <> 'rucna';
  v := jsonb_build_object('ok', true, 'dnes', v_dnes,
    'obdobia', (select jsonb_object_agg(k, x) from (
       select k, jsonb_build_object('pocet', count(*) filter (where den > v_dnes - n), 'trzba', coalesce(sum(suma) filter (where den > v_dnes - n), 0),
                                    'pocet_pred', count(*) filter (where den <= v_dnes - n and den > v_dnes - 2 * n),
                                    'trzba_pred', coalesce(sum(suma) filter (where den <= v_dnes - n and den > v_dnes - 2 * n), 0)) x
       from _st, (values ('1', 1), ('7', 7), ('30', 30), ('365', 365)) p(k, n) group by k) q),
    'vcera', (select jsonb_build_object('pocet', count(*), 'trzba', coalesce(sum(suma), 0)) from _st where den = v_dnes - 1),
    'tyzden_spat', (select jsonb_build_object('pocet', count(*), 'trzba', coalesce(sum(suma), 0)) from _st where den = v_dnes - 7),
    'dni', (select jsonb_agg(jsonb_build_object('d', d, 'pocet', (select count(*) from _st where den = d), 'trzba', (select coalesce(sum(suma), 0) from _st where den = d)) order by d)
            from generate_series(v_dnes - 13, v_dnes, interval '1 day') g(d0), lateral (select g.d0::date d) x));
  if v_rola in ('it','ceo') then
    v := v || jsonb_build_object(
      'mesiace', (select jsonb_agg(jsonb_build_object('m', m, 'pocet', p, 'trzba', t) order by m) from
                   (select to_char(den, 'YYYY-MM') m, count(*) p, sum(suma) t from _st where den > v_dnes - 400 group by 1) q),
      'produkty', (select jsonb_agg(jsonb_build_object('nazov', nazov, 'ks', ks, 'trzba', trzba) order by ks desc) from
                   (select coalesce(max(p.nazov), p.kod) nazov, sum(p.mnozstvo) ks, sum(p.mnozstvo * coalesce(p.cena, 0)) trzba
                    from public.objednavky_polozky p join _st s on s.cislo = p.cislo where s.den > v_dnes - 30
                    group by regexp_replace(p.kod, '-\d+$', ''), p.kod order by 2 desc limit 15) q),
      'doprava', (select jsonb_agg(jsonb_build_object('nazov', coalesce(doprava, '–'), 'pocet', p, 'trzba', t) order by p desc) from
                   (select doprava, count(*) p, sum(suma) t from _st where den > v_dnes - 30 group by 1) q),
      'platba', (select jsonb_agg(jsonb_build_object('nazov', coalesce(platba, '–'), 'pocet', p, 'trzba', t) order by p desc) from
                   (select platba, count(*) p, sum(suma) t from _st where den > v_dnes - 30 group by 1) q),
      'regiony', (select jsonb_agg(jsonb_build_object('nazov', coalesce(region, '–'), 'pocet', p, 'trzba', t) order by p desc) from
                   (select region, count(*) p, sum(suma) t from _st where den > v_dnes - 30 group by 1) q));
  end if;
  return v;
end $$;
revoke all on function public.obj_statistiky() from public, anon;
grant execute on function public.obj_statistiky() to authenticated;
