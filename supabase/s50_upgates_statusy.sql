-- =========================================================================
-- 50) OSTRÝ ŠTART – statusy z Furmaniek a Trasy do Upgates (1. 10. 2026)
--     Naplánované → Naplanovane (24, Upgates pošle e-mail „Doručujeme vašu objednávku“), pôvodný status si appka zapamätá
--     Vrátiť statusy → pôvodný status
--     Trasa: Doručené → Rozvezene (17) / NA FAKTÚRU → Na faktúru (22); Nedoručené → pôvodný status; späť na „čaká“ → Naplanovane
--     Zápis ide cez frontu obj_fronta; plánovač každých 5 min odošle čakajúce zmeny (1 požiadavka na Upgates na dávku).
-- =========================================================================
alter table public.zaradenia add column if not exists povodny_status_id text;

-- interná: zmena statusu objednávky + fronta do Upgates (bez kontroly roly – volajú ju len funkcie nižšie)
create or replace function public.obj_stav_fronta(p_cislo text, p_kod text, p_dovod text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o public.objednavky; v_nazov text;
begin
  select * into o from public.objednavky where cislo = p_cislo;
  if o.cislo is null or coalesce(o.zdroj, '') = 'rucna' or o.cislo like 'APP-%' then return false; end if;
  if public.obj_je_storno(o.status) then return false; end if;
  select nazov into v_nazov from public.upgates_ciselnik where typ = 'stav' and kod = p_kod;
  if v_nazov is null then return false; end if;
  if o.status is not distinct from v_nazov then return false; end if;
  update public.objednavky set status = v_nazov, upravil = auth.uid(), upravena = now() where cislo = p_cislo;
  -- staršia čakajúca zmena statusu tej istej objednávky sa nahradí novou
  delete from public.obj_fronta where cislo = p_cislo and typ = 'stav' and stav in ('caka', 'chyba');
  insert into public.obj_fronta (cislo, typ, data) values (p_cislo, 'stav', jsonb_build_object('status_id', p_kod, 'status', v_nazov));
  perform public.obj_zapis_log(p_cislo, 'stav → ' || v_nazov || ' (' || p_dovod || ')');
  return true;
end $$;
revoke all on function public.obj_stav_fronta(text, text, text) from public, anon, authenticated;

create or replace function public.furmanka_naplanovana(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record; v_n int := 0;
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  if not exists (select 1 from public.trasy where furmanka_id = p_id) then
    return jsonb_build_object('ok', false, 'text', 'Najprv vytvorte trasu pre furmana (čas odchodu) – podľa nej sa pripravia SMS pre zákazníkov.');
  end if;
  update public.furmanky set naplanovane = now(), naplanoval = auth.uid() where id = p_id;
  for v in select z.cislo, o.status from public.zaradenia z join public.objednavky o on o.cislo = z.cislo
           where z.furmanka_id = p_id and not public.obj_je_storno(o.status) loop
    update public.zaradenia set povodny_status_id = coalesce(povodny_status_id,
        (select kod from public.upgates_ciselnik where typ = 'stav' and nazov = v.status and kod <> '24' limit 1))
      where cislo = v.cislo;
    if public.obj_stav_fronta(v.cislo, '24', 'Naplánované vo furmanke') then v_n := v_n + 1; end if;
  end loop;
  insert into public.furmanky_log (typ, kto, text, pocet) select 'naplanovane', auth.uid(),
    public.furmanka_nazov(region, datum) || ' – Naplánované, do Upgates objednávok: ' || v_n, v_n from public.furmanky where id = p_id;
  return jsonb_build_object('ok', true, 'text', 'Naplánované – do Upgates sa do 5 minút zapíše objednávok: ' || v_n || ' (zákazníci dostanú e-mail)');
end $$;

create or replace function public.furmanka_vrat_statusy(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record; v_n int := 0;
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  update public.furmanky set naplanovane = null, naplanoval = null where id = p_id;
  -- len objednávky, ktoré sú ešte „Naplanovane“ (doručené / zmenené ručne sa nevracajú)
  for v in select z.cislo, z.povodny_status_id from public.zaradenia z join public.objednavky o on o.cislo = z.cislo
           where z.furmanka_id = p_id and z.povodny_status_id is not null
             and o.status = (select nazov from public.upgates_ciselnik where typ = 'stav' and kod = '24') loop
    if public.obj_stav_fronta(v.cislo, v.povodny_status_id, 'vrátené statusy') then v_n := v_n + 1; end if;
    update public.zaradenia set povodny_status_id = null where cislo = v.cislo;
  end loop;
  insert into public.furmanky_log (typ, kto, text, pocet) select 'vratene', auth.uid(),
    public.furmanka_nazov(region, datum) || ' – statusy vrátené, do Upgates objednávok: ' || v_n, v_n from public.furmanky where id = p_id;
  return jsonb_build_object('ok', true, 'text', 'Statusy vrátené – do Upgates sa zapíše objednávok: ' || v_n);
end $$;

create or replace function public.trasa_zastavka(p_id bigint, p_cislo text, p_stav text default null, p_poznamka text default null,
                                                 p_presun_datum date default null, p_foto text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t public.trasy%rowtype; v_stary text; v_platba text; v_pov text;
begin
  if not public.som_furman() then return jsonb_build_object('ok', false, 'text', 'Nemáte prístup k trase'); end if;
  select * into v_t from public.trasy where furmanka_id = p_id;
  if not found then return jsonb_build_object('ok', false, 'text', 'Trasa neexistuje'); end if;
  if v_t.stav = 'ukoncena' then return jsonb_build_object('ok', false, 'text', 'Rozvoz je už ukončený'); end if;
  if p_stav is not null and p_stav not in ('caka','dorucene','nedorucene') then return jsonb_build_object('ok', false, 'text', 'Neznámy stav'); end if;
  select stav into v_stary from public.trasy_zastavky where furmanka_id = p_id and cislo = p_cislo;
  update public.trasy_zastavky set
      stav = coalesce(p_stav, stav),
      cas = case when p_stav is null then cas when p_stav = 'caka' then null else now() end,
      poznamka = case when p_poznamka is null then poznamka else nullif(trim(p_poznamka), '') end,
      presun_datum = case when p_stav = 'nedorucene' then p_presun_datum when p_stav is not null then null else presun_datum end,
      foto = coalesce(p_foto, foto)
    where furmanka_id = p_id and cislo = p_cislo;
  if not found then return jsonb_build_object('ok', false, 'text', 'Objednávka nie je v tejto trase'); end if;
  if v_t.stav = 'naplanovana' then update public.trasy set stav = 'na_ceste', zacata = now() where furmanka_id = p_id; end if;
  -- status do Upgates len pri skutočnej zmene
  if p_stav is not null and p_stav is distinct from v_stary then
    select platba into v_platba from public.objednavky where cislo = p_cislo;
    select povodny_status_id into v_pov from public.zaradenia where cislo = p_cislo;
    if p_stav = 'dorucene' then
      perform public.obj_stav_fronta(p_cislo, case when v_platba = 'NA FAKTÚRU' then '22' else '17' end, 'furman: doručené');
    elsif p_stav = 'nedorucene' then
      if v_pov is not null then perform public.obj_stav_fronta(p_cislo, v_pov, 'furman: nedoručené'); end if;
      update public.zaradenia set povodny_status_id = null where cislo = p_cislo;
    elsif p_stav = 'caka' and exists (select 1 from public.furmanky where id = p_id and naplanovane is not null) then
      perform public.obj_stav_fronta(p_cislo, '24', 'furman: zrušené označenie');
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- plánovač: každých 5 minút odošle čakajúce zmeny do Upgates (len ak nejaké čakajú a je zapnutý ostrý zápis)
select cron.unschedule(jobid) from cron.job where jobname = 'upgates-zapis';
select cron.schedule('upgates-zapis', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://ykwiqsneroxzpkwpadie.supabase.co/functions/v1/upgates-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-lbz-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'furmanky_cron')),
    body := '{"akcia":"zapis"}'::jsonb,
    timeout_milliseconds := 60000)
  where public.obj_ostry() and exists (select 1 from public.obj_fronta where stav = 'caka')
$cron$);
