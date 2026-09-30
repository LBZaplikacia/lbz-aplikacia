-- =========================================================================
-- 47) CHAT – odpoveď na konkrétnu správu (ako Messenger) (v0.28.4) – 30. 9. 2026
-- =========================================================================
alter table public.chat_sprava add column if not exists odpoved_na bigint references public.chat_sprava(id) on delete set null;

drop function if exists public.chat_posli(bigint, text, jsonb);
create or replace function public.chat_posli(p_konv bigint, p_text text, p_priloha jsonb default null, p_odpoved bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_t text := nullif(left(trim(coalesce(p_text, '')), 4000), ''); v_odp bigint := p_odpoved;
begin
  if not public.chat_som_clen(p_konv) then return jsonb_build_object('ok', false, 'text', 'Do tejto konverzácie nepatríš'); end if;
  if exists (select 1 from public.chat_konv where id = p_konv and archiv) then return jsonb_build_object('ok', false, 'text', 'Skupina je archivovaná'); end if;
  if v_t is null and p_priloha is null then return jsonb_build_object('ok', false, 'text', 'Prázdna správa'); end if;
  if p_priloha is not null and split_part(p_priloha->>'cesta', '/', 1) <> p_konv::text then return jsonb_build_object('ok', false, 'text', 'Neplatná príloha'); end if;
  if v_odp is not null and not exists (select 1 from public.chat_sprava where id = v_odp and konv_id = p_konv) then v_odp := null; end if;
  insert into public.chat_sprava (konv_id, text, priloha, odpoved_na) values (p_konv, v_t, p_priloha, v_odp) returning id into v_id;
  update public.chat_konv set posledna = now() where id = p_konv;
  update public.chat_clen set precitane = now() where konv_id = p_konv and uid = auth.uid();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.chat_posli(bigint, text, jsonb, bigint) from public, anon;
grant execute on function public.chat_posli(bigint, text, jsonb, bigint) to authenticated;

create or replace function public.chat_spravy(p_konv bigint, p_pred bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s jsonb; v_k public.chat_konv%rowtype;
begin
  if not public.chat_som_clen(p_konv) then return jsonb_build_object('ok', false, 'text', 'Do tejto konverzácie nepatríš'); end if;
  select * into v_k from public.chat_konv where id = p_konv;
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint), '[]') into v_s from (
    select jsonb_build_object('id', s.id, 'uid', s.uid, 'text', case when s.zmazane then null else s.text end,
      'priloha', case when s.zmazane then null else s.priloha end, 'pripnute', s.pripnute, 'zmazane', s.zmazane, 'kedy', s.vytvorene,
      'odpoved_na', s.odpoved_na,
      'odpoved', (select jsonb_build_object('id', r.id, 'uid', r.uid, 'zmazane', r.zmazane,
                    'text', case when r.zmazane then null else left(r.text, 160) end,
                    'priloha', case when r.zmazane or r.priloha is null then null else jsonb_build_object('nazov', r.priloha->>'nazov', 'typ', r.priloha->>'typ') end)
                  from public.chat_sprava r where r.id = s.odpoved_na)) x
    from public.chat_sprava s where s.konv_id = p_konv and (p_pred is null or s.id < p_pred) order by s.id desc limit 60) q;
  if p_pred is null then update public.chat_clen set precitane = now() where konv_id = p_konv and uid = auth.uid(); end if;
  return jsonb_build_object('ok', true, 'spravy', v_s, 'viac', jsonb_array_length(v_s) = 60,
    'konv', jsonb_build_object('id', v_k.id, 'typ', v_k.typ, 'nazov', v_k.nazov, 'ikona', v_k.ikona, 'vsetci', v_k.vsetci, 'archiv', v_k.archiv),
    'clenovia', (select coalesce(jsonb_agg(jsonb_build_object('uid', c.uid, 'meno', public.chat_meno(c.uid), 'precitane', c.precitane, 'stlmene', c.stlmene) order by public.chat_meno(c.uid)), '[]')
                 from public.chat_clen c where c.konv_id = p_konv),
    'pripnute', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'text', s.text, 'meno', public.chat_meno(s.uid), 'kedy', s.vytvorene) order by s.id desc), '[]')
                 from public.chat_sprava s where s.konv_id = p_konv and s.pripnute and not s.zmazane));
end $$;
