-- LBZ aplikácia – databáza (Supabase / PostgreSQL)
-- Verzia 0.5 – 30. 9. 2026: roly, profily, sklad, prenos zo starého skladu, používatelia, FURMANKY (objednávky z Upgates)
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

-- =========================================================================
-- 6) POUŽÍVATELIA – vopred pridané e-maily s rolou (pozvánky)
-- IT/CEO pridá e-mail a rolu; keď sa človek prvýkrát prihlási (Google alebo e-mail),
-- dostane automaticky túto rolu a meno. Spravuje sa v appke: Nastavenia → Používatelia.
-- =========================================================================
create table if not exists public.pozvanky (
  email      text primary key check (email = lower(trim(email))),
  meno       text,
  rola       text not null references public.roly(kod),
  aktivny    boolean not null default true,
  vytvorena  timestamptz not null default now(),
  kto        uuid default auth.uid()
);

-- nový účet → rola a meno z pozvánky
create or replace function public.novy_profil() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_p public.pozvanky%rowtype;
begin
  select * into v_p from public.pozvanky where email = lower(trim(new.email));
  insert into public.profily (id, email, meno, rola, aktivny)
  values (new.id, lower(new.email),
          coalesce(v_p.meno, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
          coalesce(v_p.rola, 'zakaznik'), coalesce(v_p.aktivny, true))
  on conflict (id) do nothing;
  return new;
end $$;

-- zmena pozvánky → prenesie sa aj do existujúceho účtu
create or replace function public.pozvanka_do_profilu() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profily set rola = new.rola, aktivny = new.aktivny, meno = coalesce(new.meno, meno)
    where lower(email) = new.email;
  return new;
end $$;
drop trigger if exists pozvanka_zmena on public.pozvanky;
create trigger pozvanka_zmena after insert or update on public.pozvanky
  for each row execute function public.pozvanka_do_profilu();

-- zoznam pre obrazovku Používatelia (len IT a CEO)
create or replace function public.pouzivatelia()
returns table (email text, meno text, rola text, aktivny boolean, ucet boolean, posledne_prihlasenie timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(z.email, lower(p.email)), coalesce(p.meno, z.meno), coalesce(p.rola, z.rola), coalesce(p.aktivny, z.aktivny),
         p.id is not null, u.last_sign_in_at
  from public.pozvanky z
  full join public.profily p on lower(p.email) = z.email
  left join auth.users u on u.id = p.id
  where public.som_spravca()
  order by 3, 2
$$;

-- pridať / upraviť používateľa (len IT a CEO); seba nemožno vypnúť ani odobrať správcu
create or replace function public.nastav_pouzivatela(p_email text, p_meno text, p_rola text, p_aktivny boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_moj text;
begin
  if not public.som_spravca() then return jsonb_build_object('ok', false, 'text', 'Len IT a CEO môžu spravovať používateľov'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'text', 'Neplatný e-mail'); end if;
  if not exists (select 1 from public.roly where kod = p_rola) then return jsonb_build_object('ok', false, 'text', 'Neznáma rola'); end if;
  select lower(email) into v_moj from public.profily where id = auth.uid();
  if v_email = v_moj and (p_rola not in ('it','ceo') or not p_aktivny) then
    return jsonb_build_object('ok', false, 'text', 'Vlastný účet si nemôžete vypnúť ani odobrať správcu');
  end if;
  insert into public.pozvanky (email, meno, rola, aktivny) values (v_email, nullif(trim(p_meno), ''), p_rola, coalesce(p_aktivny, true))
    on conflict (email) do update set meno = coalesce(excluded.meno, pozvanky.meno), rola = excluded.rola, aktivny = excluded.aktivny;
  return jsonb_build_object('ok', true, 'text', 'Uložené');
end $$;

alter table public.pozvanky enable row level security;
grant select on public.pozvanky to authenticated;
drop policy if exists "pozvanky spravca" on public.pozvanky;
create policy "pozvanky spravca" on public.pozvanky for select to authenticated using (public.som_spravca());

revoke all on function public.pouzivatelia(), public.nastav_pouzivatela(text,text,text,boolean) from public, anon;
grant execute on function public.pouzivatelia(), public.nastav_pouzivatela(text,text,text,boolean) to authenticated;

-- Dnešné skeny zo všetkých zariadení (pre Skenovanie) – s menom, kto skenoval
create or replace function public.dnesne_skeny(p_limit int default 300)
returns table (scan_id text, balik_kod text, produkt_kod text, akcia text, vysledok text, ok boolean, cas timestamptz, zariadenie text, meno text)
language sql stable security definer set search_path = public as $$
  select h.scan_id, h.balik_kod, h.produkt_kod, h.akcia, h.vysledok, h.ok, h.cas, h.zariadenie, p.meno
  from public.pohyby h left join public.profily p on p.id = h.kto
  where public.som_interny()
    and h.cas >= (date_trunc('day', now() at time zone 'Europe/Bratislava') at time zone 'Europe/Bratislava')
    and h.akcia in ('prijem','krcmicka','vydaj','rucny_vydaj','uprava','zmazanie')
  order by h.cas desc
  limit least(coalesce(p_limit, 300), 1000)
$$;
revoke all on function public.dnesne_skeny(int) from public, anon;
grant execute on function public.dnesne_skeny(int) to authenticated;

-- =========================================================================
-- 7) PRÍSTUPY 29. 9. 2026: osobné účty zamestnancov = len dochádzka;
--    sklad/balenie cez spoločný účet prevadzka@; furmanky len IT, CEO, zákaznícky servis
-- =========================================================================
insert into public.roly (kod, nazov, interna) values ('zamestnanec', 'Zamestnanec (osobný účet)', false)
  on conflict (kod) do update set nazov = excluded.nazov, interna = excluded.interna;
update public.moduly set aktivny = true where kod = 'balenie';
delete from public.pristupy where (rola = 'prevadzka' and modul = 'furmanky') or (rola = 'furman' and modul = 'furmanky');
insert into public.pristupy (rola, modul, uprava) values
  ('zamestnanec','prehlad',true), ('zamestnanec','dochadzka',true),
  ('zakaznicky_servis','balenie',true), ('zakaznicky_servis','sklad',true), ('zakaznicky_servis','trasa',true)
on conflict do nothing;

-- =========================================================================
-- 8) FURMANKY – objednávky z Upgates priamo v appke (30. 9. 2026)
--    Sťahovanie: Edge Function „upgates-sync“ (6:00, 11:30, 14:00 + tlačidlo). Počas testu z Upgates LEN ČÍTA.
--    Pravidlá zaradenia rovnaké ako v skripte „Objednavky eshop“ (mesto → PSČ, Osobný odber, Elektronicky, NEZARADENÉ),
--    termíny z Google Kalendára, uzávierka deň vopred 11:00 alebo kapacita trasy > 11,75 h.
--    Vidia a upravujú: IT, CEO, zákaznícky servis. Všetko ide cez funkcie nižšie (tabuľky nie sú priamo prístupné).
-- =========================================================================
create or replace function public.som_furmankar() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.moja_rola() in ('it','ceo','zakaznicky_servis'), false)
$$;

-- bez diakritiky, malými písmenami (ako normalize("NFD") v skriptoch)
create or replace function public.norm_text(t text) returns text
language sql immutable as $$
  select lower(trim(translate(coalesce(t, ''), 'áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉĚÍĹĽŇÓÔÖŔŘŠŤÚŮÜÝŽ', 'aacdeeillnooorrstuuuyzAACDEEILLNOOORRSTUUUYZ')))
$$;

-- Regióny (mapa miest a PSČ zo skriptu – „Globalna konfiguracia“)
create table if not exists public.furmanky_regiony (
  region    text primary key,
  poradie   int  not null,              -- poradie v appke
  hladanie  int,                        -- poradie pri hľadaní mesta/PSČ (ako v skripte)
  rozvoz    boolean not null default true,
  kluc      text,                       -- kontrola zvolenej dopravy
  mesta     text[] not null default '{}',
  psc       text[] not null default '{}'
);
insert into public.furmanky_regiony (region, poradie, hladanie, rozvoz, kluc, mesta, psc) values
  ('Stredná', 1, 2, true, 'stredn',
    array['banska bystrica','banska stiavnica','brezno','detva','krupina','lucenec','poltar','revuca','rimavska sobota','velky krtis','zvolen','zarnovica','ziar nad hronom','polomka','helpa','zavadka','benus','tisovec','hnusta','kokava','valaska','podbrezova','brusno','slovenska lupca','badin','vlkanova','viglas','stozok','hlinik'],
    array['974','976','977','960','962','963','965','966','969','990','991','984','985','986','987','979','980','981','982','050']),
  ('Západná', 2, 1, true, 'zapadn',
    array['bratislava','hlohovec','malacky','myjava','nitra','pezinok','piestany','senec','senica','skalica','trnava','zlate moravce'],
    array['81','82','83','84','85','900','901','902','903','905','906','907','908','909','917','918','919','920','921','922','949','951','968','952','953']),
  ('Južná', 3, 3, true, 'juzn',
    array['galanta','dunajska streda','sala','nove zamky','komarno','levice','sturovo','zeliezovce'],
    array['924','925','927','929','930','931','945','946','947','940','941','942','934','935','936','937']),
  ('Prešovská', 4, 4, true, 'presov',
    array['bardejov','humenne','kezmarok','levoca','medzilaborce','poprad','presov','sabinov','snina','stara lubovna','stropkov','gelnica','spisska nova ves','svidnik','vranov nad toplou','svit','vysoke tatry'],
    array['080','081','082','083','085','086','089','090','091','093','094','066','061','067','069','068','058','059','060','064','065','054','052','053']),
  ('Košická', 5, 5, true, 'kosic',
    array['kosice','michalovce','roznava','sobrance','trebisov','moldava nad bodvou','kralovsky chlmec'],
    array['040','044','048','049','056','071','072','073','075','076','077','078']),
  ('Severná', 6, 6, true, 'severn',
    array['banovce nad bebravou','bytca','cadca','dolny kubin','ilava','kysucke nove mesto','liptovsky mikulas','martin','namestovo','nove mesto nad vahom','partizanske','povazska bystrica','prievidza','puchov','ruzomberok','topolcany','trencin','turcianske teplice','tvrdosin','zilina','dubnica nad vahom','krasno nad kysucou'],
    array['911','913','914','915','916','955','956','957','958','971','972','010','013','014','017','018','019','020','022','023','024','026','027','029','031','032','034','036','038','039']),
  ('Osobný odber', 7, null, false, null, '{}', '{}'),
  ('Elektronicky', 8, null, false, null, '{}', '{}'),
  ('NEZARADENÉ',   9, null, false, null, '{}', '{}')
on conflict (region) do update set poradie = excluded.poradie, hladanie = excluded.hladanie, rozvoz = excluded.rozvoz,
  kluc = excluded.kluc, mesta = excluded.mesta, psc = excluded.psc;

-- Zaradenie do regiónu (sortOrdersToRegions)
create or replace function public.region_pre(p_doprava text, p_mesto text, p_psc text) returns text
language plpgsql stable set search_path = public as $$
declare v_ship text := public.norm_text(p_doprava); v_mesto text := public.norm_text(p_mesto);
        v_psc text := regexp_replace(coalesce(p_psc, ''), '\s', '', 'g'); r record;
begin
  if v_ship like '%zbojska%' then return 'Osobný odber'; end if;
  if v_ship like '%elektronicky%' then return 'Elektronicky'; end if;
  for r in select region, mesta from public.furmanky_regiony where rozvoz order by hladanie loop
    if v_mesto <> '' and exists (select 1 from unnest(r.mesta) m where position(m in v_mesto) > 0) then return r.region; end if;
  end loop;
  for r in select region, psc from public.furmanky_regiony where rozvoz order by hladanie loop
    if v_psc <> '' and (left(v_psc, 3) = any(r.psc) or left(v_psc, 2) = any(r.psc)) then return r.region; end if;
  end loop;
  return 'NEZARADENÉ';
end $$;

-- Upozornenie, keď zákazník zaklikol inú dopravu, než kam patrí adresa (do Upgates sa počas testu nezapisuje)
create or replace function public.zla_doprava(p_region text, p_doprava text) returns text
language sql stable set search_path = public as $$
  select case when r.rozvoz and public.norm_text(p_doprava) not like '%' || r.kluc || '%'
                   and public.norm_text(p_doprava) not like '%velko%'
              then '[POZOR ZLÁ DOPRAVA: Zákazník zaklikol -> ' || public.norm_text(p_doprava) || ' | ZARADENÉ DO: ' || r.region || ']' end
  from public.furmanky_regiony r where r.region = p_region
$$;

-- Statusy, ktoré sa berú (targetStatuses)
create or replace function public.ziva_objednavka(p_status text) returns boolean
language sql immutable as $$
  select exists (select 1 from unnest(array['prijata','platba prebieha','platba uspesna','platba zlyhala','platba zrusena',
                                            'nedoriesena','reklamacia','spracovane nerozvezene']) s
                 where position(s in public.norm_text(p_status)) > 0)
$$;

-- Šablóna tabuľky (hárok „Default“ zo Správy objednávok: riadky 10–145, vzorce R1C1, farby)
create table if not exists public.furmanky_sablona (
  riadok        int primary key,
  kod           text,
  kategoria     text,
  nazov         text not null,
  typ           text not null check (typ in ('produkt','sucet','info','suma')),
  vzorec_ks     text,          -- stĺpec D „Spolu ks“
  vzorec_davky  text,          -- stĺpec E „Spolu dávok“
  farba         text
);
insert into public.furmanky_sablona (riadok, kod, kategoria, nazov, typ, vzorec_ks, vzorec_davky, farba) values
  (10, 'P00013', 'Buchty hotové', 'Buchta cokoladova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (11, 'FP000026', 'Buchty hotové', 'Buchta cokoladova s malinami', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (12, 'P00027', 'Buchty hotové', 'Buchta cucoriedkova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (13, 'P00014', 'Buchty hotové', 'Buchta jablkovo skoricova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (14, 'P00012', 'Buchty hotové', 'Buchta jahodova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (15, 'P00046', 'Buchty hotové', 'Buchta keksikova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (16, 'P00021', 'Buchty hotové', 'Buchta makovo visnova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (17, 'P00134', 'Buchty hotové', 'Buchta mango s marakujou', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (18, 'FP000065', 'Buchty hotové', 'Buchta marhulove novinka', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (19, 'P00023', 'Buchty hotové', 'Buchta orechova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (20, 'FP000014', 'Buchty hotové', 'Buchta s ruzovou cokoladou a celymi jahodami', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (21, 'P00018', 'Buchty hotové', 'Buchta slivkova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (22, 'FP000069', 'Buchty hotové', 'Buchta spenatova s horenronskym syrom', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (23, 'P00019', 'Buchty hotové', 'Buchta tvarohova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (24, 'P00020', 'Buchty hotové', 'Buchta vanilkovo cucoriedkova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (25, 'FP000064', 'Buchty hotové', 'Buchta vanilkovo malinova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (26, null, null, 'Čerstvé sladké spolu', 'sucet', 'SUM(R[-16]C[0]:R[-1]C[0])', 'SUM(R[-16]C[0]:R[-1]C[0])', '#fff2cc'),
  (27, 'P00024', 'Buchty hotové', 'Buchta oskvarkovo cesnakovo syrova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (28, 'P00025', 'Buchty hotové', 'Buchta oskvarkovo kapustova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (29, 'P00026', 'Buchty hotové', 'Buchta oskvarkovo slivkova', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/60', '#fff2cc'),
  (30, null, null, 'Čerstvé škvarkové spolu', 'sucet', 'SUM(R[-3]C[0]:R[-1]C[0])', 'SUM(R[-3]C[0]:R[-1]C[0])', '#fff2cc'),
  (31, 'FP000058', 'Buchty hotové', 'Poskrucanec', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/16', '#fff2cc'),
  (32, 'FP000039', 'Buchty hotové', 'Buchta mini upečená', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/30', '#fff2cc'),
  (33, null, null, 'ČERSTVÉ SPOLU', 'sucet', 'R[-7]C[0]+R[-3]C[0]+R[-2]C[0]+R[-1]C[0]', 'R[-7]C[0]+R[-3]C[0]+R[-2]C[0]+R[-1]C[0]', '#ff0000'),
  (34, 'FP000061', 'Buchty na pečenie', 'Poskrucanec mrazeny', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/16', '#cfe2f3'),
  (35, 'FP000025-3', 'Buchty na pečenie', 'Buchty cokolada s malinami 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (36, 'P00017-3', 'Buchty na pečenie', 'Buchty cokoladove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (37, 'P00031-3', 'Buchty na pečenie', 'Buchty cucoriedkove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (38, 'P00122-3', 'Buchty na pečenie', 'Buchty jablkovo skoricove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (39, 'P00016-3', 'Buchty na pečenie', 'Buchty jahodova 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (40, 'FP000049-2', 'Buchty na pečenie', 'Buchty keksikove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (41, 'P00045-3', 'Buchty na pečenie', 'Buchty makovo visnove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (42, 'P00132-3', 'Buchty na pečenie', 'Buchty mango s marakujou 1 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (43, 'FP000067-3', 'Buchty na pečenie', 'Buchty marhulove novinka 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (44, 'P00039-3', 'Buchty na pečenie', 'Buchty orechove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (45, 'FP000016-3', 'Buchty na pečenie', 'Buchty ruzove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (46, 'P00037-3', 'Buchty na pečenie', 'Buchty slivkove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (47, 'FP000073-3', 'Buchty na pečenie', 'Buchty spenatove s horehronskym syrom 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (48, 'P00032-3', 'Buchty na pečenie', 'Buchty tvarohove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (49, 'P00038-3', 'Buchty na pečenie', 'Buchty vanilkovo cucoriedkove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (50, 'FP000062-3', 'Buchty na pečenie', 'Buchty vanilkovo malinove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (51, null, null, 'medzisúčet', 'sucet', 'SUM(R[-17]C[0]:R[-1]C[0])', 'SUM(R[-17]C[0]:R[-1]C[0])', null),
  (52, 'P00040-3', 'Buchty na pečenie', 'Buchty oskvarkovo cesnakovo syrove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (53, 'P00114-3', 'Buchty na pečenie', 'Buchty oskvarkovo kapustove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (54, 'P00041-3', 'Buchty na pečenie', 'Buchty oskvarkovo slivkove 5ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/12', '#cfe2f3'),
  (55, null, null, 'medzisúčet', 'sucet', 'SUM(R[-3]C[0]:R[-1]C[0])', 'SUM(R[-3]C[0]:R[-1]C[0])', null),
  (56, 'FP000050-2', 'Buchty na pečenie', 'Mix buchiet 15 ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (57, 'FP000025-4', 'Buchty na pečenie', 'Buchty cokolada s malinami 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (58, 'P00017-4', 'Buchty na pečenie', 'Buchty cokoladove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (59, 'P00031-4', 'Buchty na pečenie', 'Buchty cucoriedkove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (60, 'P00122-4', 'Buchty na pečenie', 'Buchty jablkovo skoricove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (61, 'P00016-4', 'Buchty na pečenie', 'Buchty jahodova 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (62, 'FP000049-4', 'Buchty na pečenie', 'Buchty keksikove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (63, 'P00045-4', 'Buchty na pečenie', 'Buchty makovo visnove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (64, 'P00132-4', 'Buchty na pečenie', 'Buchty mango s marakujou 1 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (65, 'FP000067-4', 'Buchty na pečenie', 'Buchty marhulove novinka 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (66, 'P00039-4', 'Buchty na pečenie', 'Buchty orechove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (67, 'FP000016-4', 'Buchty na pečenie', 'Buchty ruzove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (68, 'P00037-4', 'Buchty na pečenie', 'Buchty slivkove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (69, 'FP000073-4', 'Buchty na pečenie', 'Buchty spenatove s horehronskym syrom 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (70, 'P00032-4', 'Buchty na pečenie', 'Buchty tvarohove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (71, 'P00038-4', 'Buchty na pečenie', 'Buchty vanilkovo cucoriedkove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (72, 'FP000062-4', 'Buchty na pečenie', 'Buchty vanilkovo malinove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (73, null, null, 'medzisúčet', 'sucet', 'SUM(R[-17]C[0]:R[-1]C[0])', 'SUM(R[-17]C[0]:R[-1]C[0])', null),
  (74, 'P00040-4', 'Buchty na pečenie', 'Buchty oskvarkovo cesnakovo syrove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (75, 'P00114-4', 'Buchty na pečenie', 'Buchty oskvarkovo kapustove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (76, 'P00041-4', 'Buchty na pečenie', 'Buchty oskvarkovo slivkove 15ks standard', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#9fc5e8'),
  (77, null, null, 'medzisúčet', 'sucet', 'SUM(R[-3]C[0]:R[-1]C[0])', 'SUM(R[-3]C[0]:R[-1]C[0])', null),
  (78, 'FP000050-1', 'Buchty na pečenie', 'Mix buchiet 15 ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (79, 'FP000025-1', 'Buchty na pečenie', 'Buchty cokolada s malinami 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (80, 'P00017-1', 'Buchty na pečenie', 'Buchty cokoladove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (81, 'P00031-1', 'Buchty na pečenie', 'Buchty cucoriedkove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (82, 'P00122-1', 'Buchty na pečenie', 'Buchty jablkovo skoricove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (83, 'P00016-1', 'Buchty na pečenie', 'Buchty jahodova 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (84, 'FP000049-1', 'Buchty na pečenie', 'Buchty keksikove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (85, 'P00045-1', 'Buchty na pečenie', 'Buchty makovo visnove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (86, 'P00132-1', 'Buchty na pečenie', 'Buchty mango s marakujou 1 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (87, 'FP000067-1', 'Buchty na pečenie', 'Buchty marhulove novinka 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (88, 'P00039-1', 'Buchty na pečenie', 'Buchty orechove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (89, 'FP000016-1', 'Buchty na pečenie', 'Buchty ruzove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (90, 'P00037-1', 'Buchty na pečenie', 'Buchty slivkove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (91, 'FP000073-1', 'Buchty na pečenie', 'Buchty spenatove s horehronskym syrom 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (92, 'P00032-1', 'Buchty na pečenie', 'Buchty tvarohove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (93, 'P00038-1', 'Buchty na pečenie', 'Buchty vanilkovo cucoriedkove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (94, 'FP000062-1', 'Buchty na pečenie', 'Buchty vanilkovo malinove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (95, null, null, 'medzisúčet', 'sucet', 'SUM(R[-17]C[0]:R[-1]C[0])', 'SUM(R[-17]C[0]:R[-1]C[0])', null),
  (96, 'P00040-1', 'Buchty na pečenie', 'Buchty oskvarkovo cesnakovo syrove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (97, 'P00114-1', 'Buchty na pečenie', 'Buchty oskvarkovo kapustove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (98, 'P00041-1', 'Buchty na pečenie', 'Buchty oskvarkovo slivkove 10ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/6', '#f7caac'),
  (99, null, null, 'medzisúčet', 'sucet', 'SUM(R[-3]C[0]:R[-1]C[0])', 'SUM(R[-3]C[0]:R[-1]C[0])', null),
  (100, 'FP000025-2', 'Buchty na pečenie', 'Buchty cokolada s malinami 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (101, 'P00017-2', 'Buchty na pečenie', 'Buchty cokoladove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (102, 'P00031-2', 'Buchty na pečenie', 'Buchty cucoriedkove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (103, 'P00122-2', 'Buchty na pečenie', 'Buchty jablkovo skoricove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (104, 'P00016-2', 'Buchty na pečenie', 'Buchty jahodova 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (105, 'FP000049-3', 'Buchty na pečenie', 'Buchty keksikove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (106, 'P00045-2', 'Buchty na pečenie', 'Buchty makovo visnove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (107, 'P00132-2', 'Buchty na pečenie', 'Buchty mango s marakujou 1 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (108, 'FP000067-2', 'Buchty na pečenie', 'Buchty marhulove novinka 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (109, 'P00039-2', 'Buchty na pečenie', 'Buchty orechove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (110, 'FP000016-2', 'Buchty na pečenie', 'Buchty ruzove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (111, 'P00037-2', 'Buchty na pečenie', 'Buchty slivkove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (112, 'FP000073-2', 'Buchty na pečenie', 'Buchty spenatove s horehronskym syrom 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (113, 'P00032-2', 'Buchty na pečenie', 'Buchty tvarohove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (114, 'P00038-2', 'Buchty na pečenie', 'Buchty vanilkovo cucoriedkove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (115, 'FP000062-2', 'Buchty na pečenie', 'Buchty vanilkovo malinove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (116, null, null, 'medzisúčet', 'sucet', 'SUM(R[-3]C[0]:R[-1]C[0])', 'SUM(R[-16]C[0]:R[-1]C[0])', null),
  (117, 'P00040-2', 'Buchty na pečenie', 'Buchty oskvarkovo cesnakovo syrove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (118, 'P00114-2', 'Buchty na pečenie', 'Buchty oskvarkovo kapustove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (119, 'P00041-2', 'Buchty na pečenie', 'Buchty oskvarkovo slivkove 30ks mini', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', 'R[0]C[-1]/4', '#fbe4d5'),
  (120, null, null, 'medzisúčet', 'sucet', 'SUM(R[-3]C[0]:R[-1]C[0])', 'SUM(R[-3]C[0]:R[-1]C[0])', null),
  (121, null, null, 'POLOTOVAR SLADKÉ SPOLU', 'sucet', 'R[-5]C[0]+R[-26]C[0]+R[-48]C[0]+R[-70]C[0]+R[-95]C[0]+R[-90]C[0]', 'R[-5]C[0]+R[-26]C[0]+R[-48]C[0]+R[-70]C[0]+R[-95]C[0]+R[-90]C[0]', '#f6e7ca'),
  (122, null, null, 'POLOTOVAR ŠKVARKOVÉ SPOLU', 'sucet', 'R[-23]C[0]+R[-45]C[0]+R[-67]C[0]+R[-92]C[0]', 'R[-23]C[0]+R[-45]C[0]+R[-67]C[0]+R[-92]C[0]', '#f6e7ca'),
  (123, null, null, 'POLOTOVARY SPOLU', 'sucet', 'R[-1]C[0]+R[-2]C[0]', 'R[-1]C[0]+R[-2]C[0]', '#ff0000'),
  (124, null, null, 'celkový súčet', 'info', 'SUM(R[0]C[5]:R[0]C[680])', null, '#f6e7ca'),
  (125, null, null, 'Doručenie 3,00', 'info', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ff0000'),
  (126, null, null, 'Doručenie 5,00', 'info', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ff0000'),
  (127, null, null, 'Doručenie 10,00', 'info', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ff0000'),
  (128, 'P00129', 'Darčekové', 'Darčekové balenie malé', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ff2fe9'),
  (129, 'P00128', 'Darčekové', 'Darčekové balenie veľké', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ff2fe9'),
  (130, 'FP000035', 'Darčekové', 'Plátená taška LBZ', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (131, 'FP000033', 'Darčekové', 'Vosková taška LBZ', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (132, 'FP000032', 'Darčekové', 'Kovový pohár na víno LBZ', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (133, 'FP000030', 'Darčekové', 'Kávový pohár LBZ', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (134, 'FP000031', 'Darčekové', 'Vysivana klucenka LBZ', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (135, 'FP000060-1', 'Darčekové', 'Darčekový poukaz 10€', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (136, 'FP000060-6', 'Darčekové', 'Darčekový poukaz 15€', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (137, 'FP000060-2', 'Darčekové', 'Darčekový poukaz 20€', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (138, 'FP000060-3', 'Darčekové', 'Darčekový poukaz 30€', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (139, 'FP000060-4', 'Darčekové', 'Darčekový poukaz 40€', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (140, 'FP000060-5', 'Darčekové', 'Darčekový poukaz 50€', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#ffc000'),
  (141, 'FP000075-1', 'Buchty hotové', 'Tabuľa TU UPEČENÉ 55x75cm veľká', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#b6d7a8'),
  (142, 'FP000075-2', 'Buchty hotové', 'Tabuľa TU UPEČENÉ 21x29,5cm malá A4', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#b6d7a8'),
  (143, 'FP000074', 'Buchty hotové', 'Zloženie všetkých buchiet- vytlačené A4', 'produkt', 'SUM(R[0]C[5]:R[0]C[680])', null, '#b6d7a8'),
  (144, null, null, 'VŠETKO SPOLU', 'sucet', 'R[-111]C[0]+R[-21]C[0]+R[-16]C[0]+R[-15]C[0]+R[-14]C[0]+R[-13]C[0]+R[-12]C[0]+R[-11]C[0]+R[-10]C[0]+R[-9]C[0]+R[-8]C[0]+R[-7]C[0]+R[-6]C[0]+R[-5]C[0]+R[-4]C[0]', 'R[-111]C[0]+R[-21]C[0]+R[-16]C[0]+R[-15]C[0]+R[-14]C[0]+R[-13]C[0]+R[-12]C[0]+R[-11]C[0]+R[-10]C[0]+R[-9]C[0]+R[-8]C[0]+R[-7]C[0]+R[-6]C[0]+R[-5]C[0]+R[-4]C[0]', '#ff0000'),
  (145, null, null, 'SUMA €', 'suma', null, 'SUM(R[0]C[4]:R[0]C[679])', null)
on conflict (riadok) do nothing;

-- Furmanky = región + dátum (Osobný odber, Elektronicky, NEZARADENÉ a „bez termínu“ majú dátum prázdny)
create table if not exists public.furmanky (
  id              bigint generated always as identity primary key,
  region          text not null references public.furmanky_regiony(region),
  datum           date,
  stav            text not null default 'otvorena' check (stav in ('otvorena','full','rozvezena')),
  v_kalendari     boolean not null default true,
  uzavreta        timestamptz,
  dovod           text,
  trasa_hodiny    numeric(5,2),
  trasa_kontrola  timestamptz,
  trasa_hash      text,
  vytvorena       timestamptz not null default now(),
  unique nulls not distinct (region, datum)
);
alter table public.furmanky add column if not exists trasa_hash text;

create table if not exists public.objednavky (
  cislo          text primary key,
  zdroj          text not null default 'upgates' check (zdroj in ('upgates','rucna')),
  status         text,
  meno           text,
  firma          text,
  telefon        text,
  email          text,
  ulica          text,
  psc            text,
  mesto          text,
  doprava        text,
  platba_nazov   text,
  platba         text,                 -- ZAPLATENÉ | DOBIERKA | NA FAKTÚRU
  suma           numeric(12,2),
  faktura        text,
  poznamka       text,
  upozornenie    text,
  region         text,
  vytvorena      timestamptz,
  zmenena        timestamptz,          -- posledná zmena v Upgates
  stiahnuta      timestamptz,
  rucne_polia    text[] not null default '{}',   -- čo zmenil zákaznícky servis v appke (Upgates to neprepíše)
  upravil        uuid,
  upravena       timestamptz
);
create index if not exists objednavky_region on public.objednavky (region);

create table if not exists public.objednavky_polozky (
  cislo     text not null references public.objednavky(cislo) on delete cascade,
  kod       text not null,
  nazov     text,
  mnozstvo  numeric not null default 0,
  cena      numeric(12,2),
  primary key (cislo, kod)
);

-- V ktorej furmanke je objednávka. rucne = zmenené v appke (automatika ju nepresúva); rucne + bez furmanky = odobratá.
create table if not exists public.zaradenia (
  cislo        text primary key references public.objednavky(cislo) on delete cascade,
  furmanka_id  bigint references public.furmanky(id) on delete set null,
  rucne        boolean not null default false,
  poradie      int,
  kedy         timestamptz not null default now(),
  kto          uuid
);
create index if not exists zaradenia_furmanka on public.zaradenia (furmanka_id);

create table if not exists public.furmanky_log (
  id     bigint generated always as identity primary key,
  cas    timestamptz not null default now(),
  typ    text not null,                -- auto | rucne | objednavka | kapacita | chyba
  kto    uuid,
  ok     boolean not null default true,
  text   text,
  pocet  int
);

create table if not exists public.geokody (
  adresa  text primary key,
  lat     double precision,
  lng     double precision,
  ok      boolean not null default true,
  cas     timestamptz not null default now()
);

create sequence if not exists public.rucne_objednavky_seq;

alter table public.furmanky_regiony   enable row level security;
alter table public.furmanky_sablona   enable row level security;
alter table public.furmanky           enable row level security;
alter table public.objednavky         enable row level security;
alter table public.objednavky_polozky enable row level security;
alter table public.zaradenia          enable row level security;
alter table public.furmanky_log       enable row level security;
alter table public.geokody            enable row level security;

-- ---------- pomocné ----------
create or replace function public.dnes_sk() returns date
language sql stable as $$ select (now() at time zone 'Europe/Bratislava')::date $$;

create or replace function public.furmanka_nazov(p_region text, p_datum date) returns text
language sql immutable as $$
  select p_region || case when p_datum is null then '' else ' ' || to_char(p_datum, 'DD.MM.YYYY') end
$$;

-- furmanka pre región: prvý otvorený termín z kalendára (od zajtra), inak „bez termínu“
create or replace function public.furmanka_pre_region(p_region text) returns bigint
language plpgsql set search_path = public as $$
declare v_id bigint; v_rozvoz boolean;
begin
  select rozvoz into v_rozvoz from public.furmanky_regiony where region = p_region;
  if v_rozvoz is null then p_region := 'NEZARADENÉ'; v_rozvoz := false; end if;
  if v_rozvoz then
    select id into v_id from public.furmanky
      where region = p_region and stav = 'otvorena' and v_kalendari and datum > public.dnes_sk()
      order by datum limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.furmanky (region, datum) values (p_region, null)
    on conflict (region, datum) do update set stav = 'otvorena'
    returning id into v_id;
  return v_id;
end $$;

-- Automatické zaradenie všetkých objednávok (volá sa po stiahnutí a po ručnej zmene)
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

-- ---------- stiahnutie z Upgates (volá LEN Edge Function so service kľúčom) ----------
-- p_obj: [{cislo,status,meno,firma,telefon,email,ulica,psc,mesto,doprava,platba_nazov,platba,suma,faktura,poznamka,vytvorena,zmenena,polozky:[{kod,nazov,mnozstvo,cena}]}]
-- p_terminy: [{region, datum}] z Google Kalendára (null = kalendár sa nepodarilo načítať, termíny ostanú)
-- p_reset: čísla objednávok, pri ktorých sa zahodia ručné zmeny (tlačidlo „Obnoviť z Upgates“)
create or replace function public.furmanky_sync(p_obj jsonb, p_terminy jsonb, p_typ text default 'auto',
                                                p_kto uuid default null, p_reset text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_obj int := 0; v_ter int := 0; v_zar int; v_uz int; v_uzavrete text[];
begin
  if coalesce(array_length(p_reset, 1), 0) > 0 then
    update public.objednavky set rucne_polia = '{}' where cislo = any(p_reset);
  end if;

  create temp table if not exists _sync (x jsonb, cislo text primary key) on commit drop;
  truncate _sync;
  insert into _sync select distinct on (trim(x->>'cislo')) x, trim(x->>'cislo')
    from jsonb_array_elements(coalesce(p_obj, '[]'::jsonb)) x where coalesce(trim(x->>'cislo'), '') <> ''
    order by trim(x->>'cislo'), x->>'zmenena' desc nulls last;
  get diagnostics v_obj = row_count;

  insert into public.objednavky as o (cislo, zdroj, status, meno, firma, telefon, email, ulica, psc, mesto, doprava, platba_nazov,
                                      platba, suma, faktura, poznamka, vytvorena, zmenena, stiahnuta)
  select s.cislo, 'upgates', s.x->>'status', s.x->>'meno', s.x->>'firma', s.x->>'telefon', s.x->>'email', s.x->>'ulica', s.x->>'psc', s.x->>'mesto',
         s.x->>'doprava', s.x->>'platba_nazov', s.x->>'platba', nullif(s.x->>'suma', '')::numeric, nullif(s.x->>'faktura', ''), nullif(s.x->>'poznamka', ''),
         nullif(s.x->>'vytvorena', '')::timestamptz, nullif(s.x->>'zmenena', '')::timestamptz, now()
  from _sync s
  on conflict (cislo) do update set
    status = excluded.status, platba_nazov = excluded.platba_nazov, faktura = excluded.faktura,
    vytvorena = excluded.vytvorena, zmenena = excluded.zmenena, stiahnuta = excluded.stiahnuta,
    meno     = case when 'meno'     = any(o.rucne_polia) then o.meno     else excluded.meno end,
    firma    = case when 'meno'     = any(o.rucne_polia) then o.firma    else excluded.firma end,
    telefon  = case when 'telefon'  = any(o.rucne_polia) then o.telefon  else excluded.telefon end,
    email    = case when 'email'    = any(o.rucne_polia) then o.email    else excluded.email end,
    ulica    = case when 'adresa'   = any(o.rucne_polia) then o.ulica    else excluded.ulica end,
    psc      = case when 'adresa'   = any(o.rucne_polia) then o.psc      else excluded.psc end,
    mesto    = case when 'adresa'   = any(o.rucne_polia) then o.mesto    else excluded.mesto end,
    doprava  = excluded.doprava,
    platba   = case when 'platba'   = any(o.rucne_polia) then o.platba   else excluded.platba end,
    suma     = case when 'suma'     = any(o.rucne_polia) then o.suma     else excluded.suma end,
    poznamka = case when 'poznamka' = any(o.rucne_polia) then o.poznamka else excluded.poznamka end;

  -- položky (ak ich zákaznícky servis neupravoval)
  delete from public.objednavky_polozky p using _sync s, public.objednavky o
   where p.cislo = s.cislo and o.cislo = s.cislo and not ('polozky' = any(o.rucne_polia));
  insert into public.objednavky_polozky (cislo, kod, nazov, mnozstvo, cena)
  select s.cislo, trim(i->>'kod'), max(i->>'nazov'), sum(coalesce(nullif(i->>'mnozstvo', '')::numeric, 0)), max(nullif(i->>'cena', '')::numeric)
  from _sync s join public.objednavky o on o.cislo = s.cislo and not ('polozky' = any(o.rucne_polia))
       cross join lateral jsonb_array_elements(coalesce(s.x->'polozky', '[]'::jsonb)) i
  where coalesce(trim(i->>'kod'), '') <> ''
  group by s.cislo, trim(i->>'kod')
  on conflict (cislo, kod) do nothing;

  update public.objednavky o set region = public.region_pre(o.doprava, o.mesto, o.psc)
    from _sync s where o.cislo = s.cislo;
  update public.objednavky o set upozornenie = public.zla_doprava(o.region, o.doprava)
    from _sync s where o.cislo = s.cislo;

  -- termíny z kalendára
  if p_terminy is not null then
    update public.furmanky f set v_kalendari = false
     where f.datum is not null and f.stav = 'otvorena'
       and not exists (select 1 from jsonb_array_elements(p_terminy) t
                       where t->>'region' = f.region and (t->>'datum')::date = f.datum);
    insert into public.furmanky (region, datum)
      select distinct t->>'region', (t->>'datum')::date from jsonb_array_elements(p_terminy) t
      where exists (select 1 from public.furmanky_regiony r where r.region = t->>'region' and r.rozvoz)
    on conflict (region, datum) do update set v_kalendari = true;
    get diagnostics v_ter = row_count;
  end if;

  v_zar := public.furmanky_prirad();
  with u as (
    update public.furmanky set stav = 'full', uzavreta = now(), dovod = 'Automaticky uzavreté (11:00)'
     where stav = 'otvorena' and datum is not null
       and now() >= ((datum - 1) + time '11:00') at time zone 'Europe/Bratislava'
    returning public.furmanka_nazov(region, datum) n)
  select coalesce(array_agg(n), '{}') into v_uzavrete from u;

  insert into public.furmanky_log (typ, kto, ok, text, pocet)
    values (coalesce(p_typ, 'auto'), p_kto, true,
            'Objednávok ' || v_obj || ', presunov ' || v_zar ||
            case when array_length(v_uzavrete, 1) > 0 then ', uzavreté: ' || array_to_string(v_uzavrete, ', ') else '' end, v_obj);

  return jsonb_build_object('ok', true, 'objednavky', v_obj, 'terminy', v_ter, 'presuny', v_zar, 'uzavrete', to_jsonb(v_uzavrete));
end $$;

-- posledný beh + ochrana pred zbytočným míňaním Upgates API
create or replace function public.furmanky_posledny_beh() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'posledny', (select to_jsonb(l) from (select cas, typ, ok, text from public.furmanky_log where typ in ('auto','rucne') order by cas desc limit 1) l),
    'posledny_ok', (select max(cas) from public.furmanky_log where typ in ('auto','rucne') and ok))
$$;

create or replace function public.furmanky_zapis_log(p_typ text, p_ok boolean, p_text text, p_kto uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into public.furmanky_log (typ, kto, ok, text) values (p_typ, p_kto, p_ok, left(p_text, 2000))
$$;

-- ---------- kapacita trasy (Edge Function počíta cez Google Mapy) ----------
create or replace function public.furmanky_na_kontrolu() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nazov', public.furmanka_nazov(f.region, f.datum), 'hash', f.trasa_hash, 'hodiny', f.trasa_hodiny, 'zastavky',
    (select coalesce(jsonb_agg(jsonb_build_object(
        'cislo', o.cislo,
        'adresa', concat_ws(', ', nullif(o.ulica, ''), nullif(trim(concat_ws(' ', o.psc, o.mesto)), '')),
        'dobierka', coalesce(o.platba, 'DOBIERKA') not in ('ZAPLATENÉ', 'NA FAKTÚRU'),
        'poznamka', o.poznamka) order by z.poradie nulls last, o.vytvorena), '[]'::jsonb)
     from public.zaradenia z join public.objednavky o on o.cislo = z.cislo where z.furmanka_id = f.id)) order by f.datum), '[]'::jsonb)
  from public.furmanky f join public.furmanky_regiony r on r.region = f.region and r.rozvoz
  where f.stav = 'otvorena' and f.datum > public.dnes_sk()
$$;

create or replace function public.furmanky_kapacita(p_id bigint, p_hodiny numeric, p_uzavriet boolean, p_hash text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.furmanky set trasa_hodiny = p_hodiny, trasa_kontrola = now(), trasa_hash = coalesce(p_hash, trasa_hash) where id = p_id;
  if p_uzavriet then
    update public.furmanky set stav = 'full', uzavreta = now(), dovod = 'Kapacita naplnená (>11,75h)' where id = p_id and stav = 'otvorena';
    insert into public.furmanky_log (typ, text) select 'kapacita', 'Uzavretá ' || public.furmanka_nazov(region, datum) || ' – trasa ' || p_hodiny || ' h' from public.furmanky where id = p_id;
  end if;
end $$;

create or replace function public.geokody_daj(p_adresy text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(adresa, jsonb_build_object('lat', lat, 'lng', lng, 'ok', ok)), '{}'::jsonb)
  from public.geokody where adresa = any(p_adresy)
$$;
create or replace function public.geokody_uloz(p jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.geokody (adresa, lat, lng, ok)
  select k, nullif(v->>'lat', '')::float8, nullif(v->>'lng', '')::float8, coalesce((v->>'ok')::boolean, true) from jsonb_each(p) e(k, v)
  on conflict (adresa) do update set lat = excluded.lat, lng = excluded.lng, ok = excluded.ok, cas = now()
$$;

-- token pre plánované spúšťanie (vytvorí sa sám v trezore Supabase, nikto ho nemusí poznať)
create or replace function public.furmanky_cron_ok(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_token, '') <> '' and exists (select 1 from vault.decrypted_secrets where name = 'furmanky_cron' and decrypted_secret = p_token)
$$;

-- ---------- pre appku (IT, CEO, zákaznícky servis) ----------
create or replace function public.furmanky_zoznam() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Furmanky vidí len IT, CEO a zákaznícky servis'); end if;
  return jsonb_build_object('ok', true, 'beh', public.furmanky_posledny_beh(), 'furmanky', coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'region', f.region, 'datum', f.datum, 'nazov', public.furmanka_nazov(f.region, f.datum),
             'stav', f.stav, 'v_kalendari', f.v_kalendari, 'dovod', f.dovod, 'uzavreta', f.uzavreta, 'rozvoz', r.rozvoz,
             'trasa_hodiny', f.trasa_hodiny, 'pocet', coalesce(z.pocet, 0), 'suma', coalesce(z.suma, 0))
           order by (f.datum is null), f.datum, r.poradie)
    from public.furmanky f
    join public.furmanky_regiony r on r.region = f.region
    left join lateral (select count(*) pocet, sum(o.suma) suma from public.zaradenia z join public.objednavky o on o.cislo = z.cislo
                       where z.furmanka_id = f.id) z on true
    where (f.datum is null and coalesce(z.pocet, 0) > 0)
       or (f.datum is not null and f.stav <> 'rozvezena' and (f.v_kalendari or coalesce(z.pocet, 0) > 0))
       or (f.stav = 'rozvezena' and f.datum >= public.dnes_sk() - 14)
  ), '[]'::jsonb), 'odobrate', (select count(*) from public.zaradenia where rucne and furmanka_id is null));
end $$;

create or replace function public.objednavka_json(p_cislo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cislo', o.cislo, 'zdroj', o.zdroj, 'status', o.status, 'meno', o.meno, 'firma', o.firma, 'telefon', o.telefon,
    'email', o.email, 'ulica', o.ulica, 'psc', o.psc, 'mesto', o.mesto, 'doprava', o.doprava, 'platba', o.platba, 'platba_nazov', o.platba_nazov,
    'suma', o.suma, 'faktura', o.faktura, 'poznamka', o.poznamka, 'upozornenie', o.upozornenie, 'region', o.region,
    'vytvorena', o.vytvorena, 'zmenena', o.zmenena, 'rucne_polia', o.rucne_polia, 'ziva', public.ziva_objednavka(o.status),
    'furmanka_id', z.furmanka_id, 'rucne', coalesce(z.rucne, false), 'poradie', z.poradie,
    'polozky', coalesce((select jsonb_object_agg(p.kod, p.mnozstvo) from public.objednavky_polozky p where p.cislo = o.cislo and p.mnozstvo <> 0), '{}'::jsonb),
    'nazvy', coalesce((select jsonb_object_agg(p.kod, p.nazov) from public.objednavky_polozky p where p.cislo = o.cislo and p.mnozstvo <> 0), '{}'::jsonb))
  from public.objednavky o left join public.zaradenia z on z.cislo = o.cislo
  where o.cislo = p_cislo
$$;

-- p_id null = odobraté objednávky (ručne vyradené z furmaniek)
create or replace function public.furmanka_data(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_f jsonb;
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Furmanky vidí len IT, CEO a zákaznícky servis'); end if;
  if p_id is not null then
    select jsonb_build_object('id', f.id, 'region', f.region, 'datum', f.datum, 'nazov', public.furmanka_nazov(f.region, f.datum), 'stav', f.stav,
                              'dovod', f.dovod, 'uzavreta', f.uzavreta, 'rozvoz', r.rozvoz, 'trasa_hodiny', f.trasa_hodiny, 'v_kalendari', f.v_kalendari)
      into v_f from public.furmanky f join public.furmanky_regiony r on r.region = f.region where f.id = p_id;
    if v_f is null then return jsonb_build_object('ok', false, 'text', 'Furmanka neexistuje'); end if;
  else
    v_f := jsonb_build_object('id', null, 'nazov', 'Odobraté objednávky', 'stav', 'otvorena', 'rozvoz', false);
  end if;
  return jsonb_build_object('ok', true, 'furmanka', v_f, 'objednavky', coalesce((
    select jsonb_agg(public.objednavka_json(z.cislo) order by z.poradie nulls last, o.vytvorena nulls last, z.cislo)
    from public.zaradenia z join public.objednavky o on o.cislo = z.cislo
    where (p_id is not null and z.furmanka_id = p_id) or (p_id is null and z.furmanka_id is null and z.rucne)), '[]'::jsonb));
end $$;

create or replace function public.furmanky_sablona_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.som_interny() then coalesce(jsonb_agg(to_jsonb(s) order by s.riadok), '[]'::jsonb) else '[]'::jsonb end
  from public.furmanky_sablona s
$$;

-- hľadanie objednávky (podľa čísla, mena, telefónu) – na pridanie do furmanky
create or replace function public.objednavky_hladaj(p_text text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_text(p_text);
begin
  if not public.som_furmankar() then return '[]'::jsonb; end if;
  if length(v) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('cislo', o.cislo, 'meno', coalesce(nullif(o.meno, ''), o.firma), 'mesto', o.mesto, 'status', o.status, 'suma', o.suma,
                              'furmanka', (select public.furmanka_nazov(f.region, f.datum) from public.furmanky f where f.id = z.furmanka_id)) x
    from public.objednavky o left join public.zaradenia z on z.cislo = o.cislo
    where public.norm_text(o.cislo) like '%' || v || '%' or public.norm_text(o.meno) like '%' || v || '%'
       or public.norm_text(o.firma) like '%' || v || '%' or regexp_replace(coalesce(o.telefon, ''), '\D', '', 'g') like '%' || regexp_replace(v, '\D', '', 'g') || '%' and length(regexp_replace(v, '\D', '', 'g')) >= 4
    order by o.vytvorena desc nulls last limit 20) q), '[]'::jsonb);
end $$;

-- presun / pridanie / odobratie (p_furmanka_id null = odobrať z furmaniek)
create or replace function public.zaradenie_nastav(p_cislo text, p_furmanka_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  if not exists (select 1 from public.objednavky where cislo = p_cislo) then return jsonb_build_object('ok', false, 'text', 'Objednávka ' || p_cislo || ' nie je v appke'); end if;
  if p_furmanka_id is not null and not exists (select 1 from public.furmanky where id = p_furmanka_id) then return jsonb_build_object('ok', false, 'text', 'Furmanka neexistuje'); end if;
  insert into public.zaradenia (cislo, furmanka_id, rucne, kedy, kto) values (p_cislo, p_furmanka_id, true, now(), auth.uid())
    on conflict (cislo) do update set furmanka_id = excluded.furmanka_id, rucne = true, kedy = now(), kto = auth.uid(), poradie = null;
  return jsonb_build_object('ok', true);
end $$;

-- vrátiť objednávku automatike (zruší ručné presunutie/odobratie)
create or replace function public.zaradenie_automaticky(p_cislo text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  delete from public.zaradenia where cislo = p_cislo;
  perform public.furmanky_prirad();
  return jsonb_build_object('ok', true);
end $$;

-- úprava objednávky alebo nová ručná objednávka (bez čísla → M-1, M-2, …)
-- p: {cislo?, meno, firma, telefon, email, ulica, psc, mesto, platba, suma, poznamka, polozky: {kod: počet}, furmanka_id}
create or replace function public.objednavka_uloz(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cislo text := nullif(trim(coalesce(p->>'cislo', '')), ''); v_nova boolean := false; v_polia text[] := '{}'; k text;
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  if v_cislo is null then
    v_cislo := 'M-' || nextval('public.rucne_objednavky_seq');
    v_nova := true;
    insert into public.objednavky (cislo, zdroj, status, vytvorena, platba, upravil, upravena)
      values (v_cislo, 'rucna', 'ručná', now(), 'DOBIERKA', auth.uid(), now());
  elsif not exists (select 1 from public.objednavky where cislo = v_cislo) then
    return jsonb_build_object('ok', false, 'text', 'Objednávka ' || v_cislo || ' neexistuje');
  end if;

  foreach k in array array['meno','firma','telefon','email','ulica','psc','mesto','platba','suma','poznamka'] loop
    if p ? k then
      v_polia := v_polia || case when k in ('ulica','psc','mesto') then 'adresa' when k = 'firma' then 'meno' else k end;
    end if;
  end loop;
  update public.objednavky o set
    meno     = case when p ? 'meno'     then nullif(trim(p->>'meno'), '')     else o.meno end,
    firma    = case when p ? 'firma'    then nullif(trim(p->>'firma'), '')    else o.firma end,
    telefon  = case when p ? 'telefon'  then nullif(trim(p->>'telefon'), '')  else o.telefon end,
    email    = case when p ? 'email'    then nullif(trim(p->>'email'), '')    else o.email end,
    ulica    = case when p ? 'ulica'    then nullif(trim(p->>'ulica'), '')    else o.ulica end,
    psc      = case when p ? 'psc'      then nullif(trim(p->>'psc'), '')      else o.psc end,
    mesto    = case when p ? 'mesto'    then nullif(trim(p->>'mesto'), '')    else o.mesto end,
    platba   = case when p ? 'platba'   then nullif(trim(p->>'platba'), '')   else o.platba end,
    suma     = case when p ? 'suma'     then nullif(replace(p->>'suma', ',', '.'), '')::numeric else o.suma end,
    poznamka = case when p ? 'poznamka' then nullif(trim(p->>'poznamka'), '') else o.poznamka end,
    rucne_polia = case when o.zdroj = 'upgates' then array(select distinct unnest(o.rucne_polia || v_polia)) else o.rucne_polia end,
    upravil = auth.uid(), upravena = now()
  where o.cislo = v_cislo;

  if p ? 'polozky' and jsonb_typeof(p->'polozky') = 'object' then
    perform public.polozka_nastav(v_cislo, e.key, nullif(replace(e.value #>> '{}', ',', '.'), '')::numeric)
      from jsonb_each(p->'polozky') e;
  end if;

  update public.objednavky o set region = public.region_pre(o.doprava, o.mesto, o.psc) where o.cislo = v_cislo and o.zdroj = 'upgates';
  if v_nova or (p ? 'furmanka_id' and nullif(p->>'furmanka_id', '') is not null) then
    insert into public.zaradenia (cislo, furmanka_id, rucne, kedy, kto) values (v_cislo, nullif(p->>'furmanka_id', '')::bigint, true, now(), auth.uid())
      on conflict (cislo) do update set furmanka_id = excluded.furmanka_id, rucne = true, kedy = now(), kto = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'cislo', v_cislo, 'objednavka', public.objednavka_json(v_cislo));
end $$;

-- jedna bunka tabuľky: počet kusov produktu v objednávke (0 alebo prázdne = zmazať)
create or replace function public.polozka_nastav(p_cislo text, p_kod text, p_mnozstvo numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  if coalesce(p_mnozstvo, 0) = 0 then
    delete from public.objednavky_polozky where cislo = p_cislo and kod = p_kod;
  else
    insert into public.objednavky_polozky (cislo, kod, nazov, mnozstvo)
      values (p_cislo, p_kod, (select nazov from public.furmanky_sablona where kod = p_kod limit 1), p_mnozstvo)
      on conflict (cislo, kod) do update set mnozstvo = excluded.mnozstvo;
  end if;
  update public.objednavky set rucne_polia = case when zdroj = 'upgates' and not ('polozky' = any(rucne_polia)) then rucne_polia || 'polozky'::text else rucne_polia end,
         upravil = auth.uid(), upravena = now()
   where cislo = p_cislo;
  return jsonb_build_object('ok', true);
end $$;

-- zmena stavu furmanky: otvorena | full | rozvezena
create or replace function public.furmanka_stav(p_id bigint, p_stav text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  if p_stav not in ('otvorena','full','rozvezena') then return jsonb_build_object('ok', false, 'text', 'Neznámy stav'); end if;
  update public.furmanky set stav = p_stav,
         uzavreta = case when p_stav = 'otvorena' then null else coalesce(uzavreta, now()) end,
         dovod = case when p_stav = 'otvorena' then null when p_stav = 'full' and stav = 'otvorena' then 'Ručne uzavreté' else dovod end
   where id = p_id;
  insert into public.furmanky_log (typ, kto, text) select 'stav', auth.uid(), public.furmanka_nazov(region, datum) || ' → ' || p_stav from public.furmanky where id = p_id;
  perform public.furmanky_prirad();
  return jsonb_build_object('ok', true);
end $$;

-- poradie objednávok (stĺpcov) vo furmanke
create or replace function public.furmanka_poradie(p_cisla text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  update public.zaradenia z set poradie = x.i from unnest(p_cisla) with ordinality x(c, i) where z.cislo = x.c;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- prístupy k funkciám ----------
revoke all on function public.furmanky_sync(jsonb, jsonb, text, uuid, text[]), public.furmanky_prirad(), public.furmanka_pre_region(text),
  public.furmanky_posledny_beh(), public.furmanky_zapis_log(text, boolean, text, uuid), public.furmanky_na_kontrolu(),
  public.furmanky_kapacita(bigint, numeric, boolean, text), public.geokody_daj(text[]), public.geokody_uloz(jsonb), public.furmanky_cron_ok(text)
  from public, anon, authenticated;
grant execute on function public.furmanky_sync(jsonb, jsonb, text, uuid, text[]), public.furmanky_posledny_beh(),
  public.furmanky_zapis_log(text, boolean, text, uuid), public.furmanky_na_kontrolu(), public.furmanky_kapacita(bigint, numeric, boolean, text),
  public.geokody_daj(text[]), public.geokody_uloz(jsonb), public.furmanky_cron_ok(text), public.som_furmankar()
  to service_role;
revoke all on function public.furmanky_zoznam(), public.objednavka_json(text), public.furmanka_data(bigint), public.furmanky_sablona_data(),
  public.objednavky_hladaj(text), public.zaradenie_nastav(text, bigint), public.zaradenie_automaticky(text), public.objednavka_uloz(jsonb),
  public.polozka_nastav(text, text, numeric), public.furmanka_stav(bigint, text), public.furmanka_poradie(text[])
  from public, anon;
grant execute on function public.som_furmankar(), public.furmanky_zoznam(), public.furmanka_data(bigint), public.furmanky_sablona_data(),
  public.objednavky_hladaj(text), public.zaradenie_nastav(text, bigint), public.zaradenie_automaticky(text), public.objednavka_uloz(jsonb),
  public.polozka_nastav(text, text, numeric), public.furmanka_stav(bigint, text), public.furmanka_poradie(text[])
  to authenticated;
revoke all on function public.objednavka_json(text) from authenticated;


-- =========================================================================
-- 9) PRENOS UZAVRETÝCH FURMANIEK ZO SPRÁVY OBJEDNÁVOK (jednorazovo, dá sa zopakovať)
--    Objednávky, ktoré sú v starej tabuľke v uzavretom (FULL) hárku, ostanú v appke v tej istej furmanke
--    a automatika ich nepresunie (ako getMinuleObjednavkyPreTrasu v starom skripte).
--    p: [{nazov: "Stredná 30.09.2026 [FULL]", cisla: ["FO003633", …]}] – zoradené od najstaršieho
-- =========================================================================
create or replace function public.furmanky_import_stare(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h jsonb; m text[]; v_reg text; v_dat date; v_id bigint; v_ids bigint[] := '{}'; v_cisla text[] := '{}'; v_n int := 0; c text;
begin
  if not (public.som_spravca() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    return jsonb_build_object('ok', false, 'text', 'Len IT a CEO');
  end if;
  for h in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    m := regexp_match(h->>'nazov', '^\s*(\S+)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})?');
    continue when m is null;
    select region into v_reg from public.furmanky_regiony where rozvoz and public.norm_text(region) = public.norm_text(m[1]);
    continue when v_reg is null;
    v_dat := make_date(coalesce(m[4]::int, 2026), m[3]::int, m[2]::int);
    insert into public.furmanky (region, datum, stav, uzavreta, dovod)
      values (v_reg, v_dat, case when v_dat < public.dnes_sk() then 'rozvezena' else 'full' end, now(), 'Uzavreté v Správe objednávok (prenesené)')
      on conflict (region, datum) do update set
        stav = case when furmanky.stav = 'otvorena' or (furmanky.stav = 'full' and excluded.stav = 'rozvezena') then excluded.stav else furmanky.stav end,
        dovod = excluded.dovod, uzavreta = coalesce(furmanky.uzavreta, now())
      returning id into v_id;
    v_ids := v_ids || v_id;
    for c in select trim(x) from jsonb_array_elements_text(h->'cisla') x loop
      continue when c = '' or c like 'M-%' or not exists (select 1 from public.objednavky where cislo = c);
      insert into public.zaradenia (cislo, furmanka_id, rucne, kedy) values (c, v_id, false, now())
        on conflict (cislo) do update set furmanka_id = excluded.furmanka_id, kedy = now() where not zaradenia.rucne;
      v_cisla := v_cisla || c;
      v_n := v_n + 1;
    end loop;
  end loop;
  -- čo appka dala do týchto (v starej tabuľke uzavretých) furmaniek navyše, pôjde na ďalší termín
  delete from public.zaradenia z where z.furmanka_id = any(v_ids) and not z.rucne and not (z.cislo = any(v_cisla));
  perform public.furmanky_prirad();
  insert into public.furmanky_log (typ, text, pocet) values ('import', 'Prenos uzavretých furmaniek zo Správy objednávok: ' || v_n || ' objednávok', v_n);
  return jsonb_build_object('ok', true, 'furmanky', coalesce(array_length(v_ids, 1), 0), 'objednavky', v_n);
end $$;
revoke all on function public.furmanky_import_stare(jsonb) from public, anon;
grant execute on function public.furmanky_import_stare(jsonb) to authenticated;


-- =========================================================================
-- 10) ÚPRAVY 30. 9. 2026
--  a) šablóna: medzisúčet 30 ks mini sčíta všetkých 16 riadkov; POLOTOVARY len mrazené
--     (sladké = medzisúčty 5ks, 15ks, 10ks mini, 30ks mini; škvarkové = to isté vrátane 30ks mini, ktoré predtým chýbalo)
--  b) zaradenie: keď mesto ani PSČ nesedí, použije sa furmanka, ktorú si zákazník zvolil (NEZARADENÉ až nakoniec)
--  c) archív rozvezených furmaniek (zoznam ich neukazuje, dajú sa vyhľadať)
--  d) „Naplánované“ – potvrdí zákaznícky servis tlačidlom (do Upgates sa zapíše až po ostrom štarte)
-- =========================================================================
update public.furmanky_sablona set vzorec_ks = 'SUM(R[-16]C[0]:R[-1]C[0])' where riadok = 116;
update public.furmanky_sablona set vzorec_ks = 'R[-5]C[0]+R[-26]C[0]+R[-48]C[0]+R[-70]C[0]',
                                   vzorec_davky = 'R[-5]C[0]+R[-26]C[0]+R[-48]C[0]+R[-70]C[0]' where riadok = 121;
update public.furmanky_sablona set vzorec_ks = 'R[-2]C[0]+R[-23]C[0]+R[-45]C[0]+R[-67]C[0]',
                                   vzorec_davky = 'R[-2]C[0]+R[-23]C[0]+R[-45]C[0]+R[-67]C[0]' where riadok = 122;

create or replace function public.region_pre(p_doprava text, p_mesto text, p_psc text) returns text
language plpgsql stable set search_path = public as $$
declare v_ship text := public.norm_text(p_doprava); v_mesto text := public.norm_text(p_mesto);
        v_psc text := regexp_replace(coalesce(p_psc, ''), '\s', '', 'g'); r record;
begin
  if v_ship like '%zbojska%' then return 'Osobný odber'; end if;
  if v_ship like '%elektronicky%' then return 'Elektronicky'; end if;
  for r in select region, mesta from public.furmanky_regiony where rozvoz order by hladanie loop
    if v_mesto <> '' and exists (select 1 from unnest(r.mesta) m where position(m in v_mesto) > 0) then return r.region; end if;
  end loop;
  for r in select region, psc from public.furmanky_regiony where rozvoz order by hladanie loop
    if v_psc <> '' and (left(v_psc, 3) = any(r.psc) or left(v_psc, 2) = any(r.psc)) then return r.region; end if;
  end loop;
  -- záloha: furmanka, ktorú si zákazník zvolil v e-shope
  for r in select region, kluc from public.furmanky_regiony where rozvoz and kluc is not null order by hladanie loop
    if v_ship like '%' || r.kluc || '%' then return r.region; end if;
  end loop;
  return 'NEZARADENÉ';
end $$;

alter table public.furmanky add column if not exists naplanovane timestamptz;
alter table public.furmanky add column if not exists naplanoval uuid;

-- zoznam: bez rozvezených (tie sú v archíve)
create or replace function public.furmanky_zoznam() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Furmanky vidí len IT, CEO a zákaznícky servis'); end if;
  return jsonb_build_object('ok', true, 'beh', public.furmanky_posledny_beh(), 'furmanky', coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'region', f.region, 'datum', f.datum, 'nazov', public.furmanka_nazov(f.region, f.datum),
             'stav', f.stav, 'v_kalendari', f.v_kalendari, 'dovod', f.dovod, 'uzavreta', f.uzavreta, 'rozvoz', r.rozvoz,
             'trasa_hodiny', f.trasa_hodiny, 'naplanovane', f.naplanovane, 'pocet', coalesce(z.pocet, 0), 'suma', coalesce(z.suma, 0))
           order by (f.datum is null), f.datum, r.poradie)
    from public.furmanky f
    join public.furmanky_regiony r on r.region = f.region
    left join lateral (select count(*) pocet, sum(o.suma) suma from public.zaradenia z join public.objednavky o on o.cislo = z.cislo
                       where z.furmanka_id = f.id) z on true
    where f.stav <> 'rozvezena'
      and ((f.datum is null and coalesce(z.pocet, 0) > 0) or (f.datum is not null and (f.v_kalendari or coalesce(z.pocet, 0) > 0)))
  ), '[]'::jsonb),
  'odobrate', (select count(*) from public.zaradenia where rucne and furmanka_id is null),
  'archiv', (select count(*) from public.furmanky where stav = 'rozvezena'));
end $$;

-- archív: rozvezené furmanky, hľadanie podľa názvu/dátumu alebo čísla, mena, telefónu objednávky
create or replace function public.furmanky_archiv(p_text text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_text(p_text); v_cisla text := regexp_replace(coalesce(p_text, ''), '\D', '', 'g');
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  return jsonb_build_object('ok', true, 'furmanky', coalesce((
    select jsonb_agg(x order by (x->>'datum') desc nulls last) from (
      select jsonb_build_object('id', f.id, 'region', f.region, 'datum', f.datum, 'nazov', public.furmanka_nazov(f.region, f.datum),
               'stav', f.stav, 'pocet', (select count(*) from public.zaradenia z where z.furmanka_id = f.id),
               'suma', (select sum(o.suma) from public.zaradenia z join public.objednavky o on o.cislo = z.cislo where z.furmanka_id = f.id),
               'najdene', (select jsonb_agg(o.cislo || ' ' || coalesce(o.meno, o.firma, '')) from public.zaradenia z join public.objednavky o on o.cislo = z.cislo
                           where z.furmanka_id = f.id and length(v) >= 2
                             and (public.norm_text(o.cislo) like '%' || v || '%' or public.norm_text(o.meno) like '%' || v || '%'
                                  or public.norm_text(o.firma) like '%' || v || '%'
                                  or (length(v_cisla) >= 4 and regexp_replace(coalesce(o.telefon, ''), '\D', '', 'g') like '%' || v_cisla || '%')))) x
      from public.furmanky f
      where f.stav = 'rozvezena'
      limit 400) q
    where coalesce(length(v), 0) < 2 or jsonb_typeof(x->'najdene') = 'array'
       or public.norm_text(x->>'nazov') like '%' || v || '%'
  ), '[]'::jsonb));
end $$;

create or replace function public.furmanka_naplanovana(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Nemáte oprávnenie'); end if;
  update public.furmanky set naplanovane = now(), naplanoval = auth.uid() where id = p_id;
  insert into public.furmanky_log (typ, kto, text) select 'naplanovane', auth.uid(), public.furmanka_nazov(region, datum) || ' – Naplánované (do Upgates po ostrom štarte)' from public.furmanky where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- furmanka_data: pridaný čas „Naplánované“
create or replace function public.furmanka_data(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_f jsonb;
begin
  if not public.som_furmankar() then return jsonb_build_object('ok', false, 'text', 'Furmanky vidí len IT, CEO a zákaznícky servis'); end if;
  if p_id is not null then
    select jsonb_build_object('id', f.id, 'region', f.region, 'datum', f.datum, 'nazov', public.furmanka_nazov(f.region, f.datum), 'stav', f.stav,
                              'dovod', f.dovod, 'uzavreta', f.uzavreta, 'rozvoz', r.rozvoz, 'trasa_hodiny', f.trasa_hodiny, 'v_kalendari', f.v_kalendari,
                              'naplanovane', f.naplanovane)
      into v_f from public.furmanky f join public.furmanky_regiony r on r.region = f.region where f.id = p_id;
    if v_f is null then return jsonb_build_object('ok', false, 'text', 'Furmanka neexistuje'); end if;
  else
    v_f := jsonb_build_object('id', null, 'nazov', 'Odobraté objednávky', 'stav', 'otvorena', 'rozvoz', false);
  end if;
  return jsonb_build_object('ok', true, 'furmanka', v_f, 'objednavky', coalesce((
    select jsonb_agg(public.objednavka_json(z.cislo) order by z.poradie nulls last, o.vytvorena nulls last, z.cislo)
    from public.zaradenia z join public.objednavky o on o.cislo = z.cislo
    where (p_id is not null and z.furmanka_id = p_id) or (p_id is null and z.furmanka_id is null and z.rucne)), '[]'::jsonb));
end $$;

revoke all on function public.furmanky_archiv(text), public.furmanka_naplanovana(bigint) from public, anon;
grant execute on function public.furmanky_archiv(text), public.furmanka_naplanovana(bigint) to authenticated;

-- prepočítať regióny existujúcich objednávok podľa novej zálohy a zaradiť
update public.objednavky o set region = public.region_pre(o.doprava, o.mesto, o.psc), upozornenie = null where o.zdroj = 'upgates';
update public.objednavky o set upozornenie = public.zla_doprava(o.region, o.doprava) where o.zdroj = 'upgates';
select public.furmanky_prirad();


-- =========================================================================
-- 11) ÚPRAVA 30. 9. 2026: zvolená furmanka sa NEPOUŽÍVA na zaradenie (zákazník mohol zvoliť nezmysel a trasa by vyšla zle)
--     Keď mesto ani PSČ nesedí → NEZARADENÉ a zákaznícky servis objednávku presunie ručne (tlačidlo Presunúť).
-- =========================================================================
create or replace function public.region_pre(p_doprava text, p_mesto text, p_psc text) returns text
language plpgsql stable set search_path = public as $$
declare v_ship text := public.norm_text(p_doprava); v_mesto text := public.norm_text(p_mesto);
        v_psc text := regexp_replace(coalesce(p_psc, ''), '\s', '', 'g'); r record;
begin
  if v_ship like '%zbojska%' then return 'Osobný odber'; end if;
  if v_ship like '%elektronicky%' then return 'Elektronicky'; end if;
  for r in select region, mesta from public.furmanky_regiony where rozvoz order by hladanie loop
    if v_mesto <> '' and exists (select 1 from unnest(r.mesta) m where position(m in v_mesto) > 0) then return r.region; end if;
  end loop;
  for r in select region, psc from public.furmanky_regiony where rozvoz order by hladanie loop
    if v_psc <> '' and (left(v_psc, 3) = any(r.psc) or left(v_psc, 2) = any(r.psc)) then return r.region; end if;
  end loop;
  return 'NEZARADENÉ';
end $$;

update public.objednavky o set region = public.region_pre(o.doprava, o.mesto, o.psc), upozornenie = null where o.zdroj = 'upgates';
update public.objednavky o set upozornenie = public.zla_doprava(o.region, o.doprava) where o.zdroj = 'upgates';
select public.furmanky_prirad();

-- ---------- plánované sťahovanie 6:00, 11:30, 14:00 (spustiť AŽ po nasadení Edge Function „upgates-sync“) ----------
-- Plánovač volá funkciu v UTC časoch pre letný aj zimný čas; funkcia sama pustí len ten, ktorý v Bratislave padne na 6:00/11:30/14:00.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'furmanky_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'furmanky_cron', 'Plánované sťahovanie objednávok z Upgates');
  end if;
end $$;
select cron.unschedule(jobid) from cron.job where jobname = 'furmanky-upgates';
select cron.schedule('furmanky-upgates', '0,30 4,5,9,10,12,13 * * *', $cron$
  select net.http_post(
    url := 'https://ykwiqsneroxzpkwpadie.supabase.co/functions/v1/upgates-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-lbz-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'furmanky_cron')),
    body := '{"akcia":"sync"}'::jsonb,
    timeout_milliseconds := 150000)
$cron$);
