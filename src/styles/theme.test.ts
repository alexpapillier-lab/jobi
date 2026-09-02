import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Hlídá designové tokeny.
 *
 * Vzniklo po auditu UI (docs/AUDIT_UI_2026-09.md), kde vyšlo najevo, že
 * syté stavové barvy mají na světlém pozadí kontrast kolem 2–3,5:1, tedy
 * pod hranicí čitelnosti. Textové varianty proto musí projít WCAG AA.
 *
 * Bez tohohle testu by stačilo, aby někdo „jen trochu zesvětlil“ červenou,
 * a čitelnost by tiše spadla.
 */

const css = readFileSync(join(__dirname, "theme.css"), "utf-8");

function block(selector: string): Record<string, string> {
  const re = new RegExp(selector.replace(/[[\]"]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\n\\}");
  const m = css.match(re);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}

function toRgb(value: string): [number, number, number] | null {
  const hex = value.match(/#([0-9a-fA-F]{6})/);
  if (hex) {
    const h = hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgba = value.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const p = rgba[1].split(",").map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2]];
  }
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: Array<[string, string]> = [
  ["světlý", ":root"],
  ["tmavý", '[data-theme="dark"]'],
];

const TEXT_TOKENS = ["--text", "--muted", "--danger-text", "--warning-text", "--success-text", "--info-text"];

describe("designové tokeny", () => {
  for (const [name, selector] of THEMES) {
    describe(`${name} motiv`, () => {
      const vars = block(selector);
      const bg = toRgb(vars["--bg"] ?? "");

      it("má definované pozadí", () => {
        expect(bg).not.toBeNull();
      });

      for (const token of TEXT_TOKENS) {
        it(`${token} má kontrast alespoň 4,5:1 (WCAG AA)`, () => {
          const fg = toRgb(vars[token] ?? "");
          expect(fg, `${token} v ${selector} chybí nebo má neznámý formát`).not.toBeNull();
          const ratio = contrast(fg!, bg!);
          expect(
            ratio,
            `${token} = ${vars[token]} má kontrast ${ratio.toFixed(2)}:1, potřeba ≥ 4,5`
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }

  it("tmavší varianty stavových barev unesou bílý text (toasty)", () => {
    // Toast má bílý text na barevném pozadí. Syté --danger a --success mají
    // pod bílým písmem jen 3,8:1 a 2,3:1, proto existují varianty -strong.
    // Ty musí být tmavé v OBOU motivech – na rozdíl od -text.
    const white: [number, number, number] = [255, 255, 255];
    for (const [name, selector] of THEMES) {
      const vars = block(selector);
      for (const token of ["--danger-strong", "--success-strong", "--warning-strong", "--info-strong"]) {
        const bgColor = toRgb(vars[token] ?? "");
        expect(bgColor, `${token} v ${name} motivu chybí`).not.toBeNull();
        const ratio = contrast(white, bgColor!);
        expect(
          ratio,
          `bílý text na ${token} (${vars[token]}) má v ${name} motivu kontrast ` +
            `${ratio.toFixed(2)}:1, potřeba ≥ 4,5`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("typografická škála nejde pod 11px – menší písmo je nečitelné", () => {
    const root = block(":root");
    const sizes = Object.entries(root)
      .filter(([k]) => k.startsWith("--text-"))
      .map(([k, v]) => [k, parseInt(v, 10)] as const)
      .filter(([, px]) => !Number.isNaN(px));

    expect(sizes.length, "škála --text-* v theme.css chybí").toBeGreaterThan(0);
    for (const [name, px] of sizes) {
      expect(px, `${name} = ${px}px je pod hranicí čitelnosti`).toBeGreaterThanOrEqual(11);
    }
  });

  it("škála rozestupů drží násobky čtyř", () => {
    const root = block(":root");
    const spaces = Object.entries(root)
      .filter(([k]) => k.startsWith("--space-"))
      .map(([k, v]) => [k, parseInt(v, 10)] as const);

    expect(spaces.length, "škála --space-* v theme.css chybí").toBeGreaterThan(0);
    for (const [name, px] of spaces) {
      expect(px % 4, `${name} = ${px}px není násobek čtyř`).toBe(0);
    }
  });
});

/**
 * Hlídá, že se JobiDocs a Jobi nerozejdou v designu.
 *
 * Obě aplikace mají vlastní theme.css a sdílejí část tokenů. Dokud mají
 * shodné hodnoty, působí jako jeden produkt; jakmile se rozejdou, začne
 * být vidět, že jsou to dvě aplikace (jiná červená, jiné odstupňování písma).
 *
 * JobiDocs nemá vlastní testy, takže se to hlídá odsud – drift zachytí
 * kterákoli strana.
 */
describe("shoda tokenů s JobiDocs", () => {
  const jobiDocsPath = join(__dirname, "..", "..", "jobidocs", "src", "styles", "theme.css");
  const exists = existsSync(jobiDocsPath);

  it.runIf(exists)("sdílené tokeny mají v obou aplikacích stejnou hodnotu", () => {
    const jobiDocsCss = readFileSync(jobiDocsPath, "utf-8");

    function rootVars(source: string): Record<string, string> {
      const m = source.match(/:root\s*\{([\s\S]*?)\n\}/);
      if (!m) return {};
      const out: Record<string, string> = {};
      for (const [, k, v] of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[k] = v.trim();
      return out;
    }

    const jobi = rootVars(css);
    const docs = rootVars(jobiDocsCss);
    const shared = Object.keys(jobi).filter((k) => k in docs);

    expect(shared.length, "aplikace nesdílejí žádné tokeny – načetl se správný soubor?").toBeGreaterThan(15);

    const rozdily = shared
      .filter((k) => jobi[k] !== docs[k])
      .map((k) => `${k}: Jobi="${jobi[k]}" vs JobiDocs="${docs[k]}"`);

    expect(rozdily, `Tokeny se rozešly:\n  ${rozdily.join("\n  ")}`).toEqual([]);
  });
});
