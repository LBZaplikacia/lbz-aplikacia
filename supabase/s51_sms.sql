-- =========================================================================
-- 51) SMS cez GoSMS – odoslané SMS a odpovede zákazníkov (30. 9. 2026)
--     Edge Function „gosms“: odoslanie (prihlásený ZS/CEO/IT), webhook odpovedí z GoSMS (overí sa spätne cez GoSMS API).
-- =========================================================================
create table if not exists public.sms_odoslane (
  id           bigint generated always as identity primary key,
  gosms_id     bigint,
  cislo        text,
  furmanka_id  bigint,
  telefon      text not null,
  text         text not null,
  typ          text not null default 'rucne' check (typ in ('den_vopred','cestou','rucne')),
  stav         text not null default 'odoslane' check (stav in ('odoslane','chyba')),
  chyba        text,
  kto          uuid default auth.uid(),
  odoslane     timestamptz not null default now()
);
create index if not exists sms_odoslane_gosms on public.sms_odoslane (gosms_id);
create index if not exists sms_odoslane_cislo on public.sms_odoslane (cislo, odoslane desc);
alter table public.sms_odoslane enable row level security;

create table if not exists public.sms_odpovede (
  id           bigint primary key,            -- ID odpovede v GoSMS
  gosms_id     bigint,                        -- ID odoslanej správy v GoSMS
  cislo        text,
  furmanka_id  bigint,
  telefon      text,
  text         text not null,
  prijata      timestamptz not null default now(),
  ulozena      timestamptz not null default now(),
  precitana    timestamptz,
  precital     uuid
);
create index if not exists sms_odpovede_cislo on public.sms_odpovede (cislo, prijata desc);
create index if not exists sms_odpovede_furmanka on public.sms_odpovede (furmanka_id, prijata desc);
alter table public.sms_odpovede enable row level security;
grant select, insert, update on public.sms_odoslane, public.sms_odpovede to service_role;

-- zápis odoslaných SMS (service_role): p = [{gosms_id, cislo, furmanka_id, telefon, text, typ, stav, chyba, kto}]
create or replace function public.sms_odoslane_uloz(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.sms_odoslane (gosms_id, cislo, furmanka_id, telefon, text, typ, stav, chyba, kto)
    select nullif(x->>'gosms_id', '')::bigint, x->>'cislo', nullif(x->>'furmanka_id', '')::bigint, x->>'telefon', x->>'text',
           coalesce(x->>'typ', 'rucne'), coalesce(x->>'stav', 'odoslane'), x->>'chyba', nullif(x->>'kto', '')::uuid
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x;
  get diagnostics v_n = row_count;
  insert into public.obj_log (cislo, ucet, text)
    select x->>'cislo', 'sms', case when coalesce(x->>'stav', 'odoslane') = 'odoslane' then 'SMS odoslaná: ' else 'SMS neodoslaná (' || coalesce(x->>'chyba', '') || '): ' end || left(x->>'text', 200)
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x where nullif(x->>'cislo', '') is not null;
  return v_n;
end $$;

-- zápis odpovedí (service_role): p = [{id, gosms_id, telefon, text, prijata}] – objednávka sa dohľadá podľa odoslanej SMS
create or replace function public.sms_odpovede_uloz(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.sms_odpovede (id, gosms_id, cislo, furmanka_id, telefon, text, prijata)
    select (x->>'id')::bigint, nullif(x->>'gosms_id', '')::bigint, s.cislo, s.furmanka_id, x->>'telefon', x->>'text',
           coalesce(nullif(x->>'prijata', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
    left join lateral (select cislo, furmanka_id from public.sms_odoslane o
                       where o.gosms_id = nullif(x->>'gosms_id', '')::bigint order by o.id desc limit 1) s on true
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.sms_odoslane_uloz(jsonb), public.sms_odpovede_uloz(jsonb) from public, anon, authenticated;
grant execute on function public.sms_odoslane_uloz(jsonb), public.sms_odpovede_uloz(jsonb) to service_role;
