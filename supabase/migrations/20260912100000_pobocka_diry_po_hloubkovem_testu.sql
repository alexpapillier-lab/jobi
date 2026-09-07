-- Pobočky – díry nalezené při hloubkovém testu modulu (12. 9.).
--
-- Modul se prodává jako příplatek za pobočku, takže „člen omezený na pobočku“
-- musí platit doslova. Test našel sedm míst, kde neplatil:
--
--  1) Omezený člen si sám přepsal domovskou pobočku (set_member_home_branch
--     dovoluje „sám sobě“) a tím si otevřel cizí pobočku. Celé omezení šlo
--     obejít jedním voláním RPC z konzole prohlížeče.
--  2) Omezený člen BEZ domovské pobočky viděl všechno. Podmínka
--     `v_home is null` znamenala „neomezovat“ místo „nemá kam vidět“ – a to
--     nastane samo, když se smaže pobočka, na kterou byl navázaný (cizí klíč
--     ji nastaví na NULL). Zápis přitom správně odmítnutý byl.
--  3) Statistiky přes vynucena_pobocka() měly stejnou díru: bez domovské
--     pobočky se omezení nevnutilo a člen dostal čísla celého servisu.
--  4) Dokumenty zakázky (ticket_documents) šlo vložit a přepsat i u zakázky
--     z cizí pobočky – pravidlo „jen viditelné zakázky“ hlídalo jen čtení.
--  5) Historie reklamace (warranty_claim_history) šla zapsat k cizí reklamaci.
--  6) SMS konverzaci cizí zakázky šlo archivovat i smazat (naslepo, ale
--     zákazníkovi tím zmizí historie zpráv).
--  7) Rezervace dílů šla vložit, změnit i zrušit přímo přes REST na zakázku
--     z cizí pobočky. Skladová RPC pobočku kontrolují od 9. 9., ale REST je
--     obchází – ochrana v jedné cestě ze dvou není ochrana.
--
-- Navíc: sklady jiné pobočky šly přejmenovat a přehodit pod svou pobočku,
-- a to i bez práva na sklad. A při přesunu zakázky na jinou pobočku zůstal
-- rozdělaný úsek práce viset otevřený – technik ho po přesunu už neviděl,
-- takže ho nešlo ani ukončit, ani smazat, a čas běžel dál.
--
-- Migrace nic nemaže a nic nepřejmenovává; jen dotahuje pravidla.

-- ========== 1) kdo smí vidět pobočku ==========

-- Stejná logika jako pobocka_povolena, ale pro libovolného člena. Potřebuje
-- ji trigger při přesunu zakázky, který se ptá za jiné lidi než za volajícího.
create or replace function public.pobocka_povolena_pro(p_user_id uuid, p_service_id uuid, p_branch_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
  v_caps jsonb;
  v_home uuid;
begin
  if p_user_id is null then
    return true; -- service_role (portál, edge funkce) není člen
  end if;
  select role, capabilities, home_branch_id into v_role, v_caps, v_home
    from public.service_memberships
   where service_id = p_service_id and user_id = p_user_id;
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if coalesce(v_caps ->> 'branch_only', 'false') <> 'true' then
    return true;
  end if;
  -- Bez domovské pobočky nemá omezený člen kam vidět. Dřív tady bylo
  -- `v_home is null` jako „neomezovat“, což omezení tiše vypínalo pokaždé,
  -- když se domovská pobočka smazala.
  if v_home is null then
    return false;
  end if;
  return p_branch_id is null or p_branch_id = v_home;
end;
$$;

revoke all on function public.pobocka_povolena_pro(uuid, uuid, uuid) from public, anon;
grant execute on function public.pobocka_povolena_pro(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.pobocka_povolena(p_service_id uuid, p_branch_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    return true; -- service_role (portál, edge funkce) není člen; omezení je pro lidi
  end if;
  return public.pobocka_povolena_pro(auth.uid(), p_service_id, p_branch_id);
end;
$$;

revoke all on function public.pobocka_povolena(uuid, uuid) from public, anon;
grant execute on function public.pobocka_povolena(uuid, uuid) to authenticated, service_role;

-- Statistiky: omezenému členovi bez domovské pobočky se vnutí pobočka, která
-- neexistuje, takže mu nic nesedne. Nulové UUID je tu jen proto, že obě volající
-- funkce hodnotu skládají přes coalesce(vynucena_pobocka(...), p_branch_id)
-- a NULL by znamenalo „bez filtru“.
create or replace function public.vynucena_pobocka(p_service_ids uuid[])
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(m.home_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    from public.service_memberships m
   where m.user_id = auth.uid()
     and m.service_id = any(p_service_ids)
     and m.role not in ('owner', 'admin')
     and coalesce(m.capabilities ->> 'branch_only', 'false') = 'true'
   limit 1;
$$;
revoke all on function public.vynucena_pobocka(uuid[]) from public, anon;
grant execute on function public.vynucena_pobocka(uuid[]) to authenticated, service_role;

-- ========== 2) domovskou pobočku si omezený člen nepřepíše ==========

create or replace function public.set_member_home_branch(p_service_id uuid, p_user_id uuid, p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_omezeny boolean;
begin
  if auth.uid() is null then
    raise exception 'Nepřihlášeno' using errcode = '28000';
  end if;
  if auth.uid() <> p_user_id and not public.is_owner_or_admin(p_service_id) then
    raise exception 'Domovskou pobočku může měnit jen majitel nebo správce.' using errcode = '42501';
  end if;
  -- Kdo je zamčený na jednu pobočku, nesmí si ji přehodit sám – jinak je
  -- celé omezení jen kosmetika a stačí jedno volání z konzole prohlížeče.
  if auth.uid() = p_user_id and not public.is_owner_or_admin(p_service_id) then
    select coalesce(capabilities ->> 'branch_only', 'false') = 'true'
      into v_omezeny
      from public.service_memberships
     where service_id = p_service_id and user_id = auth.uid();
    if coalesce(v_omezeny, false) then
      raise exception 'Máte přístup jen na svou pobočku, změnit ji může majitel nebo správce.' using errcode = '42501';
    end if;
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and service_id = p_service_id
  ) then
    raise exception 'Pobočka nepatří k tomuto servisu.' using errcode = 'foreign_key_violation';
  end if;
  update public.service_memberships
     set home_branch_id = p_branch_id
   where service_id = p_service_id and user_id = p_user_id;
end;
$$;

revoke all on function public.set_member_home_branch(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_member_home_branch(uuid, uuid, uuid) to authenticated;

-- ========== 3) zápis do tabulek navázaných na zakázku ==========
-- Poddotaz na `tickets` běží pod RLS volajícího, takže zakázku z cizí pobočky
-- v něm prostě nenajde. Stejný vzor jako u čtení z 8. 9.

drop policy if exists "ticket_documents_jen_viditelne_vlozeni" on public.ticket_documents;
create policy "ticket_documents_jen_viditelne_vlozeni" on public.ticket_documents
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.tickets t where t.id = ticket_documents.ticket_id));

drop policy if exists "ticket_documents_jen_viditelne_zmena" on public.ticket_documents;
create policy "ticket_documents_jen_viditelne_zmena" on public.ticket_documents
  as restrictive for update to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_documents.ticket_id))
  with check (exists (select 1 from public.tickets t where t.id = ticket_documents.ticket_id));

drop policy if exists "warranty_claim_history_jen_viditelne_zapis" on public.warranty_claim_history;
create policy "warranty_claim_history_jen_viditelne_zapis" on public.warranty_claim_history
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.warranty_claims w where w.id = warranty_claim_history.warranty_claim_id));

-- SMS: konverzace bez zakázky (příchozí zpráva z neznámého čísla) zůstává
-- společná, jinak by ji omezený člen nemohl ani otevřít.
drop policy if exists "sms_conversations_jen_viditelne_zmena" on public.sms_conversations;
create policy "sms_conversations_jen_viditelne_zmena" on public.sms_conversations
  as restrictive for update to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = sms_conversations.ticket_id))
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = sms_conversations.ticket_id));

drop policy if exists "sms_conversations_jen_viditelne_mazani" on public.sms_conversations;
create policy "sms_conversations_jen_viditelne_mazani" on public.sms_conversations
  as restrictive for delete to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = sms_conversations.ticket_id));

-- Rezervace dílů: RPC pobočku kontrolují, REST ne. Tady se dorovnává REST.
drop policy if exists "inventory_reservations_jen_viditelne_vlozeni" on public.inventory_reservations;
create policy "inventory_reservations_jen_viditelne_vlozeni" on public.inventory_reservations
  as restrictive for insert to authenticated
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_reservations.ticket_id));

drop policy if exists "inventory_reservations_jen_viditelne_zmena" on public.inventory_reservations;
create policy "inventory_reservations_jen_viditelne_zmena" on public.inventory_reservations
  as restrictive for update to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_reservations.ticket_id))
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_reservations.ticket_id));

drop policy if exists "inventory_reservations_jen_viditelne_mazani" on public.inventory_reservations;
create policy "inventory_reservations_jen_viditelne_mazani" on public.inventory_reservations
  as restrictive for delete to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = inventory_reservations.ticket_id));

-- Rezervace z webu (bookings) pobočku zatím nenesou – zákazník si ji na webu
-- nevybírá. Když už je ale rezervace převedená na zakázku, řídí se tou zakázkou.
drop policy if exists "bookings_jen_viditelne_zmena" on public.bookings;
create policy "bookings_jen_viditelne_zmena" on public.bookings
  as restrictive for update to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = bookings.ticket_id))
  with check (ticket_id is null or exists (select 1 from public.tickets t where t.id = bookings.ticket_id));

drop policy if exists "bookings_jen_viditelne_mazani" on public.bookings;
create policy "bookings_jen_viditelne_mazani" on public.bookings
  as restrictive for delete to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = bookings.ticket_id));

-- ========== 4) sklady patří pobočce ==========
-- Sklad má sloupec branch_id od začátku, ale hlídal ho jen filtr v aplikaci:
-- kdokoli člen (i bez práva na sklad) mohl cizí sklad přejmenovat, založit
-- nový nebo si ho přehodit pod svou pobočku. Čtení zůstává společné – zásoby
-- se mezi provozovnami běžně shánějí a ceník i produkty jsou stejně společné.
-- Hlídá to trigger, ne politika: Sklad se ukládá jako celý snímek, takže
-- klient běžně přeukládá i řádky, které nikdo nezměnil. Politika by takové
-- neškodné přeuložení odmítla a zasekla celé ukládání skladu; trigger umí
-- rozlišit „nic se nezměnilo“ od skutečné změny.
create or replace function public.inventory_warehouses_pobocka_a_pravo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zmena boolean;
begin
  -- service_role (edge funkce, migrace) není člen a jede po vlastní ose.
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if not public.has_capability(old.service_id, auth.uid(), 'can_edit_inventory') then
      raise exception 'Nemáte oprávnění upravovat sklady.' using errcode = '42501';
    end if;
    if not public.pobocka_povolena(old.service_id, old.branch_id) then
      raise exception 'Sklad patří jiné pobočce.' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Pobočka se u nového skladu nekontroluje: prázdnou doplní trigger na
    -- výchozí pobočku a založení skladu nikomu nic neprozradí. Přehodit ho
    -- pak pod cizí pobočku už neprojde (viz větev UPDATE).
    if not public.has_capability(new.service_id, auth.uid(), 'can_edit_inventory') then
      raise exception 'Nemáte oprávnění upravovat sklady.' using errcode = '42501';
    end if;
    return new;
  end if;

  v_zmena := new.branch_id is distinct from old.branch_id
          or new.name is distinct from old.name
          or new.is_default is distinct from old.is_default
          or new.public_visible is distinct from old.public_visible
          or new.order_index is distinct from old.order_index;
  if not v_zmena then
    return new;
  end if;
  if not public.has_capability(new.service_id, auth.uid(), 'can_edit_inventory') then
    raise exception 'Nemáte oprávnění upravovat sklady.' using errcode = '42501';
  end if;
  if not public.pobocka_povolena(old.service_id, old.branch_id)
     or not public.pobocka_povolena_zapis(new.service_id, new.branch_id) then
    raise exception 'Sklad patří jiné pobočce.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_warehouses_pobocka on public.inventory_warehouses;
create trigger trg_inventory_warehouses_pobocka
  before insert or update or delete on public.inventory_warehouses
  for each row execute function public.inventory_warehouses_pobocka_a_pravo();

-- ========== 5) rozdělaná práce při přesunu zakázky ==========
-- Po přesunu na jinou pobočku technik zakázku nevidí, takže svůj běžící úsek
-- práce nemůže ukončit (RLS pustí update jen k viditelné zakázce) ani smazat.
-- Čas by běžel dál a ve výkazu by zůstal otevřený úsek napořád. Úseky lidí,
-- kteří po přesunu ztratili přístup, se proto uzavřou k okamžiku přesunu.
create or replace function public.tickets_presun_uzavre_useky()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_id is distinct from old.branch_id then
    update public.ticket_work_sessions w
       set ended_at = now()
     where w.ticket_id = new.id
       and w.ended_at is null
       and not public.pobocka_povolena_pro(w.user_id, new.service_id, new.branch_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_tickets_presun_uzavre_useky on public.tickets;
create trigger trg_tickets_presun_uzavre_useky
  after update of branch_id on public.tickets
  for each row execute function public.tickets_presun_uzavre_useky();

comment on function public.tickets_presun_uzavre_useky() is
  'Při přesunu zakázky na jinou pobočku uzavře běžící úseky práce lidí, kteří na ni po přesunu nevidí.';

-- ========== 6) smazání pobočky a domovská pobočka členů ==========
-- Cizí klíč nastaví home_branch_id smazané pobočky na NULL. Omezený člen by
-- tím po opravě z bodu 1 přišel o všechno; nechat ho na výchozí pobočce je
-- srozumitelnější než ho tiše odstřihnout.
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
  update public.service_memberships set home_branch_id = v_default
   where service_id = old.service_id and home_branch_id is null
     and coalesce(capabilities ->> 'branch_only', 'false') = 'true';
  return old;
end;
$$;
