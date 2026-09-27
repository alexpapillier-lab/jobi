/**
 * Průvodci aplikací – katalog, dostupnost a novinky.
 *
 * Místo jedné dlouhé prohlídky po prvním přihlášení má každá stránka
 * a každá podsekce Nastavení vlastního krátkého průvodce (ikona otazníku
 * v postranním panelu, seznam v Nastavení → Nápověda). Průvodce se ukáže
 * jen tomu, kdo tu funkci opravdu má: podle role, zapnutých modulů
 * (API, faktury, SMS, pobočky…) a nastavení servisu. Průvodce k API
 * se tedy neukáže servisu bez API.
 *
 * Novinky: když se někomu nová funkce objeví (zapnul se modul, přibyl
 * průvodce s `novinkaOd`), aplikace to po přihlášení jednou oznámí a
 * nabídne průvodce. Co kdo viděl, se pamatuje v localStorage pro účet.
 *
 * Kroky používají kotvy `data-tour="…"` v UI; test `pruvodci.test.ts`
 * hlídá, že každá kotva v kódu existuje – jinak by průvodce ukazoval
 * do prázdna.
 */
import { useSyncExternalStore } from "react";
import type { NavKey } from "../layout/Sidebar";
import type { TourStep } from "../components/AppTourOverlay";

export type KontextPruvodcu = {
  admin: boolean;
  rootOwner: boolean;
  /** Webová verze (bez JobiDocs a instalace). */
  web: boolean;
  /** Které stránky má uživatel v navigaci. */
  stranky: Partial<Record<NavKey, boolean>>;
  /** Zapnuté moduly servisu (useEntitlements). */
  moduly: Partial<Record<string, boolean>>;
};

export type Pruvodce = {
  id: string;
  nazev: string;
  /** Jedna věta do seznamu průvodců a do oznámení novinky. */
  popis: string;
  /** Stránka, ke které průvodce patří (ikona otazníku ho nabídne tam). */
  page: NavKey;
  /** Podsekce Nastavení, ke které patří (otazník v Nastavení ho nabídne tam). */
  settingsSubsection?: string;
  /** Od kdy je to novinka (ISO datum). Bez data se oznámí jen při zpřístupnění funkce. */
  novinkaOd?: string;
  /** Kdo průvodce vidí; bez funkce = každý. */
  dostupny?: (k: KontextPruvodcu) => boolean;
  kroky: TourStep[];
};

const sel = (kotva: string) => `[data-tour="${kotva}"]`;
const nast = (category: string, subsection: string) => ({ category, subsection });

/** Kroky úvodního průvodce (po prvním přihlášení, „Spustit průvodce“ v O aplikaci). */
export const KROKY_UVOD: TourStep[] = [
  { page: "orders", title: "Vítejte v Jobi", description: "Krátká prohlídka hlavních stránek. Kdykoli ji přeskočíte; ke každé stránce a části nastavení je pak vlastní průvodce pod otazníkem v postranním panelu.", icon: "welcome" },
  { page: "orders", title: "Postranní panel", description: "Dnes, Zakázky, Kalendář, Zákazníci, Sklad, Zařízení, Statistiky a Nastavení. Co servis nemá zapnuté (SMS, faktury, pobočky), v panelu není.", selector: sel("sidebar-nav-orders"), icon: "orders" },
  { page: "orders", title: "Zakázky", description: "Srdce aplikace: příjem, stav, opravy s cenami, tisk dokumentů, SMS a historie. Nová zakázka je jedno tlačítko; zákazník se podle telefonu najde sám.", selector: sel("orders-new-btn"), icon: "orders" },
  { page: "orders", title: "Hledání a filtry", description: "Hledejte podle čehokoli, přepínejte skupiny Vše / Aktivní / Dokončené a filtrujte podle stavu.", selector: sel("orders-search"), icon: "orders" },
  { page: "customers", title: "Zákazníci", description: "Vznikají sami z první zakázky. Karta drží kontakty, adresu pro doklady a všechny zakázky zákazníka.", selector: sel("customers-content"), icon: "customers" },
  { page: "devices", title: "Zařízení a ceník", description: "Modely a opravy s cenou, náklady a časem. Při příjmu se nabídnou jedním klikem, z nákladů se počítá marže.", selector: sel("devices-main"), icon: "devices" },
  { page: "inventory", title: "Sklad", description: "Díly s nákupní cenou navázané na opravy: přidání opravy na zakázku díl rezervuje, vydání ho odepíše.", selector: sel("inventory-main"), icon: "inventory" },
  { page: "statistics", title: "Statistiky", description: "Obrat, náklady a zisk podle data vydání, počty podle přijetí, marže podle oprav a zařízení, technici.", selector: sel("statistics-main"), icon: "statistics" },
  { page: "settings", title: "Nastavení", description: "Firma, statusy zakázek, dokumenty a tisk, komunikace, tým. Každá část má vlastního průvodce pod otazníkem.", selector: sel("settings-categories"), settingsSection: nast("company", "service_basic"), icon: "settings" },
  { page: "settings", title: "Průvodci a novinky", description: "Seznam všech průvodců a novinek je v Nastavení → Nápověda. Když se vám zpřístupní nová funkce, aplikace vám to po přihlášení sama řekne.", selector: sel("settings-content"), settingsSection: nast("app", "about_help"), icon: "settings" },
];

const ODMENY: Pruvodce = {
  id: "odmeny",
  nazev: "Odměny týmu",
  popis: "Prémie za opravy nabídnuté zákazníkovi navíc, žebříček a zaměstnanec měsíce.",
  page: "odmeny",
  novinkaOd: "2026-09-26",
  dostupny: (k) => !!k.stranky.odmeny,
  kroky: [
    { page: "odmeny", title: "K čemu to je", description: "Prémie za opravy, které tým zákazníkovi nabídl navíc – třeba servisní čištění ke svěřené opravě. Počítá se ze zakázek vydaných v měsíci; storno nic nedostane.", selector: sel("sidebar-nav-odmeny"), icon: "team" },
    { page: "odmeny", title: "Vyberte měsíc", description: "Šipkami listujete po měsících, Tento měsíc vás vrátí na aktuální.", selector: sel("odmeny-mesic"), icon: "team" },
    { page: "odmeny", title: "Podívejte se na souhrn", description: "Zaměstnanec měsíce, kolik odměn je za měsíc celkem a kolik máte vy.", selector: sel("odmeny-dlazdice"), icon: "team" },
    { page: "odmeny", title: "Klikněte na člověka v žebříčku", description: "Seznam oprav dole se zúží jen na jeho odměny. Majitel tu zaškrtnutím Vyplaceno zapíše, že odměnu předal.", selector: sel("odmeny-zebricek"), icon: "team" },
    { page: "odmeny", title: "Zkontrolujte jednotlivé opravy", description: "Každý řádek je oprava s odměnou. Majitel může změnit, komu se připíše, přepnout Nabídnuto navíc / Nenabídnuto nebo řádek vyřadit.", selector: sel("odmeny-radky"), icon: "team" },
    { page: "odmeny", title: "Hotovo", description: "Odměna vzniká jen u opravy s příznakem Nabídnuto navíc – Jobi ho předvyplní podle pravidla a v detailu zakázky ho přepnete jedním klikem. Pravidla nastaví majitel tlačítkem Pravidla.", selector: sel("odmeny-filtr"), icon: "team" },
  ],
};

export const PRUVODCI: Pruvodce[] = [
  {
    id: "uvod",
    nazev: "Úvod do Jobi",
    popis: "Projděte hlavní stránky aplikace krok za krokem.",
    page: "orders",
    kroky: KROKY_UVOD,
  },
  {
    id: "dnes",
    nazev: "Dnes",
    popis: "Jedna obrazovka na ráno: po termínu, dnešní termíny, rezervace, k převzetí, čeká na díl, přidělené vám a nepřečtené zprávy.",
    page: "dnes",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "dnes", title: "Dnes", description: "Co je potřeba dnes vyřešit, bez hledání a filtrů. Každá karta má počet v hlavičce a kliknutím na řádek se otevře detail zakázky; po zavření jste zpátky tady. Respektuje vybranou pobočku.", selector: sel("sidebar-nav-dnes"), icon: "orders" },
      { page: "dnes", title: "Jen moje / Celý tým", description: "Jen moje zúží všechny karty na zakázky přidělené vám; Celý tým ukáže všechno a u zakázky i jméno technika. Volba se pamatuje a platí i na telefonu. Když servis techniky nepřiděluje, přepínač tu není.", selector: sel("dnes-rozsah"), icon: "team" },
      { page: "dnes", title: "Po termínu a Dnes dokončit", description: "Podle pole Předpokládaný termín dokončení v detailu zakázky. Nejdéle po termínu je nahoře. Hotové zakázky (k převzetí) se do termínů nepočítají.", selector: sel("dnes-po-terminu"), icon: "orders" },
      { page: "dnes", title: "Připraveno k převzetí", description: "Zakázky ve stavu pro hotové (Připraveno, K vyzvednutí…) – kdo si pro zařízení může přijít. Nahoře ty, které leží nejdéle.", selector: sel("dnes-k-prevzeti"), icon: "orders" },
      { page: "dnes", title: "Čeká na díl a na zákazníka", description: "Na díl čeká zakázka s objednaným dílem, který ještě nedorazil (Objednat u dodavatele), nebo ve stavu typu Čeká na díl. Na zákazníka čeká odeslaná cenová nabídka bez odpovědi.", selector: sel("dnes-dil"), icon: "inventory" },
      { page: "dnes", title: "Rezervace na dnes", description: "Zákazníci objednaní přes formulář na webu. Kliknutím rovnou založíte zakázku s údaji z rezervace.", selector: sel("dnes-rezervace"), icon: "customers" },
      { page: "settings", title: "Začínat na Dnes", description: "V Nastavení → Rozhraní → Po přihlášení otevřít si vyberte Dnes a aplikace se bude otevírat tady. Výchozí klávesová zkratka je T (změníte v Klávesových zkratkách).", selector: sel("settings-content"), settingsSection: nast("app", "appearance_ui"), icon: "settings" },
    ],
  },
  {
    id: "zakazky",
    nazev: "Přehled zakázek",
    popis: "Hledání, skupiny, filtr podle stavu, nová zakázka a reklamace.",
    page: "orders",
    kroky: [
      { page: "orders", title: "Hledání", description: "Jméno, telefon, zařízení, číslo zakázky nebo text z poznámky – seznam se filtruje hned při psaní. Křížkem hledání zrušíte.", selector: sel("orders-search"), icon: "orders" },
      { page: "orders", title: "Skupiny zakázek", description: "Vše, Aktivní (rozpracované), Přesuny mezi pobočkami, Dokončené a Reklamace. Skupina Moje ukáže jen zakázky přidělené vám.", selector: sel("orders-groups"), icon: "orders" },
      { page: "orders", title: "Filtr podle stavu", description: "Rozbalovací filtr nabídne jen stavy, které se ve vybrané skupině vyskytují, s počtem zakázek.", selector: sel("orders-status-filter"), icon: "orders" },
      { page: "orders", title: "Nová zakázka", description: "Zákazník podle telefonu (existující se nabídne sám), zařízení, požadovaná oprava, opravy z ceníku i mimo něj a sleva už při příjmu.", selector: sel("orders-new-btn"), icon: "orders" },
      { page: "orders", title: "Nová reklamace", description: "Reklamaci založíte i z detailu hotové zakázky přes nabídku „…“ – převezme zákazníka i zařízení.", selector: sel("orders-new-claim-btn"), icon: "orders" },
      { page: "orders", title: "Seznam a stav", description: "Stav zakázky přepnete přímo v řádku. Kliknutím otevřete detail: opravy, ceny, diagnostiku, fotky, dokumenty, SMS a historii.", selector: sel("orders-list"), icon: "orders" },
    ],
  },
  {
    id: "detail-zakazky",
    nazev: "Detail zakázky",
    popis: "Opravy s cenami, diagnostika, dokumenty, SMS a historie – na ukázkové zakázce.",
    page: "orders",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "orders", title: "Detail zakázky", description: "Otevíráme ukázkovou (nebo poslední) zakázku. Nahoře je číslo, zákazník s telefonem, stav a tlačítka: Upravit, Tisk, SMS, faktura a nabídka „…“ s dalšími akcemi.", selector: sel("detail-upravit"), akce: "otevrit-ukazkovou-zakazku", icon: "orders" },
      { page: "orders", title: "Kolega v zakázce", description: "Má-li zakázku otevřenou i kolega, ukáže se tu jeho jméno; oranžově, když ji právě upravuje (i od kdy). Upravovat můžete i tak – kdo uloží druhý, uvidí, co kolega mezitím změnil, a vybere, jestli jeho změny přepíše, nebo načte jeho verzi.", selector: sel("detail-kolega"), icon: "orders" },
      { page: "orders", title: "Provedené opravy", description: "Opravy z ceníku nebo ručně, každá s cenou, náklady a díly. Sleva se uplatní na celek. Součet je konečná cena pro zákazníka i pro doklad.", selector: sel("detail-opravy"), icon: "orders" },
      { page: "orders", title: "Diagnostika a fotky", description: "Text pro zákazníka a fotky před a po opravě (z počítače nebo z telefonu přes QR kód). Jde na protokol a do portálu zákazníka.", selector: sel("detail-diagnostika"), icon: "orders" },
      { page: "orders", title: "SMS zákazníkovi", description: "Zpráva odchází z aplikace a odpověď se vrátí sem. Automatické SMS při změně stavu nastavíte v Komunikaci.", selector: sel("detail-sms"), icon: "orders" },
      { page: "orders", title: "Tisk a vydání", description: "Zakázkový list při příjmu, záruční list a protokol při vydání. Přepnutím do koncového stavu se zakázka vydá: odepíší se díly a zapíše datum vydání pro Statistiky.", selector: sel("detail-upravit"), icon: "doc" },
    ],
  },
  {
    id: "kalendar",
    nazev: "Naplánovat termín v kalendáři",
    popis: "Posunout termín dokončení, projít, co hoří, a vyřídit rezervace z webu.",
    page: "calendar",
    dostupny: (k) => k.stranky.calendar !== false,
    kroky: [
      { page: "calendar", title: "K čemu to je", description: "Kalendář ukazuje, kdy má být která rozpracovaná zakázka hotová, a rezervace zákazníků z webu. Použijte ho, když slibujete termín nebo ráno plánujete práci.", selector: sel("sidebar-nav-calendar"), icon: "orders" },
      { page: "calendar", title: "Klikněte na Agenda", description: "Zakázky jsou seřazené do skupin Po termínu, Dnes, Zítra, Tento týden, Později a Bez termínu. Kliknutím na řádek otevřete detail zakázky.", selector: sel("calendar-pohled-agenda"), klik: ["calendar-pohled-agenda"], icon: "orders" },
      { page: "calendar", title: "Klikněte na Změnit termín", description: "U zakázky, které chcete termín posunout nebo nastavit. Otevře se malé okno s termínem.", selector: sel("calendar-zmenit-termin"), klik: ["calendar-pohled-agenda"], icon: "orders" },
      { page: "calendar", title: "Vyberte nový termín", description: "Dnes 17:00, Zítra 10:00 a +1 den se uloží hned. Jiný den a čas vyberte v poli pod nimi a klikněte na Uložit; Bez termínu termín smaže.", selector: sel("calendar-termin"), klik: ["calendar-pohled-agenda", "calendar-zmenit-termin"], icon: "orders" },
      { page: "calendar", title: "Přepněte na Časovou osu", description: "Zakázky jako pruhy od přijetí do termínu. Den / Týden / Měsíc mění měřítko, šipky vedle listují a Dnes vás vrátí na dnešek.", selector: sel("calendar-pohled-osa"), klik: ["calendar-pohled-osa"], icon: "orders" },
      { page: "calendar", title: "Zužte výběr filtrem statusů", description: "Klikněte na Filtr statusů a zaškrtněte jen stavy, které vás zajímají – třeba Čeká na díl. Bez zaškrtnutí se ukazuje všechno.", selector: sel("calendar-filtr"), icon: "orders" },
      { page: "calendar", title: "Vyřiďte rezervace z webu", description: "Když si zákazník objedná termín přes formulář, je tady nahoře. Klikněte na Založit zakázku – příjem se předvyplní z rezervace; Potvrdit nebo Zrušit jen změní její stav.", selector: sel("calendar-rezervace"), icon: "customers" },
      { page: "calendar", title: "Hotovo", description: "Nový termín je uložený v zakázce v poli Předpokládaný termín dokončení a hned se promítne na stránku Dnes. Online rezervace zapnete v Nastavení → Zakázky → Online rezervace.", selector: sel("calendar-pohled"), icon: "orders" },
    ],
  },
  {
    id: "zakaznici",
    nazev: "Najít a upravit zákazníka",
    popis: "Hledání, oprava kontaktů a adresy, zakázky zákazníka a nová zakázka pro něj.",
    page: "customers",
    kroky: [
      { page: "customers", title: "K čemu to je", description: "Adresář zákazníků. Zákazník vzniká sám s první zakázkou podle telefonu; tady opravíte jeho údaje, najdete všechny jeho zakázky a založíte mu novou.", selector: sel("sidebar-nav-customers"), icon: "customers" },
      { page: "customers", title: "Najděte zákazníka", description: "Napište jméno, telefon, e-mail nebo firmu – seznam se zúží už při psaní.", selector: sel("customers-search"), icon: "customers" },
      { page: "customers", title: "Klikněte na zákazníka", description: "Číslo vpravo je počet jeho zakázek. Karta s kontakty a adresou se otevře vedle seznamu.", selector: sel("customers-seznam"), icon: "customers" },
      { page: "customers", title: "Klikněte na Upravit", description: "Opravte jméno, telefon, e-mail, firmu, IČO nebo adresu pro doklady a klikněte na Uložit. Změna se zapíše do historie zákazníka.", selector: sel("customers-upravit"), klik: ["customers-prvni"], icon: "customers" },
      { page: "customers", title: "Projděte jeho zakázky", description: "Pod kartou jsou všechny zakázky zákazníka, kliknutím otevřete detail. Zaškrtnutím Neposílat žádosti o recenzi ho vyřadíte z automatických žádostí.", selector: sel("customers-zakazky"), klik: ["customers-prvni"], icon: "orders" },
      { page: "customers", title: "Klikněte na + Vytvořit zakázku", description: "Aplikace přepne na Zakázky a otevře příjem s tímto zákazníkem už vyplněným.", selector: sel("customers-nova-zakazka"), klik: ["customers-prvni"], icon: "orders" },
      { page: "customers", title: "Hotovo", description: "Údaje zákazníka jsou uložené a nabídnou se při dalším příjmu i na fakturách. Zákazníky z jiného systému nahrajete najednou tlačítkem Import z CSV.", selector: sel("customers-import"), icon: "customers" },
    ],
  },
  {
    id: "sklad",
    nazev: "Přidat díl do skladu a naskladnit",
    popis: "Nový produkt s cenou a minimem, vazba na opravy, naskladnění a rezervace k zakázkám.",
    page: "inventory",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "inventory", title: "K čemu to je", description: "Sklad drží díly s nákupní cenou. Díl navázaný na opravu se při přidání opravy na zakázku rezervuje a při vydání zakázky odepíše – zásobu tak nemusíte hlídat ručně.", selector: sel("sidebar-nav-inventory"), icon: "inventory" },
      { page: "inventory", title: "Otevřete záložku Produkty", description: "Tady je seznam dílů se zásobou a filtry podle zařízení, kategorie a stavu zásoby.", selector: sel("inventory-zalozka-produkty"), klik: ["inventory-zalozka-produkty"], icon: "inventory" },
      { page: "inventory", title: "Klikněte na Nový produkt", description: "Otevře se formulář nového dílu. Když máte nad seznamem vybraný model zařízení, díl se k němu rovnou přiřadí.", selector: sel("inventory-novy"), klik: ["inventory-zalozka-produkty"], icon: "inventory" },
      { page: "inventory", title: "Vyplňte díl", description: "Název, počet kusů, prodejní a nákupní cenu (jde do marže). Minimální zásoba a dodavatel hlídají doobjednání; v „Používá se u oprav“ zaškrtněte opravy, ke kterým díl patří.", selector: sel("inventory-novy-formular"), klik: ["inventory-zalozka-produkty", "inventory-novy"], icon: "inventory" },
      { page: "inventory", title: "Klikněte na Přidat produkt", description: "Díl se uloží do skladu a objeví se v seznamu.", selector: sel("inventory-pridat-produkt"), klik: ["inventory-zalozka-produkty", "inventory-novy"], icon: "inventory" },
      { page: "inventory", title: "Naskladněte dodávku", description: "Když přijde zboží, klikněte na Naskladnit, najděte díl podle názvu nebo SKU, klikněte na Upravit zásobu a zadejte, o kolik kusů se zásoba mění.", selector: sel("inventory-restock"), klik: ["inventory-zalozka-produkty"], icon: "inventory" },
      { page: "inventory", title: "Hlídejte zásobu", description: "Dlaždice Pod minimem a Vyprodáno kliknutím zúží seznam na díly, které docházejí. Z nich pak připravíte objednávku (průvodce Doobjednat díly).", selector: sel("inventory-kpi"), klik: ["inventory-zalozka-produkty"], icon: "inventory" },
      { page: "inventory", title: "Hotovo", description: "Díl je ve skladu. Přidáte-li na zakázku opravu, ke které patří, zarezervuje se; v koncovém stavu zakázky se odepíše. Celý sklad najednou nahrajete tlačítkem Import z CSV.", selector: sel("inventory-import"), icon: "inventory" },
    ],
  },
  {
    id: "sklad-objednavky",
    nazev: "Doobjednat díly u dodavatele",
    popis: "Návrh objednávky z dílů pod minimem, odeslání dodavateli a příjem na sklad.",
    page: "inventory",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "inventory", title: "K čemu to je", description: "Jobi z dílů pod minimální zásobou připraví objednávku pro každého dodavatele a po dodání ji jedním kliknutím přijme na sklad. Díl musí mít vyplněné minimum a dodavatele.", selector: sel("sidebar-nav-inventory"), icon: "inventory" },
      { page: "inventory", title: "Otevřete záložku Objednávky", description: "Jsou tu návrhy, objednané a přijaté objednávky. Jednotlivý díl do návrhu přidáte i tlačítkem Objednat u produktu.", selector: sel("inventory-zalozka-objednavky"), klik: ["inventory-zalozka-objednavky"], icon: "inventory" },
      { page: "inventory", title: "Klikněte na Navrhnout objednávku pod minimem", description: "Každý díl pod minimem se doplní do návrhu u svého dodavatele. Když nic pod minimem není, tlačítko je šedé.", selector: sel("inventory-navrhnout"), klik: ["inventory-zalozka-objednavky"], icon: "inventory" },
      { page: "inventory", title: "Otevřete návrh", description: "Klikněte na objednávku v seznamu. Počty kusů upravíte, položky odeberete košem.", selector: sel("objednavka-prvni"), klik: ["inventory-zalozka-objednavky"], icon: "inventory" },
      { page: "inventory", title: "Pošlete a označte jako objednáno", description: "Poslat e-mailem otevře e-mail dodavateli se seznamem dílů. Pak klikněte na Označit jako objednáno – objednávka přejde mezi Objednané.", selector: sel("objednavka-akce"), klik: ["inventory-zalozka-objednavky", "objednavka-prvni"], icon: "inventory" },
      { page: "inventory", title: "Po dodání: Přijmout na sklad", description: "Když balík dorazí, otevřete objednávku a klikněte na Přijmout na sklad. Po potvrzení se kusy přičtou k zásobě a objednávka se označí jako přijatá.", selector: sel("objednavka-akce"), klik: ["inventory-zalozka-objednavky", "objednavka-prvni"], icon: "inventory" },
      { page: "inventory", title: "Hotovo", description: "Přijatá objednávka je ve filtru Přijaté a zásoba je doplněná. Minimum a dodavatele dílu změníte v jeho úpravě na záložce Produkty.", selector: sel("inventory-zalozka-produkty"), icon: "inventory" },
    ],
  },
  {
    id: "sklad-inventura",
    nazev: "Udělat inventuru skladu",
    popis: "Zahájit, napočítat kusy (i čtečkou), uzavřít a srovnat sklad; protokol do CSV.",
    page: "inventory",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "inventory", title: "K čemu to je", description: "Jednou za čas přepočítáte regál a srovnáte evidenci se skutečností. Uzavření ukáže manko a přebytek v kusech i v nákupních cenách.", selector: sel("sidebar-nav-inventory"), icon: "inventory" },
      { page: "inventory", title: "Otevřete záložku Inventura", description: "Nahoře jsou rozdělané inventury, pod nimi zahájení nové a dole historie.", selector: sel("inventory-inventura"), klik: ["inventory-inventura"], icon: "inventory" },
      { page: "inventory", title: "Vyberte sklad a klikněte na Zahájit inventuru", description: "Zahájení zmrazí seznam dílů s evidovaným stavem. Zaškrtněte i produkty s nulovým stavem, když chcete kontrolovat i ty.", selector: sel("inventura-zahajit"), klik: ["inventory-inventura"], icon: "inventory" },
      { page: "inventory", title: "Zapište napočítané kusy", description: "U každého řádku napište, kolik kusů na regálu opravdu je – ukládá se samo. Rezervované díly pořád leží na regálu, počítejte je; počítat může víc lidí naráz a víc dní.", selector: sel("inventura-polozky"), klik: ["inventory-inventura", "inventura-prvni-rozdelana"], icon: "inventory" },
      { page: "inventory", title: "Nebo načítejte čtečkou", description: "Klikněte do pole Čtečka a načtěte kód: každé načtení přičte jeden kus. Díl, který v inventuře není, se přidá sám.", selector: sel("inventura-ctecka"), klik: ["inventory-inventura", "inventura-prvni-rozdelana"], icon: "inventory" },
      { page: "inventory", title: "Klikněte na Uzavřít inventuru", description: "Ukáže rozdíly proti evidenci. Po kliknutí na Uzavřít a zapsat rozdíly se sklad srovná s napočítaným; nespočítané řádky můžete nechat beze změny.", selector: sel("inventura-uzavrit"), klik: ["inventory-inventura", "inventura-prvni-rozdelana"], icon: "inventory" },
      { page: "inventory", title: "Hotovo", description: "Uzavřená inventura je v Historii inventur: Protokol ji otevře, CSV stáhne pro účetní se všemi rozdíly.", selector: sel("inventura-historie"), klik: ["inventory-inventura"], icon: "inventory" },
    ],
  },
  {
    id: "zarizeni",
    nazev: "Přidat opravu do ceníku",
    popis: "Model zařízení, oprava s cenou, časem a náklady, díl ze skladu; import celého ceníku.",
    page: "devices",
    kroky: [
      { page: "devices", title: "K čemu to je", description: "Ceník oprav podle modelů. Co tu nastavíte, se při příjmu zakázky nabídne jedním klikem i s cenou a z nákladů se ve Statistikách počítá marže.", selector: sel("sidebar-nav-devices"), icon: "devices" },
      { page: "devices", title: "Najděte model", description: "Napište do pole značku nebo model (třeba „iPhone 13“) a strom se zúží. Escape hledání zruší.", selector: sel("devices-strom-hledat"), icon: "devices" },
      { page: "devices", title: "Klikněte na model, nebo ho přidejte", description: "Strom je Značka → Kategorie → Model. Chybí-li model, klikněte na + Přidat značku / kategorii / model, napište název a potvrďte Enterem; řádky přeskládáte přetažením.", selector: sel("devices-strom"), icon: "devices" },
      { page: "devices", title: "Klikněte na Přidat opravu", description: "Tlačítko je aktivní, když je vlevo vybraný model nebo kategorie. Otevře se formulář nové opravy.", selector: sel("devices-pridat-opravu"), icon: "devices" },
      { page: "devices", title: "Vyplňte opravu", description: "Název, cena pro zákazníka a čas v minutách. Náklady se odečtou v marži; prázdná záruka = výchozí záruka servisu. V Produktech připojte díl ze skladu – na zakázce se pak sám zarezervuje.", selector: sel("devices-nova-oprava"), klik: ["devices-pridat-opravu"], icon: "devices" },
      { page: "devices", title: "Klikněte na Přidat opravu pod formulářem", description: "Oprava se uloží a objeví v seznamu. Tužkou u řádku ji později upravíte, košem smažete.", selector: sel("devices-ulozit-opravu"), klik: ["devices-pridat-opravu"], icon: "devices" },
      { page: "devices", title: "Celý ceník najednou", description: "Máte ceník v tabulce? Klikněte na Import a nahrajte TXT soubor se značkami, modely a opravami – šablonu si stáhnete tam.", selector: sel("devices-import"), icon: "devices" },
      { page: "devices", title: "Hotovo", description: "Oprava je v seznamu u modelu. Při příjmu zakázky vyberte model a oprava se nabídne s cenou; chybějící opravu přidáte do ceníku i rovnou z detailu zakázky.", selector: sel("devices-opravy"), icon: "devices" },
    ],
  },
  {
    id: "statistiky",
    nazev: "Zjistit, kolik servis vydělal",
    popis: "Obrat a zisk podle data vydání, počty podle přijetí, rozpracované zvlášť; tabulka a export.",
    page: "statistics",
    novinkaOd: "2026-09-26",
    dostupny: (k) => k.stranky.statistics !== false,
    kroky: [
      { page: "statistics", title: "K čemu to je", description: "Obrat, náklady, zisk a marže za zvolené období, nejčastější opravy a zařízení i výkon techniků. Čísla se počítají sama ze zakázek, nic se nenastavuje.", selector: sel("sidebar-nav-statistics"), icon: "statistics" },
      { page: "statistics", title: "Vyberte období", description: "Klikněte na Dnes, Týden, Měsíc, Kvartál, Rok, nebo na Vlastní a zadejte datum od–do.", selector: sel("statistics-period"), icon: "statistics" },
      { page: "statistics", title: "Zapněte porovnání", description: "Porovnat s předchozím obdobím ukáže u každého čísla změnu proti minulému týdnu, měsíci či roku. U vlastního období nejde.", selector: sel("statistics-porovnat"), icon: "statistics" },
      { page: "statistics", title: "Přečtěte si čísla", description: "Příjem, náklady a zisk jsou ze zakázek vydaných v období – uzavřený měsíc se už nemění. Přijato zakázek je podle data přijetí a rozpracované mají vlastní dlaždici.", selector: sel("statistics-kpi"), klik: ["statistics-view-karty"], icon: "statistics" },
      { page: "statistics", title: "Klikněte na stav, opravu nebo zařízení", description: "Všechna čísla se zúží jen na ten výběr. Křížkem u štítku v liště nahoře výběr zrušíte.", selector: sel("statistics-stavy"), klik: ["statistics-view-karty"], icon: "statistics" },
      { page: "statistics", title: "Tabulka a Export CSV", description: "V Tabulce jsou jednotlivé zakázky období, kliknutím otevřete detail. Export CSV je uloží pro Excel nebo účetní.", selector: sel("statistics-export"), klik: ["statistics-view-tabulka"], icon: "statistics" },
      { page: "statistics", title: "Grafy po měsících", description: "Měsíční přehled obratu a zisku; kliknutím na měsíc ho vyberete a čísla se zúží.", selector: sel("statistics-view-charts"), klik: ["statistics-view-charts"], icon: "statistics" },
      { page: "statistics", title: "Hotovo", description: "Čísla teď znáte za libovolné období. Aby chodila sama, zapněte měsíční nebo týdenní report do e-mailu v Nastavení → Komunikace → Report statistik.", selector: sel("statistics-view"), icon: "statistics" },
    ],
  },
  {
    id: "faktury",
    nazev: "Vystavit fakturu",
    popis: "Odběratel, položky s DPH, vystavení, tisk nebo e-mail a označení zaplacené.",
    page: "invoices",
    dostupny: (k) => !!k.stranky.invoices,
    kroky: [
      { page: "invoices", title: "K čemu to je", description: "Faktura s položkami, DPH podle nastavení servisu a číslem z číselné řady. Za jednu opravu je nejrychlejší tlačítko Vystavit fakturu v detailu zakázky – položky se převezmou z oprav.", selector: sel("sidebar-nav-invoices"), icon: "doc" },
      { page: "invoices", title: "Klikněte na Nová faktura", description: "Otevře se prázdný editor faktury. Koncept se neuloží, dokud nekliknete na Uložit koncept nebo Vystavit.", selector: sel("invoices-nova"), icon: "doc" },
      { page: "invoices", title: "Vyberte odběratele", description: "Začněte psát jméno, firmu, telefon nebo IČO a vyberte zákazníka ze seznamu – adresa a IČO se doplní samy. Nového odběratele stačí vypsat do polí.", selector: sel("invoices-odberatel"), klik: ["invoices-nova"], icon: "customers" },
      { page: "invoices", title: "Vyplňte položky", description: "Název, množství a cenu za jednotku; sazba DPH se předvyplní podle servisu. Další řádek přidáte tlačítkem Přidat položku, součet je dole.", selector: sel("invoices-polozky"), klik: ["invoices-nova"], icon: "doc" },
      { page: "invoices", title: "Klikněte na Vystavit", description: "Faktura dostane číslo a objeví se mezi nezaplacenými; datum vystavení a splatnost změníte předtím v Údajích dokladu. Uložit koncept si ji jen odloží na později.", selector: sel("invoices-vystavit"), klik: ["invoices-nova"], icon: "doc" },
      { page: "invoices", title: "Vytiskněte nebo pošlete", description: "V detailu faktury klikněte na Tisk (tisk, PDF, náhled) nebo Odeslat e-mailem. Když zákazník zaplatí, klikněte na Označit zaplacenou a vyberte způsob platby.", selector: sel("invoices-detail-akce"), klik: ["invoices-prvni"], icon: "doc" },
      { page: "invoices", title: "Hotovo", description: "Dlaždice nahoře ukazují, kolik je nezaplaceno a po splatnosti – kliknutím seznam vyfiltrujete. Uzávěrka sečte zaplacené doklady za den podle způsobu platby.", selector: sel("invoices-dlazdice"), icon: "doc" },
    ],
  },
  {
    id: "faktury-souhrnna",
    nazev: "Souhrnná faktura pro firmu",
    popis: "Jedna faktura za všechny vydané zakázky zákazníka v měsíci.",
    page: "invoices",
    dostupny: (k) => !!k.stranky.invoices,
    kroky: [
      { page: "invoices", title: "K čemu to je", description: "Firemní zákazník, který vám nosí zařízení průběžně, dostane jednu fakturu za měsíc místo faktury ke každé zakázce.", selector: sel("sidebar-nav-invoices"), icon: "doc" },
      { page: "invoices", title: "Klikněte na Souhrnná faktura", description: "Otevře se okno, ve kterém vyberete zákazníka, období a zakázky.", selector: sel("invoices-souhrnna"), icon: "doc" },
      { page: "invoices", title: "Vyberte zákazníka", description: "Napište firmu, jméno, IČO nebo telefon a vyberte ze seznamu. Se stejným IČO se nabídnou i zakázky jeho dalších kontaktních osob.", selector: sel("souhrnna-zakaznik"), klik: ["invoices-souhrnna"], icon: "customers" },
      { page: "invoices", title: "Nastavte období", description: "Šipkami vyberte měsíc, nebo přepněte na Od–do. Počítá se datum vydání zakázky; Rozepsat na jednotlivé opravy dá na fakturu každou opravu zvlášť.", selector: sel("souhrnna-obdobi"), klik: ["invoices-souhrnna"], icon: "doc" },
      { page: "invoices", title: "Zaškrtněte zakázky", description: "Nabídnou se vydané zakázky bez faktury; zašedlé už na jiné faktuře jsou. Zaškrtnutím v hlavičce vyberete všechny.", selector: sel("souhrnna-zakazky"), klik: ["invoices-souhrnna"], icon: "doc" },
      { page: "invoices", title: "Klikněte na Vytvořit fakturu", description: "Otevře se běžný editor faktury s odběratelem a položkami ze zakázek.", selector: sel("souhrnna-vytvorit"), klik: ["invoices-souhrnna"], icon: "doc" },
      { page: "invoices", title: "Hotovo – zkontrolujte a vystavte", description: "V editoru projděte položky a klikněte na Vystavit. Zakázky jsou pak vedené jako vyfakturované a do další souhrnné faktury se nenabídnou; storno faktury je uvolní.", selector: sel("invoices-vystavit"), icon: "doc" },
    ],
  },
  {
    id: "sms",
    nazev: "Odpovědět zákazníkovi v SMS",
    popis: "Najít konverzaci, odpovědět, otevřít zakázku a vyřízený chat archivovat.",
    page: "sms",
    dostupny: (k) => !!k.stranky.sms,
    kroky: [
      { page: "sms", title: "K čemu to je", description: "Všechny SMS se zákazníky na jednom místě – co servis poslal a co zákazník odpověděl. Novou konverzaci začnete v detailu zakázky tlačítkem SMS.", selector: sel("sidebar-nav-sms"), icon: "orders" },
      { page: "sms", title: "Klikněte na konverzaci", description: "Nejnovější jsou nahoře, červené číslo znamená nepřečtené odpovědi. Chat se otevře vpravo.", selector: sel("sms-seznam"), icon: "orders" },
      { page: "sms", title: "Napište odpověď", description: "Pište do pole dole. Enter zprávu odešle, Shift+Enter udělá nový řádek.", selector: sel("sms-zprava"), klik: ["sms-prvni"], icon: "orders" },
      { page: "sms", title: "Klikněte na Odeslat", description: "Zpráva odejde z čísla servisu a hned se objeví v chatu i v detailu zakázky.", selector: sel("sms-odeslat"), klik: ["sms-prvni"], icon: "orders" },
      { page: "sms", title: "Otevřete zakázku", description: "Konverzace navázaná na zakázku má nahoře odkaz Zakázka … – otevře její detail, kde je stejný chat.", selector: sel("sms-zakazka"), klik: ["sms-prvni"], icon: "orders" },
      { page: "sms", title: "Archivujte vyřízené", description: "Klikněte na Archivovat a chat zmizí ze seznamu; zprávy zůstanou u zakázky. Zaškrtnutím Zobrazit archivované ho najdete a tlačítkem Vyjmout vrátíte.", selector: sel("sms-archivovat"), icon: "orders" },
      { page: "sms", title: "Hotovo", description: "Když zákazník odpoví, naskočí číslo u SMS v navigaci. Šablony a automatické zprávy při změně stavu nastavíte v Nastavení → Komunikace (SMS a Automatizace).", selector: sel("sidebar-nav-sms"), icon: "orders" },
    ],
  },
  {
    id: "zasilky",
    nazev: "Poslat zakázky na jinou pobočku",
    popis: "Založit zásilku, naplnit ji zakázkami, vytisknout protokol a odeslat.",
    page: "zasilky",
    novinkaOd: "2026-09-27",
    dostupny: (k) => !!k.stranky.zasilky,
    kroky: [
      { page: "zasilky", title: "K čemu to je", description: "Zásilka je krabice se zakázkami, která jede z jedné pobočky na druhou – na opravu, nebo opravená zpátky. Aplikace pak ví, kde zařízení fyzicky je; pobočka přijetí a výdeje se nemění.", selector: sel("sidebar-nav-zasilky"), icon: "orders" },
      { page: "zasilky", title: "Vyberte odkud a kam", description: "Vlevo je pobočka, odkud posíláte (předvyplní se ta vybraná v liště nahoře), vpravo vyberte cílovou pobočku. Se dvěma pobočkami je cíl vybraný sám.", selector: sel("zasilky-pobocky"), icon: "orders" },
      { page: "zasilky", title: "Klikněte na + Nová zásilka", description: "Založí se prázdný koncept a hned se otevře vpravo. Koncept se zakázek zatím nijak nedotýká – můžete ho plnit postupně během dne.", selector: sel("zasilky-nova"), icon: "orders" },
      { page: "zasilky", title: "Doplňte dopravce", description: "Napište dopravce (PPL, Zásilkovna, vlastní svoz), sledovací číslo a poznámku, třeba „2 krabice“. Ukládá se samo po opuštění pole a jde doplnit i po odeslání.", selector: sel("zasilky-hlavicka"), klik: ["zasilky-zalozka-koncepty", "zasilky-prvni"], icon: "orders" },
      { page: "zasilky", title: "Přidejte zakázky", description: "Tady jsou zakázky, které jsou fyzicky na pobočce odeslání. U každé, kterou dáváte do krabice, klikněte na Přidat; zelené se vracejí domů a mají Přidat vše. Jednu zakázku přidáte i z jejího detailu v kartě Kde je zakázka.", selector: sel("zasilky-pridat-zakazky"), klik: ["zasilky-zalozka-koncepty", "zasilky-prvni"], icon: "orders" },
      { page: "zasilky", title: "Vytiskněte předávací protokol", description: "Zkontrolujte seznam zakázek v zásilce (Odebrat vrátí zakázku zpět do nabídky) a klikněte na Předávací protokol. Vložte ho do krabice – příjemce podle něj odškrtá, co dorazilo.", selector: sel("zasilky-protokol"), klik: ["zasilky-zalozka-koncepty", "zasilky-prvni"], icon: "doc" },
      { page: "zasilky", title: "Klikněte na Odeslat", description: "Až je krabice zabalená. Zakázky se označí „na cestě“ a obsah zásilky už nejde měnit; stav opravy zakázek zůstává, jak byl.", selector: sel("zasilky-odeslat"), klik: ["zasilky-zalozka-koncepty", "zasilky-prvni"], icon: "orders" },
      { page: "zasilky", title: "Hotovo – zásilka je na cestě", description: "Najdete ji v záložce Na cestě a cílová pobočka ji vidí s číslem u Zásilek v navigaci. Zakázky mají v seznamu štítek „→ pobočka“ a v detailu „Na cestě do pobočky…“; převzetí je v průvodci Převzít zásilku.", selector: sel("zasilky-zalozka-na-ceste"), icon: "orders" },
    ],
  },
  {
    id: "zasilky-prevzit",
    nazev: "Převzít zásilku z jiné pobočky",
    popis: "Kde příchozí zásilku najdete, jak odškrtat, co dorazilo, a co když něco chybí.",
    page: "zasilky",
    novinkaOd: "2026-09-27",
    dostupny: (k) => !!k.stranky.zasilky,
    kroky: [
      { page: "zasilky", title: "K čemu to je", description: "Když k vám dorazí krabice z jiné pobočky, převezmete ji tady – teprve pak aplikace ví, že zařízení je u vás. Číslo u Zásilek v navigaci říká, kolik zásilek k vám právě jede.", selector: sel("sidebar-nav-zasilky"), icon: "orders" },
      { page: "zasilky", title: "Vyberte svou pobočku", description: "V liště nahoře klikněte na pobočku, kde krabici přebíráte. Podle ní se zásilky značí „k nám“ a „od nás“.", selector: sel("pobocka-lista"), icon: "orders" },
      { page: "zasilky", title: "Otevřete záložku Na cestě", description: "Jsou tu všechny odeslané zásilky, které ještě nikdo celé nepřevzal. Když k vám něco jede, stránka se na ni otevře sama.", selector: sel("zasilky-zalozka-na-ceste"), klik: ["zasilky-zalozka-na-ceste"], icon: "orders" },
      { page: "zasilky", title: "Klikněte na zásilku „k nám“", description: "Zásilka se štítkem „k nám“ jede na vaši pobočku; v řádku je i sledovací číslo. Otevře se vpravo se seznamem zakázek.", selector: sel("zasilky-seznam"), klik: ["zasilky-zalozka-na-ceste"], icon: "orders" },
      { page: "zasilky", title: "Zaškrtněte, co v krabici je", description: "U každé zakázky, kterou máte v ruce, zaškrtněte převzít – nebo klikněte na Vybrat vše. Podle předávacího protokolu z krabice poznáte, co tam mělo být.", selector: sel("zasilky-polozky"), klik: ["zasilky-zalozka-na-ceste", "zasilky-prvni"], icon: "orders" },
      { page: "zasilky", title: "Klikněte na Převzít vybrané", description: "Zaškrtnuté zakázky jsou teď vedené u vás (nebo zase doma, když se vrátily opravené). Stav opravy se nemění – v zakázkách pak pokračujete jako obvykle.", selector: sel("zasilky-prevzit"), klik: ["zasilky-zalozka-na-ceste", "zasilky-prvni"], icon: "orders" },
      { page: "zasilky", title: "Když něco chybí", description: "Nezaškrtnutou zakázku nechte být: zůstane „na cestě“ a zásilka dál svítí v Na cestě se štítkem „chybí 1“. Až dorazí, otevřete zásilku znovu a převezměte ji; jestli se ztratila, ozvěte se pobočce, která ji poslala.", selector: sel("zasilky-seznam"), klik: ["zasilky-zalozka-na-ceste"], icon: "orders" },
      { page: "zasilky", title: "Hotovo", description: "Když převezmete všechno, zásilka se přesune do Převzatých. Zakázky najdete v Zakázkách ve skupině Přesuny; v detailu karta Kde je zakázka ukazuje, na které pobočce zařízení je.", selector: sel("zasilky-zalozka-prevzate"), icon: "orders" },
    ],
  },
  {
    id: "zasilky-z-detailu",
    nazev: "Poslat jednu zakázku z jejího detailu",
    popis: "Tlačítko Přidat do zásilky v kartě Kde je zakázka, bez hledání v seznamu.",
    page: "zasilky",
    novinkaOd: "2026-09-27",
    dostupny: (k) => !!k.stranky.zasilky,
    kroky: [
      { page: "zasilky", title: "K čemu to je", description: "Když máte zakázku zrovna otevřenou (třeba po příjmu), přidáte ji do zásilky rovnou z detailu. Otevřeme ukázkovou nebo poslední zakázku.", selector: sel("sidebar-nav-zasilky"), icon: "orders" },
      { page: "orders", title: "Najděte kartu Kde je zakázka", description: "Ukazuje, na které pobočce zařízení je, a historii zásilek, ve kterých jelo. Karta je v detailu jen u servisu s víc pobočkami.", selector: sel("detail-kde-je"), akce: "otevrit-ukazkovou-zakazku", icon: "orders" },
      { page: "orders", title: "Klikněte na Přidat do zásilky", description: "S víc pobočkami nejdřív vyberte cílovou vedle tlačítka. Zakázka se přidá do otevřeného konceptu na tu pobočku, a když žádný není, koncept se založí.", selector: sel("detail-pridat-do-zasilky"), icon: "orders" },
      { page: "zasilky", title: "Odešlete zásilku", description: "Na stránce Zásilky otevřete koncept a klikněte na Odeslat – krabici tak odešlete celou, i s ostatními zakázkami v ní.", selector: sel("zasilky-odeslat"), klik: ["zasilky-zalozka-koncepty", "zasilky-prvni"], icon: "orders" },
      { page: "zasilky", title: "Hotovo", description: "Zásilka je v záložce Na cestě a zakázka má v detailu „Na cestě do pobočky…“. Cílová pobočka ji převezme podle průvodce Převzít zásilku.", selector: sel("zasilky-zalozka-na-ceste"), icon: "orders" },
    ],
  },
  ODMENY,
  {
    id: "provize",
    nazev: "Provize",
    popis: "Sdílené provize majitele aplikace – jen pro čtení.",
    page: "provize",
    dostupny: (k) => !!k.stranky.provize,
    kroky: [
      { page: "provize", title: "Provize", description: "Zakázky spočítané v Jobi a vyúčtování, která z nich vznikla. Bez nastavení a bez možnosti cokoli měnit.", selector: sel("page-provize"), icon: "statistics" },
    ],
  },

  // ---- Nastavení --------------------------------------------------------------
  {
    id: "nastaveni-firma",
    nazev: "Údaje firmy a kontakty",
    popis: "Název, IČO, adresa a zkratka pro čísla zakázek; telefon a e-mail na dokumenty.",
    page: "settings",
    settingsSubsection: "service_basic",
    kroky: [
      { page: "settings", title: "Údaje firmy", description: "Název, IČO a adresa se tisknou v hlavičce zakázkového listu a faktury. Zkratka je základ čísla zakázky (např. SRV26000001) – nastavte ji dřív, než vytisknete první doklad.", selector: sel("settings-content"), settingsSection: nast("company", "service_basic"), icon: "settings" },
      { page: "settings", title: "Kontakty", description: "Telefon a e-mail vidí zákazník na dokumentech a v odkazu na stav zakázky. Bankovní údaje jdou na fakturu.", selector: sel("settings-content"), settingsSection: nast("company", "service_contact"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-statusy",
    nazev: "Statusy zakázek",
    popis: "Vlastní stavy, barvy, pořadí a koncové stavy.",
    page: "settings",
    settingsSubsection: "orders_statuses",
    kroky: [
      { page: "settings", title: "Statusy zakázek", description: "Stavy si pojmenujte po svém a nastavte barvy. Koncový stav (Vydáno, Vráceno bez opravy…) uzavírá zakázku: odepíše díly, zapíše datum vydání pro Statistiky a odměny.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_statuses"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-povinna-pole",
    nazev: "Povinná pole",
    popis: "Co musí být vyplněné při příjmu.",
    page: "settings",
    settingsSubsection: "orders_required_fields",
    kroky: [{ page: "settings", title: "Povinná pole", description: "Určete, bez čeho nejde zakázku založit – třeba telefon zákazníka. Ostatní pole zůstanou nepovinná.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_required_fields"), icon: "settings" }],
  },
  {
    id: "nastaveni-detail",
    nazev: "Nastavení detailu zakázky",
    popis: "Které sekce v detailu vidíte a jestli se přiděluje technik.",
    page: "settings",
    settingsSubsection: "orders_detail",
    kroky: [{ page: "settings", title: "Detail zakázky", description: "Sekce, které nepoužíváte, schovejte. Přidělování technika zapne kartu Technik a skupinu Moje v přehledu.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_detail"), icon: "settings" }],
  },
  {
    id: "nastaveni-slevy",
    nazev: "Slevy",
    popis: "Přednastavené slevy na jedno kliknutí.",
    page: "settings",
    settingsSubsection: "orders_slevy",
    kroky: [{ page: "settings", title: "Slevy", description: "Sleva v procentech nebo v korunách se pak v zakázce vybírá tlačítkem místo psaní. Uplatní se už při příjmu i v detailu.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_slevy"), icon: "settings" }],
  },
  {
    id: "nastaveni-prace",
    nazev: "Hodinová práce",
    popis: "Sazba a stopky na zakázce.",
    page: "settings",
    settingsSubsection: "orders_prace",
    kroky: [{ page: "settings", title: "Hodinová práce", description: "Výchozí sazba Kč/h; v zakázce pak přidáte položku hodiny × sazba. Stopky na zakázce měří čas technika a promítají se do KPI ve Statistikách.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_prace"), icon: "settings" }],
  },
  {
    id: "nastaveni-reklamace",
    nazev: "Reklamace a záruka na opravu",
    popis: "Do kdy platí záruka na opravu a jak se reklamace ukazují v seznamu.",
    page: "settings",
    settingsSubsection: "orders_reklamace",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "settings", title: "Záruka na opravu", description: "Výchozí délka záruky v měsících – zvlášť pro spotřebitele (24) a pro firmu s IČO (12). Při vydání zakázky se na ni zapíše „Záruka na opravu do …“ podle nejdelší záruky z provedených oprav; oprava v ceníku může mít vlastní délku. Při zakládání reklamace pak Jobi ukáže, jestli je zakázka v záruce, a po záruce nabídne založit placenou opravu.", selector: sel("settings-zaruka-opravy"), settingsSection: nast("orders", "orders_reklamace"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-kontrola",
    nazev: "Kontrola po opravě",
    popis: "Kontrolní seznamy před vydáním.",
    page: "settings",
    settingsSubsection: "orders_kontrola",
    kroky: [{ page: "settings", title: "Kontrola po opravě", description: "Šablona kontrolního seznamu podle typu zařízení. Technik odškrtá položky v detailu, výsledek jde do protokolu.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_kontrola"), icon: "settings" }],
  },
  {
    id: "nastaveni-nahradni",
    nazev: "Náhradní zařízení",
    popis: "Zápůjčky zákazníkům po dobu opravy.",
    page: "settings",
    settingsSubsection: "orders_nahradni",
    kroky: [{ page: "settings", title: "Náhradní zařízení", description: "Seznam zařízení k zapůjčení a kauce. V detailu zakázky se zápůjčka zapíše a vytiskne smlouva.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_nahradni"), icon: "settings" }],
  },
  {
    id: "nastaveni-rezervace",
    nazev: "Online rezervace",
    popis: "Formulář na webu, ze kterého vznikne zakázka.",
    page: "settings",
    settingsSubsection: "orders_rezervace",
    kroky: [{ page: "settings", title: "Online rezervace", description: "Zákazník si na webu vybere termín a opravu z ceníku; rezervace se objeví v kalendáři a jedním klikem se z ní založí zakázka.", selector: sel("settings-content"), settingsSection: nast("orders", "orders_rezervace"), icon: "settings" }],
  },
  {
    id: "nastaveni-tisk",
    nazev: "JobiDocs a tisk",
    popis: "Dokumenty, šablony a automatický tisk.",
    page: "settings",
    settingsSubsection: "orders_tisk_dokumentu",
    kroky: [
      { page: "settings", title: "Šablony v JobiDocs", description: "Vzhled dokumentů (rozvržení, sekce, logo, razítko, vlastní texty) se upravuje v aplikaci JobiDocs. Na desktopu ji odsud spustíte nebo otevřete; tečka vedle tlačítka říká, jestli je připojená.", selector: sel("settings-tisk-jobidocs"), settingsSection: nast("documents", "orders_tisk_dokumentu"), icon: "jobidocs" },
      { page: "settings", title: "Automatický tisk", description: "Kdy se má sám otevřít dialog tisku: zakázkový list při vytvoření zakázky nebo při přepnutí do vybraného stavu, záruční list stejně. Každá změna se ukládá hned.", selector: sel("settings-tisk-automaticky"), settingsSection: nast("documents", "orders_tisk_dokumentu"), icon: "jobidocs" },
      { page: "settings", title: "Reklamace", description: "Protokol o přijetí reklamace se tiskne při jejím vytvoření nebo při přepnutí do stavu; protokol o vydání reklamace při přepnutí do stavu, který vyberete.", selector: sel("settings-tisk-reklamace"), settingsSection: nast("documents", "orders_tisk_dokumentu"), icon: "doc" },
    ],
  },
  {
    id: "nastaveni-automatizace",
    nazev: "Automatizace",
    popis: "Co se stane samo při změně stavu.",
    page: "settings",
    settingsSubsection: "communication_automations",
    dostupny: (k) => k.admin,
    kroky: [
      { page: "settings", title: "Pravidla", description: "Když se něco stane se zakázkou, Jobi za vás pošle SMS nebo e-mail, přepne stav, připíše poplatek (třeba skladné za den) nebo zapíše poznámku technikovi. Pravidla se vyhodnocují v pořadí, ve kterém tu jsou; šipkami je přeskládáte, zaškrtávátkem vypnete.", selector: sel("settings-automations-pravidla"), settingsSection: nast("communication", "communication_automations"), icon: "settings" },
      { page: "settings", title: "Nové pravidlo", description: "Spouštěč: přepnutí do stavu, zakázka ve stavu déle než N hodin či dní (i opakovaně), založení zakázky nebo událost z portálu (schválená či zamítnutá nabídka, podpis, otevření portálu). Prázdný seznam nabídne šablony – připomínku vyzvednutí a nabídku bez odpovědi.", selector: sel("settings-automations-nove"), settingsSection: nast("communication", "communication_automations"), icon: "settings" },
      { page: "settings", title: "Žádost o recenzi", description: "Vložte odkaz na své recenze (Google, Firmy.cz, Heureka) a zapněte: den po vydání zakázky dostane zákazník SMS s poděkováním a odkazem, bez telefonu e-mail. Posílá se jen v denní době (výchozí 9–19) a stejnému zákazníkovi nejvýš jednou za 90 dní. Kdo žádosti nechce, tomu to vypnete v Zákaznících.", selector: sel("automatizace-recenze"), settingsSection: nast("communication", "communication_automations"), icon: "settings" },
      { page: "settings", title: "Historie spuštění", description: "Posledních 50 spuštění s výsledkem a detailem – tady zjistíte, proč SMS neodešla nebo proč se stav nepřepnul. Obnovuje se sama každou minutu.", selector: sel("settings-automations-historie"), settingsSection: nast("communication", "communication_automations"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-chat",
    nazev: "Chat týmu",
    popis: "Kanály servisu a poboček, soukromé zprávy, zmínky.",
    page: "settings",
    settingsSubsection: "communication_chat",
    dostupny: (k) => k.admin,
    kroky: [{ page: "settings", title: "Chat týmu", description: "Zprávy v týmu bez opuštění aplikace: kanál servisu, pobočky a soukromé zprávy. Zmínka #číslo zakázky otevře detail.", selector: sel("settings-content"), settingsSection: nast("communication", "communication_chat"), icon: "team" }],
  },
  {
    id: "nastaveni-report",
    nazev: "Report statistik e-mailem",
    popis: "Měsíční nebo týdenní PDF s obratem, ziskem a žebříčky.",
    page: "settings",
    settingsSubsection: "communication_report",
    dostupny: (k) => k.admin,
    kroky: [{ page: "settings", title: "Report statistik", description: "Zapněte, komu a kdy má chodit. Náhled PDF a zkušební odeslání jsou hned tady.", selector: sel("settings-content"), settingsSection: nast("communication", "communication_report"), icon: "statistics" }],
  },
  {
    id: "nastaveni-tym",
    nazev: "Tým a oprávnění",
    popis: "Pozvánky, role a co kdo smí.",
    page: "settings",
    settingsSubsection: "service_team",
    dostupny: (k) => k.admin,
    kroky: [
      { page: "settings", title: "Přidělování technikům", description: "Přepínač zapne kartu Technik v detailu zakázky („Přidělit mně“), skupinu Moje v přehledu a jméno technika na kartě zakázky. Servis s jedním technikem to nepotřebuje.", selector: sel("settings-team-pridelovani"), settingsSection: nast("people", "service_team"), icon: "team" },
      { page: "settings", title: "Členové týmu", description: "U každého člena role (člen nebo správce) a tlačítko Oprávnění: úpravy a mazání zakázek, změna stavu, zákazníci, statusy, dokumenty, tisk, nastavení servisu, statistiky. S pobočkami tu nastavíte domovskou pobočku a na které pobočky člen vidí.", selector: sel("settings-team-clenove"), settingsSection: nast("people", "service_team"), icon: "team" },
      { page: "settings", title: "Pozvat člena", description: "Pozvánka odejde e-mailem s vybranou rolí; dokud ji kolega nepřijme, je v seznamu Čekající pozvánky. Kolik míst tarif dovoluje, hlídá tlačítko samo.", selector: sel("settings-team-pozvat"), settingsSection: nast("people", "service_team"), icon: "team" },
    ],
  },
  {
    id: "nastaveni-odmeny",
    nazev: "Odměny za opravy",
    popis: "Pravidla prémií pro tým.",
    page: "settings",
    settingsSubsection: "service_odmeny",
    novinkaOd: "2026-09-26",
    dostupny: (k) => k.admin,
    kroky: [{ page: "settings", title: "Odměny za opravy", description: "Pravidlo = text v názvu opravy, částka nebo procento a komu. Odměna vzniká jen u opravy nabídnuté zákazníkovi navíc a po vydání zakázky. Stránku Odměny ukážete týmu přepínačem.", selector: sel("settings-content"), settingsSection: nast("people", "service_odmeny"), icon: "team" }],
  },
  {
    id: "nastaveni-api",
    nazev: "API a webhooky",
    popis: "Ceník, sklad a zakázky pro váš web nebo e-shop.",
    page: "settings",
    settingsSubsection: "service_api",
    dostupny: (k) => !!(k.moduly.api_catalog || k.moduly.api_inventory),
    kroky: [{ page: "settings", title: "API", description: "Tokeny pro čtení ceníku a skladu, webhooky při změně zakázky a dokumentace. Limity volání jsou uvedené u každého tokenu.", selector: sel("settings-content"), settingsSection: nast("people", "service_api"), icon: "settings" }],
  },
  {
    id: "nastaveni-pobocky",
    nazev: "Pobočky",
    popis: "Více provozoven v jednom servisu.",
    page: "settings",
    settingsSubsection: "service_branches",
    dostupny: (k) => k.admin && !!k.moduly.branches,
    kroky: [{ page: "settings", title: "Pobočky", description: "Každá zakázka patří pobočce; lišta nahoře přepíná pohled. Členy jde omezit na své pobočky, přesuny řeší Zásilky.", selector: sel("settings-content"), settingsSection: nast("company", "service_branches"), icon: "settings" }],
  },
  {
    id: "nastaveni-gdpr",
    nazev: "Ochrana údajů (GDPR)",
    popis: "Automatická anonymizace zákazníků, kteří roky nepřišli.",
    page: "settings",
    settingsSubsection: "service_gdpr",
    novinkaOd: "2026-09-27",
    dostupny: (k) => k.admin,
    kroky: [
      { page: "settings", title: "Anonymizace starých zákazníků", description: "Zákazník bez zakázky za posledních 5 let (nastavíte 3–10) přijde o jméno, kontakty, adresu, fotky, podpisy a SMS. Zakázky zůstanou a faktury se nemění – účetní doklady se archivují 10 let. Rozpracovaná zakázka nebo nezaplacená faktura zákazníka chrání.", selector: sel("settings-gdpr-anonymizace"), settingsSection: nast("company", "service_gdpr"), icon: "customers" },
      { page: "settings", title: "Náhled a potvrzení", description: "„Zobrazit náhled“ ukáže, koho se to dotkne, a nic nemění. Spustí se až po napsání slova ANONYMIZOVAT; je to nevratné. Pak pravidlo běží samo každou noc – a když ho zpřísníte, čeká na nové potvrzení.", selector: sel("settings-gdpr-anonymizace"), settingsSection: nast("company", "service_gdpr"), icon: "customers" },
    ],
  },
  {
    id: "nastaveni-predplatne",
    nazev: "Předplatné",
    popis: "Tarif, moduly a platby.",
    page: "settings",
    settingsSubsection: "service_subscription",
    dostupny: (k) => k.admin,
    kroky: [{ page: "settings", title: "Předplatné", description: "Co máte zapnuté, do kdy platí zkušební období a jak se platí.", selector: sel("settings-content"), settingsSection: nast("company", "service_subscription"), icon: "settings" }],
  },
  {
    id: "nastaveni-profil",
    nazev: "Můj účet",
    popis: "Přezdívka, fotka, PIN a osobní nastavení.",
    page: "settings",
    settingsSubsection: "profile_me",
    kroky: [{ page: "settings", title: "Můj účet", description: "Přezdívka a fotka se ukazují kolegům v historii, chatu a u přiděleného technika. PIN umožní rychlé přepínání účtů na sdíleném počítači.", selector: sel("settings-content"), settingsSection: nast("profile", "profile_me"), icon: "profile" }],
  },
];

export function dostupniPruvodci(k: KontextPruvodcu): Pruvodce[] {
  return PRUVODCI.filter((p) => (p.dostupny ? p.dostupny(k) : true) && p.kroky.length > 0);
}

/** Průvodce pro aktuální místo: podsekce Nastavení, nebo stránka (úvod se pro Zakázky nebere – má vlastní průvodce). */
export function pruvodceProMisto(dostupne: Pruvodce[], page: NavKey, settingsSubsection?: string | null): Pruvodce | null {
  if (page === "settings" && settingsSubsection) {
    return dostupne.find((p) => p.settingsSubsection === settingsSubsection) ?? null;
  }
  return dostupne.find((p) => p.page === page && p.id !== "uvod" && !p.settingsSubsection) ?? null;
}

// ---------------------------------------------------------------------------
// Hledání v průvodcích (pole v panelu nápovědy)
// ---------------------------------------------------------------------------

export type VysledekHledani = {
  pruvodce: Pruvodce;
  /** Index kroku, na kterém průvodce spustit. */
  krok: number;
};

/** Malá písmena bez diakritiky, ať „Zakázka“ najde i „zakazka“. */
export function bezDiakritiky(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Nejméně znaků, od kterých se hledá – jedno písmeno najde skoro všechno. */
export const MIN_DELKA_DOTAZU = 2;

/**
 * Prohledá názvy, popisy a kroky dostupných průvodců.
 *
 * Každé slovo dotazu se musí najít někde v průvodci (název + popis + kroky).
 * Výsledkem jsou kroky, ve kterých se aspoň jedno slovo vyskytuje přímo
 * – tak „tisk“ vede na krok „Tisk a vydání“, ne na začátek Detailu zakázky.
 * Kroky s více nalezenými slovy jsou dřív („nová reklamace“ ukáže krok
 * Nová reklamace před Skupinami zakázek, kde je jen „reklamace“); při
 * stejném počtu platí pořadí katalogu, takže hlavní stránky jsou před
 * Nastavením. Když sedí jen název nebo popis průvodce, vrátí se jeho
 * první krok.
 */
export function hledejVPruvodcich(dostupne: Pruvodce[], dotaz: string, limit = 20): VysledekHledani[] {
  const slova = bezDiakritiky(dotaz).split(/\s+/).filter((s) => s.length > 0);
  if (slova.length === 0 || bezDiakritiky(dotaz).trim().length < MIN_DELKA_DOTAZU) return [];
  const vysledky: Array<VysledekHledani & { skore: number }> = [];
  for (const p of dostupne) {
    const hlavicka = bezDiakritiky(`${p.nazev} ${p.popis}`);
    const kroky = p.kroky.map((k) => bezDiakritiky(`${k.title} ${k.description}`));
    const cely = `${hlavicka} ${kroky.join(" ")}`;
    if (!slova.every((s) => cely.includes(s))) continue;
    let nalezeno = false;
    kroky.forEach((text, i) => {
      const skore = slova.filter((s) => text.includes(s)).length;
      if (skore > 0) {
        vysledky.push({ pruvodce: p, krok: i, skore });
        nalezeno = true;
      }
    });
    if (!nalezeno) vysledky.push({ pruvodce: p, krok: 0, skore: 0 });
  }
  // Řazení je stabilní, takže při shodném skóre zůstane pořadí katalogu.
  return vysledky
    .sort((a, b) => b.skore - a.skore)
    .slice(0, limit)
    .map(({ pruvodce, krok }) => ({ pruvodce, krok }));
}

// ---------------------------------------------------------------------------
// Novinky – co se uživateli zpřístupnilo od minule
// ---------------------------------------------------------------------------

export type UlozenyStavPruvodcu = {
  /** Průvodci, které měl uživatel k dispozici při poslední kontrole. */
  dostupneDrive: string[];
  /** ISO datum poslední kontrole novinek. */
  posledniKontrola: string;
  /** Kdy uživatel průvodce prošel (id → ISO). */
  videno: Record<string, string>;
  /** Novinky, které uživatel ještě neprošel (odznak u otazníku, seznam v Nápovědě). */
  neprosle: string[];
};

/**
 * Co je nového: průvodce, který dřív dostupný nebyl (zapnul se modul,
 * přibyla funkce), nebo průvodce s `novinkaOd` po poslední kontrole.
 * První spuštění (nic uloženo) nic neoznamuje – jen si zapamatuje stav,
 * ať se stávající uživatel nedozví o „novinkách“, které zná.
 */
export function zjistiNovinky(dostupne: Pruvodce[], ulozeno: UlozenyStavPruvodcu | null, dnes: Date): { novinky: Pruvodce[]; ulozit: UlozenyStavPruvodcu } {
  const dnesIso = dnes.toISOString().slice(0, 10);
  const ids = dostupne.map((p) => p.id);
  if (!ulozeno) {
    return { novinky: [], ulozit: { dostupneDrive: ids, posledniKontrola: dnesIso, videno: {}, neprosle: [] } };
  }
  const novinky = dostupne.filter((p) => {
    if (p.id === "uvod") return false;
    const noveDostupny = !ulozeno.dostupneDrive.includes(p.id);
    const novaFunkce = !!p.novinkaOd && p.novinkaOd > ulozeno.posledniKontrola;
    return (noveDostupny || novaFunkce) && !ulozeno.videno[p.id];
  });
  const neprosle = [...new Set([...ulozeno.neprosle, ...novinky.map((p) => p.id)])].filter((id) => ids.includes(id) && !ulozeno.videno[id]);
  return { novinky, ulozit: { ...ulozeno, dostupneDrive: ids, posledniKontrola: dnesIso, neprosle } };
}

const KLIC = "jobsheet_pruvodci_v1";

export function nactiStavPruvodcu(userId: string): UlozenyStavPruvodcu | null {
  try {
    const raw = localStorage.getItem(`${KLIC}:${userId}`);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<UlozenyStavPruvodcu>;
    return {
      dostupneDrive: Array.isArray(o.dostupneDrive) ? o.dostupneDrive.filter((x): x is string => typeof x === "string") : [],
      posledniKontrola: typeof o.posledniKontrola === "string" ? o.posledniKontrola : "1970-01-01",
      videno: o.videno && typeof o.videno === "object" ? (o.videno as Record<string, string>) : {},
      neprosle: Array.isArray(o.neprosle) ? o.neprosle.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

export function ulozStavPruvodcu(userId: string, stav: UlozenyStavPruvodcu): void {
  try {
    localStorage.setItem(`${KLIC}:${userId}`, JSON.stringify(stav));
  } catch {
    /* bez úložiště se novinky připomenou příště */
  }
}

/** Uživatel průvodce prošel (nebo zavřel): už není novinka. */
export function oznacProsly(userId: string, id: string, dnes = new Date()): UlozenyStavPruvodcu {
  const ulozeno = nactiStavPruvodcu(userId) ?? { dostupneDrive: [], posledniKontrola: dnes.toISOString().slice(0, 10), videno: {}, neprosle: [] };
  const next: UlozenyStavPruvodcu = { ...ulozeno, videno: { ...ulozeno.videno, [id]: dnes.toISOString().slice(0, 10) }, neprosle: ulozeno.neprosle.filter((x) => x !== id) };
  ulozStavPruvodcu(userId, next);
  return next;
}

// ---------------------------------------------------------------------------
// Sdílený stav pro seznam v Nastavení → Nápověda
// ---------------------------------------------------------------------------

export type StavPruvodcu = {
  dostupne: Pruvodce[];
  videno: Record<string, string>;
  /** Id průvodců, které jsou pro uživatele novinka (ještě je neprošel). */
  novinky: string[];
};

let stav: StavPruvodcu = { dostupne: [], videno: {}, novinky: [] };
const posluchaci = new Set<() => void>();

export function nastavStavPruvodcu(next: StavPruvodcu): void {
  stav = next;
  for (const p of posluchaci) p();
}

export function useStavPruvodcu(): StavPruvodcu {
  return useSyncExternalStore(
    (cb) => {
      posluchaci.add(cb);
      return () => posluchaci.delete(cb);
    },
    () => stav,
    () => stav,
  );
}
