-- =========================================================================
-- 38) Kubej (Tomáš) = prevádzkar; Customer service sa v rozpise sám odhlási, keď Natka v ten deň nepracovala – 30. 9. 2026
-- =========================================================================
insert into public.pozvanky (email, meno, rola, aktivny)
select lower(trim(o.email)), 'Tomáš Kubej', 'prevadzkar', true from public.rozpis_osoby o
where o.meno = 'Tomáš' and nullif(trim(o.email), '') is not null
on conflict (email) do update set rola = 'prevadzkar', aktivny = true;

-- po skončení dňa: miesto „Customer service“, kde osoba nemá v dochádzke žiadnu prácu, sa z rozpisu odstráni
create or replace function public.rozpis_cs_cistenie(p_datum date default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_d date := coalesce(p_datum, public.dnes_sk() - 1); r record; n int := 0;
begin
  for r in select m.* from public.rozpis_miesta m
           where m.datum = v_d and m.pozicia = 'customer_service' and m.osoba_id is not null
             and not exists (select 1 from public.dochadzka d where d.osoba_id = m.osoba_id and d.datum = v_d and d.typ = 'praca')
  loop
    delete from public.rozpis_miesta where id = r.id;
    insert into public.rozpis_log (kto, ucet, datum, pozicia, akcia, text)
      values (null, 'automaticky', v_d, 'customer_service', 'uvolnit',
              (select meno from public.rozpis_osoby where id = r.osoba_id) || ' v ten deň nepracovala – odhlásená automaticky');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.rozpis_cs_cistenie(date) from public, anon, authenticated;

-- každú noc 0:15 (22:15 UTC) za predchádzajúci deň
select cron.unschedule('lbz-cs-cistenie') where exists (select 1 from cron.job where jobname = 'lbz-cs-cistenie');
select cron.schedule('lbz-cs-cistenie', '15 22 * * *', $cron$ select public.rozpis_cs_cistenie(public.dnes_sk() - case when extract(hour from now() at time zone 'Europe/Bratislava') < 12 then 1 else 0 end) $cron$);

select unnest(array[
  (select 'Kubej pozvanka=' || p.rola from public.pozvanky p join public.rozpis_osoby o on lower(trim(o.email)) = p.email where o.meno = 'Tomáš'),
  (select 'Kubej profil=' || coalesce((select p.rola from public.profily p join public.rozpis_osoby o on lower(trim(o.email)) = lower(p.email) where o.meno = 'Tomáš'), 'ešte sa neprihlásil')),
  (select 'push: ' || string_agg(p.rola || ' ' || to_char(o.vytvorene at time zone 'Europe/Bratislava', 'DD.MM HH24:MI') || ' ' || split_part(split_part(o.endpoint, '//', 2), '/', 1), '; ' order by o.vytvorene) from public.push_odbery o join public.profily p on p.id = o.uid),
  (select 'cron ok: ' || count(*) from cron.job where jobname = 'lbz-cs-cistenie')]);
