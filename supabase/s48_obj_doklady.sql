-- =========================================================================
-- 48) OBJEDNÁVKY – doklady z Upgates (faktúry, dobropisy, účtenky), filtre ako v Upgates,
--     vystavenie dobropisu pred Storno (v0.29.0) – 30. 9. 2026
--     Doklady vznikajú a ostávajú v Upgates; appka ich len sťahuje a zobrazuje.
-- =========================================================================
create table if not exists public.obj_doklady (
  cislo       text primary key,
  typ         text not null,                 -- invoice | creditNote | receipt (ako Upgates)
  objednavka  text,
  suvisiaci   text,                          -- pri dobropise číslo faktúry
  vystavena   date,
  splatnost   date,
  zaplatena   date,
  zaplatene   boolean not null default false,
  suma        numeric(12,2),
  zvysok      numeric(12,2),
  pdf         text,
  vytvorene   timestamptz,
  stiahnute   timestamptz not null default now()
);
create index if not exists obj_doklady_obj on public.obj_doklady (objednavka);
alter table public.obj_doklady enable row level security;
grant select, insert, update, delete on public.obj_doklady to service_role;

create index if not exists objednavky_vytvorena on public.objednavky (vytvorena desc);

-- p = [{cislo, typ, objednavka, suvisiaci, vystavena, splatnost, zaplatena, zaplatene, suma, zvysok, pdf, vytvorene}]
create or replace function public.obj_doklady_uloz(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.obj_doklady as d (cislo, typ, objednavka, suvisiaci, vystavena, splatnost, zaplatena, zaplatene, suma, zvysok, pdf, vytvorene, stiahnute)
  select trim(x->>'cislo'), coalesce(nullif(x->>'typ', ''), 'invoice'), nullif(trim(x->>'objednavka'), ''), nullif(trim(x->>'suvisiaci'), ''),
         nullif(left(x->>'vystavena', 10), '')::date, nullif(left(x->>'splatnost', 10), '')::date, nullif(left(x->>'zaplatena', 10), '')::date,
         coalesce((x->>'zaplatene')::boolean, false), nullif(x->>'suma', '')::numeric, nullif(x->>'zvysok', '')::numeric, nullif(x->>'pdf', ''),
         nullif(x->>'vytvorene', '')::timestamptz, now()
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x where coalesce(trim(x->>'cislo'), '') <> ''
  on conflict (cislo) do update set typ = excluded.typ, objednavka = excluded.objednavka, suvisiaci = excluded.suvisiaci, vystavena = excluded.vystavena,
    splatnost = excluded.splatnost, zaplatena = excluded.zaplatena, zaplatene = excluded.zaplatene, suma = excluded.suma, zvysok = excluded.zvysok,
    pdf = excluded.pdf, vytvorene = excluded.vytvorene, stiahnute = now();
  get diagnostics n = row_count;
  update public.objednavky o set faktura = d.cislo from public.obj_doklady d
   where d.objednavka = o.cislo and d.typ = 'invoice' and nullif(o.faktura, '') is null;
  update public.objednavky o set dobropis = d.cislo, dobropis_overeny = now() from public.obj_doklady d
   where d.objednavka = o.cislo and d.typ = 'creditNote' and nullif(o.dobropis, '') is null;
  return n;
end $$;
revoke all on function public.obj_doklady_uloz(jsonb) from public, anon, authenticated;
grant execute on function public.obj_doklady_uloz(jsonb) to service_role;

create or replace function public.obj_detail(p_cislo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.objednavky;
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Objednávky nemáte povolené'); end if;
  select * into o from public.objednavky where cislo = p_cislo;
  if o.cislo is null then return jsonb_build_object('ok', false, 'text', 'Objednávka sa nenašla'); end if;
  return jsonb_build_object('ok', true, 'ostry', public.obj_ostry(), 'objednavka', to_jsonb(o) || jsonb_build_object('osobny', public.obj_je_osobny(o.doprava)),
    'polozky', coalesce((select jsonb_agg(to_jsonb(p) order by p.nazov) from public.objednavky_polozky p where p.cislo = p_cislo), '[]'),
    'fronta', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'typ', f.typ, 'stav', f.stav, 'chyba', f.chyba, 'data', f.data, 'vytvorene', f.vytvorene, 'odoslane', f.odoslane) order by f.id desc)
                        from public.obj_fronta f where f.cislo = p_cislo), '[]'),
    'doklady', coalesce((select jsonb_agg(jsonb_build_object('cislo', d.cislo, 'typ', d.typ, 'vystavena', d.vystavena, 'splatnost', d.splatnost,
                  'zaplatene', d.zaplatene, 'zaplatena', d.zaplatena, 'suma', d.suma, 'zvysok', d.zvysok, 'suvisiaci', d.suvisiaci, 'pdf', d.pdf) order by d.vystavena, d.cislo)
                from public.obj_doklady d where d.objednavka = p_cislo), '[]'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('cas', l.cas, 'ucet', l.ucet, 'text', l.text) order by l.cas desc) from (select * from public.obj_log where cislo = p_cislo order by cas desc limit 50) l), '[]'),
    'stavy', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'stav'), '[]'),
    'dopravy', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'doprava'), '[]'),
    'platby', coalesce((select jsonb_agg(jsonb_build_object('kod', kod, 'nazov', nazov) order by nazov) from public.upgates_ciselnik where typ = 'platba'), '[]'));
end $$;

create or replace function public.obj_zoznam(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_text(coalesce(p->>'hladaj', '')); v_st text := nullif(p->>'stav', '');
  v_dop text := nullif(p->>'doprava', ''); v_pl text := nullif(p->>'platba', '');
  v_od date := nullif(p->>'od', '')::date; v_n int;
  v_lim int := least(greatest(coalesce(nullif(p->>'limit', '')::int, 300), 50), 3000); v_do date := nullif(p->>'do', '')::date;
  v_dok text := nullif(p->>'doklad', ''); v_zapl text := nullif(p->>'zaplatene', ''); v_zdroj text := nullif(p->>'zdroj', '');
  v_s_od numeric := nullif(replace(p->>'suma_od', ',', '.'), '')::numeric; v_s_do numeric := nullif(replace(p->>'suma_do', ',', '.'), '')::numeric;
  v_prod text := public.norm_text(coalesce(p->>'produkt', '')); v_miesto text := public.norm_text(coalesce(p->>'miesto', ''));
begin
  if not public.obj_smiem() then return jsonb_build_object('ok', false, 'text', 'Objednávky nemáte povolené'); end if;
  select count(*) into v_n from public.objednavky o
      where (v = '' or public.norm_text(o.cislo) like '%' || v || '%' or public.norm_text(coalesce(o.meno,'')) like '%' || v || '%'
             or public.norm_text(coalesce(o.firma,'')) like '%' || v || '%' or public.norm_text(coalesce(o.email,'')) like '%' || v || '%' or public.norm_text(coalesce(o.faktura,'')) like '%' || v || '%' or public.norm_text(coalesce(o.dobropis,'')) like '%' || v || '%'
             or (length(regexp_replace(v, '\D', '', 'g')) >= 4 and regexp_replace(coalesce(o.telefon, ''), '\D', '', 'g') like '%' || regexp_replace(v, '\D', '', 'g') || '%'))
        and (v_st is null or o.status = v_st)
        and (v_dop is null or o.doprava = v_dop)
        and (v_pl is null or o.platba_nazov = v_pl or o.platba = v_pl)
        and (coalesce((p->>'osobny')::boolean, false) = false or public.obj_je_osobny(o.doprava))
        and (v_od is null or o.vytvorena >= v_od) and (v_do is null or o.vytvorena < v_do + 1)
        and (v_dok is null or (v_dok = 'faktura' and nullif(o.faktura, '') is not null) or (v_dok = 'bez_faktury' and nullif(o.faktura, '') is null)
             or (v_dok = 'dobropis' and (nullif(o.dobropis, '') is not null or exists (select 1 from public.obj_doklady d where d.objednavka = o.cislo and d.typ = 'creditNote'))))
        and (v_zapl is null or (v_zapl = 'ano') = (o.platba = 'ZAPLATENÉ' or exists (select 1 from public.obj_doklady d where d.objednavka = o.cislo and d.typ = 'invoice' and d.zaplatene)))
        and (v_s_od is null or o.suma >= v_s_od) and (v_s_do is null or o.suma <= v_s_do)
        and (v_prod = '' or exists (select 1 from public.objednavky_polozky pp where pp.cislo = o.cislo and (public.norm_text(coalesce(pp.nazov, '')) like '%' || v_prod || '%' or public.norm_text(pp.kod) like '%' || v_prod || '%')))
        and (v_miesto = '' or public.norm_text(coalesce(o.mesto, '')) like '%' || v_miesto || '%' or regexp_replace(coalesce(o.psc, ''), '\s', '', 'g') like regexp_replace(v_miesto, '\s', '', 'g') || '%')
        and (v_zdroj is null or o.zdroj = v_zdroj)
;
  return jsonb_build_object('ok', true, 'ostry', public.obj_ostry(), 'najdenych', v_n, 'limit', v_lim,
    'stavy', (select coalesce(jsonb_agg(distinct o.status), '[]') from public.objednavky o where o.status is not null and o.status <> ''),
    'dopravy', (select coalesce(jsonb_agg(distinct o.doprava), '[]') from public.objednavky o where o.doprava is not null and o.doprava <> ''),
    'platby', (select coalesce(jsonb_agg(distinct o.platba_nazov), '[]') from public.objednavky o where o.platba_nazov is not null and o.platba_nazov <> ''),
    'pocty', (select coalesce(jsonb_object_agg(s, n), '{}') from (select o.status s, count(*) n from public.objednavky o where o.status is not null and o.status <> '' group by o.status) q),
    'spolu', (select count(*) from public.objednavky),
    'farby', (select coalesce(jsonb_object_agg(c.nazov, c.data->>'farba'), '{}') from public.upgates_ciselnik c where c.typ = 'stav' and nullif(c.data->>'farba', '') is not null),
    'caka', (select count(*) from public.obj_fronta where stav = 'caka'),
    'objednavky', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('cislo', o.cislo, 'zdroj', o.zdroj, 'status', o.status, 'meno', coalesce(nullif(o.meno, ''), o.firma),
        'mesto', o.mesto, 'suma', o.suma, 'platba', o.platba, 'platba_nazov', o.platba_nazov, 'doprava', o.doprava, 'email', o.email, 'poznamka', o.poznamka,
        'poloziek', (select count(*) from public.objednavky_polozky p where p.cislo = o.cislo), 'vytvorena', o.vytvorena,
        'osobny', public.obj_je_osobny(o.doprava), 'faktura', o.faktura, 'dobropis', coalesce(o.dobropis, (select min(d.cislo) from public.obj_doklady d where d.objednavka = o.cislo and d.typ = 'creditNote')),
        'zaplatena', (o.platba = 'ZAPLATENÉ' or exists (select 1 from public.obj_doklady d where d.objednavka = o.cislo and d.typ = 'invoice' and d.zaplatene)),
        'caka', (select count(*) from public.obj_fronta f where f.cislo = o.cislo and f.stav in ('caka','chyba')),
        'furmanka', (select public.furmanka_nazov(fu.region, fu.datum) from public.zaradenia z join public.furmanky fu on fu.id = z.furmanka_id where z.cislo = o.cislo)) x
      from public.objednavky o
      where (v = '' or public.norm_text(o.cislo) like '%' || v || '%' or public.norm_text(coalesce(o.meno,'')) like '%' || v || '%'
             or public.norm_text(coalesce(o.firma,'')) like '%' || v || '%' or public.norm_text(coalesce(o.email,'')) like '%' || v || '%' or public.norm_text(coalesce(o.faktura,'')) like '%' || v || '%' or public.norm_text(coalesce(o.dobropis,'')) like '%' || v || '%'
             or (length(regexp_replace(v, '\D', '', 'g')) >= 4 and regexp_replace(coalesce(o.telefon, ''), '\D', '', 'g') like '%' || regexp_replace(v, '\D', '', 'g') || '%'))
        and (v_st is null or o.status = v_st)
        and (v_dop is null or o.doprava = v_dop)
        and (v_pl is null or o.platba_nazov = v_pl or o.platba = v_pl)
        and (coalesce((p->>'osobny')::boolean, false) = false or public.obj_je_osobny(o.doprava))
        and (v_od is null or o.vytvorena >= v_od) and (v_do is null or o.vytvorena < v_do + 1)
        and (v_dok is null or (v_dok = 'faktura' and nullif(o.faktura, '') is not null) or (v_dok = 'bez_faktury' and nullif(o.faktura, '') is null)
             or (v_dok = 'dobropis' and (nullif(o.dobropis, '') is not null or exists (select 1 from public.obj_doklady d where d.objednavka = o.cislo and d.typ = 'creditNote'))))
        and (v_zapl is null or (v_zapl = 'ano') = (o.platba = 'ZAPLATENÉ' or exists (select 1 from public.obj_doklady d where d.objednavka = o.cislo and d.typ = 'invoice' and d.zaplatene)))
        and (v_s_od is null or o.suma >= v_s_od) and (v_s_do is null or o.suma <= v_s_do)
        and (v_prod = '' or exists (select 1 from public.objednavky_polozky pp where pp.cislo = o.cislo and (public.norm_text(coalesce(pp.nazov, '')) like '%' || v_prod || '%' or public.norm_text(pp.kod) like '%' || v_prod || '%')))
        and (v_miesto = '' or public.norm_text(coalesce(o.mesto, '')) like '%' || v_miesto || '%' or regexp_replace(coalesce(o.psc, ''), '\s', '', 'g') like regexp_replace(v_miesto, '\s', '', 'g') || '%')
        and (v_zdroj is null or o.zdroj = v_zdroj)
      order by o.vytvorena desc nulls last limit v_lim) q), '[]'));
end $$;

-- záznam do histórie objednávky z Edge Function
create or replace function public.obj_zapis_log_s(p_cislo text, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into public.obj_log (cislo, ucet, text) values (p_cislo, 'upgates', left(p_text, 500))
$$;
revoke all on function public.obj_zapis_log_s(text, text) from public, anon, authenticated;
grant execute on function public.obj_zapis_log_s(text, text) to service_role;
