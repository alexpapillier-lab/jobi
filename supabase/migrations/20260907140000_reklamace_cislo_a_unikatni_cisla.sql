-- Kód reklamace přiděluje databáze; čísla faktur a kódy reklamací jsou unikátní.
--
-- Kód reklamace si dosud počítal klient jako „nejvyšší + 1" – stejná
-- souběhová chyba, jaká byla u zakázek (dvě reklamace naráz = stejný kód).
-- Čítač je jeden řádek na servis a předponu (R + rok), stejně jako
-- ticket_code_counters; při prvním volání se usadí podle existujících kódů.
--
-- Unikátní indexy: v produkci dnes žádné duplicity nejsou (ověřeno před
-- nasazením), takže se dají přidat bez úprav dat. Číslo faktury lze v editoru
-- přepsat ručně a klient ho kontroluje – index je pojistka pro souběh.
create table if not exists public.warranty_claim_code_counters (
  service_id uuid not null references public.services(id) on delete cascade,
  prefix text not null,
  posledni integer not null,
  updated_at timestamptz not null default now(),
  primary key (service_id, prefix)
);

alter table public.warranty_claim_code_counters enable row level security;
revoke all on table public.warranty_claim_code_counters from anon, authenticated;

comment on table public.warranty_claim_code_counters is
  'Poslední přidělené pořadové číslo reklamace pro servis a předponu. Mění se výhradně přes dalsi_cislo_reklamace().';

create or replace function public.dalsi_cislo_reklamace(p_service_id uuid, p_prefix text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_cislo integer;
begin
  if p_service_id is null or coalesce(p_prefix, '') = '' then
    raise exception 'Chybí servis nebo předpona.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.service_memberships m
    where m.service_id = p_service_id and m.user_id = auth.uid()
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;

  select coalesce(max(nullif(regexp_replace(right(w.code, 6), '\D', '', 'g'), '')::integer), 0)
    into v_max
    from public.warranty_claims w
   where w.service_id = p_service_id
     and w.code like p_prefix || '%';

  insert into public.warranty_claim_code_counters as c (service_id, prefix, posledni)
  values (p_service_id, p_prefix, greatest(v_max, 0) + 1)
  on conflict (service_id, prefix)
  do update set posledni = greatest(c.posledni, v_max) + 1, updated_at = now()
  returning c.posledni into v_cislo;

  return v_cislo;
end;
$$;

revoke all on function public.dalsi_cislo_reklamace(uuid, text) from public, anon;
grant execute on function public.dalsi_cislo_reklamace(uuid, text) to authenticated, service_role;

create unique index if not exists warranty_claims_service_code_unikatni
  on public.warranty_claims (service_id, code);

-- Faktury: smazané (deleted_at) mimo, ať jde číslo po omylu smazané faktury použít znovu.
create unique index if not exists invoices_service_number_unikatni
  on public.invoices (service_id, number)
  where deleted_at is null and coalesce(number, '') <> '';
