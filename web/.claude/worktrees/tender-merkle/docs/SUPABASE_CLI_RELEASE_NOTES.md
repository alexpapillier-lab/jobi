# Supabase CLI – release notes (v2.67.1 → v2.75.0)

Upgrade proveden: **v2.75.0** (únor 2026).

---

## v2.75.0 (2026-02-02)

### Nové funkce
- **Stažení všech Edge Functions** – `supabase functions download` bez zadaného názvu stáhne všechny funkce (dříve bylo nutné uvádět jméno).

### Opravy
- Vylepšený příkaz **download**: podpora stažení všech funkcí, oprava pořadí parametrů u `downloadAll`, lepší error handling při hromadném stahování.
- Opravy linteru a formátování.

### Ostatní
- Úpravy linteru, konzistentní výstup chyb (`fmt.Fprintln` místo `fmt.Println`).

**Dopad na tvůj workflow:** Žádná breaking change. `db push` a `functions deploy` se chovají stejně. Můžeš použít `supabase functions download` bez argumentu pro stažení všech funkcí z projektu.

---

## v2.74.0 (2026-01-30, prerelease)

### Nové funkce
- **Experimentální `db pull` jako deklarativní schémata** – nový způsob exportu schématu z databáze (declarative schemas).

**Dopad:** Nepovinná funkce; stávající migrace a příkazy beze změny.

---

## v2.73.0 (2026-01-30, prerelease)

### Nové funkce
- **Start lokální databáze ze schema souborů** – možnost spustit lokální Postgres ze souborů schématu (migrací).

### Opravy
- Docker: aktualizace image `supabase/postgres` (17.6.1.074 → 17.6.1.075).
- Aktualizace dalších Docker závislostí (docker-minor group).

**Dopad:** Pro vzdálený projekt (db push, functions deploy) bez změny. Lokální `supabase start` může používat novější Postgres image.

---

## Shrnutí pro Jobi

- **Vytváření servisu jen pro root ownera** – logika v Edge Functions, ne v CLI; upgrade CLI na to nemá vliv.
- **Migrace a deploy** – chování `supabase db push` a `supabase functions deploy` zůstává stejné.
- Žádné breaking changes v těchto verzích; upgrade je bezpečný.
