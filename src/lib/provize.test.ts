/**
 * Provize do Google Sheets – plánovací logika edge funkce provize-sheets
 * (`supabase/functions/_shared/provize.ts`). Pravidla jsou převzatá z bota
 * zakazkovylist-bot; Apps Script nad tabulkou zůstal stejný, takže tvar
 * řádků musí sedět na něj.
 */
import { describe, expect, it } from "vitest";
import { cenaProProvizi, naplanujProvize, type RadekTabulky, type ZakazkaProProvizi } from "../../supabase/functions/_shared/provize";

const zakazka = (code: string, statusLabel: string, ceny: number[], sleva?: { typ: "percentage" | "amount"; hodnota: number }): ZakazkaProProvizi => ({
  code,
  statusLabel,
  performed_repairs: ceny.map((price, i) => ({ id: `${code}-${i}`, name: "x", type: "manual", price })),
  discount_type: sleva?.typ ?? null,
  discount_value: sleva?.hodnota ?? null,
});

describe("cenaProProvizi", () => {
  it("je konečná cena po slevě – i když je sleva z importu záporná položka", () => {
    // IRPAZ2601576 z importu ZL: 3490 + 1890 + (−538) = 4842, v tabulce 4842.
    expect(cenaProProvizi(zakazka("IRPAZ2601576", "Vydáno", [3490, 1890, -538]))).toBe(4842);
    expect(cenaProProvizi(zakazka("A", "Vydáno", [1000], { typ: "percentage", hodnota: 10 }))).toBe(900);
    expect(cenaProProvizi(zakazka("B", "Vydáno", [], undefined))).toBe(0);
  });
});

describe("naplanujProvize", () => {
  it("nová zakázka ve sledovaném stavu jde do tabulky, jiné stavy ne", () => {
    const plan = naplanujProvize(
      [zakazka("IRP26000001", "Připraveno k převzetí", [1500]), zakazka("IRP26000002", "Vydáno", [2000]), zakazka("IRP26000003", "Přijato", [999])],
      [],
    );
    expect(plan.radky).toEqual([
      { zakazka_id: "IRP26000001", cena_czk: 1500, status: "Připraveno k převzetí" },
      { zakazka_id: "IRP26000002", cena_czk: 2000, status: "Vydáno" },
    ]);
    expect(plan.nove).toBe(2);
  });

  it("co už v tabulce je, se neposílá znovu", () => {
    const vTabulce: RadekTabulky[] = [{ id: "IRP26000002", cena: 2000, status: "Vydáno" }];
    const plan = naplanujProvize([zakazka("IRP26000002", "Vydáno", [2000])], vTabulce);
    expect(plan.radky).toEqual([]);
  });

  it("Připraveno → Vydáno: uzavře řádek uloženou cenou a rozdíl pošle jako DOPLATEK", () => {
    const vTabulce: RadekTabulky[] = [{ id: "IRP26000005", cena: 1500, status: "Připraveno k převzetí" }];
    const plan = naplanujProvize([zakazka("IRP26000005", "Vydáno", [1800])], vTabulce);
    expect(plan.radky).toEqual([
      { zakazka_id: "IRP26000005", cena_czk: 1500, status: "Vydáno" },
      { zakazka_id: "IRP26000005-DOPLATEK", cena_czk: 300, status: "Vydáno" },
    ]);
    expect(plan.uzavreno).toBe(1);
    expect(plan.doplatky).toBe(1);
  });

  it("Připraveno → Vydáno bez zdražení: jen uzavření, doplatek se neopakuje", () => {
    const vTabulce: RadekTabulky[] = [
      { id: "IRP26000006", cena: 1500, status: "Připraveno k převzetí" },
      { id: "IRP26000007", cena: 1000, status: "Připraveno k převzetí" },
      { id: "IRP26000007-DOPLATEK", cena: 200, status: "Vydáno" },
    ];
    const plan = naplanujProvize([zakazka("IRP26000006", "Vydáno", [1400]), zakazka("IRP26000007", "Vydáno", [1200])], vTabulce);
    expect(plan.radky).toEqual([
      { zakazka_id: "IRP26000006", cena_czk: 1500, status: "Vydáno" },
      { zakazka_id: "IRP26000007", cena_czk: 1000, status: "Vydáno" },
    ]);
    expect(plan.doplatky).toBe(0);
  });

  it("nula v tabulce a cena v Jobi → oprava s příznakem correct", () => {
    const vTabulce: RadekTabulky[] = [{ id: "IRP26000008", cena: 0, status: "Vydáno" }];
    const plan = naplanujProvize([zakazka("IRP26000008", "Vydáno", [2500])], vTabulce);
    expect(plan.radky).toEqual([{ zakazka_id: "IRP26000008", cena_czk: 2500, status: "Vydáno", correct: true }]);
    expect(plan.opraveno).toBe(1);
  });

  it("vlastní názvy statusů v Jobi se do tabulky přeloží na názvy ze ZL", () => {
    const plan = naplanujProvize([zakazka("X1", "Hotovo k vyzvednutí", [100]), zakazka("X2", "Předáno", [200])], [], {
      pripraveno: "Hotovo k vyzvednutí",
      vydano: "Předáno",
    });
    expect(plan.radky.map((r) => r.status)).toEqual(["Připraveno k převzetí", "Vydáno"]);
  });

  it("zakázka bez kódu a duplicitní kód se přeskočí", () => {
    const plan = naplanujProvize([zakazka("", "Vydáno", [100]), zakazka("D", "Vydáno", [100]), zakazka("D", "Vydáno", [100])], []);
    expect(plan.radky).toHaveLength(1);
  });
});
