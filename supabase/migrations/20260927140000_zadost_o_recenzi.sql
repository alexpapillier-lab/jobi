-- ============================================================================
-- Žádost o recenzi po vydání zakázky + minimální plánovač automatizací
-- ============================================================================
--
-- PROČ: Servis chce, aby zákazník den po vyzvednutí dostal SMS s poděkováním
-- a odkazem na Google recenze (Firmy.cz, Heureka…). Stavebnice automatizací
-- (20260904150000) uměla jen „hned při změně stavu“ a „ve stavu déle než“;
-- zpožděnou akci „X po události“ neuměla. „Ve stavu déle než“ se na to
-- nehodí: nezná denní okno (SMS ve 23:40 zákazníka naštve víc, než potěší),
-- nehlídá, kolik žádostí dostal stejný zákazník (B2B s deseti zakázkami
-- měsíčně by dostal deset SMS), a vzala by zpětně všechny dávno vydané
-- zakázky hned po zapnutí pravidla.
--
-- Co přidává:
--   1) automation_rules: nový spouštěč `ticket_issued` a akce `review_request`
--      (tvary v src/lib/automations.ts).
--   2) automation_schedule – obecná fronta naplánovaných akcí (`run_at`).
--      Zpracovává ji plánovaný tik edge funkce automations-run (pg_cron
--      každých 15 minut, beze změny). Dá se použít i pro další „za X“ akce:
--      řádek nese rule_id + ticket_id + druh + payload.
--   3) Trigger na tickets: při přepnutí do vydaného stavu naplánuje řádek
--      pro každé aktivní pravidlo `ticket_issued` servisu. Jen UPDATE, ne
--      INSERT – import historie zakázek (rovnou ve stavu Vydáno) nesmí
--      rozeslat žádosti za roky zpátky.
--   4) zadosti_o_recenzi – záznam „žádost odeslána“ (komu, kdy, kanál).
--      Podle něj se hlídá limit „jednou za N dní na zákazníka“ a počítá
--      „odesláno za 30 dní“ v kartě pravidla.
--   5) customers.neposilat_zadost_o_recenzi – příznak u zákazníka. Obecný
--      „marketing vypnut“ v Jobi neexistuje (ověřeno 27. 9.: žádný sloupec
--      ani nastavení), proto úzký příznak jen na tohle.
--
-- Nic se nemaže a nemění se žádná data. Idempotentní – jde pustit opakovaně.
-- Po nasazení: supabase functions deploy automations-run --no-verify-jwt
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Povolené typy spouštěčů a akcí
-- ---------------------------------------------------------------------------
-- Omezení se jen rozšiřuje (všechny dosavadní hodnoty zůstávají), proto se
-- smí zahodit a založit znovu. Tabulka pravidel má pár desítek řádků.
alter table public.automation_rules drop constraint if exists automation_rules_trigger_type_check;
alter table public.automation_rules
  add constraint automation_rules_trigger_type_check
  check (trigger->>'type' in ('status_change', 'status_age', 'event', 'ticket_created', 'ticket_issued'));

alter table public.automation_rules drop constraint if exists automation_rules_action_type_check;
alter table public.automation_rules
  add constraint automation_rules_action_type_check
  check (action->>'type' in ('sms', 'email', 'set_status', 'add_fee', 'notify', 'review_request'));

comment on column public.automation_rules.trigger is
  '{type: status_change, status_key} | {type: status_age, status_key, after_hours, repeat_hours?} | {type: event, event} | {type: ticket_created} | {type: ticket_issued, after_hours, status_keys?}';
comment on column public.automation_rules.action is
  '{type: sms, template} | {type: email, subject, body} | {type: set_status, status_key} | {type: add_fee, name, amount, per_day?} | {type: notify, message} | {type: review_request, review_url, template, email_subject, email_body}';
comment on column public.automation_rules.conditions is
  '{skip_final?, once_per_ticket?, require_phone?, require_email?, send_from_hour?, send_to_hour?, time_zone?, customer_cooldown_days?}';

-- ---------------------------------------------------------------------------
-- 2) Příznak u zákazníka
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists neposilat_zadost_o_recenzi boolean not null default false;

comment on column public.customers.neposilat_zadost_o_recenzi is
  'Zákazník nechce žádosti o recenzi (automatizace review_request ho přeskočí). Přepínač v Zákaznících.';

-- ---------------------------------------------------------------------------
-- 3) Který stav je „vydáno“
-- ---------------------------------------------------------------------------
-- Zrcadlo jeVydanyStav v supabase/functions/_shared/recenze.ts: koncový
-- stav, který není storno (stav_je_storno) ani vrácení bez opravy /
-- nevyzvednuto. Když si servis stavy v pravidle vybral (`status_keys`),
-- platí jeho výběr.
create or replace function public.stav_je_vydany(p_service_id uuid, p_status text, p_status_keys jsonb default null)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_final boolean;
  v_label text;
begin
  if p_status is null or p_status = '' then
    return false;
  end if;

  if p_status_keys is not null
     and jsonb_typeof(p_status_keys) = 'array'
     and jsonb_array_length(p_status_keys) > 0 then
    return p_status_keys ? p_status;
  end if;

  select coalesce(s.is_final, false), coalesce(s.label, '')
    into v_final, v_label
  from public.service_statuses s
  where s.service_id = p_service_id and s.key = p_status
  limit 1;

  if not coalesce(v_final, false) then
    return false;
  end if;
  if public.stav_je_storno(p_status, v_label) then
    return false;
  end if;
  if p_status ~* '(return|unclaimed|no_repair|bez_oprav)'
     or v_label ~* '(bez oprav|vrácen|vracen|nevyzved|neprevz|nepřevz)' then
    return false;
  end if;
  return true;
end;
$$;

-- Bez security definer: volá ji trigger (ten běží pod vlastníkem) a server.
-- Klient ji nepotřebuje – aplikace má zrcadlo v TypeScriptu.
revoke all on function public.stav_je_vydany(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.stav_je_vydany(uuid, text, jsonb) to service_role;

comment on function public.stav_je_vydany(uuid, text, jsonb) is
  'Je stav zakázky „vydáno“ (koncový, ne storno, ne vráceno bez opravy)? S p_status_keys rozhoduje výběr stavů z pravidla. Zrcadlo jeVydanyStav v supabase/functions/_shared/recenze.ts.';

-- ---------------------------------------------------------------------------
-- 4) automation_schedule – fronta naplánovaných akcí
-- ---------------------------------------------------------------------------
create table if not exists public.automation_schedule (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  -- Co se má stát. 'rule' = vyhodnotit pravidlo rule_id nad zakázkou ticket_id.
  kind text not null default 'rule',
  run_at timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  detail text,
  claimed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_schedule_status_check') then
    alter table public.automation_schedule
      add constraint automation_schedule_status_check
      check (status in ('pending', 'processing', 'done', 'skipped', 'error', 'cancelled'));
  end if;
end $$;

-- Tik bere nejstarší splatné řádky.
create index if not exists idx_automation_schedule_due
  on public.automation_schedule(run_at)
  where status = 'pending';
-- Jedna čekající akce na pravidlo a zakázku – opakované přepnutí do
-- vydaného stavu (Vydáno → oprava → Vydáno) nezaloží druhou.
create unique index if not exists ux_automation_schedule_pending_rule_ticket
  on public.automation_schedule(rule_id, ticket_id)
  where status in ('pending', 'processing');
create index if not exists idx_automation_schedule_service_created
  on public.automation_schedule(service_id, created_at desc);

comment on table public.automation_schedule is
  'Naplánované akce automatizací (run_at). Zakládá trigger na tickets (ticket_issued), zpracovává plánovaný tik edge funkce automations-run. Stavy: pending → processing → done / skipped / error / cancelled.';
comment on column public.automation_schedule.kind is
  'Druh akce. Zatím jen ''rule'' = vyhodnotit pravidlo rule_id nad zakázkou ticket_id.';
comment on column public.automation_schedule.claimed_at is
  'Kdy si řádek vzal tik. Řádek, který zůstane v processing déle než hodinu (pád funkce), vrátí další tik do pending.';

alter table public.automation_schedule enable row level security;

-- Čtení pro členy servisu (kolik čeká), zápis jen server (žádná politika
-- pro insert/update/delete – zakládá trigger security definer, mění
-- service_role).
drop policy if exists "automation_schedule_select_service_members" on public.automation_schedule;
create policy "automation_schedule_select_service_members"
  on public.automation_schedule
  for select to authenticated
  using (
    exists (
      select 1 from public.service_memberships m
      where m.service_id = automation_schedule.service_id and m.user_id = auth.uid()
    )
  );

-- §5 MIGRATIONS_SAFETY: tabulka s ticket_id jen k viditelným zakázkám
-- (člen omezený na pobočku nesmí přes frontu vidět cizí pobočku).
drop policy if exists "automation_schedule_jen_viditelne_zakazky" on public.automation_schedule;
create policy "automation_schedule_jen_viditelne_zakazky"
  on public.automation_schedule
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = automation_schedule.ticket_id));

-- ---------------------------------------------------------------------------
-- 5) zadosti_o_recenzi – co odešlo
-- ---------------------------------------------------------------------------
create table if not exists public.zadosti_o_recenzi (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete set null,
  ticket_id uuid references public.tickets(id) on delete set null,
  -- Smazaný zákazník si záznam nenechává (GDPR výmaz), limit pak drží
  -- telefon/e-mail jen u řádků bez zákazníka.
  customer_id uuid references public.customers(id) on delete cascade,
  telefon text,
  email text,
  kanal text not null,
  odeslano_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'zadosti_o_recenzi_kanal_check') then
    alter table public.zadosti_o_recenzi
      add constraint zadosti_o_recenzi_kanal_check check (kanal in ('sms', 'email'));
  end if;
end $$;

create index if not exists idx_zadosti_o_recenzi_service_odeslano
  on public.zadosti_o_recenzi(service_id, odeslano_at desc);
create index if not exists idx_zadosti_o_recenzi_customer
  on public.zadosti_o_recenzi(service_id, customer_id, odeslano_at desc)
  where customer_id is not null;
create index if not exists idx_zadosti_o_recenzi_telefon
  on public.zadosti_o_recenzi(service_id, telefon, odeslano_at desc)
  where telefon is not null;
create index if not exists idx_zadosti_o_recenzi_email
  on public.zadosti_o_recenzi(service_id, email, odeslano_at desc)
  where email is not null;
create index if not exists idx_zadosti_o_recenzi_ticket
  on public.zadosti_o_recenzi(ticket_id)
  where ticket_id is not null;

comment on table public.zadosti_o_recenzi is
  'Odeslané žádosti o recenzi (automatizace review_request). Limit „jednou za N dní na zákazníka“ a počet „odesláno za 30 dní“. Zapisuje jen edge funkce automations-run.';
comment on column public.zadosti_o_recenzi.telefon is 'E.164 (+420…), jak šla SMS; u e-mailu telefon zákazníka, pokud ho má – limit platí přes oba kontakty.';
comment on column public.zadosti_o_recenzi.email is 'Malými písmeny.';

alter table public.zadosti_o_recenzi enable row level security;

drop policy if exists "zadosti_o_recenzi_select_service_members" on public.zadosti_o_recenzi;
create policy "zadosti_o_recenzi_select_service_members"
  on public.zadosti_o_recenzi
  for select to authenticated
  using (
    exists (
      select 1 from public.service_memberships m
      where m.service_id = zadosti_o_recenzi.service_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "zadosti_o_recenzi_jen_viditelne_zakazky" on public.zadosti_o_recenzi;
create policy "zadosti_o_recenzi_jen_viditelne_zakazky"
  on public.zadosti_o_recenzi
  as restrictive for select to authenticated
  using (ticket_id is null or exists (select 1 from public.tickets t where t.id = zadosti_o_recenzi.ticket_id));

-- ---------------------------------------------------------------------------
-- 6) Naplánování při vydání zakázky
-- ---------------------------------------------------------------------------
-- AFTER UPDATE OF status: stav se opravdu změnil a nový je „vydaný“ podle
-- pravidla. Běží pod security definer, protože klient do fronty psát nesmí.
-- Chyba tady nesmí shodit uložení zakázky – plán je vedlejší, zakázka ne.
create or replace function public.automation_schedule_po_vydani()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_hodin numeric;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.deleted_at is not null then
    return new;
  end if;

  for r in
    select ar.id, ar.trigger
    from public.automation_rules ar
    where ar.service_id = new.service_id
      and ar.active
      and ar.trigger->>'type' = 'ticket_issued'
  loop
    begin
      if public.stav_je_vydany(new.service_id, new.status, r.trigger->'status_keys') then
        v_hodin := coalesce(nullif(r.trigger->>'after_hours', '')::numeric, 24);
        if v_hodin < 0 then v_hodin := 0; end if;
        if v_hodin > 24 * 60 then v_hodin := 24 * 60; end if;
        insert into public.automation_schedule (service_id, rule_id, ticket_id, kind, run_at, payload)
        values (
          new.service_id, r.id, new.id, 'rule',
          now() + make_interval(secs => (v_hodin * 3600)::double precision),
          jsonb_build_object('status', new.status, 'vydano_at', now())
        )
        on conflict (rule_id, ticket_id) where status in ('pending', 'processing') do nothing;
      end if;
    exception when others then
      raise warning 'automation_schedule_po_vydani (pravidlo %, zakázka %): %', r.id, new.id, sqlerrm;
    end;
  end loop;

  return new;
end;
$$;

revoke all on function public.automation_schedule_po_vydani() from public, anon, authenticated;

comment on function public.automation_schedule_po_vydani() is
  'Trigger: při přepnutí zakázky do vydaného stavu naplánuje do automation_schedule každé aktivní pravidlo ticket_issued servisu (run_at = teď + after_hours). Denní okno řeší až edge funkce při zpracování.';

drop trigger if exists trg_automation_schedule_po_vydani on public.tickets;
create trigger trg_automation_schedule_po_vydani
  after update of status on public.tickets
  for each row execute function public.automation_schedule_po_vydani();
