-- =========================================================================
-- 34) ROZPIS – furman má v rozpise osobný účet ako zamestnanec (v0.25.2):
--     posiela žiadosti (namiesto kolegu / výmena → potvrdí kolega, nová smena / odhlásenie → vedenie).
--     Prevádzka a zákaznícky servis (e-shop) rozpis len prezerajú. Prevádzkár mení všetko ako IT a CEO.
--     Furman účet sa spojí s menom v rozpise cez e-mail (Rozpis → Ľudia a farby).
-- =========================================================================
create or replace function public.rozpis_rola() returns text
language sql stable security definer set search_path = public as $$
  select case when public.moja_rola() in ('it','ceo','prevadzkar') then 'sprava'
              when public.moja_rola() in ('prevadzka','zakaznicky_servis') then 'spolocny'
              when public.moja_rola() in ('zamestnanec','furman') then 'osobny'
              when public.moja_rola() = 'uctovnicka' then 'citanie' end
$$;
