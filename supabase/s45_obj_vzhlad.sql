-- =========================================================================
-- 45) OBJEDNÁVKY – zoznam ako v Upgates: záložky stavov s počtami, farby stavov, počet položiek (v0.28.0) – 30. 9. 2026
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
      order by o.vytvorena desc nulls last limit 300) q), '[]'));
end $$;

-- sťahovanie z Upgates: plné o 6:00, inak každých 30 min (6:00–21:00) len ZMENENÉ objednávky – šetrí API limit (60/h, 900/deň)
select cron.unschedule(jobid) from cron.job where jobname = 'furmanky-upgates';
select cron.schedule('furmanky-upgates', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://ykwiqsneroxzpkwpadie.supabase.co/functions/v1/upgates-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-lbz-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'furmanky_cron')),
    body := '{"akcia":"sync"}'::jsonb,
    timeout_milliseconds := 150000)
$cron$);
