-- ============================================================================
-- Záruka na provedenou opravu: do kdy platí, hlídaná při příjmu reklamace
-- ============================================================================
--
-- PROČ: Reklamace existují, ale zakázka nevěděla, do kdy na ni servis ručí.
-- Technik při příjmu reklamace dohledával datum vydání a počítal měsíce
-- z hlavy – a zákazník s opravou po záruce dostal reklamaci zdarma, protože
-- to nikdo nezkontroloval.
--
-- Co se mění:
--   1) repairs.warranty_months – vlastní záruka opravy z ceníku v měsících
--      (null = výchozí servisu, 0 = bez záruky, např. diagnostika).
--   2) tickets.warranty_until – do kdy platí záruka na opravu (včetně).
--      Plní ho trigger při přepnutí do „vydaného“ stavu (stav_je_vydany:
--      koncový, ne storno, ne vráceno bez opravy): datum vydání
--      (completed_at, pražský čas) + nejdelší záruka z provedených oprav.
--      Oprava bez vazby na ceník nebo s warranty_months = null má výchozí
--      záruku servisu; zakázka bez provedených oprav taky. Nejdelší záruka
--      0 = bez záruky (null).
--   3) Výchozí záruka je v service_settings.config (Nastavení → Zakázky →
--      Reklamace): zaruka_opravy_mesice (spotřebitel, výchozí 24)
--      a zaruka_opravy_mesice_firma (zákazník s IČO na zakázce, výchozí 12).
--
-- Pravidla triggeru:
--   * Běží jen při změně stavu (a při vložení), jako completed_at z migrace
--     20260926170000 – na klientovi ani na automatizaci nezáleží.
--   * Volající, který warranty_until ve stejném zápisu nastavil sám (ruční
--     přepis v úpravě zakázky, import), má přednost.
--   * Opakované vydání (Vydáno → oprava → Vydáno) záruku přepočítá od nového
--     data vydání. Přepnutí do storna záruku smaže; návrat do rozpracovaného
--     stavu ji nechá (přepočítá se při dalším vydání).
--   * Jméno trg_tickets_zaruka_opravy řadí trigger (BEFORE triggery běží
--     podle abecedy) ZA trg_tickets_completed_at – datum vydání už je
--     doplněné – a za trg_enforce_* kontroly oprávnění. Sloupec, který
--     doplní trigger, tak nepotřebuje právo „Úpravy zakázek“ navíc
--     k přepnutí stavu. Ruční změna warranty_until z klienta ho potřebuje
--     (enforce_ticket_basic_update_permissions ho nemá mezi volnými).
--
-- Stávající vydané zakázky se zpětně nedopočítávají (každý zápis by udělal
-- řádek v historii zakázky). RLS beze změny, jen sloupce, funkce a trigger.
-- Idempotentní (if not exists / create or replace / drop … if exists).
--
-- Zrcadlo výpočtu pro klienta a testy: src/lib/zarukaOpravy.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sloupce
-- ---------------------------------------------------------------------------
alter table public.repairs
  add column if not exists warranty_months integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'repairs_warranty_months_rozsah'
       and conrelid = 'public.repairs'::regclass
  ) then
    alter table public.repairs
      add constraint repairs_warranty_months_rozsah
      check (warranty_months is null or warranty_months between 0 and 120);
  end if;
end;
$$;

comment on column public.repairs.warranty_months is
  'Záruka na tuto opravu v měsících; null = výchozí záruka servisu (service_settings.config.zaruka_opravy_mesice / _firma), 0 = bez záruky.';

alter table public.tickets
  add column if not exists warranty_until date;

comment on column public.tickets.warranty_until is
  'Záruka na provedenou opravu platí do (včetně). Plní trigger trg_tickets_zaruka_opravy při vydání; ručně přepsatelné v úpravě zakázky. Null = neurčeno / bez záruky.';

-- ---------------------------------------------------------------------------
-- 2) Výpočet při vydání
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: čte nastavení servisu a ceník (RLS na nich by u člena
-- s omezenými právy mohla vrátit nic a záruka by vyšla výchozí) a volá
-- stav_je_vydany, kterou klient spouštět nesmí. Sahá jen na řádky servisu
-- zakázky, kterou volající právě směl změnit.
create or replace function public.tickets_zaruka_opravy_pri_vydani()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := coalesce(nullif(new.status, ''), 'received');
  v_label text;
  v_cfg jsonb;
  v_firma boolean;
  v_klic text;
  v_vychozi integer;
  v_mesice integer;
  v_vydano date;
begin
  if tg_op = 'UPDATE' then
    -- Stav se nemění: nesahat (úprava ceny, poznámky, ruční přepis záruky…).
    if new.status is not distinct from old.status then
      return new;
    end if;
    -- Volající si záruku nastavil sám – má přednost.
    if new.warranty_until is distinct from old.warranty_until then
      return new;
    end if;
  elsif new.warranty_until is not null then
    return new;
  end if;

  select coalesce(s.label, '') into v_label
    from public.service_statuses s
   where s.service_id = new.service_id and s.key = v_status
   limit 1;

  -- Storno: zakázka se nevydala opravená, záruka neplatí.
  if public.stav_je_storno(v_status, v_label) then
    new.warranty_until := null;
    return new;
  end if;

  if not public.stav_je_vydany(new.service_id, v_status, null) then
    return new;
  end if;

  select ss.config into v_cfg
    from public.service_settings ss
   where ss.service_id = new.service_id;

  -- Firma = na zakázce je IČO (bez mezer neprázdné).
  v_firma := nullif(regexp_replace(coalesce(new.customer_ico, ''), '\s', '', 'g'), '') is not null;
  v_klic := case when v_firma then 'zaruka_opravy_mesice_firma' else 'zaruka_opravy_mesice' end;
  v_vychozi := case
    when jsonb_typeof(v_cfg -> v_klic) = 'number'
      then least(120, greatest(0, round((v_cfg ->> v_klic)::numeric)::integer))
    when v_firma then 12
    else 24
  end;

  -- Nejdelší záruka z provedených oprav; oprava mimo ceník (nebo bez vlastní
  -- délky) má výchozí. Porovnává se text, ne uuid: ruční oprava má v repairId
  -- cokoli a přetypování by shodilo celé přepnutí stavu.
  select max(coalesce(r.warranty_months, v_vychozi))
    into v_mesice
    from jsonb_array_elements(
           case when jsonb_typeof(new.performed_repairs) = 'array' then new.performed_repairs else '[]'::jsonb end
         ) o
    left join public.repairs r
      on r.service_id = new.service_id
     and r.id::text = (o ->> 'repairId')
   where nullif(trim(coalesce(o ->> 'name', '')), '') is not null;

  v_mesice := coalesce(v_mesice, v_vychozi);
  if v_mesice <= 0 then
    new.warranty_until := null;
    return new;
  end if;

  v_vydano := (coalesce(new.completed_at, now()) at time zone 'Europe/Prague')::date;
  -- Přičtení měsíců v Postgresu nepřetéká: 31. 1. + 1 měsíc = 28./29. 2.
  new.warranty_until := (v_vydano + make_interval(months => v_mesice))::date;
  return new;
end;
$$;

revoke all on function public.tickets_zaruka_opravy_pri_vydani() from public, anon, authenticated;

comment on function public.tickets_zaruka_opravy_pri_vydani() is
  'Trigger: při přepnutí zakázky do vydaného stavu (stav_je_vydany) zapíše warranty_until = datum vydání + nejdelší záruka z provedených oprav (repairs.warranty_months, jinak výchozí ze service_settings.config). Storno záruku smaže. Ruční hodnota ve stejném zápisu má přednost. Zrcadlo src/lib/zarukaOpravy.ts.';

drop trigger if exists trg_tickets_zaruka_opravy on public.tickets;
create trigger trg_tickets_zaruka_opravy
  before insert or update of status on public.tickets
  for each row execute function public.tickets_zaruka_opravy_pri_vydani();
