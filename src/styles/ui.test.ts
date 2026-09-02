/**
 * Hlídá, že primitiva stojí na tokenech.
 *
 * Celý smysl ui.css je, že se hodnoty berou z theme.css. Kdyby do něj
 * začala přibývat magická čísla, vznikne přesně ta situace, kterou to
 * mělo vyřešit – pět různých "primárních tlačítek" (docs/AUDIT_UI_2026-09.md).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./ui.css", import.meta.url), "utf-8");
const theme = readFileSync(new URL("./theme.css", import.meta.url), "utf-8");

function declarations(source: string) {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({
    prop: m[1].trim(),
    value: m[2].trim(),
  }));
}

describe("ui.css stojí na tokenech", () => {
  it("odsazení, poloměry a velikosti písma používají var(--…)", () => {
    const offenders = declarations(css)
      .filter((d) => /^(padding|margin|gap|border-radius|font-size)$/.test(d.prop))
      .filter((d) => !d.value.includes("var(--"))
      // Nulové a stejnorodé drobné hodnoty u ikonových tlačítek jsou v pořádku.
      .filter((d) => !/^(0|0px)$/.test(d.value))
      .filter((d) => !(d.prop === "padding" && /^\d+px$/.test(d.value) && parseInt(d.value) <= 8));
    expect(offenders).toEqual([]);
  });

  it("nepoužívá barvy zapsané napevno", () => {
    const offenders = declarations(css)
      .filter((d) => /(^|-)(color|background|border-color|outline-color)$/.test(d.prop))
      .filter((d) => /#[0-9a-f]{3,8}\b|\brgba?\(/i.test(d.value))
      // Bílá na barevném tlačítku je záměr – token pro "text na akcentu" neexistuje.
      .filter((d) => d.value !== "#fff");
    expect(offenders).toEqual([]);
  });

  it("každý použitý token je v theme.css opravdu definovaný", () => {
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    const missing = [...new Set(used)].filter((t) => !theme.includes(`${t}:`));
    expect(missing).toEqual([]);
  });

  it.each([".ui-btn", ".ui-segmented__option", ".ui-selectable", ".ui-menu-item"])(
    "%s má stav pro klávesnici",
    (cls) => {
      expect(css).toContain(`${cls}:focus-visible`);
    },
  );

  it("položka nabídky rozlišuje výběr od kurzoru klávesnice", () => {
    // Dva různé stavy: `aria-pressed` je zvolená hodnota, `data-highlighted`
    // jen kurzor při procházení šipkami. Kdyby splynuly, uživatel u klávesnice
    // nepozná, na čem stojí a co je vybráno.
    expect(css).toContain('.ui-menu-item[aria-pressed="true"]');
    expect(css).toContain('.ui-menu-item[data-highlighted="true"]');
    const pressed = css.match(/\.ui-menu-item\[aria-pressed="true"\]\s*\{([^}]*)\}/)![1];
    const cursor = css.match(/\.ui-menu-item\[data-highlighted="true"\][^{]*\{([^}]*)\}/)![1];
    expect(pressed.trim()).not.toEqual(cursor.trim());
  });

  it("hover položky nabídky je vidět", () => {
    // --panel-2 se od --panel liší o čtyři odstíny z 255; na tom hover zanikl.
    const hover = css.match(/\.ui-menu-item:hover[^{]*\{([^}]*)\}/)![1];
    expect(hover).not.toContain("var(--panel-2)");
    expect(hover).toContain("var(--accent)");
  });

  it("vybraný stav nemění šířku rámečku", () => {
    // Karty ve Statistikách dřív při výběru přepínaly rámeček z 1px na 2px,
    // takže se obsah posunul o pixel. Zvýraznění musí dělat barva nebo stín.
    const pressed = [...css.matchAll(/\[aria-pressed="true"\]\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(pressed.length).toBeGreaterThan(0);
    for (const block of pressed) {
      expect(block).not.toMatch(/border(-width)?\s*:\s*\d/);
    }
  });
});

describe("validační tlačítka zůstávají klikatelná", () => {
  // Regrese: formuláře s `submitAttempted` odhalují chyby polí až po kliknutí
  // na odesílací tlačítko. Kdyby bylo `disabled`, uživatel se nikdy nedozví,
  // co je špatně – proto smí být jen `aria-disabled`.
  const forms = [
    ["pages/Orders.tsx", "canCreate"],
    ["pages/Customers/CustomerDetail.tsx", "canSave"],
  ] as const;

  it.each(forms)("%s nezakazuje tlačítko přes %s", (file, flag) => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf-8");
    expect(src).toContain(`aria-disabled={!${flag}}`);
    expect(src).not.toMatch(new RegExp(`(?<!aria-)disabled=\\{!${flag}\\}`));
  });
});
