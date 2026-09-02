# Audit JobiDocs – září 2026

Podnět: „pořád mi to nepřijde dostatečně intuitivní."

Měřeno na kódu a na snímku běžící aplikace. **JobiDocs je Electron aplikace,
takže jsem si ji nemohl proklikat** – zjištění o ovládání vycházejí ze struktury
kódu a z jednoho snímku, ne z vlastního používání. Kde si nejsem jistý, píšu to.

---

## Shrnutí

**Problém není ve vzhledu. Je ve struktuře a v ovládání.**

Designově je na tom JobiDocs *lépe než Jobi*: 21 odstínů napevno proti 169,
jedenáct velikostí písma proti devatenácti, a na rozdíl od Jobi používá
CSS třídy. Ten pocit nedodělanosti tedy nedělají barvy a rozestupy.

Dělá ho to, že **na jedné obrazovce stojí čtyři nezávislé přepínače** a že
celá aplikace bydlí v jedné komponentě.

---

## 1. 🔴 Čtyři přepínače na jedné obrazovce

Při úpravě dokumentu se současně přepíná:

| Přepínač | Volby |
|---|---|
| typ dokumentu | Zakázkový list · Záruční list · Diagnostický protokol · Příjemka · Výdejka · Faktura |
| levý panel | Obsah · Vzhled · Prvky |
| pravý panel | Editor · PDF náhled |
| obsah náhledu | Náhled · Šablona |

Ty poslední dva jsou přitom **oba o pravé straně** a nic nenaznačuje, jak spolu
souvisí. Uživatel musí vyzkoušet všechny čtyři kombinace, aby pochopil, co která
dělá – a pak si to pamatovat.

**Návrh:** sloučit „Editor / PDF náhled" a „Náhled / Šablona" do jednoho
přepínače se třemi stavy, protože se reálně vybírá jedna ze tří věcí:
*upravovat*, *vidět s ukázkovými daty*, *vidět prázdnou šablonu*.

## 2. 🟠 Sekce se přidávají tažením

Paleta sekcí má nad sebou větu „Přetáhněte sekci do náhledu vpravo. ✓ = již
v dokumentu."

**Když rozhraní potřebuje návod, není samovysvětlující.** Přetahování se navíc
špatně objevuje – uživatel nepozná, že s tím jde hýbat, dokud to nezkusí.

Komponenta `Chip` má prop `draggable`, ale ten se **nikde nepoužije** – je
deklarovaný v rozhraní a v destrukturalizaci chybí, takže se tiše ignoruje.
Přetahování řeší dnd-kit jinudy.

**Návrh:** kliknutí na sekci ji přidá na konec, tažení zůstane pro změnu pořadí.
Tažení pak není jediná cesta, jen ta rychlejší.

## 3. 🟠 QR kód závisí na cizí službě

```
https://api.qrserver.com/v1/create-qr-code/?...&data=<odkaz na hodnocení>
```

Žádná knihovna pro generování QR v projektu není, takže tohle je jediná cesta.
Důsledky:

- **Bez internetu se QR kód nevykreslí** – a to v aplikaci, jejímž jediným
  úkolem je tisknout dokumenty lokálně.
- **Odkaz na hodnocení servisu odchází třetí straně** při každém náhledu i tisku.
- Když ta služba změní API nebo skončí, přestanou se tisknout QR kódy
  a nikdo se to nedozví dopředu.

**Návrh:** generovat QR lokálně (`qrcode` je malá závislost bez sítě).

## 4. 🔴 Celá aplikace v jedné komponentě

> **Oprava (2. 9. 2026):** první verze téhle kapitoly tvrdila, že velká
> komponenta se jmenuje `SidebarNav` a že „neobsahuje postranní navigaci".
> To bylo špatně. `SidebarNav` má **28 řádků** a vykresluje přesně to, co
> slibuje – projde `SIDEBAR_TABS` a udělá z nich tlačítka. Číslo 2 840
> patřilo komponentě `App`; přiřadil jsem ho sousednímu jménu kvůli chybě
> ve skriptu, který velikosti měřil. Závěr kapitoly se tím nemění, jen
> viník má jiné jméno.

| | řádků |
|---|---:|
| `App.tsx` | **5 166** |
| z toho `App` | **2 813** |
| z toho `DocumentPreview` | 813 |
| z toho `SidebarNav` | 28 |
| celý zdroják aplikace | 6 943 |

`App.tsx` je **74 % celé aplikace** a samotná komponenta `App` je víc než
polovina toho souboru. Jsou v ní Aktivity, Aktualizace, Design, Nastavení
loga i razítka, Náhled dokumentu a O aplikaci – tedy skoro všechno.

V jednom souboru je **59× useState, 20× useEffect a 39× useMemo/useCallback**.

Tohle je podle mě kořen toho pocitu neuspořádanosti: **když je struktura kódu
zamotaná, promítne se to do rozhraní.** Nikdo nemá přehled, co se kde děje,
takže se nové věci přidávají tam, kde je zrovna místo.

### Dvě jména pro totéž

```ts
type DocTypeKey = "zakazkovy_list" | "zarucni_list" | ...
type DocTypeUI  = "ticketList"     | "warrantyCertificate" | ...
const DOC_TYPE_TO_UI: Record<DocTypeKey, DocTypeUI> = { ... }
```

Dvě sady názvů pro stejných šest dokumentů a převodní tabulka mezi nimi.
Každý nový dokument se musí zavést dvakrát.

---

## 5. Design: lepší, než jsem čekal

Pro srovnání s `docs/AUDIT_UI_2026-09.md`:

| | Jobi | JobiDocs |
|---|---:|---:|
| barvy napevno | 647 výskytů / 169 odstínů | **59 / 21** |
| velikosti písma | 19 | **11** |
| použití tokenů | 2 556 | 448 |
| `className=` | **0** | 81 |
| písmo pod 11px | 103 (z toho 44 v náhledech) | 29 |

JobiDocs má na svou velikost **výrazně lepší disciplínu**. Používá CSS třídy,
má vlastní UI komponenty (`Chip`, `Slider`, `SegmentedControl`, `AccordionPanel`),
což Jobi nemá vůbec.

### Co ke sjednocení s Jobi chybí

Sdílených tokenů je 17 a **všechny mají shodnou hodnotu** – základ tedy sedí.
Chybí ale to, co v Jobi přibylo v září:

- škála písma `--text-*` a rozestupů `--space-*`
- stavové barvy `--danger`, `--warning`, `--success`, `--info` včetně
  textových variant s dostatečným kontrastem
- `--radius-2xs`, `--radius-xs`, `--radius-pill`

JobiDocs má vlastní `--error: #dc2626`, což je jiná červená než `--danger: #ef4444`
v Jobi. Jeden z důvodů, proč aplikace nepůsobí jako jeden produkt.

### Motivy

Jobi má **devět barevných motivů**, JobiDocs žádný. Jakmile si uživatel
v Jobi zvolí jiný než výchozí, aplikace se rozejdou – a to je nejspíš to,
čeho sis všiml jako první.

Kanál na to existuje: Jobi už do JobiDocs posílá kontext přes
`pushContextToJobiDocs`, včetně barev loga. Motiv by mohl jet stejnou cestou.

---

## 6. Co bych dělal, v tomhle pořadí

1. **Doplnit škály a stavové barvy** – levné, aditivní, nic nerozbije,
   a hned zmenší rozdíl mezi aplikacemi.
2. **QR kód lokálně** – malá změna, odstraní tichou závislost na internetu
   i odesílání odkazu třetí straně.
3. **Sloučit ty dva přepínače náhledu** do jednoho se třemi stavy.
4. **Přidat kliknutí do palety sekcí** vedle tažení.
5. **Rozdělit `App.tsx`** – vytáhnout z komponenty `App` jednotlivé
   obrazovky (Design, Razítko, Náhled, Aktivity, O aplikaci). Velký zásah,
   dělat samostatně a s klidem.
6. **Přebírat motiv z Jobi** přes existující kanál kontextu.

Body 1 až 4 jsou malé a nezávislé. Bod 5 je práce na několik hodin a neměl
by se míchat s ničím jiným.

---

## Co jsem neověřil

- **Neproklikal jsem to.** JobiDocs je Electron aplikace a nespouštěl jsem ji;
  závěry o ovládání plynou z kódu a jednoho snímku.
- Jestli uživatelé přetahování sekcí opravdu neobjeví – to by ukázalo
  pozorování při práci, ne audit.
- Jak se aplikace chová na malém okně.
