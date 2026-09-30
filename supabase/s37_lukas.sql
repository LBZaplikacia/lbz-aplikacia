-- 37) Lukáš Bella – znova aktívny, účet v appke ako zamestnanec (príležitostne rozvoz) – 30. 9. 2026
update public.rozpis_osoby set aktivny = true where meno ilike 'Luk%';
update public.zamestnanci z set stav = 'aktivny' from public.rozpis_osoby o
  where o.id = z.osoba_id and o.meno ilike 'Luk%' and z.stav is distinct from 'aktivny';
insert into public.pozvanky (email, meno, rola, aktivny)
select lower(trim(o.email)), 'Lukáš Bella', 'zamestnanec', true from public.rozpis_osoby o
where o.meno ilike 'Luk%' and nullif(trim(o.email), '') is not null
on conflict (email) do update set rola = 'zamestnanec', aktivny = true;
select unnest(array[
  (select string_agg(o.id || ' ' || o.meno || ' aktivny=' || o.aktivny || ' email=' || (nullif(trim(o.email),'') is not null), '; ') from public.rozpis_osoby o where o.meno ilike 'Luk%'),
  (select string_agg('zamestnanci stav=' || coalesce(z.stav,'-') || ' pozicia=' || coalesce(z.pozicia,'-'), '; ') from public.zamestnanci z join public.rozpis_osoby o on o.id = z.osoba_id where o.meno ilike 'Luk%'),
  (select 'pozvanka rola=' || p.rola from public.pozvanky p join public.rozpis_osoby o on lower(trim(o.email)) = p.email where o.meno ilike 'Luk%' limit 1),
  (select 'profil rola=' || p.rola from public.profily p join public.rozpis_osoby o on lower(trim(o.email)) = lower(p.email) where o.meno ilike 'Luk%' limit 1)]);
