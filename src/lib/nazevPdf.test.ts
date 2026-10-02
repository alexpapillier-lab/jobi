import { describe, it, expect } from "vitest";
import { nazevPdfProTisk } from "./nazevPdf";

describe("nazevPdfProTisk", () => {
  it("skládá druh dokumentu bez diakritiky a číslo zakázky", () => {
    expect(nazevPdfProTisk("zarucni_list", { number: "J-28A99Z" })).toBe("zarucni-list-J-28A99Z");
    expect(nazevPdfProTisk("zakazkovy_list", { number: "2026/0012" })).toBe("zakazkovy-list-2026-0012");
    expect(nazevPdfProTisk("faktura", { number: "FV-2026-001" })).toBe("faktura-FV-2026-001");
    expect(nazevPdfProTisk("smlouva_zapujcka", { number: "Zápůjčka č. 5" })).toBe("smlouva-o-zapujcce-Zapujcka-c.-5");
  });

  it("bez čísla zůstane jen druh dokumentu", () => {
    expect(nazevPdfProTisk("diagnosticky_protokol", { number: null })).toBe("diagnostika-zarizeni");
    expect(nazevPdfProTisk("prijemka_reklamace", {})).toBe("prijemka-reklamace");
  });
});
