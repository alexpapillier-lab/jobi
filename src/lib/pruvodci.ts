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
  { page: "orders", title: "Postranní panel", description: "Zakázky, Kalendář, Zákazníci, Sklad, Zařízení, Statistiky a Nastavení. Co servis nemá zapnuté (SMS, faktury, pobočky), v panelu není.", selector: sel("sidebar-nav-orders"), icon: "orders" },
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
    { page: "odmeny", title: "Odměny týmu", description: "Prémie za opravy, které tým zákazníkovi nabídl navíc – třeba servisní čištění ke svěřené opravě. Počítá se ze zakázek vydaných v měsíci; storno nic nedostane.", selector: sel("page-odmeny"), icon: "team" },
    { page: "odmeny", title: "Zaměstnanec měsíce a žebříček", description: "Kdo má za měsíc nejvíc. Majitel zaškrtne „Vyplaceno“, u řádku může změnit příjemce nebo řádek vyřadit.", selector: sel("page-odmeny"), icon: "team" },
    { page: "odmeny", title: "Nabídnuto navíc", description: "Odměna vzniká jen u opravy s příznakem „Nabídnuto navíc“. Jobi ho předvyplní, když oprava sedí na pravidlo a není v požadované opravě z příjmu; v detailu zakázky ho přepnete jedním klikem.", selector: sel("page-odmeny"), icon: "team" },
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
    novinkaOd: "2026-09-26",
    kroky: [
      { page: "orders", title: "Detail zakázky", description: "Otevíráme ukázkovou (nebo poslední) zakázku. Nahoře je číslo, zákazník s telefonem, stav a tlačítka: Upravit, Tisk, SMS, faktura a nabídka „…“ s dalšími akcemi.", selector: sel("detail-upravit"), akce: "otevrit-ukazkovou-zakazku", icon: "orders" },
      { page: "orders", title: "Provedené opravy", description: "Opravy z ceníku nebo ručně, každá s cenou, náklady a díly. Sleva se uplatní na celek. Součet je konečná cena pro zákazníka i pro doklad.", selector: sel("detail-opravy"), icon: "orders" },
      { page: "orders", title: "Diagnostika a fotky", description: "Text pro zákazníka a fotky před a po opravě (z počítače nebo z telefonu přes QR kód). Jde na protokol a do portálu zákazníka.", selector: sel("detail-diagnostika"), icon: "orders" },
      { page: "orders", title: "SMS zákazníkovi", description: "Zpráva odchází z aplikace a odpověď se vrátí sem. Automatické SMS při změně stavu nastavíte v Komunikaci.", selector: sel("detail-sms"), icon: "orders" },
      { page: "orders", title: "Tisk a vydání", description: "Zakázkový list při příjmu, záruční list a protokol při vydání. Přepnutím do koncového stavu se zakázka vydá: odepíší se díly a zapíše datum vydání pro Statistiky.", selector: sel("detail-upravit"), icon: "doc" },
    ],
  },
  {
    id: "kalendar",
    nazev: "Kalendář",
    popis: "Termíny dokončení, rezervace a co je kdy naplánované.",
    page: "calendar",
    dostupny: (k) => k.stranky.calendar !== false,
    kroky: [
      { page: "calendar", title: "Kalendář", description: "Zakázky podle předpokládaného dokončení a online rezervace zákazníků. Kliknutím na položku otevřete zakázku.", selector: sel("page-calendar"), icon: "orders" },
    ],
  },
  {
    id: "zakaznici",
    nazev: "Zákazníci",
    popis: "Karta zákazníka, historie zakázek a hledání.",
    page: "customers",
    kroky: [
      { page: "customers", title: "Hledání zákazníka", description: "Jméno, telefon, e-mail nebo firma. Zákazník vzniká automaticky při první zakázce.", selector: sel("customers-search"), icon: "customers" },
      { page: "customers", title: "Karta zákazníka", description: "Kontakty, adresa pro doklady, poznámka a všechny zakázky zákazníka na jednom místě.", selector: sel("customers-content"), icon: "customers" },
    ],
  },
  {
    id: "sklad",
    nazev: "Sklad",
    popis: "Díly, nákupní ceny, rezervace k opravám a doobjednání.",
    page: "inventory",
    kroky: [
      { page: "inventory", title: "Produkty", description: "Díly s nákupní cenou a vazbou na model zařízení. Nákupní cena jde do marže ve Statistikách.", selector: sel("inventory-products"), icon: "inventory" },
      { page: "inventory", title: "Rezervace a odpis", description: "Díl navázaný na opravu se při přidání na zakázku rezervuje a v koncovém stavu odepíše. Nedostatek zásoby aplikace hlásí hned.", selector: sel("inventory-main"), icon: "inventory" },
      { page: "inventory", title: "Doobjednání", description: "Co je pod minimem, je tady. Import z CSV pro hromadné naplnění skladu.", selector: sel("inventory-restock"), icon: "inventory" },
    ],
  },
  {
    id: "zarizeni",
    nazev: "Zařízení a ceník",
    popis: "Modely zařízení a ceník oprav s náklady a časem.",
    page: "devices",
    kroky: [
      { page: "devices", title: "Modely a ceník", description: "Ke každému modelu opravy s cenou, náklady, časem a díly ze skladu. Při příjmu se nabídnou jedním klikem; opravu jde přidat do ceníku i z detailu zakázky.", selector: sel("devices-main"), icon: "devices" },
    ],
  },
  {
    id: "statistiky",
    nazev: "Statistiky",
    popis: "Obrat a zisk podle data vydání, počty podle přijetí, rozpracované zvlášť.",
    page: "statistics",
    novinkaOd: "2026-09-26",
    dostupny: (k) => k.stranky.statistics !== false,
    kroky: [
      { page: "statistics", title: "Období", description: "Dnes, týden, měsíc, kvartál, rok nebo vlastní. Porovnání s předchozím obdobím ukáže změnu u každého čísla.", selector: sel("statistics-period"), icon: "statistics" },
      { page: "statistics", title: "Peníze podle vydání, počty podle přijetí", description: "Příjem, náklady a zisk jsou ze zakázek vydaných v období – číslo za uzavřený měsíc se už nemění. Počet zakázek je podle přijetí. Rozpracované zakázky mají vlastní dlaždici a do příjmu nepatří, dokud se nevydají.", selector: sel("statistics-main"), icon: "statistics" },
      { page: "statistics", title: "Karty, tabulka, grafy", description: "Kliknutím na stav, opravu, zařízení nebo měsíc zúžíte výběr. Tabulka jde exportovat do CSV; v Nastavení → Komunikace si pošlete měsíční report e-mailem.", selector: sel("statistics-view-charts"), icon: "statistics" },
    ],
  },
  {
    id: "faktury",
    nazev: "Faktury",
    popis: "Vystavení faktury ze zakázky, číselné řady, export do účetnictví.",
    page: "invoices",
    dostupny: (k) => !!k.stranky.invoices,
    kroky: [
      { page: "invoices", title: "Faktury", description: "Faktura vzniká z detailu zakázky jedním tlačítkem s položkami a DPH podle nastavení servisu. Tady je přehled, stav úhrady a export.", selector: sel("page-invoices"), icon: "doc" },
    ],
  },
  {
    id: "sms",
    nazev: "SMS chaty",
    popis: "Zprávy zákazníkům z aplikace a odpovědi v jednom vlákně.",
    page: "sms",
    dostupny: (k) => !!k.stranky.sms,
    kroky: [
      { page: "sms", title: "SMS chaty", description: "Zprávy odcházejí z čísla servisu, odpovědi přijdou sem i do detailu zakázky. Šablony a automatické zprávy při změně stavu nastavíte v Nastavení → Komunikace.", selector: sel("page-sms"), icon: "orders" },
    ],
  },
  {
    id: "zasilky",
    nazev: "Zásilky mezi pobočkami",
    popis: "Přesun zakázek mezi pobočkami se sledováním, kde zakázka právě je.",
    page: "zasilky",
    dostupny: (k) => !!k.stranky.zasilky,
    kroky: [
      { page: "zasilky", title: "Zásilky", description: "Zakázky přidáte do zásilky na jinou pobočku, ta ji převezme a zakázka změní pobočku. V detailu zakázky vidíte, kde právě je.", selector: sel("page-zasilky"), icon: "orders" },
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
    kroky: [{ page: "settings", title: "JobiDocs a tisk", description: "Zakázkový list, záruční list, protokoly a faktury se tisknou přes JobiDocs. Tady zapnete automatický tisk při příjmu a vydání a vyberete šablony.", selector: sel("settings-content"), settingsSection: nast("documents", "orders_tisk_dokumentu"), icon: "jobidocs" }],
  },
  {
    id: "nastaveni-automatizace",
    nazev: "Automatizace",
    popis: "Co se stane samo při změně stavu.",
    page: "settings",
    settingsSubsection: "communication_automations",
    dostupny: (k) => k.admin,
    kroky: [{ page: "settings", title: "Automatizace", description: "Při přepnutí do stavu poslat SMS, přepnout další stav po čase nebo upozornit tým. Každé pravidlo má podmínku a akci.", selector: sel("settings-content"), settingsSection: nast("communication", "communication_automations"), icon: "settings" }],
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
    kroky: [{ page: "settings", title: "Tým a oprávnění", description: "Pozvěte kolegy e-mailem, nastavte roli a jednotlivá práva (měnit stav, vidět statistiky, spravovat dokumenty). Člena jde omezit na pobočky.", selector: sel("settings-content"), settingsSection: nast("people", "service_team"), icon: "team" }],
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
