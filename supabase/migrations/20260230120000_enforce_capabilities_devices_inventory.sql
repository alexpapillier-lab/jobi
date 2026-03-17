-- Enforce member capabilities for devices and inventory write operations.
-- Owner/admin keep full access via public.has_capability().

-- device_brands
DROP POLICY IF EXISTS "device_brands_insert_members" ON public.device_brands;
DROP POLICY IF EXISTS "device_brands_update_members" ON public.device_brands;
DROP POLICY IF EXISTS "device_brands_delete_members" ON public.device_brands;

CREATE POLICY "device_brands_insert_members"
  ON public.device_brands FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(device_brands.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "device_brands_update_members"
  ON public.device_brands FOR UPDATE TO authenticated
  USING (public.has_capability(device_brands.service_id, auth.uid(), 'can_edit_devices'))
  WITH CHECK (public.has_capability(device_brands.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "device_brands_delete_members"
  ON public.device_brands FOR DELETE TO authenticated
  USING (public.has_capability(device_brands.service_id, auth.uid(), 'can_edit_devices'));

-- device_categories
DROP POLICY IF EXISTS "device_categories_insert_members" ON public.device_categories;
DROP POLICY IF EXISTS "device_categories_update_members" ON public.device_categories;
DROP POLICY IF EXISTS "device_categories_delete_members" ON public.device_categories;

CREATE POLICY "device_categories_insert_members"
  ON public.device_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(device_categories.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "device_categories_update_members"
  ON public.device_categories FOR UPDATE TO authenticated
  USING (public.has_capability(device_categories.service_id, auth.uid(), 'can_edit_devices'))
  WITH CHECK (public.has_capability(device_categories.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "device_categories_delete_members"
  ON public.device_categories FOR DELETE TO authenticated
  USING (public.has_capability(device_categories.service_id, auth.uid(), 'can_edit_devices'));

-- device_models
DROP POLICY IF EXISTS "device_models_insert_members" ON public.device_models;
DROP POLICY IF EXISTS "device_models_update_members" ON public.device_models;
DROP POLICY IF EXISTS "device_models_delete_members" ON public.device_models;

CREATE POLICY "device_models_insert_members"
  ON public.device_models FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(device_models.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "device_models_update_members"
  ON public.device_models FOR UPDATE TO authenticated
  USING (public.has_capability(device_models.service_id, auth.uid(), 'can_edit_devices'))
  WITH CHECK (public.has_capability(device_models.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "device_models_delete_members"
  ON public.device_models FOR DELETE TO authenticated
  USING (public.has_capability(device_models.service_id, auth.uid(), 'can_edit_devices'));

-- repairs
DROP POLICY IF EXISTS "repairs_insert_members" ON public.repairs;
DROP POLICY IF EXISTS "repairs_update_members" ON public.repairs;
DROP POLICY IF EXISTS "repairs_delete_members" ON public.repairs;

CREATE POLICY "repairs_insert_members"
  ON public.repairs FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(repairs.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "repairs_update_members"
  ON public.repairs FOR UPDATE TO authenticated
  USING (public.has_capability(repairs.service_id, auth.uid(), 'can_edit_devices'))
  WITH CHECK (public.has_capability(repairs.service_id, auth.uid(), 'can_edit_devices'));

CREATE POLICY "repairs_delete_members"
  ON public.repairs FOR DELETE TO authenticated
  USING (public.has_capability(repairs.service_id, auth.uid(), 'can_edit_devices'));

-- inventory_product_categories
DROP POLICY IF EXISTS "inventory_product_categories_insert_members" ON public.inventory_product_categories;
DROP POLICY IF EXISTS "inventory_product_categories_update_members" ON public.inventory_product_categories;
DROP POLICY IF EXISTS "inventory_product_categories_delete_members" ON public.inventory_product_categories;

CREATE POLICY "inventory_product_categories_insert_members"
  ON public.inventory_product_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(inventory_product_categories.service_id, auth.uid(), 'can_edit_inventory'));

CREATE POLICY "inventory_product_categories_update_members"
  ON public.inventory_product_categories FOR UPDATE TO authenticated
  USING (public.has_capability(inventory_product_categories.service_id, auth.uid(), 'can_edit_inventory'))
  WITH CHECK (public.has_capability(inventory_product_categories.service_id, auth.uid(), 'can_edit_inventory'));

CREATE POLICY "inventory_product_categories_delete_members"
  ON public.inventory_product_categories FOR DELETE TO authenticated
  USING (public.has_capability(inventory_product_categories.service_id, auth.uid(), 'can_edit_inventory'));

-- inventory_products
DROP POLICY IF EXISTS "inventory_products_insert_members" ON public.inventory_products;
DROP POLICY IF EXISTS "inventory_products_update_members" ON public.inventory_products;
DROP POLICY IF EXISTS "inventory_products_delete_members" ON public.inventory_products;

CREATE POLICY "inventory_products_insert_members"
  ON public.inventory_products FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(inventory_products.service_id, auth.uid(), 'can_edit_inventory'));

CREATE POLICY "inventory_products_update_members"
  ON public.inventory_products FOR UPDATE TO authenticated
  USING (public.has_capability(inventory_products.service_id, auth.uid(), 'can_edit_inventory'))
  WITH CHECK (public.has_capability(inventory_products.service_id, auth.uid(), 'can_edit_inventory'));

CREATE POLICY "inventory_products_delete_members"
  ON public.inventory_products FOR DELETE TO authenticated
  USING (public.has_capability(inventory_products.service_id, auth.uid(), 'can_edit_inventory'));
