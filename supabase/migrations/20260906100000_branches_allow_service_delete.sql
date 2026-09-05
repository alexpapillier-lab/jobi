-- Mazání servisu vs. výchozí pobočka.
--
-- Trigger na pobočkách hlídá, že výchozí pobočka nezmizí a servis tak neztratí
-- místo, kam sázet zakázky. Při mazání celého servisu ale kaskáda smaže i tu
-- výchozí a trigger celé mazání shodil chybou „Výchozí pobočku nelze smazat“.
-- Stejnou výjimku už používá kontrola posledního vlastníka: funkce
-- delete_service_for_root nastaví app.deleting_service_id, a dokud se maže
-- právě tenhle servis, triggery ustoupí.
create or replace function public.branches_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_default
     and coalesce(current_setting('app.deleting_service_id', true), '') <> old.service_id::text then
    raise exception 'Výchozí pobočku nelze smazat. Nejdřív nastavte jako výchozí jinou pobočku.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

-- Přesouvání zakázek pod výchozí pobočku nemá při mazání servisu smysl –
-- za chvíli je smaže stejná kaskáda.
create or replace function public.branches_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default uuid;
begin
  if coalesce(current_setting('app.deleting_service_id', true), '') = old.service_id::text then
    return old;
  end if;
  v_default := public.default_branch_id(old.service_id);
  if v_default is null then return old; end if;
  update public.tickets set branch_id = v_default where service_id = old.service_id and branch_id is null;
  update public.warranty_claims set branch_id = v_default where service_id = old.service_id and branch_id is null;
  update public.invoices set branch_id = v_default where service_id = old.service_id and branch_id is null;
  update public.inventory_warehouses set branch_id = v_default where service_id = old.service_id and branch_id is null;
  return old;
end;
$$;
