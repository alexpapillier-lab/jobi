-- Konec předplatného a deaktivace servisu se hlídají i na serveru.
--
-- Co bylo špatně: nárok `access` a příznak `services.active` existovaly jen
-- pro aplikaci. Po skončení zkušebního období se sice ukázala zamykací
-- obrazovka (TrialEnded), ale databáze pouštěla dál úplně všechno – zakázky,
-- zákazníky, sklad, ceník. Stačilo zavolat REST napřímo (nebo nechat běžet
-- rozdělaný skript, integraci, druhé okno) a servis, který nezaplatil,
-- pracoval dál. Stejně tak deaktivovaný servis: `services-list` ho jen skryl
-- ze seznamu, ale jeho data zůstala přes REST přístupná komukoli, kdo v něm
-- měl členství.
--
-- Moduly (`invoices`, `branches`, `sms`, `accounting`, `api_*`) hlídané už
-- byly – RLS u faktur, trigger u poboček, `has_entitlement()` v edge funkcích.
-- Chybělo právě to nejdůležitější: samotný přístup do aplikace.
--
-- Jak se to hlídá:
--   * ZÁPIS (insert/update/delete) do dat servisu vyžaduje `access` a aktivní
--     servis. Servis, kterému doběhlo předplatné, nic nového nezaloží.
--   * ČTENÍ zůstává i po vypršení `access`. Zamykací obrazovka slibuje, že
--     data zůstávají uložená a najdou se přesně tak, jak je člověk nechal –
--     a export podle GDPR na tom stojí. Zabráno je vydělávání, ne archiv.
--   * DEAKTIVOVANÝ servis (`services.active = false`) se nepustí ani ke
--     čtení. Tohle je vypínač majitele aplikace, ne stav předplatného;
--     po jeho použití se do servisu nedostane nikdo ani podstrčeným id.
--
-- Politiky jsou RESTRICTIVE a jen pro roli `authenticated`. Skládají se tedy
-- k stávajícím povolením (nic nezpřístupňují navíc) a netýkají se edge funkcí
-- pod `service_role` – ty musí fungovat dál: majitel aplikace potřebuje nárok
-- prodloužit, exportovat data i servis smazat, zákaznický portál je součást
-- základu a rezervace přicházejí zvenčí bez přihlášení.

-- ── Pomocné funkce ───────────────────────────────────────────────────────────
-- Obě se ptají i na členství. Bez toho by šlo jedním dotazem zjistit, který
-- cizí servis platí a který ne – přesně to zakazuje lockdown has_entitlement().
-- Nečlen dostane `false` a nedozví se nic, co by nevěděl už z RLS.

create or replace function public.servis_je_aktivni(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
      from public.services s
      join public.service_memberships m
        on m.service_id = s.id and m.user_id = auth.uid()
     where s.id = p_service_id
       and s.active
  );
$$;

comment on function public.servis_je_aktivni(uuid) is
  'Je servis zapnutý a jsem v něm člen? Deaktivovaný servis (Owner → deaktivovat) nevrací nic ani přes REST.';

create or replace function public.servis_smi_pracovat(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
      from public.services s
      join public.service_memberships m
        on m.service_id = s.id and m.user_id = auth.uid()
     where s.id = p_service_id
       and s.active
  )
  and exists (
    select 1
      from public.service_entitlements e
     where e.service_id = p_service_id
       and e.module = 'access'
       and e.active
       and (e.valid_until is null or e.valid_until > now())
  );
$$;

comment on function public.servis_smi_pracovat(uuid) is
  'Smí se v servisu pracovat? Aktivní servis + platný nárok „access“ + členství. Pro RESTRICTIVE politiky u zápisu.';

revoke all on function public.servis_je_aktivni(uuid) from public, anon;
revoke all on function public.servis_smi_pracovat(uuid) from public, anon;
grant execute on function public.servis_je_aktivni(uuid) to authenticated, service_role;
grant execute on function public.servis_smi_pracovat(uuid) to authenticated, service_role;

-- ── Politiky nad daty servisu ────────────────────────────────────────────────
-- Seznam je vypsaný schválně, ne odvozený z „má sloupec service_id“:
--   * `service_entitlements`, `service_billing`, `service_memberships`
--     a `service_invites` tu nesmí být. Zamčený servis musí dál vidět, co má
--     zaplaceno a do kdy, jinak by zamykací obrazovka nevěděla, co ukázat,
--     a nikdo by se nedokoupil zpátky.
--   * `error_logs` chybí taky – hlášení chyby musí projít i ze zamčené
--     aplikace, jinak se o problému nedozvíme.
--   * historie a čítače (`ticket_history`, `ticket_code_counters`, …) se
--     nepíšou z aplikace, ale z triggerů nad tabulkami, které v seznamu jsou;
--     hlídat je zvlášť by jen přidalo cestu, jak si rozbít zakládání zakázek.
do $$
declare
  t text;
  tabulky text[] := array[
    'tickets', 'ticket_comments', 'ticket_documents', 'ticket_work_sessions',
    'warranty_claims',
    'customers', 'repairs',
    'device_categories', 'device_brands', 'device_models',
    'inventory_products', 'inventory_stock', 'inventory_reservations',
    'inventory_suppliers', 'inventory_warehouses', 'inventory_product_categories',
    'inventory_purchase_orders',
    'invoices', 'invoice_series',
    'branches',
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

    -- Čtení: blokuje jen deaktivovaný servis.
    execute format('drop policy if exists %I on public.%I', t || '_jen_zapnuty_servis', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (public.servis_je_aktivni(service_id))',
      t || '_jen_zapnuty_servis', t
    );

    -- Zápis: navíc platný nárok „access“.
    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_vlozeni', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (public.servis_smi_pracovat(service_id))',
      t || '_jen_s_pristupem_vlozeni', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_zmena', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (public.servis_smi_pracovat(service_id)) with check (public.servis_smi_pracovat(service_id))',
      t || '_jen_s_pristupem_zmena', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_jen_s_pristupem_mazani', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (public.servis_smi_pracovat(service_id))',
      t || '_jen_s_pristupem_mazani', t
    );
  end loop;
end
$$;

-- Firemní údaje a sazba DPH samotného servisu. Sloupec se tu jmenuje `id`,
-- proto stojí mimo smyčku. Čtení se nechává: seznam servisů i zamykací
-- obrazovka potřebují znát aspoň název.
drop policy if exists services_jen_s_pristupem_zmena on public.services;
create policy services_jen_s_pristupem_zmena
  on public.services as restrictive for update to authenticated
  using (public.servis_smi_pracovat(id))
  with check (public.servis_smi_pracovat(id));
