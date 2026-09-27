-- ============================================================================
-- Souhrnná faktura: jedna faktura za víc zakázek (firemní zákazníci)
-- ============================================================================
--
-- PROČ: Firemní zákazník (IČO, „(B2B)“ v názvu) má za měsíc desítky zakázek
-- a faktura po jedné zakázce je pro obě strany otrava. Souhrnná faktura kryje
-- víc zakázek najednou – a zakázka se pak nesmí vyfakturovat podruhé, ani
-- souhrnně, ani jednotlivě z detailu zakázky.
--
-- DATOVÝ MODEL: vazební tabulka `invoice_tickets (invoice_id, ticket_id)`.
--   * `invoices.ticket_id` zůstává, jak je. Jednotlivá faktura ho dál nese
--     a všechny dnešní dotazy (mapa „Přejít na fakturu“ v Zakázkách, detail
--     faktury „Přejít na zakázku“, vyúčtování zálohy, e-mail, export do
--     iDokladu/Fakturoidu) fungují beze změny. Souhrnná faktura má
--     `ticket_id = null` – nikdo ji tedy omylem nepovažuje za fakturu jedné
--     zakázky.
--   * Pole `uuid[]` na faktuře by šlo taky, ale unikátnost „zakázka jen na
--     jedné platné faktuře“ nad polem Postgres neumí vynutit indexem a RLS
--     by musela rozbalovat pole. Vazební tabulka má obyčejný částečný
--     unikátní index a politiku „jen k viditelné zakázce“ (MIGRATIONS_SAFETY §5).
--   * Aby pojistka platila i pro jednotlivé faktury, trigger na `invoices`
--     zrcadlí `ticket_id` běžné faktury do `invoice_tickets`. Unikátní index
--     pak hlídá obě cesty najednou: souhrnnou po jednotlivé i naopak.
--
-- STORNO: sloupec `aktivni` = faktura není stornovaná ani smazaná. Trigger
-- ho přepíná při změně stavu / smazání konceptu, takže stornem se zakázky
-- uvolní k nové faktuře a vazba zůstane jako stopa („kryla ji F… – storno“).
-- Unikátní index je jen nad aktivními vazbami.
--
-- Zálohová faktura a dobropis se do vazeb nepromítají: záloha zakázku
-- nevyfakturuje (vyúčtovací faktura po ní ano) a dobropis ticket_id nenese.
--
-- Migrace je idempotentní (if not exists / drop … if exists / on conflict).
-- ============================================================================

-- ── 1) Tabulka ───────────────────────────────────────────────────────────────
create table if not exists public.invoice_tickets (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  -- Konečná cena zakázky (po slevě, jak ji zná zákazník) v době fakturace.
  -- U jednotlivé faktury NULL – tam platí součet faktury.
  castka numeric(12,2),
  -- Faktura není stornovaná ani smazaná. Plní trigger, klient ho neposílá.
  aktivni boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (invoice_id, ticket_id)
);

comment on table public.invoice_tickets is
  'Které zakázky faktura kryje. Souhrnná faktura má řádků víc, jednotlivá jeden (zrcadlí invoices.ticket_id). Aktivní vazba je nanejvýš jedna na zakázku.';
comment on column public.invoice_tickets.aktivni is
  'Faktura není stornovaná ani smazaná. Po stornu false → zakázka jde vyfakturovat znovu, vazba zůstává jako historie.';
comment on column public.invoice_tickets.castka is
  'Konečná cena zakázky po slevě v době fakturace (souhrnná faktura). U jednotlivé faktury NULL.';

-- Zakázka smí být nanejvýš na jedné nestornované faktuře.
create unique index if not exists invoice_tickets_zakazka_jednou
  on public.invoice_tickets (ticket_id)
  where aktivni;

create index if not exists idx_invoice_tickets_service_ticket
  on public.invoice_tickets (service_id, ticket_id);

-- ── 2) Doplnění a kontrola při vložení vazby ─────────────────────────────────
-- service_id a aktivni se berou z faktury, ne od klienta. Kolize se hlásí
-- srozumitelně (číslo dokladu), ne jako „duplicate key value“. Běží jako
-- volající: druhou fakturu uvidí jen ten, kdo ji smí vidět; cizí pobočce
-- zůstane obecná chyba z unikátního indexu.
create or replace function public.invoice_tickets_pred_vlozenim()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_service uuid;
  v_status text;
  v_deleted timestamptz;
  v_cislo text;
begin
  select i.service_id, i.status, i.deleted_at into v_service, v_status, v_deleted
    from public.invoices i where i.id = new.invoice_id;
  if v_service is null then
    raise exception 'Faktura neexistuje.' using errcode = '23503';
  end if;
  new.service_id := v_service;
  new.aktivni := coalesce(v_status, 'draft') <> 'cancelled' and v_deleted is null;

  if new.aktivni then
    select i.number into v_cislo
      from public.invoice_tickets it
      join public.invoices i on i.id = it.invoice_id
     where it.ticket_id = new.ticket_id
       and it.aktivni
       and it.invoice_id <> new.invoice_id
     limit 1;
    if found then
      raise exception 'Zakázka je už vyfakturovaná v dokladu %.', coalesce(nullif(v_cislo, ''), '(koncept)')
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_tickets_pred_vlozenim on public.invoice_tickets;
create trigger trg_invoice_tickets_pred_vlozenim
  before insert on public.invoice_tickets
  for each row execute function public.invoice_tickets_pred_vlozenim();

-- ── 3) Faktura → vazby: zrcadlo ticket_id a uvolnění při stornu ──────────────
-- SECURITY DEFINER: storno musí uvolnit všechny zakázky souhrnné faktury,
-- i ty, které stornující člen (omezený na pobočku) nevidí – jinak by zůstaly
-- zablokované. Funkce sahá jen na vazby téže faktury, kterou volající právě
-- směl změnit (RLS na invoices už prošla). Nová vazba z ticket_id vznikne
-- jen k zakázce stejného servisu na povolené pobočce.
create or replace function public.invoices_vazby_zakazek()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktivni boolean := coalesce(new.status, 'draft') <> 'cancelled' and new.deleted_at is null;
begin
  -- Změna druhu mimo běžnou fakturu (záloha, dobropis) vazby ruší.
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind and coalesce(new.kind, 'invoice') <> 'invoice' then
    delete from public.invoice_tickets where invoice_id = new.id;
  end if;

  -- Jiná zakázka u jednotlivé faktury: stará vazba pryč.
  if tg_op = 'UPDATE' and old.ticket_id is not null and new.ticket_id is distinct from old.ticket_id then
    delete from public.invoice_tickets where invoice_id = new.id and ticket_id = old.ticket_id;
  end if;

  -- Zrcadlo ticket_id běžné faktury. Jen při vzniku nebo skutečné změně –
  -- editor posílá ticket_id při každém uložení a starší duplicitní faktura
  -- (z doby před touhle migrací) by jinak nešla ani upravit.
  if new.ticket_id is not null and coalesce(new.kind, 'invoice') = 'invoice'
     and (tg_op = 'INSERT' or new.ticket_id is distinct from old.ticket_id or new.kind is distinct from old.kind)
     and exists (
       select 1 from public.tickets t
        where t.id = new.ticket_id
          and t.service_id = new.service_id
          and public.pobocka_povolena(t.service_id, t.branch_id)
     ) then
    insert into public.invoice_tickets (invoice_id, ticket_id, service_id)
    values (new.id, new.ticket_id, new.service_id)
    on conflict (invoice_id, ticket_id) do nothing;
  end if;

  -- Storno / smazání konceptu uvolní zakázky, obnovení je zase zablokuje.
  if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at) then
    -- Obnovení stornovaného dokladu, jehož zakázka mezitím dostala jinou fakturu.
    if v_aktivni and exists (
      select 1 from public.invoice_tickets moje
        join public.invoice_tickets jina on jina.ticket_id = moje.ticket_id and jina.aktivni and jina.invoice_id <> moje.invoice_id
       where moje.invoice_id = new.id and not moje.aktivni
    ) then
      raise exception 'Zakázka z tohoto dokladu je mezitím vyfakturovaná jinde – doklad ji už krýt nemůže.'
        using errcode = '23505';
    end if;
    update public.invoice_tickets set aktivni = v_aktivni
     where invoice_id = new.id and aktivni is distinct from v_aktivni;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_invoices_vazby_zakazek on public.invoices;
create trigger trg_invoices_vazby_zakazek
  after insert or update of ticket_id, kind, status, deleted_at on public.invoices
  for each row execute function public.invoices_vazby_zakazek();

revoke all on function public.invoices_vazby_zakazek() from public, anon, authenticated;
revoke all on function public.invoice_tickets_pred_vlozenim() from public, anon;

-- ── 4) Doplnění vazeb ke stávajícím fakturám ─────────────────────────────────
-- Jedna vazba na zakázku: když má zakázka dnes víc nestornovaných faktur
-- (vzniklo to před zavedením pojistky), aktivní je ta nejstarší, ostatní
-- se nepropojí. Stornované a smazané se nepropojují vůbec.
insert into public.invoice_tickets (invoice_id, ticket_id, service_id, aktivni, created_at)
select distinct on (i.ticket_id) i.id, i.ticket_id, i.service_id, true, i.created_at
  from public.invoices i
  join public.tickets t on t.id = i.ticket_id and t.service_id = i.service_id
 where i.ticket_id is not null
   and coalesce(i.kind, 'invoice') = 'invoice'
   and i.status <> 'cancelled'
   and i.deleted_at is null
   and not exists (select 1 from public.invoice_tickets x where x.ticket_id = i.ticket_id and x.aktivni)
 order by i.ticket_id, i.created_at
on conflict do nothing;

-- ── 5) RLS ───────────────────────────────────────────────────────────────────
alter table public.invoice_tickets enable row level security;

revoke all on public.invoice_tickets from anon;
grant select, insert, delete on public.invoice_tickets to authenticated;
revoke update, truncate, references, trigger on public.invoice_tickets from authenticated;
grant all on public.invoice_tickets to service_role;

-- Členství v servisu (stejně jako invoices / invoice_items).
drop policy if exists invoice_tickets_select on public.invoice_tickets;
create policy invoice_tickets_select on public.invoice_tickets
  for select to authenticated
  using (exists (select 1 from public.service_memberships m where m.service_id = invoice_tickets.service_id and m.user_id = auth.uid()));

-- Vložit jde jen k vlastní běžné faktuře, která není stornovaná, a k zakázce
-- téhož servisu. Modul faktur jako u invoices.
drop policy if exists invoice_tickets_insert on public.invoice_tickets;
create policy invoice_tickets_insert on public.invoice_tickets
  for insert to authenticated
  with check (
    exists (select 1 from public.service_memberships m where m.service_id = invoice_tickets.service_id and m.user_id = auth.uid())
    and public.ma_modul(invoice_tickets.service_id, 'invoices')
    and exists (
      select 1 from public.invoices i
       where i.id = invoice_tickets.invoice_id
         and i.service_id = invoice_tickets.service_id
         and coalesce(i.kind, 'invoice') = 'invoice'
         and i.status <> 'cancelled'
         and i.deleted_at is null
    )
    and exists (select 1 from public.tickets t where t.id = invoice_tickets.ticket_id and t.service_id = invoice_tickets.service_id)
  );

-- Mazat vazbu jde jen u konceptu (rozpracovaná souhrnná faktura).
drop policy if exists invoice_tickets_delete on public.invoice_tickets;
create policy invoice_tickets_delete on public.invoice_tickets
  for delete to authenticated
  using (
    exists (select 1 from public.service_memberships m where m.service_id = invoice_tickets.service_id and m.user_id = auth.uid())
    and public.ma_modul(invoice_tickets.service_id, 'invoices')
    and exists (select 1 from public.invoices i where i.id = invoice_tickets.invoice_id and i.status = 'draft')
  );

-- §5: řádek s ticket_id vidí a mění jen ten, kdo vidí zakázku (RLS zakázek,
-- tedy i pobočky, se uplatní v poddotazu) – a zároveň fakturu.
drop policy if exists invoice_tickets_jen_viditelne_zakazky on public.invoice_tickets;
create policy invoice_tickets_jen_viditelne_zakazky on public.invoice_tickets
  as restrictive for select to authenticated
  using (
    exists (select 1 from public.tickets t where t.id = invoice_tickets.ticket_id)
    and exists (select 1 from public.invoices i where i.id = invoice_tickets.invoice_id)
  );

drop policy if exists invoice_tickets_jen_viditelne_zakazky_vlozeni on public.invoice_tickets;
create policy invoice_tickets_jen_viditelne_zakazky_vlozeni on public.invoice_tickets
  as restrictive for insert to authenticated
  with check (
    exists (select 1 from public.tickets t where t.id = invoice_tickets.ticket_id)
    and exists (select 1 from public.invoices i where i.id = invoice_tickets.invoice_id)
  );

drop policy if exists invoice_tickets_jen_viditelne_zakazky_mazani on public.invoice_tickets;
create policy invoice_tickets_jen_viditelne_zakazky_mazani on public.invoice_tickets
  as restrictive for delete to authenticated
  using (
    exists (select 1 from public.tickets t where t.id = invoice_tickets.ticket_id)
    and exists (select 1 from public.invoices i where i.id = invoice_tickets.invoice_id)
  );

-- Hradba přístupu (20260912130000): vypnutý servis nečte, bez „access“ nezapisuje.
drop policy if exists invoice_tickets_jen_zapnuty_servis on public.invoice_tickets;
create policy invoice_tickets_jen_zapnuty_servis on public.invoice_tickets
  as restrictive for select to authenticated
  using (not (service_id = any (public.vypnute_servisy())));

drop policy if exists invoice_tickets_jen_s_pristupem_vlozeni on public.invoice_tickets;
create policy invoice_tickets_jen_s_pristupem_vlozeni on public.invoice_tickets
  as restrictive for insert to authenticated
  with check (service_id = any (public.servisy_kde_smim_pracovat()));

drop policy if exists invoice_tickets_jen_s_pristupem_mazani on public.invoice_tickets;
create policy invoice_tickets_jen_s_pristupem_mazani on public.invoice_tickets
  as restrictive for delete to authenticated
  using (service_id = any (public.servisy_kde_smim_pracovat()));
