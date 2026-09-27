-- ============================================================================
-- Čtvrté kolo auditu oprávnění (27. 9. 2026) – opravy
-- ============================================================================
--
-- Prošlo se všechno, co přibylo od 9. 9.: odměny, platby servisů, nápověda,
-- statistiky po přepisech, nové sloupce zakázky, zásilky mezi pobočkami,
-- chat, provize, rezervace, počty členů. Sondy řady 1000 ve
-- scripts/rls-probe.sql; popis nálezů v docs/AUDIT_2026-09.md („4. kolo“).
--
-- Co se tu opravuje (od nejvážnějšího):
--
--   1) ZÁSILKY: člen omezený na pobočku si mohl „přivézt“ zakázku cizí
--      pobočky. Založil zásilku (stačilo členství), vložil do ní id cizí
--      zakázky (trigger kontroloval jen stejný servis), odeslal ji na svou
--      pobočku – a zakázka se mu tím ukázala i odemkla k zápisu, protože
--      viditelnost se řídí i místem (location_branch_id). Id cizích zakázek
--      přitom vracel žebříček odměn (bod 2) i položky cizích zásilek.
--      Teď: položka zásilky jen k zakázce, kterou volající vidí (čtení,
--      vložení, mazání); zásilka jen z pobočky, kam volající smí, a jen mezi
--      pobočkami téhož servisu; odeslání jen z povolené pobočky a jen se
--      zakázkami, které volající vidí. K tomu hradba (vypnutý servis /
--      propadlý přístup) a pryč granty pro anon.
--   2) ODMĚNY: odmeny_prehled (security definer) vracel řádky se zákazníkem,
--      číslem a id zakázky ze všech poboček i členovi omezenému na pobočku.
--      Teď dostane jen řádky zakázek, které vidí; součty v žebříčku zůstávají
--      za celý servis (jméno + částka, bez zákazníků).
--      Správce jednoho servisu navíc mohl zapsat odmeny_upravy s vlastním
--      service_id, ale s id zakázky JINÉHO servisu – přehled páruje úpravy
--      jen podle (ticket_id, polozka_id), takže tím šlo cizímu servisu
--      vyřadit nebo přepsat odměnu (a primárním klíčem mu zablokovat vlastní
--      úpravu). Teď musí zakázka patřit stejnému servisu a přehled páruje
--      i podle servisu.
--   3) soft_delete_ticket / restore_ticket – security definer s ticket_id bez
--      kontroly pobočky (pravidlo MIGRATIONS_SAFETY §5): omezený člen s
--      právem mazat smazal/obnovil zakázku cizí pobočky podle id.
--   4) smim_cist_podpis – podpis převzetí šel číst i u zakázky cizí pobočky.
--   5) members_allowed / service_seat_count – EXECUTE pro anon a kohokoli:
--      bez přihlášení šlo zjistit počet členů + čekajících pozvánek a limit
--      tarifu libovolného servisu. Teď jen člen servisu, service_role
--      a volání z triggeru.
--   6) Rezervace z webu (bookings) převedené na zakázku cizí pobočky byly
--      omezenému členovi vidět i s telefonem a e-mailem zákazníka (změna
--      a mazání už hlídané byly, čtení ne).
--   7) Položky objednávek u dodavatele – restriktivní politika „jen
--      k viditelným zakázkám“ byla jen pro čtení (§5 chce i zápis) a zápis
--      nehlídal propadlý přístup.
--   8) Log reportu statistik (statistiky_report_odeslani – příjemci, chyby)
--      četl každý člen, i ten bez práva na statistiky.
--   9) Nová tabulka odměn a zásilek nebyla v hradbě (vypnutý servis se čte,
--      propadlý přístup zapisuje).
--  10) Odhlášení všech zařízení po obnově hesla: edge funkce
--      password-reset-confirm volala auth.admin.signOut(userId), jenže ta
--      bere JWT relace, ne id uživatele – volání selhalo a ukradená relace
--      přežila změnu hesla. Nová funkce odhlas_vsechna_zarizeni() pro
--      service_role smaže relace uživatele (refresh tokeny jdou kaskádou).
--
-- Migrace je idempotentní (drop policy if exists, create or replace) a nemění
-- žádná data.
-- ============================================================================


-- ── 1) Zásilky mezi pobočkami ───────────────────────────────────────────────

revoke all on table public.ticket_shipments, public.ticket_shipment_items from anon;

-- Položka zásilky jen k zakázce, kterou volající vidí (MIGRATIONS_SAFETY §5).
-- Pobočka, kam zásilka jede, položky uvidí po odeslání – zakázka se jí
-- zobrazí podle místa (location_branch_id).
drop policy if exists ticket_shipment_items_jen_viditelne_zakazky on public.ticket_shipment_items;
create policy ticket_shipment_items_jen_viditelne_zakazky on public.ticket_shipment_items
  as restrictive for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_shipment_items.ticket_id));

drop policy if exists ticket_shipment_items_jen_viditelne_vlozeni on public.ticket_shipment_items;
create policy ticket_shipment_items_jen_viditelne_vlozeni on public.ticket_shipment_items
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.tickets t where t.id = ticket_shipment_items.ticket_id));

drop policy if exists ticket_shipment_items_jen_viditelne_mazani on public.ticket_shipment_items;
create policy ticket_shipment_items_jen_viditelne_mazani on public.ticket_shipment_items
  as restrictive for delete to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_shipment_items.ticket_id));

-- Zásilka jen z pobočky, kam volající smí, a jen mezi pobočkami téhož servisu.
drop policy if exists ticket_shipments_z_povolene_pobocky_vlozeni on public.ticket_shipments;
create policy ticket_shipments_z_povolene_pobocky_vlozeni on public.ticket_shipments
  as restrictive for insert to authenticated
  with check (
    public.pobocka_povolena(service_id, from_branch_id)
    and exists (select 1 from public.branches b where b.id = ticket_shipments.from_branch_id and b.service_id = ticket_shipments.service_id)
    and exists (select 1 from public.branches b where b.id = ticket_shipments.to_branch_id and b.service_id = ticket_shipments.service_id)
  );

drop policy if exists ticket_shipments_z_povolene_pobocky_zmena on public.ticket_shipments;
create policy ticket_shipments_z_povolene_pobocky_zmena on public.ticket_shipments
  as restrictive for update to authenticated
  using (true)
  with check (
    public.pobocka_povolena(service_id, from_branch_id)
    and exists (select 1 from public.branches b where b.id = ticket_shipments.from_branch_id and b.service_id = ticket_shipments.service_id)
    and exists (select 1 from public.branches b where b.id = ticket_shipments.to_branch_id and b.service_id = ticket_shipments.service_id)
  );

-- Odeslání: jen z povolené pobočky, jen se zakázkami, které volající vidí,
-- a jen v servisu, kde se smí pracovat. Jinak beze změny (20260916120000).
create or replace function public.zasilka_odeslat(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ticket_shipments%rowtype;
  v_pocet integer;
begin
  select * into s from public.ticket_shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Zásilka nenalezena.' using errcode = 'P0002';
  end if;
  if not public.zasilka_clen(s.service_id) then
    raise exception 'Nejste členem servisu.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.servis_smi_pracovat(s.service_id) then
    raise exception 'Servis je vypnutý nebo mu skončil přístup.' using errcode = '42501';
  end if;
  -- Definer obchází RLS: bez těchhle dvou kontrol by omezený člen odeslal
  -- (a tím si zpřístupnil) zakázku cizí pobočky.
  if not public.pobocka_povolena(s.service_id, s.from_branch_id) then
    raise exception 'Zásilku může odeslat jen pobočka, ze které jede.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ticket_shipment_items i join public.tickets t on t.id = i.ticket_id
     where i.shipment_id = s.id
       and not public.zakazka_viditelna_podle_mista(t.service_id, t.branch_id, t.location_branch_id)
  ) then
    raise exception 'V zásilce je zakázka jiné pobočky.' using errcode = '42501';
  end if;
  if s.status <> 'draft' then
    raise exception 'Zásilka už byla odeslána.' using errcode = '22023';
  end if;
  select count(*) into v_pocet from public.ticket_shipment_items where shipment_id = s.id;
  if v_pocet = 0 then
    raise exception 'Do zásilky nejdřív přidejte zakázky.' using errcode = '22023';
  end if;
  -- Zakázka, která mezitím odjela jinou zásilkou, se v téhle nesmí tvářit, že jede.
  if exists (
    select 1 from public.ticket_shipment_items i join public.tickets t on t.id = i.ticket_id
     where i.shipment_id = s.id and t.transit_shipment_id is not null
  ) then
    raise exception 'Některá zakázka právě cestuje v jiné zásilce.' using errcode = '23505';
  end if;
  perform set_config('jobi.zasilka_rpc', '1', true);
  update public.ticket_shipments
     set status = 'sent', sent_at = now(), sent_by = auth.uid()
   where id = s.id;
  update public.tickets t
     set transit_shipment_id = s.id,
         location_branch_id = case when s.to_branch_id = t.branch_id then null else s.to_branch_id end
    from public.ticket_shipment_items i
   where i.shipment_id = s.id and t.id = i.ticket_id;
end;
$$;
revoke all on function public.zasilka_odeslat(uuid) from public, anon;
grant execute on function public.zasilka_odeslat(uuid) to authenticated, service_role;

-- Převzetí: jen v servisu, kde se smí pracovat. Pobočku převzetí záměrně
-- nehlídáme – převzetí jen potvrzuje příjezd tam, kam zásilka jela, nic
-- nezpřístupní (viz docs/AUDIT_2026-09.md, 4. kolo – otevřené body).
create or replace function public.zasilka_prevzit(p_shipment_id uuid, p_ticket_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ticket_shipments%rowtype;
  v_zbyva integer;
begin
  select * into s from public.ticket_shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Zásilka nenalezena.' using errcode = 'P0002';
  end if;
  if not public.zasilka_clen(s.service_id) then
    raise exception 'Nejste členem servisu.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.servis_smi_pracovat(s.service_id) then
    raise exception 'Servis je vypnutý nebo mu skončil přístup.' using errcode = '42501';
  end if;
  if s.status = 'draft' then
    raise exception 'Zásilka ještě nebyla odeslána.' using errcode = '22023';
  end if;
  perform set_config('jobi.zasilka_rpc', '1', true);
  update public.ticket_shipment_items
     set received_at = now()
   where shipment_id = s.id and received_at is null and ticket_id = any(p_ticket_ids);
  update public.tickets t
     set transit_shipment_id = null,
         location_branch_id = case when s.to_branch_id = t.branch_id then null else s.to_branch_id end
   where t.id = any(p_ticket_ids) and t.transit_shipment_id = s.id;
  select count(*) into v_zbyva from public.ticket_shipment_items where shipment_id = s.id and received_at is null;
  if v_zbyva = 0 then
    update public.ticket_shipments
       set status = 'received', received_at = now(), received_by = auth.uid()
     where id = s.id;
  end if;
end;
$$;
revoke all on function public.zasilka_prevzit(uuid, uuid[]) from public, anon;
grant execute on function public.zasilka_prevzit(uuid, uuid[]) to authenticated, service_role;


-- ── 2) Hradba pro tabulky přidané po 12. 9. (vzor 20260912130000) ───────────
do $$
declare
  t text;
  tabulky text[] := array['ticket_shipments', 'odmeny_upravy', 'odmeny_vyplaty'];
begin
  foreach t in array tabulky loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabulka % neexistuje, přeskakuji.', t;
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_jen_zapnuty_servis', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (not (service_id = any (public.vypnute_servisy())))',
      t || '_jen_zapnuty_servis', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_vlozeni', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_vlozeni', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_zmena', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (service_id = any (public.servisy_kde_smim_pracovat())) with check (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_zmena', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_mazani', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (service_id = any (public.servisy_kde_smim_pracovat()))',
      t || '_jen_s_pristupem_mazani', t
    );
  end loop;
end
$$;


-- ── 3) Odměny: úprava jen k zakázce stejného servisu, řádky jen viditelné ───

-- Zakázka musí patřit servisu z řádku a volající ji musí vidět (§5). Správce
-- omezený na pobočku není (omezení je jen pro členy), takže správci to
-- nic nebere; bere to jen zápis s id zakázky cizího servisu.
drop policy if exists odmeny_upravy_jen_viditelne_zakazky on public.odmeny_upravy;
create policy odmeny_upravy_jen_viditelne_zakazky on public.odmeny_upravy
  as restrictive for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = odmeny_upravy.ticket_id and t.service_id = odmeny_upravy.service_id));

drop policy if exists odmeny_upravy_jen_viditelne_vlozeni on public.odmeny_upravy;
create policy odmeny_upravy_jen_viditelne_vlozeni on public.odmeny_upravy
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.tickets t where t.id = odmeny_upravy.ticket_id and t.service_id = odmeny_upravy.service_id));

drop policy if exists odmeny_upravy_jen_viditelne_zmena on public.odmeny_upravy;
create policy odmeny_upravy_jen_viditelne_zmena on public.odmeny_upravy
  as restrictive for update to authenticated
  using (exists (select 1 from public.tickets t where t.id = odmeny_upravy.ticket_id and t.service_id = odmeny_upravy.service_id))
  with check (exists (select 1 from public.tickets t where t.id = odmeny_upravy.ticket_id and t.service_id = odmeny_upravy.service_id));

-- Výplatu jde zapsat jen členovi téhož servisu (dřív libovolnému uuid).
drop policy if exists odmeny_vyplaty_jen_clen_servisu on public.odmeny_vyplaty;
create policy odmeny_vyplaty_jen_clen_servisu on public.odmeny_vyplaty
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.service_memberships m where m.service_id = odmeny_vyplaty.service_id and m.user_id = odmeny_vyplaty.user_id));


-- ── 4) Mazání a obnova zakázky: kontrola pobočky ────────────────────────────
-- Těla beze změny z produkce, přibyla jen kontrola_pobocky_zakazky (§5).
create or replace function public.soft_delete_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_service_id UUID;
  v_user_id UUID;
  v_user_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;

  IF v_user_role IN ('owner', 'admin') THEN
    NULL;
  ELSIF v_user_role = 'member' THEN
    IF NOT (public.has_capability(v_service_id, v_user_id, 'can_delete_tickets')
             OR public.has_capability(v_service_id, v_user_id, 'can_manage_ticket_archive')) THEN
      RAISE EXCEPTION 'Not authorized: member needs can_delete_tickets or can_manage_ticket_archive to delete tickets';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: invalid role';
  END IF;

  -- Definer obchází RLS: člen omezený na pobočku nesmí smazat cizí zakázku.
  PERFORM public.kontrola_pobocky_zakazky(p_ticket_id);

  UPDATE public.tickets
  SET deleted_at = now()
  WHERE id = p_ticket_id
    AND service_id = v_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;
revoke all on function public.soft_delete_ticket(uuid) from public, anon;
grant execute on function public.soft_delete_ticket(uuid) to authenticated, service_role;

create or replace function public.restore_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_service_id UUID;
  v_user_id UUID;
  v_user_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;

  IF v_user_role IN ('owner', 'admin') THEN
    NULL;
  ELSIF v_user_role = 'member' THEN
    IF NOT public.has_capability(v_service_id, v_user_id, 'can_manage_ticket_archive') THEN
      RAISE EXCEPTION 'Not authorized: member needs can_manage_ticket_archive to restore tickets';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: invalid role';
  END IF;

  -- Definer obchází RLS: člen omezený na pobočku nesmí obnovit cizí zakázku.
  PERFORM public.kontrola_pobocky_zakazky(p_ticket_id);

  UPDATE public.tickets
  SET deleted_at = NULL
  WHERE id = p_ticket_id
    AND service_id = v_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;
revoke all on function public.restore_ticket(uuid) from public, anon;
grant execute on function public.restore_ticket(uuid) to authenticated, service_role;


-- ── 5) Podpis převzetí jen u viditelné zakázky ──────────────────────────────
create or replace function public.smim_cist_podpis(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Nejdřív se z cesty vyzobne id zakázky, teprve pak se hledá v databázi
  -- (viz 20260913100000). Definer obchází RLS zakázek, proto se pobočka
  -- (i místo, kde zařízení leží) kontroluje tady.
  select exists (
    select 1
    from public.tickets t
    join public.service_memberships m on m.service_id = t.service_id
    where m.user_id = auth.uid()
      and t.id::text = substring(p_name from '^signatures/([0-9a-fA-F-]{36})-')
      and public.zakazka_viditelna_podle_mista(t.service_id, t.branch_id, t.location_branch_id)
  )
$$;
revoke all on function public.smim_cist_podpis(text) from public, anon;
grant execute on function public.smim_cist_podpis(text) to authenticated;


-- ── 6) Počet členů a limit tarifu jen pro člena servisu ─────────────────────
-- Volají je triggery kvót (pg_trigger_depth() > 0 – tam už je volající
-- ověřený pravidly tabulky), edge funkce invite_create pod service_role
-- a stránka Tým člena servisu. Nikdo jiný nedostane číslo (NULL).
create or replace function public.members_allowed(p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pg_trigger_depth() > 0
      or auth.role() = 'service_role'
      or exists (select 1 from public.service_memberships x where x.service_id = p_service_id and x.user_id = auth.uid())
    then coalesce(
      (
        select case when e.quota is null then 2147483647 else e.quota end
          from public.service_entitlements e
         where e.service_id = p_service_id
           and e.module = 'members'
           and e.active
           and (e.valid_until is null or e.valid_until > now())
         limit 1
      ),
      2147483647
    )
  end;
$$;
revoke all on function public.members_allowed(uuid) from public, anon;
grant execute on function public.members_allowed(uuid) to authenticated, service_role;

create or replace function public.service_seat_count(p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pg_trigger_depth() > 0
      or auth.role() = 'service_role'
      or exists (select 1 from public.service_memberships x where x.service_id = p_service_id and x.user_id = auth.uid())
    then
      (select count(*)::integer from public.service_memberships m
        where m.service_id = p_service_id and m.skryty = false)
      +
      (select count(*)::integer from public.service_invites i
        where i.service_id = p_service_id
          and i.accepted_at is null
          and i.expires_at > now())
  end;
$$;
revoke all on function public.service_seat_count(uuid) from public, anon;
grant execute on function public.service_seat_count(uuid) to authenticated, service_role;


-- ── 7) Rezervace z webu převedené na zakázku: čtení podle zakázky ───────────
drop policy if exists bookings_jen_viditelne_zakazky on public.bookings;
create policy bookings_jen_viditelne_zakazky on public.bookings
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = bookings.ticket_id));


-- ── 8) Položky objednávek: zápis jen k viditelné zakázce a s přístupem ──────
drop policy if exists po_items_jen_viditelne_vlozeni on public.inventory_purchase_order_items;
create policy po_items_jen_viditelne_vlozeni on public.inventory_purchase_order_items
  as restrictive for insert to authenticated
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_purchase_order_items.ticket_id));

drop policy if exists po_items_jen_viditelne_zmena on public.inventory_purchase_order_items;
create policy po_items_jen_viditelne_zmena on public.inventory_purchase_order_items
  as restrictive for update to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_purchase_order_items.ticket_id))
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_purchase_order_items.ticket_id));

-- Tabulka nemá service_id; servis se bere z hlavičky objednávky. Čtení hlídá
-- už RLS hlavičky (select_members politika se na ni ptá), zápis ne.
drop policy if exists po_items_jen_s_pristupem_vlozeni on public.inventory_purchase_order_items;
create policy po_items_jen_s_pristupem_vlozeni on public.inventory_purchase_order_items
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.inventory_purchase_orders o where o.id = inventory_purchase_order_items.order_id and o.service_id = any (public.servisy_kde_smim_pracovat())));

drop policy if exists po_items_jen_s_pristupem_zmena on public.inventory_purchase_order_items;
create policy po_items_jen_s_pristupem_zmena on public.inventory_purchase_order_items
  as restrictive for update to authenticated
  using (exists (select 1 from public.inventory_purchase_orders o where o.id = inventory_purchase_order_items.order_id and o.service_id = any (public.servisy_kde_smim_pracovat())))
  with check (exists (select 1 from public.inventory_purchase_orders o where o.id = inventory_purchase_order_items.order_id and o.service_id = any (public.servisy_kde_smim_pracovat())));

drop policy if exists po_items_jen_s_pristupem_mazani on public.inventory_purchase_order_items;
create policy po_items_jen_s_pristupem_mazani on public.inventory_purchase_order_items
  as restrictive for delete to authenticated
  using (exists (select 1 from public.inventory_purchase_orders o where o.id = inventory_purchase_order_items.order_id and o.service_id = any (public.servisy_kde_smim_pracovat())));


-- ── 9) Log reportu statistik jen pro toho, kdo statistiky vidí ──────────────
-- Stejné pravidlo jako overit_pristup_ke_statistikam: správce vždy, člen
-- pokud nemá právo can_view_statistics výslovně odebrané.
drop policy if exists statistiky_report_odeslani_cteni on public.statistiky_report_odeslani;
create policy statistiky_report_odeslani_cteni on public.statistiky_report_odeslani
  for select to authenticated
  using (exists (
    select 1 from public.service_memberships m
     where m.service_id = statistiky_report_odeslani.service_id
       and m.user_id = auth.uid()
       and (m.role in ('owner', 'admin') or coalesce(m.capabilities ->> 'can_view_statistics', 'true') <> 'false')
  ));


-- ── 10) Odhlášení všech zařízení po obnově hesla ────────────────────────────
-- Volá edge funkce password-reset-confirm pod service_role. Smazání relace
-- zneplatní její refresh token (kaskáda refresh_tokens.session_id), takže se
-- ukradená relace po vypršení přístupového tokenu už neobnoví.
create or replace function public.odhlas_vsechna_zarizeni(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_pocet integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Jen pro server.' using errcode = '42501';
  end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_pocet = row_count;
  return v_pocet;
end;
$$;
revoke all on function public.odhlas_vsechna_zarizeni(uuid) from public, anon, authenticated;
grant execute on function public.odhlas_vsechna_zarizeni(uuid) to service_role;
comment on function public.odhlas_vsechna_zarizeni(uuid) is
  'Smaže všechny relace uživatele (odhlásí všechna zařízení). Jen service_role – volá password-reset-confirm.';


-- ── 11) Žebříček odměn: řádky jen viditelných zakázek ───────────────────────
-- Celé tělo z 20260926230000; změny jsou tři a jsou označené „audit 4“:
-- zakázky nesou pobočku a místo, úpravy se párují i podle servisu a řádky
-- (se zákazníkem a číslem zakázky) dostane člen jen u zakázek, které vidí.
create or replace function public.odmeny_prehled(
  p_service_id uuid,
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_tz text default 'Europe/Prague'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_cfg jsonb;
  v_pravidla jsonb;
  v_verejny boolean;
  v_tz text;
  v_od timestamptz;
  v_do timestamptz;
  v_od12 timestamptz;
  v_vysledek jsonb;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;
  v_admin := public.odmeny_je_spravce(p_service_id);

  select coalesce(s.config -> 'odmeny', '{}'::jsonb) into v_cfg
  from public.service_settings s where s.service_id = p_service_id;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_pravidla := case when jsonb_typeof(v_cfg -> 'pravidla') = 'array' then v_cfg -> 'pravidla' else '[]'::jsonb end;
  v_verejny := coalesce((v_cfg ->> 'verejny_zebricek')::boolean, true);

  v_tz := case
    when p_tz is not null and exists (select 1 from pg_timezone_names n where n.name = p_tz) then p_tz
    else 'Europe/Prague'
  end;
  -- Bez období = tento měsíc.
  v_od := coalesce(p_od, date_trunc('month', now() at time zone v_tz) at time zone v_tz);
  v_do := coalesce(p_do, now());
  -- Měsíční řada: posledních 12 měsíců do konce vybraného období (nebo do teď).
  v_od12 := date_trunc('month', (greatest(v_do, now()) at time zone v_tz) - interval '11 months') at time zone v_tz;

  with pravidla as (
    select
      coalesce(nullif(r ->> 'id', ''), ord::text) as id,
      coalesce(nullif(btrim(r ->> 'nazev'), ''), r ->> 'hledat') as nazev,
      lower(btrim(r ->> 'hledat')) as hledat,
      case when r ->> 'typ' = 'procento' then 'procento' else 'castka' end as typ,
      coalesce(replace(r ->> 'hodnota', ',', '.')::numeric, 0) as hodnota,
      case when r ->> 'komu' = 'technik' then 'technik' else 'pridal' end as komu,
      ord
    from jsonb_array_elements(v_pravidla) with ordinality x(r, ord)
    where coalesce((r ->> 'aktivni')::boolean, true)
      and nullif(btrim(r ->> 'hledat'), '') is not null
      and (r ->> 'hodnota') ~ '^-?[0-9]+([.,][0-9]+)?$'
  ),
  -- Vydané zakázky (koncový stav, ne storno) – datum vydání jako ve Statistikách.
  zakazky as (
    select
      t.id,
      t.code,
      t.customer_name,
      coalesce(nullif(btrim(t.title), ''), t.device_label) as zarizeni,
      t.assigned_to,
      t.branch_id,          -- audit 4
      t.location_branch_id, -- audit 4
      coalesce(t.completed_at, t.updated_at) as vydano_at,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy
    from public.tickets t
    join public.service_statuses st
      on st.service_id = t.service_id and st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = p_service_id
      and t.deleted_at is null
      and st.is_final
      and not public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label)
      and coalesce(t.completed_at, t.updated_at) >= least(v_od, v_od12)
      and coalesce(t.completed_at, t.updated_at) <= greatest(v_do, now())
  ),
  polozky as (
    select
      z.id as ticket_id,
      z.code,
      z.customer_name,
      z.zarizeni,
      z.assigned_to,
      z.branch_id,          -- audit 4
      z.location_branch_id, -- audit 4
      z.vydano_at,
      coalesce(e.polozka ->> 'id', e.ord::text) as polozka_id,
      coalesce(e.polozka ->> 'name', '') as oprava,
      case when jsonb_typeof(e.polozka -> 'price') = 'number' then (e.polozka ->> 'price')::numeric else 0 end as cena,
      case when (e.polozka ->> 'pridalUserId') ~* c_uuid then (e.polozka ->> 'pridalUserId')::uuid end as pridal_uid,
      -- Nabídnuto zákazníkovi navíc (příznak z aplikace); bez příznaku = ne.
      case when jsonb_typeof(e.polozka -> 'nabidnuto') = 'boolean' then (e.polozka ->> 'nabidnuto')::boolean else false end as nabidnuto_priznak
    from zakazky z
    cross join lateral jsonb_array_elements(z.opravy) with ordinality e(polozka, ord)
  ),
  -- Na položku nejvýš jedno pravidlo: první v pořadí, které sedí.
  shody as (
    select distinct on (p.ticket_id, p.polozka_id)
      p.*,
      r.id as pravidlo_id,
      r.nazev as pravidlo,
      r.komu,
      case when r.typ = 'procento' then round(p.cena * r.hodnota / 100, 2) else round(r.hodnota, 2) end as castka
    from polozky p
    join pravidla r on lower(p.oprava) like '%' || r.hledat || '%'
    order by p.ticket_id, p.polozka_id, r.ord
  ),
  prirazene as (
    select
      s.*,
      coalesce(u.vyrazeno, false) as vyrazeno,
      u.user_id is not null as prepsano,
      -- Majitel může příznak „nabídnuto navíc“ přepsat (odmeny_upravy.nabidnuto).
      coalesce(u.nabidnuto, s.nabidnuto_priznak) as nabidnuto,
      u.nabidnuto is not null as nabidnuto_prepsano,
      u.poznamka,
      case
        when u.user_id is not null then u.user_id
        when s.komu = 'technik' then s.assigned_to
        else coalesce(
          s.pridal_uid,
          -- Historie: první změna, kde se položka objevila (v „new“ je, v „old“ není).
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'updated'
              and (h.details #> '{changes,performed_repairs,new}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id))
              and not coalesce((h.details #> '{changes,performed_repairs,old}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id)), false)
            order by h.created_at
            limit 1),
          -- Položka je na zakázce od příjmu: kdo zakázku založil.
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'created'
            order by h.created_at
            limit 1)
        )
      end as komu_uid
    from shody s
    -- audit 4: páruje se i podle servisu (úprava s cizím servisem se nepočítá).
    left join public.odmeny_upravy u on u.service_id = p_service_id and u.ticket_id = s.ticket_id and u.polozka_id = s.polozka_id
  ),
  -- Co smí volající vidět: správce vše, člen svoje, cizí jen s veřejným žebříčkem.
  viditelne as (
    select * from prirazene p
    where v_admin or p.komu_uid = v_uid or v_verejny
  ),
  v_obdobi as (
    select * from viditelne where vydano_at >= v_od and vydano_at <= v_do
  ),
  jmena as (
    select m.user_id, coalesce(nullif(btrim(pr.nickname), ''), 'Kolega') as jmeno, pr.avatar_url
    from public.service_memberships m
    left join public.profiles pr on pr.id = m.user_id
    where m.service_id = p_service_id
  )
  select jsonb_build_object(
    'zapnuto', exists (select 1 from pravidla),
    'verejny', v_verejny,
    'admin', v_admin,
    'ja', v_uid,
    'od', v_od,
    'do', v_do,
    'radky', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ticketId', o.ticket_id, 'kod', o.code, 'zakaznik', o.customer_name, 'zarizeni', o.zarizeni,
        'polozkaId', o.polozka_id, 'oprava', o.oprava, 'cena', o.cena,
        'pravidloId', o.pravidlo_id, 'pravidlo', o.pravidlo, 'komu', o.komu,
        'userId', o.komu_uid, 'jmeno', j.jmeno,
        'castka', o.castka, 'vydanoAt', o.vydano_at,
        'vyrazeno', o.vyrazeno, 'prepsano', o.prepsano, 'poznamka', o.poznamka,
        'nabidnuto', o.nabidnuto, 'nabidnutoPrepsano', o.nabidnuto_prepsano
      ) order by o.vydano_at desc, o.code desc, o.polozka_id)
      from v_obdobi o
      left join jmena j on j.user_id = o.komu_uid
      -- Vyřazené a nenabídnuté řádky vidí jen správce (aby je mohl vrátit / označit).
      where (v_admin or not o.vyrazeno) and (v_admin or o.nabidnuto)
        -- audit 4: zákazníka a číslo zakázky jen u zakázek, které volající vidí
        -- (člen omezený na pobočku). Součty v „lide“ a „mesice“ zůstávají celé.
        and (v_admin or public.zakazka_viditelna_podle_mista(p_service_id, o.branch_id, o.location_branch_id))
    ), '[]'::jsonb),
    'lide', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'avatarUrl', j.avatar_url,
        'pocet', x.pocet, 'castka', x.castka
      ) order by x.castka desc, x.pocet desc, j.jmeno)
      from (
        select komu_uid, count(*) as pocet, sum(castka) as castka
        from v_obdobi where not vyrazeno and nabidnuto
        group by komu_uid
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'mesice', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mesic', x.mesic, 'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'pocet', x.pocet, 'castka', x.castka
      ) order by x.mesic, x.castka desc)
      from (
        select to_char(vydano_at at time zone v_tz, 'YYYY-MM') as mesic, komu_uid, count(*) as pocet, sum(castka) as castka
        from viditelne
        where not vyrazeno and nabidnuto and vydano_at >= v_od12
        group by 1, 2
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'vyplaty', coalesce((
      select jsonb_agg(jsonb_build_object('userId', v.user_id, 'obdobi', v.obdobi, 'castka', v.castka, 'vyplacenoAt', v.vyplaceno_at))
      from public.odmeny_vyplaty v
      where v.service_id = p_service_id
        and (v_admin or v.user_id = v_uid)
        and v.obdobi >= to_char(v_od12 at time zone v_tz, 'YYYY-MM')
    ), '[]'::jsonb)
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

comment on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) is
  'Odměny týmu: řádky za období (podle data vydání zakázky), součty na člověka, měsíční řada 12 měsíců zpět a vyplaceno. Počítá se jen oprava s příznakem nabídnuto navíc (performed_repairs[].nabidnuto nebo odmeny_upravy.nabidnuto).';
revoke all on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) to authenticated;
