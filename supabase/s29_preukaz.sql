-- s29 (v0.23): zdravotný preukaz – dve fotky (predná a zadná strana), text pri „na dobu neurčitú“
alter table public.zamestnanci add column if not exists zdrav_preukaz_foto2 text;
drop function if exists public.zam_zdrav_uloz(bigint, date, text);
create or replace function public.zam_zdrav_uloz(p_osoba bigint, p_do date, p_foto text default null, p_foto2 text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (p_osoba = public.rozpis_moja_osoba() or public.zam_spravca()) then return jsonb_build_object('ok', false, 'text', 'Nemáš oprávnenie'); end if;
  if p_do is null then return jsonb_build_object('ok', false, 'text', 'Zadaj dátum platnosti preukazu'); end if;
  if (p_foto is not null and split_part(p_foto, '/', 1) <> p_osoba::text) or (p_foto2 is not null and split_part(p_foto2, '/', 1) <> p_osoba::text) then
    return jsonb_build_object('ok', false, 'text', 'Neplatná cesta k fotke'); end if;
  insert into public.zamestnanci (osoba_id) values (p_osoba) on conflict do nothing;
  update public.zamestnanci set zdrav_preukaz_do = p_do, zdrav_preukaz_foto = coalesce(p_foto, zdrav_preukaz_foto), zdrav_preukaz_foto2 = coalesce(p_foto2, zdrav_preukaz_foto2),
    upravene = now(), upravil = auth.uid() where osoba_id = p_osoba;
  insert into public.zamestnanci_log (osoba_id, polia) values (p_osoba, array['zdrav_preukaz_do']
    || case when p_foto is null then '{}'::text[] else array['zdrav_preukaz_foto'] end || case when p_foto2 is null then '{}'::text[] else array['zdrav_preukaz_foto2'] end);
  return jsonb_build_object('ok', true, 'text', 'Zdravotný preukaz uložený – ' || case when p_do >= date '9999-01-01' then 'platí na dobu neurčitú' else 'platí do ' || to_char(p_do, 'FMDD. FMMM. YYYY') end);
end $$;
create or replace function public.zam_zdrav_fotky(p_osoba bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p_osoba = public.rozpis_moja_osoba() or public.zam_spravca() then
    (select jsonb_build_array(zdrav_preukaz_foto, zdrav_preukaz_foto2) from public.zamestnanci where osoba_id = p_osoba) end
$$;
revoke all on function public.zam_zdrav_uloz(bigint, date, text, text), public.zam_zdrav_fotky(bigint) from public, anon;
grant execute on function public.zam_zdrav_uloz(bigint, date, text, text), public.zam_zdrav_fotky(bigint) to authenticated;
