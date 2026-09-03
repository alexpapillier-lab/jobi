-- Stavy zakázek/reklamací převzaté 1:1 ze zakazkovylist.cz (Nastavení → Zakázky /
-- Nastavení → Reklamace) pro servis "iSwap Repair Point Praha".
--
-- Zdroj: /brand/orders (30 stavů) a /brand/complaints (14 stavů) na app.zakazkovylist.cz,
-- ověřeno živě 3. 9. 2026. Všech 14 stavů reklamací je podmnožinou 30 stavů zakázek,
-- Jobi má jeden sdílený seznam stavů pro obojí (service_statuses), takže stačí
-- sloučený seznam beze ztráty.
--
-- is_final přebírá "Konečný stav" ze zakazkovylist (sjednoceno přes oba ceníky,
-- kde se liší bere se logický OR). Barvy jsou nové – ZL žádné nedefinuje.

insert into public.service_statuses (service_id, key, label, bg, fg, is_final, order_index)
values
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'draft',                    'Zakládá se',                      '#94a3b8', '#ffffff', false, 0),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'received',                 'Přijato',                         '#3b82f6', '#ffffff', false, 1),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'in_repair',                'V opravě',                        '#f59e0b', '#ffffff', false, 2),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'waiting_customer',         'Čeká na zákazníka',               '#ec4899', '#ffffff', false, 3),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'waiting_part',             'Čeká na díl',                     '#eab308', '#ffffff', false, 4),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'at_auth_service',          'V aut. servisu',                  '#a855f7', '#ffffff', false, 5),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'ready_for_pickup',         'Připraveno k převzetí',           '#06b6d4', '#ffffff', false, 6),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'issued',                   'Vydáno',                          '#059669', '#ffffff', true,  7),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'not_picked_up',            'Nevyzvednuto',                    '#dc2626', '#ffffff', true,  8),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'cancelled',                'Stornováno',                      '#6b7280', '#ffffff', true,  9),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'waiting_device_ppl',       'Čekáme na zařízení (posláno PPL)','#0ea5e9', '#ffffff', false, 10),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'returned_unrepaired',      'Vráceno bez opravy',              '#78716c', '#ffffff', true,  11),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'board_repair_pistek',      'Oprava desky - Pištěk',           '#f97316', '#ffffff', false, 12),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'to_test',                  'K otestování',                    '#14b8a6', '#ffffff', false, 13),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'board_repair_marek',       'Oprava desky - Marek',            '#f97316', '#ffffff', false, 14),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'send_board_repair',        'Odeslat oprava desky',            '#fb923c', '#ffffff', false, 15),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'send_display_refurb',      'Odeslat repas displeje',          '#fbbf24', '#ffffff', false, 16),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'display_refurb_vitner',    'Repasování displeje - Vitner',    '#facc15', '#111827', false, 17),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'board_repair_vasil',       'Oprava desky - Vasil',            '#f97316', '#ffffff', false, 18),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'thai_camera',              'Thai - kamera',                   '#84cc16', '#ffffff', false, 19),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'message_customer',         'Napsat zákazník',                 '#d946ef', '#ffffff', false, 20),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'approved',                 'Odsouhlaseno',                    '#22c55e', '#ffffff', false, 21),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'order_part',               'Objednat díl',                    '#ca8a04', '#ffffff', false, 22),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'in_board_repair',          'V opravě zák. desky',             '#ea580c', '#ffffff', false, 23),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'buyback_to_repair',        'Náš výkup - k opravě',            '#0891b2', '#ffffff', false, 24),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'at_external_service',      'V externím servisu',              '#7c3aed', '#ffffff', false, 25),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'buyback_registered',       'Výkup, evidence',                 '#0369a1', '#ffffff', false, 26),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'board_repair_m',           'Oprava desky - M',                '#f97316', '#ffffff', false, 27),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'moved_to_unclaimed',       'Přesunuto do nevyzvednutých',     '#b91c1c', '#ffffff', false, 28),
  ('d9762a27-6c8d-43c4-9207-5c837e2713a0', 'boss_resolve',             'Šéf vyřešit',                     '#be123c', '#ffffff', false, 29)
on conflict (service_id, key) do nothing;
