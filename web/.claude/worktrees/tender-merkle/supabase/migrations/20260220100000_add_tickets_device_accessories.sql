-- Příslušenství k zařízení u zakázky (např. nabíječka, pouzdro)
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS device_accessories text;

COMMENT ON COLUMN public.tickets.device_accessories IS 'Příslušenství k zařízení (volný text nebo z přednastavených možností)';
