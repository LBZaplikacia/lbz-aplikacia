-- =========================================================================
-- 33) ZDRAVOTNÝ PREUKAZ – rozvozár (pozícia „Rozvozár – zásobovač“) ho nepotrebuje (v0.25)
--     Preprava balených potravín nie je epidemiologicky závažná činnosť (z. 355/2007 v znení z. 165/2026).
--     Ak rozvozár robí aj v prevádzke (manipulácia s nebalenými potravinami), treba mu dať inú pozíciu.
-- =========================================================================
create or replace function public.zdrav_treba(p_pozicia text) returns boolean
language sql immutable as $$ select coalesce(p_pozicia, '') not like 'Rozvozár%' $$;

create or replace function public.zdrav_stav() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_moja bigint := public.rozpis_moja_osoba(); v_dnes date := public.dnes_sk();
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'dnes', v_dnes, 'spravca', public.zam_spravca(),
    'moj', (select jsonb_build_object('osoba_id', o.id, 'do', z.zdrav_preukaz_do, 'foto', z.zdrav_preukaz_foto is not null, 'netreba', not public.zdrav_treba(z.pozicia))
            from public.rozpis_osoby o left join public.zamestnanci z on z.osoba_id = o.id where o.id = v_moja),
    'ludia', case when public.zam_spravca() then (select coalesce(jsonb_agg(jsonb_build_object('osoba_id', o.id, 'meno', o.meno, 'do', z.zdrav_preukaz_do,
                  'foto', z.zdrav_preukaz_foto is not null) order by z.zdrav_preukaz_do nulls first, o.meno), '[]')
              from public.rozpis_osoby o left join public.zamestnanci z on z.osoba_id = o.id
              where o.aktivny and coalesce(z.stav, 'aktivny') = 'aktivny'
                and coalesce(z.typ_vztahu, '') not in ('Paušál')
                and public.zdrav_treba(z.pozicia)
                and (z.zdrav_preukaz_do is null or z.zdrav_preukaz_do < v_dnes + 30)) else '[]'::jsonb end);
end $$;
grant execute on function public.zdrav_treba(text) to authenticated, service_role;
