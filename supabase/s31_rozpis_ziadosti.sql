-- =========================================================================
-- 31) ROZPIS – žiadosti o zmenu smien (v0.24): zamestnanec chce prevziať / vymeniť cudziu smenu,
--     odovzdať alebo prehodiť svoju → schvaľuje vedenie (IT, CEO, prevádzkár). Rozpis sa zmení až po schválení.
-- =========================================================================
-- prevádzkár spravuje rozpis ako vedenie
create or replace function public.rozpis_rola() returns text
language sql stable security definer set search_path = public as $$
  select case when public.moja_rola() in ('it','ceo','prevadzkar') then 'sprava'
              when public.moja_rola() in ('prevadzka','furman','zakaznicky_servis') then 'spolocny'
              when public.moja_rola() = 'zamestnanec' then 'osobny'
              when public.moja_rola() = 'uctovnicka' then 'citanie' end
$$;

create table if not exists public.rozpis_ziadosti (
  id         bigint generated always as identity primary key,
  typ        text not null check (typ in ('prevziat','vymenit','odovzdat')),
  ziadatel   bigint not null references public.rozpis_osoby(id),
  miesto_a   bigint references public.rozpis_miesta(id) on delete set null,   -- smena žiadateľa (vymeniť, odovzdať)
  miesto_b   bigint references public.rozpis_miesta(id) on delete set null,   -- smena kolegu (prevziať, vymeniť)
  osoba_b    bigint references public.rozpis_osoby(id),                        -- kolega (majiteľ miesto_b alebo komu sa odovzdáva)
  poznamka   text,
  stav       text not null default 'caka' check (stav in ('caka','schvalena','zamietnuta','zrusena','neplatna')),
  kto        uuid default auth.uid(),
  vytvorene  timestamptz not null default now(),
  vybavil    uuid,
  vybavene   timestamptz,
  dovod      text
);
create index if not exists rozpis_ziadosti_stav on public.rozpis_ziadosti (stav, vytvorene desc);
alter table public.rozpis_ziadosti enable row level security;
grant select, insert, update, delete on public.rozpis_ziadosti to service_role;

create or replace function public.rozpis_miesto_popis(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select (array['Po','Ut','St','Št','Pi','So','Ne'])[extract(isodow from m.datum)::int] || ' ' || to_char(m.datum, 'FMDD. FMMM.') || ' ' ||
         coalesce((select nazov from public.rozpis_pozicie where kod = m.pozicia), m.pozicia) ||
         coalesce(' ' || to_char(m.cas_od, 'HH24:MI') || coalesce('–' || to_char(m.cas_do, 'HH24:MI'), ''), '')
  from public.rozpis_miesta m where m.id = p_id
$$;

create or replace function public.rozpis_ziadost_json(z public.rozpis_ziadosti) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', z.id, 'typ', z.typ, 'stav', z.stav, 'vytvorene', z.vytvorene, 'vybavene', z.vybavene, 'dovod', z.dovod, 'poznamka', z.poznamka,
    'ziadatel', z.ziadatel, 'ziadatel_meno', (select meno from public.rozpis_osoby where id = z.ziadatel),
    'kolega', z.osoba_b, 'kolega_meno', (select meno from public.rozpis_osoby where id = z.osoba_b),
    'miesto_a', z.miesto_a, 'miesto_b', z.miesto_b,
    'smena_a', public.rozpis_miesto_popis(z.miesto_a), 'smena_b', public.rozpis_miesto_popis(z.miesto_b),
    'datum', least((select datum from public.rozpis_miesta where id = z.miesto_a), (select datum from public.rozpis_miesta where id = z.miesto_b)))
$$;

-- nová žiadosť: p = {typ: prevziat|vymenit|odovzdat, miesto_b?, miesto_a?, komu?, poznamka?}
create or replace function public.rozpis_ziadost_nova(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ja bigint := public.rozpis_moja_osoba(); v_typ text := p->>'typ'; a public.rozpis_miesta; b public.rozpis_miesta;
  v_komu bigint := nullif(p->>'komu', '')::bigint; v_id bigint; v_b bigint;
begin
  if public.rozpis_rola() not in ('osobny', 'sprava') or v_ja is null then return jsonb_build_object('ok', false, 'text', 'Váš účet nie je spojený s menom v rozpise'); end if;
  if v_typ not in ('prevziat', 'vymenit', 'odovzdat') then return jsonb_build_object('ok', false, 'text', 'Neznámy typ žiadosti'); end if;
  if v_typ in ('vymenit', 'odovzdat') then
    select * into a from public.rozpis_miesta where id = nullif(p->>'miesto_a', '')::bigint;
    if a.id is null or a.osoba_id is distinct from v_ja then return jsonb_build_object('ok', false, 'text', 'Vyberte svoju smenu'); end if;
    if a.datum < public.dnes_sk() then return jsonb_build_object('ok', false, 'text', 'Smena už bola'); end if;
  end if;
  if v_typ in ('prevziat', 'vymenit') then
    select * into b from public.rozpis_miesta where id = nullif(p->>'miesto_b', '')::bigint;
    if b.id is null or b.osoba_id is null or b.osoba_id = v_ja then return jsonb_build_object('ok', false, 'text', 'Vyberte smenu kolegu'); end if;
    if b.datum < public.dnes_sk() then return jsonb_build_object('ok', false, 'text', 'Smena už bola'); end if;
    v_b := b.osoba_id;
  end if;
  if v_typ = 'prevziat' and exists (select 1 from public.rozpis_miesta where datum = b.datum and pozicia = b.pozicia and osoba_id = v_ja) then
    return jsonb_build_object('ok', false, 'text', 'V ten deň už na tejto pozícii ste'); end if;
  if v_typ = 'odovzdat' then
    if v_komu is null or v_komu = v_ja or not exists (select 1 from public.rozpis_osoby where id = v_komu and aktivny) then return jsonb_build_object('ok', false, 'text', 'Vyberte kolegu'); end if;
    if exists (select 1 from public.rozpis_miesta where datum = a.datum and pozicia = a.pozicia and osoba_id = v_komu) then
      return jsonb_build_object('ok', false, 'text', 'Kolega už na tejto pozícii v ten deň je'); end if;
    v_b := v_komu;
  end if;
  if exists (select 1 from public.rozpis_ziadosti where stav = 'caka' and ziadatel = v_ja and coalesce(miesto_a, 0) = coalesce(a.id, 0) and coalesce(miesto_b, 0) = coalesce(b.id, 0) and typ = v_typ) then
    return jsonb_build_object('ok', false, 'text', 'Takúto žiadosť ste už poslali – čaká na schválenie'); end if;
  insert into public.rozpis_ziadosti (typ, ziadatel, miesto_a, miesto_b, osoba_b, poznamka)
    values (v_typ, v_ja, a.id, b.id, v_b, nullif(left(trim(coalesce(p->>'poznamka', '')), 300), '')) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'text', 'Žiadosť odoslaná – rozpis sa zmení, keď ju vedenie schváli');
end $$;

-- zoznam: vedenie vidí čakajúce + posledné vybavené; zamestnanec svoje a tie, ktoré sa ho týkajú
create or replace function public.rozpis_ziadosti() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rola text := public.rozpis_rola(); v_ja bigint := public.rozpis_moja_osoba();
begin
  if v_rola is null then return jsonb_build_object('ok', false, 'text', 'Rozpis nemáte povolený'); end if;
  return jsonb_build_object('ok', true, 'sprava', v_rola = 'sprava',
    'caka', (select coalesce(jsonb_agg(public.rozpis_ziadost_json(z) order by z.vytvorene), '[]') from public.rozpis_ziadosti z
             where z.stav = 'caka' and (v_rola = 'sprava' or z.ziadatel = v_ja or z.osoba_b = v_ja)),
    'vybavene', (select coalesce(jsonb_agg(x order by x->>'vybavene' desc), '[]') from (
             select public.rozpis_ziadost_json(z) x from public.rozpis_ziadosti z
             where z.stav <> 'caka' and z.vybavene > now() - interval '14 days' and (v_rola = 'sprava' or z.ziadatel = v_ja or z.osoba_b = v_ja)
             order by z.vybavene desc limit 15) q));
end $$;

-- schválenie / zamietnutie (vedenie); pri schválení sa rozpis zmení, ak sa smeny medzitým nezmenili
create or replace function public.rozpis_ziadost_rozhodni(p_id bigint, p_schval boolean, p_dovod text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare z public.rozpis_ziadosti; a public.rozpis_miesta; b public.rozpis_miesta; v_text text;
  v_ucet text := (select email from public.profily where id = auth.uid());
begin
  if public.rozpis_rola() <> 'sprava' then return jsonb_build_object('ok', false, 'text', 'Schvaľuje vedenie'); end if;
  select * into z from public.rozpis_ziadosti where id = p_id for update;
  if z.id is null or z.stav <> 'caka' then return jsonb_build_object('ok', false, 'text', 'Žiadosť už je vybavená'); end if;
  if not p_schval then
    update public.rozpis_ziadosti set stav = 'zamietnuta', vybavil = auth.uid(), vybavene = now(), dovod = nullif(trim(coalesce(p_dovod, '')), '') where id = p_id;
    return jsonb_build_object('ok', true, 'text', 'Žiadosť zamietnutá');
  end if;
  if z.miesto_a is not null then select * into a from public.rozpis_miesta where id = z.miesto_a for update; end if;
  if z.miesto_b is not null then select * into b from public.rozpis_miesta where id = z.miesto_b for update; end if;
  if (z.typ in ('vymenit', 'odovzdat') and a.osoba_id is distinct from z.ziadatel) or (z.typ in ('prevziat', 'vymenit') and b.osoba_id is distinct from z.osoba_b) then
    update public.rozpis_ziadosti set stav = 'neplatna', vybavil = auth.uid(), vybavene = now(), dovod = 'Smeny sa medzitým zmenili' where id = p_id;
    return jsonb_build_object('ok', false, 'text', 'Smeny sa medzitým zmenili – žiadosť už neplatí');
  end if;
  if z.typ = 'prevziat' then
    if exists (select 1 from public.rozpis_miesta where datum = b.datum and pozicia = b.pozicia and osoba_id = z.ziadatel) then
      return jsonb_build_object('ok', false, 'text', 'Žiadateľ už v ten deň na tejto pozícii je'); end if;
    update public.rozpis_miesta set osoba_id = z.ziadatel, upravene = now() where id = b.id;
    v_text := (select meno from public.rozpis_osoby where id = z.ziadatel) || ' preberá smenu po ' || (select meno from public.rozpis_osoby where id = z.osoba_b);
  elsif z.typ = 'odovzdat' then
    if exists (select 1 from public.rozpis_miesta where datum = a.datum and pozicia = a.pozicia and osoba_id = z.osoba_b) then
      return jsonb_build_object('ok', false, 'text', 'Kolega už v ten deň na tejto pozícii je'); end if;
    update public.rozpis_miesta set osoba_id = z.osoba_b, upravene = now() where id = a.id;
    v_text := (select meno from public.rozpis_osoby where id = z.ziadatel) || ' → ' || (select meno from public.rozpis_osoby where id = z.osoba_b);
  else
    update public.rozpis_miesta set osoba_id = z.osoba_b, upravene = now() where id = a.id;
    update public.rozpis_miesta set osoba_id = z.ziadatel, upravene = now() where id = b.id;
    v_text := 'výmena: ' || (select meno from public.rozpis_osoby where id = z.ziadatel) || ' (' || to_char(a.datum, 'DD.MM.') || ') ↔ ' ||
              (select meno from public.rozpis_osoby where id = z.osoba_b) || ' (' || to_char(b.datum, 'DD.MM.') || ')';
  end if;
  update public.rozpis_ziadosti set stav = 'schvalena', vybavil = auth.uid(), vybavene = now() where id = p_id;
  insert into public.rozpis_log (kto, ucet, datum, pozicia, akcia, text)
    values (auth.uid(), v_ucet, coalesce(b.datum, a.datum), coalesce(b.pozicia, a.pozicia), 'ziadost', 'schválená žiadosť – ' || v_text);
  return jsonb_build_object('ok', true, 'text', 'Schválené – ' || v_text);
end $$;

create or replace function public.rozpis_ziadost_zrus(p_id bigint) returns jsonb
language sql security definer set search_path = public as $$
  update public.rozpis_ziadosti set stav = 'zrusena', vybavene = now(), vybavil = auth.uid()
  where id = p_id and stav = 'caka' and ziadatel = public.rozpis_moja_osoba();
  select jsonb_build_object('ok', true, 'text', 'Žiadosť zrušená')
$$;

revoke all on function public.rozpis_miesto_popis(bigint), public.rozpis_ziadost_json(public.rozpis_ziadosti), public.rozpis_ziadost_nova(jsonb), public.rozpis_ziadosti(),
  public.rozpis_ziadost_rozhodni(bigint, boolean, text), public.rozpis_ziadost_zrus(bigint) from public, anon;
grant execute on function public.rozpis_ziadost_nova(jsonb), public.rozpis_ziadosti(), public.rozpis_ziadost_rozhodni(bigint, boolean, text), public.rozpis_ziadost_zrus(bigint) to authenticated;
grant execute on function public.rozpis_miesto_popis(bigint) to service_role;

-- čo čaká na schválenie vedením (karta na Prehľade pre IT, CEO, prevádzkára)
create or replace function public.na_schvalenie() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.moja_rola() in ('it','ceo','prevadzkar') then jsonb_build_object('ok', true,
    'smeny', (select count(*) from public.rozpis_ziadosti where stav = 'caka'),
    'dochadzka', (select count(*) from public.dochadzka_absencie where stav = 'ziadost'),
    'udaje', case when public.moja_rola() in ('it','ceo') then (select count(*) from public.zamestnanci_ziadosti where stav = 'ziadost') else 0 end)
  else jsonb_build_object('ok', false) end
$$;
revoke all on function public.na_schvalenie() from public, anon;
grant execute on function public.na_schvalenie() to authenticated;
-- Účet (nastavenia) má každá rola
insert into public.pristupy (rola, modul, uprava) select r.kod, 'nastavenia', false from public.roly r on conflict do nothing;
