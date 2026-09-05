-- Předplatné servisu (Stripe).
--
-- Co má servis zapnuté, zůstává v `service_entitlements` – aplikace se musí
-- umět rozhodnout sama a rychle, bez volání Stripe při každém kliknutí.
-- Tahle tabulka drží jen spojení na Stripe a stav předplatného, aby šlo
-- ukázat „platí do“, otevřít zákaznický portál a spárovat webhook se servisem.
--
-- Zapisuje výhradně edge funkce pod service_role (billing-webhook).

create table if not exists public.service_billing (
  service_id uuid primary key references public.services(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  -- trialing | active | past_due | canceled | incomplete … (stavy Stripe)
  status text,
  /** Lookup key hlavního tarifu, např. `jobi_plan_monthly`. */
  plan text,
  /** Kolik poboček navíc je zaplaceno (množství u položky předplatného). */
  branches_quantity integer not null default 0,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_billing_customer on public.service_billing(stripe_customer_id);

drop trigger if exists trg_service_billing_updated_at on public.service_billing;
create trigger trg_service_billing_updated_at
  before update on public.service_billing
  for each row execute function public.set_updated_at();

alter table public.service_billing enable row level security;

-- Majitel a správce si stav předplatného přečtou; zapisovat nesmí nikdo.
drop policy if exists service_billing_select_admin on public.service_billing;
create policy service_billing_select_admin
  on public.service_billing for select to authenticated
  using (public.is_owner_or_admin(service_id));

drop policy if exists service_billing_no_write on public.service_billing;
create policy service_billing_no_write
  on public.service_billing for all to authenticated
  using (false) with check (false);

grant select on public.service_billing to authenticated;

comment on table public.service_billing is
  'Spojení servisu na Stripe a stav předplatného. Píše jen billing-webhook (service_role); o přístupu do aplikace rozhoduje service_entitlements.';
