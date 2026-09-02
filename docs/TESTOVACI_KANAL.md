# Testovací kanál – vydat verzi, aniž ji dostanou všichni

Cíl: udělat změnu, vyzkoušet ji na hotové podepsané aplikaci, a **nerozeslat ji
přitom jako OTA update všem servisům**.

---

## Jak je to dnes a kde je díra

Updater v `tauri.conf.json` míří na:

```
https://github.com/alexpapillier-lab/jobi/releases/latest/download/latest.json
```

Release aplikace (`jobi-release-app`) umí release vytvořit jako **draft**
(`gh release create ... --draft`), ale **neumí ho označit jako pre-release** –
`--prerelease` se ve zdrojáku nevyskytuje. Draft je sice neviditelný, jenže
v okamžiku, kdy ho publikuješ, se stane „latest“ a OTA jde okamžitě všem.

Chybí tedy stav mezi „nikdo to nevidí“ a „mají to všichni“.

## Proč to nejde vyřešit přepínačem v aplikaci

Nabízelo by se dát do Nastavení volbu „beta kanál“ a přepnout endpoint za běhu.
**Nejde to.** `check()` z `@tauri-apps/plugin-updater` přijímá pouze
`headers`, `timeout`, `proxy`, `target` a `allowDowngrades` – žádné URL.
Endpointy jsou zamčené v `tauri.conf.json` v době buildu.

---

## Řešení 1 – pre-release (doporučeno, bez zásahu do kódu)

GitHub má vlastnost, která tenhle problém řeší sama: **`/releases/latest/`
záměrně přeskakuje pre-releases.**

Když tedy release označíš jako pre-release:

- `releases/latest/download/latest.json` **dál ukazuje na poslední stabilní verzi**
- stávající uživatelé neuvidí vůbec nic, updater jim nic nenabídne
- testeři si instalátor stáhnou ručně ze stránky toho pre-release

```bash
gh release create v0.2.4-beta.1 --prerelease --notes "Testovací build"
gh release upload v0.2.4-beta.1 dist/jobi_0.2.4_x64-setup.exe
```

Ověření, že se stabilní uživatelé nehnuli:

```bash
curl -sL https://github.com/alexpapillier-lab/jobi/releases/latest/download/latest.json | jq .version
# musí vrátit poslední STABILNÍ verzi, ne betu
```

**Do release aplikace patří zaškrtávátko „Pre-release (netlačit uživatelům)“**,
které do `gh release create` přidá `--prerelease`.

> **Hotovo (2. 9. 2026), commit `6980a05` v repozitáři jobi-release-app.**
> Zároveň oprava mého dřívějšího tvrzení výš, že se `--prerelease` ve zdrojáku
> nevyskytuje – to platilo v době psaní, dnes už neplatí.
>
> **Pozor: postavená `.app` byla z 19. 2. a tu funkci neobsahovala.** Zdroj se
> změnil, binárka ne. Než release aplikaci použiješ, přesvědč se, že je
> přeložená z aktuálního zdroje – jinak ti zaškrtávátko chybí a release jde
> rovnou všem.

### Pozor na past

`gh release create` bez `--prerelease` u **vyššího čísla verze** okamžitě
přepíše `latest`. Pokud tedy release aplikace při dalším běhu vytvoří
v0.2.4 jako běžný release, dostanou ho všichni – i když jsi předtím
testoval betu. Pre-release stav se dědí z tagu, ne z verze.

---

## Řešení 2 – samostatná aplikace „Jobi Beta“ (plnohodnotný kanál)

Když chceš, aby se testerům beta **sama aktualizovala**, potřebuje vlastní build:

| | Stabilní | Beta |
|---|---|---|
| `identifier` | `com.jobsheet.online` | `com.jobsheet.online.beta` |
| `productName` | `jobi` | `Jobi Beta` |
| updater endpoint | `releases/latest/download/latest.json` | `releases/download/beta/latest.json` (pevný tag `beta`) |

Pevný tag `beta` se dá přepisovat (`gh release upload beta ... --clobber`),
takže beta build si vždycky sáhne pro to nejnovější, zatímco stabilní větev
o něm neví. Obě aplikace se dají mít nainstalované vedle sebe, protože mají
jiný identifier.

Cena: druhá varianta buildu v release procesu a druhá sada OTA artefaktů.

---

## Doporučený postup

1. **Hned:** doplnit `--prerelease` do release aplikace. Tím máš bezpečný
   testovací režim za pár minut práce.
2. **Až bude potřeba:** postavit „Jobi Beta“ jako samostatnou aplikaci
   podle řešení 2 – dává smysl, teprve až budeš mít testery, kterým se to
   má aktualizovat samo.

Pro Windows už bezpečný testovací režim **funguje dnes**: workflow
`Build Windows` vyrábí installery jen jako **artefakty běhu**, žádný release
nevytváří, takže se k uživatelům nemá jak dostat.
