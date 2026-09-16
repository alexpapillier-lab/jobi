-- Právo „vidět statistiky“ (can_view_statistics).
--
-- Statistiky ukazují obrat, zisk a marže celého servisu. Do teď je viděl
-- každý člen – majitel neměl jak technikovi ukázat zakázky, ale ne peníze.
-- Nové právo se nastavuje u člena v Nastavení → Tým jako ostatní a hlídá
-- se na dvou místech: v aplikaci (stránka zmizí z navigace) a tady v
-- databázi (funkce statistiky_prehled / statistiky_technici čísla nevydají).
--
-- Chybějící klíč znamená POVOLENO, ne zakázáno – na rozdíl od ostatních
-- práv. Statistiky dřív viděl každý; řádek bez klíče je starší člen nebo
-- člen pozvaný starší edge funkcí, a ani jednomu se stránka nesmí ztratit
-- jen proto, že se aplikace aktualizovala dřív než databáze. Stejně to čte
-- App.tsx a dialog práv v Týmu. Stávajícím členům se klíč přesto zapíše
-- výslovně, ať je v dialogu vidět, co platí; noví ho dostávají výchozím
-- nastavením pozvánky (invite-accept). Kdo statistiky vidět nemá, tomu
-- majitel právo odebere (false).
--
-- Zároveň se obě funkce statistik otvírají pro service_role: edge funkce
-- statistics-report-send (report e-mailem) je volá bez přihlášeného
-- uživatele, takže kontrola členství přes auth.uid() by ji vždycky
-- odmítla. service_role se do funkcí dostane jen z edge funkce se
-- servisním klíčem, ne z aplikace.

-- 1) Seznam povolených práv ------------------------------------------------
-- Musí se shodovat s TeamSettings.tsx a team-set-capabilities (hlídá test
-- src/lib/opravneniSeznam.test.ts).
create or replace function public.povolene_capability()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'can_manage_tickets_basic',
    'can_change_ticket_status',
    'can_delete_tickets',
    'can_manage_ticket_archive',
    'can_manage_customers',
    'can_manage_statuses',
    'can_manage_documents',
    'can_print_export',
    'can_edit_devices',
    'can_edit_inventory',
    'can_adjust_inventory_quantity',
    'can_edit_service_settings',
    'can_view_statistics',
    'branch_only'
  ]::text[];
$$;

revoke all on function public.povolene_capability() from public, anon;
grant execute on function public.povolene_capability() to authenticated, service_role;

-- 2) Stávajícím členům se právo zapíše výslovně (viz výše) --------------------
update public.service_memberships
   set capabilities = coalesce(capabilities, '{}'::jsonb) || '{"can_view_statistics": true}'::jsonb
 where role = 'member'
   and not (coalesce(capabilities, '{}'::jsonb) ? 'can_view_statistics');

-- 3) Jedna kontrola pro obě funkce statistik ---------------------------------
-- Volající musí být členem každého z vybraných servisů a – pokud je jen
-- člen – nesmí mít právo can_view_statistics odebrané (false). Chybějící
-- klíč = povoleno (viz úvod). Majitel a správce vidí vždy.
create or replace function public.overit_pristup_ke_statistikam(p_service_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nemáte přístup k některému z vybraných servisů.' using errcode = '42501';
  end if;
  if (
    select count(distinct s.id)
    from unnest(p_service_ids) s(id)
    where exists (
      select 1 from public.service_memberships m
      where m.service_id = s.id
        and m.user_id = auth.uid()
        and (
          m.role in ('owner', 'admin')
          or coalesce(m.capabilities ->> 'can_view_statistics', 'true') <> 'false'
        )
    )
  ) <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'Nemáte přístup ke statistikám některého z vybraných servisů.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.overit_pristup_ke_statistikam(uuid[]) from public, anon;
grant execute on function public.overit_pristup_ke_statistikam(uuid[]) to authenticated, service_role;

comment on function public.overit_pristup_ke_statistikam(uuid[]) is
  'Vyhodí 42501, když volající není členem každého ze servisů nebo má jako člen právo can_view_statistics odebrané (false). Chybějící klíč = povoleno.';

-- 4) statistiky_prehled – tělo beze změny (migrace 20260913160000), jen
--    kontrola přístupu nahoře. -----------------------------------------------
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
  v_pobocky uuid[];
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
  -- Edge funkce statistics-report-send (e-mailový report) volá pod
  -- service_role bez uživatele – tam se členství ani právo nekontroluje,
  -- servis si vybírá funkce sama podle nastavení reportu.
  if auth.role() is distinct from 'service_role' then
    perform public.overit_pristup_ke_statistikam(p_service_ids);
  end if;

  -- Člen omezený na pobočku dostane vždy jen svou pobočku, ať si pošle cokoli.
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
      -- Stornovaná zakázka do peněz nevstupuje vůbec; do počtů ano.
      public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label) as storno,
      ((p_od is null or t.created_at >= p_od) and (p_do is null or t.created_at <= p_do)) as je_aktualni
    from public.tickets t
    left join public.service_statuses st
      on st.service_id = t.service_id and st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      -- Pobočka z lišty: zakázky bez pobočky vidí každá pobočka (shodně s filterByBranch).
      and (v_pobocky is null or t.branch_id is null or t.branch_id = any(v_pobocky))
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
      z.storno,
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
             z.stav, z.zarizeni, z.storno, z.je_aktualni, z.discount_type, z.sleva_hodnota
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
      zs.storno,
      zs.je_aktualni,
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
    -- Položka stornované zakázky se počítá do „Provedeno“, ale ne do peněz.
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
          coalesce(sum(pv.prijem) filter (where not zd.storno), 0) as prijem,
          coalesce(sum(pv.naklad) filter (where not zd.storno), 0) as naklad,
          count(*) filter (where not zd.storno and pv.ma_zdroj_nakladu) as se_zdrojem
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
          count(*) filter (where not storno and polozek - bez_nakladu > 0) as se_zdrojem
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
          count(*) filter (where not storno and polozek - bez_nakladu > 0) as se_zdrojem
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
          count(*) filter (where not storno and polozek - bez_nakladu > 0) as se_zdrojem
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

-- 5) statistiky_technici – totéž. ---------------------------------------------
create or replace function public.statistiky_technici(
  p_service_ids uuid[],
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vysledek jsonb;
  v_pobocky uuid[];
  v_ted timestamptz := now();
  -- Neuzavřený úsek se počítá nejvýš jednu dlouhou směnu. Zapomenuté stopky
  -- nejsou odvedená práce: úsek z 20. ledna, který nikdo nezastavil, jinak
  -- „naroste“ do konce období a technik má v lednu 282 hodin místo dvou.
  -- Stejná mez je v `src/lib/usekyPrace.ts` (MAX_OTEVRENY_USEK_HODIN).
  c_otevreny_strop constant numeric := 12 * 3600;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Chybí servis.' using errcode = '22023';
  end if;
  -- Členství i právo „vidět statistiky“ na jednom místě; service_role
  -- (e-mailový report) prochází bez uživatele.
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

  with viditelne as (
    -- Jedno místo, kde se rozhoduje, které zakázky do KPI patří. Filtr
    -- pobočky je schválně stejný jako v `statistiky_prehled`: zakázka bez
    -- pobočky patří každé pobočce, jinak by součet „Přijal“ neseděl
    -- s počtem zakázek v období.
    select t.id, t.service_id, t.created_at, t.performed_repairs,
           public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label) as storno
    from public.tickets t
    left join public.service_statuses st
      on st.service_id = t.service_id and st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      and (v_pobocky is null or t.branch_id is null or t.branch_id = any(v_pobocky))
  ),
  historie as (
    select h.id,
           h.changed_by as user_id,
           h.action,
           h.ticket_id,
           h.created_at,
           h.details -> 'changes' -> 'status' ->> 'new' as novy_stav,
           v.service_id
    from public.ticket_history h
    join viditelne v on v.id = h.ticket_id
    where (p_od is null or h.created_at >= p_od)
      and (p_do is null or h.created_at <= p_do)
  ),
  prijati as (
    select h.user_id, count(distinct h.ticket_id) as prijato
    from historie h
    where h.action = 'created'
    group by h.user_id
  ),
  -- Dokončení má jednoho autora: toho, kdo zakázku do koncového stavu přepnul
  -- naposled. Dřív ho dostal každý, kdo ji tam kdy přepnul, a součet sloupce
  -- „Dokončil“ pak byl vyšší než počet dokončených zakázek.
  dokonceni as (
    select distinct on (h.ticket_id) h.ticket_id, h.user_id
    from historie h
    where h.action = 'updated'
      and h.novy_stav is not null
      and exists (
        select 1 from public.service_statuses s
        where s.service_id = h.service_id and s.key = h.novy_stav and s.is_final
          and not public.stav_je_storno(s.key, s.label)
      )
    order by h.ticket_id, h.created_at desc, h.id desc
  ),
  dokoncili as (
    select d.user_id, count(*) as dokonceno
    from dokonceni d
    group by d.user_id
  ),
  -- Čas ze stopek podle PŘEKRYVU s obdobím, ne podle toho, kdy úsek začal.
  -- Úsek 23:30–00:30 na přelomu měsíce tak dá půl hodiny do každého z nich;
  -- dřív spadl celý do toho, ve kterém začal, a při pohledu na ten druhý
  -- zmizel úplně.
  useky as (
    select
      w.user_id,
      w.ended_at is null as otevreny,
      greatest(0, extract(epoch from (
        least(coalesce(w.ended_at, v_ted), coalesce(p_do, v_ted))
        - greatest(w.started_at, coalesce(p_od, '-infinity'::timestamptz))
      ))) as sekund
    from public.ticket_work_sessions w
    join viditelne v on v.id = w.ticket_id
    where w.service_id = any(p_service_ids)
      and w.started_at <= coalesce(p_do, v_ted)
      and coalesce(w.ended_at, v_ted) >= coalesce(p_od, '-infinity'::timestamptz)
  ),
  odpracovano as (
    select
      u.user_id,
      sum(case when u.otevreny then least(u.sekund, c_otevreny_strop) else u.sekund end) / 3600.0 as hodiny,
      count(*) filter (where u.otevreny) as bezicich
    from useky u
    group by u.user_id
  ),
  hodinova as (
    select
      -- Účet technika má přednost před jménem: dva lidé se stejnou přezdívkou se nesmí slít.
      coalesce(nullif(r ->> 'technikUserId', ''), 'jmeno:' || lower(trim(r ->> 'technik'))) as klic,
      max(trim(r ->> 'technik')) as jmeno,
      sum(coalesce((r ->> 'hodiny')::numeric, 0)) as hodiny,
      sum(coalesce((r ->> 'price')::numeric, 0)) as trzba
    from viditelne v,
         jsonb_array_elements(case when jsonb_typeof(v.performed_repairs) = 'array' then v.performed_repairs else '[]'::jsonb end) r
    where (p_od is null or v.created_at >= p_od)
      and (p_do is null or v.created_at <= p_do)
      -- Za stornovanou zakázku se nefakturovalo: hodinová práce ani tržba
      -- z ní do KPI nepatří. Čas ze stopek naopak ano – ten se opravdu strávil.
      and not v.storno
      and r ->> 'type' = 'hourly'
      and (coalesce(trim(r ->> 'technik'), '') <> '' or coalesce(r ->> 'technikUserId', '') <> '')
    group by coalesce(nullif(r ->> 'technikUserId', ''), 'jmeno:' || lower(trim(r ->> 'technik')))
  ),
  -- Sjednocení účtů ze všech tří zdrojů; `union` bere null jako jednu hodnotu,
  -- takže „Bez technika“ (portál, automat) vyjde jako jeden řádek.
  ucty as (
    select user_id from prijati
    union
    select user_id from dokoncili
    union
    select user_id from odpracovano
  ),
  lide as (
    select u.user_id,
           case
             when u.user_id is null then 'Bez technika (portál, automat)'
             else coalesce(nullif(trim(p.nickname), ''), 'Bez přezdívky (' || left(u.user_id::text, 8) || ')')
           end as jmeno,
           -- Párování s hodinovou prací: podle účtu, záložně podle přezdívky.
           coalesce(u.user_id::text, 'bez-technika') as klic_ucet,
           'jmeno:' || lower(coalesce(nullif(trim(p.nickname), ''), '')) as klic_jmeno,
           coalesce(pr.prijato, 0) as prijato,
           coalesce(dk.dokonceno, 0) as dokonceno,
           coalesce(od.hodiny, 0) as odpracovano,
           coalesce(od.bezicich, 0) as bezicich
    from ucty u
    left join public.profiles p on p.id = u.user_id
    left join prijati pr on pr.user_id is not distinct from u.user_id
    left join dokoncili dk on dk.user_id is not distinct from u.user_id
    left join odpracovano od on od.user_id is not distinct from u.user_id
  ),
  -- Klíč hodinové práce se přeloží na účet předem: FULL JOIN nesmí mít OR v podmínce.
  hodinova_klic as (
    select h.*,
           coalesce(
             case when h.klic not like 'jmeno:%' then h.klic end,
             (select l.klic_ucet from lide l where l.klic_jmeno = h.klic and l.klic_jmeno <> 'jmeno:' limit 1),
             h.klic
           ) as klic_final
    from hodinova h
  ),
  spojeni as (
    select coalesce(l.jmeno, h.jmeno) as jmeno,
           l.user_id,
           coalesce(l.prijato, 0) as prijato,
           coalesce(l.dokonceno, 0) as dokonceno,
           coalesce(l.odpracovano, 0) as odpracovano,
           coalesce(l.bezicich, 0) as bezicich,
           coalesce(h.hodiny, 0) as hodiny,
           coalesce(h.trzba, 0) as trzba
    from lide l
    full outer join hodinova_klic h on h.klic_final = l.klic_ucet
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', s.user_id, 'name', s.jmeno, 'prijato', s.prijato, 'dokonceno', s.dokonceno,
    'odpracovanoHodin', round(s.odpracovano::numeric, 2),
    'bezicichUseku', s.bezicich,
    'hodiny', round(s.hodiny, 2), 'trzbaHodin', round(s.trzba, 2)
  ) order by s.dokonceno desc, s.prijato desc, s.odpracovano desc, s.hodiny desc, s.jmeno), '[]'::jsonb)
  into v_vysledek
  from spojeni s
  where s.prijato > 0 or s.dokonceno > 0 or s.hodiny > 0 or s.odpracovano > 0 or s.bezicich > 0;

  return v_vysledek;
end;
$$;

-- Granty se nemění (definice funkcí je zachovaná), pro jistotu znovu:
revoke all on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.statistiky_prehled(uuid[], timestamptz, timestamptz, uuid, text, text, integer, integer, timestamptz, timestamptz, text) to authenticated, service_role;
revoke all on function public.statistiky_technici(uuid[], timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.statistiky_technici(uuid[], timestamptz, timestamptz, uuid) to authenticated, service_role;
