-- ============================================================================
-- Ruční odměny: poznámka nepovinná (9. 10. 2026)
-- ============================================================================
--
-- PROČ: Majitel chce odměny přidávat jedním klikem přímo na stránce Odměny
-- (tlačítka podle pravidel). Povinná poznámka by z každého kliknutí udělala
-- formulář. Poznámka zůstává možná v dialogu „Podrobněji“.
--
-- Mění se jen: sloupec poznamka smí být NULL (prázdný text se uloží jako
-- NULL), kontrola délky, trigger odmeny_rucni_kontrola (nullif místo btrim)
-- a odmeny_rucni_pridat bez kontroly povinné poznámky. Zbytek těl je beze
-- změny zkopírovaný z 20261009100000_odmeny_rucni.sql.
-- ============================================================================

alter table public.odmeny_rucni alter column poznamka drop not null;
alter table public.odmeny_rucni drop constraint if exists odmeny_rucni_poznamka_check;
alter table public.odmeny_rucni add constraint odmeny_rucni_poznamka_check
  check (poznamka is null or length(poznamka) <= 1000);

create or replace function public.odmeny_rucni_kontrola()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  -- Bez přihlášeného uživatele (service_role, migrace, cron) se oprávnění
  -- nehlídá – RLS ani granty tam nedosáhnou a anon tabulku vůbec nemá.
  v_admin boolean := v_uid is null or public.odmeny_je_spravce(new.service_id);
  v_nazev text;
  v_typ text;
  v_castka numeric;
  v_t_service uuid;
  v_t_branch uuid;
  v_t_location uuid;
begin
  if tg_op = 'UPDATE' then
    if new.service_id is distinct from old.service_id then
      raise exception 'Servis ruční odměny nejde změnit.' using errcode = '42501';
    end if;
    if not v_admin and (
         new.stav is distinct from old.stav
      or new.castka is distinct from old.castka
      or new.zaklad is distinct from old.zaklad
      or new.pravidlo_id is distinct from old.pravidlo_id
      or new.user_id is distinct from old.user_id
      or new.obdobi is distinct from old.obdobi
      or new.automaticky is distinct from old.automaticky
      or new.schvalil is distinct from old.schvalil
      or new.schvaleno_at is distinct from old.schvaleno_at
    ) then
      raise exception 'Ruční odměnu může měnit jen majitel nebo správce.' using errcode = '42501';
    end if;
    new.vytvoril := old.vytvoril;
    new.created_at := old.created_at;
  end if;

  -- Příjemce musí být člen servisu.
  if not exists (select 1 from public.service_memberships m where m.service_id = new.service_id and m.user_id = new.user_id) then
    raise exception 'Příjemce odměny není členem servisu.' using errcode = '42501';
  end if;

  -- Zakázka jen ze stejného servisu a jen taková, kterou volající vidí (§5).
  if new.ticket_id is not null and (tg_op = 'INSERT' or new.ticket_id is distinct from old.ticket_id) then
    select t.service_id, t.branch_id, t.location_branch_id into v_t_service, v_t_branch, v_t_location
      from public.tickets t where t.id = new.ticket_id;
    if v_t_service is null or v_t_service <> new.service_id then
      raise exception 'Zakázka nepatří tomuto servisu.' using errcode = '42501';
    end if;
    if v_uid is not null and not public.zakazka_viditelna_podle_mista(v_t_service, v_t_branch, v_t_location) then
      raise exception 'Zakázka patří jiné pobočce.' using errcode = '42501';
    end if;
  end if;

  -- Částka: vždy z pravidla v configu, nikdy od klienta. Při změně jen
  -- poznámky / stavu zůstává snímek (pravidlo se mohlo mezitím změnit).
  if tg_op = 'INSERT' or new.pravidlo_id is distinct from old.pravidlo_id or new.zaklad is distinct from old.zaklad then
    select v.nazev, v.typ, v.castka into v_nazev, v_typ, v_castka
      from public.odmeny_rucni_vypocet(new.service_id, new.pravidlo_id, new.zaklad) v;
    if v_typ is null then
      raise exception 'Pravidlo odměny neexistuje nebo není aktivní.' using errcode = '22023';
    end if;
    if v_typ = 'procento' then
      if new.zaklad is null or new.zaklad <= 0 then
        raise exception 'U procentního pravidla zadejte cenu, ze které se odměna počítá.' using errcode = '22023';
      end if;
    else
      new.zaklad := null;
    end if;
    new.pravidlo_nazev := coalesce(v_nazev, '');
    new.castka := v_castka;
  else
    new.castka := old.castka;
    new.pravidlo_nazev := old.pravidlo_nazev;
  end if;

  new.poznamka := nullif(btrim(coalesce(new.poznamka, '')), '');
  new.duvod_zamitnuti := nullif(btrim(coalesce(new.duvod_zamitnuti, '')), '');

  if tg_op = 'INSERT' then
    new.created_at := now();
    if v_uid is not null then
      new.vytvoril := v_uid;
    end if;
    if v_admin then
      if new.stav = 'schvaleno' then
        new.automaticky := false;
        new.schvalil := v_uid;
        new.schvaleno_at := now();
      end if;
    else
      -- Zaměstnanec: jen sám sobě a čekající – nebo rovnou schválená, má-li
      -- zapnuté automatické schvalování.
      if new.user_id <> v_uid then
        raise exception 'Odměnu si můžete přidat jen sami sobě.' using errcode = '42501';
      end if;
      if new.stav = 'schvaleno' and new.automaticky
         and exists (select 1 from public.odmeny_auto_schvaleni a where a.service_id = new.service_id and a.user_id = v_uid) then
        new.schvalil := null;
        new.schvaleno_at := now();
      elsif new.stav = 'ceka' then
        new.automaticky := false;
        new.schvalil := null;
        new.schvaleno_at := null;
      else
        raise exception 'Odměnu schvaluje majitel nebo správce.' using errcode = '42501';
      end if;
      new.duvod_zamitnuti := null;
    end if;
    if new.stav = 'ceka' then
      new.automaticky := false;
      new.schvalil := null;
      new.schvaleno_at := null;
    end if;
  elsif new.stav is distinct from old.stav then
    -- Rozhodnutí správce: kdo a kdy (u zamítnutí stejné sloupce).
    new.automaticky := false;
    if new.stav = 'ceka' then
      new.schvalil := null;
      new.schvaleno_at := null;
      new.duvod_zamitnuti := null;
    else
      new.schvalil := v_uid;
      new.schvaleno_at := now();
      if new.stav = 'schvaleno' then
        new.duvod_zamitnuti := null;
      end if;
    end if;
  else
    new.automaticky := old.automaticky;
    new.schvalil := old.schvalil;
    new.schvaleno_at := old.schvaleno_at;
  end if;

  return new;
end;
$$;

revoke all on function public.odmeny_rucni_kontrola() from public, anon, authenticated;

create or replace function public.odmeny_rucni_pridat(
  p_service_id uuid,
  p_pravidlo_id text,
  p_poznamka text,
  p_obdobi text,
  p_ticket_id uuid default null,
  p_zaklad numeric default null,
  p_user_id uuid default null
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
  insert into public.odmeny_rucni (service_id, user_id, pravidlo_id, poznamka, ticket_id, obdobi, zaklad, stav, automaticky, vytvoril)
  values (p_service_id, v_user, p_pravidlo_id, p_poznamka, p_ticket_id, p_obdobi, p_zaklad, v_stav, v_auto, v_uid)
  returning * into v_radek;

  return jsonb_build_object(
    'id', v_radek.id, 'stav', v_radek.stav, 'castka', v_radek.castka,
    'pravidlo', v_radek.pravidlo_nazev, 'automaticky', v_radek.automaticky
  );
end;
$$;

revoke all on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid) from public, anon;
grant execute on function public.odmeny_rucni_pridat(uuid, text, text, text, uuid, numeric, uuid) to authenticated;

-- Jedním klikem se snadno překlikne. Autor proto smí svou odměnu smazat
-- i schválenou (automaticky schválený zaměstnanec), ale jen do 10 minut od
-- přidání – tlačítko „Vzít zpět“ v hlášce po kliknutí. Čekající jako dřív.
drop policy if exists odmeny_rucni_mazani on public.odmeny_rucni;
create policy odmeny_rucni_mazani on public.odmeny_rucni
  for delete to authenticated
  using (
    public.odmeny_je_spravce(service_id)
    or (vytvoril = auth.uid() and stav = 'ceka')
    or (vytvoril = auth.uid() and created_at > now() - interval '10 minutes')
  );
