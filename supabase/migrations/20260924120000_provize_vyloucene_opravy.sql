-- Provize: opravy, ze kterých se provize nepočítá (výměna těla, baterie…)
-- ============================================================================
--
-- PROČ: Provize 7,5 % se platí z opravy, ne z dílu. U Dysonů jsou ale na
-- zakázce i položky jako „výměna těla“ nebo „výměna baterie“, kde je skoro
-- celá cena nákup dílu – ty se do základu počítat nemají. Filtr zařízení
-- (provize_nastaveni.filtr) na to nestačí, protože vyřazuje celou zakázku;
-- tohle vyřazuje jednotlivé opravy uvnitř ní.
--
-- Zakázka se tedy počítá dál, jen se jí základ sníží o vyloučené opravy.
-- Když na zakázce nezbude nic jiného, do provizí se vůbec nezapíše.
--
-- Sleva se rozdělí poměrem: u procentní slevy vyjde totéž, jako by se
-- procento počítalo rovnou ze zbylých oprav; u slevy částkou se na vyloučené
-- opravy strhne jen jejich díl, aby sleva za díl nesnižovala provizní základ
-- z práce.
--
-- Importu z Google tabulky se to netýká. Tam přišla jen hotová cena zakázky,
-- která se na jednotlivé opravy nerozpadá, takže není co vyloučit.

alter table public.provize_nastaveni add column if not exists vylouceny_opravy text[];

comment on column public.provize_nastaveni.vylouceny_opravy is
  'Názvy oprav, které se nepočítají do provizního základu. Hledá se podřetězec včetně diakritiky, na velikosti písmen nezáleží – proto kmen slova, např. {těl, bater}: „tělo“ by na „výměna těla“ nesedlo. NULL nebo prázdné = počítají se všechny.';

-- ── Počítá se tahle oprava? ─────────────────────────────────────────────────
-- Shoduje se stejně jako filtr zařízení: hledá podřetězec bez ohledu na
-- velikost písmen, prázdná slova v seznamu ignoruje (jinak by prázdný řetězec
-- sedl na všechno a vyřadil celou zakázku).
create or replace function public.provize_oprava_zapocitana(p_nazev text, p_vylouceno text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select not exists (
    select 1
    from unnest(coalesce(p_vylouceno, array[]::text[])) as v(slovo)
    where nullif(btrim(coalesce(v.slovo, '')), '') is not null
      and position(lower(btrim(v.slovo)) in lower(coalesce(p_nazev, ''))) > 0
  );
$$;

comment on function public.provize_oprava_zapocitana(text, text[]) is
  'False, když název opravy obsahuje některé z vyloučených slov. Prázdný seznam = počítá se vše.';

-- ── Základ provize se slevou a vyloučenými opravami ─────────────────────────
-- Vzorec zůstává stejný jako v src/lib/slevaZakazky.ts: součet cen oprav na
-- haléře, sleva nejvýš do výše ceny, výsledek nezáporný. Navíc se ze součtu
-- vyřadí opravy ze seznamu a sleva se rozdělí poměrem obou částí.
create or replace function public.provize_cena(p_opravy jsonb, p_typ text, p_hodnota numeric, p_vylouceno text[])
returns numeric
language sql
immutable
set search_path = public
as $$
  with o as (
    select
      case when jsonb_typeof(r -> 'price') = 'number' then (r ->> 'price')::numeric
           when (r ->> 'price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r ->> 'price')::numeric
           else 0 end as cena,
      public.provize_oprava_zapocitana(r ->> 'name', p_vylouceno) as pocita
    from jsonb_array_elements(case when jsonb_typeof(p_opravy) = 'array' then p_opravy else '[]'::jsonb end) r
  ), h as (
    select round(coalesce(sum(cena), 0), 2) as hruba,
           round(coalesce(sum(cena) filter (where pocita), 0), 2) as zapocitana
    from o
  ), s as (
    select hruba, zapocitana,
      case
        when p_typ is null or coalesce(p_hodnota, 0) <= 0 or hruba <= 0 then 0
        when p_typ = 'percentage' then least(hruba, round(hruba * p_hodnota / 100, 2))
        when p_typ = 'amount' then least(hruba, round(p_hodnota, 2))
        else 0
      end as sleva
    from h
  )
  select greatest(0, round(zapocitana - case when hruba > 0 then sleva * zapocitana / hruba else 0 end, 2))
  from s;
$$;

-- Původní tříparametrová podoba zůstává (volá ji starší kód) a znamená
-- „nic nevyloučeno“. Nesmí mít default na čtvrtém parametru, jinak by byla
-- volání se třemi argumenty nejednoznačná.
create or replace function public.provize_cena(p_opravy jsonb, p_typ text, p_hodnota numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select public.provize_cena(p_opravy, p_typ, p_hodnota, null::text[]);
$$;

-- ── Synchronizace ze zakázek ────────────────────────────────────────────────
-- Proti předchozí verzi: základ se počítá s vyloučenými opravami a zakázka,
-- na které po vyřazení nic nezbude, se do provizí nezapisuje.
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
    select coalesce(sum(zaklad), 0), count(*) into v_total, v_pocet
    from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code;

    if v_pocet = 0 then
      -- Zakázka, na které jsou jen vyloučené opravy, se nezapíše vůbec.
      -- Nulový řádek by byl jen šum v seznamu k vyúčtování. Zakázka bez
      -- oprav (cena_vse = 0) se zapisuje dál jako dřív.
      if r.cena = 0 and r.cena_vse > 0 then
        v_vyloucene := v_vyloucene + 1;
        continue;
      end if;
      v_nove := v_nove + 1;
      v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'nova', 'zaklad', r.cena, 'status', r.label);
      if not p_nanecisto then
        insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status)
        values (p_service_id, r.id, r.code, 0, r.cena, n.sazba, round(r.cena * n.sazba, 2), r.label);
      end if;
      continue;
    end if;

    v_rozdil := r.cena - v_total;
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
        if r.cena = 0 and r.cena_vse > 0 then
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
                when r.cena = 0 and r.cena_vse > 0 then true
                when poznamka = 'jen vyloučené opravy' then false
                else vyrazeno end,
              poznamka = case
                when r.cena = 0 and r.cena_vse > 0 then 'jen vyloučené opravy'
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
