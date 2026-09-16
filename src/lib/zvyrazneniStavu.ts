/**
 * Jak výrazně se ve výpisu zakázek propíše barva stavu.
 *
 * Do teď se z barvy použil jen 4px proužek vlevo a orámování na 19 %
 * krytí – stav se tedy dal přečíst až z odznaku na pravém okraji řádku.
 * Na zakázkovylist.cz je obarvený celý řádek a pozná se to na první
 * pohled; tohle je totéž, jen volitelně a bezpečně.
 *
 * Plná výplň není výchozí schválně: barvy stavů si nastavuje servis sám
 * a libovolná barva umí udělat nečitelný text. Proto se u „výrazné“
 * dopočítává barva písma podle jasu pozadí.
 *
 * Bez závislosti na motivu: „jemné“ je barva s nízkým krytím, která nad
 * světlým i tmavým podkladem vyjde správně sama.
 */

/**
 * „plne“ = jako Zakázkový list: každý řádek plnou barvou stavu bez
 * průhlednosti a bez ztlumení hotových zakázek. „vyrazne“ hotové ztlumí,
 * což někomu vadí – chce vidět barvu, kterou si u stavu nastavil, a nic jiného.
 */
export type ZvyrazneniStavu = "zadne" | "jemne" | "vyrazne" | "plne";

export const VYCHOZI_ZVYRAZNENI: ZvyrazneniStavu = "jemne";

export function jeZvyrazneni(x: unknown): x is ZvyrazneniStavu {
  return x === "zadne" || x === "jemne" || x === "vyrazne" || x === "plne";
}

/** #rgb i #rrggbb; cokoli jiného (proměnná CSS) vrátí null. */
export function rozlozBarvu(barva: string): { r: number; g: number; b: number } | null {
  const m = barva.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1];
  const plna = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(plna.slice(0, 2), 16),
    g: parseInt(plna.slice(2, 4), 16),
    b: parseInt(plna.slice(4, 6), 16),
  };
}

/**
 * Relativní jas podle WCAG. Zelená váží nejvíc, modrá nejmíň – proto
 * čistě modrá potřebuje bílý text, kdežto čistě žlutá černý.
 */
export function jas(barva: string): number | null {
  const c = rozlozBarvu(barva);
  if (!c) return null;
  const kanal = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * kanal(c.r) + 0.7152 * kanal(c.g) + 0.0722 * kanal(c.b);
}

/**
 * Černá, nebo bílá – podle toho, co je na dané barvě čitelnější.
 * Práh 0.179 odpovídá bodu, kde se kontrast obou variant vyrovná.
 */
export function barvaTextu(pozadi: string): string {
  const l = jas(pozadi);
  if (l === null) return "var(--text)";
  return l > 0.179 ? "#10171A" : "#FFFFFF";
}

export type StylStavu = {
  pozadi: string;
  barvaPisma: string;
  ramecek: string;
  sirkaProuzku: number;
  /** Řádek je vyplněný plnou barvou stavu – písmo uvnitř se musí přebarvit. */
  plnaVyplne: boolean;
};

/**
 * CSS proměnné pro řádek s plnou výplní.
 *
 * Sdílené prvky karty (`fields.tsx`) berou barvy z `var(--text)` a
 * `var(--muted)`, ne z `color` rodiče. Na plně vyplněném řádku by tak datum
 * nebo jméno zákazníka zůstaly šedé na sytě modré. Místo přepisování každého
 * prvku se proměnné přepíšou na samotném řádku – potomci se přizpůsobí sami.
 *
 * `--accent` a `--accent-soft` (štítek technika, ikona zařízení) se pro
 * jistotu srovnají se stejnou barvou; na barevném podkladu je jinak akcent
 * často nečitelný.
 */
/**
 * Návrat k barvám motivu pro ovládací prvky uvnitř plně obarveného řádku.
 *
 * Pilulka stavu a tlačítko tisku mají vlastní světlý podklad (var(--panel)),
 * ale písmo berou z var(--text) – a to řádek přepsal na bílou. Na tmavém
 * stavu tak vyšel bílý text na bílé pilulce. Obal ovládání proto proměnné
 * vrátí na kopie z <html> (theme.css: --text-puvodni a spol.).
 */
export function promenneOvladani(stav: StylStavu): Record<string, string> {
  if (!stav.plnaVyplne) return {};
  return {
    "--text": "var(--text-puvodni)",
    "--muted": "var(--muted-puvodni)",
    "--border": "var(--border-puvodni)",
    "--accent": "var(--accent-puvodni)",
    "--accent-soft": "var(--accent-soft-puvodni)",
    color: "var(--text-puvodni)",
  };
}

export function promenneRadku(stav: StylStavu): Record<string, string> {
  if (!stav.plnaVyplne) return {};
  const pismo = stav.barvaPisma;
  const tlumene = pismo === "#FFFFFF" ? "rgba(255,255,255,0.78)" : "rgba(16,23,26,0.72)";
  const jemne = pismo === "#FFFFFF" ? "rgba(255,255,255,0.35)" : "rgba(16,23,26,0.25)";
  return {
    "--text": pismo,
    "--muted": tlumene,
    "--border": jemne,
    "--accent": pismo,
    "--accent-soft": pismo === "#FFFFFF" ? "rgba(255,255,255,0.18)" : "rgba(16,23,26,0.10)",
  };
}

/**
 * Styl řádku zakázky podle barvy stavu.
 *
 * `konecny` ztlumí hotové zakázky – jinak jsou ve výpisu stejně křiklavé
 * jako ty, které na někoho čekají, a to je přesně naopak, než člověk chce.
 */
export function stylStavu(
  barva: string | undefined,
  rezim: ZvyrazneniStavu,
  konecny = false,
): StylStavu {
  const bg = barva || "var(--border)";
  const jeHex = rozlozBarvu(bg) !== null;

  if (rezim === "zadne" || !jeHex) {
    return { pozadi: "var(--panel)", barvaPisma: "var(--text)", ramecek: `${bg}30`, sirkaProuzku: 4, plnaVyplne: false };
  }

  if (rezim === "plne") {
    return {
      pozadi: bg,
      barvaPisma: barvaTextu(bg),
      ramecek: bg,
      sirkaProuzku: 0,
      plnaVyplne: true,
    };
  }

  if (rezim === "vyrazne") {
    return {
      pozadi: konecny ? `${bg}55` : bg,
      barvaPisma: konecny ? "var(--text)" : barvaTextu(bg),
      ramecek: bg,
      sirkaProuzku: 6,
      plnaVyplne: !konecny,
    };
  }

  // jemné
  return {
    pozadi: konecny ? `${bg}0A` : `${bg}1F`,
    barvaPisma: "var(--text)",
    ramecek: konecny ? `${bg}30` : `${bg}55`,
    sirkaProuzku: 6,
    plnaVyplne: false,
  };
}
