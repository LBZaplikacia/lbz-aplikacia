-- =========================================================================
-- 28) CHAT (v0.23) – skupiny (aj „celý tím“) a súkromné správy medzi dvoma ľuďmi
--     Prístup len cez funkcie; čítanie správ povolené politikou (kvôli Realtime – nové správy hneď).
-- =========================================================================
create table if not exists public.chat_konv (
  id         bigint generated always as identity primary key,
  typ        text not null default 'skupina' check (typ in ('skupina','priama')),
  nazov      text,
  ikona      text,
  vsetci     boolean not null default false,     -- automaticky všetci z tímu
  archiv     boolean not null default false,
  vytvoril   uuid default auth.uid(),
  vytvorene  timestamptz not null default now(),
  posledna   timestamptz not null default now()
);
create table if not exists public.chat_clen (
  konv_id    bigint not null references public.chat_konv(id) on delete cascade,
  uid        uuid not null,
  precitane  timestamptz not null default now(),
  stlmene    boolean not null default false,
  pridany    timestamptz not null default now(),
  primary key (konv_id, uid)
);
create index if not exists chat_clen_uid on public.chat_clen (uid);
create table if not exists public.chat_sprava (
  id         bigint generated always as identity primary key,
  konv_id    bigint not null references public.chat_konv(id) on delete cascade,
  uid        uuid not null default auth.uid(),
  text       text,
  priloha    jsonb,                                -- {cesta, nazov, typ, velkost}
  pripnute   boolean not null default false,
  zmazane    boolean not null default false,
  vytvorene  timestamptz not null default now()
);
create index if not exists chat_sprava_konv on public.chat_sprava (konv_id, id desc);
alter table public.chat_konv enable row level security;
alter table public.chat_clen enable row level security;
alter table public.chat_sprava enable row level security;

-- kto smie chatovať (interný tím + účtovníčka); do skupín „všetci“ sa automaticky pridáva tím bez účtovníčky
create or replace function public.chat_smie() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profily where id = auth.uid() and aktivny
    and rola in ('it','ceo','prevadzka','zamestnanec','furman','zakaznicky_servis','prevadzkar','uctovnicka'))
$$;
create or replace function public.chat_spravca() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.moja_rola() in ('it','ceo','prevadzkar'), false)
$$;
create or replace function public.chat_som_clen(p_konv bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_clen c join public.chat_konv k on k.id = c.konv_id
                 where c.konv_id = p_konv and c.uid = auth.uid()) and public.chat_smie()
$$;
drop policy if exists "chat spravy citat" on public.chat_sprava;
create policy "chat spravy citat" on public.chat_sprava for select to authenticated using (public.chat_som_clen(konv_id));

-- členstvo v skupinách „všetci“ (noví ľudia sa pridajú sami)
create or replace function public.chat_sync_vsetci() returns void
language sql security definer set search_path = public as $$
  insert into public.chat_clen (konv_id, uid)
  select k.id, p.id from public.chat_konv k cross join public.profily p
  where k.vsetci and not k.archiv and p.aktivny and p.rola in ('it','ceo','prevadzka','zamestnanec','furman','zakaznicky_servis','prevadzkar')
  on conflict do nothing
$$;

insert into public.chat_konv (typ, nazov, ikona, vsetci)
select 'skupina', 'LBZ tím', '👥', true where not exists (select 1 from public.chat_konv where vsetci);

create or replace function public.chat_meno(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p.meno), ''), split_part(p.email, '@', 1)) from public.profily p where p.id = p_uid
$$;

-- zoznam konverzácií: posledná správa, neprečítané, stlmené
create or replace function public.chat_zoznam() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.chat_smie() then return jsonb_build_object('ok', false, 'text', 'Chat nie je pre tento účet'); end if;
  perform public.chat_sync_vsetci();
  select coalesce(jsonb_agg(x order by x->>'posledna' desc), '[]') into v from (
    select jsonb_build_object('id', k.id, 'typ', k.typ, 'ikona', k.ikona, 'vsetci', k.vsetci, 'archiv', k.archiv,
      'nazov', case when k.typ = 'priama' then (select public.chat_meno(c2.uid) from public.chat_clen c2 where c2.konv_id = k.id and c2.uid <> auth.uid() limit 1) else k.nazov end,
      'druhy', case when k.typ = 'priama' then (select c2.uid from public.chat_clen c2 where c2.konv_id = k.id and c2.uid <> auth.uid() limit 1) end,
      'clenov', (select count(*) from public.chat_clen c3 where c3.konv_id = k.id),
      'stlmene', c.stlmene, 'posledna', k.posledna,
      'neprecitane', (select count(*) from public.chat_sprava s where s.konv_id = k.id and s.vytvorene > c.precitane and s.uid <> auth.uid() and not s.zmazane),
      'sprava', (select jsonb_build_object('text', case when s.zmazane then '(správa zmazaná)' when s.text is null or s.text = '' then '📎 ' || coalesce(s.priloha->>'nazov', 'príloha') else s.text end,
                   'meno', public.chat_meno(s.uid), 'ja', s.uid = auth.uid(), 'kedy', s.vytvorene)
                 from public.chat_sprava s where s.konv_id = k.id order by s.id desc limit 1)) x
    from public.chat_konv k join public.chat_clen c on c.konv_id = k.id and c.uid = auth.uid()
    where not k.archiv or public.chat_spravca()) q;
  return jsonb_build_object('ok', true, 'ja', auth.uid(), 'spravca', public.chat_spravca(), 'konv', v);
end $$;

-- správy konverzácie (posledných 60, alebo staršie pred p_pred); zároveň označí ako prečítané
create or replace function public.chat_spravy(p_konv bigint, p_pred bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s jsonb; v_k public.chat_konv%rowtype;
begin
  if not public.chat_som_clen(p_konv) then return jsonb_build_object('ok', false, 'text', 'Do tejto konverzácie nepatríš'); end if;
  select * into v_k from public.chat_konv where id = p_konv;
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint), '[]') into v_s from (
    select jsonb_build_object('id', s.id, 'uid', s.uid, 'text', case when s.zmazane then null else s.text end,
      'priloha', case when s.zmazane then null else s.priloha end, 'pripnute', s.pripnute, 'zmazane', s.zmazane, 'kedy', s.vytvorene) x
    from public.chat_sprava s where s.konv_id = p_konv and (p_pred is null or s.id < p_pred) order by s.id desc limit 60) q;
  if p_pred is null then update public.chat_clen set precitane = now() where konv_id = p_konv and uid = auth.uid(); end if;
  return jsonb_build_object('ok', true, 'spravy', v_s, 'viac', jsonb_array_length(v_s) = 60,
    'konv', jsonb_build_object('id', v_k.id, 'typ', v_k.typ, 'nazov', v_k.nazov, 'ikona', v_k.ikona, 'vsetci', v_k.vsetci, 'archiv', v_k.archiv),
    'clenovia', (select coalesce(jsonb_agg(jsonb_build_object('uid', c.uid, 'meno', public.chat_meno(c.uid), 'precitane', c.precitane, 'stlmene', c.stlmene) order by public.chat_meno(c.uid)), '[]')
                 from public.chat_clen c where c.konv_id = p_konv),
    'pripnute', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'text', s.text, 'meno', public.chat_meno(s.uid), 'kedy', s.vytvorene) order by s.id desc), '[]')
                 from public.chat_sprava s where s.konv_id = p_konv and s.pripnute and not s.zmazane));
end $$;

create or replace function public.chat_posli(p_konv bigint, p_text text, p_priloha jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_t text := nullif(left(trim(coalesce(p_text, '')), 4000), '');
begin
  if not public.chat_som_clen(p_konv) then return jsonb_build_object('ok', false, 'text', 'Do tejto konverzácie nepatríš'); end if;
  if exists (select 1 from public.chat_konv where id = p_konv and archiv) then return jsonb_build_object('ok', false, 'text', 'Skupina je archivovaná'); end if;
  if v_t is null and p_priloha is null then return jsonb_build_object('ok', false, 'text', 'Prázdna správa'); end if;
  if p_priloha is not null and split_part(p_priloha->>'cesta', '/', 1) <> p_konv::text then return jsonb_build_object('ok', false, 'text', 'Neplatná príloha'); end if;
  insert into public.chat_sprava (konv_id, text, priloha) values (p_konv, v_t, p_priloha) returning id into v_id;
  update public.chat_konv set posledna = now() where id = p_konv;
  update public.chat_clen set precitane = now() where konv_id = p_konv and uid = auth.uid();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.chat_precitane(p_konv bigint) returns jsonb
language sql security definer set search_path = public as $$
  update public.chat_clen set precitane = now() where konv_id = p_konv and uid = auth.uid();
  select jsonb_build_object('ok', true)
$$;

create or replace function public.chat_neprecitane() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.chat_sprava s join public.chat_clen c on c.konv_id = s.konv_id and c.uid = auth.uid()
  join public.chat_konv k on k.id = s.konv_id
  where s.vytvorene > c.precitane and s.uid <> auth.uid() and not s.zmazane and not c.stlmene and not k.archiv and public.chat_smie()
$$;

-- ľudia, s ktorými sa dá písať
create or replace function public.chat_ludia() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.chat_smie() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object('uid', p.id, 'meno', public.chat_meno(p.id), 'rola', p.rola) order by public.chat_meno(p.id)), '[]') end
  from public.profily p where p.aktivny and p.id <> auth.uid()
    and p.rola in ('it','ceo','prevadzka','zamestnanec','furman','zakaznicky_servis','prevadzkar','uctovnicka')
$$;

-- súkromná konverzácia s človekom (nájde existujúcu alebo založí)
create or replace function public.chat_priama(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.chat_smie() then return jsonb_build_object('ok', false, 'text', 'Chat nie je pre tento účet'); end if;
  if p_uid = auth.uid() or not exists (select 1 from public.profily where id = p_uid and aktivny) then return jsonb_build_object('ok', false, 'text', 'Neznámy človek'); end if;
  select k.id into v_id from public.chat_konv k
  where k.typ = 'priama' and exists (select 1 from public.chat_clen where konv_id = k.id and uid = auth.uid())
    and exists (select 1 from public.chat_clen where konv_id = k.id and uid = p_uid) limit 1;
  if v_id is null then
    insert into public.chat_konv (typ) values ('priama') returning id into v_id;
    insert into public.chat_clen (konv_id, uid) values (v_id, auth.uid()), (v_id, p_uid);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- skupina: p = {id?, nazov, ikona, vsetci, clenovia: [uid], archiv}
create or replace function public.chat_skupina_uloz(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_vsetci boolean := coalesce((p->>'vsetci')::boolean, false);
begin
  if not public.chat_spravca() then return jsonb_build_object('ok', false, 'text', 'Skupiny zakladá vedenie (IT, CEO, prevádzkár)'); end if;
  if coalesce(trim(p->>'nazov'), '') = '' then return jsonb_build_object('ok', false, 'text', 'Zadaj názov skupiny'); end if;
  if v_id is null then
    insert into public.chat_konv (typ, nazov, ikona, vsetci) values ('skupina', left(trim(p->>'nazov'), 60), nullif(left(p->>'ikona', 8), ''), v_vsetci) returning id into v_id;
  else
    update public.chat_konv set nazov = left(trim(p->>'nazov'), 60), ikona = nullif(left(p->>'ikona', 8), ''), vsetci = v_vsetci,
      archiv = coalesce((p->>'archiv')::boolean, archiv) where id = v_id and typ = 'skupina';
    if not found then return jsonb_build_object('ok', false, 'text', 'Skupina sa nenašla'); end if;
  end if;
  if not v_vsetci and p ? 'clenovia' then
    delete from public.chat_clen where konv_id = v_id and uid <> auth.uid()
      and uid not in (select (jsonb_array_elements_text(p->'clenovia'))::uuid);
    insert into public.chat_clen (konv_id, uid) select v_id, (x)::uuid from jsonb_array_elements_text(p->'clenovia') x
      where exists (select 1 from public.profily where id = (x)::uuid and aktivny) on conflict do nothing;
  end if;
  insert into public.chat_clen (konv_id, uid) values (v_id, auth.uid()) on conflict do nothing;
  perform public.chat_sync_vsetci();
  return jsonb_build_object('ok', true, 'id', v_id, 'text', 'Skupina uložená');
end $$;

-- správa: zmazať (vlastnú alebo vedenie) / pripnúť / odopnúť (vedenie)
create or replace function public.chat_sprava_uprav(p_id bigint, p_akcia text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.chat_sprava%rowtype;
begin
  select * into v from public.chat_sprava where id = p_id;
  if v.id is null or not public.chat_som_clen(v.konv_id) then return jsonb_build_object('ok', false, 'text', 'Správa sa nenašla'); end if;
  if p_akcia = 'zmaz' then
    if v.uid <> auth.uid() and not public.chat_spravca() then return jsonb_build_object('ok', false, 'text', 'Zmazať môžeš len svoju správu'); end if;
    update public.chat_sprava set zmazane = true, pripnute = false where id = p_id;
  elsif p_akcia in ('pripni', 'odopni') then
    if not public.chat_spravca() then return jsonb_build_object('ok', false, 'text', 'Pripínať môže vedenie'); end if;
    update public.chat_sprava set pripnute = (p_akcia = 'pripni') where id = p_id;
  else return jsonb_build_object('ok', false, 'text', 'Neznáma akcia'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.chat_stlm(p_konv bigint, p_stlm boolean) returns jsonb
language sql security definer set search_path = public as $$
  update public.chat_clen set stlmene = p_stlm where konv_id = p_konv and uid = auth.uid();
  select jsonb_build_object('ok', true)
$$;

revoke all on function public.chat_smie(), public.chat_spravca(), public.chat_som_clen(bigint), public.chat_sync_vsetci(), public.chat_meno(uuid),
  public.chat_zoznam(), public.chat_spravy(bigint, bigint), public.chat_posli(bigint, text, jsonb), public.chat_precitane(bigint), public.chat_neprecitane(),
  public.chat_ludia(), public.chat_priama(uuid), public.chat_skupina_uloz(jsonb), public.chat_sprava_uprav(bigint, text), public.chat_stlm(bigint, boolean) from public, anon;
grant execute on function public.chat_smie(), public.chat_spravca(), public.chat_som_clen(bigint), public.chat_meno(uuid),
  public.chat_zoznam(), public.chat_spravy(bigint, bigint), public.chat_posli(bigint, text, jsonb), public.chat_precitane(bigint), public.chat_neprecitane(),
  public.chat_ludia(), public.chat_priama(uuid), public.chat_skupina_uloz(jsonb), public.chat_sprava_uprav(bigint, text), public.chat_stlm(bigint, boolean) to authenticated;

insert into public.moduly (kod, nazov, poradie, aktivny) values ('chat', 'Chat', 3, true)
on conflict (kod) do update set nazov = excluded.nazov, aktivny = true;
insert into public.pristupy (rola, modul, uprava)
select r, 'chat', true from unnest(array['it','ceo','prevadzka','zamestnanec','furman','zakaznicky_servis','prevadzkar','uctovnicka']) r on conflict do nothing;

-- ---- len v Supabase: úložisko príloh + Realtime ----
create or replace function public.chat_cesta_ok(p_cesta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v text := split_part(coalesce(p_cesta, ''), '/', 1);
begin
  if v !~ '^[0-9]{1,15}$' then return false; end if;
  return public.chat_som_clen(v::bigint);
end $$;
grant execute on function public.chat_cesta_ok(text) to authenticated;
insert into storage.buckets (id, name, public, file_size_limit) values ('chat', 'chat', false, 15728640) on conflict (id) do nothing;
drop policy if exists "chat subor citat" on storage.objects;
create policy "chat subor citat" on storage.objects for select to authenticated using (bucket_id = 'chat' and public.chat_cesta_ok(name));
drop policy if exists "chat subor nahrat" on storage.objects;
create policy "chat subor nahrat" on storage.objects for insert to authenticated with check (bucket_id = 'chat' and public.chat_cesta_ok(name));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_sprava') then
    alter publication supabase_realtime add table public.chat_sprava;
  end if;
end $$;
-- IT a CEO vidia všetky moduly
insert into public.pristupy (rola, modul, uprava) select r, m.kod, true from public.moduly m cross join unnest(array['it','ceo']) r on conflict do nothing;
-- s28b: práva k tabuľkám (Edge Function = service_role; Realtime číta cez politiku)
grant select, insert, update, delete on public.chat_konv, public.chat_clen, public.chat_sprava to service_role;
grant select on public.chat_sprava to authenticated;
