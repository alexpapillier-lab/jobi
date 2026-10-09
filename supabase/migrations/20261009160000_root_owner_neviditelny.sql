-- Majitel aplikace (root owner) je pro členy servisů úplně neviditelný
-- ============================================================================
--
-- PROČ: Majitel aplikace je členem všech servisů (správa, podpora, testy).
-- V cizích servisech má skryté členství (20260910150000), ve svých dílnách
-- (iSwap Praha, MajkaPajka, TEST2) ale viditelné s rolí owner – a v iSwap
-- Praha přitom pracuje pod druhým účtem. Zadání majitele: „Já jako owner
-- musím být pro všechny neviditelný“ – v týmu, v chatu, ve statistikách,
-- v odměnách, jako autor změny, nikde.
--
-- PRAVIDLO: majitele aplikace vidí jen on sám. Pro všechny ostatní (i pro
-- server bez přihlášeného uživatele, tedy e-mailové reporty) neexistuje:
--   * seznamy členů ho nevrací (clenove_servisu, chat_kanaly, odmeny_prehled),
--   * do obsazených míst se nepočítá nikdy, ani jemu (service_seat_count,
--     limit tarifu),
--   * jeho práce a změny se počítají jako „bez autora“ – stejně jako import
--     nebo automatika (statistiky techniků, odměny, protokol anonymizace),
--   * řádky členství a profilu ostatním nevrátí ani REST (restriktivní
--     politiky),
--   * soukromé zprávy s ním v chatu neexistují (nikdo mu nenapíše, on nikomu),
--     zprávy do kanálu servisu/pobočky podepisuje aplikace „Podpora Jobi“,
--   * nový komentář od něj nese autora „Systém“ bez přezdívky a fotky.
--
-- PROČ NE PŘÍZNAK `skryty` U VŠECH JEHO ČLENSTVÍ: `skryty = true` dnes
-- znamená „členství vzniklé přes podporu“ a podle něj se rozhoduje, co jde
-- odebrat tlačítkem Odejít (service-manage leave). Vlastní dílny majitele by
-- se tím daly omylem opustit. Rozhoduje proto id majitele (app_nastaveni),
-- ne data členství – a data se nemění.
--
-- Klientská půlka (presence, překlad id → „Systém“/„Podpora Jobi“) je
-- v src/lib/rootOwner.ts, celý seznam míst v docs/ROOT_OWNER_NEVIDITELNY.md.
--
-- Funkce, které se tu přepisují, jsou převzaté z nejnovější definice beze
-- změny; změny jsou označené komentářem „root“:
--   statistiky_technici   ← 20260915100000_opravneni_statistiky.sql
--   odmeny_prehled        ← 20261009120000_odmeny_kdy.sql
--   anonymizace_protokol  ← 20260927120000_anonymizace_zakazniku.sql
--   service_seat_count    ← 20260927100000_audit_opravneni_4.sql
--   members_enforce_quota ← 20260913200000_members_quota.sql
--   clenove_servisu       ← 20260913140000_prideleny_technik.sql
--   chat_kanal_viditelny, chat_kanaly ← 20260913180000_chat.sql
--
-- Migrace je idempotentní (create or replace, drop … if exists).

-- ── 1) Kdo je majitel aplikace ──────────────────────────────────────────────

-- Pro RLS: je tohle id majitel aplikace? Vrací jen ano/ne (id samotné klient
-- nezjistí – root_owner_id() nemá pro authenticated právo EXECUTE). Bez
-- nastaveného majitele vždy false, ne null: `not null` by v politice
-- zamítlo všechno.
create or replace function public.je_root_owner_id(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_user is not null and p_user = public.root_owner_id(), false);
$$;

revoke all on function public.je_root_owner_id(uuid) from public, anon;
grant execute on function public.je_root_owner_id(uuid) to authenticated, service_role;

comment on function public.je_root_owner_id(uuid) is
  'True, když je p_user majitel aplikace (app_nastaveni.root_owner_id). Pro RLS: majitel aplikace je pro členy servisů neviditelný.';

-- Pro security definer funkce: id majitele aplikace, kterého volající nesmí
-- vidět – null, když se dívá on sám (nebo majitel není nastavený). Server
-- bez přihlášení (e-mailový report) ho nevidí. Klient ji volat nesmí:
-- vrátila by mu id majitele.
create or replace function public.root_owner_skryty_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and auth.uid() = public.root_owner_id() then null
    else public.root_owner_id()
  end;
$$;

revoke all on function public.root_owner_skryty_id() from public, anon, authenticated;
grant execute on function public.root_owner_skryty_id() to service_role;

comment on function public.root_owner_skryty_id() is
  'Id majitele aplikace, kterého přihlášený nesmí vidět (null pro majitele samotného). Jen pro security definer funkce, ne pro klienta.';

-- ── 2) RLS: řádky majitele aplikace ostatním nevrací ani REST ───────────────

-- Členství: dosud se schovávalo jen `skryty = true`. Teď i viditelné
-- členství majitele aplikace (vlastní dílny). Sám své řádky vidí dál –
-- podle nich aplikace pozná, v jakých servisech je a s jakou rolí.
-- Restriktivní, takže se k permisivní service_memberships_select přičítá
-- jako „a zároveň“. Security definer funkce (is_owner_or_admin, chat_je_clen
-- …) běží pod vlastníkem s BYPASSRLS / row_security off, těch se to netýká.
drop policy if exists "service_memberships_skryte_jen_svoje" on public.service_memberships;
create policy "service_memberships_skryte_jen_svoje" on public.service_memberships
  as restrictive for select to authenticated
  using (
    user_id = auth.uid()
    or (skryty = false and not public.je_root_owner_id(user_id))
  );

-- Profil (přezdívka, fotka): profiles_select_shared_service pouští profily
-- lidí ze stejného servisu přes service_memberships, takže by ho po změně
-- výš schovala sama. Restriktivní politika to říká výslovně – pro případ,
-- že někdo politiku na profilech jednou zjednoduší.
drop policy if exists profiles_root_owner_skryty on public.profiles;
create policy profiles_root_owner_skryty on public.profiles
  as restrictive for select to authenticated
  using (id = auth.uid() or not public.je_root_owner_id(id));

-- ── 3) Seznam členů (technik, chat, odměny, konflikt úprav) ─────────────────
create or replace function public.clenove_servisu(p_service_id uuid)
returns table (user_id uuid, nickname text, avatar_url text, role text)
language sql
security definer
stable
set search_path = public
as $$
  select m.user_id, p.nickname, p.avatar_url, m.role
    from public.service_memberships m
    left join public.profiles p on p.id = m.user_id
   where m.service_id = p_service_id
     and m.skryty = false
     -- root: majitel aplikace jen sám sobě
     and m.user_id is distinct from public.root_owner_skryty_id()
     and exists (
       select 1 from public.service_memberships x
        where x.service_id = p_service_id and x.user_id = auth.uid()
     )
   order by p.nickname nulls last, m.user_id;
$$;
revoke all on function public.clenove_servisu(uuid) from public, anon;
grant execute on function public.clenove_servisu(uuid) to authenticated;

-- ── 4) Obsazená místa a limit tarifu: majitel aplikace se nepočítá nikdy ────
create or replace function public.service_seat_count(p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pg_trigger_depth() > 0
      or auth.role() = 'service_role'
      or exists (select 1 from public.service_memberships x where x.service_id = p_service_id and x.user_id = auth.uid())
    then
      (select count(*)::integer from public.service_memberships m
        where m.service_id = p_service_id and m.skryty = false
          and not public.je_root_owner_id(m.user_id)) -- root
      +
      (select count(*)::integer from public.service_invites i
        where i.service_id = p_service_id
          and i.accepted_at is null
          and i.expires_at > now())
  end;
$$;
revoke all on function public.service_seat_count(uuid) from public, anon;
grant execute on function public.service_seat_count(uuid) to authenticated, service_role;

comment on function public.service_seat_count(uuid) is
  'Obsazená místa v servisu: viditelní členové (bez majitele aplikace) + platné čekající pozvánky. Tým a přístupy podle toho ukazuje obsazenost.';

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
  -- Skrytý člen ani majitel aplikace (root) místo nezabírá.
  if new.skryty or public.je_root_owner_id(new.user_id) then
    return new;
  end if;
  -- Upsert existujícího členství (invite_create tak zakládá ownera) není nové místo.
  if exists (select 1 from public.service_memberships m
              where m.service_id = new.service_id and m.user_id = new.user_id) then
    return new;
  end if;
  select count(*) into v_count from public.service_memberships m
   where m.service_id = new.service_id and m.skryty = false
     and not public.je_root_owner_id(m.user_id); -- root
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

-- ── 5) Chat týmu ────────────────────────────────────────────────────────────
-- Soukromé zprávy s majitelem aplikace pro nikoho neexistují: nikdo mu
-- nenapíše (v seznamu lidí není) a on nenapíše nikomu (příjemce by viděl
-- konverzaci s někým, kdo v týmu není). chat_smi_psat, chat_neprectene,
-- chat_hledej i politiky čtou tuhle funkci, takže to platí všude naráz.
-- Do kanálu servisu nebo pobočky psát smí (je-li nescrytý člen); aplikace
-- zprávu ostatním ukáže od „Podpora Jobi“ – bez autora by konverzace
-- nedávala smysl.
create or replace function public.chat_kanal_viditelny(p_service_id uuid, p_branch_id uuid, p_sender_id uuid, p_recipient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select auth.uid() is not null
     and public.chat_je_clen(p_service_id, auth.uid())
     and case
           when p_recipient_id is not null then auth.uid() in (p_sender_id, p_recipient_id)
             -- root: soukromá zpráva s majitelem aplikace
             and not public.je_root_owner_id(p_sender_id)
             and not public.je_root_owner_id(p_recipient_id)
           when p_branch_id is not null then public.pobocka_povolena(p_service_id, p_branch_id)
           else true
         end;
$$;
revoke all on function public.chat_kanal_viditelny(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.chat_kanal_viditelny(uuid, uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.chat_kanaly(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
  v_pobocky jsonb;
  v_lide jsonb;
  v_pocet int;
begin
  if not public.chat_je_clen(p_service_id, v_uid) then
    return '[]'::jsonb;
  end if;

  select jsonb_build_array(jsonb_build_object('kanal', 'servis', 'nazev', s.name))
    into v_out
    from public.services s
   where s.id = p_service_id;

  select count(*) into v_pocet from public.branches b where b.service_id = p_service_id;
  if v_pocet > 1 then
    select coalesce(jsonb_agg(
             jsonb_build_object('kanal', 'pobocka:' || b.id::text, 'nazev', b.name)
             order by b.is_default desc, b.order_index, b.name), '[]'::jsonb)
      into v_pobocky
      from public.branches b
     where b.service_id = p_service_id
       and public.pobocka_povolena(p_service_id, b.id);
    v_out := v_out || v_pobocky;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'kanal', 'dm:' || m.user_id::text,
             'nazev', coalesce(nullif(btrim(p.nickname), ''), 'Kolega'),
             'avatar_url', p.avatar_url)
           order by coalesce(nullif(btrim(p.nickname), ''), 'Kolega'), m.user_id), '[]'::jsonb)
    into v_lide
    from public.service_memberships m
    left join public.profiles p on p.id = m.user_id
   where m.service_id = p_service_id
     and m.skryty = false
     and m.user_id <> v_uid
     -- root: majitel aplikace není mezi lidmi a sám soukromé zprávy nemá
     and not public.je_root_owner_id(m.user_id)
     and not public.je_root_owner_id(v_uid);

  return v_out || v_lide;
end;
$$;
revoke all on function public.chat_kanaly(uuid) from public, anon;
grant execute on function public.chat_kanaly(uuid) to authenticated;

-- ── 6) Komentáře k zakázce: autor „Systém“ ──────────────────────────────────
-- Komentář si při uložení nese přezdívku a fotku autora jako text (snímek),
-- takže by majitele aplikace prozradil i tehdy, když je jeho profil
-- schovaný. author_id zůstává (kdo komentář napsal, se dá dohledat
-- a majitel si ho smí upravit), ven jde jen „Systém“.
create or replace function public.ticket_comments_root_owner_system()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is not null and public.je_root_owner_id(new.author_id) then
    new.author := 'Systém';
    new.author_nickname := null;
    new.author_avatar_url := null;
  end if;
  return new;
end;
$$;
revoke all on function public.ticket_comments_root_owner_system() from public, anon, authenticated;

drop trigger if exists trg_ticket_comments_root_owner on public.ticket_comments;
create trigger trg_ticket_comments_root_owner
  before insert or update on public.ticket_comments
  for each row execute function public.ticket_comments_root_owner_system();

-- Komentáře, které už majitel aplikace napsal (v produkci tři). Opakované
-- spuštění nic nemění – podmínka hledá jen řádky, které ještě nejsou upravené.
update public.ticket_comments c
   set author = 'Systém', author_nickname = null, author_avatar_url = null
 where public.root_owner_id() is not null
   and c.author_id = public.root_owner_id()
   and (c.author is distinct from 'Systém' or c.author_nickname is not null or c.author_avatar_url is not null);

-- ── 7) Statistiky techniků (i e-mailový report) ─────────────────────────────
-- Práce majitele aplikace (přijal, dokončil, stopky, hodinová práce) jde
-- ostatním do řádku „Bez technika (portál, automat)“ – součty sloupců tak
-- dál sedí s počtem zakázek. Sám se vidí pod svým jménem.
create or replace function public.statistiky_technici(
  p_service_ids uuid[],
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vysledek jsonb;
  v_pobocky uuid[];
  v_ted timestamptz := now();
  -- Neuzavřený úsek se počítá nejvýš jednu dlouhou směnu. Zapomenuté stopky
  -- nejsou odvedená práce: úsek z 20. ledna, který nikdo nezastavil, jinak
  -- „naroste“ do konce období a technik má v lednu 282 hodin místo dvou.
  -- Stejná mez je v `src/lib/usekyPrace.ts` (MAX_OTEVRENY_USEK_HODIN).
  c_otevreny_strop constant numeric := 12 * 3600;
  -- root: majitel aplikace, kterého volající nesmí vidět (null = nikdo).
  -- Jeho práce (historie, stopky, hodinová práce) jde do řádku „Bez technika“.
  v_skryty uuid := public.root_owner_skryty_id();
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Chybí servis.' using errcode = '22023';
  end if;
  -- Členství i právo „vidět statistiky“ na jednom místě; service_role
  -- (e-mailový report) prochází bez uživatele.
  if auth.role() is distinct from 'service_role' then
    perform public.overit_pristup_ke_statistikam(p_service_ids);
  end if;
  -- Pobočky, na které se smí dívat: omezený člen jen své (i když si řekne
  -- o všechny nebo o cizí), ostatní podle zvolené pobočky. NULL = bez filtru.
  v_pobocky := public.povolene_pobocky(p_service_ids);
  if v_pobocky is not null then
    if p_branch_id is not null then
      v_pobocky := case when p_branch_id = any(v_pobocky) then array[p_branch_id]
                        else array['00000000-0000-0000-0000-000000000000'::uuid] end;
    end if;
  elsif p_branch_id is not null then
    v_pobocky := array[p_branch_id];
  end if;

  with viditelne as (
    -- Jedno místo, kde se rozhoduje, které zakázky do KPI patří. Filtr
    -- pobočky je schválně stejný jako v `statistiky_prehled`: zakázka bez
    -- pobočky patří každé pobočce, jinak by součet „Přijal“ neseděl
    -- s počtem zakázek v období.
    select t.id, t.service_id, t.created_at, t.performed_repairs,
           public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label) as storno
    from public.tickets t
    left join public.service_statuses st
      on st.service_id = t.service_id and st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      and (v_pobocky is null or t.branch_id is null or t.branch_id = any(v_pobocky))
  ),
  historie as (
    select h.id,
           nullif(h.changed_by, v_skryty) as user_id, -- root
           h.action,
           h.ticket_id,
           h.created_at,
           h.details -> 'changes' -> 'status' ->> 'new' as novy_stav,
           v.service_id
    from public.ticket_history h
    join viditelne v on v.id = h.ticket_id
    where (p_od is null or h.created_at >= p_od)
      and (p_do is null or h.created_at <= p_do)
  ),
  prijati as (
    select h.user_id, count(distinct h.ticket_id) as prijato
    from historie h
    where h.action = 'created'
    group by h.user_id
  ),
  -- Dokončení má jednoho autora: toho, kdo zakázku do koncového stavu přepnul
  -- naposled. Dřív ho dostal každý, kdo ji tam kdy přepnul, a součet sloupce
  -- „Dokončil“ pak byl vyšší než počet dokončených zakázek.
  dokonceni as (
    select distinct on (h.ticket_id) h.ticket_id, h.user_id
    from historie h
    where h.action = 'updated'
      and h.novy_stav is not null
      and exists (
        select 1 from public.service_statuses s
        where s.service_id = h.service_id and s.key = h.novy_stav and s.is_final
          and not public.stav_je_storno(s.key, s.label)
      )
    order by h.ticket_id, h.created_at desc, h.id desc
  ),
  dokoncili as (
    select d.user_id, count(*) as dokonceno
    from dokonceni d
    group by d.user_id
  ),
  -- Čas ze stopek podle PŘEKRYVU s obdobím, ne podle toho, kdy úsek začal.
  -- Úsek 23:30–00:30 na přelomu měsíce tak dá půl hodiny do každého z nich;
  -- dřív spadl celý do toho, ve kterém začal, a při pohledu na ten druhý
  -- zmizel úplně.
  useky as (
    select
      nullif(w.user_id, v_skryty) as user_id, -- root
      w.ended_at is null as otevreny,
      greatest(0, extract(epoch from (
        least(coalesce(w.ended_at, v_ted), coalesce(p_do, v_ted))
        - greatest(w.started_at, coalesce(p_od, '-infinity'::timestamptz))
      ))) as sekund
    from public.ticket_work_sessions w
    join viditelne v on v.id = w.ticket_id
    where w.service_id = any(p_service_ids)
      and w.started_at <= coalesce(p_do, v_ted)
      and coalesce(w.ended_at, v_ted) >= coalesce(p_od, '-infinity'::timestamptz)
  ),
  odpracovano as (
    select
      u.user_id,
      sum(case when u.otevreny then least(u.sekund, c_otevreny_strop) else u.sekund end) / 3600.0 as hodiny,
      count(*) filter (where u.otevreny) as bezicich
    from useky u
    group by u.user_id
  ),
  -- root: hodinová práce majitele aplikace (podle účtu) patří volajícímu,
  -- který ho nesmí vidět, do řádku „Bez technika“ (klíč 'bez-technika').
  hodinova_radky as (
    select
      case when v_skryty is not null and r ->> 'technikUserId' = v_skryty::text then true else false end as skryta,
      r
    from viditelne v,
         jsonb_array_elements(case when jsonb_typeof(v.performed_repairs) = 'array' then v.performed_repairs else '[]'::jsonb end) r
    where (p_od is null or v.created_at >= p_od)
      and (p_do is null or v.created_at <= p_do)
      -- Za stornovanou zakázku se nefakturovalo: hodinová práce ani tržba
      -- z ní do KPI nepatří. Čas ze stopek naopak ano – ten se opravdu strávil.
      and not v.storno
      and r ->> 'type' = 'hourly'
      and (coalesce(trim(r ->> 'technik'), '') <> '' or coalesce(r ->> 'technikUserId', '') <> '')
  ),
  hodinova as (
    select
      -- Účet technika má přednost před jménem: dva lidé se stejnou přezdívkou se nesmí slít.
      case when x.skryta then 'bez-technika'
           else coalesce(nullif(x.r ->> 'technikUserId', ''), 'jmeno:' || lower(trim(x.r ->> 'technik'))) end as klic,
      max(case when x.skryta then 'Bez technika (portál, automat)' else trim(x.r ->> 'technik') end) as jmeno,
      sum(coalesce((x.r ->> 'hodiny')::numeric, 0)) as hodiny,
      sum(coalesce((x.r ->> 'price')::numeric, 0)) as trzba
    from hodinova_radky x
    group by 1
  ),
  -- Sjednocení účtů ze všech tří zdrojů; `union` bere null jako jednu hodnotu,
  -- takže „Bez technika“ (portál, automat) vyjde jako jeden řádek.
  ucty as (
    select user_id from prijati
    union
    select user_id from dokoncili
    union
    select user_id from odpracovano
  ),
  lide as (
    select u.user_id,
           case
             when u.user_id is null then 'Bez technika (portál, automat)'
             else coalesce(nullif(trim(p.nickname), ''), 'Bez přezdívky (' || left(u.user_id::text, 8) || ')')
           end as jmeno,
           -- Párování s hodinovou prací: podle účtu, záložně podle přezdívky.
           coalesce(u.user_id::text, 'bez-technika') as klic_ucet,
           'jmeno:' || lower(coalesce(nullif(trim(p.nickname), ''), '')) as klic_jmeno,
           coalesce(pr.prijato, 0) as prijato,
           coalesce(dk.dokonceno, 0) as dokonceno,
           coalesce(od.hodiny, 0) as odpracovano,
           coalesce(od.bezicich, 0) as bezicich
    from ucty u
    left join public.profiles p on p.id = u.user_id
    left join prijati pr on pr.user_id is not distinct from u.user_id
    left join dokoncili dk on dk.user_id is not distinct from u.user_id
    left join odpracovano od on od.user_id is not distinct from u.user_id
  ),
  -- Klíč hodinové práce se přeloží na účet předem: FULL JOIN nesmí mít OR v podmínce.
  hodinova_klic as (
    select h.*,
           coalesce(
             case when h.klic not like 'jmeno:%' then h.klic end,
             (select l.klic_ucet from lide l where l.klic_jmeno = h.klic and l.klic_jmeno <> 'jmeno:' limit 1),
             h.klic
           ) as klic_final
    from hodinova h
  ),
  spojeni as (
    select coalesce(l.jmeno, h.jmeno) as jmeno,
           l.user_id,
           coalesce(l.prijato, 0) as prijato,
           coalesce(l.dokonceno, 0) as dokonceno,
           coalesce(l.odpracovano, 0) as odpracovano,
           coalesce(l.bezicich, 0) as bezicich,
           coalesce(h.hodiny, 0) as hodiny,
           coalesce(h.trzba, 0) as trzba
    from lide l
    full outer join hodinova_klic h on h.klic_final = l.klic_ucet
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', s.user_id, 'name', s.jmeno, 'prijato', s.prijato, 'dokonceno', s.dokonceno,
    'odpracovanoHodin', round(s.odpracovano::numeric, 2),
    'bezicichUseku', s.bezicich,
    'hodiny', round(s.hodiny, 2), 'trzbaHodin', round(s.trzba, 2)
  ) order by s.dokonceno desc, s.prijato desc, s.odpracovano desc, s.hodiny desc, s.jmeno), '[]'::jsonb)
  into v_vysledek
  from spojeni s
  where s.prijato > 0 or s.dokonceno > 0 or s.hodiny > 0 or s.odpracovano > 0 or s.bezicich > 0;

  return v_vysledek;
end;
$$;
revoke all on function public.statistiky_technici(uuid[], timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.statistiky_technici(uuid[], timestamptz, timestamptz, uuid) to authenticated, service_role;

-- ── 8) Odměny týmu ──────────────────────────────────────────────────────────
-- Odměna, která by připadla majiteli aplikace (přidal opravu, je přidělený),
-- je pro ostatní „Nepřiřazeno“; v seznamu lidí, výplatách ani automatickém
-- schvalování není; schválení nebo přidání ruční odměny od něj je „Systém“.
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
  -- root: majitel aplikace, kterého volající nesmí vidět (null = nikdo).
  v_skryty uuid := public.root_owner_skryty_id();
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
        and a.user_id is distinct from v_skryty -- root
    ), '[]'::jsonb)
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

comment on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) is
  'Odměny týmu: řádky za období (podle režimu config.odmeny.kdy: data vydání zakázky, přidání opravy, nebo prvního dosažení stavu), součty na člověka (včetně schválených ručních odměn podle obdobi), měsíční řada 12 měsíců zpět, vyplaceno, ruční odměny (rucni, cekajici), aktivní pravidla a automatické schvalování. Majitel aplikace je pro ostatní neviditelný (Nepřiřazeno / Systém).';
revoke all on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) to authenticated;

-- ── 9) Protokol anonymizace (GDPR) ──────────────────────────────────────────
create or replace function public.anonymizace_protokol(p_service_id uuid, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_owner_or_admin(p_service_id) then
    raise exception 'Protokol anonymizace vidí jen majitel nebo správce servisu.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    -- Nejpřísnější ručně potvrzené pravidlo: denní úloha běží, když je
    -- nastavený počet let stejný nebo mírnější.
    'potvrzenoLet', (
      select min(x.po_letech) from public.gdpr_anonymizace_log x
      where x.service_id = p_service_id and x.zdroj = 'rucne'
    ),
    'behy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'spustenoAt', l.spusteno_at,
      'zdroj', l.zdroj,
      -- root: spuštění majitelem aplikace je pro ostatní „Systém“.
      'spustil', case when l.spustil = public.root_owner_skryty_id() then 'Systém'
                      else coalesce(nullif(btrim(p.nickname), ''), case when l.spustil is not null then 'člen týmu' end) end,
      'poLetech', l.po_letech,
      'hranice', l.hranice,
      'pocetZakazniku', l.pocet_zakazniku,
      'pocetZakazekBezKarty', l.pocet_zakazek_bez_karty,
      'pocetZakazek', l.pocet_zakazek,
      'pocetSmsKonverzaci', l.pocet_sms_konverzaci,
      'pocetSouboru', l.pocet_souboru,
      'souboruCeka', cardinality(l.soubory_cekaji),
      'souboryHotovo', l.soubory_smazano_at,
      'chybaSouboru', l.chyba_souboru
    ) order by l.spusteno_at desc)
    from (
      select * from public.gdpr_anonymizace_log x
      where x.service_id = p_service_id
      order by x.spusteno_at desc
      limit greatest(1, least(coalesce(p_limit, 10), 50))
    ) l
    left join public.profiles p on p.id = l.spustil
  ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.anonymizace_protokol(uuid, integer) from public, anon;
grant execute on function public.anonymizace_protokol(uuid, integer) to authenticated;
