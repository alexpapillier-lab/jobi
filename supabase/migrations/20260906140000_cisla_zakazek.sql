-- Atomické přidělování čísel zakázek.
--
-- Číslo si dosud počítal klient: načetl nejvyšší existující a přičetl jedna.
-- Když dva lidé na dvou pultech zakládali zakázku ve stejnou chvíli, oba
-- dostali stejné číslo. V produkci se to už stalo – v jednom servisu jsou
-- tři zakázky se stejným číslem.
--
-- Čítač je jeden řádek na servis a předponu (předpona v sobě nese i zkratku
-- pobočky a rok). Zvýšení a přečtení je jeden příkaz, takže druhý žadatel
-- počká na zámku řádku a dostane další číslo.
create table if not exists public.ticket_code_counters (
  service_id uuid not null references public.services(id) on delete cascade,
  prefix text not null,
  posledni integer not null,
  updated_at timestamptz not null default now(),
  primary key (service_id, prefix)
);

alter table public.ticket_code_counters enable row level security;
-- Bez politiky: mění se jen přes funkci níž, která běží jako definer.
revoke all on table public.ticket_code_counters from anon, authenticated;

comment on table public.ticket_code_counters is
  'Poslední přidělené pořadové číslo zakázky pro servis a předponu. Mění se výhradně přes dalsi_cislo_zakazky().';

/**
 * Vrátí další pořadové číslo pro danou předponu.
 *
 * Při prvním volání se čítač usadí podle nejvyššího čísla, které v zakázkách
 * (i smazaných) už je – aby navazoval na to, co servis vytiskl. Volající si
 * z čísla složí kód: predpona || lpad(cislo, 6, '0').
 */
create or replace function public.dalsi_cislo_zakazky(p_service_id uuid, p_prefix text)
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

  -- Právo se kontroluje ručně: funkce je security definer a nesmí přidělovat
  -- čísla v cizím servisu.
  if not exists (
    select 1 from public.service_memberships m
    where m.service_id = p_service_id and m.user_id = auth.uid()
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;

  select coalesce(max(nullif(regexp_replace(right(t.code, 6), '\D', '', 'g'), '')::integer), 0)
    into v_max
    from public.tickets t
   where t.service_id = p_service_id
     and t.code like p_prefix || '%';

  insert into public.ticket_code_counters as c (service_id, prefix, posledni)
  values (p_service_id, p_prefix, greatest(v_max, 0) + 1)
  on conflict (service_id, prefix)
  do update set posledni = greatest(c.posledni, v_max) + 1, updated_at = now()
  returning c.posledni into v_cislo;

  return v_cislo;
end;
$$;

revoke all on function public.dalsi_cislo_zakazky(uuid, text) from public, anon;
grant execute on function public.dalsi_cislo_zakazky(uuid, text) to authenticated, service_role;
