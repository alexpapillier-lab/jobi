# Testování Jobi + JobiDocs bez zipu

Pro rychlé testování spusť obě aplikace ze zdroje. **Nejdřív JobiDocs, pak Jobi.**

## Terminál 1 – JobiDocs (API na portu 3847)

```bash
cd ~/dev/jobi/jobidocs
npm run electron:dev
```

## Terminál 2 – Jobi (Tauri)

```bash
cd ~/dev/jobi
npm run tauri dev
```

---

## Pořadí

1. **JobiDocs** – spustí API na http://127.0.0.1:3847
2. **Jobi** – při Tisk/Export pingne JobiDocs; pokud běží, použije PDF tisk/export

## Kontrola

- **Jobi** – vpravo nahoře indikátor „JobiDocs ✓“ (zeleně) nebo „JobiDocs ✗“ (šedě)
- **JobiDocs** – sekce „Aktivity“ zobrazuje požadavky z Jobi (Tisk/Export)
