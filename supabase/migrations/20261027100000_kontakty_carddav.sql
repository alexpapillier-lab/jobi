-- Zákazníci v kontaktech telefonu (CardDAV, jen pro čtení).
--
-- Každý člen si v Jobi vytvoří přístup pro svůj telefon (jméno + heslo
-- jen pro kontakty, ne heslo k účtu). Telefon pak přes api.appjobi.com/carddav
-- stahuje adresář „Zákazníci <servis>“ a aktualizuje ho sám. Zrušený přístup,
-- odebraný člen nebo vypnutý servis = telefon nic nedostane.
--
--   kontakty_pristupy           – přístupy (heslo jen jako SHA-256)
--   kontakty_pristup_vytvor()   – nový přístup; heslo se vrátí jen jednou
--   kontakty_pristup_zrus()     – zrušit (vlastní, nebo vlastník/admin servisu)
--   kontakty_karty()            – data pro adresář (jen service_role, edge funkce kontakty)
--
-- Obsah: všichni zákazníci servisu s telefonem nebo e-mailem (všichni členové
-- je vidí i v aplikaci), firma, IČO, adresa a v poznámce až 10 posledních
-- zakázek – jen z poboček, které daný člen vidí.

create table if not exists public.kontakty_pristupy (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  login text not null unique,
  heslo_hash text not null,
  nazev text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
comment on table public.kontakty_pristupy is
  'Přístupy telefonů k adresáři zákazníků (CardDAV). Heslo jen jako SHA-256; zapisují jen RPC kontakty_pristup_*.';
create index if not exists kontakty_pristupy_uzivatel on public.kontakty_pristupy (user_id, service_id);

alter table public.kontakty_pristupy enable row level security;
revoke all on public.kontakty_pristupy from anon;
revoke insert, update, delete on public.kontakty_pristupy from authenticated;
-- Vlastní přístupy, a vlastník/admin servisu vidí přístupy celého týmu (zrušení ztraceného telefonu).
drop policy if exists "kontakty_pristupy_cte" on public.kontakty_pristupy;
create policy "kontakty_pristupy_cte" on public.kontakty_pristupy
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.service_memberships m
                where m.service_id = kontakty_pristupy.service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );

create or replace function public.kontakty_pristup_vytvor(p_service_id uuid, p_nazev text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login text;
  v_heslo text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = auth.uid()
  ) then
    raise exception 'Nejste členem servisu.' using errcode = '42501';
  end if;
  if not public.servis_smi_pracovat(p_service_id) then
    raise exception 'Servis je vypnutý nebo mu skončil přístup.' using errcode = '42501';
  end if;
  if (select count(*) from public.kontakty_pristupy where user_id = auth.uid() and revoked_at is null) >= 10 then
    raise exception 'Máte už 10 přístupů – nejdřív nějaký zrušte.' using errcode = '22023';
  end if;
  -- Jméno bez záměn (malá písmena a číslice), heslo 24 znaků bez znaků, které se špatně přepisují.
  v_login := 'jobi-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_heslo := translate(encode(gen_random_bytes(18), 'base64'), '+/=lIO0', 'abcdxyz');
  insert into public.kontakty_pristupy (user_id, service_id, login, heslo_hash, nazev)
  values (auth.uid(), p_service_id, v_login, encode(digest(v_heslo, 'sha256'), 'hex'), nullif(btrim(coalesce(p_nazev, '')), ''));
  return jsonb_build_object('login', v_login, 'heslo', v_heslo);
end;
$$;
revoke all on function public.kontakty_pristup_vytvor(uuid, text) from public, anon;
grant execute on function public.kontakty_pristup_vytvor(uuid, text) to authenticated;

create or replace function public.kontakty_pristup_zrus(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.kontakty_pristupy%rowtype;
begin
  select * into r from public.kontakty_pristupy where id = p_id;
  if r.id is null then
    raise exception 'Přístup nenalezen.' using errcode = 'P0002';
  end if;
  if r.user_id is distinct from auth.uid() and not exists (
    select 1 from public.service_memberships m
     where m.service_id = r.service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then
    raise exception 'Zrušit jde jen vlastní přístup (nebo jako vlastník/admin servisu).' using errcode = '42501';
  end if;
  update public.kontakty_pristupy set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end;
$$;
revoke all on function public.kontakty_pristup_zrus(uuid) from public, anon;
grant execute on function public.kontakty_pristup_zrus(uuid) to authenticated;

-- Adresář pro telefon. Ověří jméno a heslo; null = neplatný přístup.
create or replace function public.kontakty_karty(p_login text, p_heslo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r public.kontakty_pristupy%rowtype;
  v_nazev text;
begin
  select * into r from public.kontakty_pristupy
   where login = p_login and revoked_at is null
     and heslo_hash = encode(digest(coalesce(p_heslo, ''), 'sha256'), 'hex');
  if r.id is null then
    return null;
  end if;
  -- Člen pořád v servisu, servis zapnutý a s platným přístupem (jako servis_smi_pracovat, bez auth.uid()).
  if not exists (select 1 from public.service_memberships m where m.service_id = r.service_id and m.user_id = r.user_id)
     or not exists (select 1 from public.services s where s.id = r.service_id and s.active)
     or not exists (select 1 from public.service_entitlements e
                     where e.service_id = r.service_id and e.module = 'access' and e.active
                       and (e.valid_until is null or e.valid_until > now())) then
    return null;
  end if;
  select name into v_nazev from public.services where id = r.service_id;
  update public.kontakty_pristupy set last_used_at = now()
   where id = r.id and (last_used_at is null or last_used_at < now() - interval '10 minutes');
  return jsonb_build_object(
    'servis', v_nazev,
    'pristup', r.id,
    'karty', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'jmeno', c.name,
        'telefon', c.phone,
        'email', c.email,
        'firma', c.company,
        'ico', c.ico,
        'ulice', c.address_street,
        'mesto', c.address_city,
        'psc', c.address_zip,
        'zeme', c.address_country,
        'upraveno', c.updated_at,
        'zakazky', (
          select coalesce(jsonb_agg(jsonb_build_object('kod', t.code, 'zarizeni', t.title, 'prijato', t.created_at) order by t.created_at desc), '[]'::jsonb)
            from (select t.code, t.title, t.created_at
                    from public.tickets t
                   where t.service_id = r.service_id and t.customer_id = c.id and t.deleted_at is null
                     and public.pobocka_povolena_pro(r.user_id, r.service_id, t.branch_id)
                   order by t.created_at desc
                   limit 10) t
        )
      ) order by c.name)
        from public.customers c
       where c.service_id = r.service_id
         and c.anonymized_at is null
         and coalesce(btrim(c.name), '') <> ''
         and (coalesce(btrim(c.phone), '') <> '' or coalesce(btrim(c.email), '') <> '')
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.kontakty_karty(text, text) from public, anon, authenticated;
grant execute on function public.kontakty_karty(text, text) to service_role;
