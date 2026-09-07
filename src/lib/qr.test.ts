import { describe, it, expect } from "vitest";
import { qrDataUrl, qrMatrix } from "../../jobidocs/src/qr";
import jsQR from "jsqr";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * QR kódy se dřív tahaly z api.qrserver.com. U faktur se tím do cizí služby
 * posílalo číslo účtu, částka i variabilní symbol, a bez internetu se QR
 * platba vůbec nevytiskla. Tyhle testy hlídají, že náhrada opravdu generuje
 * obrázek, ne prázdno.
 */

const SPAYD = "SPD*1.0*ACC:CZ6508000000192000145399*AM:900.00*CC:CZK*X-VS:2026001*MSG:Faktura 2026001";

/** Rozměry z hlavičky GIFu (bajty 6–9, little-endian). */
function gifSize(dataUrl: string): { w: number; h: number } {
  const b64 = dataUrl.replace(/^data:image\/gif;base64,/, "");
  const bytes = Buffer.from(b64, "base64");
  return { w: bytes[6] | (bytes[7] << 8), h: bytes[8] | (bytes[9] << 8) };
}

describe("qrDataUrl", () => {
  it("vygeneruje GIF data URL", () => {
    const url = qrDataUrl(SPAYD, 120);
    expect(url.startsWith("data:image/gif;base64,")).toBe(true);
    expect(url.length).toBeGreaterThan(200);
  });

  it("výsledek je platný GIF se čtvercovými rozměry", () => {
    const { w, h } = gifSize(qrDataUrl(SPAYD, 120));
    expect(w).toBe(h);
    expect(w).toBeGreaterThan(0);
  });

  it("velikost zhruba odpovídá požadované", () => {
    const { w } = gifSize(qrDataUrl(SPAYD, 120));
    // Velikost je násobek počtu modulů, takže se přesně netrefí – ale nesmí
    // být řádově jinde, jinak by byl QR na tisku nečitelný nebo přes celou stránku.
    expect(w).toBeGreaterThanOrEqual(60);
    expect(w).toBeLessThanOrEqual(260);
  });

  it("různá data dají různý obrázek", () => {
    expect(qrDataUrl("první", 120)).not.toBe(qrDataUrl("druhý", 120));
  });

  it("stejná data dají stejný obrázek (je to deterministické)", () => {
    expect(qrDataUrl(SPAYD, 120)).toBe(qrDataUrl(SPAYD, 120));
  });

  it("prázdný vstup vrátí prázdný řetězec, ne rozbitý obrázek", () => {
    expect(qrDataUrl("", 120)).toBe("");
  });

  it("zvládne dlouhý odkaz na hodnocení", () => {
    const dlouhy = "https://search.google.com/local/writereview?placeid=" + "A".repeat(120);
    expect(qrDataUrl(dlouhy, 120).startsWith("data:image/gif;base64,")).toBe(true);
  });

  it("nepotřebuje síť – běží synchronně", () => {
    const start = Date.now();
    qrDataUrl(SPAYD, 120);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

/**
 * Nejdůležitější test z téhle sady.
 *
 * Předchozí testy jen ověřují, že vznikne obrázek. Tenhle ověřuje, že ten
 * obrázek jde SKUTEČNĚ NASKENOVAT a vrátí přesně to, co do něj šlo –
 * což je u QR platby na faktuře podstatné: zákazník podle něj platí.
 *
 * Modulovou mřížku vykreslíme do rastru a pustíme na ni dekodér, takže
 * jde o poctivé kolečko tam a zpět, ne o kontrolu vlastní implementace.
 */
describe("QR jde naskenovat", () => {
  function decode(text: string, cell = 4, quiet = 4): string | null {
    // Záměrně přes qrMatrix, tedy přesně tu mřížku, která se tiskne.
    // Dřívější verze testu si QR stavěla sama, a proto přehlédla,
    // že produkční kód kóduje diakritiku jinak.
    const q = qrMatrix(text, "M");
    const n = q.getModuleCount();
    const size = (n + quiet * 2) * cell;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!q.isDark(r, c)) continue;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const px = (((r + quiet) * cell + y) * size + ((c + quiet) * cell + x)) * 4;
            data[px] = data[px + 1] = data[px + 2] = 0;
          }
        }
      }
    }
    return jsQR(data, size, size)?.data ?? null;
  }

  it("QR platba (SPAYD) se dekóduje na přesně stejný řetězec", () => {
    expect(decode(SPAYD)).toBe(SPAYD);
  });

  it("odkaz na hodnocení se dekóduje beze změny", () => {
    const url = "https://search.google.com/local/writereview?placeid=ChIJvXyz123";
    expect(decode(url)).toBe(url);
  });

  it("zvládne diakritiku v textu", () => {
    const text = "Zakázka č. 2026/001 – Příjemka, Plzeň";
    expect(decode(text)).toBe(text);
  });
});

/**
 * Poslední místo, kde se QR tahal z internetu, bylo okno „Vyfotit z telefonu“.
 * Odkaz v tom QR obsahuje token, kterým jde k zakázce nahrát fotka – posílat
 * ho do cizí služby znamenalo poslat jí i ten token. Test hlídá, že se do
 * zdrojáku nevrátí.
 */
describe("QR se nikde netahá z internetu", () => {
  it("Zakázky kreslí QR pro focení z telefonu lokálně", () => {
    const zdroj = readFileSync(join(KOREN, "src/pages/Orders.tsx"), "utf8");
    expect(zdroj, "QR z api.qrserver.com je zpátky").not.toMatch(/src=\{`https:\/\/api\.qrserver\.com/);
    expect(zdroj, "chybí lokální generování QR").toMatch(/qrDataUrl\(item\.url/);
  });

  it("nikde v aplikaci se nevolá cizí generátor QR", () => {
    const soubory = execSync("grep -rl 'qrserver' src jobidocs/src jobidocs/core web || true", { encoding: "utf8" })
      .split("\n").filter(Boolean)
      // Tenhle test o té službě mluví ze své podstaty.
      .filter((f) => !f.endsWith("src/lib/qr.test.ts"));
    // Komentář o tom, proč se to změnilo, projít smí; volání ne.
    for (const f of soubory) {
      const obsah = readFileSync(join(KOREN, f), "utf8");
      const volani = obsah.split("\n").filter((r) => r.includes("qrserver") && !r.trimStart().startsWith("*") && !r.trimStart().startsWith("//") && !r.includes("{/*"));
      expect(volani, `${f} pořád volá api.qrserver.com`).toEqual([]);
    }
  });
});
