-- Položky cenové nabídky.
--
-- Nabídka byla jen jedna částka, takže zákazník viděl „4 500 Kč" a nevěděl
-- za co. Rozpis se ukládá k zakázce jako pole položek; `quote_amount` zůstává
-- součtem, protože z něj čte portál, SMS i faktury.
--
-- Tvar položky: {"id": "...", "name": "Výměna displeje", "price": 3200,
--                "repairId": "uuid z ceníku nebo chybí", "costs": 1800,
--                "estimatedTime": 45, "productIds": []}
-- Schválně stejný jako `performed_repairs`, aby se po schválení daly položky
-- přenést do zakázky beze změny tvaru.
alter table public.tickets
  add column if not exists quote_items jsonb not null default '[]'::jsonb;

comment on column public.tickets.quote_items is
  'Položky cenové nabídky (stejný tvar jako performed_repairs). Součet je v quote_amount.';
