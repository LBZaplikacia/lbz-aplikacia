-- =========================================================================
-- 32) ROZPIS – kto potvrdzuje zmeny smien (v0.25)
--   • zamestnanec sa zapíše namiesto konkrétneho kolegu (prevziať) alebo si s ním vymení smenu
--       → potvrdzuje ten KOLEGA (ak nemá účet v appke, potvrdí vedenie)
--   • zamestnanec sa chce zapísať na novú / voľnú smenu (pridať) alebo sa zo smeny odhlásiť
--       → potvrdzuje VEDENIE (IT, CEO, prevádzkár)
--   • zamestnanec už nemení rozpis priamo (len poznámku k svojej smene); odovzdať smenu inému sa už nedá
--   • spoločné účty (prevádzka, furman, zákaznícky servis) rozpis len prezerajú
-- =========================================================================
alter table public.rozpis_ziadosti add column if not exists datum date;
alter table public.rozpis_ziadosti add column if not exists pozicia text;
alter table public.rozpis_ziadosti add column if not exists potvrdzuje text not null default 'vedenie';
alter table public.rozpis_ziadosti drop constraint if exists rozpis_ziadosti_typ_check;
alter table public.rozpis_ziadosti add constraint rozpis_ziadosti_typ_check check (typ in ('prevziat','vymenit','odovzdat','pridat','odhlasit'));
alter table public.rozpis_ziadosti drop constraint if exists rozpis_ziadosti_potvrdzuje_check;
alter table public.rozpis_ziadosti add constraint rozpis_ziadosti_potvrdzuje_check check (potvrdzuje in ('kolega','vedenie'));

-- popis smeny bez času (časy sa v rozpise neuvádzajú)
create or replace function public.rozpis_miesto_popis(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select (array['Po','Ut','St','Št','Pi','So','Ne'])[extract(isodow from m.datum)::int] || ' ' || to_char(m.datum, 'FMDD. FMMM.') || ' ' ||
         coalesce((select nazov from public.rozpis_pozicie where kod = m.pozicia), m.pozicia)
  from public.rozpis_miesta m where m.id = p_id
$$;

-- má osoba v rozpise aktívny účet v appke?
create or replace function public.rozpis_osoba_ma_ucet(p_osoba bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rozpis_osoby o join public.profily p on lower(p.email) in (lower(o.email), lower(o.email2))
                 where o.id = p_osoba and p.aktivny)
$$;

-- môžem ja rozhodnúť o tejto žiadosti?
create or replace function public.rozpis_ziadost_smiem(z public.rozpis_ziadosti) returns boolean
language sql stable security definer set search_path = public as $$
  select z.stav = 'caka' and (public.rozpis_rola() = 'sprava'
         or (z.potvrdzuje = 'kolega' and z.osoba_b is not null and z.osoba_b = public.rozpis_moja_osoba()))
$$;

create or replace function public.rozpis_ziadost_json(z public.rozpis_ziadosti) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', z.id, 'typ', z.typ, 'stav', z.stav, 'vytvorene', z.vytvorene, 'vybavene', z.vybavene, 'dovod', z.dovod, 'poznamka', z.poznamka,
    'ziadatel', z.ziadatel, 'ziadatel_meno', (select meno from public.rozpis_osoby where id = z.ziadatel),
    'kolega', z.osoba_b, 'kolega_meno', (select meno from public.rozpis_osoby where id = z.osoba_b),
    'miesto_a', z.miesto_a, 'miesto_b', z.miesto_b, 'potvrdzuje', z.potvrdzuje,
    'smena_a', public.rozpis_miesto_popis(z.miesto_a), 'smena_b', public.rozpis_miesto_popis(z.miesto_b),
    'smena_nova', case when z.typ = 'pridat' then (array['Po','Ut','St','Št','Pi','So','Ne'])[extract(isodow from z.datum)::int] || ' ' || to_char(z.datum, 'FMDD. FMMM.') || ' ' ||
                       coalesce((select nazov from public.rozpis_pozicie where kod = z.pozicia), z.pozicia) end,
    'smiem', public.rozpis_ziadost_smiem(z),
    'datum', coalesce(z.datum, least((select datum from public.rozpis_miesta where id = z.miesto_a), (select datum from public.rozpis_miesta where id = z.miesto_b))))
$$;

-- nová žiadosť: p = {typ: prevziat|vymenit|pridat|odhlasit, miesto_a?, miesto_b?, datum?, pozicia?, poznamka?}
create or replace function public.rozpis_ziadost_nova(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ja bigint := public.rozpis_moja_osoba(); v_typ text := p->>'typ'; a public.rozpis_miesta; b public.rozpis_miesta;
  v_id bigint; v_b bigint; v_dat date; v_poz text; v_potv text := 'vedenie'; v_text text;
begin
  if public.rozpis_rola() not in ('osobny', 'sprava') or v_ja is null then return jsonb_build_object('ok', false, 'text', 'Váš účet nie je spojený s menom v rozpise'); end if;
  if v_typ not in ('prevziat', 'vymenit', 'pridat', 'odhlasit') then return jsonb_build_object('ok', false, 'text', 'Neznámy typ žiadosti'); end if;
  if v_typ in ('vymenit', 'odhlasit') then
    select * into a from public.rozpis_miesta where id = nullif(p->>'miesto_a', '')::bigint;
    if a.id is null or a.osoba_id is distinct from v_ja then return jsonb_build_object('ok', false, 'text', 'Vyberte svoju smenu'); end if;
    if a.datum < public.dnes_sk() then return jsonb_build_object('ok', false, 'text', 'Smena už bola'); end if;
  end if;
  if v_typ in ('prevziat', 'vymenit') then
    select * into b from public.rozpis_miesta where id = nullif(p->>'miesto_b', '')::bigint;
    if b.id is null or b.osoba_id is null or b.osoba_id = v_ja then return jsonb_build_object('ok', false, 'text', 'Vyberte smenu kolegu'); end if;
    if b.datum < public.dnes_sk() then return jsonb_build_object('ok', false, 'text', 'Smena už bola'); end if;
    v_b := b.osoba_id;
    v_potv := case when public.rozpis_osoba_ma_ucet(v_b) then 'kolega' else 'vedenie' end;
  end if;
  if v_typ = 'prevziat' and exists (select 1 from public.rozpis_miesta where datum = b.datum and pozicia = b.pozicia and osoba_id = v_ja) then
    return jsonb_build_object('ok', false, 'text', 'V ten deň už na tejto pozícii ste'); end if;
  if v_typ = 'pridat' then
    if nullif(p->>'miesto_b', '') is not null then        -- voľné miesto
      select * into b from public.rozpis_miesta where id = (p->>'miesto_b')::bigint;
      if b.id is null or b.osoba_id is not null then return jsonb_build_object('ok', false, 'text', 'Miesto už nie je voľné'); end if;
      v_dat := b.datum; v_poz := b.pozicia;
    else
      v_dat := nullif(p->>'datum', '')::date; v_poz := nullif(p->>'pozicia', '');
    end if;
    if v_dat is null or v_poz is null or not exists (select 1 from public.rozpis_pozicie where kod = v_poz) then return jsonb_build_object('ok', false, 'text', 'Chýba deň alebo pozícia'); end if;
    if v_dat < public.dnes_sk() then return jsonb_build_object('ok', false, 'text', 'Deň už bol'); end if;
    if exists (select 1 from public.rozpis_miesta where datum = v_dat and pozicia = v_poz and osoba_id = v_ja) then
      return jsonb_build_object('ok', false, 'text', 'V ten deň už na tejto pozícii ste'); end if;
  end if;
  if exists (select 1 from public.rozpis_ziadosti where stav = 'caka' and ziadatel = v_ja and typ = v_typ and coalesce(miesto_a, 0) = coalesce(a.id, 0)
             and coalesce(miesto_b, 0) = coalesce(b.id, 0) and datum is not distinct from v_dat and pozicia is not distinct from v_poz) then
    return jsonb_build_object('ok', false, 'text', 'Takúto žiadosť ste už poslali – čaká na potvrdenie'); end if;
  insert into public.rozpis_ziadosti (typ, ziadatel, miesto_a, miesto_b, osoba_b, datum, pozicia, potvrdzuje, poznamka)
    values (v_typ, v_ja, a.id, b.id, v_b, v_dat, v_poz, v_potv, nullif(left(trim(coalesce(p->>'poznamka', '')), 300), '')) returning id into v_id;
  v_text := case when v_potv = 'kolega' then 'Žiadosť odoslaná – rozpis sa zmení, keď ju potvrdí ' || (select meno from public.rozpis_osoby where id = v_b)
                 else 'Žiadosť odoslaná – rozpis sa zmení, keď ju potvrdí vedenie' end;
  return jsonb_build_object('ok', true, 'id', v_id, 'text', v_text);
end $$;

create or replace function public.rozpis_ziadosti() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rola text := public.rozpis_rola(); v_ja bigint := public.rozpis_moja_osoba();
begin
  if v_rola is null then return jsonb_build_object('ok', false, 'text', 'Rozpis nemáte povolený'); end if;
  return jsonb_build_object('ok', true, 'sprava', v_rola = 'sprava', 'ja', v_ja,
    'caka', (select coalesce(jsonb_agg(public.rozpis_ziadost_json(z) order by z.vytvorene), '[]') from public.rozpis_ziadosti z
             where z.stav = 'caka' and (v_rola = 'sprava' or z.ziadatel = v_ja or z.osoba_b = v_ja)),
    'vybavene', (select coalesce(jsonb_agg(x order by x->>'vybavene' desc), '[]') from (
             select public.rozpis_ziadost_json(z) x from public.rozpis_ziadosti z
             where z.stav <> 'caka' and z.vybavene > now() - interval '14 days' and (v_rola = 'sprava' or z.ziadatel = v_ja or z.osoba_b = v_ja)
             order by z.vybavene desc limit 15) q));
end $$;

-- potvrdenie / zamietnutie: kolega (prevziať, vymeniť) alebo vedenie (všetko)
create or replace function public.rozpis_ziadost_rozhodni(p_id bigint, p_schval boolean, p_dovod text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare z public.rozpis_ziadosti; a public.rozpis_miesta; b public.rozpis_miesta; v_text text; v_n int;
  v_ucet text := (select email from public.profily where id = auth.uid());
begin
  select * into z from public.rozpis_ziadosti where id = p_id for update;
  if z.id is null or z.stav <> 'caka' then return jsonb_build_object('ok', false, 'text', 'Žiadosť už je vybavená'); end if;
  if not public.rozpis_ziadost_smiem(z) then
    return jsonb_build_object('ok', false, 'text', case when z.potvrdzuje = 'kolega' then 'Potvrdzuje ' || (select meno from public.rozpis_osoby where id = z.osoba_b) else 'Potvrdzuje vedenie' end); end if;
  if not p_schval then
    update public.rozpis_ziadosti set stav = 'zamietnuta', vybavil = auth.uid(), vybavene = now(), dovod = nullif(trim(coalesce(p_dovod, '')), '') where id = p_id;
    return jsonb_build_object('ok', true, 'text', 'Žiadosť zamietnutá');
  end if;
  if z.miesto_a is not null then select * into a from public.rozpis_miesta where id = z.miesto_a for update; end if;
  if z.miesto_b is not null then select * into b from public.rozpis_miesta where id = z.miesto_b for update; end if;
  if (z.typ in ('vymenit', 'odovzdat', 'odhlasit') and a.osoba_id is distinct from z.ziadatel)
     or (z.typ in ('prevziat', 'vymenit') and b.osoba_id is distinct from z.osoba_b)
     or (z.typ = 'pridat' and z.miesto_b is not null and (b.id is null or b.osoba_id is not null)) then
    update public.rozpis_ziadosti set stav = 'neplatna', vybavil = auth.uid(), vybavene = now(), dovod = 'Smeny sa medzitým zmenili' where id = p_id;
    return jsonb_build_object('ok', false, 'text', 'Smeny sa medzitým zmenili – žiadosť už neplatí');
  end if;
  if z.typ = 'prevziat' then
    if exists (select 1 from public.rozpis_miesta where datum = b.datum and pozicia = b.pozicia and osoba_id = z.ziadatel) then
      return jsonb_build_object('ok', false, 'text', 'Žiadateľ už v ten deň na tejto pozícii je'); end if;
    update public.rozpis_miesta set osoba_id = z.ziadatel, upravene = now() where id = b.id;
    v_text := (select meno from public.rozpis_osoby where id = z.ziadatel) || ' ide namiesto ' || (select meno from public.rozpis_osoby where id = z.osoba_b);
  elsif z.typ = 'odovzdat' then
    if exists (select 1 from public.rozpis_miesta where datum = a.datum and pozicia = a.pozicia and osoba_id = z.osoba_b) then
      return jsonb_build_object('ok', false, 'text', 'Kolega už v ten deň na tejto pozícii je'); end if;
    update public.rozpis_miesta set osoba_id = z.osoba_b, upravene = now() where id = a.id;
    v_text := (select meno from public.rozpis_osoby where id = z.ziadatel) || ' → ' || (select meno from public.rozpis_osoby where id = z.osoba_b);
  elsif z.typ = 'vymenit' then
    update public.rozpis_miesta set osoba_id = z.osoba_b, upravene = now() where id = a.id;
    update public.rozpis_miesta set osoba_id = z.ziadatel, upravene = now() where id = b.id;
    v_text := 'výmena: ' || (select meno from public.rozpis_osoby where id = z.ziadatel) || ' (' || to_char(a.datum, 'DD.MM.') || ') ↔ ' ||
              (select meno from public.rozpis_osoby where id = z.osoba_b) || ' (' || to_char(b.datum, 'DD.MM.') || ')';
  elsif z.typ = 'pridat' then
    if exists (select 1 from public.rozpis_miesta where datum = z.datum and pozicia = z.pozicia and osoba_id = z.ziadatel) then
      return jsonb_build_object('ok', false, 'text', 'Žiadateľ už v ten deň na tejto pozícii je'); end if;
    if b.id is not null then
      update public.rozpis_miesta set osoba_id = z.ziadatel, upravene = now() where id = b.id;
    else
      select coalesce(max(miesto), 0) + 1 into v_n from public.rozpis_miesta where datum = z.datum and pozicia = z.pozicia;
      insert into public.rozpis_miesta (datum, pozicia, miesto, osoba_id, vynimka)
        values (z.datum, z.pozicia, v_n, z.ziadatel, v_n = 1);
    end if;
    v_text := (select meno from public.rozpis_osoby where id = z.ziadatel) || ' pridaný(á) na smenu';
  else -- odhlasit
    if a.vynimka then delete from public.rozpis_miesta where id = a.id;
    else update public.rozpis_miesta set osoba_id = null, upravene = now() where id = a.id; end if;
    v_text := (select meno from public.rozpis_osoby where id = z.ziadatel) || ' odhlásený(á) zo smeny';
  end if;
  update public.rozpis_ziadosti set stav = 'schvalena', vybavil = auth.uid(), vybavene = now() where id = p_id;
  insert into public.rozpis_log (kto, ucet, datum, pozicia, akcia, text)
    values (auth.uid(), v_ucet, coalesce(b.datum, a.datum, z.datum), coalesce(b.pozicia, a.pozicia, z.pozicia), 'ziadost', 'potvrdená žiadosť – ' || v_text);
  return jsonb_build_object('ok', true, 'text', 'Potvrdené – ' || v_text);
end $$;

-- zamestnanec rozpis priamo nemení (len poznámku k svojej smene); spoločné účty len prezerajú
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.rozpis_zmena(jsonb)'::regprocedure) into v_src;
  if position('-- s32 straz' in v_src) = 0 then
    v_src := replace(v_src,
      '  if v_rola is null or v_rola = ''citanie'' then return jsonb_build_object(''ok'', false, ''text'', ''Rozpis môžete len prezerať''); end if;',
      '  if v_rola is null or v_rola in (''citanie'', ''spolocny'') then return jsonb_build_object(''ok'', false, ''text'', ''Rozpis môžete len prezerať''); end if; -- s32 straz' || chr(10) ||
      '  if v_rola = ''osobny'' and v_akcia <> ''cas'' then return jsonb_build_object(''ok'', false, ''text'', ''Zmenu smeny pošlite ako žiadosť – potvrdí ju kolega alebo vedenie''); end if;');
    if position('-- s32 straz' in v_src) = 0 then raise exception 's32: rozpis_zmena sa nepodarilo upraviť'; end if;
    execute v_src;
  end if;
end $$;

-- karta „Na schválenie“: vedenie vidí, čo čaká na vedenie; zamestnanec, čo čaká na jeho potvrdenie
create or replace function public.na_schvalenie() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.moja_rola() in ('it','ceo','prevadzkar') then jsonb_build_object('ok', true,
    'smeny', (select count(*) from public.rozpis_ziadosti where stav = 'caka' and (potvrdzuje = 'vedenie' or osoba_b = public.rozpis_moja_osoba())),
    'dochadzka', (select count(*) from public.dochadzka_absencie where stav = 'ziadost'),
    'udaje', case when public.moja_rola() in ('it','ceo') then (select count(*) from public.zamestnanci_ziadosti where stav = 'ziadost') else 0 end)
  when public.rozpis_moja_osoba() is not null then jsonb_build_object('ok', true, 'osobne', true,
    'smeny', (select count(*) from public.rozpis_ziadosti where stav = 'caka' and potvrdzuje = 'kolega' and osoba_b = public.rozpis_moja_osoba()),
    'dochadzka', 0, 'udaje', 0)
  else jsonb_build_object('ok', false) end
$$;

revoke all on function public.rozpis_osoba_ma_ucet(bigint), public.rozpis_ziadost_smiem(public.rozpis_ziadosti) from public, anon;
grant execute on function public.rozpis_osoba_ma_ucet(bigint) to service_role;
