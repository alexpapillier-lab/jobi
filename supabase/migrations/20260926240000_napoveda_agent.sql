-- ============================================================================
-- Nápověda: agent v aplikaci – záznam dotazů
-- ============================================================================
--
-- Edge funkce napoveda-agent odpovídá na dotazy k Jobi (jen z textů
-- průvodců a nápovědy, s kontextem role a zapnutých funkcí; nikdy data
-- zákazníků). Každý dotaz se zapíše sem: kvůli dennímu stropu na servis
-- i uživatele a proto, aby majitel aplikace viděl, na co se lidé ptají –
-- to je nejlepší zpětná vazba, kde je aplikace nesrozumitelná.
--
-- Zapisuje jen servisní role (edge funkce). Čte majitel aplikace.
-- ============================================================================

create table if not exists public.napoveda_dotazy (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  stranka text,
  podsekce text,
  dotaz text not null,
  odpoved text,
  akce jsonb,
  model text,
  tokens_in integer,
  tokens_out integer,
  chyba text,
  created_at timestamptz not null default now()
);
create index if not exists napoveda_dotazy_service_den_idx on public.napoveda_dotazy (service_id, created_at desc);
create index if not exists napoveda_dotazy_user_den_idx on public.napoveda_dotazy (user_id, created_at desc);

alter table public.napoveda_dotazy enable row level security;
drop policy if exists napoveda_dotazy_root on public.napoveda_dotazy;
create policy napoveda_dotazy_root on public.napoveda_dotazy
  for select to authenticated using (public.je_root_owner());
revoke all on table public.napoveda_dotazy from anon;
grant select on table public.napoveda_dotazy to authenticated;
comment on table public.napoveda_dotazy is
  'Dotazy na agenta nápovědy (napoveda-agent): denní strop a přehled, na co se lidé ptají. Zapisuje edge funkce, čte root owner.';
