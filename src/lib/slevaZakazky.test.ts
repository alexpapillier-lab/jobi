import { describe, it, expect } from "vitest";
import { castkaSlevy, konecnaCena, korunami } from "./slevaZakazky";
import { formatCurrency } from "./invoiceMath";

/**
 * Sleva je jediné místo, kde se na zakázce počítají peníze pro zákazníka.
 * Rozdíl mezi kartou v aplikaci a vytištěným dokladem by znamenal spor
 * u pultu, takže vzorec musí být jeden a chovat se předvídatelně
 * i u nesmyslných hodnot z ruky.
 */
describe("sleva na zakázce", () => {
  it("procentní sleva se počítá z hrubé ceny", () => {
    expect(castkaSlevy(1000, "percentage", 10)).toBe(100);
    expect(konecnaCena(1000, "percentage", 10)).toBe(900);
  });

  it("sleva pevnou částkou se odečte přímo", () => {
    expect(konecnaCena(1000, "amount", 250)).toBe(750);
  });

  it("sleva vyšší než cena vynuluje, nejde do mínusu", () => {
    expect(castkaSlevy(500, "amount", 900)).toBe(500);
    expect(konecnaCena(500, "amount", 900)).toBe(0);
    expect(konecnaCena(500, "percentage", 150)).toBe(0);
  });

  it("bez slevy zůstane cena celá", () => {
    expect(konecnaCena(1234.5, null, null)).toBe(1234.5);
    expect(castkaSlevy(1234.5, "amount", 0)).toBe(0);
  });

  it("zaokrouhluje na haléře, ne na koruny", () => {
    expect(castkaSlevy(999, "percentage", 33)).toBe(329.67);
    expect(konecnaCena(999, "percentage", 33)).toBe(669.33);
  });

  it("nulová cena se slevou nespadne pod nulu", () => {
    expect(konecnaCena(0, "percentage", 50)).toBe(0);
  });

  it("částka se tiskne česky, s mezerou v tisících a čárkou", () => {
    // Oddělovač tisíců je nedělitelná mezera, ne obyčejná – doklad se
    // nesmí zalomit uprostřed částky.
    expect(korunami(1234.5)).toBe("1\u00A0234,50\u00A0Kč");
    // I mezera před „Kč“ je nedělitelná – jinak se částka na dokladu
    // zalomí přes dva řádky a účetní hledá, kam se poděla měna.
    expect(korunami(0)).toBe("0,00\u00A0Kč");
    // Stejný řetězec jako formatCurrency: jeden formát na kartě i na dokladu.
    expect(korunami(1234.5)).toBe(formatCurrency(1234.5, "CZK"));
  });
});
