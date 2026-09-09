-- Počet členů jako součást tarifu.
--
-- Starter je pro jednoho člověka. Dosud to hlídalo jen to, že nikdo nevěděl,
-- jak pozvat dalšího – tedy nic. Stejný vzor jako pobočky (entitlement_quota):
-- nárok na modul `members` s `quota` = kolik lidí smí v servisu být, a kontrola
-- v triggeru, ne jen v UI. Kdo si otevře vývojářské nástroje, zavolá
-- invite_create přímo; pozvánku i členství musí odmítnout databáze.
--
-- Bez nároku (stávající servisy, zkušební období, Business a výš) je počet
-- bez omezení – limit vzniká jen tam, kde ho tarif výslovně stanoví. Tím
-- nasazení nikomu nic nevezme.
--
-- Do obsazených míst se počítají i ČEKAJÍCÍ POZVÁNKY. Jinak by šlo limit
-- obejít tím, že se pozve deset lidí a limit se projeví až při přijetí, kdy
-- už je pozdě. Z toho plyne pořadí kontrol:
--   * pozvánka se odmítne, když členové + čekající pozvánky >= limit
--   * členství se odmítne, když samotní členové >= limit
-- Přijetí pozvánky (invite-accept) vkládá členství DŘÍV, než pozvánku označí
-- za přijatou. Kdyby trigger na členství počítal i pozvánky, započítal by tu
-- právě přijímanou dvakrát a přijetí na hraně limitu by zablokovalo samo sebe.
--
-- Skrytý člen (majitel aplikace, viz root_owner_skryty_clen) místo nezabírá.

-- Kolik členů smí servis mít. Bez nároku bez omezení.
create or replace function public.members_allowed(p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case when e.quota is null then 2147483647 else e.quota end
        from public.service_entitlements e
       where e.service_id = p_service_id
         and e.module = 'members'
         and e.active
         and (e.valid_until is null or e.valid_until > now())
       limit 1
    ),
    2147483647
  );
$$;

grant execute on function public.members_allowed(uuid) to authenticated;

comment on function public.members_allowed(uuid) is
  'Kolik členů smí servis mít: quota z nároku na modul members, bez nároku bez omezení (2147483647).';

-- Obsazená místa: viditelní členové + platné nepřijaté pozvánky.
create or replace function public.service_seat_count(p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::integer from public.service_memberships m
      where m.service_id = p_service_id and m.skryty = false)
    +
    (select count(*)::integer from public.service_invites i
      where i.service_id = p_service_id
        and i.accepted_at is null
        and i.expires_at > now());
$$;

grant execute on function public.service_seat_count(uuid) to authenticated;

comment on function public.service_seat_count(uuid) is
  'Obsazená místa v servisu: viditelní členové + platné čekající pozvánky. Tým a přístupy podle toho ukazuje obsazenost.';

-- Členství: odmítnout, když by překročilo limit. Počítají se jen členové.
create or replace function public.members_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_limit integer;
begin
  -- Skrytý člen (majitel aplikace) místo nezabírá.
  if new.skryty then
    return new;
  end if;
  -- Upsert existujícího členství (invite_create tak zakládá ownera) není nové místo.
  if exists (select 1 from public.service_memberships m
              where m.service_id = new.service_id and m.user_id = new.user_id) then
    return new;
  end if;
  select count(*) into v_count from public.service_memberships m
   where m.service_id = new.service_id and m.skryty = false;
  -- První člen je zakladatel servisu – toho nikdy neblokovat.
  if v_count = 0 then
    return new;
  end if;
  v_limit := public.members_allowed(new.service_id);
  if v_count >= v_limit then
    if v_limit <= 1 then
      raise exception 'Tarif je pro jednoho člena. Další členy umí Business a vyšší.'
        using errcode = 'check_violation';
    else
      raise exception 'Tarif umožňuje nejvýš % členů. Další členy umí vyšší tarif.', v_limit
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_members_enforce_quota on public.service_memberships;
create trigger trg_members_enforce_quota
  before insert on public.service_memberships
  for each row execute function public.members_enforce_quota();

-- Pozvánka: odmítnout, když by členové + čekající pozvánky překročili limit.
create or replace function public.invites_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats integer;
  v_limit integer;
begin
  -- Opakovaná pozvánka na stejný e-mail (invite_create dělá upsert) místo nezabírá.
  if exists (select 1 from public.service_invites i
              where i.service_id = new.service_id and i.email = new.email) then
    return new;
  end if;
  v_limit := public.members_allowed(new.service_id);
  v_seats := public.service_seat_count(new.service_id);
  if v_seats >= v_limit then
    if v_limit <= 1 then
      raise exception 'Tarif je pro jednoho člena. Další členy umí Business a vyšší.'
        using errcode = 'check_violation';
    else
      raise exception 'Tarif umožňuje nejvýš % členů (včetně čekajících pozvánek). Další členy umí vyšší tarif.', v_limit
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invites_enforce_quota on public.service_invites;
create trigger trg_invites_enforce_quota
  before insert on public.service_invites
  for each row execute function public.invites_enforce_quota();
