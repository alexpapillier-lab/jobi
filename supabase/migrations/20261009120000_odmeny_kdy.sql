-- ============================================================================
-- Odměny týmu: volba, KDY se odměna za opravu připočítá
-- ============================================================================
--
-- PROČ: Odměna za opravu s příznakem „Nabídnuto navíc“ se dosud počítala jen
-- u vydaných zakázek, v měsíci vydání. Majitel chce v Nastavení zvolit:
--
--   * 'vydani'  (výchozí, beze změny) – zakázka v koncovém stavu, který není
--               storno; měsíc = coalesce(completed_at, updated_at), stejně
--               jako ve Statistikách.
--   * 'pridani' – hned, jak je oprava na zakázce; měsíc = kdy byla oprava
--               přidána: performed_repairs[].pridanoAt (ISO, aplikace ho
--               zapisuje od 9. 10. 2026), jinak čas z předpony id
--               („<Date.now() ms>_<náhoda>“), jinak tickets.created_at.
--   * 'stav'    – až zakázka POPRVÉ dosáhne vybraného stavu (klíč ze
--               service_statuses, ne storno). Měsíc = první přechod
--               (ticket_history, action 'updated', details.changes.status.new)
--               do toho stavu NEBO do stavu se stejným či vyšším order_index
--               (zakázka stav přeskočila), nikdy do storna. Byla-li zakázka
--               v takovém stavu už při založení (první změna stavu v historii
--               má takový stav v „old“, nebo se stav nikdy neměnil), počítá
--               se datum založení – u koncového stavu datum vydání
--               (completed_at; importované zakázky ze ZL). Návrat do nižšího
--               stavu odměnu nebere, přepnutí do storna ano.
--
-- Ve všech režimech: zakázka, která je TEĎ ve stornu (nebo smazaná), se
-- nepočítá. Nastavení: service_settings.config.odmeny.kdy =
-- {"rezim": "vydani"|"pridani"|"stav", "stav": "<klíč stavu>"}; chybí,
-- je neznámé, nebo stav neexistuje / je storno = 'vydani'.
--
-- Ruční odměny (odmeny_rucni) se dál počítají podle obdobi – režimu se
-- netýkají. Zbytek funkce (viditelnost podle pobočky z auditu 4, maskování
-- zákazníka, ruční odměny, kontrola práv) je beze změny z 20261009100000.
-- Řádky (radky) navíc nesou 'zapocteno' (datum, podle kterého se odměna
-- počítá) a 'rezim'; 'vydanoAt' je skutečné datum vydání (null u nevydané
-- zakázky). Odpověď navíc nese 'kdy' = {rezim, stav, stavNazev}.
--
-- Idempotentní (create or replace), nemění data ani politiky.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Čas přidání opravy (režim 'pridani')
-- ---------------------------------------------------------------------------
-- pridanoAt (ISO) → předpona id v ms (13 číslic, od roku 2015) → záloha.
-- Rozbitý text v pridanoAt nesmí shodit celý přehled, proto výjimka.
create or replace function public.odmeny_cas_pridani(p_polozka jsonb, p_zaloha timestamptz)
returns timestamptz
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  v_text text;
  v_cas timestamptz;
  v_ms bigint;
begin
  if jsonb_typeof(p_polozka -> 'pridanoAt') = 'string' then
    v_text := btrim(p_polozka ->> 'pridanoAt');
    if v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' then
      begin
        v_cas := v_text::timestamptz;
      exception when others then
        v_cas := null;
      end;
      if v_cas is not null then
        return v_cas;
      end if;
    end if;
  end if;
  v_text := substring(coalesce(p_polozka ->> 'id', '') from '^([0-9]{13})_');
  if v_text is not null then
    v_ms := v_text::bigint;
    if v_ms >= 1420070400000 then -- 1. 1. 2015
      return to_timestamp(v_ms / 1000.0);
    end if;
  end if;
  return p_zaloha;
end;
$$;
comment on function public.odmeny_cas_pridani(jsonb, timestamptz) is
  'Odměny týmu: kdy byla oprava přidána na zakázku – pridanoAt, jinak čas z předpony id (ms), jinak záloha (založení zakázky).';
-- Volá ji jen odmeny_prehled (security definer, běží jako vlastník).
revoke all on function public.odmeny_cas_pridani(jsonb, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Přehled: výběr zakázek a datum podle režimu
-- ---------------------------------------------------------------------------
-- Celé tělo z 20261009100000 (ruční odměny); změny jsou označené „kdy“.
create or replace function public.odmeny_prehled(
  p_service_id uuid,
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_tz text default 'Europe/Prague'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_cfg jsonb;
  v_pravidla jsonb;
  v_verejny boolean;
  v_tz text;
  v_od timestamptz;
  v_do timestamptz;
  v_od12 timestamptz;
  v_vysledek jsonb;
  -- kdy: režim a cílový stav
  v_rezim text;
  v_stav text;
  v_stav_nazev text;
  v_stav_poradi integer;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;
  v_admin := public.odmeny_je_spravce(p_service_id);

  select coalesce(s.config -> 'odmeny', '{}'::jsonb) into v_cfg
  from public.service_settings s where s.service_id = p_service_id;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_pravidla := case when jsonb_typeof(v_cfg -> 'pravidla') = 'array' then v_cfg -> 'pravidla' else '[]'::jsonb end;
  v_verejny := coalesce((v_cfg ->> 'verejny_zebricek')::boolean, true);

  -- kdy: režim z configu; neznámý / chybějící = vydání. Stav musí v servisu
  -- existovat a nesmí to být storno, jinak se počítá po vydání.
  v_rezim := case when jsonb_typeof(v_cfg -> 'kdy') = 'object' then v_cfg #>> '{kdy,rezim}' end;
  if v_rezim is null or v_rezim not in ('vydani', 'pridani', 'stav') then
    v_rezim := 'vydani';
  end if;
  if v_rezim = 'stav' then
    v_stav := nullif(btrim(v_cfg #>> '{kdy,stav}'), '');
    select st.label, st.order_index into v_stav_nazev, v_stav_poradi
    from public.service_statuses st
    where st.service_id = p_service_id and st.key = v_stav
      and not public.stav_je_storno(st.key, st.label);
    if v_stav_poradi is null then
      v_rezim := 'vydani';
      v_stav := null;
      v_stav_nazev := null;
    end if;
  end if;

  v_tz := case
    when p_tz is not null and exists (select 1 from pg_timezone_names n where n.name = p_tz) then p_tz
    else 'Europe/Prague'
  end;
  -- Bez období = tento měsíc.
  v_od := coalesce(p_od, date_trunc('month', now() at time zone v_tz) at time zone v_tz);
  v_do := coalesce(p_do, now());
  -- Měsíční řada: posledních 12 měsíců do konce vybraného období (nebo do teď).
  v_od12 := date_trunc('month', (greatest(v_do, now()) at time zone v_tz) - interval '11 months') at time zone v_tz;

  with pravidla as (
    select
      coalesce(nullif(r ->> 'id', ''), ord::text) as id,
      coalesce(nullif(btrim(r ->> 'nazev'), ''), r ->> 'hledat') as nazev,
      lower(btrim(r ->> 'hledat')) as hledat,
      case when r ->> 'typ' = 'procento' then 'procento' else 'castka' end as typ,
      coalesce(replace(r ->> 'hodnota', ',', '.')::numeric, 0) as hodnota,
      case when r ->> 'komu' = 'technik' then 'technik' else 'pridal' end as komu,
      ord
    from jsonb_array_elements(v_pravidla) with ordinality x(r, ord)
    where coalesce((r ->> 'aktivni')::boolean, true)
      and nullif(btrim(r ->> 'hledat'), '') is not null
      and (r ->> 'hodnota') ~ '^-?[0-9]+([.,][0-9]+)?$'
  ),
  -- kdy: stavy servisu s pořadím a příznakem storna (pro režim 'stav').
  stavy as (
    select st.key, st.label, st.is_final, st.order_index,
           public.stav_je_storno(st.key, st.label) as storno
    from public.service_statuses st
    where st.service_id = p_service_id
  ),
  -- kdy: kandidátní zakázky. Vydání: koncový stav, ne storno, datum vydání
  -- v okně (jako dosud). Ostatní režimy: cokoli, co teď není storno; přidání
  -- opravy i změna stavu posune updated_at (trigger), takže zakázky
  -- neupravené od začátku okna se přeskočí rovnou.
  zakazky_vse as (
    select
      t.id,
      t.code,
      t.customer_name,
      coalesce(nullif(btrim(t.title), ''), t.device_label) as zarizeni,
      t.assigned_to,
      t.branch_id,          -- audit 4
      t.location_branch_id, -- audit 4
      t.created_at,
      t.completed_at,
      coalesce(nullif(t.status, ''), 'received') as stav,
      -- kdy: skutečné datum vydání (jen u zakázky v koncovém stavu).
      case when st.is_final then coalesce(t.completed_at, t.updated_at) end as vydano_at,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy
    from public.tickets t
    left join stavy st on st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = p_service_id
      and t.deleted_at is null
      and not public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label)
      and case
        when v_rezim = 'vydani' then
          coalesce(st.is_final, false)
          and coalesce(t.completed_at, t.updated_at) >= least(v_od, v_od12)
          and coalesce(t.completed_at, t.updated_at) <= greatest(v_do, now())
        else t.updated_at >= least(v_od, v_od12)
      end
  ),
  -- kdy: datum, od kterého se zakázka počítá (pro 'pridani' se určuje až
  -- u položky). Režim 'stav': nejdřívější z (a) prvního přechodu do stavu
  -- s pořadím ≥ cílového, který není storno, (b) založení, byla-li zakázka
  -- v takovém stavu od začátku – u koncového stavu datum vydání.
  zakazky as (
    select z.*,
      case
        when v_rezim = 'vydani' then z.vydano_at
        when v_rezim = 'stav' then (
          select min(k.at) from (
            select h.created_at as at
            from public.ticket_history h
            join stavy s2 on s2.key = h.details #>> '{changes,status,new}'
            where h.ticket_id = z.id
              and h.action = 'updated'
              and s2.order_index >= v_stav_poradi
              and not s2.storno
            union all
            select case when s0.is_final then coalesce(z.completed_at, z.created_at) else z.created_at end
            from stavy s0
            where s0.key = coalesce(
                (select coalesce(nullif(h0.details #>> '{changes,status,old}', ''), 'received')
                 from public.ticket_history h0
                 where h0.ticket_id = z.id and h0.action = 'updated'
                   and h0.details #> '{changes,status}' is not null
                 order by h0.created_at
                 limit 1),
                z.stav)
              and s0.order_index >= v_stav_poradi
              and not s0.storno
          ) k
        )
      end as zakazka_zapocteno_at
    from zakazky_vse z
  ),
  polozky_vse as (
    select
      z.id as ticket_id,
      z.code,
      z.customer_name,
      z.zarizeni,
      z.assigned_to,
      z.branch_id,          -- audit 4
      z.location_branch_id, -- audit 4
      z.vydano_at,
      -- kdy: datum, podle kterého se odměna počítá.
      case
        when v_rezim = 'pridani' then public.odmeny_cas_pridani(e.polozka, z.created_at)
        else z.zakazka_zapocteno_at
      end as zapocteno_at,
      coalesce(e.polozka ->> 'id', e.ord::text) as polozka_id,
      coalesce(e.polozka ->> 'name', '') as oprava,
      case when jsonb_typeof(e.polozka -> 'price') = 'number' then (e.polozka ->> 'price')::numeric else 0 end as cena,
      case when (e.polozka ->> 'pridalUserId') ~* c_uuid then (e.polozka ->> 'pridalUserId')::uuid end as pridal_uid,
      -- Nabídnuto zákazníkovi navíc (příznak z aplikace); bez příznaku = ne.
      case when jsonb_typeof(e.polozka -> 'nabidnuto') = 'boolean' then (e.polozka ->> 'nabidnuto')::boolean else false end as nabidnuto_priznak
    from zakazky z
    cross join lateral jsonb_array_elements(z.opravy) with ordinality e(polozka, ord)
  ),
  -- kdy: jen položky s datem v okně (stejné okno jako dřív u data vydání).
  polozky as (
    select * from polozky_vse p
    where p.zapocteno_at is not null
      and p.zapocteno_at >= least(v_od, v_od12)
      and p.zapocteno_at <= greatest(v_do, now())
  ),
  -- Na položku nejvýš jedno pravidlo: první v pořadí, které sedí.
  shody as (
    select distinct on (p.ticket_id, p.polozka_id)
      p.*,
      r.id as pravidlo_id,
      r.nazev as pravidlo,
      r.komu,
      case when r.typ = 'procento' then round(p.cena * r.hodnota / 100, 2) else round(r.hodnota, 2) end as castka
    from polozky p
    join pravidla r on lower(p.oprava) like '%' || r.hledat || '%'
    order by p.ticket_id, p.polozka_id, r.ord
  ),
  prirazene as (
    select
      s.*,
      coalesce(u.vyrazeno, false) as vyrazeno,
      u.user_id is not null as prepsano,
      -- Majitel může příznak „nabídnuto navíc“ přepsat (odmeny_upravy.nabidnuto).
      coalesce(u.nabidnuto, s.nabidnuto_priznak) as nabidnuto,
      u.nabidnuto is not null as nabidnuto_prepsano,
      u.poznamka,
      case
        when u.user_id is not null then u.user_id
        when s.komu = 'technik' then s.assigned_to
        else coalesce(
          s.pridal_uid,
          -- Historie: první změna, kde se položka objevila (v „new“ je, v „old“ není).
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'updated'
              and (h.details #> '{changes,performed_repairs,new}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id))
              and not coalesce((h.details #> '{changes,performed_repairs,old}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id)), false)
            order by h.created_at
            limit 1),
          -- Položka je na zakázce od příjmu: kdo zakázku založil.
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'created'
            order by h.created_at
            limit 1)
        )
      end as komu_uid
    from shody s
    -- audit 4: páruje se i podle servisu (úprava s cizím servisem se nepočítá).
    left join public.odmeny_upravy u on u.service_id = p_service_id and u.ticket_id = s.ticket_id and u.polozka_id = s.polozka_id
  ),
  -- Co smí volající vidět: správce vše, člen svoje, cizí jen s veřejným žebříčkem.
  viditelne as (
    select * from prirazene p
    where v_admin or p.komu_uid = v_uid or v_verejny
  ),
  v_obdobi as (
    select * from viditelne where zapocteno_at >= v_od and zapocteno_at <= v_do -- kdy
  ),
  -- ruční: všechny ruční odměny servisu, které volající smí vidět (stejně
  -- jako RLS odmeny_rucni_cteni: správce vše, člen svoje – příjemce nebo
  -- autor – a při veřejném žebříčku schválené ostatních).
  rucni_vse as (
    select
      r.*,
      (r.user_id = v_uid or r.vytvoril = v_uid) as moje,
      t.code as kod,
      t.customer_name,
      coalesce(nullif(btrim(t.title), ''), t.device_label) as zarizeni,
      -- Zakázku (číslo, id) jen když ji volající vidí (audit 4).
      (t.id is not null and (v_admin or public.zakazka_viditelna_podle_mista(t.service_id, t.branch_id, t.location_branch_id))) as zakazka_videt
    from public.odmeny_rucni r
    left join public.tickets t on t.id = r.ticket_id and t.service_id = r.service_id
    where r.service_id = p_service_id
      and (v_admin or r.user_id = v_uid or r.vytvoril = v_uid or (v_verejny and r.stav = 'schvaleno'))
  ),
  -- ruční: schválené v měsíční řadě a ve vybraném období (podle obdobi).
  rucni_schvalene as (
    select * from rucni_vse
    where stav = 'schvaleno' and obdobi >= to_char(v_od12 at time zone v_tz, 'YYYY-MM')
  ),
  rucni_obdobi as (
    select * from rucni_vse
    where obdobi >= to_char(v_od at time zone v_tz, 'YYYY-MM')
      and obdobi <= to_char(v_do at time zone v_tz, 'YYYY-MM')
  ),
  -- ruční: součty = opravy + schválené ruční odměny.
  soucty_obdobi as (
    select komu_uid, castka, 0 as rucni from v_obdobi where not vyrazeno and nabidnuto
    union all
    select user_id, castka, 1 from rucni_obdobi where stav = 'schvaleno'
  ),
  soucty_mesice as (
    select to_char(zapocteno_at at time zone v_tz, 'YYYY-MM') as mesic, komu_uid, castka
    from viditelne
    where not vyrazeno and nabidnuto and zapocteno_at >= v_od12
    union all
    select obdobi, user_id, castka from rucni_schvalene
  ),
  jmena as (
    select m.user_id, coalesce(nullif(btrim(pr.nickname), ''), 'Kolega') as jmeno, pr.avatar_url
    from public.service_memberships m
    left join public.profiles pr on pr.id = m.user_id
    where m.service_id = p_service_id
  )
  select jsonb_build_object(
    'zapnuto', exists (select 1 from pravidla),
    'verejny', v_verejny,
    'admin', v_admin,
    'ja', v_uid,
    'od', v_od,
    'do', v_do,
    -- kdy: platný režim (po kontrole stavu), pro větu pod nadpisem a sloupec.
    'kdy', jsonb_build_object('rezim', v_rezim, 'stav', v_stav, 'stavNazev', v_stav_nazev),
    'radky', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ticketId', o.ticket_id, 'kod', o.code, 'zakaznik', o.customer_name, 'zarizeni', o.zarizeni,
        'polozkaId', o.polozka_id, 'oprava', o.oprava, 'cena', o.cena,
        'pravidloId', o.pravidlo_id, 'pravidlo', o.pravidlo, 'komu', o.komu,
        'userId', o.komu_uid, 'jmeno', j.jmeno,
        'castka', o.castka, 'vydanoAt', o.vydano_at, 'zapocteno', o.zapocteno_at, 'rezim', v_rezim, -- kdy
        'vyrazeno', o.vyrazeno, 'prepsano', o.prepsano, 'poznamka', o.poznamka,
        'nabidnuto', o.nabidnuto, 'nabidnutoPrepsano', o.nabidnuto_prepsano
      ) order by o.zapocteno_at desc, o.code desc, o.polozka_id)
      from v_obdobi o
      left join jmena j on j.user_id = o.komu_uid
      -- Vyřazené a nenabídnuté řádky vidí jen správce (aby je mohl vrátit / označit).
      where (v_admin or not o.vyrazeno) and (v_admin or o.nabidnuto)
        -- audit 4: zákazníka a číslo zakázky jen u zakázek, které volající vidí
        -- (člen omezený na pobočku). Součty v „lide“ a „mesice“ zůstávají celé.
        and (v_admin or public.zakazka_viditelna_podle_mista(p_service_id, o.branch_id, o.location_branch_id))
    ), '[]'::jsonb),
    'lide', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'avatarUrl', j.avatar_url,
        'pocet', x.pocet, 'castka', x.castka, 'pocetRucnich', x.pocet_rucnich
      ) order by x.castka desc, x.pocet desc, j.jmeno)
      from (
        select komu_uid, count(*) as pocet, sum(castka) as castka, sum(rucni) as pocet_rucnich
        from soucty_obdobi
        group by komu_uid
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'mesice', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mesic', x.mesic, 'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'pocet', x.pocet, 'castka', x.castka
      ) order by x.mesic, x.castka desc)
      from (
        select mesic, komu_uid, count(*) as pocet, sum(castka) as castka
        from soucty_mesice
        group by 1, 2
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'vyplaty', coalesce((
      select jsonb_agg(jsonb_build_object('userId', v.user_id, 'obdobi', v.obdobi, 'castka', v.castka, 'vyplacenoAt', v.vyplaceno_at))
      from public.odmeny_vyplaty v
      where v.service_id = p_service_id
        and (v_admin or v.user_id = v_uid)
        and v.obdobi >= to_char(v_od12 at time zone v_tz, 'YYYY-MM')
    ), '[]'::jsonb),
    -- ruční: odměny vybraného období. Čekající a zamítnuté jen správce
    -- a „moje“ (příjemce / autor). Zákazník a zařízení jen správci a u
    -- vlastních, číslo zakázky jen u viditelné zakázky.
    'rucni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'userId', r.user_id, 'jmeno', coalesce(j.jmeno, 'Bývalý člen'),
        'pravidloId', r.pravidlo_id, 'pravidlo', r.pravidlo_nazev, 'castka', r.castka, 'zaklad', r.zaklad,
        'poznamka', r.poznamka, 'obdobi', r.obdobi, 'stav', r.stav, 'duvodZamitnuti', r.duvod_zamitnuti,
        'automaticky', r.automaticky,
        'vytvoril', r.vytvoril, 'vytvorilJmeno', jv.jmeno,
        'schvalil', r.schvalil, 'schvalilJmeno', js.jmeno, 'schvalenoAt', r.schvaleno_at,
        'createdAt', r.created_at,
        'ticketId', case when r.zakazka_videt then r.ticket_id end,
        'kod', case when r.zakazka_videt then r.kod end,
        'zakaznik', case when r.zakazka_videt and (v_admin or r.moje) then r.customer_name end,
        'zarizeni', case when r.zakazka_videt and (v_admin or r.moje) then r.zarizeni end
      ) order by r.created_at desc)
      from rucni_obdobi r
      left join jmena j on j.user_id = r.user_id
      left join jmena jv on jv.user_id = r.vytvoril
      left join jmena js on js.user_id = r.schvalil
      where r.stav = 'schvaleno' or v_admin or r.moje
    ), '[]'::jsonb),
    -- ruční: vše, co čeká na schválení (bez ohledu na období) – správce celý
    -- servis, ostatní jen svoje.
    'cekajici', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'userId', r.user_id, 'jmeno', coalesce(j.jmeno, 'Bývalý člen'),
        'pravidloId', r.pravidlo_id, 'pravidlo', r.pravidlo_nazev, 'castka', r.castka, 'zaklad', r.zaklad,
        'poznamka', r.poznamka, 'obdobi', r.obdobi, 'stav', r.stav, 'duvodZamitnuti', r.duvod_zamitnuti,
        'automaticky', r.automaticky,
        'vytvoril', r.vytvoril, 'vytvorilJmeno', jv.jmeno,
        'schvalil', r.schvalil, 'schvalilJmeno', null, 'schvalenoAt', r.schvaleno_at,
        'createdAt', r.created_at,
        'ticketId', case when r.zakazka_videt then r.ticket_id end,
        'kod', case when r.zakazka_videt then r.kod end,
        'zakaznik', case when r.zakazka_videt then r.customer_name end,
        'zarizeni', case when r.zakazka_videt then r.zarizeni end
      ) order by r.created_at)
      from (select * from rucni_vse where stav = 'ceka' and (v_admin or moje) order by created_at limit 200) r
      left join jmena j on j.user_id = r.user_id
      left join jmena jv on jv.user_id = r.vytvoril
    ), '[]'::jsonb),
    -- ruční: aktivní pravidla pro dialog Přidat odměnu (stejný výběr jako výpočet).
    'pravidla', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nazev', p.nazev, 'typ', p.typ, 'hodnota', p.hodnota) order by p.ord)
      from pravidla p
    ), '[]'::jsonb),
    -- ruční: komu se schvaluje automaticky – správce všechny, člen jen sebe.
    'autoSchvaleni', coalesce((
      select jsonb_agg(a.user_id)
      from public.odmeny_auto_schvaleni a
      where a.service_id = p_service_id and (v_admin or a.user_id = v_uid)
    ), '[]'::jsonb)
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

comment on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) is
  'Odměny týmu: řádky za období (podle režimu config.odmeny.kdy: data vydání zakázky, přidání opravy, nebo prvního dosažení stavu), součty na člověka (včetně schválených ručních odměn podle obdobi), měsíční řada 12 měsíců zpět, vyplaceno, ruční odměny (rucni, cekajici), aktivní pravidla a automatické schvalování.';
revoke all on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) to authenticated;
