-- =========================================================================
-- 43) OBJEDNÁVKY V APPKE (v0.27) – 30. 9. 2026
--   Správa objednávok z Upgates priamo v appke (e-shop, CEO, IT). Upgates ostáva miestom účtovných dokladov:
--   faktúry, dobropisy, platby. Appka zmeny zapisuje do Upgates cez frontu (obj_fronta) v dávkach
--   (tarif Bronze: 10 požiadaviek/h, 100/deň). Kým nie je zapnutý ostrý režim, fronta sa len „odsimuluje“.
--   Storno je dovolené až keď appka v Upgates našla dobropis k objednávke.
--   Osobný odber: upozornenie prevádzke a ľuďom so smenou v ten deň + karta na Prehľade.
-- =========================================================================
alter table public.objednavky add column if not exists dobropis text;
alter table public.objednavky add column if not exists dobropis_overeny timestamptz;
alter table public.objednavky add column if not exists odber_oznameny timestamptz;
alter table public.objednavky drop constraint if exists objednavky_zdroj_check;
alter table public.objednavky add constraint objednavky_zdroj_check check (zdroj in ('upgates','rucna','appka'));
create sequence if not exists public.appka_objednavky_seq;

create table if not exists public.app_nastavenie (
  kluc     text primary key,
  hodnota  jsonb,
  upravil  uuid,
  upravene timestamptz not null default now()
);
alter table public.app_nastavenie enable row level security;
insert into public.app_nastavenie (kluc, hodnota) values ('upgates_zapis_ostry', 'false') on conflict do nothing;

-- číselníky z Upgates (stavy, dopravy, platby) – sťahuje Edge Function, aby sa nešetrilo limitom
create table if not exists public.upgates_ciselnik (
  typ      text not null check (typ in ('stav','doprava','platba')),
  kod      text not null,
  nazov    text not null,
  data     jsonb,
  stiahnute timestamptz not null default now(),
  primary key (typ, kod)
);
alter table public.upgates_ciselnik enable row level security;

create table if not exists public.obj_fronta (
  id        bigint generated always as identity primary key,
  cislo     text not null,
  typ       text not null check (typ in ('uprava','stav','nova')),
  data      jsonb not null,
  stav      text not null default 'caka' check (stav in ('caka','test','odoslane','chyba')),
  chyba     text,
  kto       uuid default auth.uid(),
  vytvorene timestamptz not null default now(),
  odoslane  timestamptz
);
create index if not exists obj_fronta_stav on public.obj_fronta (stav, id);
alter table public.obj_fronta enable row level security;

create table if not exists public.obj_log (
  id    bigint generated always as identity primary key,
  cislo text not null,
  cas   timestamptz not null default now(),
  kto   uuid default auth.uid(),
  ucet  text,
  text  text not null
);
create index if not exists obj_log_cislo on public.obj_log (cislo, cas desc);
alter table public.obj_log enable row level security;
grant select, insert, update, delete on public.app_nastavenie, public.upgates_ciselnik, public.obj_fronta, public.obj_log to service_role;

create or replace function public.obj_smiem() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.moja_rola() in ('it','ceo','zakaznicky_servis'), false) $$;
create or replace function public.obj_ostry() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select hodnota::text = 'true' from public.app_nastavenie where kluc = 'upgates_zapis_ostry'), false)
$$;
create or replace function public.obj_zapis_log(p_cislo text, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into public.obj_log (cislo, kto, ucet, text) values (p_cislo, auth.uid(), (select email from public.profily where id = auth.uid()), p_text)
$$;
create or replace function public.obj_je_osobny(p_doprava text) returns boolean
language sql immutable as $$ select public.norm_text(coalesce(p_doprava, '')) like '%osobn%' $$;
create or replace function public.obj_je_storno(p_status text) returns boolean
language sql immutable as $$ select public.norm_text(coalesce(p_status, '')) like '%storn%' $$;

-- zoznam: p = {hladaj, stav, osobny, len_otvorene, od, do}
create or replace function public.obj_zoznam(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_text(coalesce(p->>'hladaj', '')); v_st text := nullif(p->>'stav', '');
  v_od date := nullif(p->>'od', '')::date; v_do date := nullif(p->>'do', '')::date;
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Objednávky nemáte povolené'); end if;
  return jsonb_build_object('ok', true, 'ostry', public.obj_ostry(),
    'stavy', (select coalesce(jsonb_agg(distinct o.status), '[]') from public.objednavky o where o.status is not null and o.status <> ''),
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
        and (coalesce((p->>'osobny')::boolean, false) = false or public.obj_je_osobny(o.doprava))
        and (v_od is null or o.vytvorena >= v_od) and (v_do is null or o.vytvorena < v_do + 1)
      order by o.vytvorena desc nulls last limit 300) q), '[]'));
end $$;

create or replace function public.obj_detail(p_cislo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.objednavky;
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Objednávky nemáte povolené'); end if;
  select * into o from public.objednavky where cislo = p_cislo;
  if o.cislo is null then return jsonb_build_object('ok', false, 'text', 'Objednávka sa nenašla'); end if;
  return jsonb_build_object('ok', true, 'ostry', public.obj_ostry(), 'objednavka', to_jsonb(o) || jsonb_build_object('osobny', public.obj_je_osobny(o.doprava)),
    'polozky', coalesce((select jsonb_agg(to_jsonb(p) order by p.nazov) from public.objednavky_polozky p where p.cislo = p_cislo), '[]'),
    'fronta', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'typ', f.typ, 'stav', f.stav, 'chyba', f.chyba, 'data', f.data, 'vytvorene', f.vytvorene, 'odoslane', f.odoslane) order by f.id desc)
                        from public.obj_fronta f where f.cislo = p_cislo), '[]'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('cas', l.cas, 'ucet', l.ucet, 'text', l.text) order by l.cas desc) from (select * from public.obj_log where cislo = p_cislo order by cas desc limit 50) l), '[]'),
    'stavy', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'stav'), '[]'),
    'dopravy', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'doprava'), '[]'),
    'platby', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'platba'), '[]'));
end $$;

-- úprava: p = {meno, firma, telefon, email, ulica, psc, mesto, poznamka, doprava_kod, platba_kod, polozky: [{kod, nazov, mnozstvo, cena}]}
create or replace function public.obj_uprav(p_cislo text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.objednavky; v_zmeny jsonb := '{}'; k text; v_text text[] := '{}'; v_polia text[] := '{}';
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  select * into o from public.objednavky where cislo = p_cislo for update;
  if o.cislo is null then return jsonb_build_object('ok', false, 'text', 'Objednávka sa nenašla'); end if;
  if public.obj_je_storno(o.status) then return jsonb_build_object('ok', false, 'text', 'Stornovanú objednávku už nemožno meniť'); end if;
  foreach k in array array['meno','firma','telefon','email','ulica','psc','mesto','poznamka'] loop
    if p ? k and coalesce(p->>k, '') is distinct from coalesce(to_jsonb(o)->>k, '') then
      v_zmeny := v_zmeny || jsonb_build_object(k, p->>k); v_text := v_text || k;
      v_polia := v_polia || case when k in ('ulica','psc','mesto') then 'adresa' when k = 'firma' then 'meno' else k end;
    end if;
  end loop;
  if nullif(p->>'doprava_kod', '') is not null then
    v_zmeny := v_zmeny || jsonb_build_object('doprava_kod', p->>'doprava_kod'); v_text := v_text || 'doprava'::text;
    update public.objednavky set doprava = coalesce((select nazov from public.upgates_ciselnik where typ = 'doprava' and kod = p->>'doprava_kod'), doprava) where cislo = p_cislo;
  end if;
  if nullif(p->>'platba_kod', '') is not null then
    v_zmeny := v_zmeny || jsonb_build_object('platba_kod', p->>'platba_kod'); v_text := v_text || 'platba'::text; v_polia := v_polia || 'platba'::text;
    update public.objednavky set platba_nazov = coalesce((select nazov from public.upgates_ciselnik where typ = 'platba' and kod = p->>'platba_kod'), platba_nazov) where cislo = p_cislo;
  end if;
  if p ? 'polozky' then
    delete from public.objednavky_polozky where cislo = p_cislo;
    insert into public.objednavky_polozky (cislo, kod, nazov, mnozstvo, cena)
      select p_cislo, x->>'kod', x->>'nazov', (x->>'mnozstvo')::numeric, nullif(x->>'cena', '')::numeric
      from jsonb_array_elements(p->'polozky') x where coalesce((x->>'mnozstvo')::numeric, 0) > 0 and nullif(x->>'kod', '') is not null
      on conflict (cislo, kod) do update set mnozstvo = excluded.mnozstvo, nazov = excluded.nazov, cena = excluded.cena;
    v_zmeny := v_zmeny || jsonb_build_object('polozky', p->'polozky'); v_text := v_text || 'položky'::text; v_polia := v_polia || array['polozky','suma'];
    update public.objednavky set suma = (select sum(mnozstvo * coalesce(cena, 0)) from public.objednavky_polozky where cislo = p_cislo) where cislo = p_cislo
      and exists (select 1 from public.objednavky_polozky where cislo = p_cislo and cena is not null);
  end if;
  if v_zmeny = '{}'::jsonb then return jsonb_build_object('ok', true, 'text', 'Bez zmeny'); end if;
  update public.objednavky set
    meno = coalesce(v_zmeny->>'meno', meno), firma = coalesce(v_zmeny->>'firma', firma), telefon = coalesce(v_zmeny->>'telefon', telefon),
    email = coalesce(v_zmeny->>'email', email), ulica = coalesce(v_zmeny->>'ulica', ulica), psc = coalesce(v_zmeny->>'psc', psc),
    mesto = coalesce(v_zmeny->>'mesto', mesto), poznamka = coalesce(v_zmeny->>'poznamka', poznamka),
    rucne_polia = (select array_agg(distinct x) from unnest(rucne_polia || v_polia) x), upravil = auth.uid(), upravena = now()
  where cislo = p_cislo;
  insert into public.obj_fronta (cislo, typ, data) values (p_cislo, case when o.zdroj = 'appka' and exists (select 1 from public.obj_fronta where cislo = p_cislo and typ = 'nova' and stav <> 'odoslane') then 'nova' else 'uprava' end, v_zmeny);
  perform public.obj_zapis_log(p_cislo, 'úprava: ' || array_to_string(v_text, ', '));
  return jsonb_build_object('ok', true, 'text', case when public.obj_ostry() then 'Uložené – odošle sa do Upgates' else 'Uložené (testovací režim – do Upgates sa zatiaľ nezapíše)' end);
end $$;

-- zmena stavu; storno len s overeným dobropisom
create or replace function public.obj_stav(p_cislo text, p_kod text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.objednavky; v_nazov text;
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  select * into o from public.objednavky where cislo = p_cislo for update;
  if o.cislo is null then return jsonb_build_object('ok', false, 'text', 'Objednávka sa nenašla'); end if;
  select nazov into v_nazov from public.upgates_ciselnik where typ = 'stav' and kod = p_kod;
  if v_nazov is null then return jsonb_build_object('ok', false, 'text', 'Neznámy stav – obnovte zoznam stavov z Upgates'); end if;
  if public.obj_je_storno(v_nazov) and o.zdroj <> 'appka' and nullif(o.faktura, '') is not null and nullif(o.dobropis, '') is null then
    return jsonb_build_object('ok', false, 'dobropis', true,
      'text', 'Najprv vystavte v Upgates dobropis k faktúre ' || o.faktura || ' a potom ťuknite „Skontrolovať dobropis“. Až potom sa dá dať Storno.');
  end if;
  update public.objednavky set status = v_nazov, upravil = auth.uid(), upravena = now() where cislo = p_cislo;
  insert into public.obj_fronta (cislo, typ, data) values (p_cislo, 'stav', jsonb_build_object('status_id', p_kod, 'status', v_nazov));
  perform public.obj_zapis_log(p_cislo, 'stav → ' || v_nazov);
  return jsonb_build_object('ok', true, 'text', 'Stav: ' || v_nazov || case when public.obj_ostry() then '' else ' (testovací režim)' end);
end $$;

-- nová objednávka: p = {meno, firma, telefon, email, ulica, psc, mesto, poznamka, doprava_kod, platba_kod, polozky}
create or replace function public.obj_nova(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cislo text := 'APP-' || nextval('public.appka_objednavky_seq');
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  if coalesce(trim(p->>'meno'), '') = '' and coalesce(trim(p->>'firma'), '') = '' then return jsonb_build_object('ok', false, 'text', 'Chýba meno zákazníka'); end if;
  if coalesce(jsonb_array_length(p->'polozky'), 0) = 0 then return jsonb_build_object('ok', false, 'text', 'Pridajte aspoň jednu položku'); end if;
  if nullif(p->>'doprava_kod', '') is null or nullif(p->>'platba_kod', '') is null then return jsonb_build_object('ok', false, 'text', 'Vyberte dopravu a platbu'); end if;
  insert into public.objednavky (cislo, zdroj, status, meno, firma, telefon, email, ulica, psc, mesto, poznamka, doprava, platba_nazov, platba, vytvorena, upravil, upravena)
  values (v_cislo, 'appka', 'Nová – čaká na Upgates', p->>'meno', p->>'firma', p->>'telefon', p->>'email', p->>'ulica', p->>'psc', p->>'mesto', p->>'poznamka',
    (select nazov from public.upgates_ciselnik where typ = 'doprava' and kod = p->>'doprava_kod'),
    (select nazov from public.upgates_ciselnik where typ = 'platba' and kod = p->>'platba_kod'),
    case when public.norm_text((select nazov from public.upgates_ciselnik where typ = 'platba' and kod = p->>'platba_kod')) like '%faktur%' then 'NA FAKTÚRU' else 'DOBIERKA' end,
    now(), auth.uid(), now());
  insert into public.objednavky_polozky (cislo, kod, nazov, mnozstvo, cena)
    select v_cislo, x->>'kod', x->>'nazov', (x->>'mnozstvo')::numeric, nullif(x->>'cena', '')::numeric
    from jsonb_array_elements(p->'polozky') x where coalesce((x->>'mnozstvo')::numeric, 0) > 0 and nullif(x->>'kod', '') is not null
    on conflict do nothing;
  update public.objednavky set suma = (select sum(mnozstvo * coalesce(cena, 0)) from public.objednavky_polozky where cislo = v_cislo) where cislo = v_cislo;
  insert into public.obj_fronta (cislo, typ, data) values (v_cislo, 'nova', p);
  perform public.obj_zapis_log(v_cislo, 'nová objednávka založená v appke');
  return jsonb_build_object('ok', true, 'cislo', v_cislo,
    'text', case when public.obj_ostry() then 'Objednávka založená – vytvorí sa v Upgates' else 'Objednávka založená (testovací režim – v Upgates sa zatiaľ nevytvorí)' end);
end $$;

create or replace function public.obj_ostry_nastav(p_ostry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.moja_rola() not in ('it','ceo'), true) then return jsonb_build_object('ok', false, 'text', 'Prepnúť môže len CEO alebo IT'); end if;
  insert into public.app_nastavenie (kluc, hodnota, upravil, upravene) values ('upgates_zapis_ostry', to_jsonb(p_ostry), auth.uid(), now())
    on conflict (kluc) do update set hodnota = excluded.hodnota, upravil = excluded.upravil, upravene = now();
  return jsonb_build_object('ok', true, 'text', case when p_ostry then 'Ostrý zápis do Upgates ZAPNUTÝ' else 'Testovací režim – do Upgates sa nezapisuje' end);
end $$;

-- osobné odbery pre prevádzku a ľudí so smenou dnes (karta na Prehľade)
create or replace function public.osobne_odbery() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rola text := public.moja_rola(); v_os bigint := public.rozpis_moja_osoba();
begin
  if not (v_rola in ('it','ceo','zakaznicky_servis','prevadzka','prevadzkar')
          or (v_os is not null and exists (select 1 from public.rozpis_miesta where osoba_id = v_os and datum = public.dnes_sk()))) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'odbery', coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('cislo', o.cislo, 'meno', coalesce(nullif(o.meno, ''), o.firma), 'telefon', o.telefon, 'suma', o.suma, 'platba', o.platba,
      'status', o.status, 'poznamka', o.poznamka, 'vytvorena', o.vytvorena,
      'polozky', coalesce((select jsonb_agg(jsonb_build_object('nazov', coalesce(p.nazov, p.kod), 'ks', p.mnozstvo)) from public.objednavky_polozky p where p.cislo = o.cislo), '[]')) x
    from public.objednavky o
    where public.obj_je_osobny(o.doprava) and o.vytvorena > now() - interval '21 days'
      and not public.obj_je_storno(o.status)
      and public.norm_text(coalesce(o.status, '')) not similar to '%(rozvezen|vybaven|dorucen|odovzdan|uzavret)%'
    order by o.vytvorena) q), '[]'));
end $$;

revoke all on function public.obj_smiem(), public.obj_ostry(), public.obj_zapis_log(text, text), public.obj_zoznam(jsonb), public.obj_detail(text),
  public.obj_uprav(text, jsonb), public.obj_stav(text, text), public.obj_nova(jsonb), public.obj_ostry_nastav(boolean), public.osobne_odbery() from public, anon;
grant execute on function public.obj_zoznam(jsonb), public.obj_detail(text), public.obj_uprav(text, jsonb), public.obj_stav(text, text),
  public.obj_nova(jsonb), public.obj_ostry_nastav(boolean), public.osobne_odbery() to authenticated;
grant execute on function public.obj_ostry(), public.obj_je_osobny(text), public.obj_je_storno(text) to authenticated, service_role;

-- modul Objednávky: e-shop (zákaznícky servis), CEO, IT – prevádzka nie
update public.moduly set aktivny = true, nazov = 'Objednávky' where kod = 'objednavky';
delete from public.pristupy where modul = 'objednavky' and rola not in ('it','ceo','zakaznicky_servis');
insert into public.pristupy (rola, modul, uprava) values ('it','objednavky',true), ('ceo','objednavky',true), ('zakaznicky_servis','objednavky',true)
  on conflict (rola, modul) do update set uprava = true;

-- ---------- pre Edge Function upgates-sync (len service_role) ----------
create or replace function public.obj_fronta_na_odoslanie() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ostry', public.obj_ostry(), 'polozky', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'cislo', f.cislo, 'typ', f.typ, 'data', f.data,
      'objednavka', (select to_jsonb(o) from public.objednavky o where o.cislo = f.cislo),
      'produkty', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.objednavky_polozky p where p.cislo = f.cislo)) order by f.id)
    from public.obj_fronta f where f.stav in ('caka','chyba')), '[]'))
$$;
-- p = [{id, stav: odoslane|chyba|test, chyba?, nahlad?}]
create or replace function public.obj_fronta_vysledok(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare x jsonb;
begin
  for x in select * from jsonb_array_elements(p) loop
    update public.obj_fronta set stav = x->>'stav', chyba = x->>'chyba', odoslane = case when x->>'stav' in ('odoslane','test') then now() else odoslane end,
      data = case when x ? 'nahlad' then data || jsonb_build_object('nahlad', x->'nahlad') else data end
    where id = (x->>'id')::bigint;
    if x->>'stav' = 'odoslane' then
      update public.objednavky o set rucne_polia = '{}' where o.cislo = (select cislo from public.obj_fronta where id = (x->>'id')::bigint)
        and not exists (select 1 from public.obj_fronta f where f.cislo = o.cislo and f.stav in ('caka','chyba'));
    end if;
    insert into public.obj_log (cislo, ucet, text) select cislo, 'upgates',
      case x->>'stav' when 'odoslane' then 'zapísané do Upgates (' || typ || ')' when 'test' then 'testovací režim – do Upgates by sa zapísalo (' || typ || ')'
                      else 'chyba zápisu do Upgates: ' || coalesce(x->>'chyba', '') end
      from public.obj_fronta where id = (x->>'id')::bigint;
  end loop;
end $$;
-- nová objednávka dostala v Upgates číslo → premenovať APP-x na skutočné číslo
create or replace function public.obj_prepis_cislo(p_stare text, p_nove text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.objednavky where cislo = p_nove) then
    insert into public.objednavky
      select (jsonb_populate_record(null::public.objednavky, to_jsonb(o) || jsonb_build_object('cislo', p_nove, 'zdroj', 'upgates', 'status', 'Prijatá', 'rucne_polia', '{}'::text[]))).*
      from public.objednavky o where o.cislo = p_stare;
    update public.objednavky_polozky set cislo = p_nove where cislo = p_stare;
    update public.zaradenia set cislo = p_nove where cislo = p_stare;
  end if;
  delete from public.objednavky where cislo = p_stare;
  update public.obj_fronta set cislo = p_nove where cislo = p_stare;
  update public.obj_log set cislo = p_nove where cislo = p_stare;
end $$;
create or replace function public.obj_ciselnik_uloz(p_typ text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.upgates_ciselnik where typ = p_typ;
  insert into public.upgates_ciselnik (typ, kod, nazov, data)
    select p_typ, x->>'kod', x->>'nazov', x->'data' from jsonb_array_elements(p) x where nullif(x->>'kod', '') is not null and nullif(x->>'nazov', '') is not null
    on conflict (typ, kod) do update set nazov = excluded.nazov, data = excluded.data, stiahnute = now();
  get diagnostics n = row_count; return n;
end $$;
create or replace function public.obj_dobropis_uloz(p_cislo text, p_dobropis text) returns void
language sql security definer set search_path = public as $$
  update public.objednavky set dobropis = nullif(p_dobropis, ''), dobropis_overeny = now() where cislo = p_cislo;
  insert into public.obj_log (cislo, ucet, text) values (p_cislo, 'upgates', coalesce('dobropis nájdený: ' || nullif(p_dobropis, ''), 'dobropis v Upgates nenájdený'));
$$;
revoke all on function public.obj_fronta_na_odoslanie(), public.obj_fronta_vysledok(jsonb), public.obj_prepis_cislo(text, text),
  public.obj_ciselnik_uloz(text, jsonb), public.obj_dobropis_uloz(text, text) from public, anon, authenticated;
grant execute on function public.obj_fronta_na_odoslanie(), public.obj_fronta_vysledok(jsonb), public.obj_prepis_cislo(text, text),
  public.obj_ciselnik_uloz(text, jsonb), public.obj_dobropis_uloz(text, text) to service_role;

-- produkty na výber pri novej objednávke / úprave: šablóna furmaniek + posledná cena z objednávok
create or replace function public.obj_produkty() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.obj_smiem() then coalesce((select jsonb_agg(x order by x->>'nazov') from (
    select jsonb_build_object('kod', k.kod, 'nazov', coalesce(s.nazov, k.nazov),
      'cena', (select p.cena from public.objednavky_polozky p join public.objednavky o on o.cislo = p.cislo
               where p.kod = k.kod and p.cena is not null order by o.vytvorena desc nulls last limit 1)) x
    from (select distinct on (kod) kod, nazov from public.objednavky_polozky where kod is not null order by kod, nazov) k
    left join lateral (select nazov from public.furmanky_sablona where kod = k.kod limit 1) s on true) q), '[]') else '[]'::jsonb end
$$;
revoke all on function public.obj_produkty() from public, anon;
grant execute on function public.obj_produkty() to authenticated;

create or replace function public.obj_ciselniky() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.obj_smiem() then jsonb_build_object(
    'dopravy', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'doprava'), '[]'),
    'platby', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'platba'), '[]'))
  else '{}'::jsonb end
$$;
revoke all on function public.obj_ciselniky() from public, anon;
grant execute on function public.obj_ciselniky() to authenticated;

-- nové osobné odbery na oznámenie (volá Edge Function upozornenia pri kontrole každých 30 min) – zároveň ich označí
create or replace function public.odbery_na_oznamenie() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with n as (
    update public.objednavky o set odber_oznameny = now()
    where public.obj_je_osobny(o.doprava) and o.odber_oznameny is null and o.vytvorena > now() - interval '2 days'
      and not public.obj_je_storno(o.status) and o.zdroj <> 'appka'
    returning o.cislo, coalesce(nullif(o.meno, ''), o.firma) meno, o.suma)
  select coalesce(jsonb_agg(jsonb_build_object('cislo', n.cislo, 'meno', n.meno, 'suma', n.suma,
    'polozky', (select string_agg(p.mnozstvo::int || '× ' || coalesce(p.nazov, p.kod), ', ') from public.objednavky_polozky p where p.cislo = n.cislo))), '[]') into v from n;
  return jsonb_build_object('odbery', v,
    'uids', (select coalesce(jsonb_agg(distinct p.id), '[]') from public.profily p
             where p.aktivny and (p.rola in ('prevadzka','prevadzkar')
               or exists (select 1 from public.rozpis_osoby ro join public.rozpis_miesta m on m.osoba_id = ro.id and m.datum = public.dnes_sk()
                          where ro.aktivny and lower(p.email) in (lower(ro.email), lower(ro.email2))))));
end $$;
revoke all on function public.odbery_na_oznamenie() from public, anon, authenticated;
grant execute on function public.odbery_na_oznamenie() to service_role;
-- existujúce staré osobné odbery neoznamovať spätne
update public.objednavky set odber_oznameny = now() where odber_oznameny is null and vytvorena < now() - interval '1 hour';
