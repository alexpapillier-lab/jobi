-- Díly od dodavatele: dodavatelé, objednávky, rezervace, minimální zásoba.
--
-- Servis potřebuje vědět, od koho díl bere, kolik kusů má mít vždy na skladě
-- a co má zrovna objednané / rezervované pro konkrétní zakázku. Přibývají:
--
--   inventory_suppliers             – dodavatelé servisu
--   inventory_products              – min_stock, supplier_id, supplier_sku
--   inventory_purchase_orders       – objednávky u dodavatele (OBJ-2026-001)
--   inventory_purchase_order_items  – položky objednávky (volitelně k zakázce)
--   inventory_reservations          – rezervace dílu pro zakázku
--
-- Příjem objednávky (RPC inventory_receive_order) zapisuje do inventory_stock;
-- součet `inventory_products.stock` dopočítá trigger trg_inventory_stock_dopocet
-- z 20260903200000 – sem se na `stock` přímo nesahá.
--
-- `purchase_price` na produktu už existuje (20260903190000), tady se jen
-- pojistí ADD COLUMN IF NOT EXISTS.
--
-- RLS kopíruje inventory_products: čtení = člen servisu, zápis =
-- has_capability(service_id, auth.uid(), 'can_edit_inventory')
-- (owner/admin mají capability implicitně, viz 20260230120000).

-- ========== 1) inventory_suppliers ==========

CREATE TABLE IF NOT EXISTS public.inventory_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  website text,
  -- Obvyklá dodací lhůta ve dnech – z ní se dopočítává expected_at objednávky.
  lead_days integer NOT NULL DEFAULT 3,
  note text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_suppliers_service_id
  ON public.inventory_suppliers(service_id);

COMMENT ON TABLE public.inventory_suppliers IS 'Dodavatelé dílů servisu.';
COMMENT ON COLUMN public.inventory_suppliers.lead_days IS 'Obvyklá dodací lhůta ve dnech.';

-- ========== 2) inventory_products – nové sloupce ==========

ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS min_stock integer,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.inventory_suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_sku text,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(12,2);

CREATE INDEX IF NOT EXISTS idx_inventory_products_supplier_id
  ON public.inventory_products(supplier_id);

COMMENT ON COLUMN public.inventory_products.min_stock IS
  'Minimální zásoba – pod ní se produkt hlásí k doobjednání. NULL = výchozí hodnota aplikace (5).';
COMMENT ON COLUMN public.inventory_products.supplier_id IS 'Obvyklý dodavatel produktu.';
COMMENT ON COLUMN public.inventory_products.supplier_sku IS 'Kód produktu u dodavatele.';

-- ========== 3) inventory_purchase_orders ==========

CREATE TABLE IF NOT EXISTS public.inventory_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.inventory_suppliers(id) ON DELETE SET NULL,
  -- OBJ-2026-001, přiděluje RPC inventory_next_po_number.
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
  note text,
  ordered_at timestamptz,
  expected_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, number)
);

CREATE INDEX IF NOT EXISTS idx_inventory_purchase_orders_service_status
  ON public.inventory_purchase_orders(service_id, status);

COMMENT ON TABLE public.inventory_purchase_orders IS 'Objednávky dílů u dodavatele.';
COMMENT ON COLUMN public.inventory_purchase_orders.status IS 'draft | ordered | received | cancelled';

-- ========== 4) inventory_purchase_order_items ==========

CREATE TABLE IF NOT EXISTS public.inventory_purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.inventory_purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  -- Pro kterou zakázku se díl objednává (volitelné).
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price numeric(12,2),
  received_qty integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_purchase_order_items_order_id
  ON public.inventory_purchase_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_purchase_order_items_product_id
  ON public.inventory_purchase_order_items(product_id);

COMMENT ON TABLE public.inventory_purchase_order_items IS 'Položky objednávky u dodavatele.';

-- ========== 5) inventory_reservations ==========

CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  -- Zakázka, pro kterou se díl drží. Smazáním zakázky rezervace zaniká.
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'consumed', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_product_status
  ON public.inventory_reservations(product_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_ticket_id
  ON public.inventory_reservations(ticket_id);

COMMENT ON TABLE public.inventory_reservations IS 'Rezervace dílu ze skladu pro konkrétní zakázku.';
COMMENT ON COLUMN public.inventory_reservations.status IS 'reserved | consumed | released';

-- ========== 6) updated_at ==========

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventory_suppliers_set_updated_at') THEN
    CREATE TRIGGER trg_inventory_suppliers_set_updated_at
      BEFORE UPDATE ON public.inventory_suppliers
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventory_purchase_orders_set_updated_at') THEN
    CREATE TRIGGER trg_inventory_purchase_orders_set_updated_at
      BEFORE UPDATE ON public.inventory_purchase_orders
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventory_reservations_set_updated_at') THEN
    CREATE TRIGGER trg_inventory_reservations_set_updated_at
      BEFORE UPDATE ON public.inventory_reservations
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ========== 7) RLS ==========

-- inventory_suppliers
ALTER TABLE public.inventory_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_suppliers_select_members" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_select_members"
  ON public.inventory_suppliers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_suppliers.service_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inventory_suppliers_insert_members" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_insert_members"
  ON public.inventory_suppliers FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(inventory_suppliers.service_id, auth.uid(), 'can_edit_inventory'));

DROP POLICY IF EXISTS "inventory_suppliers_update_members" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_update_members"
  ON public.inventory_suppliers FOR UPDATE TO authenticated
  USING (public.has_capability(inventory_suppliers.service_id, auth.uid(), 'can_edit_inventory'))
  WITH CHECK (public.has_capability(inventory_suppliers.service_id, auth.uid(), 'can_edit_inventory'));

DROP POLICY IF EXISTS "inventory_suppliers_delete_members" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_delete_members"
  ON public.inventory_suppliers FOR DELETE TO authenticated
  USING (public.has_capability(inventory_suppliers.service_id, auth.uid(), 'can_edit_inventory'));

-- inventory_purchase_orders
ALTER TABLE public.inventory_purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_purchase_orders_select_members" ON public.inventory_purchase_orders;
CREATE POLICY "inventory_purchase_orders_select_members"
  ON public.inventory_purchase_orders FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_purchase_orders.service_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inventory_purchase_orders_insert_members" ON public.inventory_purchase_orders;
CREATE POLICY "inventory_purchase_orders_insert_members"
  ON public.inventory_purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(inventory_purchase_orders.service_id, auth.uid(), 'can_edit_inventory'));

DROP POLICY IF EXISTS "inventory_purchase_orders_update_members" ON public.inventory_purchase_orders;
CREATE POLICY "inventory_purchase_orders_update_members"
  ON public.inventory_purchase_orders FOR UPDATE TO authenticated
  USING (public.has_capability(inventory_purchase_orders.service_id, auth.uid(), 'can_edit_inventory'))
  WITH CHECK (public.has_capability(inventory_purchase_orders.service_id, auth.uid(), 'can_edit_inventory'));

DROP POLICY IF EXISTS "inventory_purchase_orders_delete_members" ON public.inventory_purchase_orders;
CREATE POLICY "inventory_purchase_orders_delete_members"
  ON public.inventory_purchase_orders FOR DELETE TO authenticated
  USING (public.has_capability(inventory_purchase_orders.service_id, auth.uid(), 'can_edit_inventory'));

-- inventory_purchase_order_items – nemají service_id, právo se bere z objednávky.
ALTER TABLE public.inventory_purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_purchase_order_items_select_members" ON public.inventory_purchase_order_items;
CREATE POLICY "inventory_purchase_order_items_select_members"
  ON public.inventory_purchase_order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.inventory_purchase_orders o
      JOIN public.service_memberships m ON m.service_id = o.service_id
      WHERE o.id = inventory_purchase_order_items.order_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inventory_purchase_order_items_insert_members" ON public.inventory_purchase_order_items;
CREATE POLICY "inventory_purchase_order_items_insert_members"
  ON public.inventory_purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventory_purchase_orders o
      WHERE o.id = inventory_purchase_order_items.order_id
        AND public.has_capability(o.service_id, auth.uid(), 'can_edit_inventory')
    )
  );

DROP POLICY IF EXISTS "inventory_purchase_order_items_update_members" ON public.inventory_purchase_order_items;
CREATE POLICY "inventory_purchase_order_items_update_members"
  ON public.inventory_purchase_order_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_purchase_orders o
      WHERE o.id = inventory_purchase_order_items.order_id
        AND public.has_capability(o.service_id, auth.uid(), 'can_edit_inventory')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventory_purchase_orders o
      WHERE o.id = inventory_purchase_order_items.order_id
        AND public.has_capability(o.service_id, auth.uid(), 'can_edit_inventory')
    )
  );

DROP POLICY IF EXISTS "inventory_purchase_order_items_delete_members" ON public.inventory_purchase_order_items;
CREATE POLICY "inventory_purchase_order_items_delete_members"
  ON public.inventory_purchase_order_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_purchase_orders o
      WHERE o.id = inventory_purchase_order_items.order_id
        AND public.has_capability(o.service_id, auth.uid(), 'can_edit_inventory')
    )
  );

-- inventory_reservations
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_reservations_select_members" ON public.inventory_reservations;
CREATE POLICY "inventory_reservations_select_members"
  ON public.inventory_reservations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_reservations.service_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inventory_reservations_insert_members" ON public.inventory_reservations;
CREATE POLICY "inventory_reservations_insert_members"
  ON public.inventory_reservations FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(inventory_reservations.service_id, auth.uid(), 'can_edit_inventory'));

DROP POLICY IF EXISTS "inventory_reservations_update_members" ON public.inventory_reservations;
CREATE POLICY "inventory_reservations_update_members"
  ON public.inventory_reservations FOR UPDATE TO authenticated
  USING (public.has_capability(inventory_reservations.service_id, auth.uid(), 'can_edit_inventory'))
  WITH CHECK (public.has_capability(inventory_reservations.service_id, auth.uid(), 'can_edit_inventory'));

DROP POLICY IF EXISTS "inventory_reservations_delete_members" ON public.inventory_reservations;
CREATE POLICY "inventory_reservations_delete_members"
  ON public.inventory_reservations FOR DELETE TO authenticated
  USING (public.has_capability(inventory_reservations.service_id, auth.uid(), 'can_edit_inventory'));

-- ========== 8) Realtime ==========
-- Pokud tabulka už v supabase_realtime je, příkaz selže – v tom případě ji přeskočíme.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_suppliers;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_purchase_orders;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_purchase_order_items;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_reservations;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

-- ========== 9) RPC: další číslo objednávky ==========
-- OBJ-<rok>-<pořadí v roce>. Pořadí = počet objednávek servisu založených
-- letos + 1. Při souběhu dvou uživatelů může vyjít stejné číslo – UNIQUE
-- (service_id, number) to chytí a klient si řekne o nové.

CREATE OR REPLACE FUNCTION public.inventory_next_po_number(p_service_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_memberships m
    WHERE m.service_id = p_service_id AND m.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Nemáte oprávnění k tomuto servisu' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)
    INTO v_count
  FROM public.inventory_purchase_orders o
  WHERE o.service_id = p_service_id
    AND o.created_at >= date_trunc('year', now())
    AND o.created_at <  date_trunc('year', now()) + interval '1 year';

  RETURN 'OBJ-' || to_char(now(), 'YYYY') || '-' || lpad((v_count + 1)::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_next_po_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_next_po_number(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_next_po_number(uuid) TO authenticated;

COMMENT ON FUNCTION public.inventory_next_po_number(uuid) IS
  'Navrhne číslo další objednávky (OBJ-RRRR-NNN). Při kolizi UNIQUE si klient zavolá znovu. Jen členové servisu.';

-- ========== 10) RPC: příjem objednávky na sklad ==========
-- Všechny položky označí za přijaté (received_qty = qty), přičte kusy do
-- inventory_stock ve zvoleném skladu a objednávku přepne na 'received'.
-- Běží v jedné transakci – buď se přijme všechno, nebo nic.
-- Součet na produktu dopočítá trigger trg_inventory_stock_dopocet.

CREATE OR REPLACE FUNCTION public.inventory_receive_order(p_order_id uuid, p_warehouse_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Zámek řádku: dva souběžné příjmy téže objednávky se nesmí sečíst dvakrát.
  SELECT service_id, status
    INTO v_service_id, v_status
  FROM public.inventory_purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Objednávka nenalezena' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_memberships m
    WHERE m.service_id = v_service_id AND m.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Nemáte oprávnění k této objednávce' USING ERRCODE = '42501';
  END IF;

  -- Zápis do skladu = stejné právo jako přímá editace skladu přes RLS.
  IF NOT public.has_capability(v_service_id, v_uid, 'can_edit_inventory') THEN
    RAISE EXCEPTION 'Nemáte oprávnění upravovat sklad' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'received' THEN
    RAISE EXCEPTION 'Objednávka už byla přijata' USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Zrušenou objednávku nejde přijmout' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_warehouses w
    WHERE w.id = p_warehouse_id AND w.service_id = v_service_id
  ) THEN
    RAISE EXCEPTION 'Sklad nepatří tomuto servisu' USING ERRCODE = 'P0001';
  END IF;

  -- Položka s produktem cizího servisu by narazila na složený cizí klíč
  -- inventory_stock; radši srozumitelná hláška než chyba constraintu.
  IF EXISTS (
    SELECT 1
    FROM public.inventory_purchase_order_items i
    JOIN public.inventory_products p ON p.id = i.product_id
    WHERE i.order_id = p_order_id AND p.service_id <> v_service_id
  ) THEN
    RAISE EXCEPTION 'Objednávka obsahuje produkt jiného servisu' USING ERRCODE = 'P0001';
  END IF;

  -- Přičíst kusy do skladu (produkt × sklad → ks). Položky téhož produktu
  -- se nejdřív sečtou, aby ON CONFLICT nenarazil na duplicitní řádek.
  INSERT INTO public.inventory_stock AS s (product_id, warehouse_id, service_id, quantity)
  SELECT i.product_id, p_warehouse_id, v_service_id, sum(i.qty)
  FROM public.inventory_purchase_order_items i
  WHERE i.order_id = p_order_id
  GROUP BY i.product_id
  ON CONFLICT (product_id, warehouse_id)
  DO UPDATE SET
    quantity = s.quantity + EXCLUDED.quantity,
    updated_at = now();

  UPDATE public.inventory_purchase_order_items
     SET received_qty = qty
   WHERE order_id = p_order_id;

  UPDATE public.inventory_purchase_orders
     SET status = 'received',
         received_at = now()
   WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_receive_order(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_receive_order(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_receive_order(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.inventory_receive_order(uuid, uuid) IS
  'Přijme celou objednávku na zvolený sklad: received_qty = qty, přičte do inventory_stock, status received. Odmítne už přijatou nebo zrušenou objednávku.';
