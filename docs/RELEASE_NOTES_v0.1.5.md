# Release v0.1.6

Nový flow aktualizací (bez automatických dialogů), oprava OTA na Macu, verze JobiDocs v hlavičce.

---

## Novinky a vylepšení

### Aktualizace – nový flow (Jobi i JobiDocs)
- **Bez automatických notifikací** – odstraněny dialogy „Je k dispozici nová verze“ a „Restartovat nyní?“ při startu nebo na pozadí.
- **Nastavení → O aplikaci → Aktualizace** (Jobi) / záložka **O aplikaci** (JobiDocs) – centrální místo pro aktualizace:
  - Zobrazení dostupné nové verze
  - Tlačítko **Nainstalovat** – spustí stažení
  - **Progress bar** během stahování (0–100 %)
  - Tlačítko **Restartovat a nainstalovat** po dokončení stahování
  - Tlačítko **Zkontrolovat aktualizace**
- **Červený badge „1“** – na ikoně Nastavení (Jobi) a na záložce O aplikaci (JobiDocs), když je k dispozici nová verze.
- **Automatická kontrola** – každých 10 minut.

### OTA updaty (Jobi)
- **Oprava chyby** „failed to unpack `._jobi.app`“ – při vytváření `jobi.app.tar.gz` se používá `COPYFILE_DISABLE=1`, aby se nezahrnovaly AppleDouble soubory (`._*`), které způsobovaly selhání rozbalení na Macu. Uživatelé s v0.1.5+ by měli aktualizace stahovat bez této chyby.

### JobiDocs
- **Verze v hlavičce** – vedle názvu „JobiDocs“ se zobrazuje aktuální verze aplikace (např. JobiDocs 0.1.5).

---

## Technické

- Jobi: `AppUpdateContext`, `useCheckForAppUpdate`, sekce Aktualizace v Settings, badge v Sidebar.
- JobiDocs: IPC handlery pro update, záložka O aplikaci s update UI, `COPYFILE_DISABLE` není potřeba (Electron používá jiný update mechanismus).
- Skripty: `build-universal.sh`, `pack-notarized-ota.sh` – `COPYFILE_DISABLE=1 tar czf` při tvorbě OTA archívu.

---

## Stažení

- **Jobi** – `jobi-0.1.6.dmg` (universal, notarizovaný)
- **JobiDocs** – `JobiDocs-0.1.6.dmg` (universal, notarizovaný) v příloze nebo v sekci Assets

Uživatelé s v0.1.5 mohou aktualizovat přes OTA (Nastavení → O aplikaci → Aktualizace) nebo stáhnout nové DMG.
