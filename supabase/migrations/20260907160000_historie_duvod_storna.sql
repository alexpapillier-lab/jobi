-- Historie zakázky: nový druh záznamu „důvod storna“.
--
-- Při přepnutí zakázky do stavu, který je storno (Zrušeno, Storno…), se
-- aplikace zeptá proč a odpověď uloží do historie jako action
-- 'cancel_reason' s details {duvod, poznamka, status}. Kontrola povolených
-- akcí (z migrace 20260222000000) ho musí znát, jinak zápis spadne.
alter table public.ticket_history drop constraint if exists ticket_history_action_check;
alter table public.ticket_history
  add constraint ticket_history_action_check
  check (action in ('created', 'updated', 'deleted', 'restored', 'warranty_claim_created', 'cancel_reason'));

comment on column public.ticket_history.action is
  'created, updated, deleted, restored, warranty_claim_created (založena reklamace), cancel_reason (důvod storna z dialogu při změně stavu)';
