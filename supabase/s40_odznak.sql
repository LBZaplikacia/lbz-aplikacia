-- =========================================================================
-- 40) ČÍSLO NA IKONE APPKY (v0.26.1) – všetko, čo si žiada pozornosť – 30. 9. 2026
--   neprečítané správy v chate + čo čaká na moje potvrdenie/schválenie + moje nesplnené úlohy
-- =========================================================================
create or replace function public.odznak_pocet() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_os bigint := public.rozpis_moja_osoba(); v_dnes date := public.dnes_sk();
  v_chat int := 0; v_schv jsonb; v_s int := 0; v_ulohy int := 0;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  begin v_chat := public.chat_neprecitane(); exception when others then v_chat := 0; end;
  v_schv := public.na_schvalenie();
  if coalesce((v_schv->>'ok')::boolean, false) then
    v_s := coalesce((v_schv->>'smeny')::int, 0) + coalesce((v_schv->>'dochadzka')::int, 0) + coalesce((v_schv->>'udaje')::int, 0);
  end if;
  if v_os is not null then
    select count(*) into v_ulohy from public.ulohy_prijemci r join public.ulohy t on t.id = r.uloha_id
      where r.osoba_id = v_os and r.splnene is null and t.splnene is null and t.datum <= v_dnes
        and t.vytvoril is distinct from auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'chat', v_chat, 'schvalenie', v_s, 'ulohy', v_ulohy, 'spolu', v_chat + v_s + v_ulohy);
end $$;
revoke all on function public.odznak_pocet() from public, anon;
grant execute on function public.odznak_pocet() to authenticated;
