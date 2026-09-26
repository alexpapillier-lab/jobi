-- Provize: odebraný sledovaný stav vyřadí jeho zakázky, vrácený je zase započítá
--
-- PROČ: Po odebrání stavu (např. „Připraveno k převzetí“) z nastavení
-- zůstaly řádky jeho zakázek v provizích a po vrácení nic nepřibylo –
-- částka k vyúčtování na nastavení nereagovala.

create or replace function public.provize_synchronizuj_interni(p_service_id uuid, p_nanecisto boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.provize_nastaveni;
  r record;
  v_total numeric;
  v_pocet integer;
  v_posl public.provize_polozky;
  v_rozdil numeric;
  v_nove integer := 0;
  v_doplatky integer := 0;
  v_upraveno integer := 0;
  v_vyloucene integer := 0;
  v_cena numeric;
  v_pocitat_vse boolean;
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
           public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value, null::text[]) as cena_vse
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
    select coalesce(sum(zaklad), 0), count(*), coalesce(bool_or(pocitat_vse), false)
    into v_total, v_pocet, v_pocitat_vse
    from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code;

    -- Majitel může u zakázky říct „počítej i vyloučené opravy“ – pak platí plná cena.
    v_cena := case when v_pocitat_vse then r.cena_vse else r.cena end;

    if v_pocet = 0 then
      -- Zakázka, na které jsou jen vyloučené opravy, se zapíše jako vyřazená
      -- s nulou a plnou cenou vedle: ať je vidět, co se vyloučilo, a jde to
      -- jedním klikem započítat. Zakázka bez oprav (cena_vse = 0) jako dřív.
      if r.cena = 0 and r.cena_vse > 0 then
        v_vyloucene := v_vyloucene + 1;
        v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'vyloucena', 'zaklad_plny', r.cena_vse, 'status', r.label);
        if not p_nanecisto then
          insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status, vyrazeno, poznamka, zaklad_plny)
          values (p_service_id, r.id, r.code, 0, 0, n.sazba, 0, r.label, true, 'jen vyloučené opravy', r.cena_vse);
        end if;
        continue;
      end if;
      v_nove := v_nove + 1;
      v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'nova', 'zaklad', r.cena, 'status', r.label);
      if not p_nanecisto then
        insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status, zaklad_plny)
        values (p_service_id, r.id, r.code, 0, r.cena, n.sazba, round(r.cena * n.sazba, 2), r.label, r.cena_vse);
      end if;
      continue;
    end if;

    -- Plná cena se u první položky drží aktuální i beze změny základu.
    if not p_nanecisto then
      update public.provize_polozky set zaklad_plny = r.cena_vse
      where service_id = p_service_id and zakazka_kod = r.code and poradi = 0 and zaklad_plny is distinct from r.cena_vse;
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
      -- Proto se u importovaných řádků vyloučené opravy neprojeví; ty přišly
      -- jako hotová cena, která se na opravy nerozpadá.
      if v_rozdil > 0 or not v_posl.importovano then
        v_upraveno := v_upraveno + 1;
        if v_cena = 0 and r.cena_vse > 0 then
          v_vyloucene := v_vyloucene + 1;
        end if;
        v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'uprava', 'z', v_posl.zaklad, 'na', greatest(0, v_posl.zaklad + v_rozdil));
        if not p_nanecisto then
          -- Řádek, ze kterého vyloučené opravy udělaly nulu, se vyřadí
          -- (nemaže se, ať je vidět proč). Když se seznam vyloučených oprav
          -- zase zúží, vlastní značka se sama sundá; ručně vyřazené řádky
          -- zůstanou vyřazené, ty poznámku nemají.
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

  -- Sledované stavy platí i zpětně: nevyúčtovaná zakázka, která teď ve
  -- sledovaném stavu není (stav se odebral z nastavení, nebo se zakázka
  -- vrátila do opravy), se vyřadí s poznámkou; jakmile v něm zase je,
  -- vrátí se sama. Částka „k vyúčtování“ tak odpovídá nastavení.
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

  v_vysledek := jsonb_build_object('ok', true, 'nanecisto', p_nanecisto, 'nove', v_nove, 'doplatky', v_doplatky, 'upraveno', v_upraveno, 'vyloucene', v_vyloucene);
  if not p_nanecisto then
    update public.provize_nastaveni
    set posledni_sync_at = now(), posledni_sync = v_vysledek
    where service_id = p_service_id;
  end if;
  return v_vysledek || jsonb_build_object('zmeny', v_zmeny);
end;
$$;

revoke all on function public.provize_synchronizuj_interni(uuid, boolean) from public, anon, authenticated;
grant execute on function public.provize_synchronizuj_interni(uuid, boolean) to service_role;
