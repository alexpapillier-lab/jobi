-- Obecné počítadlo událostí pro limity.
--
-- Zápisové API má vlastní tabulku podle token_id, ale limity potřebují i
-- funkce, které s tokeny API nepracují: nahrávání fotek z telefonu a hlášení
-- chyb. Tohle je jedna tabulka pro všechny takové případy: kanál (jaká
-- funkce), klíč (co se počítá – token, uživatel, otisk IP) a minuta.
--
-- Klíč se ukládá tak, jak ho funkce předá; osobní údaje se do něj dávat
-- nemají – u IP se posílá solený otisk, ne adresa.
create table if not exists public.rate_hits (
  kanal text not null,
  klic text not null,
  minuta timestamptz not null,
  pocet integer not null default 0,
  primary key (kanal, klic, minuta)
);

alter table public.rate_hits enable row level security;
-- Bez politiky: čte a píše jen service_role z edge funkcí.
revoke all on table public.rate_hits from anon, authenticated;

comment on table public.rate_hits is
  'Počty událostí po minutách pro limity edge funkcí (capture-upload, support-report). Úklid dělá api_uklid_starych_zaznamu.';

/**
 * Započítá jednu událost a vrátí, kolikátá je v probíhající minutě.
 * Volá se i pro požadavky, které nakonec spadnou na chybu – jinak by šlo
 * limit obcházet posíláním nesmyslů.
 */
create or replace function public.zapocitej_udalost(p_kanal text, p_klic text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minuta timestamptz := date_trunc('minute', now());
  v_pocet integer;
begin
  insert into public.rate_hits (kanal, klic, minuta, pocet)
  values (p_kanal, p_klic, v_minuta, 1)
  on conflict (kanal, klic, minuta)
  do update set pocet = public.rate_hits.pocet + 1
  returning pocet into v_pocet;
  return v_pocet;
end;
$$;

revoke all on function public.zapocitej_udalost(text, text) from public, anon, authenticated;
grant execute on function public.zapocitej_udalost(text, text) to service_role;

/** Součet za posledních N minut – pro limity delší než jedna minuta. */
create or replace function public.pocet_udalosti(p_kanal text, p_klic text, p_minut integer)
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(pocet), 0)::integer
  from public.rate_hits
  where kanal = p_kanal and klic = p_klic
    and minuta > date_trunc('minute', now()) - make_interval(mins => greatest(p_minut, 1));
$$;

revoke all on function public.pocet_udalosti(text, text, integer) from public, anon, authenticated;
grant execute on function public.pocet_udalosti(text, text, integer) to service_role;

-- Úklid: staré minuty nikoho nezajímají a tabulka by rostla donekonečna.
create or replace function public.rate_hits_uklid()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_hits where minuta < now() - interval '2 days';
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('jobi-uklid-limitu') where exists (select 1 from cron.job where jobname = 'jobi-uklid-limitu');
    perform cron.schedule('jobi-uklid-limitu', '25 3 * * *', 'SELECT public.rate_hits_uklid()');
  end if;
end $$;
