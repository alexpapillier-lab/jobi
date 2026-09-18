-- Provize: vyúčtování se jmenuje podle dne, kdy se udělalo, ne podle týdne
--
-- Týdenní označení (2026-W38) bylo převzaté z Google tabulky. Vyúčtovává se
-- ale ručně a nepravidelně – uzavře se vše, co je v tu chvíli nevyúčtované –
-- takže týden jen mátl. Historická vyúčtování z tabulky si označení nechávají.

create or replace function public.provize_vyuctuj(p_service_id uuid, p_oznaceni text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oznaceni text := nullif(btrim(coalesce(p_oznaceni, '')), '');
  v_id bigint;
  v_pocet integer;
  v_zaklad numeric;
  v_provize numeric;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;

  perform public.provize_synchronizuj_interni(p_service_id, false);

  -- Výchozí označení je datum vyúčtování (např. „18. 9. 2026“), ne týden:
  -- vyúčtovává se ručně, kdykoli se to hodí, a uzavře se vše nevyúčtované.
  -- Druhé vyúčtování téhož dne dostane i čas, ať se dají rozlišit.
  if v_oznaceni is null then
    v_oznaceni := to_char(now() at time zone 'Europe/Prague', 'FMDD. FMMM. YYYY');
    if exists (select 1 from public.provize_vyuctovani where service_id = p_service_id and oznaceni = v_oznaceni) then
      v_oznaceni := v_oznaceni || to_char(now() at time zone 'Europe/Prague', ' HH24:MI');
    end if;
  end if;

  select count(*), coalesce(sum(zaklad), 0), coalesce(sum(provize), 0)
  into v_pocet, v_zaklad, v_provize
  from public.provize_polozky
  where service_id = p_service_id and vyuctovani_id is null and not vyrazeno;

  if v_pocet = 0 then
    return jsonb_build_object('ok', true, 'pocet', 0, 'oznaceni', v_oznaceni);
  end if;

  insert into public.provize_vyuctovani (service_id, oznaceni, pocet, soucet_zaklad, soucet_provize)
  values (p_service_id, v_oznaceni, v_pocet, v_zaklad, v_provize)
  returning id into v_id;

  update public.provize_polozky
  set vyuctovani_id = v_id
  where service_id = p_service_id and vyuctovani_id is null and not vyrazeno;

  return jsonb_build_object('ok', true, 'id', v_id, 'oznaceni', v_oznaceni, 'pocet', v_pocet, 'soucet_zaklad', v_zaklad, 'soucet_provize', v_provize);
end;
$$;

revoke all on function public.provize_vyuctuj(uuid, text) from public, anon;
grant execute on function public.provize_vyuctuj(uuid, text) to authenticated;
