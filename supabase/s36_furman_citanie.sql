-- 36) ROZPIS – furman účet rozpis len prezerá (Matej si smeny mení cez svoj osobný účet zamestnanca) – 30. 9. 2026
create or replace function public.rozpis_rola() returns text
language sql stable security definer set search_path = public as $$
  select case when public.moja_rola() in ('it','ceo','prevadzkar') then 'sprava'
              when public.moja_rola() in ('prevadzka','furman','zakaznicky_servis') then 'spolocny'
              when public.moja_rola() = 'zamestnanec' then 'osobny'
              when public.moja_rola() = 'uctovnicka' then 'citanie' end
$$;
select public.rozpis_rola() is null as ok;
