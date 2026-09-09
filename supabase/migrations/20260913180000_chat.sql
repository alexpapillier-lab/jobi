-- Interní chat týmu
-- ============================================================================
--
-- PROČ: Servis si dnes domlouvá práci přes SMS, WhatsApp nebo ústně u pultu
-- a nic z toho se nedá dohledat u zakázky. Chat žije přímo v aplikaci:
-- kanál celého servisu, kanál každé pobočky a soukromé zprávy mezi dvěma
-- lidmi. Zpráva umí odkázat na zakázku, zákazníka nebo kolegu (`mentions`)
-- a nést přílohu z neveřejného úložiště (`attachments`).
--
-- KANÁL SE NEUKLÁDÁ JAKO SLOUPEC, plyne ze dvou nullable klíčů:
--   branch_id null & recipient_id null  → kanál celého servisu  ('servis')
--   branch_id                           → kanál pobočky         ('pobocka:<branch_id>')
--   recipient_id                        → soukromá zpráva       ('dm:<ten druhý>')
-- Obojí najednou zakazuje check. Klient i funkce níž používají stejné
-- textové klíče kanálů, protože podle nich se vedou i značky přečtení.
--
-- KDO CO VIDÍ: jen nescrytý člen servisu (skrytý člen je podpora – majitel
-- aplikace – a v týmu se neukazuje, tak se nesmí objevit ani v chatu).
-- Kanál pobočky vidí jen ten, komu je pobočka povolená (`pobocka_povolena`,
-- stejné pravidlo jako u zakázek – člen omezený na Brno nesmí číst, co si
-- píší v Praze). Soukromou zprávu vidí jen její dva účastníci, správce ne.
--
-- MAZÁNÍ JE JEN MĚKKÉ (`deleted_at`): řádek zůstává, aby vlákno nedostalo
-- díru a reakce/odkazy dál seděly; text a přílohy se při smazání vyprázdní,
-- takže se přes REST nedočte ani to, co „zmizelo“. Připnout smí jen majitel
-- nebo správce – trigger to hlídá po sloupcích, protože RLS umí říct jen
-- „řádek ano/ne“, ne „tenhle sloupec ne“.
--
-- Všechna pravidla viditelnosti jsou v JEDNÉ funkci (`chat_kanal_viditelny`),
-- kterou volají politiky i RPC. Kdyby se pravidlo rozešlo mezi politikou
-- a funkcí nepřečtených, ukázalo by se číslo u kanálu, který nejde otevřít.

-- ── 1) Tabulky ───────────────────────────────────────────────────────────────

create table if not exists public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references public.services(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete cascade,
  recipient_id  uuid references auth.users(id) on delete cascade,
  sender_id     uuid not null references auth.users(id) on delete cascade,
  text          text not null check (char_length(text) <= 4000),
  -- pole objektů {typ: 'zakazka'|'zakaznik'|'clen', id: text, popis: text}
  mentions      jsonb not null default '[]'::jsonb check (jsonb_typeof(mentions) = 'array'),
  -- pole objektů {path: text (cesta v bucketu chat-prilohy), name: text, type: text, size: int}
  attachments   jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  pinned        boolean not null default false,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,
  constraint chat_messages_jeden_kanal check (branch_id is null or recipient_id is null)
);

comment on table public.chat_messages is
  'Interní chat týmu: kanál servisu (branch_id i recipient_id null), kanál pobočky (branch_id) nebo soukromá zpráva (recipient_id). Mazání jen měkké přes deleted_at.';
comment on column public.chat_messages.mentions is
  'Odkazy ve zprávě: [{typ: zakazka|zakaznik|clen, id, popis}].';
comment on column public.chat_messages.attachments is
  'Přílohy v bucketu chat-prilohy: [{path, name, type, size}].';

create index if not exists chat_messages_servis_cas_idx
  on public.chat_messages (service_id, created_at desc);
create index if not exists chat_messages_pobocka_cas_idx
  on public.chat_messages (service_id, branch_id, created_at desc);
create index if not exists chat_messages_dm_cas_idx
  on public.chat_messages (service_id, sender_id, recipient_id, created_at desc);

-- Značka „přečteno do“ – jeden řádek na člověka, servis a kanál.
create table if not exists public.chat_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  service_id   uuid not null references public.services(id) on delete cascade,
  kanal        text not null check (kanal = 'servis' or kanal ~ '^(pobocka|dm):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  last_read_at timestamptz not null default now(),
  primary key (user_id, service_id, kanal)
);

comment on table public.chat_reads is
  'Do kdy má člověk kanál přečtený. Klíč kanálu: servis | pobocka:<branch_id> | dm:<id druhého člověka>.';

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

comment on table public.chat_reactions is 'Reakce emoji na zprávu chatu; jedna na člověka a emoji.';

-- ── 2) Pomocné funkce pro politiky ──────────────────────────────────────────
-- security definer + row_security off: politika nad chat_messages se ptá na
-- členství a pobočky, a ty tabulky mají vlastní RLS. Funkce vrací jen ano/ne.

-- Nescrytý člen servisu.
create or replace function public.chat_je_clen(p_service_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p_user_id is not null and exists (
    select 1
      from public.service_memberships m
     where m.service_id = p_service_id
       and m.user_id = p_user_id
       and m.skryty = false
  );
$$;
revoke all on function public.chat_je_clen(uuid, uuid) from public, anon;
grant execute on function public.chat_je_clen(uuid, uuid) to authenticated, service_role;

-- Smí přihlášený vidět zprávu s těmito klíči kanálu? Jediný zdroj pravdy
-- pro politiky čtení, reakce i všechny RPC níž.
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
           when p_branch_id is not null then public.pobocka_povolena(p_service_id, p_branch_id)
           else true
         end;
$$;
revoke all on function public.chat_kanal_viditelny(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.chat_kanal_viditelny(uuid, uuid, uuid, uuid) to authenticated, service_role;

-- Smí přihlášený do tohoto kanálu psát? Navíc k viditelnosti: pobočka musí
-- patřit servisu (správce má povolené všechny pobočky, i cizího servisu by
-- mu `pobocka_povolena` odkývala) a příjemce soukromé zprávy musí být
-- nescrytý člen téhož servisu a ne já sám.
create or replace function public.chat_smi_psat(p_service_id uuid, p_branch_id uuid, p_recipient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select public.chat_kanal_viditelny(p_service_id, p_branch_id, auth.uid(), p_recipient_id)
     and (p_branch_id is null or exists (
           select 1 from public.branches b where b.id = p_branch_id and b.service_id = p_service_id))
     and (p_recipient_id is null or (
           p_recipient_id <> auth.uid() and public.chat_je_clen(p_service_id, p_recipient_id)));
$$;
revoke all on function public.chat_smi_psat(uuid, uuid, uuid) from public, anon;
grant execute on function public.chat_smi_psat(uuid, uuid, uuid) to authenticated, service_role;

-- ── 3) RLS ───────────────────────────────────────────────────────────────────

alter table public.chat_messages  enable row level security;
alter table public.chat_messages  force row level security;
alter table public.chat_reads     enable row level security;
alter table public.chat_reads     force row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_reactions force row level security;

-- Supabase dává novým tabulkám práva anon/authenticated/service_role
-- automaticky (default privileges); tady se nastavují přesně.
revoke all on table public.chat_messages, public.chat_reads, public.chat_reactions from public, anon, authenticated;
grant select, insert, update on table public.chat_messages  to authenticated;
grant select, insert, update on table public.chat_reads     to authenticated;
grant select, insert, delete on table public.chat_reactions to authenticated;
grant all on table public.chat_messages, public.chat_reads, public.chat_reactions to service_role;

-- chat_messages: smazané zprávy se dál vrací (klient ukáže „zpráva smazána“).
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (public.chat_kanal_viditelny(service_id, branch_id, sender_id, recipient_id));

-- Vložit jde jen vlastní, nepřipnutá a nesmazaná zpráva do kanálu, kam smím psát.
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and pinned = false
    and deleted_at is null
    and public.chat_smi_psat(service_id, branch_id, recipient_id)
  );

-- Měnit smí autor nebo majitel/správce – ale jen zprávu, kterou vidí (správce
-- nevidí cizí soukromé zprávy, tak je nesmí ani smazat). Které sloupce smí
-- kdo měnit, hlídá trigger níž.
drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update to authenticated
  using (
    public.chat_kanal_viditelny(service_id, branch_id, sender_id, recipient_id)
    and (sender_id = auth.uid() or public.is_owner_or_admin(service_id))
  )
  with check (
    public.chat_kanal_viditelny(service_id, branch_id, sender_id, recipient_id)
    and (sender_id = auth.uid() or public.is_owner_or_admin(service_id))
  );

-- Žádná politika pro DELETE (a ani grant): mazání je jen měkké.

-- Deaktivovaný servis nečte, zamčený (bez nároku access) nepíše – stejně
-- jako u ostatních dat servisu (20260911100000).
drop policy if exists chat_messages_jen_zapnuty_servis on public.chat_messages;
create policy chat_messages_jen_zapnuty_servis on public.chat_messages
  as restrictive for select to authenticated
  using (public.servis_je_aktivni(service_id));
drop policy if exists chat_messages_jen_s_pristupem_vlozeni on public.chat_messages;
create policy chat_messages_jen_s_pristupem_vlozeni on public.chat_messages
  as restrictive for insert to authenticated
  with check (public.servis_smi_pracovat(service_id));
drop policy if exists chat_messages_jen_s_pristupem_zmena on public.chat_messages;
create policy chat_messages_jen_s_pristupem_zmena on public.chat_messages
  as restrictive for update to authenticated
  using (public.servis_smi_pracovat(service_id))
  with check (public.servis_smi_pracovat(service_id));

-- chat_reads: jen vlastní řádky, jen člen servisu; mazat netřeba.
drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists chat_reads_insert on public.chat_reads;
create policy chat_reads_insert on public.chat_reads
  for insert to authenticated
  with check (user_id = auth.uid() and public.chat_je_clen(service_id, auth.uid()));
drop policy if exists chat_reads_update on public.chat_reads;
create policy chat_reads_update on public.chat_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.chat_je_clen(service_id, auth.uid()));

-- chat_reactions: vidím tam, kde vidím zprávu (poddotaz do chat_messages
-- běží pod politikou čtení volajícího); přidám a odeberu jen svoje.
drop policy if exists chat_reactions_select on public.chat_reactions;
create policy chat_reactions_select on public.chat_reactions
  for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = chat_reactions.message_id));
drop policy if exists chat_reactions_insert on public.chat_reactions;
create policy chat_reactions_insert on public.chat_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.chat_messages m where m.id = chat_reactions.message_id and m.deleted_at is null)
  );
drop policy if exists chat_reactions_delete on public.chat_reactions;
create policy chat_reactions_delete on public.chat_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ── 4) Trigger: co smí kdo na zprávě měnit ──────────────────────────────────
-- RLS pustí autora i správce k celému řádku; tady se rozhoduje po sloupcích:
--   * klíče kanálu, autor a čas vzniku se nemění nikdy (zpráva se nepřesouvá),
--   * připnout smí jen majitel/správce,
--   * text, odkazy a přílohy mění jen autor; správce cizí zprávu jen smaže,
--   * při změně textu/příloh se edited_at nastaví tady (klient ho posílat nemusí),
--   * smazaná zpráva ztratí text, odkazy i přílohy – řádek zůstane kvůli
--     vláknu, obsah ne.
-- service_role (auth.uid() null) prochází bez kontrol – to je majitel aplikace
-- přes edge funkci, ne člověk u pultu.
create or replace function public.chat_messages_hlidej_zmenu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vlastni boolean;
  v_spravce boolean;
begin
  if v_uid is null then
    return new;
  end if;

  if new.id <> old.id
     or new.service_id <> old.service_id
     or new.sender_id <> old.sender_id
     or new.branch_id is distinct from old.branch_id
     or new.recipient_id is distinct from old.recipient_id
     or new.created_at <> old.created_at then
    raise exception 'Zprávu nejde přesunout ani změnit jejího autora.' using errcode = '42501';
  end if;

  v_vlastni := old.sender_id = v_uid;
  v_spravce := public.is_owner_or_admin(old.service_id);

  if new.pinned <> old.pinned and not v_spravce then
    raise exception 'Připnout zprávu může jen majitel nebo správce.' using errcode = '42501';
  end if;

  if not v_vlastni and (
       new.text <> old.text
    or new.mentions <> old.mentions
    or new.attachments <> old.attachments
  ) then
    raise exception 'Cizí zprávu nejde upravit, jen smazat.' using errcode = '42501';
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Smazanou zprávu nejde obnovit.' using errcode = '42501';
  end if;

  if new.deleted_at is not null then
    new.text := '';
    new.mentions := '[]'::jsonb;
    new.attachments := '[]'::jsonb;
    new.pinned := false;
  elsif new.text <> old.text or new.attachments <> old.attachments or new.mentions <> old.mentions then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_chat_messages_hlidej_zmenu on public.chat_messages;
create trigger trg_chat_messages_hlidej_zmenu
  before update on public.chat_messages
  for each row execute function public.chat_messages_hlidej_zmenu();

-- ── 5) RPC pro klienta ───────────────────────────────────────────────────────

-- Seznam kanálů, které přihlášený smí vidět:
--   [{kanal:'servis', nazev},
--    {kanal:'pobocka:<id>', nazev}          … jen povolené pobočky a jen když
--                                             má servis víc než jednu,
--    {kanal:'dm:<user_id>', nazev, avatar_url} … každý nescrytý člen kromě mě]
-- Nečlen dostane '[]' a nedozví se nic.
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
     and m.user_id <> v_uid;

  return v_out || v_lide;
end;
$$;
revoke all on function public.chat_kanaly(uuid) from public, anon;
grant execute on function public.chat_kanaly(uuid) to authenticated;

-- Nepřečtené zprávy po kanálech: {"servis": 3, "pobocka:<id>": 1, "dm:<id>": 2}.
-- Počítají se jen zprávy, které bych viděl, nesmazané, od jiných lidí a
-- novější než moje značka přečtení (bez značky = všechny). Nulové kanály
-- se nevrací; nečlen dostane '{}'.
create or replace function public.chat_neprectene(p_service_id uuid)
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
begin
  if not public.chat_je_clen(p_service_id, v_uid) then
    return '{}'::jsonb;
  end if;

  select coalesce(jsonb_object_agg(k.kanal, k.pocet), '{}'::jsonb)
    into v_out
    from (
      select z.kanal, count(*) as pocet
        from (
          select m.created_at,
                 case
                   when m.recipient_id is not null then
                     'dm:' || (case when m.sender_id = v_uid then m.recipient_id else m.sender_id end)::text
                   when m.branch_id is not null then 'pobocka:' || m.branch_id::text
                   else 'servis'
                 end as kanal
            from public.chat_messages m
           where m.service_id = p_service_id
             and m.deleted_at is null
             and m.sender_id <> v_uid
             and public.chat_kanal_viditelny(m.service_id, m.branch_id, m.sender_id, m.recipient_id)
        ) z
        left join public.chat_reads r
          on r.user_id = v_uid and r.service_id = p_service_id and r.kanal = z.kanal
       where r.last_read_at is null or z.created_at > r.last_read_at
       group by z.kanal
    ) k;

  return v_out;
end;
$$;
revoke all on function public.chat_neprectene(uuid) from public, anon;
grant execute on function public.chat_neprectene(uuid) to authenticated;

-- Označí kanál za přečtený teď.
create or replace function public.chat_precteno(p_service_id uuid, p_kanal text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nepřihlášeno' using errcode = '28000';
  end if;
  if not public.chat_je_clen(p_service_id, auth.uid()) then
    raise exception 'Nejste členem servisu.' using errcode = '42501';
  end if;
  insert into public.chat_reads (user_id, service_id, kanal, last_read_at)
  values (auth.uid(), p_service_id, p_kanal, now())
  on conflict (user_id, service_id, kanal) do update
    set last_read_at = now();
end;
$$;
revoke all on function public.chat_precteno(uuid, text) from public, anon;
grant execute on function public.chat_precteno(uuid, text) to authenticated;

-- Hledání v textu zpráv (ilike), jen viditelné a nesmazané, od nejnovější.
-- Zástupné znaky z dotazu se escapují, ať „50%“ hledá opravdu procento.
create or replace function public.chat_hledej(p_service_id uuid, p_dotaz text, p_limit int default 50)
returns setof public.chat_messages
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select m.*
    from public.chat_messages m
   where auth.uid() is not null
     and public.chat_je_clen(p_service_id, auth.uid())
     and btrim(coalesce(p_dotaz, '')) <> ''
     and m.service_id = p_service_id
     and m.deleted_at is null
     and m.text ilike '%' || replace(replace(replace(btrim(p_dotaz), '\', '\\'), '%', '\%'), '_', '\_') || '%'
     and public.chat_kanal_viditelny(m.service_id, m.branch_id, m.sender_id, m.recipient_id)
   order by m.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke all on function public.chat_hledej(uuid, text, int) from public, anon;
grant execute on function public.chat_hledej(uuid, text, int) to authenticated;

-- ── 6) Realtime ──────────────────────────────────────────────────────────────
-- Publikace nemění práva: postgres_changes pošle změnu jen tomu, kdo řádek
-- smí číst podle politiky select – tedy člen servisu, u pobočky jen s
-- povolenou pobočkou, u soukromé zprávy jen její dva účastníci.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publikace supabase_realtime neexistuje, přeskakuji.';
    return;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reactions'
  ) then
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
end $$;

-- ── 7) Úložiště příloh ───────────────────────────────────────────────────────
-- Neveřejný bucket; klient si nechá podepsat krátkodobý odkaz. Cesta objektu
-- je `<service_id>/<cokoliv>`: první složka rozhoduje, čí příloha to je.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-prilohy',
  'chat-prilohy',
  false,
  15728640, -- 15 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Je první složka cesty id servisu, jehož jsem nescrytý člen? Regulární
-- výraz je tu proto, aby přetypování na uuid nespadlo na cizí cestě.
create or replace function public.chat_priloha_clena(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce((storage.foldername(p_name))[1], '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     and public.chat_je_clen(((storage.foldername(p_name))[1])::uuid, auth.uid());
$$;
revoke all on function public.chat_priloha_clena(text) from public, anon;
grant execute on function public.chat_priloha_clena(text) to authenticated, service_role;

drop policy if exists "chat_prilohy_select" on storage.objects;
create policy "chat_prilohy_select"
on storage.objects for select
to authenticated
using (bucket_id = 'chat-prilohy' and public.chat_priloha_clena(name));

drop policy if exists "chat_prilohy_insert" on storage.objects;
create policy "chat_prilohy_insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'chat-prilohy' and public.chat_priloha_clena(name));

-- Smazat smí jen ten, kdo soubor nahrál (storage nastaví owner na auth.uid()).
drop policy if exists "chat_prilohy_delete" on storage.objects;
create policy "chat_prilohy_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'chat-prilohy' and owner = auth.uid());
