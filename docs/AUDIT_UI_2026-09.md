# Audit UI – září 2026

Podklad pro rozhodnutí, co má smysl na vzhledu Jobi a JobiDocs měnit.
Vše níž je změřené na kódu, ne dojem.

Doplněno o pohled na snímky obrazovky běžící aplikace (kapitola 7).

---

## Shrnutí jednou větou

**Designový systém existuje a je v pořádku – ale kód ho z 2 623 míst obchází.**

Nejde tedy o to vymyslet nový vzhled. Jde o to, aby se používal ten, který
už je hotový.

---

## 1. Co je dobré (a překvapivě dobré)

### Tokeny jsou zdravé

33 designových tokenů (barvy, poloměry, stíny, přechody), z toho 26 se
skutečně používá. To je rozumná velikost, ne rozbujelý systém.

### Kontrast projde WCAG AA v obou motivech

| Token | Světlý | Tmavý |
|---|---|---|
| `--text` | 16,55:1 ✅ | 17,78:1 ✅ |
| `--muted` | 4,51:1 ✅ | 7,71:1 ✅ |
| `--accent` | 4,82:1 ✅ | 7,70:1 ✅ |

`--muted` ve světlém motivu je na hraně (4,5 je minimum), ale prochází.

### Jobi a JobiDocs už sdílejí základ

Tohle mě potěšilo nejvíc. Aplikace sdílejí **17 tokenů** – `--accent`, `--bg`,
`--panel`, `--text`, `--radius-*`, `--shadow*`, `--transition-smooth` a další –
a **všech 17 má identickou hodnotu.**

Sjednocení tedy nezačíná od nuly. Základ je společný; rozchází se to až
v tom, jak ho která aplikace používá.

---

## 2. Hlavní problém: stylování je celé inline

| | Jobi | JobiDocs |
|---|---:|---:|
| `style={{ }}` | **2 623** | 454 |
| `className=` | **0** | 81 |
| řádků CSS | 737 | ~300 |

**Jobi nepoužívá jedinou CSS třídu.** Všechno je inline styl.

Z toho plyne úplně všechno ostatní v tomhle dokumentu. Inline styl nemá
kaskádu, nedá se sdílet a nedá se vynutit škála – každé místo si hodnotu
napíše znovu a nikdo nezkontroluje, že sedí se zbytkem.

### Kde je jich nejvíc

```
pages/Orders.tsx      488     pages/Invoices.tsx     144
pages/Settings.tsx    419     pages/Statistics.tsx   113
pages/Inventory.tsx   231     components/tickets/ClaimCard.tsx   91
pages/Devices.tsx     177     pages/Customers/CustomerDetail.tsx 88
```

---

## 3. Co to napáchalo

### Barvy: 169 odstínů napevno

2 556 použití `var(--token)` je dobrá zpráva. Vedle nich ale stojí
**647 barev zapsaných napevno ve 169 různých odstínech**, plus 333 `rgba()`.

| Rodina | Různých odstínů | Výskytů |
|---|---:|---:|
| šedá / bílá / černá | **59** | 278 |
| modrá / tyrkysová | 32 | 97 |
| zelená | 24 | 73 |
| červená / oranžová | 19 | 85 |
| fialová | 14 | 58 |
| růžová | 12 | 27 |

**59 odstínů šedé** je klasický příznak toho, že paletu nikdo nehlídá.

A konkrétní ukázka, proč to vadí – čtyři různé červené na to, co je nejspíš
všechno „chyba“:

```
#ef4444 (20×)   #dc2626 (10×)   #ff3b30 (9×)   #dd2200 (3×)
```

Podobně `#ffffff` (66×) a `#fff` (12×) – stejná barva, dva zápisy.

### Typografie: 19 velikostí písma

```
13px(357×)  12px(316×)  14px(163×)  11px(143×)  10px(53×)  16px(51×)
15px(26×)   18px(25×)   9px(19×)    7px(15×)    8px(14×)   24px(12×)
```

To není typografická škála, to je 19 nezávislých rozhodnutí. Zdravá škála
má šest až sedm stupňů.

**Nejpoužívanější velikost je 13px** – hodnota, která do žádné běžné škály
nezapadá.

### Rozestupy a zaoblení bez rytmu

- **17 různých poloměrů zaoblení**: 2, 3, 4, 5, 6, 8, 9, 10, 12, 14, 16, 999…
- **15 různých mezer**: 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24…

Tokeny přitom **žádnou škálu rozestupů ani písma neobsahují**. Existují jen
`--radius-sm/md/lg` a čtyři `--pad-*`, z nichž se používá jeden. Není tedy
kam sáhnout, i kdyby člověk chtěl.

---

## 4. 🟠 Čitelnost: písmo pod hranicí

```
6px – 2×      7px – 15×      8px – 14×      9px – 19×
```

**50 míst používá písmo 9px a menší.** 6–7px je na běžném monitoru
prakticky nečitelné a nikdo se zhoršeným zrakem to nepřečte vůbec.

Vzhledem k tomu, že aplikaci používají lidé celý pracovní den, tohle bych
řešil dřív než estetiku.

---

## 5. Výkon: potvrzeno měřením

Zjištěno dnes při řešení sekání na Windows: **68 míst používá
`backdrop-filter`**. Každé si vynutí vlastní kompozitní vrstvu.

Ověřeno nativním ARM64 buildem – trhalo i bez emulace, po vypnutí efektů
bylo v pořádku. Windows proto startují s efekty vypnutými.

Znamená to ale, že **na Windows dnes uživatel vidí jiný vzhled než na macOS**.
Buď se s tím smíříme, nebo se ten dojem vyrobí levněji – například
poloprůhledným pozadím bez rozostření, které stojí zlomek.

---

## 6. Co bych dělal, v tomhle pořadí

### 1. Doplnit chybějící škály do tokenů

Bez toho nemá smysl nic přepisovat, protože není kam sahat.

```css
/* Typografie – 6 stupňů místo 19 */
--text-xs: 11px;  --text-sm: 12px;  --text-md: 13px;
--text-lg: 16px;  --text-xl: 20px;  --text-2xl: 24px;

/* Rozestupy – násobky 4 */
--space-1: 4px;  --space-2: 8px;   --space-3: 12px;
--space-4: 16px; --space-6: 24px;  --space-8: 32px;

/* Stavové barvy – jedna červená, ne čtyři */
--danger: #ef4444;  --warning: #f97316;
--success: #22c55e; --info: #0ea5e9;
```

Levné, nic nerozbije, a hned je proti čemu měřit.

### 2. Zvednout písmo pod 10px

Padesát míst, mechanická změna, okamžitý přínos pro lidi, kteří v tom
pracují osm hodin denně.

### 3. Sjednotit čtyři červené na `--danger`

A stejně tak zelené a modré. Nejvíc viditelného pořádku za nejmíň práce.

### 4. Teprve pak Orders.tsx

488 inline stylů na 9 486 řádcích. Tady má smysl vytáhnout opakující se
bloky do komponent se třídami – ale až bude na co navázat.

**Pozor:** rozdělení `Orders.tsx` je samo o sobě velký zásah. Nedělal bych
ho zároveň s vizuálními změnami, jinak nepůjde poznat, co rozbilo co.

### 5. Jednotnost s JobiDocs

Základ je společný (17 tokenů, stejné hodnoty), takže tady jde hlavně
o to, aby obě aplikace tokeny opravdu používaly. Až to bude platit,
sjednocení vyjde skoro samo.

---

## 7. Co ukázaly snímky obrazovky

Nejdřív to důležité: **aplikace vypadá dobře.** Karty, bílý prostor, stavové
pilulky s barevnou tečkou, barevný proužek u levého okraje řádku podle stavu –
to všechno funguje a působí to současně. Níž jsou věci, které to sráží.

### 7.1 Jobi a JobiDocs vypadají jako dva produkty

Přestože sdílejí 17 tokenů se stejnými hodnotami, na pohled si nejsou podobné:

| | Jobi | JobiDocs |
|---|---|---|
| Akcentní barva | fialová (motiv `purple`) | modrá (výchozí) |
| Navigace | pilulkové filtry | drobečky + záložky |
| Hlavičky sekcí | emoji + tučně | prostě tučně |

Jobi má **9 barevných motivů**, JobiDocs žádný – takže jakmile si uživatel
zvolí jiný než výchozí, aplikace se rozejdou. Sjednocení tedy neznamená
srovnat tokeny (ty sedí), ale rozhodnout, jestli JobiDocs má motivy dědit.

### 7.2 🟠 Emoji místo ikon – a teď to začne vadit

V detailu zakázky jsou hlavičky sekcí `👤 Zákazník`, `📱 Zařízení`,
`📊 Stav zakázky`, `🔧 Provedené opravy`. Sidebar přitom používá pořádné
SVG ikony.

Nejde jen o nejednotnost. **Emoji vykresluje každý systém po svém** – na
Windows vypadají jinak než na macOS, jsou barevné tam, kde má být jednobarevná
ikona, a nedají se obarvit podle motivu. Po vydání Windows verze to přestává
být kosmetika.

### 7.3 Seznam zakázek plýtvá šířkou

Na širokém okně je **střed každého řádku prázdný**: vlevo kód, datum,
zařízení a zákazník, vpravo stav a tisk, mezi tím několik set pixelů nicoty.

Navíc má každá zakázka **druhý řádek jen s `🔧 —`** – prázdné pole oprav,
které zabere celou výšku řádku a nenese žádnou informaci.

Důsledek: na velké obrazovce je vidět zhruba deset zakázek. U servisu, který
jich má denně desítky, to znamená zbytečné rolování.

Nabízí se využít ten prázdný střed pro informace, které dnes uživatel zjistí
až rozkliknutím – cena, technik, termín.

### 7.4 Detail zakázky: sedm tlačítek v hlavičce

`Upravit`, `Smazat zakázku`, `Zakázkový list`, `Záruční list`,
`Přejít na fakturu`, `SMS`, `Historie` – zalomeno do dvou řad a všechna
opticky stejně důležitá. Přitom „Smazat zakázku“ je červené a tím nejvýraznější
hned vedle „Upravit“, což je u nevratné akce spíš riziko než pomoc.

### 7.5 Tři různé styly nadpisů v jedné obrazovce

V detailu zakázky se potkají:

- `👤 Zákazník` – emoji + tučné, velikost 14
- `DODATEČNÉ INFORMACE O ZÁKAZNÍKOVI` – verzálky, šedě, drobně
- `Celková cena oprav:` – prostě tučné

Tři způsoby, jak říct totéž. To je přímý důsledek toho, že neexistuje
typografická škála (kapitola 3).

### 7.6 Nastavení jsou vzdušná až řídká

Karty mají velké odsazení a na obrazovku se vejdou tři čtyři položky.
Na stránce, kterou uživatel projíždí a hledá konkrétní přepínač, by víc
informací najednou pomohlo.

---

## 8. Upravené pořadí prací po zhlédnutí snímků

Snímky mi změnily priority. Pořadí z kapitoly 6 platí, ale předřadil bych:

1. **Škály do tokenů** (beze změny – pořád první)
2. **Emoji → SVG ikony** – vyšlo nahoru kvůli Windows
3. **Písmo pod 10px** (beze změny)
4. **Seznam zakázek: zhustit a využít šířku** – největší dopad na každodenní práci
5. **Detail zakázky: uspořádat hlavičku** a oddělit destruktivní akci
6. Sjednotit červené a ostatní stavové barvy
7. Teprve pak rozdělení `Orders.tsx`
