import { describe, it, expect } from "vitest";
import { zapamatujZarukuServisu, zarucniDobaProTisk, zarucniDobaZNastaveni } from "./documentHelpers";

// Délka záruky je jediný údaj na záručním listu, který si zákazník odnese
// jako slib servisu. Bere se z nastavení dokumentů servisu, ne ze zakázky.
describe("záruční doba z nastavení dokumentů", () => {
  const nastaveni = (warrantyCertificate: Record<string, unknown>) => ({ warrantyCertificate });

  it("měsíce se berou tak, jak je servis nastavil", () => {
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyUnifiedDuration: 24, warrantyUnifiedUnit: "months" }))).toEqual({ months: 24 });
  });

  it("bez jednotky se počítá s měsíci", () => {
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyUnifiedDuration: 6 }))).toEqual({ months: 6 });
  });

  it("roky se převedou na měsíce", () => {
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyUnifiedDuration: 2, warrantyUnifiedUnit: "years" }))).toEqual({ months: 24 });
  });

  it("dny zůstanou dny – přepočet na měsíce by na papíře lhal", () => {
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyUnifiedDuration: 45, warrantyUnifiedUnit: "days" }))).toEqual({ days: 45 });
  });

  it("nenastavená, nulová ani nesmyslná délka nic neslibuje", () => {
    expect(zarucniDobaZNastaveni(null)).toBeUndefined();
    expect(zarucniDobaZNastaveni({})).toBeUndefined();
    expect(zarucniDobaZNastaveni(nastaveni({}))).toBeUndefined();
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyUnifiedDuration: 0 }))).toBeUndefined();
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyUnifiedDuration: -3 }))).toBeUndefined();
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyUnifiedDuration: "dvanáct" }))).toBeUndefined();
  });

  it("vlastní text záruky žádnou délku neurčuje", () => {
    expect(zarucniDobaZNastaveni(nastaveni({ warrantyType: "custom", warrantyCustomText: "Záruka dle dohody.", warrantyUnifiedDuration: 12 }))).toBeUndefined();
  });

  it("zapamatovaná záruka patří jen svému servisu", () => {
    zapamatujZarukuServisu("servis-A", nastaveni({ warrantyUnifiedDuration: 12 }));
    expect(zarucniDobaProTisk("servis-A")).toEqual({ months: 12 });
    // Po přepnutí servisu se nesmí vytisknout záruka toho předchozího.
    expect(zarucniDobaProTisk("servis-B")).toBeUndefined();
    zapamatujZarukuServisu("servis-B", nastaveni({ warrantyUnifiedDuration: 3 }));
    expect(zarucniDobaProTisk("servis-B")).toEqual({ months: 3 });
    expect(zarucniDobaProTisk(null)).toBeUndefined();
  });
});
