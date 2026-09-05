-- Napojení na fakturační aplikace (iDoklad, později Fakturoid / Pohoda).
--
-- `service_integrations` drží přihlašovací údaje a nastavení propojení na
-- servis; smí je číst a měnit jen majitel / správce (RLS). Edge funkce
-- `invoice-export` s nimi pracuje přes service role a do `invoices` zapíše,
-- kam a pod jakým číslem doklad odešel, aby se neposlal dvakrát.

create table if not exists public.service_integrations (
  service_id uuid not null references public.services(id) on delete cascade,
  provider text not null check (provider in ('idoklad', 'fakturoid')),
  -- provider-specifické: idoklad = { client_id, client_secret }
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service_id, provider)
);

drop trigger if exists trg_service_integrations_updated_at on public.service_integrations;
create trigger trg_service_integrations_updated_at
  before update on public.service_integrations
  for each row execute function public.set_updated_at();

alter table public.service_integrations enable row level security;

drop policy if exists service_integrations_admin_select on public.service_integrations;
create policy service_integrations_admin_select
  on public.service_integrations for select to authenticated
  using (public.is_owner_or_admin(service_id));

drop policy if exists service_integrations_admin_write on public.service_integrations;
create policy service_integrations_admin_write
  on public.service_integrations for all to authenticated
  using (public.is_owner_or_admin(service_id))
  with check (public.is_owner_or_admin(service_id));

grant select, insert, update, delete on public.service_integrations to authenticated;

-- Členové (ne jen správci) potřebují vědět, jestli je propojení zapnuté,
-- aby se jim v detailu faktury ukázalo tlačítko – bez tajemství.
create or replace function public.service_integration_providers(p_service_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(provider order by provider), '{}')
    from public.service_integrations i
   where i.service_id = p_service_id
     and i.active
     and exists (
       select 1 from public.service_memberships m
        where m.service_id = p_service_id and m.user_id = auth.uid()
     );
$$;
grant execute on function public.service_integration_providers(uuid) to authenticated;

-- Stopa exportu na faktuře.
alter table public.invoices
  add column if not exists external_provider text,
  add column if not exists external_id text,
  add column if not exists external_number text,
  add column if not exists external_url text,
  add column if not exists exported_at timestamptz;

comment on column public.invoices.external_provider is 'Kam byla faktura exportována (idoklad, fakturoid). NULL = neodesláno.';
