/**
 * Co má nový servis „První kroky“ odškrtnuté – bez Reactu a bez databáze.
 *
 * Odškrtávání je jediná věc, kterou na kartě První kroky nový zákazník
 * skutečně sleduje: když se krok neodškrtne, ačkoli ho splnil, přestane
 * seznamu věřit a proklikává Nastavení znovu. Do teď se to rozhodovalo
 * uvnitř komponenty v `useMemo`, takže se to nedalo otestovat jinak než
 * proklikáním celé aplikace.
 *
 * Modul úmyslně neví, odkud data jsou – dostane hotový stav a vrátí kroky.
 */
import { zkratkaZConfigu, type ConfigSeZkratkou } from "./servisy";

export type OnboardingKrok = {
  id: string;
  label: string;
  popis: string;
  hotovo: boolean;
  /** Kam odskočit; podsekce Nastavení. */
  cil?: string;
  /** Externí odkaz místo odskoku do Nastavení (stažení JobiDocs z webu). */
  odkaz?: string;
  akce?: string;
  /** Nepovinný krok nedrží seznam otevřený – bez něj se dá dojít do konce. */
  volitelny?: boolean;
};

export type OnboardingStav = {
  /** Nastavení servisu; `null`, dokud se nenačte nebo když se načíst nepodařilo. */
  config: (ConfigSeZkratkou & { companyData?: Record<string, unknown> | null }) | null;
  /** Kolik zakázek servis má (i ukázkových). */
  zakazek: number;
  /** Kolik lidí je na servisu, mimo skryté členství majitele aplikace. */
  clenu: number;
  /** Běží na tomhle počítači JobiDocs? Ve webové verzi vždy `false`. */
  jobiDocsBezi: boolean;
  /** Desktopová aplikace (Tauri), ne prohlížeč. */
  desktop: boolean;
  /** Odkaz na stažení JobiDocs pro webovou verzi. */
  odkazJobiDocs: string;
};

function jeVyplneno(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Kroky v pořadí, ve kterém se ukazují.
 *
 * Zkratka se čte přes `zkratkaZConfigu`, tedy z obou míst configu i z názvu
 * firmy – stejně jako ji čte generátor čísel zakázek. Kdyby se ptala jen na
 * `config.abbreviation`, seznam by hlásil „nastavte zkratku“ servisu, který
 * ji dávno má a čísluje podle ní.
 *
 * Nouzové „SRV“ se za nastavenou zkratku nepovažuje: to je právě ten stav,
 * na který má krok upozornit.
 */
export function onboardingKroky(stav: OnboardingStav): OnboardingKrok[] {
  const cd = (stav.config?.companyData ?? {}) as Record<string, unknown>;
  const zkratka = jeVyplneno(stav.config?.abbreviation) || jeVyplneno(cd.abbreviation)
    ? zkratkaZConfigu(stav.config) !== "SRV"
    : false;

  return [
    {
      id: "firma",
      label: "Vyplňte údaje firmy",
      popis: "Název, IČO a adresa se tisknou v hlavičce příjemky a faktury.",
      hotovo: jeVyplneno(cd.name) && jeVyplneno(cd.ico) && jeVyplneno(cd.addressStreet) && jeVyplneno(cd.addressCity),
      cil: "service_basic",
      akce: "Doplnit údaje",
    },
    {
      id: "zkratka",
      label: "Nastavte zkratku servisu",
      popis: "Je z ní číslo zakázky, například SRV26000001.",
      hotovo: zkratka,
      cil: "service_basic",
      akce: "Nastavit zkratku",
    },
    {
      id: "kontakt",
      label: "Doplňte telefon a e-mail",
      popis: "Zákazník je uvidí na dokumentech i v odkazu na stav zakázky.",
      hotovo: jeVyplneno(cd.phone) || jeVyplneno(cd.email),
      cil: "service_contact",
      akce: "Doplnit kontakt",
    },
    {
      id: "jobidocs",
      label: "Nainstalujte JobiDocs pro tisk dokumentů",
      popis: stav.desktop
        ? "Zakázkový a záruční list se tisknou jedním kliknutím, bez dialogu. Webová verze na appjobi.com je pak doplněk, třeba na tabletu u příjmu."
        : "Tisk dokumentů funguje v desktopové aplikaci s doplňkem JobiDocs. V prohlížeči dokumenty nevytisknete.",
      hotovo: stav.jobiDocsBezi,
      cil: stav.desktop ? "orders_tisk_dokumentu" : undefined,
      odkaz: stav.desktop ? undefined : stav.odkazJobiDocs,
      akce: stav.desktop ? "Nastavit tisk" : "Stáhnout aplikaci",
      // V prohlížeči se splnit nedá; kdyby byl povinný, seznam by se nikdy nezavřel sám.
      volitelny: !stav.desktop,
    },
    {
      id: "zakazka",
      label: "Založte první zakázku",
      popis: "Vyzkoušejte si příjem i tisk, než přijde první zákazník.",
      hotovo: stav.zakazek > 0,
    },
    {
      id: "tym",
      label: "Pozvěte kolegu",
      popis: "Každý uvidí stejné zakázky a je poznat, kdo co udělal.",
      hotovo: stav.clenu > 1,
      cil: "service_team",
      akce: "Pozvat",
      volitelny: true,
    },
  ];
}

/** Kolik kroků je hotových – číslo v hlavičce „hotových z celkem“. */
export function pocetHotovych(kroky: OnboardingKrok[]): number {
  return kroky.filter((k) => k.hotovo).length;
}

/**
 * Je hotovo všechno, co seznam drží otevřený?
 *
 * Nepovinné kroky se nepočítají – jinak by se karta ve webové verzi
 * (kde JobiDocs splnit nejde) nezavřela nikdy.
 */
export function vsePovinneHotovo(kroky: OnboardingKrok[]): boolean {
  return kroky.every((k) => k.hotovo || k.volitelny);
}
