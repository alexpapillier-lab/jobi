-- Pobočkové omezení dotažené na vedlejší tabulky.
--
-- Pravidlo z docs/MIGRATIONS_SAFETY.md říká, že každá tabulka odkazující na
-- zakázku potřebuje restriktivní politiku „jen k viditelným zakázkám“. Zatím
-- ji měly jen tři (historie, komentáře, úseky práce) a jen pro čtení. Člen
-- omezený na jednu pobočku se tak přes SMS konverzace, historii reklamací
-- nebo události portálu dostal k údajům zakázek z cizí pobočky – tedy přesně
-- k tomu, před čím ho to omezení má chránit. A na tři „hotové“ tabulky mohl
-- zapisovat, protože restrikce platila jen pro select.
--
-- Vzor je pořád stejný: v poddotazu na `tickets` se uplatní RLS zakázek
-- včetně pobočky, takže stačí ověřit, že zakázka je pro mě viditelná.
-- `ticket_id is null` musí projít tam, kde je vazba nepovinná (konverzace
-- bez zakázky, běh automatizace bez zakázky).

-- ── SMS: konverzace a zprávy ────────────────────────────────────────────────
create policy "sms_conversations_jen_viditelne_zakazky" on public.sms_conversations
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = sms_conversations.ticket_id));

create policy "sms_messages_jen_viditelne_zakazky" on public.sms_messages
  as restrictive for select to authenticated
  using (exists (
    select 1 from public.sms_conversations c
    where c.id = sms_messages.conversation_id
      and (c.ticket_id is null or exists (select 1 from public.tickets t where t.id = c.ticket_id))
  ));

-- ── Reklamace: historie ─────────────────────────────────────────────────────
create policy "warranty_claim_history_jen_viditelne" on public.warranty_claim_history
  as restrictive for select to authenticated
  using (exists (select 1 from public.warranty_claims w where w.id = warranty_claim_history.warranty_claim_id));

-- ── Zakázka: události portálu, dokumenty, rezervace dílů, běhy automatizací ─
create policy "ticket_portal_events_jen_viditelne_zakazky" on public.ticket_portal_events
  as restrictive for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_portal_events.ticket_id));

create policy "ticket_documents_jen_viditelne_zakazky" on public.ticket_documents
  as restrictive for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_documents.ticket_id));

create policy "inventory_reservations_jen_viditelne_zakazky" on public.inventory_reservations
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_reservations.ticket_id));

create policy "automation_runs_jen_viditelne_zakazky" on public.automation_runs
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = automation_runs.ticket_id));

create policy "po_items_jen_viditelne_zakazky" on public.inventory_purchase_order_items
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_purchase_order_items.ticket_id));

-- ── Zápisová strana u tabulek, které měly jen čtení ─────────────────────────
-- Zpátky by si to člen nepřečetl, ale zapsat komentář nebo řádek historie na
-- cizí pobočkovou zakázku mohl.
create policy "ticket_history_jen_viditelne_zapis" on public.ticket_history
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.tickets t where t.id = ticket_history.ticket_id));

create policy "ticket_comments_jen_viditelne_zapis" on public.ticket_comments
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.tickets t where t.id = ticket_comments.ticket_id));

create policy "ticket_comments_jen_viditelne_uprava" on public.ticket_comments
  as restrictive for update to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_comments.ticket_id))
  with check (exists (select 1 from public.tickets t where t.id = ticket_comments.ticket_id));

create policy "ticket_comments_jen_viditelne_mazani" on public.ticket_comments
  as restrictive for delete to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_comments.ticket_id));

create policy "sms_conversations_jen_viditelne_zapis" on public.sms_conversations
  as restrictive for insert to authenticated
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = sms_conversations.ticket_id));
