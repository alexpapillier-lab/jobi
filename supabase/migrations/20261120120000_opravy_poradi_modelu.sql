-- Ceník: pořadí oprav zvlášť pro každý model
-- ============================================================================
--
-- Oprava může patřit k víc modelům (repairs.model_ids), ale pořadí bylo jedno
-- společné (repairs.order_index): posun u iPhonu 13 přehodil opravu i u všech
-- ostatních modelů. Nově má oprava volitelné pořadí pro konkrétní model:
--
--   model_order = { "<id modelu>": pořadí, ... }
--
-- Model, který vlastní pořadí nemá (nic se u něj neposouvalo), řadí podle
-- společného order_index jako dřív – stávající ceníky se nemění. Prázdné {}
-- je výchozí hodnota.

alter table public.repairs
  add column if not exists model_order jsonb not null default '{}'::jsonb;

comment on column public.repairs.model_order is
  'Pořadí opravy v seznamu konkrétního modelu: {"<model_id>": 0, ...}. Bez klíče se model řadí podle order_index.';
