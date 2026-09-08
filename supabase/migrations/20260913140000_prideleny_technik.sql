-- Přidělený technik na zakázce
-- ============================================================================
--
-- PROČ: „Čas na opravě“ ví, kdo na zakázce pracoval, ale nikdo nevidí, kdo
-- ji MÁ dělat. S přepínáním účtů u pultu to začalo chybět: technik se
-- přepne a chce vidět „moje zakázky“. Sloupec je nullable a nic na něm
-- nestojí – servis s jedním technikem si přidělování vypne
-- (service_settings.config.pridelovani_technika = false) a nic se nezmění.
--
-- Zápis hlídá stejný trigger jako ostatní sloupce zakázky (právo
-- can_manage_tickets_basic). Historie zakázky změnu zaloguje jako každý
-- jiný sloupec; aplikace uuid přeloží na jméno.
--
-- PROČ funkce clenove_servisu: člen smí podle RLS číst jen své vlastní
-- členství, takže si kolegy do výběru technika nenačte. Funkce vrátí jména
-- a fotky (ne e-maily) nescrytých členů – jen tomu, kdo je v servisu sám.

alter table public.tickets
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

comment on column public.tickets.assigned_to is 'Přidělený technik (auth.users.id); NULL = nepřiděleno.';

create index if not exists idx_tickets_service_assigned
  on public.tickets (service_id, assigned_to)
  where deleted_at is null and assigned_to is not null;

create or replace function public.clenove_servisu(p_service_id uuid)
returns table (user_id uuid, nickname text, avatar_url text, role text)
language sql
security definer
stable
set search_path = public
as $$
  select m.user_id, p.nickname, p.avatar_url, m.role
    from public.service_memberships m
    left join public.profiles p on p.id = m.user_id
   where m.service_id = p_service_id
     and m.skryty = false
     and exists (
       select 1 from public.service_memberships x
        where x.service_id = p_service_id and x.user_id = auth.uid()
     )
   order by p.nickname nulls last, m.user_id;
$$;
revoke all on function public.clenove_servisu(uuid) from public, anon;
grant execute on function public.clenove_servisu(uuid) to authenticated;
