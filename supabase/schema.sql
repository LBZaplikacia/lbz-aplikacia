-- LBZ aplikácia – základná štruktúra databázy (Supabase / PostgreSQL)
-- Verzia 0.1 – 28. 9. 2026
-- Obsah: roly, profily používateľov, moduly a kto k nim má prístup, PIN pre tablet.
-- Spúšťa sa raz v Supabase: SQL Editor → vložiť celý súbor → Run.

-- 1) ROLY -----------------------------------------------------------------
create table if not exists public.roly (
  kod        text primary key,          -- napr. 'manazer'
  nazov      text not null,             -- zobrazovaný názov
  interna    boolean not null default true  -- interný zamestnanec (môže PIN) / externý
);

insert into public.roly (kod, nazov, interna) values
  ('manazer',            'Manažér',                 true),
  ('prevadzka',          'Zamestnanec prevádzky',   true),
  ('vodic',              'Vodič furmaniek',         true),
  ('zakaznicky_servis',  'Zákaznícky servis',       true),
  ('mzdarka',            'Mzdárka / účtovníčka',    false),
  ('zakaznik',           'Zákazník',                false)
on conflict (kod) do nothing;

-- 2) MODULY ---------------------------------------------------------------
create table if not exists public.moduly (
  kod      text primary key,       -- napr. 'furmanky'
  nazov    text not null,
  poradie  int  not null default 100,
  aktivny  boolean not null default true   -- false = ešte nepreklopené, zobrazí sa „pripravujeme“
);

insert into public.moduly (kod, nazov, poradie, aktivny) values
  ('prehlad',          'Prehľad',               1,  true),
  ('furmanky',         'Furmanky',              10, false),
  ('sklad',            'Sklad',                 20, false),
  ('balenie',          'Balenie a štítky',      25, false),
  ('dochadzka',        'Dochádzka a smeny',     30, false),
  ('kniha_jazd',       'Kniha jázd',            40, false),
  ('objednavky',       'Objednávky',            50, false),
  ('komentare',        'Komentáre FB/IG',       55, false),
  ('personalna',       'Personálna agenda',     60, false),
  ('exporty',          'Exporty pre účtovníctvo', 65, false),
  ('moje_objednavky',  'Moje objednávky',       80, false),
  ('sledovanie',       'Kde je moja furmanka',  81, false),
  ('predplatne',       'Buchtové predplatné',   82, false),
  ('vernost',          'Vernostné body',        83, false),
  ('nastavenia',       'Nastavenia a používatelia', 99, true)
on conflict (kod) do nothing;

-- 3) PRÍSTUPY: ktorá rola vidí ktorý modul --------------------------------
create table if not exists public.pristupy (
  rola   text references public.roly(kod)   on delete cascade,
  modul  text references public.moduly(kod) on delete cascade,
  uprava boolean not null default true,     -- false = len čítanie
  primary key (rola, modul)
);

-- manažér vidí všetko
insert into public.pristupy (rola, modul)
  select 'manazer', kod from public.moduly
on conflict do nothing;

insert into public.pristupy (rola, modul, uprava) values
  ('prevadzka', 'prehlad', true), ('prevadzka', 'furmanky', true), ('prevadzka', 'sklad', true),
  ('prevadzka', 'balenie', true), ('prevadzka', 'dochadzka', true), ('prevadzka', 'kniha_jazd', true),
  ('vodic', 'prehlad', true), ('vodic', 'furmanky', true), ('vodic', 'dochadzka', true), ('vodic', 'kniha_jazd', true),
  ('zakaznicky_servis', 'prehlad', true), ('zakaznicky_servis', 'objednavky', true), ('zakaznicky_servis', 'komentare', true),
  ('mzdarka', 'dochadzka', false), ('mzdarka', 'personalna', false), ('mzdarka', 'exporty', false),
  ('zakaznik', 'moje_objednavky', true), ('zakaznik', 'sledovanie', true),
  ('zakaznik', 'predplatne', true), ('zakaznik', 'vernost', true)
on conflict do nothing;

-- 4) PROFILY POUŽÍVATEĽOV --------------------------------------------------
-- Prihlásenie rieši Supabase Auth (Google alebo e-mail). Tu je len rola a meno.
create table if not exists public.profily (
  id          uuid primary key references auth.users(id) on delete cascade,
  meno        text,
  email       text,
  rola        text not null default 'zakaznik' references public.roly(kod),
  aktivny     boolean not null default true,
  pin_hash    text,          -- PIN pre spoločný tablet (uložený len ako hash, nikdy čitateľne)
  vytvoreny   timestamptz not null default now()
);

-- Nový účet = automaticky profil s rolou 'zakaznik'. Interným ľuďom rolu zmení manažér.
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

-- Pomocná funkcia: rola prihláseného používateľa
create or replace function public.moja_rola() returns text
language sql stable security definer set search_path = public as $$
  select rola from public.profily where id = auth.uid() and aktivny
$$;

-- Moduly, ktoré prihlásený používateľ smie vidieť (appka volá: rpc('moje_moduly'))
create or replace function public.moje_moduly()
returns table (kod text, nazov text, poradie int, aktivny boolean, uprava boolean)
language sql stable security definer set search_path = public as $$
  select m.kod, m.nazov, m.poradie, m.aktivny, p.uprava
  from public.pristupy p join public.moduly m on m.kod = p.modul
  where p.rola = public.moja_rola()
  order by m.poradie
$$;

-- 5) ZABEZPEČENIE (Row Level Security) ------------------------------------
alter table public.roly     enable row level security;
alter table public.moduly   enable row level security;
alter table public.pristupy enable row level security;
alter table public.profily  enable row level security;

-- číselníky môže čítať každý prihlásený
create policy "roly citanie"    on public.roly     for select to authenticated using (true);
create policy "moduly citanie"  on public.moduly   for select to authenticated using (true);
create policy "pristupy citanie" on public.pristupy for select to authenticated using (true);

-- profil: každý vidí svoj, manažér vidí a upravuje všetky
create policy "vlastny profil"  on public.profily for select to authenticated
  using (id = auth.uid() or public.moja_rola() = 'manazer');
create policy "manazer upravuje profily" on public.profily for update to authenticated
  using (public.moja_rola() = 'manazer');
create policy "manazer upravuje moduly" on public.moduly for update to authenticated
  using (public.moja_rola() = 'manazer');
create policy "manazer upravuje pristupy" on public.pristupy for all to authenticated
  using (public.moja_rola() = 'manazer') with check (public.moja_rola() = 'manazer');

-- Poznámka k PIN: prihlásenie PINom na spoločnom tablete sa doplní ako
-- Supabase Edge Function (overí PIN proti pin_hash a vráti reláciu daného zamestnanca).
