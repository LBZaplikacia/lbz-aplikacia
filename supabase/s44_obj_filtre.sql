-- =========================================================================
-- 44) OBJEDNÁVKY – filter podľa dopravy a platby (v0.27.1) – 30. 9. 2026
-- =========================================================================
create or replace function public.obj_zoznam(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_text(coalesce(p->>'hladaj', '')); v_st text := nullif(p->>'stav', '');
  v_dop text := nullif(p->>'doprava', ''); v_pl text := nullif(p->>'platba', '');
  v_od date := nullif(p->>'od', '')::date; v_do date := nullif(p->>'do', '')::date;
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Objednávky nemáte povolené'); end if;
  return jsonb_build_object('ok', true, 'ostry', public.obj_ostry(),
    'stavy', (select coalesce(jsonb_agg(distinct o.status), '[]') from public.objednavky o where o.status is not null and o.status <> ''),
    'dopravy', (select coalesce(jsonb_agg(distinct o.doprava), '[]') from public.objednavky o where o.doprava is not null and o.doprava <> ''),
    'platby', (select coalesce(jsonb_agg(distinct o.platba), '[]') from public.objednavky o where o.platba is not null and o.platba <> ''),
    'caka', (select count(*) from public.obj_fronta where stav = 'caka'),
    'objednavky', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('cislo', o.cislo, 'zdroj', o.zdroj, 'status', o.status, 'meno', coalesce(nullif(o.meno, ''), o.firma),
        'mesto', o.mesto, 'suma', o.suma, 'platba', o.platba, 'doprava', o.doprava, 'vytvorena', o.vytvorena,
        'osobny', public.obj_je_osobny(o.doprava), 'faktura', o.faktura, 'dobropis', o.dobropis,
        'caka', (select count(*) from public.obj_fronta f where f.cislo = o.cislo and f.stav in ('caka','chyba')),
        'furmanka', (select public.furmanka_nazov(fu.region, fu.datum) from public.zaradenia z join public.furmanky fu on fu.id = z.furmanka_id where z.cislo = o.cislo)) x
      from public.objednavky o
      where (v = '' or public.norm_text(o.cislo) like '%' || v || '%' or public.norm_text(coalesce(o.meno,'')) like '%' || v || '%'
             or public.norm_text(coalesce(o.firma,'')) like '%' || v || '%' or public.norm_text(coalesce(o.email,'')) like '%' || v || '%'
             or (length(regexp_replace(v, '\D', '', 'g')) >= 4 and regexp_replace(coalesce(o.telefon, ''), '\D', '', 'g') like '%' || regexp_replace(v, '\D', '', 'g') || '%'))
        and (v_st is null or o.status = v_st)
        and (v_dop is null or o.doprava = v_dop)
        and (v_pl is null or o.platba = v_pl)
        and (coalesce((p->>'osobny')::boolean, false) = false or public.obj_je_osobny(o.doprava))
        and (v_od is null or o.vytvorena >= v_od) and (v_do is null or o.vytvorena < v_do + 1)
      order by o.vytvorena desc nulls last limit 300) q), '[]'));
end $$;
