-- Online rezervace z webu servisu.
--
-- Zákazník na webu servisu vyplní formulář (vložený skript /v1/booking.js
-- nebo vlastní volání /v1/booking) a v Jobi se objeví rezervace: kdo, co,
-- kdy by chtěl přijít. Servis ji potvrdí, založí z ní zakázku (jedním
-- kliknutím, údaje se předvyplní) nebo zruší. Zápis zvenku jde jen přes
-- edge funkci public-booking pod service_role – tabulka nemá žádnou
-- politiku pro INSERT od přihlášených, členové servisu čtou a mění stav.
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'confirmed', 'converted', 'cancelled')),
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  device_label text not null,
  repair_name text,
  note text,
  -- Kdy by zákazník chtěl přijít; může být prázdné („kdykoliv“).
  preferred_at timestamptz,
  ticket_id uuid references public.tickets(id) on delete set null,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bookings is 'Rezervace z webu servisu (edge funkce public-booking). Servis potvrdí, převede na zakázku nebo zruší.';

create index if not exists bookings_service_status_idx on public.bookings (service_id, status, created_at desc);

alter table public.bookings enable row level security;
revoke all on table public.bookings from anon;
revoke truncate, references, trigger, insert on table public.bookings from authenticated;

create policy "bookings_select_members" on public.bookings
  for select to authenticated
  using (exists (select 1 from public.service_memberships m where m.service_id = bookings.service_id and m.user_id = auth.uid()));

create policy "bookings_update_members" on public.bookings
  for update to authenticated
  using (exists (select 1 from public.service_memberships m where m.service_id = bookings.service_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.service_memberships m where m.service_id = bookings.service_id and m.user_id = auth.uid()));

create policy "bookings_delete_members" on public.bookings
  for delete to authenticated
  using (exists (select 1 from public.service_memberships m where m.service_id = bookings.service_id and m.user_id = auth.uid()));

create or replace function public.bookings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings for each row execute function public.bookings_touch();

alter publication supabase_realtime add table public.bookings;
