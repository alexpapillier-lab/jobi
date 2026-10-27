-- Provize: žádné nulové doplatky
-- ============================================================================
--
-- PROČ: Když se po vyúčtování zakázky její cena na chvíli zvedla, vznikl
-- doplatek. Když se pak vrátila zpátky (typicky: vypnout a zase zapnout
-- vyloučené opravy „bat, těl“), synchronizace doplatek jen srazila na 0 Kč
-- a nechala ho viset. 27. 10. 2026 jich tak u vyúčtovaných zakázek visělo
-- šest a šly by do dalšího vyúčtování jako prázdné řádky.
--
-- Nově se nevyúčtovaný doplatek, ze kterého by zbyla nula nebo méně, smaže.
-- První řádek zakázky (poradi = 0) se dál jen upravuje – ten nese vyřazení
-- a rozhodnutí majitele. Jinak beze změny proti 20261005130000.
--
-- Úklid: nevyúčtované nulové doplatky se smažou. Vyúčtované (pět z 20. 10.)
-- zůstávají, patří k uzavřenému vyúčtování.

create or replace function public.provize_synchronizuj_interni(p_service_id uuid, p_nanecisto boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n public.provize_nastaveni;
  r record;
  v_total numeric;
  v_pocet integer;
  v_posl public.provize_polozky;
  v_prvni public.provize_polozky;
  v_rozdil numeric;
  v_nove integer := 0;
  v_doplatky integer := 0;
  v_upraveno integer := 0;
  v_vyloucene integer := 0;
  v_ke_kontrole integer := 0;
  v_cena numeric;
  v_pocitat_vse boolean;
  v_rucni numeric;
  v_zmena_nejasnych boolean;
  v_nejasna boolean;
  v_zmeny jsonb := '[]'::jsonb;
  v_vysledek jsonb;
begin
  select * into n from public.provize_nastaveni where service_id = p_service_id;
  if not found or not n.zapnuto then
    return jsonb_build_object('ok', false, 'duvod', 'provize nejsou pro servis zapnuté');
  end if;

  for r in
    select t.id, t.code, s.label,
           public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value, n.vylouceny_opravy) as cena,
           public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value, null::text[]) as cena_vse,
           public.provize_nejasne_opravy(t.performed_repairs, n.vylouceny_opravy) as nejasne
    from public.tickets t
    join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
    where t.service_id = p_service_id
      and t.deleted_at is null
      and t.code is not null and btrim(t.code) <> ''
      and s.label = any (n.statusy)
      and public.provize_odpovida_filtru(n.filtr, t.title, t.device_label, t.device_brand, t.device_model)
      and (
        n.od is null
        or t.created_at >= n.od
        or exists (select 1 from public.provize_polozky p where p.service_id = t.service_id and p.zakazka_kod = t.code)
        or exists (
          select 1 from public.ticket_history h
          where h.ticket_id = t.id
            and h.created_at >= n.od
            and h.details -> 'changes' -> 'status' ->> 'new' in (
              select ss.key from public.service_statuses ss
              where ss.service_id = p_service_id and ss.label = any (n.statusy)
            )
        )
      )
    order by t.created_at
  loop
    v_nejasna := cardinality(r.nejasne) > 0;

    select coalesce(sum(zaklad), 0), count(*), coalesce(bool_or(pocitat_vse), false)
    into v_total, v_pocet, v_pocitat_vse
    from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code;

    if v_pocet = 0 then
      if v_nejasna then
        v_ke_kontrole := v_ke_kontrole + 1;
      end if;
      -- Zakázka, na které jsou jen vyloučené opravy, se zapíše jako vyřazená
      -- s nulou a plnou cenou vedle: ať je vidět, co se vyloučilo, a jde to
      -- jedním klikem započítat. Zakázka bez oprav (cena_vse = 0) jako dřív.
      if r.cena = 0 and r.cena_vse > 0 then
        v_vyloucene := v_vyloucene + 1;
        v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'vyloucena', 'zaklad_plny', r.cena_vse, 'status', r.label, 'ke_kontrole', v_nejasna);
        if not p_nanecisto then
          insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status, vyrazeno, poznamka, zaklad_plny, ke_kontrole, nejasne_opravy)
          values (p_service_id, r.id, r.code, 0, 0, n.sazba, 0, r.label, true, 'jen vyloučené opravy', r.cena_vse, v_nejasna, case when v_nejasna then r.nejasne end);
        end if;
        continue;
      end if;
      v_nove := v_nove + 1;
      v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'nova', 'zaklad', r.cena, 'status', r.label, 'ke_kontrole', v_nejasna);
      if not p_nanecisto then
        insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status, zaklad_plny, ke_kontrole, nejasne_opravy)
        values (p_service_id, r.id, r.code, 0, r.cena, n.sazba, round(r.cena * n.sazba, 2), r.label, r.cena_vse, v_nejasna, case when v_nejasna then r.nejasne end);
      end if;
      continue;
    end if;

    select * into v_prvni from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code and poradi = 0;

    -- Nejasné položky se změnily (zakázku někdo upravil, nebo se změnil
    -- seznam vyloučených slov) → staré rozhodnutí neplatí.
    v_zmena_nejasnych := coalesce(v_prvni.nejasne_opravy, array[]::text[]) is distinct from r.nejasne;
    v_rucni := case when v_zmena_nejasnych then null else v_prvni.rucni_zaklad end;

    -- Pořadí přednosti: ruční částka > „započítat plně“ > automat.
    v_cena := case
      when v_rucni is not null then v_rucni
      when v_pocitat_vse then r.cena_vse
      else r.cena end;

    if v_nejasna and v_prvni.vyuctovani_id is null
       and (v_zmena_nejasnych or v_prvni.zkontrolovano_at is null) then
      v_ke_kontrole := v_ke_kontrole + 1;
    end if;

    -- Plná cena a stav kontroly se u první položky drží aktuální i beze
    -- změny základu. Vyúčtovaný řádek už ke kontrole není – rozhodnutí by
    -- přišlo pozdě, zdražení jde do doplatku jako dřív.
    if not p_nanecisto then
      update public.provize_polozky
      set zaklad_plny = r.cena_vse,
          nejasne_opravy = case when v_nejasna then r.nejasne end,
          ke_kontrole = v_nejasna and vyuctovani_id is null
                        and (v_zmena_nejasnych or zkontrolovano_at is null),
          zkontrolovano_at = case when v_zmena_nejasnych then null else zkontrolovano_at end,
          rucni_zaklad = case when v_zmena_nejasnych then null else rucni_zaklad end
      where id = v_prvni.id
        and (zaklad_plny is distinct from r.cena_vse
             or v_zmena_nejasnych
             or ke_kontrole is distinct from (v_nejasna and vyuctovani_id is null and zkontrolovano_at is null));
    end if;

    v_rozdil := v_cena - v_total;
    if v_rozdil = 0 then
      continue;
    end if;

    select * into v_posl from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code
    order by poradi desc limit 1;

    if v_posl.vyuctovani_id is null then
      -- Nevyúčtovaný řádek drží aktuální cenu. Importovaný jen nahoru: tabulka
      -- cenu nikdy nesnižovala a rozdíl může být jen jiným zaokrouhlením importu.
      if v_rozdil > 0 or not v_posl.importovano then
        v_upraveno := v_upraveno + 1;
        if v_cena = 0 and r.cena_vse > 0 then
          v_vyloucene := v_vyloucene + 1;
        end if;
        -- Nevyúčtovaný doplatek, ze kterého by zbyla nula (nebo méně), se
        -- smaže. Vznikal tak, že se cena zakázky po vyúčtování na chvíli
        -- zvedla (třeba vypnutím vyloučených oprav) a pak zase vrátila;
        -- nulový řádek pak strašil v dalším vyúčtování.
        if v_posl.poradi > 0 and v_posl.zaklad + v_rozdil <= 0 then
          v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'uprava', 'z', v_posl.zaklad, 'na', 0);
          if not p_nanecisto then
            delete from public.provize_polozky where id = v_posl.id;
          end if;
          continue;
        end if;
        v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'uprava', 'z', v_posl.zaklad, 'na', greatest(0, v_posl.zaklad + v_rozdil));
        if not p_nanecisto then
          update public.provize_polozky
          set zaklad = greatest(0, zaklad + v_rozdil),
              provize = round(greatest(0, zaklad + v_rozdil) * coalesce(sazba, n.sazba), 2),
              sazba = coalesce(sazba, n.sazba),
              status = r.label,
              ticket_id = coalesce(ticket_id, r.id),
              vyrazeno = case
                when v_cena = 0 and r.cena_vse > 0 then true
                when poznamka = 'jen vyloučené opravy' then false
                else vyrazeno end,
              poznamka = case
                when v_cena = 0 and r.cena_vse > 0 then 'jen vyloučené opravy'
                when poznamka = 'jen vyloučené opravy' then null
                else poznamka end
          where id = v_posl.id;
        end if;
      end if;
    elsif v_rozdil > 0 then
      v_doplatky := v_doplatky + 1;
      v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'doplatek', 'zaklad', v_rozdil);
      if not p_nanecisto then
        insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status)
        values (p_service_id, r.id, r.code, v_posl.poradi + 1, v_rozdil, n.sazba, round(v_rozdil * n.sazba, 2), r.label);
      end if;
    end if;
  end loop;

  -- Sledované stavy platí i zpětně (beze změny proti 20260926130000).
  if not p_nanecisto then
    update public.provize_polozky p
    set vyrazeno = true, poznamka = 'stav mimo sledované'
    from public.tickets t
    left join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
    where p.service_id = p_service_id and p.vyuctovani_id is null and p.poradi = 0 and not p.vyrazeno
      and t.id = p.ticket_id and t.deleted_at is null
      and (s.label is null or not (s.label = any (n.statusy)));

    update public.provize_polozky p
    set vyrazeno = false, poznamka = null
    from public.tickets t
    join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
    where p.service_id = p_service_id and p.vyuctovani_id is null and p.poznamka = 'stav mimo sledované'
      and t.id = p.ticket_id and s.label = any (n.statusy);
  end if;

  v_vysledek := jsonb_build_object('ok', true, 'nanecisto', p_nanecisto, 'nove', v_nove, 'doplatky', v_doplatky, 'upraveno', v_upraveno, 'vyloucene', v_vyloucene, 'ke_kontrole', v_ke_kontrole);
  if not p_nanecisto then
    update public.provize_nastaveni
    set posledni_sync_at = now(), posledni_sync = v_vysledek
    where service_id = p_service_id;
  end if;
  return v_vysledek || jsonb_build_object('zmeny', v_zmeny);
end;
$function$;

delete from public.provize_polozky
where poradi > 0 and vyuctovani_id is null and zaklad = 0;
