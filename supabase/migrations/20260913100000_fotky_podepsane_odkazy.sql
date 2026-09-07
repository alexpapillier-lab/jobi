-- Fotky a podpisy: příprava na neveřejný bucket.
--
-- CO BYLO ŠPATNĚ
-- Bucket `diagnostic-photos` je založený jako veřejný (`storage.buckets.public
-- = true`, migrace 20260218000000). Veřejná cesta `/storage/v1/object/public/…`
-- se vyřizuje mimo RLS – politiky se na ni vůbec nezeptají. Migrace
-- 20260909140000 sice omezila čtení na členy servisu, ale to zabránilo jen
-- výpisu obsahu bucketu. Kdokoli s odkazem si dál stáhl fotku cizího zařízení
-- nebo podpis převzetí, bez přihlášení. Odkazy přitom chodily do zákaznického
-- portálu, do exportu dat i do tiskového HTML.
--
-- CO SE MĚNÍ TADY
-- Aplikace nově nikde nepoužívá veřejnou adresu – před zobrazením si nechá
-- podepsat krátkodobý odkaz (`createSignedUrl`). Aby to fungovalo i na podpis
-- převzetí, musí na něj mít člen servisu právo číst.
--
-- Podpisy z portálu leží v `signatures/<ticket_id>-<čas>.png`, tedy ne pod
-- složkou servisu. Politika z 20260909140000 se ptá jen na první složku cesty,
-- takže na `signatures/…` nesedla vůbec: nahrávala je edge funkce pod
-- `service_role` a číst je přes klientské API nešlo. Dokud byl bucket veřejný,
-- nevadilo to – podpis se v kartě zakázky zobrazoval veřejnou adresou. Po
-- přepnutí na neveřejný by technik místo podpisu viděl prázdné místo.
--
-- Nově tedy: člen servisu smí číst soubory pod složkou svého servisu **a**
-- podpisy patřící k zakázkám svého servisu. Nic víc – zápis a mazání zůstávají
-- omezené na složku servisu, aby portálové podpisy pořád mohla měnit jen edge
-- funkce.
--
-- POSLEDNÍ KROK (`storage.buckets.public = false`) V TÉHLE MIGRACI NENÍ.
-- Musí přijít až po nasazení edge funkcí a vydání aplikace, jinak by fotky
-- zmizely dřív, než je kdo umí podepsat. Je připravený zvlášť v
-- `scripts/fotky-neverejny-bucket.sql`; postup je v
-- `docs/BEZPECNOST_FOTKY.md`.

-- Kdo je členem servisu, ke kterému patří zakázka z názvu souboru
-- `signatures/<ticket_id>-…`.
--
-- Vlastní funkce proto, že poddotaz do `public.tickets` uvnitř politiky na
-- `storage.objects` by se vyhodnocoval pod právy volajícího a narazil by na
-- RLS tabulky `tickets`. `security definer` to obejde, ale nevydá nic navíc:
-- vrací jen ano/ne k jedné konkrétní cestě.
create or replace function public.smim_cist_podpis(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Nejdřív se z cesty vyzobne id zakázky, teprve pak se hledá v databázi.
  -- Kdyby se místo toho porovnávalo `p_name like 'signatures/' || t.id || '-%'`
  -- přes všechny zakázky, byl by z toho průchod celou tabulkou při každém
  -- souboru – a to je dotaz, který běží u každého zobrazení podpisu.
  select exists (
    select 1
    from public.tickets t
    join public.service_memberships m on m.service_id = t.service_id
    where m.user_id = auth.uid()
      and t.id::text = substring(p_name from '^signatures/([0-9a-fA-F-]{36})-')
  )
$$;

revoke all on function public.smim_cist_podpis(text) from public, anon;
grant execute on function public.smim_cist_podpis(text) to authenticated;

comment on function public.smim_cist_podpis(text) is
  'Smí přihlášený uživatel číst podpis převzetí z cesty signatures/<ticket_id>-…? Používá politika čtení bucketu diagnostic-photos.';

drop policy if exists "diagnostic_photos_select" on storage.objects;
create policy "diagnostic_photos_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'diagnostic-photos'
  and (
    (storage.foldername(name))[1] in (
      select m.service_id::text from public.service_memberships m where m.user_id = auth.uid()
    )
    or (name like 'signatures/%' and public.smim_cist_podpis(name))
  )
);
