-- ============================================================================
-- Statistiky: peníze podle data vydání, počty podle data přijetí
-- ============================================================================
--
-- PROČ: Statistiky brály do období zakázky podle data přijetí a sčítaly
-- jejich AKTUÁLNÍ cenu. Zakázka přijatá 10. 9., naceněná a vydaná 25. 10.,
-- tak zvedla obrat září – zpětně. Obrat uzavřeného měsíce se měnil ještě
-- týdny potom, neseděl s pokladnou ani s fakturami a rozepsané zakázky
-- s cenou v něm visely, i když za ně nikdo nezaplatil. Zakázkový list,
-- ze kterého servis přešel, počítá peníze podle data vydání – a přesně
-- o ten rozdíl se obě aplikace rozcházely (ověřeno na 927 zakázkách za rok:
-- podle vydání sedí na korunu).
--
-- Co se mění:
--   1) OBRAT, NÁKLADY, SLEVY, ZISK, MARŽE, průměrná cena a žebříčky marží se
--      počítají ze zakázek VYDANÝCH v období: koncový stav
--      (service_statuses.is_final) a datum přepnutí do něj (completed_at)
--      v období. Storno do peněz nepatří dál. Číslo za uzavřený měsíc se
--      už nemění.
--   2) POČET ZAKÁZEK, stavy a nejčastější zařízení jsou zakázky PŘIJATÉ
--      v období (created_at) – vytížení a poptávka, ne peníze.
--   3) Nově ROZPRACOVÁNO: zakázky v nekoncovém stavu bez ohledu na období,
--      s počtem a tím, co je na nich naceněno. Sem se schová právě zakázka
--      přijatá v období, která cenu dostane až později.
--   4) Průměrná doba zakázky se počítá ze zakázek UZAVŘENÝCH v období
--      (včetně storna – ta zakázka tu opravdu ležela), ne přijatých.
--   5) completed_at plní trigger při každém přepnutí do koncového stavu.
--      Dosud ho nastavovalo jen RPC change_ticket_status; automatizace
--      (akce „nastavit stav“) a zápis přes API měnily jen stav a zakázka
--      by v penězích nebyla vůbec. Volající, který si completed_at nastaví
--      sám (import historie), má přednost.
--
-- Migrace nemění žádná data; jen trigger a funkce statistiky_prehled
-- (tělo z 20260915100000 včetně kontroly práva „vidět statistiky“).
-- Stejná pravidla musí mít záložní výpočet v prohlížeči
-- (src/pages/Statistics.tsx, src/pages/Statistics/kpi.ts) a e-mailový
-- report (supabase/functions/statistics-report-send).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) completed_at při přepnutí do koncového stavu – jedno místo pro všechny cesty
-- ---------------------------------------------------------------------------
create or replace function public.tickets_completed_at_z_koncoveho_stavu()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_final boolean;
begin
  if tg_op = 'UPDATE' then
    -- Stav se nemění: nesahat (úprava ceny, poznámky, přesun pobočky…).
    if new.status is not distinct from old.status then
      return new;
    end if;
    -- Volající si datum nastavil sám (RPC change_ticket_status, import) – má přednost.
    if new.completed_at is distinct from old.completed_at then
      return new;
    end if;
  elsif new.completed_at is not null then
    return new;
  end if;

  select coalesce(s.is_final, false) into v_final
  from public.service_statuses s
  where s.service_id = new.service_id
    and s.key = coalesce(nullif(new.status, ''), 'received')
  limit 1;

  if coalesce(v_final, false) then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

comment on function public.tickets_completed_at_z_koncoveho_stavu() is
  'Trigger: při přepnutí zakázky do koncového stavu (service_statuses.is_final) doplní completed_at = now(), pokud ho volající nenastavil sám. Datum vydání pro Statistiky.';

drop trigger if exists trg_tickets_completed_at on public.tickets;
create trigger trg_tickets_completed_at
  before insert or update of status on public.tickets
  for each row execute function public.tickets_completed_at_z_koncoveho_stavu();

-- ---------------------------------------------------------------------------
-- 2) Přehled: peníze podle vydání, počty podle přijetí, rozpracováno zvlášť
-- ---------------------------------------------------------------------------
create or replace function public.statistiky_prehled(
  p_service_ids uuid[],
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_branch_id uuid default null,
  p_drill_typ text default null,
  p_drill_hodnota text default null,
  p_drill_rok integer default null,
  p_drill_mesic integer default null,
  p_prev_od timestamptz default null,
  p_prev_do timestamptz default null,
  p_tz text default 'Europe/Prague'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vysledek jsonb;
  v_tz text;
  v_drill text := coalesce(p_drill_typ, '');
  v_pobocky uuid[];
  -- Tvar UUID; v JSONu položek jsou jen texty a špatný zápis by shodil přetypování.
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Chybí servis.' using errcode = '22023';
  end if;

  -- Právo se kontroluje ručně: funkce je security definer, obchází RLS a
  -- nesmí prozradit čísla ze servisu, do kterého volající nepatří.
  -- Členství i právo „vidět statistiky“ hlídá overit_pristup_ke_statistikam
  -- (migrace 20260915100000). Edge funkce statistics-report-send (e-mailový
  -- report) volá pod service_role bez uživatele – tam se nekontroluje nic,
  -- servis si vybírá funkce sama podle nastavení reportu.
  if auth.role() is distinct from 'service_role' then
    perform public.overit_pristup_ke_statistikam(p_service_ids);
  end if;

  -- Pobočky, na které se smí dívat: omezený člen jen své (i když si řekne
  -- o všechny nebo o cizí), ostatní podle zvolené pobočky. NULL = bez filtru.
  v_pobocky := public.povolene_pobocky(p_service_ids);
  if v_pobocky is not null then
    if p_branch_id is not null then
      v_pobocky := case when p_branch_id = any(v_pobocky) then array[p_branch_id]
                        else array['00000000-0000-0000-0000-000000000000'::uuid] end;
    end if;
  elsif p_branch_id is not null then
    v_pobocky := array[p_branch_id];
  end if;

  -- Neznámé pásmo by shodilo celý dotaz; radši spočítat měsíce v našem čase.
  v_tz := case
    when p_tz is not null and exists (select 1 from pg_timezone_names n where n.name = p_tz) then p_tz
    else 'Europe/Prague'
  end;

  with zakazky_vse as (
    select
      t.id,
      t.service_id,
      t.branch_id,
      t.created_at,
      -- Stejné náhrady jako mapování v Orders.tsx: prázdný stav je „received“,
      -- prázdný název zařízení „Nová zakázka“.
      coalesce(nullif(t.status, ''), 'received') as stav,
      coalesce(nullif(t.title, ''), 'Nová zakázka') as zarizeni,
      t.discount_type,
      coalesce(t.discount_value, 0) as sleva_hodnota,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy,
      -- Stornovaná zakázka do peněz nevstupuje vůbec; do počtů ano.
      public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label) as storno,
      coalesce(st.is_final, false) as koncovy,
      -- Datum vydání = přepnutí do koncového stavu. Řádek přepnutý mimo
      -- aplikaci před triggerem výš ho nemá – pak poslední změna, ať zakázka
      -- z peněz nevypadne úplně.
      case when coalesce(st.is_final, false) then coalesce(t.completed_at, t.updated_at) end as vydano_at,
      ((p_od is null or t.created_at >= p_od) and (p_do is null or t.created_at <= p_do)) as prijato_akt,
      (p_prev_od is not null and p_prev_do is not null and t.created_at >= p_prev_od and t.created_at <= p_prev_do) as prijato_pred
    from public.tickets t
    left join public.service_statuses st
      on st.service_id = t.service_id and st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      -- Pobočka z lišty: zakázky bez pobočky vidí každá pobočka (shodně s filterByBranch).
      and (v_pobocky is null or t.branch_id is null or t.branch_id = any(v_pobocky))
  ),
  zakazky as (
    select
      z.*,
      -- Peníze: koncový stav, ne storno, vydáno v období.
      (z.koncovy and not z.storno and z.vydano_at is not null
        and (p_od is null or z.vydano_at >= p_od) and (p_do is null or z.vydano_at <= p_do)) as vydano_akt,
      (z.koncovy and not z.storno and z.vydano_at is not null
        and p_prev_od is not null and p_prev_do is not null and z.vydano_at >= p_prev_od and z.vydano_at <= p_prev_do) as vydano_pred,
      -- Doba zakázky: uzavřené v období včetně storna – ta zakázka tu ležela.
      (z.koncovy and z.vydano_at is not null
        and (p_od is null or z.vydano_at >= p_od) and (p_do is null or z.vydano_at <= p_do)) as uzavreno_akt,
      (z.koncovy and z.vydano_at is not null
        and p_prev_od is not null and p_prev_do is not null and z.vydano_at >= p_prev_od and z.vydano_at <= p_prev_do) as uzavreno_pred,
      -- Rozpracováno: otevřená zakázka bez ohledu na období.
      (not z.koncovy and not z.storno) as rozpracovana
    from zakazky_vse z
    where z.prijato_akt or z.prijato_pred
       or (z.koncovy and z.vydano_at is not null and (
            ((p_od is null or z.vydano_at >= p_od) and (p_do is null or z.vydano_at <= p_do))
            or (p_prev_od is not null and p_prev_do is not null and z.vydano_at >= p_prev_od and z.vydano_at <= p_prev_do)))
       or (not z.koncovy and not z.storno)
  ),
  polozky as (
    select
      z.id as zakazka_id,
      e.ord,
      coalesce(e.polozka ->> 'name', '') as nazev,
      case when jsonb_typeof(e.polozka -> 'price') = 'number' then (e.polozka ->> 'price')::numeric else 0 end as prijem,
      case when jsonb_typeof(e.polozka -> 'costs') = 'number' then (e.polozka ->> 'costs')::numeric end as vlastni_naklad,
      case when (e.polozka ->> 'repairId') ~* c_uuid then (e.polozka ->> 'repairId')::uuid end as repair_id,
      case when jsonb_typeof(e.polozka -> 'productIds') = 'array' then e.polozka -> 'productIds' end as vlastni_dily
    from zakazky z
    cross join lateral jsonb_array_elements(z.opravy) with ordinality e(polozka, ord)
  ),
  polozky_cenik as (
    select
      p.zakazka_id,
      p.ord,
      p.nazev,
      p.prijem,
      p.repair_id,
      -- Vlastní náklad má přednost před ceníkem; teprve když není ani jeden,
      -- zůstane null a položka se počítá jako „bez nákladů“.
      coalesce(p.vlastni_naklad, r.costs) as naklad_prace,
      coalesce(
        p.vlastni_dily,
        case when jsonb_typeof(r.product_ids) = 'array' and jsonb_array_length(r.product_ids) > 0 then r.product_ids end,
        '[]'::jsonb
      ) as dily
    from polozky p
    left join public.repairs r on r.id = p.repair_id and r.service_id = any(p_service_ids)
  ),
  dily as (
    select
      pc.zakazka_id,
      pc.ord,
      coalesce(sum(ip.purchase_price), 0) as cena_dilu,
      count(ip.id) as dilu_s_cenou,
      count(*) - count(ip.id) as dilu_bez_ceny
    from polozky_cenik pc
    cross join lateral jsonb_array_elements_text(pc.dily) d(pid)
    left join public.inventory_products ip
      on ip.id = (case when d.pid ~* c_uuid then d.pid::uuid end)
     and ip.service_id = any(p_service_ids)
     and ip.purchase_price is not null
    group by pc.zakazka_id, pc.ord
  ),
  polozky_vysledek as (
    select
      pc.zakazka_id,
      pc.ord,
      pc.nazev,
      pc.repair_id,
      pc.prijem,
      coalesce(pc.naklad_prace, 0) + coalesce(d.cena_dilu, 0) as naklad,
      (pc.naklad_prace is not null or coalesce(d.dilu_s_cenou, 0) > 0) as ma_zdroj_nakladu,
      coalesce(d.dilu_bez_ceny, 0) > 0 as chybi_nakupni_cena
    from polozky_cenik pc
    left join dily d on d.zakazka_id = pc.zakazka_id and d.ord = pc.ord
  ),
  zakazky_soucty as (
    select
      z.id,
      z.service_id,
      z.branch_id,
      z.created_at,
      z.vydano_at,
      z.stav,
      z.zarizeni,
      z.storno,
      z.koncovy,
      z.prijato_akt,
      z.prijato_pred,
      z.vydano_akt,
      z.vydano_pred,
      z.uzavreno_akt,
      z.uzavreno_pred,
      z.rozpracovana,
      z.discount_type,
      z.sleva_hodnota,
      coalesce(sum(pv.prijem), 0) as hruby,
      coalesce(sum(pv.naklad), 0) as naklad,
      count(pv.ord) as polozek,
      count(*) filter (where pv.ord is not null and not pv.ma_zdroj_nakladu) as bez_nakladu,
      count(*) filter (where pv.chybi_nakupni_cena) as bez_ceny_dilu
    from zakazky z
    left join polozky_vysledek pv on pv.zakazka_id = z.id
    group by z.id, z.service_id, z.branch_id, z.created_at, z.vydano_at,
             z.stav, z.zarizeni, z.storno, z.koncovy,
             z.prijato_akt, z.prijato_pred, z.vydano_akt, z.vydano_pred,
             z.uzavreno_akt, z.uzavreno_pred, z.rozpracovana,
             z.discount_type, z.sleva_hodnota
  ),
  zakazky_drill as (
    select
      zs.id,
      zs.service_id,
      zs.branch_id,
      zs.created_at,
      zs.vydano_at,
      zs.stav,
      zs.zarizeni,
      zs.storno,
      zs.koncovy,
      zs.prijato_akt,
      zs.prijato_pred,
      zs.vydano_akt,
      zs.vydano_pred,
      zs.uzavreno_akt,
      zs.uzavreno_pred,
      zs.rozpracovana,
      zs.polozek,
      -- Stornovaná zakázka: nula ve všech penězích i v počítadlech chybějících
      -- nákladů. Přesně to vrací `ticketMargin(..., jeStorno = true)`.
      case when zs.storno then 0 else zs.hruby end as hruby,
      case when zs.storno then 0 else zs.naklad end as naklad,
      case when zs.storno then 0 else zs.bez_nakladu end as bez_nakladu,
      case when zs.storno then 0 else zs.bez_ceny_dilu end as bez_ceny_dilu,
      case when zs.storno then 0 else s.sleva end as sleva,
      case when zs.storno then 0 else greatest(0, zs.hruby - s.sleva) end as prijem,
      case when zs.storno then 0 else greatest(0, zs.hruby - s.sleva) - zs.naklad end as marze,
      extract(year from zs.created_at at time zone v_tz)::int as rok_prijeti,
      extract(month from zs.created_at at time zone v_tz)::int - 1 as mesic_prijeti,
      extract(year from zs.vydano_at at time zone v_tz)::int as rok_vydani,
      extract(month from zs.vydano_at at time zone v_tz)::int - 1 as mesic_vydani,
      -- Zúžení kliknutím: měsíc se u počtů bere podle přijetí, u peněz podle
      -- vydání – proto dva příznaky. Stav, zařízení a oprava jsou pro oba stejné.
      case
        when v_drill = '' then true
        when v_drill = 'status' then zs.stav = p_drill_hodnota
        when v_drill = 'device' then zs.zarizeni = p_drill_hodnota
        when v_drill = 'month' then extract(year from zs.created_at at time zone v_tz)::int = p_drill_rok
                                and extract(month from zs.created_at at time zone v_tz)::int - 1 = p_drill_mesic
        when v_drill = 'repair' then exists (
          select 1 from polozky_vysledek pv where pv.zakazka_id = zs.id and pv.nazev = p_drill_hodnota
        )
        else true
      end as ve_vyberu_p,
      case
        when v_drill = '' then true
        when v_drill = 'status' then zs.stav = p_drill_hodnota
        when v_drill = 'device' then zs.zarizeni = p_drill_hodnota
        when v_drill = 'month' then zs.vydano_at is not null
                                and extract(year from zs.vydano_at at time zone v_tz)::int = p_drill_rok
                                and extract(month from zs.vydano_at at time zone v_tz)::int - 1 = p_drill_mesic
        when v_drill = 'repair' then exists (
          select 1 from polozky_vysledek pv where pv.zakazka_id = zs.id and pv.nazev = p_drill_hodnota
        )
        else true
      end as ve_vyberu_v
    from zakazky_soucty zs
    cross join lateral (
      select least(
        greatest(0, case
          when zs.discount_type = 'percentage' then zs.hruby * zs.sleva_hodnota / 100
          when zs.discount_type = 'amount' then zs.sleva_hodnota
          else 0
        end),
        -- Sleva nikdy nepřesáhne hrubou cenu – stejně jako `castkaSlevy`
        -- v aplikaci. Bez toho vyjde záporná marže i „sleva“ vyšší, než co
        -- kdy zákazník platil.
        zs.hruby
      ) as sleva
    ) s
  ),
  -- Klíčová čísla: počty z přijatých, peníze z vydaných. Aktuální výběr se
  -- zužuje drill-downem, předchozí období ne (porovnává se celé).
  kpi_skupiny as (
    select
      true as akt,
      count(*) filter (where prijato_akt and ve_vyberu_p) as pocet,
      count(*) filter (where vydano_akt and ve_vyberu_v) as vydano,
      sum(prijem) filter (where vydano_akt and ve_vyberu_v) as prijem,
      sum(naklad) filter (where vydano_akt and ve_vyberu_v) as naklad,
      sum(sleva) filter (where vydano_akt and ve_vyberu_v) as sleva,
      sum(marze) filter (where vydano_akt and ve_vyberu_v) as marze,
      sum(bez_nakladu) filter (where vydano_akt and ve_vyberu_v) as bez_nakladu,
      sum(bez_ceny_dilu) filter (where vydano_akt and ve_vyberu_v) as bez_ceny_dilu,
      count(*) filter (where vydano_akt and ve_vyberu_v and prijem > 0) as placenych,
      avg(extract(epoch from (vydano_at - created_at)) / 86400.0)
        filter (where uzavreno_akt and ve_vyberu_v and vydano_at > created_at) as doba
    from zakazky_drill
    union all
    select
      false,
      count(*) filter (where prijato_pred),
      count(*) filter (where vydano_pred),
      sum(prijem) filter (where vydano_pred),
      sum(naklad) filter (where vydano_pred),
      sum(sleva) filter (where vydano_pred),
      sum(marze) filter (where vydano_pred),
      sum(bez_nakladu) filter (where vydano_pred),
      sum(bez_ceny_dilu) filter (where vydano_pred),
      count(*) filter (where vydano_pred and prijem > 0),
      avg(extract(epoch from (vydano_at - created_at)) / 86400.0)
        filter (where uzavreno_pred and vydano_at > created_at)
    from zakazky_drill
  ),
  -- Zaokrouhlení není kosmetika: podíl dvou numericů má v Postgresu i dvacet
  -- desetinných míst a odpověď by kvůli nim byla o desítky kilobajtů delší.
  kpi as (
    select
      akt,
      jsonb_build_object(
        'totalTickets', pocet,
        'issuedTickets', vydano,
        'totalRevenue', round(coalesce(prijem, 0), 2),
        'totalCosts', round(coalesce(naklad, 0), 2),
        'totalDiscounts', round(coalesce(sleva, 0), 2),
        'profit', round(coalesce(marze, 0), 2),
        'marginPct', round((case when coalesce(prijem, 0) > 0 then coalesce(marze, 0) / prijem * 100 else 0 end)::numeric, 4),
        'entriesWithoutCost', coalesce(bez_nakladu, 0),
        'entriesMissingPurchasePrice', coalesce(bez_ceny_dilu, 0),
        'averageTicketPrice', round((case when placenych > 0 then coalesce(prijem, 0) / placenych else 0 end)::numeric, 2),
        'averageTicketDurationDays', round(coalesce(doba, 0)::numeric, 4)
      ) as data
    from kpi_skupiny
  ),
  prazdne_kpi as (
    select jsonb_build_object(
      'totalTickets', 0, 'issuedTickets', 0, 'totalRevenue', 0, 'totalCosts', 0, 'totalDiscounts', 0,
      'profit', 0, 'marginPct', 0, 'entriesWithoutCost', 0, 'entriesMissingPurchasePrice', 0,
      'averageTicketPrice', 0, 'averageTicketDurationDays', 0
    ) as data
  ),
  -- Rozpracováno: otevřené zakázky (nekoncový stav) bez ohledu na období;
  -- drill-down podle stavu, zařízení, opravy nebo měsíce přijetí platí i tady.
  rozpracovano as (
    select
      count(*) as pocet,
      count(*) filter (where hruby > 0) as nacenenych,
      coalesce(sum(prijem), 0) as prijem,
      coalesce(sum(naklad), 0) as naklad
    from zakazky_drill
    where rozpracovana and ve_vyberu_p
  )
  select jsonb_build_object(
    'kpi', coalesce((select data from kpi where akt), (select data from prazdne_kpi)),
    'kpiPredchozi', coalesce((select data from kpi where not akt), (select data from prazdne_kpi)),
    'pocetVObdobi', (select count(*) from zakazky_drill where prijato_akt),
    'pocetVeVyberu', (select count(*) from zakazky_drill where prijato_akt and ve_vyberu_p),
    'pocetPredchozi', (select count(*) from zakazky_drill where prijato_pred),
    'vydanoVObdobi', (select count(*) from zakazky_drill where vydano_akt),
    'vydanoVeVyberu', (select count(*) from zakazky_drill where vydano_akt and ve_vyberu_v),
    'vydanoPredchozi', (select count(*) from zakazky_drill where vydano_pred),
    'rozpracovano', (
      select jsonb_build_object(
        'pocet', r.pocet, 'nacenenych', r.nacenenych,
        'prijem', round(r.prijem, 2), 'naklad', round(r.naklad, 2)
      ) from rozpracovano r
    ),

    -- Stavy: co v období přišlo (přijaté), ať je vidět i to, co ještě běží.
    'stavy', (
      select coalesce(jsonb_agg(jsonb_build_object('key', x.stav, 'count', x.pocet) order by x.pocet desc, x.stav), '[]'::jsonb)
      from (
        select stav, count(*) as pocet
        from zakazky_drill
        where prijato_akt and (v_drill = 'status' or ve_vyberu_p)
        group by stav
      ) x
    ),

    -- Nejčastější opravy: provedené = na zakázkách vydaných v období.
    'topOpravy', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.nazev, 'count', x.pocet) order by x.pocet desc, x.nazev), '[]'::jsonb)
      from (
        select pv.nazev, count(*) as pocet
        from polozky_vysledek pv
        join zakazky_drill zd on zd.id = pv.zakazka_id
        where zd.vydano_akt and (v_drill = 'repair' or zd.ve_vyberu_v)
        group by pv.nazev
        order by count(*) desc, pv.nazev
        limit 5
      ) x
    ),

    -- Nejčastější zařízení: co v období přišlo.
    'topZarizeni', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.zarizeni, 'count', x.pocet) order by x.pocet desc, x.zarizeni), '[]'::jsonb)
      from (
        select zarizeni, count(*) as pocet
        from zakazky_drill
        where prijato_akt and (v_drill = 'device' or ve_vyberu_p)
        group by zarizeni
        order by count(*) desc, zarizeni
        limit 5
      ) x
    ),

    -- Marže podle oprav se počítá z položek, ne ze zakázek: sleva zakázky se
    -- mezi opravy rozdělit nedá, proto v ní není (stejně jako v prohlížeči).
    -- Jen vydané zakázky – storno tam tedy není vůbec.
    'marzeOpravy', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.klic, 'name', x.nazev, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.prijem - x.naklad, 2),
        'marginPct', round((case when x.prijem > 0 then (x.prijem - x.naklad) / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.prijem - x.naklad desc, x.pocet desc), '[]'::jsonb)
      from (
        select
          case when pv.repair_id is not null then 'id:' || pv.repair_id::text else 'name:' || pv.nazev end as klic,
          -- Ceníková oprava se mohla přejmenovat: platí název z nejnovější zakázky.
          (array_agg(pv.nazev order by zd.vydano_at desc, zd.id))[1] as nazev,
          count(*) as pocet,
          coalesce(sum(pv.prijem), 0) as prijem,
          coalesce(sum(pv.naklad), 0) as naklad,
          count(*) filter (where pv.ma_zdroj_nakladu) as se_zdrojem
        from polozky_vysledek pv
        join zakazky_drill zd on zd.id = pv.zakazka_id
        where zd.vydano_akt and (v_drill = 'repair' or zd.ve_vyberu_v)
        group by 1
      ) x
    ),

    'marzeZarizeni', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.zarizeni, 'name', x.zarizeni, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.marze, 2),
        'marginPct', round((case when x.prijem > 0 then x.marze / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.marze desc, x.pocet desc), '[]'::jsonb)
      from (
        select
          zarizeni,
          count(*) as pocet,
          sum(prijem) as prijem,
          sum(naklad) as naklad,
          sum(marze) as marze,
          count(*) filter (where polozek - bez_nakladu > 0) as se_zdrojem
        from zakazky_drill
        where vydano_akt and (v_drill = 'device' or ve_vyberu_v)
        group by zarizeni
      ) x
    ),

    -- Pobočky a servisy vedle sebe: název doplní stránka, tady jde jen o čísla.
    'marzePobocky', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.klic, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.marze, 2),
        'marginPct', round((case when x.prijem > 0 then x.marze / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.prijem desc), '[]'::jsonb)
      from (
        select
          coalesce(branch_id::text, '') as klic,
          count(*) as pocet,
          sum(prijem) as prijem,
          sum(naklad) as naklad,
          sum(marze) as marze,
          count(*) filter (where polozek - bez_nakladu > 0) as se_zdrojem
        from zakazky_drill
        where vydano_akt and ve_vyberu_v
        group by 1
      ) x
    ),

    'marzeServisy', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.klic, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.marze, 2),
        'marginPct', round((case when x.prijem > 0 then x.marze / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.prijem desc), '[]'::jsonb)
      from (
        select
          coalesce(service_id::text, '') as klic,
          count(*) as pocet,
          sum(prijem) as prijem,
          sum(naklad) as naklad,
          sum(marze) as marze,
          count(*) filter (where polozek - bez_nakladu > 0) as se_zdrojem
        from zakazky_drill
        where vydano_akt and ve_vyberu_v
        group by 1
      ) x
    ),

    -- Měsíce: počet podle měsíce přijetí, obrat a marže podle měsíce vydání.
    -- Jen měsíce s daty; prázdné mezi nimi dokreslí stránka podle
    -- `mesicOd` / `mesicDo` a vybraného období.
    'mesice', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'year', x.rok, 'monthIndex', x.mesic, 'count', x.pocet, 'revenue', round(x.prijem, 2), 'margin', round(x.marze, 2)
      ) order by x.rok, x.mesic), '[]'::jsonb)
      from (
        select
          coalesce(pr.rok, vy.rok) as rok,
          coalesce(pr.mesic, vy.mesic) as mesic,
          coalesce(pr.pocet, 0) as pocet,
          coalesce(vy.prijem, 0) as prijem,
          coalesce(vy.marze, 0) as marze
        from (
          select rok_prijeti as rok, mesic_prijeti as mesic, count(*) as pocet
          from zakazky_drill
          where prijato_akt and (v_drill = 'month' or ve_vyberu_p)
          group by 1, 2
        ) pr
        full outer join (
          select rok_vydani as rok, mesic_vydani as mesic, sum(prijem) as prijem, sum(marze) as marze
          from zakazky_drill
          where vydano_akt and (v_drill = 'month' or ve_vyberu_v)
          group by 1, 2
        ) vy on vy.rok = pr.rok and vy.mesic = pr.mesic
      ) x
    ),
    'mesicOd', (
      select least(
        (select min(created_at) from zakazky_drill where prijato_akt and (v_drill = 'month' or ve_vyberu_p)),
        (select min(vydano_at) from zakazky_drill where vydano_akt and (v_drill = 'month' or ve_vyberu_v))
      )
    ),
    'mesicDo', (
      select greatest(
        (select max(created_at) from zakazky_drill where prijato_akt and (v_drill = 'month' or ve_vyberu_p)),
        (select max(vydano_at) from zakazky_drill where vydano_akt and (v_drill = 'month' or ve_vyberu_v))
      )
    )
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

comment on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) is
  'Statistiky: peníze (obrat, náklady, zisk, marže) ze zakázek vydaných v období (koncový stav, completed_at), počty ze zakázek přijatých v období (created_at), rozpracované zakázky zvlášť. Storno bez peněz.';

revoke all on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) to authenticated, service_role;
