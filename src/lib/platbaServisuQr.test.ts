import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { qrMatrix } from "../../jobidocs/src/qr";
import { ibanZCislaUctu } from "./banka";
import { nazevObdobi, prevedPlatbuMehoServisu, spaydPlatbyServisu } from "./platbyServisu";

/** Matice QR → RGBA obrázek pro jsQR (4 px na modul, okraj 4 moduly). */
function dekoduj(text: string): string | null {
  const qr = qrMatrix(text, "M");
  const n = qr.getModuleCount();
  const px = 4, okraj = 4, velikost = (n + okraj * 2) * px;
  const data = new Uint8ClampedArray(velikost * velikost * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.isDark(y, x)) continue;
    for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
      const i = (((y + okraj) * px + dy) * velikost + (x + okraj) * px + dx) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return jsQR(data, velikost, velikost)?.data ?? null;
}

describe("QR platba za Jobi", () => {
  it("účet majitele → IBAN", () => {
    expect(ibanZCislaUctu("1029498249/5500")).toBe("CZ9855000000001029498249");
  });

  it("SPAYD s částkou, VS a zprávou bez diakritiky – a QR se dá přečíst", () => {
    const p = prevedPlatbuMehoServisu({ nazev: "MajkaPajka Žluťoučký", castka: "400", obdobi: "2026-10", splatnost: "2026-10-26", dniPoSplatnosti: 0, ucet: "1029498249/5500", vs: "20261001" })!;
    const spayd = spaydPlatbyServisu(p, ibanZCislaUctu(p.ucet)!);
    expect(spayd).toBe("SPD*1.0*ACC:CZ9855000000001029498249*AM:400.00*CC:CZK*X-VS:20261001*MSG:Jobi 2026-10 MajkaPajka Zlutoucky");
    expect(dekoduj(spayd)).toBe(spayd);
  });

  it("bez platby nic; název měsíce česky", () => {
    expect(prevedPlatbuMehoServisu(null)).toBeNull();
    expect(prevedPlatbuMehoServisu({ castka: 0 })).toBeNull();
    expect(nazevObdobi("2026-10")).toBe("říjen 2026");
  });
});
