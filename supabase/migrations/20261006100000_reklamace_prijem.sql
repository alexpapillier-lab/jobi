-- Reklamace: plný příjem (jako u zakázky) a převod reklamace na zakázku.
--
-- 1) Nové sloupce reklamace (všechny s výchozí hodnotou nebo nullable, viz
--    §1 docs/MIGRATIONS_SAFETY.md):
--    - claimed_repairs   – které opravy zdrojové zakázky zákazník reklamuje
--                          (pole {id, name, price?} z tickets.performed_repairs)
--    - intake_photos     – přijímací fotky reklamace (odkazy do bucketu
--                          diagnostic-photos, cesta <service_id>/<claim_id>/…
--                          nebo <service_id>/draft/… z focení přes QR)
--    - handoff_method    – způsob převzetí (Osobně, Poštou…)
--    - converted_ticket_id, converted_at – reklamace se ukázala jako
--                          obyčejná oprava a převedla se na zakázku
-- 2) Převod jde jen jednou: odkaz na zakázku se po nastavení nedá přepsat
--    jinou zakázkou a zakázka musí patřit stejnému servisu. Smazání zakázky
--    (on delete set null) projde.
-- 3) Historie: reklamace zapíše „converted_to_ticket“ (trigger), zakázka
--    „created_from_warranty_claim“ (zapisuje aplikace).
-- 4) Anonymizace: převedená reklamace už není „otevřená“ – stav
--    `prevedeno_na_zakazku` není v service_statuses (je to systémový stav
--    reklamace), takže by jinak zákazníka chránila před anonymizací navždy.
--
-- RLS: žádná nová tabulka ani politika. Zápis do warranty_claims dál hlídají
-- politiky z 20260909210000 (can_manage_tickets_basic) a hradba přístupu.
-- Migrace je idempotentní (if not exists / create or replace / drop … if exists).

-- ── 1. Sloupce ──────────────────────────────────────────────────────────────
alter table public.warranty_claims
  add column if not exists claimed_repairs jsonb not null default '[]'::jsonb,
  add column if not exists intake_photos jsonb not null default '[]'::jsonb,
  add column if not exists handoff_method text,
  add column if not exists converted_ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists converted_at timestamptz;

comment on column public.warranty_claims.claimed_repairs is
  'Reklamované opravy zdrojové zakázky: [{id, name, price?}] (kopie z tickets.performed_repairs v okamžiku příjmu)';
comment on column public.warranty_claims.intake_photos is
  'Přijímací fotky reklamace – odkazy do bucketu diagnostic-photos (jako tickets.diagnostic_photos_before)';
comment on column public.warranty_claims.handoff_method is 'Způsob převzetí zařízení při příjmu reklamace';
comment on column public.warranty_claims.converted_ticket_id is
  'Zakázka, na kterou se reklamace převedla („Není to reklamace“); null = nepřevedená';
comment on column public.warranty_claims.converted_at is 'Kdy se reklamace převedla na zakázku';

create index if not exists idx_warranty_claims_converted_ticket_id
  on public.warranty_claims(converted_ticket_id) where converted_ticket_id is not null;

-- Jedna zakázka vznikne nejvýš z jedné reklamace.
create unique index if not exists warranty_claims_converted_ticket_unikatni
  on public.warranty_claims(converted_ticket_id) where converted_ticket_id is not null;

-- ── 2. Převod jen jednou a jen na zakázku stejného servisu ──────────────────
create or replace function public.reklamace_prevod_hlidac()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.converted_ticket_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.converted_ticket_id is not null then
    if new.converted_ticket_id is distinct from old.converted_ticket_id then
      raise exception 'Reklamace už je převedená na jinou zakázku.' using errcode = '23514';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.tickets t
    where t.id = new.converted_ticket_id and t.service_id = new.service_id
  ) then
    raise exception 'Zakázka převodu nepatří k servisu reklamace.' using errcode = '23514';
  end if;
  if new.converted_at is null then
    new.converted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_warranty_claims_prevod_hlidac on public.warranty_claims;
create trigger trg_warranty_claims_prevod_hlidac
  before insert or update of converted_ticket_id on public.warranty_claims
  for each row
  execute function public.reklamace_prevod_hlidac();

-- ── 3. Historie ─────────────────────────────────────────────────────────────
-- Kontrola vznikla v create table bez jména; pro jistotu se shodí každá
-- kontrola nad sloupcem action (stejně jako v 20260222000000 u ticket_history).
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attnum = any(c.conkey) and a.attrelid = c.conrelid
    where c.conrelid = 'public.warranty_claim_history'::regclass
      and c.contype = 'c'
      and a.attname = 'action'
  loop
    execute format('alter table public.warranty_claim_history drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.warranty_claim_history
  add constraint warranty_claim_history_action_check
  check (action in ('created', 'status_changed', 'updated', 'converted_to_ticket'));

alter table public.ticket_history drop constraint if exists ticket_history_action_check;
alter table public.ticket_history
  add constraint ticket_history_action_check
  check (action in ('created', 'updated', 'deleted', 'restored', 'warranty_claim_created', 'cancel_reason', 'created_from_warranty_claim'));

comment on column public.ticket_history.action is
  'created, updated, deleted, restored, warranty_claim_created (založena reklamace), cancel_reason (důvod storna z dialogu při změně stavu), created_from_warranty_claim (zakázka vznikla převodem reklamace)';

-- Stejný trigger jako v 20260222000000, navíc záznam o převodu na zakázku.
create or replace function public.warranty_claim_history_log()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action text;
  v_details jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_details := jsonb_build_object('status', new.status, 'code', new.code);
    insert into public.warranty_claim_history (warranty_claim_id, service_id, action, changed_by, details)
    values (new.id, new.service_id, v_action, auth.uid(), v_details);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.converted_ticket_id is null and new.converted_ticket_id is not null then
      v_action := 'converted_to_ticket';
      v_details := jsonb_build_object(
        'ticket_id', new.converted_ticket_id,
        'ticket_code', (select t.code from public.tickets t where t.id = new.converted_ticket_id),
        'status_old', old.status,
        'status_new', new.status
      );
    elsif old.status is distinct from new.status then
      v_action := 'status_changed';
      v_details := jsonb_build_object('status_old', old.status, 'status_new', new.status);
    else
      v_action := 'updated';
      v_details := '{}'::jsonb;
    end if;
    insert into public.warranty_claim_history (warranty_claim_id, service_id, action, changed_by, details)
    values (new.id, new.service_id, v_action, auth.uid(), v_details);
    return new;
  end if;
  return null;
end;
$$;

-- ── 4. Anonymizace: převedená reklamace není otevřená ───────────────────────
-- Beze změny proti 20260927120000 kromě sloupce `otevrena` v CTE `rekl`.
create or replace function public.anonymizace_kandidati(p_service_id uuid, p_hranice timestamptz)
returns table (druh text, id uuid, jmeno text, kod text, posledni timestamptz, zakazek integer)
language sql
stable
security definer
set search_path = public
as $$
  with koncove as (
    select st.key from public.service_statuses st
    where st.service_id = p_service_id and st.is_final
  ),
  zak as (
    select
      t.id,
      t.customer_id,
      greatest(t.created_at, t.completed_at) as posledni,
      -- Nesmazaná a ne v koncovém stavu = otevřená. Neznámý stav je otevřená (opatrně).
      (t.deleted_at is null
        and coalesce(nullif(t.status, ''), 'received') not in (select k.key from koncove k)) as otevrena
    from public.tickets t
    where t.service_id = p_service_id
  ),
  rekl as (
    select
      coalesce(w.customer_id, z.customer_id) as customer_id,
      w.source_ticket_id,
      greatest(w.created_at, w.received_at, w.released_at, w.completed_at) as posledni,
      -- Převedená reklamace je uzavřená; dál žije jako zakázka (ta se počítá sama).
      (w.converted_ticket_id is null
        and coalesce(nullif(w.status, ''), 'received') not in (select k.key from koncove k)) as otevrena
    from public.warranty_claims w
    left join zak z on z.id = w.source_ticket_id
    where w.service_id = p_service_id
  ),
  fakt as (
    select
      coalesce(i.customer_id, z.customer_id) as customer_id,
      i.ticket_id,
      i.issue_date::timestamptz as posledni,
      (i.deleted_at is null and i.paid_at is null and i.status in ('issued', 'sent', 'overdue')) as nezaplacena
    from public.invoices i
    left join zak z on z.id = i.ticket_id
    where i.service_id = p_service_id
  ),
  aktivita as (
    select a.customer_id, max(a.posledni) as posledni, bool_or(a.otevrena) as otevrena, bool_or(a.nezaplacena) as nezaplacena
    from (
      select z.customer_id, z.posledni, z.otevrena, false as nezaplacena from zak z where z.customer_id is not null
      union all
      select r.customer_id, r.posledni, r.otevrena, false from rekl r where r.customer_id is not null
      union all
      select f.customer_id, f.posledni, false, f.nezaplacena from fakt f where f.customer_id is not null
    ) a
    group by a.customer_id
  ),
  pocty as (
    select z.customer_id, count(*)::integer as pocet from zak z where z.customer_id is not null group by z.customer_id
  )
  select 'zakaznik'::text, c.id, c.name, null::text, coalesce(a.posledni, c.created_at), coalesce(p.pocet, 0)
  from public.customers c
  left join aktivita a on a.customer_id = c.id
  left join pocty p on p.customer_id = c.id
  where c.service_id = p_service_id
    and c.anonymized_at is null
    and not coalesce(a.otevrena, false)
    and not coalesce(a.nezaplacena, false)
    -- Bez zakázek, reklamací a faktur rozhoduje založení karty.
    and coalesce(a.posledni, c.created_at) < p_hranice

  union all

  -- Zakázky bez karty zákazníka: každá sama za sebe.
  select 'zakazka'::text, t.id, t.customer_name, t.code, z.posledni, 1
  from public.tickets t
  join zak z on z.id = t.id
  where t.service_id = p_service_id
    and t.customer_id is null
    and not z.otevrena
    and z.posledni < p_hranice
    and not exists (select 1 from fakt f where f.ticket_id = t.id and f.nezaplacena)
    and not exists (select 1 from rekl r where r.source_ticket_id = t.id and (r.otevrena or r.posledni >= p_hranice))
    -- Je na ní ještě co anonymizovat?
    and (
      (t.customer_name is not null and t.customer_name not like 'Anonymizovaný zákazník%')
      or t.customer_phone is not null or t.customer_email is not null
      or t.customer_address_street is not null or t.customer_address_city is not null
      or t.customer_address_zip is not null or t.customer_info is not null
      or t.device_passcode is not null or t.intake_signature_url is not null
      or t.portal_token is not null or t.quote_decision_meta is not null
      or (t.diagnostic_photos is not null and t.diagnostic_photos not in ('[]'::jsonb, 'null'::jsonb))
      or (t.diagnostic_photos_before is not null and t.diagnostic_photos_before not in ('[]'::jsonb, 'null'::jsonb))
    );
$$;
revoke all on function public.anonymizace_kandidati(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.anonymizace_kandidati(uuid, timestamptz) to service_role;
