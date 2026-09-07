-- POSLEDNÍ KROK: zavření veřejného přístupu k fotkám a podpisům.
--
-- Schválně to není migrace. Migrace se pouštějí dávkou a tenhle příkaz musí
-- přijít až úplně nakonec – po nasazení edge funkcí a po vydání aplikace,
-- která umí podepsané odkazy. Kdyby se pustil dřív, fotky by v aplikaci
-- i v portálu zmizely dřív, než je bude kdo umět zobrazit.
--
-- Pouští se ručně v SQL editoru Supabase. Postup a kontroly: docs/BEZPECNOST_FOTKY.md
--
--   1. nasadit edge funkce (portal-ticket, service-manage)
--   2. vydat aplikaci a nasadit web/z/ (portál)
--   3. pustit migrace (mimo jiné 20260913100000 – čtení podpisů členem servisu)
--   4. teprve pak tenhle soubor
--
-- Vrátit zpět jde jedním příkazem, viz úplně dole.

-- Kontrola před: co je veřejné.
-- Očekává se `diagnostic-photos = true` (ještě neopraveno) a
-- `product-images = true` (tak to má být – obrázky produktů se ukazují ve
-- veřejném ceníku a v odkazech veřejného API skladu).
select id, public from storage.buckets order by id;

-- Vlastní přepnutí. `product-images` se NEMĚNÍ.
update storage.buckets
set public = false
where id = 'diagnostic-photos';

-- Kontrola po: diagnostic-photos = false, product-images = true.
select id, public from storage.buckets order by id;

-- Návrat zpět, kdyby se ukázalo, že něco nezobrazuje:
--   update storage.buckets set public = true where id = 'diagnostic-photos';
-- Je to jen dočasná záplata – veřejný bucket znamená, že fotky zákazníků
-- jsou zase ke stažení bez přihlášení.
