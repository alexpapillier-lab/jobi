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
/** Krok v podsekci Nastavení: stránka a podsekce, kterou má průvodce otevřít. */
const ns = (category: string, subsection: string) => ({ page: "settings" as const, settingsSection: nast(category, subsection) });

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
  { page: "settings", title: "Průvodci a novinky", description: "Seznam všech průvodců a novinek je v Nastavení → Nápověda a podpora; otazník v postranním panelu nabídne průvodce k místu, kde právě jste. Když se vám zpřístupní nová funkce, aplikace vám to po přihlášení sama řekne.", selector: sel("settings-sub-about_help"), settingsSection: nast("app", "about_help"), icon: "settings" },
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
      { page: "dnes", title: "K čemu to je", description: "Co je potřeba dnes vyřešit, bez hledání a filtrů. Každá karta má počet v hlavičce; kliknutím na řádek otevřete detail zakázky a po zavření jste zpátky tady.", selector: sel("sidebar-nav-dnes"), icon: "orders" },
      { page: "dnes", title: "Vyberte Jen moje, nebo Celý tým", description: "Jen moje zúží všechny karty na zakázky přidělené vám; Celý tým ukáže všechno i se jménem technika. Když servis techniky nepřiděluje, přepínač tu není.", selector: sel("dnes-rozsah"), icon: "team" },
      { page: "dnes", title: "Začněte zakázkami po termínu", description: "Podle pole Předpokládaný termín dokončení; nejdéle po termínu je nahoře. Klikněte na zakázku a posuňte termín, nebo ji dodělejte.", selector: sel("dnes-po-terminu"), icon: "orders" },
      { page: "dnes", title: "Vyřiďte rezervace na dnes", description: "Zákazníci objednaní přes formulář na webu. Kliknutím rovnou založíte zakázku s údaji z rezervace.", selector: sel("dnes-rezervace"), icon: "customers" },
      { page: "dnes", title: "Připraveno k převzetí", description: "Hotové zakázky, pro které si zákazník může přijít; nahoře ty, které leží nejdéle. Zavolejte nebo pošlete SMS z detailu.", selector: sel("dnes-k-prevzeti"), icon: "orders" },
      { page: "dnes", title: "Čeká na díl a na zákazníka", description: "Na díl čeká zakázka s objednaným dílem, který ještě nedorazil. Na zákazníka čeká odeslaná cenová nabídka bez odpovědi.", selector: sel("dnes-dil"), icon: "inventory" },
      { page: "settings", title: "Hotovo – začínejte na Dnes", description: "Tady vyberte Dnes a aplikace se po přihlášení bude otevírat na přehledu dne. Výchozí klávesová zkratka je T.", selector: sel("settings-po-prihlaseni"), settingsSection: nast("app", "appearance_ui"), icon: "settings" },
    ],
  },
  {
    id: "zakazky",
    nazev: "Přehled zakázek",
    popis: "Hledání, skupiny, filtr podle stavu, nová zakázka a reklamace.",
    page: "orders",
    kroky: [
      { page: "orders", title: "K čemu to je", description: "Seznam všech zakázek servisu. Odsud zakládáte nové, hledáte staré a přepínáte stav; podrobnosti jsou v detailu zakázky.", selector: sel("sidebar-nav-orders"), icon: "orders" },
      { page: "orders", title: "Hledání", description: "Napište jméno, telefon, zařízení, číslo zakázky nebo text z poznámky – seznam se filtruje hned při psaní. Křížkem nebo Esc hledání zrušíte.", selector: sel("orders-search"), icon: "orders" },
      { page: "orders", title: "Skupiny zakázek", description: "Klikněte na Vše, Aktivní (rozpracované), Dokončené nebo Reklamace. S přidělováním je tu i Moje, s pobočkami Přesuny.", selector: sel("orders-groups"), icon: "orders" },
      { page: "orders", title: "Filtr podle stavu", description: "Rozbalte a vyberte stav – nabízí jen stavy, které ve skupině jsou, i s počtem zakázek.", selector: sel("orders-status-filter"), icon: "orders" },
      { page: "orders", title: "Nová zakázka", description: "Klikněte na + Nová zakázka a vyplňte zákazníka, zařízení a požadovanou opravu. Krok za krokem to ukáže průvodce Přijmout zakázku.", selector: sel("orders-new-btn"), icon: "orders" },
      { page: "orders", title: "Nová reklamace", description: "Otevře se příjem reklamace jako u zakázky: vyberte původní zakázku a Jobi převezme zákazníka i zařízení a ukáže, jestli je v záruce. Reklamaci založíte i z detailu hotové zakázky přes nabídku „…“ (průvodce Přijmout reklamaci).", selector: sel("orders-new-claim-btn"), icon: "reklamace" },
      { page: "orders", title: "Hotovo – pracujte v seznamu", description: "Stav zakázky přepnete přímo v řádku, kliknutím otevřete detail s opravami, cenami, fotkami, tiskem a SMS (průvodce Detail zakázky).", selector: sel("orders-list"), icon: "orders" },
    ],
  },
  {
    id: "nova-zakazka",
    nazev: "Přijmout zakázku",
    popis: "Zákazník podle telefonu, zařízení, požadovaná oprava, opravy z ceníku a vytvoření zakázky.",
    page: "orders",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "orders", title: "K čemu to je", description: "Příjem zařízení od zákazníka: kdo ho přinesl, co to je a co je potřeba opravit. Zabere minutu a rozpracované údaje se ukládají samy.", selector: sel("sidebar-nav-orders"), icon: "orders" },
      { page: "orders", title: "Klikněte na + Nová zakázka", description: "Otevře se formulář příjmu. Stejně funguje plovoucí tlačítko + vpravo dole.", selector: sel("orders-new-btn"), icon: "orders" },
      { page: "orders", title: "Napište telefon zákazníka", description: "Když zákazník už u vás byl, Jobi ho podle čísla najde a nabídne – potvrďte ho a údaje se doplní. Nový zákazník vznikne sám s touto zakázkou.", selector: sel("nova-telefon"), klik: ["orders-new-btn"], icon: "customers" },
      { page: "orders", title: "Doplňte jméno a kontakty", description: "Jméno, e-mail a případně firmu a adresu pro doklady. Co nevíte, nechte prázdné.", selector: sel("nova-zakaznik"), klik: ["orders-new-btn"], icon: "customers" },
      { page: "orders", title: "Vyberte zařízení", description: "Začněte psát model a vyberte ho z nabídky ceníku, nebo napište vlastní název. Pod ním vyplňte IMEI nebo sériové číslo a kód k odemčení.", selector: sel("nova-zarizeni"), klik: ["orders-new-btn"], icon: "devices" },
      { page: "orders", title: "Napište požadovanou opravu", description: "Co zákazník chce opravit. Opravy z ceníku pod polem zaškrtnete kliknutím a cena se sečte; jinou opravu přidáte s vlastní cenou a sleva jde vybrat hned tady.", selector: sel("nova-pozadovana-oprava"), klik: ["orders-new-btn"], icon: "orders" },
      { page: "orders", title: "Klikněte na Vytvořit zakázku", description: "Zakázka dostane číslo a první stav; se zapnutým automatickým tiskem se nabídne zakázkový list. ⌘/Ctrl+Enter udělá totéž, Zrušit rozpracovaný příjem zahodí.", selector: sel("nova-vytvorit"), klik: ["orders-new-btn"], icon: "orders" },
      { page: "orders", title: "Hotovo", description: "Nová zakázka je nahoře v seznamu. Kliknutím otevřete detail – přidáte opravy s cenou, fotky a diagnostiku (průvodce Detail zakázky).", selector: sel("orders-list"), icon: "orders" },
    ],
  },
  {
    id: "nova-reklamace",
    nazev: "Přijmout reklamaci",
    popis: "Zdrojová zakázka a záruka, reklamované opravy, zákazník, zařízení, popis závady, termín vyřízení a přijímací fotky.",
    page: "orders",
    novinkaOd: "2026-10-06",
    kroky: [
      { page: "orders", title: "K čemu to je", description: "Příjem reklamace vypadá jako příjem zakázky: vyplníte, co je potřeba na protokol o přijetí reklamace, a rozepsané údaje se ukládají samy.", selector: sel("orders-new-claim-btn"), icon: "reklamace" },
      { page: "orders", title: "Vyberte zdrojovou zakázku", description: "Napište kód, jméno, SN nebo telefon a klikněte na zakázku. Jobi ukáže, jestli je oprava v záruce; po záruce nabídne Založit placenou opravu. Zaškrtněte opravy, které zákazník reklamuje. Oprava odjinud: Reklamace bez propojení na zakázku.", selector: sel("nova-reklamace-zdroj"), klik: ["orders-new-claim-btn"], icon: "reklamace" },
      { page: "orders", title: "Zkontrolujte zákazníka", description: "Ze zakázky se převezme sám; bez zakázky začněte psát jméno a existující zákazníky nabídneme. Telefon je povinný, pokud to máte v Nastavení → Zakázky → Povinná pole.", selector: sel("nova-reklamace-zakaznik"), klik: ["orders-new-claim-btn"], icon: "customers" },
      { page: "orders", title: "Zařízení, stav a příslušenství", description: "Zařízení a SN přijdou ze zakázky. Stav zařízení a příslušenství zapište podle toho, jak ho zákazník přinesl teď, a vyberte způsob převzetí.", selector: sel("nova-reklamace-zarizeni"), klik: ["orders-new-claim-btn"], icon: "devices" },
      { page: "orders", title: "Popište reklamovanou závadu", description: "Co zákazník reklamuje – bez popisu reklamaci nejde založit. Termín vyřízení je ze zákona do 30 dnů od přijetí; když ho nevyplníte, uloží se právě tahle lhůta.", selector: sel("nova-reklamace-zavada"), klik: ["orders-new-claim-btn"], icon: "reklamace" },
      { page: "orders", title: "Přidejte přijímací fotky", description: "Nahrajte fotky z počítače, nebo je nafoťte telefonem přes QR kód. Připojí se k reklamaci po jejím vytvoření.", selector: sel("nova-reklamace-fotky"), klik: ["orders-new-claim-btn"], icon: "reklamace" },
      { page: "orders", title: "Klikněte na Vytvořit reklamaci", description: "Reklamace dostane číslo R… a stav Přijato a otevře se její detail. Se zapnutým automatickým tiskem se vytiskne protokol o přijetí reklamace, jinak ho vytisknete z detailu. Zrušit rozepsanou reklamaci zahodí.", selector: sel("nova-reklamace-vytvorit"), klik: ["orders-new-claim-btn"], icon: "reklamace" },
    ],
  },
  {
    id: "detail-reklamace",
    nazev: "Detail reklamace",
    popis: "Stav reklamace, protokol o přijetí a převod na zakázku, když nejde o reklamaci.",
    page: "orders",
    novinkaOd: "2026-10-06",
    kroky: [
      { page: "orders", title: "K čemu to je", description: "V detailu reklamace zapisujete diagnostiku a zákroky, přepínáte stav a tisknete protokoly. Otevřete ji ze skupiny Reklamace v seznamu.", selector: sel("orders-groups"), icon: "reklamace" },
      { page: "orders", title: "Přepněte stav", description: "Klikněte na stav vedle čísla reklamace a vyberte nový. Koncový stav reklamaci uzavře.", selector: sel("reklamace-stav"), icon: "reklamace" },
      { page: "orders", title: "Vytiskněte protokol", description: "Tisk → Přijetí reklamace vytiskne nebo uloží protokol o přijetí reklamace pro zákazníka.", selector: sel("reklamace-tisk"), icon: "doc" },
      { page: "orders", title: "Není to reklamace", description: "Když se ukáže, že závadu záruka nekryje, klikněte na Není to reklamace: vznikne běžná zakázka (Přijato) se zákazníkem, zařízením, popisem, fotkami a diagnostikou a reklamace se uzavře stavem Převedeno na zakázku. Jde to jen jednou a jen u neuzavřené reklamace.", selector: sel("reklamace-prevest"), icon: "orders" },
    ],
  },
  {
    id: "detail-zakazky",
    nazev: "Detail zakázky",
    popis: "Stav, opravy s cenami, diagnostika, SMS a tisk – na ukázkové zakázce.",
    page: "orders",
    novinkaOd: "2026-09-27",
    kroky: [
      { page: "orders", title: "K čemu to je", description: "V detailu se s opravou pracuje: stav, opravy s cenou, diagnostika, fotky, tisk a zprávy zákazníkovi. Otevíráme ukázkovou (nebo poslední) zakázku.", selector: sel("detail-stav"), akce: "otevrit-ukazkovou-zakazku", icon: "orders" },
      { page: "orders", title: "Přepněte stav", description: "Klikněte na stav a vyberte nový, třeba V opravě. Koncový stav zakázku vydá: odepíší se díly a zapíše datum vydání pro Statistiky.", selector: sel("detail-stav"), icon: "orders" },
      { page: "orders", title: "Klikněte na Upravit", description: "Změníte zákazníka, zařízení i požadovanou opravu. Má-li zakázku otevřenou i kolega, ukáže se vedle jeho jméno; kdo uloží druhý, vybere, čí změny platí.", selector: sel("detail-upravit"), icon: "orders" },
      { page: "orders", title: "Zapište provedené opravy", description: "Opravy z ceníku nebo ručně, každá s cenou, náklady a díly ze skladu; sleva se uplatní na celek. Součet je konečná cena pro zákazníka i pro doklad.", selector: sel("detail-opravy"), icon: "orders" },
      { page: "orders", title: "Diagnostika a fotky", description: "Napište, co jste zjistili, a přidejte fotky před a po opravě (z počítače, nebo z telefonu přes QR kód). Jde to na protokol a do portálu zákazníka.", selector: sel("detail-diagnostika"), icon: "orders" },
      { page: "orders", title: "Napište zákazníkovi SMS", description: "Klikněte na SMS – zpráva odejde z aplikace a odpověď se vrátí sem. Automatické SMS při změně stavu nastavíte v Automatizaci.", selector: sel("detail-sms"), icon: "orders" },
      { page: "orders", title: "Vytiskněte dokument", description: "Klikněte na Tisk a vyberte zakázkový list (při příjmu), záruční list nebo protokol (při vydání).", selector: sel("detail-tisk"), icon: "doc" },
      { page: "orders", title: "Hotovo – vydejte zakázku", description: "Až si zákazník přijde, přepněte stav do koncového (Vydáno) a vytiskněte záruční list. Zakázka se přesune mezi Dokončené.", selector: sel("detail-stav"), icon: "orders" },
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
      { page: "statistics", title: "Exporty", description: "V Tabulce jsou jednotlivé zakázky období a Export CSV je uloží pro Excel nebo účetní. Export pro AI stáhne všechny statistiky období do jednoho souboru (text nebo JSON), který vložíte do ChatGPT či Claude a zeptáte se, co zlepšit – je anonymní, bez jmen a kontaktů zákazníků.", selector: sel("statistics-export-ai"), icon: "statistics" },
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
    popis: "Název, IČO, adresa a zkratka pro čísla zakázek; telefon, e-mail a účet na dokumenty.",
    page: "settings",
    settingsSubsection: "service_basic",
    kroky: [
      { ...ns("company", "service_basic"), title: "K čemu to je", description: "Údaje servisu se tisknou v hlavičce zakázkového listu a faktury a ze zkratky se skládá číslo zakázky. Vyplňte je před prvním tiskem.", selector: sel("settings-sub-service_basic"), icon: "settings" },
      { ...ns("company", "service_basic"), title: "Napište zkratku servisu", description: "Dvě až čtyři písmena, třeba SRV – čísla zakázek pak budou SRV26000001. Nastavte ji dřív, než vytisknete první doklad.", selector: sel("settings-firma-zkratka"), icon: "settings" },
      { ...ns("company", "service_basic"), title: "Napište název firmy", description: "Tak, jak má být na dokladech – obchodní firma nebo jméno živnostníka.", selector: sel("settings-firma-nazev"), icon: "settings" },
      { ...ns("company", "service_basic"), title: "Doplňte IČO a DIČ", description: "IČO je na dokladech povinné; DIČ vyplňte, jen když jste plátce DPH.", selector: sel("settings-firma-ico"), icon: "settings" },
      { ...ns("company", "service_basic"), title: "Vyplňte adresu", description: "Ulice, město a PSČ sídla nebo provozovny. Tiskne se v hlavičce dokladů.", selector: sel("settings-firma-adresa"), icon: "settings" },
      { ...ns("company", "service_basic"), title: "Klikněte na Uložit", description: "Jakmile něco změníte, dole se objeví lišta Neuložené změny – klikněte na Uložit (nebo ⌘/Ctrl+S). Zahodit vrátí původní údaje.", selector: sel("settings-ulozit"), icon: "settings" },
      { ...ns("company", "service_contact"), title: "Doplňte kontakty a účet", description: "Telefon a e-mail uvidí zákazník na dokladech i v odkazu na stav zakázky; číslo účtu a IBAN jdou na fakturu. Uložte stejně lištou dole.", selector: sel("settings-kontakty"), icon: "settings" },
      { ...ns("company", "service_contact"), title: "Hotovo", description: "Nové doklady už ponesou vaše údaje a nové zakázky vaši zkratku. Vzhled dokladů (logo, razítko) upravíte v JobiDocs – průvodce JobiDocs a tisk.", selector: sel("settings-sub-service_contact"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-statusy",
    nazev: "Statusy zakázek",
    popis: "Vlastní stavy, barvy, pořadí a koncové stavy.",
    page: "settings",
    settingsSubsection: "orders_statuses",
    kroky: [
      { ...ns("orders", "orders_statuses"), title: "K čemu to je", description: "Stav říká, kde zakázka je (Přijato, V opravě, Čeká na díl, Vydáno). Pojmenujte si stavy po svém; koncový stav zakázku uzavírá.", selector: sel("settings-sub-orders_statuses"), icon: "settings" },
      { ...ns("orders", "orders_statuses"), title: "Napište název stavu", description: "Tak, jak ho uvidí tým v zakázce i zákazník v odkazu na stav – třeba „Čeká na díl“.", selector: sel("settings-status-nazev"), icon: "settings" },
      { ...ns("orders", "orders_statuses"), title: "Vyberte barvu", description: "Klikněte na barvu v paletě, nebo zadejte vlastní pozadí a text. Náhled je vedle tlačítka Přidat.", selector: sel("settings-status-barva"), icon: "settings" },
      { ...ns("orders", "orders_statuses"), title: "Zaškrtněte, jestli je finální", description: "U stavů, které zakázku uzavírají (Vydáno, Vráceno bez opravy). Přepnutím do nich se odepíšou díly a zapíše datum vydání pro Statistiky a odměny.", selector: sel("settings-status-finalni"), icon: "settings" },
      { ...ns("orders", "orders_statuses"), title: "Klikněte na Přidat", description: "Stav se uloží a objeví v seznamu pod formulářem. U existujícího stavu tu je Aktualizovat.", selector: sel("settings-status-pridat"), icon: "settings" },
      { ...ns("orders", "orders_statuses"), title: "Seřaďte a upravte stavy", description: "Šipkami posunete stav výš nebo níž – v tomhle pořadí se nabízí v zakázce. Upravit ho načte nahoru do formuláře; výchozí stav smazat nejde.", selector: sel("settings-statusy-seznam"), icon: "settings" },
      { ...ns("orders", "orders_statuses"), title: "Hotovo", description: "Nový stav se hned nabízí v přepínači stavu u každé zakázky. Automatickou SMS nebo tisk při přepnutí do stavu nastavíte v Automatizaci a v JobiDocs a tisk.", selector: sel("sidebar-nav-orders"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-povinna-pole",
    nazev: "Povinná pole",
    popis: "Co musí být vyplněné při příjmu.",
    page: "settings",
    settingsSubsection: "orders_required_fields",
    kroky: [
      { ...ns("orders", "orders_required_fields"), title: "K čemu to je", description: "Určíte, bez čeho nejde zakázku uložit – aby se k zákazníkovi dalo dovolat.", selector: sel("settings-sub-orders_required_fields"), icon: "settings" },
      { ...ns("orders", "orders_required_fields"), title: "Zaškrtněte Telefon zákazníka povinný", description: "Zapnuté: příjem bez telefonu neuloží. Vypnuté: telefon zůstane nepovinný. Ukládá se hned po kliknutí.", selector: sel("settings-povinny-telefon"), icon: "settings" },
      { ...ns("orders", "orders_required_fields"), title: "Hotovo", description: "Platí pro novou zakázku i úpravu. Vyzkoušejte to tlačítkem Nová zakázka v Zakázkách.", selector: sel("sidebar-nav-orders"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-detail",
    nazev: "Nastavení detailu zakázky",
    popis: "Které sekce v detailu vidíte a jestli se přiděluje technik.",
    page: "settings",
    settingsSubsection: "orders_detail",
    kroky: [
      { ...ns("orders", "orders_detail"), title: "K čemu to je", description: "Detail zakázky bude kratší, když schováte sekce, které nepoužíváte. Platí pro všechny v servisu.", selector: sel("settings-sub-orders_detail"), icon: "settings" },
      { ...ns("orders", "orders_detail"), title: "Odškrtněte sekce, které nepotřebujete", description: "Každé zaškrtávátko je jedna karta v detailu zakázky (portál zákazníka, náhradní zařízení, kontrola po opravě…). Ukládá se hned.", selector: sel("settings-detail-sekce"), icon: "settings" },
      { ...ns("orders", "orders_detail"), title: "Zapněte přidělování technika", description: "Zaškrtnutím Technik se v detailu objeví karta Technik („Přidělit mně“), v přehledu skupina Moje a na kartě zakázky jméno technika.", selector: sel("settings-detail-technik"), icon: "team" },
      { ...ns("orders", "orders_detail"), title: "Hotovo", description: "Otevřete libovolnou zakázku – vypnuté sekce v detailu nejsou. Zapnout je jde kdykoli zpátky, data v nich zůstávají.", selector: sel("sidebar-nav-orders"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-slevy",
    nazev: "Slevy",
    popis: "Přednastavené slevy na jedno kliknutí.",
    page: "settings",
    settingsSubsection: "orders_slevy",
    kroky: [
      { ...ns("orders", "orders_slevy"), title: "K čemu to je", description: "Slevy, které dáváte často (stálý zákazník, dlouhé čekání), se v zakázce dají jedním klepnutím místo vypisování.", selector: sel("settings-sub-orders_slevy"), icon: "settings" },
      { ...ns("orders", "orders_slevy"), title: "Vyplňte novou slevu", description: "Vyberte Procenta nebo Kč, napište hodnotu a popisek, třeba „Stálý zákazník“.", selector: sel("settings-slevy-nova"), icon: "settings" },
      { ...ns("orders", "orders_slevy"), title: "Klikněte na Přidat", description: "Sleva se uloží a objeví nad řádkem. Hodnotu nebo popisek u ní přepíšete přímo v řádku, Smazat ji odebere.", selector: sel("settings-slevy-pridat"), icon: "settings" },
      { ...ns("orders", "orders_slevy"), title: "Hotovo", description: "V detailu zakázky se u ceny oprav ukáže jako tlačítko. Ruční zadání slevy zůstává.", selector: sel("settings-slevy-prvni"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-prace",
    nazev: "Hodinová práce",
    popis: "Sazba a stopky na zakázce.",
    page: "settings",
    settingsSubsection: "orders_prace",
    kroky: [
      { ...ns("orders", "orders_prace"), title: "K čemu to je", description: "Opravu, která nemá pevnou cenu, účtujete jako hodiny × sazba. Stopky na zakázce změří, kolik času technik strávil.", selector: sel("settings-sub-orders_prace"), icon: "settings" },
      { ...ns("orders", "orders_prace"), title: "Napište výchozí sazbu", description: "Kč za hodinu; uloží se po opuštění pole. V zakázce se předvyplní u každé hodinové práce a jde přepsat.", selector: sel("settings-prace-sazba"), icon: "settings" },
      { ...ns("orders", "orders_prace"), title: "Zapněte stopky", description: "V detailu zakázky přibude karta Čas na opravě: technik spustí a zastaví práci. Odpracovaný čas jde do KPI techniků ve Statistikách.", selector: sel("settings-prace-stopky"), icon: "settings" },
      { ...ns("orders", "orders_prace"), title: "Vyberte zaokrouhlení", description: "Když se naměřený čas přidá do zakázky jako práce, zaokrouhlí se nahoru na započatý krok (třeba 15 min). Volba je vidět se zapnutými stopkami.", selector: sel("settings-prace-zaokrouhleni"), icon: "settings" },
      { ...ns("orders", "orders_prace"), title: "Hotovo", description: "V detailu zakázky u oprav přidáte Hodinovou práci; na fakturu jde jako hodiny × Kč/h.", selector: sel("sidebar-nav-orders"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-reklamace",
    nazev: "Reklamace a záruka na opravu",
    popis: "Do kdy platí záruka na opravu a jak se reklamace ukazují v seznamu.",
    page: "settings",
    settingsSubsection: "orders_reklamace",
    novinkaOd: "2026-09-27",
    kroky: [
      { ...ns("orders", "orders_reklamace"), title: "K čemu to je", description: "Při vydání se na zakázku zapíše „Záruka na opravu do …“. Při reklamaci pak Jobi hned ukáže, jestli je v záruce, a po záruce nabídne placenou opravu.", selector: sel("settings-zaruka-opravy"), icon: "settings" },
      { ...ns("orders", "orders_reklamace"), title: "Záruka pro spotřebitele", description: "Počet měsíců pro zákazníka bez IČO – zákonná lhůta je 24. Uloží se po opuštění pole.", selector: sel("settings-zaruka-spotrebitel"), icon: "settings" },
      { ...ns("orders", "orders_reklamace"), title: "Záruka pro firmu", description: "Počet měsíců pro zákazníka s IČO, obvykle 12; 0 = bez záruky. Oprava v ceníku může mít vlastní délku (Zařízení → oprava → Záruka).", selector: sel("settings-zaruka-firma"), icon: "settings" },
      { ...ns("orders", "orders_reklamace"), title: "Reklamace v seznamu", description: "Aktivní reklamace jsou v Zakázkách vždy pod zakázkami. Zaškrtnutím je uvidíte i ve skupinách Vše a Dokončené.", selector: sel("settings-reklamace-v-seznamu"), icon: "reklamace" },
      { ...ns("orders", "orders_reklamace"), title: "Hotovo", description: "Záruka se zapisuje při vydání zakázky podle nejdelší záruky z provedených oprav. Reklamaci založíte tlačítkem Nová reklamace v Zakázkách.", selector: sel("sidebar-nav-orders"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-kontrola",
    nazev: "Kontrola po opravě",
    popis: "Kontrolní seznamy před vydáním.",
    page: "settings",
    settingsSubsection: "orders_kontrola",
    kroky: [
      { ...ns("orders", "orders_kontrola"), title: "K čemu to je", description: "Seznam toho, co technik ověří před předáním (displej, nabíjení, kamera…). Šablona se v zakázce vybere sama podle názvu zařízení a výsledek jde do protokolu.", selector: sel("settings-sub-orders_kontrola"), icon: "settings" },
      { ...ns("orders", "orders_kontrola"), title: "Klikněte na + Šablona", description: "Přidá novou šablonu a rovnou ji rozbalí. Stávající šablonu rozbalíte kliknutím na její název.", selector: sel("settings-kontrola-nova"), icon: "settings" },
      { ...ns("orders", "orders_kontrola"), title: "Vyplňte šablonu", description: "Název, klíčová slova z názvu zařízení (iphone, samsung…) a položky, každou na vlastní řádek. Šablona bez klíčových slov je obecná záloha; ukládá se po opuštění pole.", selector: sel("settings-kontrola-editor"), klik: ["settings-kontrola-prvni"], icon: "settings" },
      { ...ns("orders", "orders_kontrola"), title: "Hotovo", description: "V detailu zakázky technik odškrtá položky v kartě Kontrola po opravě. Obnovit výchozí šablony vrátí původní sadu.", selector: sel("settings-kontrola-obnovit"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-nahradni",
    nazev: "Náhradní zařízení",
    popis: "Zápůjčky zákazníkům po dobu opravy.",
    page: "settings",
    settingsSubsection: "orders_nahradni",
    kroky: [
      { ...ns("orders", "orders_nahradni"), title: "K čemu to je", description: "Seznam telefonů a zařízení, které půjčujete zákazníkům na dobu opravy. V zakázce se vybere ze seznamu a je vidět, u koho právě je.", selector: sel("settings-sub-orders_nahradni"), icon: "settings" },
      { ...ns("orders", "orders_nahradni"), title: "Vyplňte zařízení", description: "Název (třeba „iPhone SE, černý“), sériové číslo nebo IMEI, příslušenství a kauci. S pobočkami vyberte, kde zařízení fyzicky je.", selector: sel("settings-nahradni-nove"), icon: "settings" },
      { ...ns("orders", "orders_nahradni"), title: "Klikněte na Přidat", description: "Zařízení se uloží do seznamu; údaje v řádku přepíšete přímo, Smazat ho odebere.", selector: sel("settings-nahradni-pridat"), icon: "settings" },
      { ...ns("orders", "orders_nahradni"), title: "Hotovo", description: "V detailu zakázky v kartě Náhradní zařízení vyberete zařízení ze seznamu a vyplní se formulář zápůjčky.", selector: sel("settings-nahradni-prvni"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-rezervace",
    nazev: "Online rezervace",
    popis: "Formulář na webu, ze kterého vznikne zakázka.",
    page: "settings",
    settingsSubsection: "orders_rezervace",
    kroky: [
      { ...ns("orders", "orders_rezervace"), title: "K čemu to je", description: "Formulář na váš web: zákazník vybere termín a napíše, co potřebuje opravit. Rezervace přistane v Kalendáři a jedním kliknutím z ní založíte zakázku.", selector: sel("settings-sub-orders_rezervace"), icon: "settings" },
      { ...ns("orders", "orders_rezervace"), title: "Zaškrtněte Přijímat rezervace z webu", description: "Rozbalí se další nastavení. Vypnutím formulář přestane rezervace přijímat.", selector: sel("settings-rezervace-zapnout"), icon: "settings" },
      { ...ns("orders", "orders_rezervace"), title: "Nastavte adresu servisu", description: "Krátký název bez mezer (třeba „servis-brno“) a klikněte na Uložit adresu. Bez ní formulář nefunguje.", selector: sel("settings-rezervace-adresa"), icon: "settings" },
      { ...ns("orders", "orders_rezervace"), title: "Vyberte otevírací dny", description: "Kliknutím zapnete nebo vypnete den, kdy se dá objednat.", selector: sel("settings-rezervace-dny"), icon: "settings" },
      { ...ns("orders", "orders_rezervace"), title: "Nastavte hodiny a krok", description: "Od–do a po kolika minutách se termíny nabízejí (15, 30, 60). Čas se uloží po opuštění pole.", selector: sel("settings-rezervace-hodiny"), icon: "settings" },
      { ...ns("orders", "orders_rezervace"), title: "Vložte kód na web", description: "Klikněte na Kopírovat kód a pošlete ho webaři, nebo ho vložte do stránky sami tam, kde má formulář být.", selector: sel("settings-rezervace-kod"), icon: "settings" },
      { ...ns("orders", "orders_rezervace"), title: "Hotovo", description: "Nová rezervace se ukáže nahoře v Kalendáři; na e-mail firmy přijde upozornění a zákazník dostane potvrzení.", selector: sel("sidebar-nav-calendar"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-tisk",
    nazev: "JobiDocs a tisk",
    popis: "Dokumenty, šablony a automatický tisk.",
    page: "settings",
    settingsSubsection: "orders_tisk_dokumentu",
    kroky: [
      { ...ns("documents", "orders_tisk_dokumentu"), title: "K čemu to je", description: "Zakázkový list, záruční list a protokoly se tisknou jedním kliknutím. Tady určíte, kdy se tisk nabídne sám; vzhled dokumentů je v JobiDocs.", selector: sel("settings-sub-orders_tisk_dokumentu"), icon: "jobidocs" },
      { ...ns("documents", "orders_tisk_dokumentu"), title: "Otevřete JobiDocs", description: "Na desktopu klikněte na tlačítko JobiDocs – upravíte v něm rozvržení, logo, razítko a vlastní texty. Tečka vedle ukazuje, jestli je připojené; na webu se tiskne z prohlížeče.", selector: sel("settings-tisk-jobidocs"), icon: "jobidocs" },
      { ...ns("documents", "orders_tisk_dokumentu"), title: "Zapněte automatický tisk", description: "Zaškrtněte Tisknout při vytvoření zakázky, nebo vyberte stav, při jehož přepnutí se dialog tisku otevře sám. Zvlášť pro zakázkový a záruční list; ukládá se hned.", selector: sel("settings-tisk-automaticky"), icon: "jobidocs" },
      { ...ns("documents", "orders_tisk_dokumentu"), title: "Tisk u reklamací", description: "Protokol o přijetí reklamace se může tisknout při jejím vytvoření nebo přepnutí do stavu, protokol o vydání při přepnutí do stavu, který vyberete.", selector: sel("settings-tisk-reklamace"), icon: "doc" },
      { ...ns("documents", "orders_tisk_dokumentu"), title: "Hotovo", description: "Při dalším příjmu nebo přepnutí stavu se tisk nabídne sám. Ručně tisknete v detailu zakázky tlačítkem Tisk.", selector: sel("settings-tisk-automaticky"), icon: "jobidocs" },
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
      { ...ns("communication", "communication_automations"), title: "K čemu to je", description: "Jobi za vás pošle SMS nebo e-mail, přepne stav, připíše poplatek (třeba skladné za den) nebo zapíše poznámku – když se něco stane se zakázkou.", selector: sel("settings-sub-communication_automations"), icon: "settings" },
      { ...ns("communication", "communication_automations"), title: "Klikněte na Nové pravidlo", description: "V okně vyberte spouštěč (přepnutí do stavu, zakázka ve stavu déle než N dní, založení, událost z portálu), podmínky a akci a klikněte na Uložit.", selector: sel("settings-automations-nove"), icon: "settings" },
      { ...ns("communication", "communication_automations"), title: "Zkontrolujte pořadí pravidel", description: "Pravidla se vyhodnocují shora dolů; šipkami je přeskládáte, zaškrtávátkem dočasně vypnete, Upravit otevře okno znovu. Prázdný seznam nabídne hotové šablony.", selector: sel("settings-automations-pravidla"), icon: "settings" },
      { ...ns("communication", "communication_automations"), title: "Zapněte žádost o recenzi", description: "Vložte odkaz na své recenze (Google, Firmy.cz) a zapněte: den po vydání dostane zákazník SMS s poděkováním a odkazem, stejný zákazník nejvýš jednou za 90 dní.", selector: sel("automatizace-recenze"), icon: "settings" },
      { ...ns("communication", "communication_automations"), title: "Hotovo – sledujte historii", description: "Posledních 50 spuštění s výsledkem: tady zjistíte, proč SMS neodešla nebo se stav nepřepnul. Obnovuje se sama každou minutu.", selector: sel("settings-automations-historie"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-chat",
    nazev: "Chat týmu",
    popis: "Kanály servisu a poboček, soukromé zprávy, zmínky.",
    page: "settings",
    settingsSubsection: "communication_chat",
    dostupny: (k) => k.admin,
    kroky: [
      { ...ns("communication", "communication_chat"), title: "K čemu to je", description: "Zprávy v týmu bez opuštění aplikace: kanál servisu, kanál pobočky a soukromé zprávy. Zmínka #číslo zakázky otevře její detail.", selector: sel("settings-sub-communication_chat"), icon: "team" },
      { ...ns("communication", "communication_chat"), title: "Zaškrtněte Chat zapnutý", description: "Vpravo dole se všem ukáže bublina s počtem nepřečtených zpráv. Vypnutím chat schováte, zprávy zůstanou uložené.", selector: sel("settings-chat-zapnuty"), icon: "team" },
      { ...ns("communication", "communication_chat"), title: "Hotovo", description: "Zvuk a upozornění si každý zapne sám ikonou zvonku v panelu chatu – platí pro jeho zařízení.", selector: sel("settings-chat-upozorneni"), icon: "team" },
    ],
  },
  {
    id: "nastaveni-report",
    nazev: "Report statistik e-mailem",
    popis: "Měsíční nebo týdenní PDF s obratem, ziskem a žebříčky.",
    page: "settings",
    settingsSubsection: "communication_report",
    dostupny: (k) => k.admin,
    kroky: [
      { ...ns("communication", "communication_report"), title: "K čemu to je", description: "Jednou za měsíc nebo týden přijde e-mailem PDF se statistikami servisu – obrat, zisk, počty zakázek, nejčastější opravy. Nemusíte je chodit hledat.", selector: sel("settings-sub-communication_report"), icon: "statistics" },
      { ...ns("communication", "communication_report"), title: "Zaškrtněte Posílat report e-mailem", description: "Pod přepínačem se hned ukáže, kdy odejde první report.", selector: sel("report-zapnout"), icon: "statistics" },
      { ...ns("communication", "communication_report"), title: "Vyberte, jak často", description: "Měsíčně chodí prvního za minulý měsíc, týdně v pondělí za minulý týden. Pod tím je hodina odeslání.", selector: sel("report-frekvence"), icon: "statistics" },
      { ...ns("communication", "communication_report"), title: "Přidejte příjemce", description: "Napište e-mail a klikněte na Přidat příjemce. Křížkem u adresy ji odeberete.", selector: sel("report-prijemci"), icon: "statistics" },
      { ...ns("communication", "communication_report"), title: "Vyzkoušejte", description: "Stáhnout ukázku PDF ukáže, jak report vypadá; Poslat zkušební ho pošle jen vám.", selector: sel("report-vyzkouset"), icon: "statistics" },
      { ...ns("communication", "communication_report"), title: "Hotovo", description: "Report odejde sám podle plánu; Poslední odeslání dole ukazuje, kdy a za jaké období šel.", selector: sel("settings-sub-communication_report"), icon: "statistics" },
    ],
  },
  {
    id: "nastaveni-tym",
    nazev: "Tým a oprávnění",
    popis: "Pozvánky, role a co kdo smí.",
    page: "settings",
    settingsSubsection: "service_team",
    dostupny: (k) => k.admin,
    kroky: [
      { ...ns("people", "service_team"), title: "K čemu to je", description: "Každý kolega má vlastní účet: vidí stejné zakázky a v historii je poznat, kdo co udělal. Tady zvete členy a určujete, co smí.", selector: sel("settings-sub-service_team"), icon: "team" },
      { ...ns("people", "service_team"), title: "Rozhodněte o přidělování", description: "Zaškrtnutím zapnete kartu Technik v detailu zakázky („Přidělit mně“), skupinu Moje v přehledu a jméno technika na kartě. Servis s jedním technikem to nepotřebuje.", selector: sel("settings-team-pridelovani"), icon: "team" },
      { ...ns("people", "service_team"), title: "Klikněte na Pozvat člena", description: "V okně napište e-mail kolegy, vyberte roli (člen nebo správce) a klikněte na Pozvat. Kolik míst tarif dovoluje, je napsané nad tlačítkem.", selector: sel("settings-team-pozvat"), icon: "team" },
      { ...ns("people", "service_team"), title: "Počkejte na přijetí", description: "Kolegovi přijde e-mail s pozvánkou. Dokud ji nepřijme, je v Čekajících pozvánkách.", selector: sel("settings-team-cekajici"), icon: "team" },
      { ...ns("people", "service_team"), title: "Nastavte oprávnění", description: "U člena klikněte na Oprávnění a zaškrtněte, co smí: mazat zakázky, měnit stav, zákazníky, statistiky, nastavení… S pobočkami tu vyberete domovskou pobočku a na které pobočky vidí.", selector: sel("settings-team-clenove"), icon: "team" },
      { ...ns("people", "service_team"), title: "Hotovo", description: "Přijatý kolega je v seznamu členů a po přihlášení smí jen to, co mu povolíte. Role správce se oprávnění netýkají.", selector: sel("settings-team-clenove"), icon: "team" },
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
    kroky: [
      { ...ns("people", "service_odmeny"), title: "K čemu to je", description: "Pravidla určí, kolik tým dostane za opravy nabídnuté zákazníkovi navíc – třeba 100 Kč za servisní čištění. Když s ním zákazník přišel sám, odměna nevzniká.", selector: sel("settings-sub-service_odmeny"), icon: "team" },
      { ...ns("people", "service_odmeny"), title: "Vyplňte nové pravidlo", description: "Text, který je v názvu opravy (třeba „servisní čištění“), částka v Kč nebo procento z ceny a komu: kdo opravu přidal, nebo přidělený technik.", selector: sel("odmeny-nove-pravidlo"), icon: "team" },
      { ...ns("people", "service_odmeny"), title: "Klikněte na Přidat pravidlo", description: "Objeví se v tabulce nahoře; tam ho upravíte, vypnete zaškrtávátkem Aktivní nebo šipkami změníte pořadí.", selector: sel("odmeny-pridat-pravidlo"), icon: "team" },
      { ...ns("people", "service_odmeny"), title: "Vyzkoušejte název opravy", description: "Napište název opravy z ceníku a hned uvidíte, jestli na ni některé pravidlo sedí a kolik dává.", selector: sel("odmeny-vyzkouset"), icon: "team" },
      { ...ns("people", "service_odmeny"), title: "Ukažte Odměny týmu", description: "Zaškrtnutím Zobrazit Odměny v navigaci dostane stránku Odměny celý tým. Pod tím určíte, jestli kolegové vidí celý žebříček.", selector: sel("odmeny-v-navigaci"), icon: "team" },
      { ...ns("people", "service_odmeny"), title: "Hotovo", description: "Odměna se počítá u zakázek vydaných v měsíci, jen u opravy s příznakem Nabídnuto navíc. Přehled je na stránce Odměny.", selector: sel("settings-sub-service_odmeny"), icon: "team" },
    ],
  },
  {
    id: "nastaveni-api",
    nazev: "API a webhooky",
    popis: "Ceník, sklad a zakázky pro váš web nebo e-shop.",
    page: "settings",
    settingsSubsection: "service_api",
    dostupny: (k) => !!(k.moduly.api_catalog || k.moduly.api_inventory),
    kroky: [
      { ...ns("people", "service_api"), title: "K čemu to je", description: "Váš web nebo e-shop si načte ceník a sklad přímo z Jobi, takže změna ceny se na webu projeví sama. Zápis (pokladna, e-shop) jde přes token.", selector: sel("settings-sub-service_api"), icon: "settings" },
      { ...ns("people", "service_api"), title: "Zkontrolujte stav", description: "Zelené štítky ukazují, co je zapnuté. Bez adresy servisu se ven nedostane nic – vyplníte ji v Nastavení → Firma → Fakturace a DPH.", selector: sel("api-stav"), icon: "settings" },
      { ...ns("people", "service_api"), title: "Zkopírujte adresu ceníku", description: "Kopírovat adresu ji dá do schránky pro webaře, Vyzkoušet ukáže odpověď. Co se posílá ven, přepnete štítkem API u značek, modelů a oprav v Zařízení.", selector: sel("api-cenik"), icon: "settings" },
      { ...ns("people", "service_api"), title: "Pošlete webaři dokumentaci", description: "Otevřít dokumentaci ukáže popis každé adresy; Kopírovat odkaz ho dá do schránky.", selector: sel("api-dokumentace"), icon: "settings" },
      { ...ns("people", "service_api"), title: "Nastavte upozornění na změnu", description: "Vložte deploy hook webu a klikněte na Uložit – po úpravě ceníku nebo skladu na něj pošleme POST. Poslat zkušební ověří, že adresa funguje.", selector: sel("api-webhook"), icon: "settings" },
      { ...ns("people", "service_api"), title: "Vytvořte token pro zápis", description: "Napište, k čemu token je, zaškrtněte rozsah a klikněte na Vytvořit token. Ukáže se jen jednou – hned ho zkopírujte.", selector: sel("api-token"), icon: "settings" },
      { ...ns("people", "service_api"), title: "Hotovo", description: "Web čte data z Jobi. Kdyby token unikl, klikněte u něj na Odvolat a vydejte nový.", selector: sel("settings-sub-service_api"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-pobocky",
    nazev: "Pobočky",
    popis: "Více provozoven v jednom servisu.",
    page: "settings",
    settingsSubsection: "service_branches",
    dostupny: (k) => k.admin && !!k.moduly.branches,
    kroky: [
      { ...ns("company", "service_branches"), title: "K čemu to je", description: "Každá zakázka patří pobočce: na doklady jde adresa pobočky, zkratka do čísla zakázky a v Zakázkách, Skladu i Statistikách funguje jako filtr.", selector: sel("settings-sub-service_branches"), icon: "settings" },
      { ...ns("company", "service_branches"), title: "Klikněte na Přidat pobočku", description: "Pod seznamem se otevře formulář. Kolik poboček tarif dovoluje, je vedle tlačítka.", selector: sel("pobocky-pridat"), icon: "settings" },
      { ...ns("company", "service_branches"), title: "Napište název a zkratku", description: "Název (třeba „Praha 6 – Dejvice“) a až tři písmena do čísla zakázky – příklad čísla je hned pod polem.", selector: sel("pobocky-nazev"), klik: ["pobocky-pridat"], icon: "settings" },
      { ...ns("company", "service_branches"), title: "Doplňte adresu a kontakt", description: "Adresa, telefon, e-mail a otevírací doba jdou na doklady a do portálu zákazníka. Je-li pobočka jiná firma, vyplňte její IČO a účet; prázdná pole se berou z údajů firmy.", selector: sel("pobocky-formular"), klik: ["pobocky-pridat"], icon: "settings" },
      { ...ns("company", "service_branches"), title: "Klikněte na Uložit pobočku", description: "Pobočka přibude do seznamu. Tužkou ji upravíte, fajfkou nastavíte jako výchozí pro nové zakázky.", selector: sel("pobocky-ulozit"), klik: ["pobocky-pridat"], icon: "settings" },
      { ...ns("company", "service_branches"), title: "Přepínejte pobočky v liště", description: "Nahoře nad každou stránkou vyberete, kterou pobočku vidíte, nebo Všechny pobočky. Na kterou pobočku kdo vidí, nastavíte v Tým a oprávnění.", selector: sel("pobocka-lista"), icon: "settings" },
      { ...ns("company", "service_branches"), title: "Hotovo", description: "Nové zakázky se zakládají na vybranou pobočku. Přesun zařízení mezi pobočkami řeší Zásilky – průvodce Poslat zakázky na jinou pobočku.", selector: sel("pobocky-seznam"), icon: "settings" },
    ],
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
      { ...ns("company", "service_gdpr"), title: "K čemu to je", description: "Osobní údaje se nesmí držet napořád. Zákazník bez zakázky za zvolený počet let přijde o jméno, kontakty, adresu, fotky a SMS; zakázky i faktury zůstanou.", selector: sel("settings-sub-service_gdpr"), icon: "customers" },
      { ...ns("company", "service_gdpr"), title: "Vyberte, po kolika letech", description: "Doporučeno je 5 let. Počítá se od poslední zakázky, reklamace nebo faktury; rozpracovaná zakázka či nezaplacená faktura zákazníka chrání.", selector: sel("gdpr-roky"), icon: "customers" },
      { ...ns("company", "service_gdpr"), title: "Zaškrtněte Anonymizovat zákazníky", description: "Uloží pravidlo. Samo ale neběží, dokud ho poprvé ručně nepotvrdíte v náhledu.", selector: sel("gdpr-zapnout"), icon: "customers" },
      { ...ns("company", "service_gdpr"), title: "Klikněte na Zobrazit náhled", description: "Ukáže, koho by se to dotklo, a nic nemění. Pro spuštění napište do okna slovo ANONYMIZOVAT a klikněte na Anonymizovat – je to nevratné.", selector: sel("gdpr-nahled"), icon: "customers" },
      { ...ns("company", "service_gdpr"), title: "Co přesně se smaže", description: "Tady je rozepsané, co zmizí a co zůstane: faktury beze změny, zakázka jako záznam pro statistiky.", selector: sel("gdpr-co-se-smaze"), klik: ["gdpr-co-se-smaze"], icon: "customers" },
      { ...ns("company", "service_gdpr"), title: "Hotovo", description: "Po potvrzení běží pravidlo samo každou noc a každý běh se zapíše do protokolu. Když ho zpřísníte (méně let), čeká znovu na ruční potvrzení.", selector: sel("gdpr-protokol"), icon: "customers" },
    ],
  },
  {
    id: "nastaveni-predplatne",
    nazev: "Předplatné",
    popis: "Tarif, moduly a platby.",
    page: "settings",
    settingsSubsection: "service_subscription",
    dostupny: (k) => k.admin,
    kroky: [
      { ...ns("company", "service_subscription"), title: "K čemu to je", description: "Tady vidíte, jaký tarif a moduly máte, do kdy běží zkušební období a kdy je další platba.", selector: sel("settings-sub-service_subscription"), icon: "settings" },
      { ...ns("company", "service_subscription"), title: "Zkontrolujte, co máte", description: "Nahoře je stav předplatného a datum, pod ním pobočky, SMS a moduly s fajfkou u zapnutých. S předplatným tu je tlačítko Karta, faktury a zrušení.", selector: sel("predplatne-stav"), icon: "settings" },
      { ...ns("company", "service_subscription"), title: "Vyberte tarif", description: "Zvolte Platit měsíčně nebo ročně a klikněte na tarif; pod ním případně přidejte pobočky navíc.", selector: sel("predplatne-tarif"), icon: "settings" },
      { ...ns("company", "service_subscription"), title: "Klikněte na Pokračovat s tarifem", description: "Otevře se platební brána, kde kartu zadáte sami – aplikace ji nevidí.", selector: sel("predplatne-pokracovat"), icon: "settings" },
      { ...ns("company", "service_subscription"), title: "Hotovo", description: "Po zaplacení se tarif a moduly zapnou samy a nové funkce vám aplikace oznámí po přihlášení.", selector: sel("predplatne-moduly"), icon: "settings" },
    ],
  },
  {
    id: "nastaveni-profil",
    nazev: "Můj účet",
    popis: "Přezdívka, fotka, PIN a osobní nastavení.",
    page: "settings",
    settingsSubsection: "profile_me",
    kroky: [
      { ...ns("profile", "profile_me"), title: "K čemu to je", description: "Jak vás vidí kolegové a jak se u sdíleného počítače rychle přepnout. Platí jen pro váš účet.", selector: sel("settings-sub-profile_me"), icon: "profile" },
      { ...ns("profile", "profile_me"), title: "Napište přezdívku", description: "Ukáže se kolegům u komentářů a aktivit v zakázkách. Uložte lištou dole.", selector: sel("settings-profil-prezdivka"), icon: "profile" },
      { ...ns("profile", "profile_me"), title: "Vložte fotku", description: "Adresa obrázku (https://…); náhled je hned pod polem.", selector: sel("settings-profil-fotka"), icon: "profile" },
      { ...ns("profile", "profile_me"), title: "Nastavte si PIN", description: "Čtyři číslice dvakrát a Nastavit. U sdíleného počítače se pak mezi účty přepínáte PINem místo hesla.", selector: sel("settings-profil-pin"), icon: "profile" },
      { ...ns("profile", "profile_me"), title: "Zamykání po nečinnosti", description: "Po zvolené době se ukáže obrazovka s účty a odemkne ji PIN. Platí jen pro tento počítač.", selector: sel("settings-profil-zamek"), icon: "profile" },
      { ...ns("profile", "profile_me"), title: "Hotovo", description: "Přepnout účet nebo zamknout jde kdykoli tady, nebo v nabídce pod vaším jménem v postranním panelu.", selector: sel("settings-profil-prepnout"), icon: "profile" },
    ],
  },
];

export function dostupniPruvodci(k: KontextPruvodcu): Pruvodce[] {
  return PRUVODCI.filter((p) => (p.dostupny ? p.dostupny(k) : true) && p.kroky.length > 0);
}

/**
 * Všichni průvodci k aktuálnímu místu v pořadí katalogu: podsekce Nastavení,
 * nebo stránka (úvod se pro Zakázky nebere – má vlastní průvodce). Stránka
 * jich může mít víc – Zásilky mají Poslat i Převzít, Sklad i inventuru.
 */
export function pruvodciProMisto(dostupne: Pruvodce[], page: NavKey, settingsSubsection?: string | null): Pruvodce[] {
  if (page === "settings" && settingsSubsection) {
    return dostupne.filter((p) => p.settingsSubsection === settingsSubsection);
  }
  return dostupne.filter((p) => p.page === page && p.id !== "uvod" && !p.settingsSubsection);
}

/** Hlavní průvodce k místu (první z `pruvodciProMisto`). */
export function pruvodceProMisto(dostupne: Pruvodce[], page: NavKey, settingsSubsection?: string | null): Pruvodce | null {
  return pruvodciProMisto(dostupne, page, settingsSubsection)[0] ?? null;
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

/**
 * Uživatel novinky zavřel, aniž by průvodce prošel: zmizí z odznaku, toastu
 * i seznamu novinek, ale průvodce se nepočítá jako prošlý (zůstává mezi
 * všemi průvodci, jen bez štítku „Novinka“). Znovu se neobjeví – do
 * `dostupneDrive` už patří a `posledniKontrola` je za jeho `novinkaOd`.
 * Bez `ids` zavře všechny.
 */
export function zahodNovinky(userId: string, ids?: readonly string[], dnes = new Date()): UlozenyStavPruvodcu {
  const ulozeno = nactiStavPruvodcu(userId) ?? { dostupneDrive: [], posledniKontrola: dnes.toISOString().slice(0, 10), videno: {}, neprosle: [] };
  const pryc = ids ? new Set(ids) : null;
  const next: UlozenyStavPruvodcu = { ...ulozeno, neprosle: pryc ? ulozeno.neprosle.filter((x) => !pryc.has(x)) : [] };
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
