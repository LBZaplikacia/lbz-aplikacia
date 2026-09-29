-- LBZ aplikácia – databáza (Supabase / PostgreSQL)
-- Verzia 0.3 – 29. 9. 2026: roly, profily, sklad (produkty, balíky, pohyby, skenovanie), prenos zo starého skladu
-- Spúšťa sa v Supabase: SQL Editor → vložiť celý súbor → Run. Dá sa spustiť opakovane.
-- Nové tabuľky sa appke NEsprístupňujú automaticky – prístupy sú nižšie vypísané ručne (GRANT + RLS).

-- =========================================================================
-- 1) ROLY, MODULY, PRÍSTUPY
-- =========================================================================
create table if not exists public.roly (
  kod      text primary key,
  nazov    text not null,
  interna  boolean not null default true
);

insert into public.roly (kod, nazov, interna) values
  ('it',                'IT (správca)',            true),
  ('ceo',               'CEO',                     true),
  ('uctovnicka',        'Účtovníčka / mzdárka',    false),
  ('prevadzka',         'Zamestnanec prevádzky',   true),
  ('furman',            'Furman (vodič)',          true),
  ('zakaznicky_servis', 'Zákaznícky servis',       true),
  ('zakaznik',          'Zákazník',                false)
on conflict (kod) do update set nazov = excluded.nazov, interna = excluded.interna;

create table if not exists public.moduly (
  kod      text primary key,
  nazov    text not null,
  poradie  int  not null default 100,
  aktivny  boolean not null default true
);

insert into public.moduly (kod, nazov, poradie, aktivny) values
  ('prehlad',          'Prehľad',                   1,  true),
  ('sklad',            'Sklad',                     10, true),
  ('furmanky',         'Furmanky',                  20, true),
  ('balenie',          'Balenie a štítky',          25, false),
  ('trasa',            'Moja trasa',                28, false),
  ('dochadzka',        'Dochádzka a smeny',         30, false),
  ('kniha_jazd',       'Kniha jázd',                40, false),
  ('objednavky',       'Objednávky',                50, false),
  ('komentare',        'Komentáre FB/IG',           55, false),
  ('zamestnanci',      'Zamestnanci',               60, false),
  ('exporty',          'Exporty pre účtovníctvo',   65, false),
  ('moje_objednavky',  'Moje objednávky',           80, false),
  ('sledovanie',       'Kde je moja furmanka',      81, false),
  ('nastavenia',       'Nastavenia',                99, true)
on conflict (kod) do update set nazov = excluded.nazov, poradie = excluded.poradie;

create table if not exists public.pristupy (
  rola   text references public.roly(kod)   on delete cascade,
  modul  text references public.moduly(kod) on delete cascade,
  uprava boolean not null default true,
  primary key (rola, modul)
);

-- IT a CEO vidia všetko
insert into public.pristupy (rola, modul) select r, kod from public.moduly, unnest(array['it','ceo']) r
on conflict do nothing;
insert into public.pristupy (rola, modul, uprava) values
  ('prevadzka','prehlad',true), ('prevadzka','sklad',true), ('prevadzka','furmanky',true), ('prevadzka','balenie',true),
  ('prevadzka','dochadzka',true), ('prevadzka','kniha_jazd',true),
  ('furman','prehlad',true), ('furman','trasa',true), ('furman','furmanky',false), ('furman','dochadzka',true), ('furman','kniha_jazd',true),
  ('zakaznicky_servis','prehlad',true), ('zakaznicky_servis','objednavky',true), ('zakaznicky_servis','furmanky',true), ('zakaznicky_servis','komentare',true),
  ('uctovnicka','prehlad',true), ('uctovnicka','dochadzka',false), ('uctovnicka','zamestnanci',false), ('uctovnicka','exporty',false),
  ('zakaznik','moje_objednavky',true), ('zakaznik','sledovanie',true)
on conflict do nothing;

-- =========================================================================
-- 2) PROFILY (prihlásenie rieši Supabase Auth – e-mail + heslo)
-- =========================================================================
create table if not exists public.profily (
  id         uuid primary key references auth.users(id) on delete cascade,
  meno       text,
  email      text,
  rola       text not null default 'zakaznik' references public.roly(kod),
  aktivny    boolean not null default true,
  vytvoreny  timestamptz not null default now()
);

create or replace function public.novy_profil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profily (id, email, meno)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists po_registracii on auth.users;
create trigger po_registracii after insert on auth.users
  for each row execute function public.novy_profil();

create or replace function public.moja_rola() returns text
language sql stable security definer set search_path = public as $$
  select rola from public.profily where id = auth.uid() and aktivny
$$;

create or replace function public.som_spravca() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.moja_rola() in ('it','ceo'), false)
$$;

create or replace function public.som_interny() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.moja_rola() in ('it','ceo','prevadzka','furman','zakaznicky_servis'), false)
$$;

create or replace function public.moje_moduly()
returns table (kod text, nazov text, poradie int, aktivny boolean, uprava boolean)
language sql stable security definer set search_path = public as $$
  select m.kod, m.nazov, m.poradie, m.aktivny, p.uprava
  from public.pristupy p join public.moduly m on m.kod = p.modul
  where p.rola = public.moja_rola()
  order by m.poradie
$$;

-- =========================================================================
-- 3) SKLAD
-- =========================================================================
-- Produkty (kmeňové kódy, napr. P00017-2)
create table if not exists public.produkty (
  kod        text primary key,
  nazov      text not null,
  farba      text not null default '#ffffff',
  typ        text not null default 'mrazene' check (typ in ('mrazene','cerstve','ine')),
  aktivny    boolean not null default true,
  upraveny   timestamptz not null default now()
);

-- Balíky – jeden riadok = jeden fyzický balík (napr. P00017-2-15)
create table if not exists public.baliky (
  kod          text primary key,
  produkt_kod  text not null references public.produkty(kod),
  stav         text not null check (stav in ('sklad','krcmicka','vydany')),
  prijaty      timestamptz not null default now(),
  expiracia    timestamptz,
  vydany       timestamptz,
  objednavka   text,
  rozvoz       text,
  upraveny     timestamptz not null default now()
);
create index if not exists baliky_produkt_stav on public.baliky (produkt_kod, stav);

-- História pohybov – každý sken aj ručná úprava (kto, kedy, čo)
create table if not exists public.pohyby (
  id           bigint generated always as identity primary key,
  scan_id      text unique,
  balik_kod    text,
  produkt_kod  text,
  akcia        text not null,           -- prijem | krcmicka | vydaj | rucny_vydaj | uprava | zmazanie | import
  zo_stavu     text,
  na_stav      text,
  vysledok     text,                    -- text pre používateľa
  ok           boolean not null default true,
  kto          uuid default auth.uid(),
  zariadenie   text,
  objednavka   text,
  rozvoz       text,
  poznamka     text,
  cas          timestamptz not null default now()
);
create index if not exists pohyby_balik on public.pohyby (balik_kod, cas desc);
create index if not exists pohyby_cas on public.pohyby (cas desc);

-- Stav skladu podľa produktu
create or replace view public.stav_skladu with (security_invoker = true) as
  select p.kod, p.nazov, p.farba, p.typ,
         count(*) filter (where b.stav = 'sklad')    as hlavny,
         count(*) filter (where b.stav = 'krcmicka') as krcmicka
  from public.produkty p
  left join public.baliky b on b.produkt_kod = p.kod and b.stav in ('sklad','krcmicka')
  where p.aktivny
  group by p.kod, p.nazov, p.farba, p.typ;

-- ---------- pomocné: kód balíka a SK klávesnica čítačky ----------
create or replace function public.uprav_kod(t text) returns text
language sql immutable as $$
  select upper(translate(regexp_replace(trim(coalesce(t,'')), '[´''’/]', '-', 'g'), '+ľščťžýáíé', '1234567890'))
$$;

-- ---------- jeden sken (volá sa z appky) ----------
-- rezim: 'Príjem' | 'Krčmička' | 'Výdaj'  (rovnaké názvy ako v appke)
-- Opakované odoslanie s rovnakým scan_id vráti pôvodný výsledok a nič nezapíše.
create or replace function public.sken(p_scan_id text, p_kod text, p_rezim text,
                                        p_zariadenie text default null, p_objednavka text default null, p_rozvoz text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kod text := public.uprav_kod(p_kod);
  v_kmen text;
  v_b public.baliky%rowtype;
  v_p public.pohyby%rowtype;
  v_akcia text;
  v_text text;
  v_ok boolean := true;
  v_zo text;
  v_na text;
  v_exp timestamptz;
  v_hl int; v_kr int;
  v_found boolean;
begin
  if not public.som_interny() then
    return jsonb_build_object('scanId', p_scan_id, 'ok', false, 'text', 'Nemáte oprávnenie skenovať');
  end if;

  -- už spracované?
  select * into v_p from public.pohyby where scan_id = p_scan_id;
  if found then
    return jsonb_build_object('scanId', p_scan_id, 'ok', v_p.ok, 'text', v_p.vysledok, 'kod', v_p.balik_kod,
                              'kmen', v_p.produkt_kod, 'duplicitne', true);
  end if;

  v_kmen := case when position('-' in v_kod) > 0 then regexp_replace(v_kod, '-[^-]*$', '') else v_kod end;
  v_akcia := case p_rezim when 'Príjem' then 'prijem' when 'Krčmička' then 'krcmicka' when 'Výdaj' then 'vydaj' else null end;

  if v_kod = '' or v_akcia is null then
    v_ok := false; v_text := case when v_kod = '' then 'Prázdny kód' else 'Neznámy režim: ' || coalesce(p_rezim,'') end;
  elsif not exists (select 1 from public.produkty where kod = v_kmen and aktivny) then
    v_ok := false; v_text := 'Kód ' || v_kod || ' nie je v Zozname produktov';
  else
    select * into v_b from public.baliky where kod = v_kod for update;
    v_found := found;
    v_zo := v_b.stav;

    if v_akcia = 'prijem' then
      if v_found and v_b.stav = 'sklad' then
        v_ok := false; v_text := 'Už je na sklade (prijatý ' || to_char(v_b.prijaty at time zone 'Europe/Bratislava', 'DD.MM. HH24:MI') || ')';
      elsif v_found and v_b.stav = 'krcmicka' then
        v_ok := false; v_text := 'Balík je v Krčmičke';
      else
        v_na := 'sklad';
        v_exp := coalesce(v_b.expiracia, now() + interval '3 months');
        insert into public.baliky (kod, produkt_kod, stav, prijaty, expiracia)
          values (v_kod, v_kmen, 'sklad', now(), v_exp)
          on conflict (kod) do update set stav = 'sklad', prijaty = now(), vydany = null, objednavka = null, rozvoz = null, upraveny = now();
        v_text := 'Prijaté';
      end if;

    elsif v_akcia = 'krcmicka' then
      if v_found and v_b.stav = 'krcmicka' then
        v_ok := false; v_text := 'Už je v Krčmičke';
      elsif v_found and v_b.stav = 'sklad' then
        v_na := 'krcmicka';
        update public.baliky set stav = 'krcmicka', upraveny = now() where kod = v_kod;
        v_text := 'Presunuté do Krčmičky';
      else
        v_na := 'krcmicka';
        v_exp := coalesce(v_b.expiracia, now() + interval '3 months');
        insert into public.baliky (kod, produkt_kod, stav, prijaty, expiracia)
          values (v_kod, v_kmen, 'krcmicka', now(), v_exp)
          on conflict (kod) do update set stav = 'krcmicka', prijaty = now(), vydany = null, objednavka = null, rozvoz = null, upraveny = now();
        v_text := 'Priamo do Krčmičky';
      end if;

    else -- vydaj
      if v_found and v_b.stav in ('sklad','krcmicka') then
        v_na := 'vydany';
        update public.baliky set stav = 'vydany', vydany = now(), objednavka = p_objednavka, rozvoz = p_rozvoz, upraveny = now()
          where kod = v_kod;
        v_text := 'Vydané';
      elsif v_found then
        if p_objednavka is not null and upper(coalesce(v_b.objednavka,'')) = upper(p_objednavka) then
          v_text := 'Už vydané pre túto objednávku';
        else
          v_ok := false; v_text := 'Balík už bol vydaný (' || to_char(v_b.vydany at time zone 'Europe/Bratislava', 'DD.MM. HH24:MI') || ')';
        end if;
      else
        v_ok := false; v_text := 'Balík nie je na sklade ani v Krčmičke';
      end if;
    end if;
  end if;

  insert into public.pohyby (scan_id, balik_kod, produkt_kod, akcia, zo_stavu, na_stav, vysledok, ok, zariadenie, objednavka, rozvoz)
    values (p_scan_id, v_kod, v_kmen, coalesce(v_akcia, 'neznamy'), v_zo, v_na, v_text, v_ok, p_zariadenie, p_objednavka, p_rozvoz);

  select count(*) filter (where stav = 'sklad'), count(*) filter (where stav = 'krcmicka')
    into v_hl, v_kr from public.baliky where produkt_kod = v_kmen;

  return jsonb_build_object('scanId', p_scan_id, 'ok', v_ok, 'text', v_text, 'kod', v_kod, 'kmen', v_kmen,
                            'pocet', jsonb_build_object('hlavny', v_hl, 'krcmicka', v_kr),
                            'expiracia', case when v_exp is not null then to_char(v_exp at time zone 'Europe/Bratislava', 'FMDD.FMMM.YYYY') end);
end $$;

-- Dávka skenov naraz (appka posiela neodoslané skeny z fronty)
create or replace function public.skeny(p_skeny jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; vysledky jsonb := '[]'::jsonb;
begin
  for s in select * from jsonb_array_elements(coalesce(p_skeny, '[]'::jsonb)) loop
    vysledky := vysledky || public.sken(s->>'scanId', s->>'kod', s->>'rezim', s->>'zariadenie', s->>'objednavka', s->>'rozvoz');
  end loop;
  return jsonb_build_object('ok', true, 'vysledky', vysledky);
end $$;

-- Ručná úprava balíka (len IT a CEO): stav, expirácia, zmazanie
create or replace function public.uprav_balik(p_kod text, p_stav text default null, p_expiracia timestamptz default null,
                                               p_zmazat boolean default false, p_poznamka text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_kod text := public.uprav_kod(p_kod); v_b public.baliky%rowtype; v_kmen text;
begin
  if not public.som_spravca() then return jsonb_build_object('ok', false, 'text', 'Len IT a CEO môžu upravovať sklad'); end if;
  select * into v_b from public.baliky where kod = v_kod for update;
  v_kmen := coalesce(v_b.produkt_kod, regexp_replace(v_kod, '-[^-]*$', ''));
  if p_zmazat then
    if not found then return jsonb_build_object('ok', false, 'text', 'Balík neexistuje'); end if;
    delete from public.baliky where kod = v_kod;
    insert into public.pohyby (balik_kod, produkt_kod, akcia, zo_stavu, vysledok, poznamka) values (v_kod, v_kmen, 'zmazanie', v_b.stav, 'Zmazané ručne', p_poznamka);
    return jsonb_build_object('ok', true, 'text', 'Balík zmazaný');
  end if;
  if p_stav is not null and p_stav not in ('sklad','krcmicka','vydany') then
    return jsonb_build_object('ok', false, 'text', 'Neplatný stav');
  end if;
  if not found then
    if not exists (select 1 from public.produkty where kod = v_kmen) then
      return jsonb_build_object('ok', false, 'text', 'Produkt ' || v_kmen || ' nie je v Zozname produktov');
    end if;
    insert into public.baliky (kod, produkt_kod, stav, expiracia)
      values (v_kod, v_kmen, coalesce(p_stav,'sklad'), coalesce(p_expiracia, now() + interval '3 months'));
  else
    update public.baliky set stav = coalesce(p_stav, stav), expiracia = coalesce(p_expiracia, expiracia),
      vydany = case when coalesce(p_stav, stav) = 'vydany' then coalesce(vydany, now()) else null end, upraveny = now()
      where kod = v_kod;
  end if;
  insert into public.pohyby (balik_kod, produkt_kod, akcia, zo_stavu, na_stav, vysledok, poznamka)
    values (v_kod, v_kmen, case when p_stav = 'vydany' then 'rucny_vydaj' else 'uprava' end, v_b.stav, coalesce(p_stav, v_b.stav, 'sklad'), 'Upravené ručne', p_poznamka);
  return jsonb_build_object('ok', true, 'text', 'Uložené');
end $$;

-- Stav skladu + expirácie pre appku (to isté, čo dnes GET_SKLAD)
create or replace function public.stav_skladu_appka()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.som_interny() then jsonb_build_object('ok', false, 'chyba', 'Nemáte oprávnenie') else
  jsonb_build_object('ok', true, 'cas', to_char(now() at time zone 'Europe/Bratislava', 'HH24:MI'),
    'skladItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kod', s.kod, 'nazov', s.nazov, 'farba', s.farba,
        'pocetHlavny', s.hlavny::text, 'pocetKrcmicka', s.krcmicka::text,
        'expiracie', coalesce((
          select jsonb_agg(jsonb_build_object(
            'unikatnyKod', b.kod,
            'datum', case when b.expiracia::date < current_date then (current_date - b.expiracia::date) || ' dní po expirácii: '
                          when b.expiracia::date = current_date then 'Expiruje DNES: '
                          else 'Zostáva ' || (b.expiracia::date - current_date) || ' dní: ' end
                     || to_char(b.expiracia, 'FMDD.FMMM.YYYY') || case when b.stav = 'krcmicka' then ' 🏪' else '' end,
            'farba', case when b.expiracia::date - current_date <= 7 then '#fce8e6' else '#fef0db' end) order by b.expiracia)
          from public.baliky b
          where b.produkt_kod = s.kod and b.stav in ('sklad','krcmicka') and b.expiracia::date - current_date <= 30), '[]'::jsonb)
      ) order by s.nazov) from public.stav_skladu s), '[]'::jsonb))
  end
$$;

-- =========================================================================
-- 4) ZABEZPEČENIE: GRANT (kto sa vôbec dostane k objektu) + RLS (ktoré riadky)
-- =========================================================================
grant usage on schema public to anon, authenticated;

alter table public.roly     enable row level security;
alter table public.moduly   enable row level security;
alter table public.pristupy enable row level security;
alter table public.profily  enable row level security;
alter table public.produkty enable row level security;
alter table public.baliky   enable row level security;
alter table public.pohyby   enable row level security;

grant select on public.roly, public.moduly, public.pristupy to authenticated;
grant select, update on public.profily to authenticated;
grant select, insert, update on public.produkty to authenticated;
grant select on public.baliky, public.pohyby, public.stav_skladu to authenticated;

drop policy if exists "roly citanie" on public.roly;
create policy "roly citanie" on public.roly for select to authenticated using (true);
drop policy if exists "moduly citanie" on public.moduly;
create policy "moduly citanie" on public.moduly for select to authenticated using (true);
drop policy if exists "pristupy citanie" on public.pristupy;
create policy "pristupy citanie" on public.pristupy for select to authenticated using (true);

drop policy if exists "vlastny profil" on public.profily;
create policy "vlastny profil" on public.profily for select to authenticated
  using (id = auth.uid() or public.som_spravca());
drop policy if exists "spravca upravuje profily" on public.profily;
create policy "spravca upravuje profily" on public.profily for update to authenticated
  using (public.som_spravca()) with check (public.som_spravca());

drop policy if exists "produkty citanie" on public.produkty;
create policy "produkty citanie" on public.produkty for select to authenticated using (public.som_interny());
drop policy if exists "produkty uprava" on public.produkty;
create policy "produkty uprava" on public.produkty for all to authenticated
  using (public.som_spravca()) with check (public.som_spravca());

drop policy if exists "baliky citanie" on public.baliky;
create policy "baliky citanie" on public.baliky for select to authenticated using (public.som_interny());
drop policy if exists "pohyby citanie" on public.pohyby;
create policy "pohyby citanie" on public.pohyby for select to authenticated using (public.som_interny());

-- Funkcie smie volať len prihlásený používateľ (oprávnenie sa ešte kontroluje vo vnútri)
revoke all on function public.sken(text,text,text,text,text,text), public.skeny(jsonb),
  public.uprav_balik(text,text,timestamptz,boolean,text), public.stav_skladu_appka() from public, anon;
grant execute on function public.sken(text,text,text,text,text,text), public.skeny(jsonb),
  public.uprav_balik(text,text,timestamptz,boolean,text), public.stav_skladu_appka(),
  public.moje_moduly(), public.moja_rola() to authenticated;

-- =========================================================================
-- 5) PRENOS ZO STARÉHO SKLADU (Google tabuľka) – len IT a CEO
-- Spúšťa sa tlačidlom v appke (Sklad → Správa). Dá sa zopakovať (napr. v deň ostrého spustenia):
-- balíky v appke sa nahradia stavom zo starej tabuľky, história (pohyby) ostáva.
-- p_produkty: [{kod, nazov, farba}]   p_baliky: [{kod, kmen, stav: 'sklad'|'krcmicka', prijaty, expiracia}]
-- =========================================================================
create or replace function public.import_zo_stareho(p_produkty jsonb, p_baliky jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prod int; v_bal int; v_vyr int;
begin
  if not public.som_spravca() then return jsonb_build_object('ok', false, 'text', 'Len IT a CEO môžu prenášať sklad'); end if;

  -- produkty (Zoznam produktov)
  insert into public.produkty (kod, nazov, farba)
    select distinct on (public.uprav_kod(x->>'kod')) public.uprav_kod(x->>'kod'),
           coalesce(nullif(trim(x->>'nazov'), ''), public.uprav_kod(x->>'kod')),
           coalesce(nullif(trim(x->>'farba'), ''), '#ffffff')
    from jsonb_array_elements(coalesce(p_produkty, '[]'::jsonb)) x
    where public.uprav_kod(x->>'kod') <> ''
  on conflict (kod) do update set nazov = excluded.nazov, farba = excluded.farba, aktivny = true, upraveny = now();
  get diagnostics v_prod = row_count;

  -- balíky z tabuľky (jeden kód raz, neznámy produkt sa doplní s kódom ako názvom)
  create temp table if not exists _imp (kod text primary key, kmen text, stav text, prijaty timestamptz, expiracia timestamptz) on commit drop;
  truncate _imp;
  insert into _imp
    select distinct on (public.uprav_kod(x->>'kod')) public.uprav_kod(x->>'kod'),
           public.uprav_kod(coalesce(nullif(x->>'kmen', ''), regexp_replace(x->>'kod', '-[^-]*$', ''))),
           case when x->>'stav' = 'krcmicka' then 'krcmicka' else 'sklad' end,
           coalesce(nullif(x->>'prijaty', '')::timestamptz, now()),
           nullif(x->>'expiracia', '')::timestamptz
    from jsonb_array_elements(coalesce(p_baliky, '[]'::jsonb)) x
    where public.uprav_kod(x->>'kod') <> ''
    order by public.uprav_kod(x->>'kod'), nullif(x->>'prijaty', '')::timestamptz desc nulls last;

  insert into public.produkty (kod, nazov) select distinct kmen, kmen from _imp on conflict (kod) do nothing;

  -- čo je v appke na sklade, ale v starej tabuľke už nie → vydané
  update public.baliky b set stav = 'vydany', vydany = coalesce(b.vydany, now()), upraveny = now()
    where b.stav in ('sklad','krcmicka') and not exists (select 1 from _imp i where i.kod = b.kod);
  get diagnostics v_vyr = row_count;

  insert into public.baliky (kod, produkt_kod, stav, prijaty, expiracia)
    select kod, kmen, stav, prijaty, coalesce(expiracia, prijaty + interval '3 months') from _imp
  on conflict (kod) do update set produkt_kod = excluded.produkt_kod, stav = excluded.stav, prijaty = excluded.prijaty,
    expiracia = excluded.expiracia, vydany = null, objednavka = null, rozvoz = null, upraveny = now();
  get diagnostics v_bal = row_count;

  insert into public.pohyby (akcia, ok, vysledok, poznamka)
    values ('import', true, 'Prenos zo starého skladu', v_prod || ' produktov, ' || v_bal || ' balíkov, ' || v_vyr || ' vyradených');

  return jsonb_build_object('ok', true, 'produkty', v_prod, 'baliky', v_bal, 'vyradene', v_vyr);
end $$;

revoke all on function public.import_zo_stareho(jsonb, jsonb) from public, anon;
grant execute on function public.import_zo_stareho(jsonb, jsonb) to authenticated;
