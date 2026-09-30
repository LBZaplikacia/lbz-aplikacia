-- =========================================================================
-- 35) ROZPIS – pozícia „Customer service“ a Natália (v rozpise „Natka“) na každý deň (cca 2 h denne) – 30. 9. 2026
-- =========================================================================
insert into public.rozpis_pozicie (kod, nazov, poradie, max_ludi) values ('customer_service', 'Customer service', 6, 2)
on conflict (kod) do update set nazov = excluded.nazov, poradie = excluded.poradie;

-- každý deň od dnes do konca roka 2026
insert into public.rozpis_miesta (datum, pozicia, miesto, osoba_id)
select d::date, 'customer_service', 1, (select id from public.rozpis_osoby where meno in ('Natka', 'Natália', 'Natalia') order by id limit 1)
from generate_series(public.dnes_sk(), date '2026-12-31', interval '1 day') d
where not exists (select 1 from public.rozpis_miesta m where m.datum = d::date and m.pozicia = 'customer_service')
on conflict do nothing;

select unnest(array[
  (select meno || ' id ' || id from public.rozpis_osoby where meno in ('Natka', 'Natália', 'Natalia') order by id limit 1),
  (select count(*)::text || ' dní' from public.rozpis_miesta where pozicia = 'customer_service')]);
