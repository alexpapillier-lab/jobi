/**
 * Online rezervace z webu servisu.
 *
 * Nastavení otevírací doby a kroku rozhoduje o tom, jaké termíny si zákazník
 * na webu vůbec může vybrat. Když se z uloženého JSONu přečte nesmysl a
 * propadne dál, nabídne web buď termíny mimo pracovní dobu (a zákazník stojí
 * před zavřeným krámem), nebo neukáže žádné (a servis přijde o zakázky).
 *
 * Popis termínu je to, co technik čte v seznamu rezervací – musí to být
 * čas servisu, ne čas v Londýně.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));

const { nastaveniRezervaciZConfigu, popisTerminu, VYCHOZI_NASTAVENI_REZERVACI } = await import("./rezervace");

describe("nastavení rezervací z uloženého configu", () => {
  it("prázdný nebo poškozený config dá výchozí nastavení, ne prázdné hodnoty", () => {
    for (const vstup of [undefined, null, {}, "nesmysl", 42, []]) {
      expect(nastaveniRezervaciZConfigu(vstup)).toEqual(VYCHOZI_NASTAVENI_REZERVACI);
    }
  });

  it("rezervace jsou vypnuté, dokud je servis výslovně nezapne", () => {
    expect(nastaveniRezervaciZConfigu({}).zapnuto).toBe(false);
    expect(nastaveniRezervaciZConfigu({ zapnuto: "true" }).zapnuto).toBe(false);
    expect(nastaveniRezervaciZConfigu({ zapnuto: 1 }).zapnuto).toBe(false);
    expect(nastaveniRezervaciZConfigu({ zapnuto: true }).zapnuto).toBe(true);
  });

  it("otevírací dny mimo pondělí až neděli se zahodí", () => {
    expect(nastaveniRezervaciZConfigu({ dny: [1, 0, 8, 6, -3] }).dny).toEqual([1, 6]);
    expect(nastaveniRezervaciZConfigu({ dny: [1, "2", null, 3] }).dny).toEqual([1, 3]);
  });

  it("chybějící seznam dnů znamená pracovní týden, ne žádný den", () => {
    expect(nastaveniRezervaciZConfigu({ dny: "po,ut" }).dny).toEqual([1, 2, 3, 4, 5]);
    expect(nastaveniRezervaciZConfigu({}).dny).toEqual([1, 2, 3, 4, 5]);
  });

  it("čas se doplní na dvě číslice, aby se dal porovnávat jako text", () => {
    const n = nastaveniRezervaciZConfigu({ od: "8:30", do: "17:00" });
    expect(n.od).toBe("08:30");
    expect(n.do).toBe("17:00");
  });

  it("čas v nečekaném tvaru propadne na výchozí, ne na prázdný řetězec", () => {
    const n = nastaveniRezervaciZConfigu({ od: "ráno", do: "17:00:00" });
    expect(n.od).toBe("09:00");
    expect(n.do).toBe("17:00");
    expect(nastaveniRezervaciZConfigu({ od: 8 }).od).toBe("09:00");
  });

  it("krok objednávek se drží mezi deseti minutami a dvěma hodinami", () => {
    expect(nastaveniRezervaciZConfigu({ krokMin: 15 }).krokMin).toBe(15);
    expect(nastaveniRezervaciZConfigu({ krokMin: 10 }).krokMin).toBe(10);
    expect(nastaveniRezervaciZConfigu({ krokMin: 120 }).krokMin).toBe(120);
    // krok pod deset minut nebo přes dvě hodiny je překlep, ne nastavení
    expect(nastaveniRezervaciZConfigu({ krokMin: 0 }).krokMin).toBe(30);
    expect(nastaveniRezervaciZConfigu({ krokMin: 5 }).krokMin).toBe(30);
    expect(nastaveniRezervaciZConfigu({ krokMin: 240 }).krokMin).toBe(30);
    expect(nastaveniRezervaciZConfigu({ krokMin: "30" }).krokMin).toBe(30);
  });

  it("úvodní text se nikdy nevrátí jako undefined, na web by se vypsalo „undefined“", () => {
    expect(nastaveniRezervaciZConfigu({}).uvod).toBe("");
    expect(nastaveniRezervaciZConfigu({ uvod: null }).uvod).toBe("");
    expect(nastaveniRezervaciZConfigu({ uvod: 5 }).uvod).toBe("");
    expect(nastaveniRezervaciZConfigu({ uvod: "Přijďte kdykoliv." }).uvod).toBe("Přijďte kdykoliv.");
  });
});

describe("popis termínu rezervace", () => {
  it("zákazník bez preferovaného termínu je v seznamu „kdykoliv“, ne s prázdnem", () => {
    expect(popisTerminu({ preferred_at: null })).toBe("kdykoliv");
  });

  it("termín se technikovi ukáže v místním čase servisu", () => {
    // 8. 9. 2026 v 9:30 místního času – technik musí vidět 09:30
    const kdy = new Date(2026, 8, 8, 9, 30).toISOString();
    const popis = popisTerminu({ preferred_at: kdy });
    expect(popis).toContain("09:30");
    expect(popis).toContain("8. 9.");
  });

  it("popis obsahuje den v týdnu, ať technik nemusí koukat do kalendáře", () => {
    // 8. 9. 2026 je úterý
    expect(popisTerminu({ preferred_at: new Date(2026, 8, 8, 9, 30).toISOString() })).toContain("út");
  });
});
