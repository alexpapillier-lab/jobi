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

export type ZvyrazneniStavu = "zadne" | "jemne" | "vyrazne";

export const VYCHOZI_ZVYRAZNENI: ZvyrazneniStavu = "jemne";

export function jeZvyrazneni(x: unknown): x is ZvyrazneniStavu {
  return x === "zadne" || x === "jemne" || x === "vyrazne";
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
};

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
    return { pozadi: "var(--panel)", barvaPisma: "var(--text)", ramecek: `${bg}30`, sirkaProuzku: 4 };
  }

  if (rezim === "vyrazne") {
    return {
      pozadi: konecny ? `${bg}55` : bg,
      barvaPisma: konecny ? "var(--text)" : barvaTextu(bg),
      ramecek: bg,
      sirkaProuzku: 6,
    };
  }

  // jemné
  return {
    pozadi: konecny ? `${bg}0A` : `${bg}1F`,
    barvaPisma: "var(--text)",
    ramecek: konecny ? `${bg}30` : `${bg}55`,
    sirkaProuzku: 6,
  };
}
