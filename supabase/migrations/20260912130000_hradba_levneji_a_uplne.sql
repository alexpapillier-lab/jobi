-- Hradba přístupu: levněji a bez děr
-- ============================================================================
--
-- Migrace 20260911100000 zavedla restriktivní politiky, které u každého řádku
-- volají `servis_je_aktivni(service_id)` (u zápisu `servis_smi_pracovat`).
-- Obojí je SECURITY DEFINER, takže se **nedá inlinovat** a volá se pro každý
-- řádek zvlášť: měřením přes `EXPLAIN ANALYZE` nad ostrou databází vyšlo
-- ~22 µs na řádek, tedy ~130 ms navíc jen na načtení seznamu zakázek. To je
-- přesně to, co ve stejný den koupily nové indexy (2 505 → 520 ms).
--
-- Funkce bez argumentů se přitom vyhodnotí **jednou za dotaz** (InitPlan):
-- místo „je tenhle servis zapnutý?“ se zeptáme „které servisy jsou vypnuté?“
-- a „ve kterých smím pracovat?“. Výsledek je stejný, cena zlomková.
--
-- Zároveň se dotahují dvě tabulky, které v seznamu chyběly (`customer_history`
-- a `bookings`): z vypnutého servisu z nich šla dál číst historie změn
-- zákazníků a rezervace i s kontaktem na zákazníka.

-- ── Množinové varianty ───────────────────────────────────────────────────────
create or replace function public.vypnute_servisy()
returns uuid[]
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(array_agg(s.id), '{}')
    from public.services s
   where s.active is not true;
$$;

comment on function public.vypnute_servisy() is
  'Id servisů vypnutých majitelem aplikace. Bez argumentu, takže se v politice vyhodnotí jednou za dotaz.';

create or replace function public.servisy_kde_smim_pracovat()
returns uuid[]
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(array_agg(m.service_id), '{}')
    from public.service_memberships m
    join public.services s on s.id = m.service_id
   where m.user_id = auth.uid()
     and s.active
     and exists (
       select 1 from public.service_entitlements e
        where e.service_id = m.service_id
          and e.module = 'access'
          and e.active
          and (e.valid_until is null or e.valid_until > now())
     );
$$;

comment on function public.servisy_kde_smim_pracovat() is
  'Servisy, kde je volající členem, servis je zapnutý a má platný nárok „access“. Pro RESTRICTIVE politiky u zápisu.';

revoke all on function public.vypnute_servisy() from public, anon;
revoke all on function public.servisy_kde_smim_pracovat() from public, anon;
grant execute on function public.vypnute_servisy() to authenticated, service_role;
grant execute on function public.servisy_kde_smim_pracovat() to authenticated, service_role;

-- ── Přepis politik ───────────────────────────────────────────────────────────
-- Seznam je stejný jako v 20260911100000, plus `customer_history` a `bookings`.
-- Vynechané zůstávají `service_entitlements`, `service_billing`,
-- `service_memberships`, `service_invites` a `error_logs`: zamčený servis musí
-- vidět, co má zaplaceno, a musí jít nahlásit chybu.
do $$
declare
  t text;
  tabulky text[] := array[
    'tickets', 'ticket_comments', 'ticket_documents', 'ticket_work_sessions',
    'warranty_claims',
    'customers', 'customer_history', 'repairs',
    'device_categories', 'device_brands', 'device_models',
    'inventory_products', 'inventory_stock', 'inventory_reservations',
    'inventory_suppliers', 'inventory_warehouses', 'inventory_product_categories',
    'inventory_purchase_orders',
    'invoices', 'invoice_series',
    'branches', 'bookings',
    'automation_rules', 'sms_automations', 'sms_conversations',
    'service_settings', 'service_statuses',
    'service_document_settings', 'service_document_templates', 'document_profiles',
    'service_integrations', 'service_phone_numbers',
    'api_tokens'
  ];
begin
  foreach t in array tabulky loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabulka % neexistuje, přeskakuji.', t;
      continue;
    end if;

    -- Čtení: blokuje jen vypnutý servis.
    execute format('drop policy if exists %I on public.%I', t || '_jen_zapnuty_servis', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (not (service_id = any (public.vypnute_servisy())))',
      t || '_jen_zapnuty_servis', t
    );

    -- Zápis: navíc platný nárok „access“.
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

-- Firemní údaje servisu (sloupec se jmenuje `id`, proto mimo smyčku).
drop policy if exists services_jen_s_pristupem_zmena on public.services;
create policy services_jen_s_pristupem_zmena
  on public.services as restrictive for update to authenticated
  using (id = any (public.servisy_kde_smim_pracovat()))
  with check (id = any (public.servisy_kde_smim_pracovat()));
