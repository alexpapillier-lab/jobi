-- Osobní nastavení uživatele, sdílené napříč zařízeními a platformami.
--
-- Do teď žilo výhradně v localStorage prohlížeče/desktopové appky – tedy
-- osobně pro každé ZAŘÍZENÍ zvlášť, ne pro uživatele. Kdo si na desktopu
-- zapnul výrazné zvýraznění stavu zakázek nebo si vybral barvu loga,
-- na webu to neměl a musel to nastavovat znovu.
--
-- Řádek je jeden na uživatele (ne na servis) – jde o to, jak si TA OSOBA
-- appku chce zobrazovat, ne o pravidlo servisu, které platí pro všechny.
-- Data jsou volný JSON, ať se dá přidávat další osobní volba (další klíč
-- v localStorage) bez další migrace.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.user_preferences is
  'Osobní volby uživatele (zobrazení zakázek, zvýraznění stavu, barva loga...) sdílené napříč zařízeními. Ne servisní nastavení – to zůstává v tabulkách vázaných na service_id.';

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_preferences_upsert_own" on public.user_preferences;
create policy "user_preferences_upsert_own"
  on public.user_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own"
  on public.user_preferences for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Atomický merge do JSON sloupce. Bez toho by dvě zařízení téhož uživatele
-- otevřená zároveň (desktop i web) mohla navzájem přepsat, co to druhé
-- právě uložilo – read-modify-write z klienta by tenhle souběh neřešil,
-- protože mezi přečtením a zápisem může přijít cizí zápis.
create or replace function public.merge_user_preferences(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  insert into public.user_preferences (user_id, data, updated_at)
  values (auth.uid(), p_patch, now())
  on conflict (user_id) do update
    set data = public.user_preferences.data || excluded.data,
        updated_at = now()
  returning data into v_result;
  return v_result;
end;
$$;

-- SECURITY DEFINER by jinak obešel RLS úplně; auth.uid() uvnitř funkce
-- ale zajišťuje, že merge vždy dopadne jen na řádek volajícího – p_patch
-- je čistě obsah dat, ne identifikace řádku, takže nejde slít do cizího.
revoke all on function public.merge_user_preferences(jsonb) from public, anon;
grant execute on function public.merge_user_preferences(jsonb) to authenticated;
