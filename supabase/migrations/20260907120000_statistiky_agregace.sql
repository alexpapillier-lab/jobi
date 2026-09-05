-- Agregace pro stránku Statistiky.
--
-- Statistiky si dosud stahovaly do prohlížeče všechny zakázky servisu a
-- počítaly z nich součty v JavaScriptu. Největší servis má přes 3 500 zakázek
-- a přibývá jich skoro tisíc ročně – u desetitisíce by stránka stahovala
-- megabajty JSONu a počítala je na jednom vlákně. Součty patří tam, kde jsou
-- data.
--
-- Funkce vrací jeden jsonb objekt se vším, co stránka kreslí: klíčová čísla
-- (i za předchozí období), rozpad podle stavů, žebříčky oprav a zařízení,
-- marže podle oprav / zařízení / poboček / servisů a měsíční řadu.
--
-- Definice marže musí sedět s `src/pages/Statistics/margin.ts`, jinak by se
-- čísla po nasazení skokem změnila:
--   příjem položky  = price (jen když je to v JSONu číslo), jinak 0
--   náklad položky  = vlastní costs; když chybí, costs ceníkové opravy
--                   + nákupní ceny navázaných dílů (díl bez ceny = 0 Kč)
--   sleva zakázky   = procenta z hrubé ceny, nebo pevná částka
--   příjem zakázky  = max(0, hrubá − sleva)
--   marže zakázky   = hrubá − náklady − sleva

/**
 * Souhrn statistik pro jeden nebo víc servisů.
 *
 * Období i „předchozí období“ počítá klient (zná časové pásmo a to, co má
 * uživatel vybrané v liště) a posílá je jako hranice. Měsíce a drill-down na
 * měsíc se řežou v pásmu `p_tz`, aby zakázka z 1. ledna 00:30 nespadla do
 * prosince.
 *
 * `p_drill_*` je zúžení výběru kliknutím ve stránce. Faseta, na kterou se
 * kliklo, se počítá ze všech zakázek období – jinak by v grafu zůstal jediný
 * sloupec a nebylo by kam klikat dál.
 */
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
  -- Tvar UUID; v JSONu položek jsou jen texty a špatný zápis by shodil přetypování.
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Chybí servis.' using errcode = '22023';
  end if;

  -- Právo se kontroluje ručně: funkce je security definer, obchází RLS a
  -- nesmí prozradit čísla ze servisu, do kterého volající nepatří.
  if (
    select count(distinct s.id)
    from unnest(p_service_ids) s(id)
    where exists (
      select 1 from public.service_memberships m
      where m.service_id = s.id and m.user_id = auth.uid()
    )
  ) <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'Nemáte přístup k některému z vybraných servisů.' using errcode = '42501';
  end if;

  -- Neznámé pásmo by shodilo celý dotaz; radši spočítat měsíce v našem čase.
  v_tz := case
    when p_tz is not null and exists (select 1 from pg_timezone_names n where n.name = p_tz) then p_tz
    else 'Europe/Prague'
  end;

  with zakazky as (
    select
      t.id,
      t.service_id,
      t.branch_id,
      t.created_at,
      t.completed_at,
      -- Stejné náhrady jako mapování v Orders.tsx: prázdný stav je „received“,
      -- prázdný název zařízení „Nová zakázka“.
      coalesce(nullif(t.status, ''), 'received') as stav,
      coalesce(nullif(t.title, ''), 'Nová zakázka') as zarizeni,
      t.discount_type,
      coalesce(t.discount_value, 0) as sleva_hodnota,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy,
      ((p_od is null or t.created_at >= p_od) and (p_do is null or t.created_at <= p_do)) as je_aktualni
    from public.tickets t
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      -- Pobočka z lišty: zakázky bez pobočky vidí každá pobočka (shodně s filterByBranch).
      and (p_branch_id is null or t.branch_id is null or t.branch_id = p_branch_id)
      and (
        ((p_od is null or t.created_at >= p_od) and (p_do is null or t.created_at <= p_do))
        or (p_prev_od is not null and p_prev_do is not null and t.created_at >= p_prev_od and t.created_at <= p_prev_do)
      )
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
      z.completed_at,
      z.stav,
      z.zarizeni,
      z.je_aktualni,
      z.discount_type,
      z.sleva_hodnota,
      coalesce(sum(pv.prijem), 0) as hruby,
      coalesce(sum(pv.naklad), 0) as naklad,
      count(pv.ord) as polozek,
      count(*) filter (where pv.ord is not null and not pv.ma_zdroj_nakladu) as bez_nakladu,
      count(*) filter (where pv.chybi_nakupni_cena) as bez_ceny_dilu
    from zakazky z
    left join polozky_vysledek pv on pv.zakazka_id = z.id
    group by z.id, z.service_id, z.branch_id, z.created_at, z.completed_at,
             z.stav, z.zarizeni, z.je_aktualni, z.discount_type, z.sleva_hodnota
  ),
  zakazky_drill as (
    select
      zs.id,
      zs.service_id,
      zs.branch_id,
      zs.created_at,
      zs.completed_at,
      zs.stav,
      zs.zarizeni,
      zs.je_aktualni,
      zs.hruby,
      zs.naklad,
      zs.polozek,
      zs.bez_nakladu,
      zs.bez_ceny_dilu,
      s.sleva,
      greatest(0, zs.hruby - s.sleva) as prijem,
      zs.hruby - zs.naklad - s.sleva as marze,
      extract(year from zs.created_at at time zone v_tz)::int as rok,
      extract(month from zs.created_at at time zone v_tz)::int - 1 as mesic,
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
      end as ve_vyberu
    from zakazky_soucty zs
    cross join lateral (
      select case
        when zs.discount_type = 'percentage' then zs.hruby * zs.sleva_hodnota / 100
        when zs.discount_type = 'amount' then zs.sleva_hodnota
        else 0
      end as sleva
    ) s
  ),
  -- Klíčová čísla za aktuální výběr (akt = true) a za předchozí období
  -- (akt = false; to se drill-downem nezužuje, porovnává se celé období).
  kpi_skupiny as (
    select
      (je_aktualni and ve_vyberu) as akt,
      count(*) as pocet,
      sum(prijem) as prijem,
      sum(naklad) as naklad,
      sum(sleva) as sleva,
      sum(marze) as marze,
      sum(bez_nakladu) as bez_nakladu,
      sum(bez_ceny_dilu) as bez_ceny_dilu,
      count(*) filter (where prijem > 0) as placenych,
      avg(extract(epoch from (completed_at - created_at)) / 86400.0)
        filter (where completed_at is not null and completed_at > created_at) as doba
    from zakazky_drill
    where (je_aktualni and ve_vyberu) or not je_aktualni
    group by 1
  ),
  -- Zaokrouhlení není kosmetika: podíl dvou numericů má v Postgresu i dvacet
  -- desetinných míst a odpověď by kvůli nim byla o desítky kilobajtů delší.
  kpi as (
    select
      akt,
      jsonb_build_object(
        'totalTickets', pocet,
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
      'totalTickets', 0, 'totalRevenue', 0, 'totalCosts', 0, 'totalDiscounts', 0,
      'profit', 0, 'marginPct', 0, 'entriesWithoutCost', 0, 'entriesMissingPurchasePrice', 0,
      'averageTicketPrice', 0, 'averageTicketDurationDays', 0
    ) as data
  )
  select jsonb_build_object(
    'kpi', coalesce((select data from kpi where akt), (select data from prazdne_kpi)),
    'kpiPredchozi', coalesce((select data from kpi where not akt), (select data from prazdne_kpi)),
    'pocetVObdobi', (select count(*) from zakazky_drill where je_aktualni),
    'pocetVeVyberu', (select count(*) from zakazky_drill where je_aktualni and ve_vyberu),
    'pocetPredchozi', (select count(*) from zakazky_drill where not je_aktualni),

    'stavy', (
      select coalesce(jsonb_agg(jsonb_build_object('key', x.stav, 'count', x.pocet) order by x.pocet desc, x.stav), '[]'::jsonb)
      from (
        select stav, count(*) as pocet
        from zakazky_drill
        where je_aktualni and (v_drill = 'status' or ve_vyberu)
        group by stav
      ) x
    ),

    'topOpravy', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.nazev, 'count', x.pocet) order by x.pocet desc, x.nazev), '[]'::jsonb)
      from (
        select pv.nazev, count(*) as pocet
        from polozky_vysledek pv
        join zakazky_drill zd on zd.id = pv.zakazka_id
        where zd.je_aktualni and (v_drill = 'repair' or zd.ve_vyberu)
        group by pv.nazev
        order by count(*) desc, pv.nazev
        limit 5
      ) x
    ),

    'topZarizeni', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.zarizeni, 'count', x.pocet) order by x.pocet desc, x.zarizeni), '[]'::jsonb)
      from (
        select zarizeni, count(*) as pocet
        from zakazky_drill
        where je_aktualni and (v_drill = 'device' or ve_vyberu)
        group by zarizeni
        order by count(*) desc, zarizeni
        limit 5
      ) x
    ),

    -- Marže podle oprav se počítá z položek, ne ze zakázek: sleva zakázky se
    -- mezi opravy rozdělit nedá, proto v ní není (stejně jako v prohlížeči).
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
          (array_agg(pv.nazev order by zd.created_at desc, zd.id))[1] as nazev,
          count(*) as pocet,
          sum(pv.prijem) as prijem,
          sum(pv.naklad) as naklad,
          count(*) filter (where pv.ma_zdroj_nakladu) as se_zdrojem
        from polozky_vysledek pv
        join zakazky_drill zd on zd.id = pv.zakazka_id
        where zd.je_aktualni and (v_drill = 'repair' or zd.ve_vyberu)
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
        where je_aktualni and (v_drill = 'device' or ve_vyberu)
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
        where je_aktualni and ve_vyberu
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
        where je_aktualni and ve_vyberu
        group by 1
      ) x
    ),

    -- Měsíce jen s daty; prázdné měsíce mezi nimi dokreslí stránka podle
    -- `mesicOd` / `mesicDo` a vybraného období.
    'mesice', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'year', x.rok, 'monthIndex', x.mesic, 'count', x.pocet, 'revenue', round(x.prijem, 2), 'margin', round(x.marze, 2)
      ) order by x.rok, x.mesic), '[]'::jsonb)
      from (
        select rok, mesic, count(*) as pocet, sum(prijem) as prijem, sum(marze) as marze
        from zakazky_drill
        where je_aktualni and (v_drill = 'month' or ve_vyberu)
        group by rok, mesic
      ) x
    ),
    'mesicOd', (select min(created_at) from zakazky_drill where je_aktualni and (v_drill = 'month' or ve_vyberu)),
    'mesicDo', (select max(created_at) from zakazky_drill where je_aktualni and (v_drill = 'month' or ve_vyberu))
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

revoke all on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) to authenticated, service_role;

comment on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) is
  'Hotové agregace pro stránku Statistiky (klíčová čísla, stavy, žebříčky, marže, měsíce). Ověřuje členství volajícího ve všech vybraných servisech.';

-- Statistiky čtou zakázky servisu seřazené podle vzniku; bez tohoto indexu
-- se pro každé období čte celá tabulka servisu.
create index if not exists tickets_service_created_idx
  on public.tickets (service_id, created_at desc)
  where deleted_at is null;
