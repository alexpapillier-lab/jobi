-- Odměny podle pobočky z horní lišty.
--
-- Proč: stránka Odměny pobočku vůbec nepoužívala. Majitel iSwapu přepnutý
-- na Brno viděl odměny za zakázky Prahy, zatímco Zakázky, Statistiky
-- a ostatní stránky ukazovaly Brno.
--
-- Co se mění:
--   1) odmeny_prehled má pátý parametr p_branch_id (výchozí null = všechny
--      pobočky, chování beze změny). Stará čtyřparametrová verze se ruší –
--      dvě přetížení by PostgREST nerozlišil („Could not choose the best
--      candidate function“). Volání se čtyřmi argumenty (starší aplikace,
--      sondy) projde dál díky výchozí hodnotě.
--      S pobočkou: zakázka patří pobočce, kde byla přijata (tickets.branch_id),
--      bez pobočky patří každé – stejně jako statistiky_prehled /
--      statistiky_technici. location_branch_id (zakázka poslaná k opravě
--      jinam) se nepočítá: odměna by se jinak ukázala ve dvou pobočkách
--      a součty poboček by nedávaly součet za celý servis.
--      Filtr platí pro řádky, součty lidí (žebříček, zaměstnanec měsíce),
--      měsíční řadu (síň slávy), cekajiciNaZapocteni i ruční odměny.
--      Pobočka musí patřit servisu a volající na ni musí vidět
--      (pobocka_povolena) – omezený člen si cizí pobočku nevyžádá.
--      Viditelnost podle role a pobočky (audit 4) zůstává, jak byla.
--   2) Ruční odměna: s zakázkou patří pobočce zakázky; bez zakázky pobočce,
--      ve které byla přidána – nový sloupec odmeny_rucni.branch_id, který
--      vyplní odmeny_rucni_pridat (nový volitelný parametr p_branch_id =
--      aktivní pobočka v aplikaci). Bez toho by odměna přidaná jedním
--      klikem v Brně v Brně hned zmizela a člověk by ji přidal znovu.
--      Starší ruční odměny bez zakázky (iSwap 2 z 9) a ty přidané při
--      „Všechny pobočky“ pobočku nemají – ukazují se jen ve „Všech pobočkách“.
--   3) Nové pole `cekajiciJinde`: počet čekajících ručních odměn (Ke
--      schválení), které ve vybrané pobočce vidět nejsou – stránka správci
--      napíše, že další čekají jinde, ať je při schvalování nepřehlédne.
--      `pobocka` vrací, za kterou pobočku čísla jsou (podle klíče klient
--      pozná, že server filtr umí).
--   Vyplácení (odmeny_vyplaty) zůstává za člověka a měsíc za celý servis.
--   4) Zamítnutí v „Čeká na vydání“ (majitel: „bylo by fajn, kdyby byla
--      možnost je zamítnout“): správce u čekající položky zapíše
--      odmeny_upravy.vyrazeno = true (stejný mechanismus jako Vyřadit
--      u započtených řádků; práva beze změny). cekajiciNaZapocteni pak
--      vyřazenou položku správci dál vrací s `vyrazeno: true` (a poznamka,
--      prepsano, nabidnutoPrepsano), aby šla vrátit; člen ji nevidí. Po
--      vydání se vyřazená nezapočte – součty berou jen `not vyrazeno`.
--
-- Vychází z 20261023170000_odmeny_ceka_na_vydani.sql (odmeny_prehled) a
-- 20261009140000_odmeny_poznamka_nepovinna.sql (odmeny_rucni_pridat), obě
-- v produkci (md5 těl ověřeno 23. 10. 2026). Kromě označených míst
-- („pobočka“) jsou těla beze změny. Sondy 1760–1765 ve scripts/rls-probe.sql.

-- ---------------------------------------------------------------------------
-- 1) Sloupec a trigger: pobočka ruční odměny
-- ---------------------------------------------------------------------------
alter table public.odmeny_rucni
  add column if not exists branch_id uuid references public.branches(id) on delete set null;
comment on column public.odmeny_rucni.branch_id is
  'Pobočka ruční odměny: u odměny k zakázce snímek pobočky zakázky, bez zakázky pobočka, ve které byla přidána (null = jen ve „Všech pobočkách“).';

create or replace function public.odmeny_rucni_pobocka()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.ticket_id is not null then
    -- K zakázce: pobočka zakázky (servis zakázky hlídá odmeny_rucni_kontrola).
    select t.branch_id into new.branch_id
      from public.tickets t where t.id = new.ticket_id and t.service_id = new.service_id;
  elsif new.branch_id is not null then
    if not exists (select 1 from public.branches b where b.id = new.branch_id and b.service_id = new.service_id) then
      raise exception 'Pobočka nepatří tomuto servisu.' using errcode = '22023';
    end if;
    -- Bez přihlášeného (service_role, migrace) se oprávnění nehlídá.
    if v_uid is not null and not public.pobocka_povolena(new.service_id, new.branch_id) then
      raise exception 'Na tuto pobočku nemáte přístup.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.odmeny_rucni_pobocka() from public, anon, authenticated;
drop trigger if exists odmeny_rucni_pobocka on public.odmeny_rucni;
create trigger odmeny_rucni_pobocka
  before insert or update of branch_id, ticket_id on public.odmeny_rucni
  for each row execute function public.odmeny_rucni_pobocka();

-- Stávající ruční odměny k zakázce: snímek pobočky zakázky (bez zakázky
-- zůstává null). Trigger by to udělal taky – tady jen pro úplnost dat.
update public.odmeny_rucni r
   set branch_id = t.branch_id
  from public.tickets t
 where t.id = r.ticket_id and t.service_id = r.service_id
   and r.branch_id is distinct from t.branch_id;

-- ---------------------------------------------------------------------------
-- 2) odmeny_rucni_pridat s pobočkou
-- ---------------------------------------------------------------------------
drop function if exists public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid);

create or replace function public.odmeny_rucni_pridat(
  p_service_id uuid,
  p_pravidlo_id text,
  p_poznamka text,
  p_obdobi text,
  p_ticket_id uuid default null,
  p_zaklad numeric default null,
  p_user_id uuid default null,
  -- pobočka: kde se odměna bez zakázky přidala (aktivní pobočka v aplikaci);
  -- u odměny k zakázce se bere pobočka zakázky. Kontrola v triggeru.
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_user uuid;
  v_auto boolean := false;
  v_stav text;
  v_radek public.odmeny_rucni;
begin
  if v_uid is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;
  -- Definer obchází hradbu: vypnutý servis / propadlý přístup se hlídá tady.
  if not (p_service_id = any (public.servisy_kde_smim_pracovat())) then
    raise exception 'Servis je vypnutý nebo nemá platné předplatné.' using errcode = '42501';
  end if;
  v_admin := public.odmeny_je_spravce(p_service_id);
  v_user := coalesce(p_user_id, v_uid);
  if not v_admin and v_user <> v_uid then
    raise exception 'Odměnu si můžete přidat jen sami sobě.' using errcode = '42501';
  end if;
  if p_obdobi is null or p_obdobi !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Neplatný měsíc (čeká se RRRR-MM).' using errcode = '22023';
  end if;
  if p_zaklad is not null and (p_zaklad < 0 or p_zaklad > 100000000) then
    raise exception 'Neplatná cena.' using errcode = '22023';
  end if;

  if v_admin then
    v_stav := 'schvaleno';
  elsif exists (select 1 from public.odmeny_auto_schvaleni a where a.service_id = p_service_id and a.user_id = v_uid) then
    v_stav := 'schvaleno';
    v_auto := true;
  else
    v_stav := 'ceka';
  end if;

  -- Částku, název pravidla, kontrolu zakázky a příjemce dělá trigger.
  insert into public.odmeny_rucni (service_id, user_id, pravidlo_id, poznamka, ticket_id, obdobi, zaklad, stav, automaticky, vytvoril, branch_id)
  values (p_service_id, v_user, p_pravidlo_id, p_poznamka, p_ticket_id, p_obdobi, p_zaklad, v_stav, v_auto, v_uid, p_branch_id)
  returning * into v_radek;

  return jsonb_build_object(
    'id', v_radek.id, 'stav', v_radek.stav, 'castka', v_radek.castka,
    'pravidlo', v_radek.pravidlo_nazev, 'automaticky', v_radek.automaticky,
    'pobocka', v_radek.branch_id -- pobočka
  );
end;
$$;

revoke all on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid, uuid) from public, anon;
grant execute on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid, uuid) to authenticated;
comment on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid, uuid) is
  'Odměny týmu: přidá ruční odměnu podle pravidla (částku spočítá server). Zaměstnanec jen sobě, čeká na schválení (nebo automaticky schváleno); správce komukoli, rovnou schváleno. p_branch_id = pobočka odměny bez zakázky (u zakázky pobočka zakázky).';

-- ---------------------------------------------------------------------------
-- 3) odmeny_prehled s pobočkou
-- ---------------------------------------------------------------------------
drop function if exists public.odmeny_prehled(uuid, timestamptz, timestamptz, text);

create or replace function public.odmeny_prehled(
  p_service_id uuid,
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_tz text default 'Europe/Prague',
  p_branch_id uuid default null -- pobočka: null = všechny
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
  -- root: majitel aplikace, kterého volající nesmí vidět (null = nikdo).
  v_skryty uuid := public.root_owner_skryty_id();
begin
  if v_uid is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;
  v_admin := public.odmeny_je_spravce(p_service_id);
  -- pobočka: jen pobočka tohoto servisu, na kterou volající vidí (člen
  -- omezený na pobočku si cizí nevyžádá – stejná kontrola jako u zakázek).
  if p_branch_id is not null then
    if not exists (select 1 from public.branches b where b.id = p_branch_id and b.service_id = p_service_id) then
      raise exception 'Pobočka nepatří tomuto servisu.' using errcode = '22023';
    end if;
    if not public.pobocka_povolena(p_service_id, p_branch_id) then
      raise exception 'Na tuto pobočku nemáte přístup.' using errcode = '42501';
    end if;
  end if;

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
      st.label as stav_nazev, -- čeká: stav nevydané zakázky
      -- kdy: skutečné datum vydání (jen u zakázky v koncovém stavu).
      case when st.is_final then coalesce(t.completed_at, t.updated_at) end as vydano_at,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy
    from public.tickets t
    left join stavy st on st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = p_service_id
      and t.deleted_at is null
      and not public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label)
      -- pobočka: zakázka patří pobočce, kde byla přijata (branch_id), jako ve
      -- Statistikách; bez pobočky patří každé. Odtud se filtr propíše do
      -- řádků, součtů, měsíční řady i do cekajiciNaZapocteni.
      and (p_branch_id is null or t.branch_id is null or t.branch_id = p_branch_id)
      and (case
        when v_rezim = 'vydani' then
          coalesce(st.is_final, false)
          and coalesce(t.completed_at, t.updated_at) >= least(v_od, v_od12)
          and coalesce(t.completed_at, t.updated_at) <= greatest(v_do, now())
        else t.updated_at >= least(v_od, v_od12)
      end
      -- čeká: navíc nevydané zakázky s označenou opravou (příznak, nebo
      -- správce přepsal na nabídnuto). Jejich položky bez data započtení
      -- jdou jen do cekajiciNaZapocteni; ty s datem mimo okno vyřadí
      -- `polozky` stejně jako dřív. Režim přidání nemá co čekat.
      or (
        v_rezim <> 'pridani'
        and not coalesce(st.is_final, false)
        and (
          t.performed_repairs @> '[{"nabidnuto": true}]'::jsonb
          or exists (
            select 1 from public.odmeny_upravy u0
            where u0.service_id = p_service_id and u0.ticket_id = t.id and u0.nabidnuto
          )
        )
      )
    )
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
      z.stav,       -- čeká
      z.stav_nazev, -- čeká
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
  -- čeká: a označené položky bez data (ještě nezapočtené) – ty z
  -- `viditelne` a součtů vypadnou na podmínce zapocteno_at is not null.
  polozky as (
    select * from polozky_vse p
    where (p.zapocteno_at is not null
        and p.zapocteno_at >= least(v_od, v_od12)
        and p.zapocteno_at <= greatest(v_do, now()))
      or (p.zapocteno_at is null
        and (p.nabidnuto_priznak or exists (
          select 1 from public.odmeny_upravy u1
          where u1.service_id = p_service_id and u1.ticket_id = p.ticket_id
            and u1.polozka_id = p.polozka_id and u1.nabidnuto
        )))
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
      -- root: odměna přiřazená majiteli aplikace je pro ostatní „Nepřiřazeno“.
      nullif(case
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
      end, v_skryty) as komu_uid
    from shody s
    -- audit 4: páruje se i podle servisu (úprava s cizím servisem se nepočítá).
    left join public.odmeny_upravy u on u.service_id = p_service_id and u.ticket_id = s.ticket_id and u.polozka_id = s.polozka_id
  ),
  -- Co smí volající vidět: správce vše, člen svoje, cizí jen s veřejným žebříčkem.
  viditelne as (
    select * from prirazene p
    where p.zapocteno_at is not null -- čeká: nezapočtené jen v cekajici_zapocteni
      and (v_admin or p.komu_uid = v_uid or v_verejny)
  ),
  -- čeká: označené opravy, které se ještě nezapočetly (nevydaná zakázka,
  -- nebo zakázka zatím nedosáhla stavu). Správce vše, člen jen svoje – bez
  -- ohledu na veřejný žebříček – a jen u zakázek, které vidí (pobočka).
  cekajici_zapocteni as (
    select * from prirazene p
    where p.zapocteno_at is null
      and p.nabidnuto
      -- zamítnutí: vyřazenou (zamítnutou) čekající položku vidí jen správce,
      -- označenou, aby ji mohl vrátit; člen ji nevidí.
      and (not p.vyrazeno or v_admin)
      and (v_admin or (
        p.komu_uid = v_uid
        and public.zakazka_viditelna_podle_mista(p_service_id, p.branch_id, p.location_branch_id)
      ))
    order by p.code desc nulls last, p.polozka_id
    limit 200
  ),
  v_obdobi as (
    select * from viditelne where zapocteno_at >= v_od and zapocteno_at <= v_do -- kdy
  ),
  -- ruční: všechny ruční odměny servisu, které volající smí vidět (stejně
  -- jako RLS odmeny_rucni_cteni: správce vše, člen svoje – příjemce nebo
  -- autor – a při veřejném žebříčku schválené ostatních).
  rucni_servis as (
    select
      r.*,
      (r.user_id = v_uid or r.vytvoril = v_uid) as moje,
      t.code as kod,
      t.customer_name,
      coalesce(nullif(btrim(t.title), ''), t.device_label) as zarizeni,
      -- Zakázku (číslo, id) jen když ji volající vidí (audit 4).
      (t.id is not null and (v_admin or public.zakazka_viditelna_podle_mista(t.service_id, t.branch_id, t.location_branch_id))) as zakazka_videt,
      -- pobočka: s zakázkou podle pobočky zakázky (bez pobočky = každá),
      -- bez zakázky podle pobočky, ve které byla přidána (odmeny_rucni.branch_id);
      -- bez obojího jen při „Všechny pobočky“.
      (p_branch_id is null or case
        when t.id is not null then t.branch_id is null or t.branch_id = p_branch_id
        else r.branch_id = p_branch_id
      end) as v_pobocce
    from public.odmeny_rucni r
    left join public.tickets t on t.id = r.ticket_id and t.service_id = r.service_id
    where r.service_id = p_service_id
      and (v_admin or r.user_id = v_uid or r.vytvoril = v_uid or (v_verejny and r.stav = 'schvaleno'))
  ),
  rucni_vse as (
    select * from rucni_servis where v_pobocce -- pobočka
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
    select nullif(user_id, v_skryty), castka, 1 from rucni_obdobi where stav = 'schvaleno' -- root
  ),
  soucty_mesice as (
    select to_char(zapocteno_at at time zone v_tz, 'YYYY-MM') as mesic, komu_uid, castka
    from viditelne
    where not vyrazeno and nabidnuto and zapocteno_at >= v_od12
    union all
    select obdobi, nullif(user_id, v_skryty), castka from rucni_schvalene -- root
  ),
  jmena as (
    select m.user_id, coalesce(nullif(btrim(pr.nickname), ''), 'Kolega') as jmeno, pr.avatar_url
    from public.service_memberships m
    left join public.profiles pr on pr.id = m.user_id
    where m.service_id = p_service_id
      and m.user_id is distinct from v_skryty -- root
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
    -- pobočka: za kterou pobočku čísla jsou (null = všechny). Klient podle
    -- klíče pozná, že server filtr umí.
    'pobocka', p_branch_id,
    -- pobočka: čekající ruční odměny, které ve vybrané pobočce nejsou vidět
    -- (jiná pobočka, nebo bez zakázky a bez pobočky) – ať je správce
    -- při schvalování nepřehlédne.
    'cekajiciJinde', (
      select count(*) from rucni_servis r where r.stav = 'ceka' and (v_admin or r.moje) and not r.v_pobocce
    ),
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
        and v.user_id is distinct from v_skryty -- root
        and v.obdobi >= to_char(v_od12 at time zone v_tz, 'YYYY-MM')
    ), '[]'::jsonb),
    -- ruční: odměny vybraného období. Čekající a zamítnuté jen správce
    -- a „moje“ (příjemce / autor). Zákazník a zařízení jen správci a u
    -- vlastních, číslo zakázky jen u viditelné zakázky.
    'rucni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'userId', nullif(r.user_id, v_skryty), 'jmeno', case when r.user_id = v_skryty then 'Systém' else coalesce(j.jmeno, 'Bývalý člen') end, -- root
        'pravidloId', r.pravidlo_id, 'pravidlo', r.pravidlo_nazev, 'castka', r.castka, 'zaklad', r.zaklad,
        'poznamka', r.poznamka, 'obdobi', r.obdobi, 'stav', r.stav, 'duvodZamitnuti', r.duvod_zamitnuti,
        'automaticky', r.automaticky,
        'vytvoril', nullif(r.vytvoril, v_skryty), 'vytvorilJmeno', case when r.vytvoril = v_skryty then 'Systém' else jv.jmeno end, -- root
        'schvalil', nullif(r.schvalil, v_skryty), 'schvalilJmeno', case when r.schvalil = v_skryty then 'Systém' else js.jmeno end, 'schvalenoAt', r.schvaleno_at, -- root
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
        'id', r.id, 'userId', nullif(r.user_id, v_skryty), 'jmeno', case when r.user_id = v_skryty then 'Systém' else coalesce(j.jmeno, 'Bývalý člen') end, -- root
        'pravidloId', r.pravidlo_id, 'pravidlo', r.pravidlo_nazev, 'castka', r.castka, 'zaklad', r.zaklad,
        'poznamka', r.poznamka, 'obdobi', r.obdobi, 'stav', r.stav, 'duvodZamitnuti', r.duvod_zamitnuti,
        'automaticky', r.automaticky,
        'vytvoril', nullif(r.vytvoril, v_skryty), 'vytvorilJmeno', case when r.vytvoril = v_skryty then 'Systém' else jv.jmeno end, -- root
        'schvalil', nullif(r.schvalil, v_skryty), 'schvalilJmeno', null, 'schvalenoAt', r.schvaleno_at, -- root
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
    -- čeká: označené opravy, které se připíšou po vydání / dosažení stavu.
    'cekajiciNaZapocteni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ticketId', c.ticket_id, 'kod', c.code, 'zakaznik', c.customer_name, 'zarizeni', c.zarizeni,
        'polozkaId', c.polozka_id, 'oprava', c.oprava, 'cena', c.cena,
        'pravidloId', c.pravidlo_id, 'pravidlo', c.pravidlo,
        'userId', c.komu_uid, 'jmeno', j.jmeno, 'castka', c.castka,
        'stav', c.stav, 'stavNazev', c.stav_nazev,
        -- zamítnutí: stav úpravy správce, ať ji stránka zobrazí a umí vrátit
        -- bez ztráty přepsaného příjemce / příznaku nabídnuto.
        'vyrazeno', c.vyrazeno, 'poznamka', c.poznamka,
        'prepsano', c.prepsano, 'nabidnutoPrepsano', c.nabidnuto_prepsano
      ) order by c.code desc nulls last, c.polozka_id)
      from cekajici_zapocteni c
      left join jmena j on j.user_id = c.komu_uid
    ), '[]'::jsonb),
    -- ruční: aktivní pravidla pro dialog Přidat odměnu (stejný výběr jako výpočet).
    -- čeká: s hledaným textem, aby dialog poznal označenou opravu na zakázce.
    'pravidla', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nazev', p.nazev, 'typ', p.typ, 'hodnota', p.hodnota, 'hledat', p.hledat) order by p.ord)
      from pravidla p
    ), '[]'::jsonb),
    -- ruční: komu se schvaluje automaticky – správce všechny, člen jen sebe.
    'autoSchvaleni', coalesce((
      select jsonb_agg(a.user_id)
      from public.odmeny_auto_schvaleni a
      where a.service_id = p_service_id and (v_admin or a.user_id = v_uid)
        and a.user_id is distinct from v_skryty -- root
    ), '[]'::jsonb)
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

comment on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text, uuid) is
  'Odměny týmu: řádky za období (podle režimu config.odmeny.kdy: data vydání zakázky, přidání opravy, nebo prvního dosažení stavu), součty na člověka (včetně schválených ručních odměn podle obdobi), měsíční řada 12 měsíců zpět, vyplaceno, ruční odměny (rucni, cekajici), aktivní pravidla a automatické schvalování; cekajiciNaZapocteni = označené opravy, které se ještě nezapočetly (nevydaná zakázka / stav nedosažen). Majitel aplikace je pro ostatní neviditelný (Nepřiřazeno / Systém). p_branch_id = jen zakázky pobočky (podle branch_id, bez pobočky patří každé) a ruční odměny té pobočky; null = všechny.';
revoke all on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text, uuid) to authenticated;
