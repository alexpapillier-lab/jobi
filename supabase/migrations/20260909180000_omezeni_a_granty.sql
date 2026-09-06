-- Zpevnění databáze: co drží jen na dohodě, má držet na omezení.
--
-- Nálezy z revize databázové vrstvy. Nic z toho není teoretické – u čísla
-- zakázky už jedna duplicita v testovacím servisu skutečně vznikla.

-- ── 1. Číslo zakázky je v rámci servisu jen jednou ──────────────────────────
-- Číslo přiděluje `dalsi_cislo_zakazky` přes počítadlo, ale nic nebránilo
-- souběhu ani ručnímu přepsání. Faktury a reklamace tuhle pojistku mají,
-- zakázky ne. Smazané zakázky se nepočítají – po smazání smí číslo padnout
-- do koše a nové se přidělí znovu.
create unique index if not exists uq_tickets_service_code
  on public.tickets (service_id, code)
  where deleted_at is null and coalesce(code, '') <> '';

-- ── 2. Rozsahy částek a množství ────────────────────────────────────────────
-- Bez nich projde faktura se zápornou sazbou DPH, nulovým množstvím nebo
-- slevou 500 %. Kontrolu má dnes jen sazba DPH servisu a zásoba na skladě.
alter table public.invoice_items
  add constraint invoice_items_qty_kladne check (qty > 0) not valid,
  add constraint invoice_items_sazba_rozsah check (vat_rate >= 0 and vat_rate <= 100) not valid;

alter table public.tickets
  add constraint tickets_sleva_rozsah check (
    discount_value is null
    or (discount_type = 'percentage' and discount_value >= 0 and discount_value <= 100)
    or (discount_type = 'amount' and discount_value >= 0)
    or discount_type is null
  ) not valid,
  add constraint tickets_druh_slevy check (discount_type is null or discount_type in ('percentage', 'amount')) not valid;

-- `not valid` schválně: stávající řádky se nekontrolují (mohly vzniknout
-- před tímhle omezením), nové ano. Ověření starých dat je samostatná úloha.

-- ── 3. Smazání účtu nesmí selhat na cizím klíči ─────────────────────────────
-- `updated_by` odkazuje na auth.users bez `on delete`, takže výmaz účtu
-- (GDPR) na nich skončí chybou. Ostatní odkazy na uživatele to mají správně.
alter table public.document_profiles
  drop constraint if exists document_profiles_updated_by_fkey,
  add constraint document_profiles_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.service_document_templates
  drop constraint if exists service_document_templates_updated_by_fkey,
  add constraint service_document_templates_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null;

alter table public.ticket_documents
  drop constraint if exists ticket_documents_updated_by_fkey,
  add constraint ticket_documents_updated_by_fkey
    foreign key (updated_by) references auth.users (id) on delete set null;

-- ── 4. Historie zákazníků: vazba na servis a index ──────────────────────────
-- Tabulka neměla cizí klíč na servis (po tvrdém smazání servisu tam zůstávaly
-- osiřelé záznamy o změnách) a neměla jediný index kromě primárního klíče,
-- přestože se čte právě podle zákazníka.
create index if not exists idx_customer_history_customer on public.customer_history (customer_id, changed_at desc);
create index if not exists idx_customer_history_service on public.customer_history (service_id);

-- ── 5. Granty, které nikdo nepoužívá ────────────────────────────────────────
-- `truncate` RLS neřeší: role s tímhle právem vyprázdní tabulku bez ohledu na
-- jedinou politiku. `trigger` dovoluje pověsit vlastní kód na cizí zápis.
-- Přes REST se to poslat nedá, ale je to zbytečně široké právo.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- ── 6. Index na kombinaci pobočka + řazení seznamu zakázek ──────────────────
-- Seznam zakázek na pobočce dnes používá index bez pobočky a filtruje až
-- potom. Se stovkami zakázek na servis to nevadí, s desítkami tisíc ano.
create index if not exists idx_tickets_branch_created
  on public.tickets (service_id, branch_id, created_at desc)
  where deleted_at is null;
