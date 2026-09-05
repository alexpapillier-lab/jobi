-- Kontrola po opravě u zakázky.
--
-- Technik před předáním projde kontrolní seznam (šablona podle typu
-- zařízení, definice v service_settings.config.kontrolniSeznamy). Výsledek
-- se ukládá k zakázce a jde do protokolu. Tvar: {sablonaId, sablonaNazev,
-- polozky: [{text, stav: 'ok'|'chyba'|'neoverovano'|null, poznamka?}], upraveno}.
-- Zápis hlídá stejný trigger jako ostatní sloupce zakázky (Úpravy zakázek).
alter table public.tickets add column if not exists test_checklist jsonb;
comment on column public.tickets.test_checklist is
  'Kontrola po opravě: šablona a položky se stavem ok/chyba/neoverovano. Null = kontrola nezaložena.';
