-- Opravy z auditu oprávnění (5. 9. 2026), nalezené testem z účtu technika.
--
-- Technik měl jen „Úpravy zakázek“ a „Změna stavu“. Přes REST i tak dokázal:
--   1) smazat zákazníky (u úprav zákazníka se právo hlídalo, u mazání ne),
--   2) přepsat a smazat komentář kolegy (interní chat je podklad k reklamaci),
--   3) vystavovat faktury servisu, který modul Faktury zaplacený nemá.
-- Aplikace tyhle cesty nenabízí; jde o obranu proti volání API napřímo.

-- ── 1. Mazání zákazníků pod stejné právo jako jejich úpravy ──────────────────
-- Zakládání zůstává na členství: technik musí umět při příjmu založit
-- zákazníka, i když nemá správu zákazníků.
drop policy if exists customers_delete on public.customers;
create policy customers_delete
  on public.customers for delete to authenticated
  using (public.has_capability(service_id, auth.uid(), 'can_manage_customers'));

-- ── 2. Komentáře: text patří autorovi ───────────────────────────────────────
-- Připínání zůstává všem (je to společné třídění), ale text a autorství
-- smí měnit jen ten, kdo komentář napsal – nebo majitel a správce.
drop policy if exists ticket_comments_delete_service_members on public.ticket_comments;
create policy ticket_comments_delete_service_members
  on public.ticket_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or public.is_owner_or_admin(service_id)
  );

create or replace function public.enforce_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  -- Bez přihlášeného uživatele jde o service_role (edge funkce, migrace).
  if uid is null then
    return new;
  end if;
  if old.author_id is not distinct from uid or public.is_owner_or_admin(new.service_id) then
    return new;
  end if;
  if new.content is distinct from old.content then
    raise exception 'Upravit text komentáře může jen jeho autor.' using errcode = '42501';
  end if;
  if new.author_id is distinct from old.author_id
     or new.author is distinct from old.author
     or new.ticket_id is distinct from old.ticket_id
     or new.service_id is distinct from old.service_id then
    raise exception 'Autora ani zakázku komentáře nelze měnit.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_comments_author on public.ticket_comments;
create trigger trg_ticket_comments_author
  before update on public.ticket_comments
  for each row execute function public.enforce_comment_author();

-- ── 3. Faktury jen se zaplaceným modulem ────────────────────────────────────
-- Čtení zůstává, ať servis o vystavené doklady nepřijde, když modul vypne.
-- Podmínka se ptá přímo tabulky nároků (člen svůj servis vidí), aby nebylo
-- nutné povolit has_entitlement() roli authenticated – viz jeho lockdown.
create or replace function public.ma_modul(p_service_id uuid, p_module text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.service_entitlements e
     where e.service_id = p_service_id
       and e.module = p_module
       and e.active
       and (e.valid_until is null or e.valid_until > now())
  );
$$;

comment on function public.ma_modul(uuid, text) is
  'Má servis platný nárok na modul? Pro použití v RLS – čte přes RLS tabulky nároků, takže neprozradí cizí servisy.';

grant execute on function public.ma_modul(uuid, text) to authenticated;

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert
  on public.invoices for insert to authenticated
  with check (
    exists (
      select 1 from public.service_memberships m
       where m.service_id = invoices.service_id and m.user_id = auth.uid()
    )
    and public.ma_modul(invoices.service_id, 'invoices')
  );

drop policy if exists invoices_update on public.invoices;
create policy invoices_update
  on public.invoices for update to authenticated
  using (
    exists (
      select 1 from public.service_memberships m
       where m.service_id = invoices.service_id and m.user_id = auth.uid()
    )
    and public.ma_modul(invoices.service_id, 'invoices')
  )
  with check (
    exists (
      select 1 from public.service_memberships m
       where m.service_id = invoices.service_id and m.user_id = auth.uid()
    )
    and public.ma_modul(invoices.service_id, 'invoices')
  );

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete
  on public.invoices for delete to authenticated
  using (
    exists (
      select 1 from public.service_memberships m
       where m.service_id = invoices.service_id and m.user_id = auth.uid()
    )
    and public.ma_modul(invoices.service_id, 'invoices')
  );
