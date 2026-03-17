-- Zařízení a sklad: brands, categories, models, repairs, product_categories, products
-- Všechna data jsou vázána na service_id (multi-tenancy).

-- 1) device_brands (značky)
CREATE TABLE IF NOT EXISTS public.device_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_brands_service_id ON public.device_brands(service_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_brands_service_name
  ON public.device_brands(service_id, lower(name));

COMMENT ON TABLE public.device_brands IS 'Značky zařízení (Apple, Samsung, …).';

-- 2) device_categories (kategorie – např. Telefony, Tablety, v rámci značky)
CREATE TABLE IF NOT EXISTS public.device_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.device_brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_categories_service_id ON public.device_categories(service_id);
CREATE INDEX IF NOT EXISTS idx_device_categories_brand_id ON public.device_categories(brand_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_categories_brand_name
  ON public.device_categories(brand_id, lower(name));

COMMENT ON TABLE public.device_categories IS 'Kategorie zařízení uvnitř značky (Telefony, Tablety).';

-- 3) device_models (modely – např. iPhone 15, Galaxy S24)
CREATE TABLE IF NOT EXISTS public.device_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.device_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_models_service_id ON public.device_models(service_id);
CREATE INDEX IF NOT EXISTS idx_device_models_category_id ON public.device_models(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_models_category_name
  ON public.device_models(category_id, lower(name));

COMMENT ON TABLE public.device_models IS 'Modely zařízení (iPhone 15, Galaxy S24).';

-- 4) repairs (opravy – např. Výměna displeje)
-- model_ids a product_ids uloženy jako jsonb pole UUID
CREATE TABLE IF NOT EXISTS public.repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  estimated_time integer NOT NULL DEFAULT 0,
  details text NOT NULL DEFAULT '',
  costs numeric(12,2),
  model_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repairs_service_id ON public.repairs(service_id);
CREATE INDEX IF NOT EXISTS idx_repairs_model_ids ON public.repairs USING gin(model_ids);

COMMENT ON TABLE public.repairs IS 'Typy oprav (Výměna displeje). Vazba na modely přes model_ids.';

-- 5) inventory_product_categories (kategorie produktů – např. Displeje, Baterie)
CREATE TABLE IF NOT EXISTS public.inventory_product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL,
  model_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_categories_service_id ON public.inventory_product_categories(service_id);

COMMENT ON TABLE public.inventory_product_categories IS 'Kategorie produktů ve skladu.';

-- 6) inventory_products (produkty)
CREATE TABLE IF NOT EXISTS public.inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL,
  stock integer NOT NULL DEFAULT 0,
  price numeric(12,2) NOT NULL DEFAULT 0,
  sku text,
  description text,
  image_url text,
  category_id uuid REFERENCES public.inventory_product_categories(id) ON DELETE SET NULL,
  model_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  repair_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_products_service_id ON public.inventory_products(service_id);
CREATE INDEX IF NOT EXISTS idx_inventory_products_category_id ON public.inventory_products(category_id);

COMMENT ON TABLE public.inventory_products IS 'Produkty ve skladu.';

-- ========== RLS ==========

-- device_brands
ALTER TABLE public.device_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_brands_select_members"
  ON public.device_brands FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_brands.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_brands_insert_members"
  ON public.device_brands FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_brands.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_brands_update_members"
  ON public.device_brands FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_brands.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_brands.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_brands_delete_members"
  ON public.device_brands FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_brands.service_id AND m.user_id = auth.uid()
    )
  );

-- device_categories
ALTER TABLE public.device_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_categories_select_members"
  ON public.device_categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_categories.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_categories_insert_members"
  ON public.device_categories FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_categories.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_categories_update_members"
  ON public.device_categories FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_categories.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_categories.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_categories_delete_members"
  ON public.device_categories FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_categories.service_id AND m.user_id = auth.uid()
    )
  );

-- device_models
ALTER TABLE public.device_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_models_select_members"
  ON public.device_models FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_models.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_models_insert_members"
  ON public.device_models FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_models.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_models_update_members"
  ON public.device_models FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_models.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_models.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "device_models_delete_members"
  ON public.device_models FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = device_models.service_id AND m.user_id = auth.uid()
    )
  );

-- repairs
ALTER TABLE public.repairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "repairs_select_members"
  ON public.repairs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = repairs.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "repairs_insert_members"
  ON public.repairs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = repairs.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "repairs_update_members"
  ON public.repairs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = repairs.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = repairs.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "repairs_delete_members"
  ON public.repairs FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = repairs.service_id AND m.user_id = auth.uid()
    )
  );

-- inventory_product_categories
ALTER TABLE public.inventory_product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_product_categories_select_members"
  ON public.inventory_product_categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_product_categories.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "inventory_product_categories_insert_members"
  ON public.inventory_product_categories FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_product_categories.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "inventory_product_categories_update_members"
  ON public.inventory_product_categories FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_product_categories.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_product_categories.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "inventory_product_categories_delete_members"
  ON public.inventory_product_categories FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_product_categories.service_id AND m.user_id = auth.uid()
    )
  );

-- inventory_products
ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_products_select_members"
  ON public.inventory_products FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_products.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "inventory_products_insert_members"
  ON public.inventory_products FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_products.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "inventory_products_update_members"
  ON public.inventory_products FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_products.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_products.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "inventory_products_delete_members"
  ON public.inventory_products FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = inventory_products.service_id AND m.user_id = auth.uid()
    )
  );
