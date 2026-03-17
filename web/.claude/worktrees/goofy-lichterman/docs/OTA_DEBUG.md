# OTA update – kde hledat chybu, když se update nenabídne

Když máte nainstalovanou starší verzi (např. v0.1.2) a nový release (v0.1.3) je venku, ale aplikace update nenabídne, projděte tyto kroky.

---

## 1. Co bere aplikace jako zdroj update

Jobi stahuje jeden soubor:

- **URL:** `https://github.com/alexpapillier-lab/jobi/releases/latest/download/latest.json`
- **„Latest“** = release, který je na GitHubu označený jako **Latest release** (nejnověji publikovaný, ne pre-release).

Pokud tam není v0.1.3, aplikace novou verzi neuvidí.

---

## 2. Rychlá kontrola v prohlížeči

1. **Který release je „Latest“**  
   Otevřete:  
   https://github.com/alexpapillier-lab/jobi/releases  
   - U kterého release je štítek **„Latest“**?  
   - Má tam být **v0.1.3**. Pokud je „Latest“ pořád v0.1.2, pak `/releases/latest/download/` stále ukazuje na v0.1.2.

2. **Co vrací `latest.json`**  
   Otevřete přímo:  
   https://github.com/alexpapillier-lab/jobi/releases/latest/download/latest.json  
   - V JSONu by mělo být např. `"version": "0.1.3"`.  
   - Pokud je tam pořád `0.1.2`, pak buď:
     - je jako „Latest“ stále release v0.1.2, nebo  
     - jste do release v0.1.3 nenahráli nový soubor `latest.json` (nahraný byl starý z v0.1.2).

3. **Pre-release**  
   Pokud je v0.1.3 vytvořený jako **Pre-release**, GitHub ho **nebere** jako „Latest“.  
   V takovém případě `/releases/latest/` stále ukazuje na poslední **normální** release (např. v0.1.2).  
   Řešení: u release v0.1.3 zrušit zaškrtnutí „Pre-release“, nebo používat konkrétní tag v URL (viz níže).

---

## 3. Co musí být na release v0.1.3

Na release s tagem **v0.1.3** (ten, který má být „Latest“) musí být nahrané soubory:

1. **latest.json** – vygenerovaný skriptem `scripts/generate-jobi-latest-json.sh` (obsahuje `version: "0.1.3"` a správné URL k `.tar.gz`).
2. **jobi.app.tar.gz** – notarizovaná aplikace.
3. **jobi.app.tar.gz.sig** – podpis pro OTA.

Pokud jste `latest.json` vygenerovali až po vytvoření release a nahrali ho k jinému release (např. k v0.1.2), pak „Latest“ stále ukazuje na ten starý release a v něm je starý `latest.json` s 0.1.2.

---

## 4. Kontrola v aplikaci (v0.1.2)

1. Spusťte Jobi v0.1.2.
2. Otevřete **DevTools** (např. v Tauri: menu nebo zkratka pro Developer Tools).
3. V **Console** hledejte:
   - `[Updater]` – např. „Check or install failed:“ → tam může být důvod (síť, neplatný podpis, atd.).
   - Případně chyby při načítání nebo CORS.
4. Při návratu do okna (focus) se kontroluje znovu po 5 minutách; první kontrola je hned po startu.

---

## 5. Shrnutí – nejčastější důvody, proč se update nenabídne

| Důvod | Co zkontrolovat / udělat |
|-------|---------------------------|
| Na GitHubu je jako „Latest“ pořád v0.1.2 | Na stránce Releases zkontrolovat, který release má štítek „Latest“. V0.1.3 musí být publikovaný a **ne** Pre-release. |
| Do v0.1.3 nebyl nahrán nový `latest.json` | Na release v0.1.3 přidat asset **latest.json** vygenerovaný pro v0.1.3 (obsahuje `"version": "0.1.3"`). |
| V0.1.3 je Pre-release | Zrušit Pre-release u v0.1.3, nebo změnit endpoint v aplikaci na konkrétní tag (např. `releases/download/v0.1.3/latest.json`). |
| Chyba při stahování / podpisu | V DevTools v konzoli hledat `[Updater]` a text chyby (síť, CORS, neplatný podpis). |

Nejprve ověřte kroky 2.1 a 2.2 (co je „Latest“ a co vrací `latest.json`). Podle toho většinou hned vidíte, jestli je chyba na straně GitHubu/release, nebo v aplikaci.
