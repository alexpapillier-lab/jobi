import { describe, expect, it } from "vitest";
import { dopocitanaCena, poRucniCene, poZmeneOprav, poZmeneSlevy, soucetOprav } from "./cenaPriPrijmu";

describe("cena při příjmu", () => {
  it("sleva se propíše do předschválené ceny z oprav z ceníku", () => {
    const d = { estimatedPrice: 2500 };
    const poSleve = poZmeneSlevy(d, 2500, "percentage", 10);
    expect(poSleve.estimatedPrice).toBe(2250);
    expect(poSleve.discountType).toBe("percentage");
    // Zrušení slevy vrátí plnou cenu.
    const bez = poZmeneSlevy(poSleve, 2500, null, 0);
    expect(bez.estimatedPrice).toBe(2500);
    expect(bez.discountType).toBeNull();
    expect(bez.discountValue).toBeUndefined();
  });

  it("bez oprav i bez ruční ceny sleva cenu nevymýšlí", () => {
    const d = poZmeneSlevy({}, 0, "amount", 200);
    expect(d.estimatedPrice).toBeUndefined();
    expect(d.discountType).toBe("amount");
  });

  it("ručně napsaná cena je základ: sleva se z ní strhne a jde vrátit", () => {
    const rucni = poRucniCene({}, "3000");
    expect(rucni).toEqual({ estimatedPrice: 3000, cenaPredSlevou: 3000 });
    const poSleve = poZmeneSlevy(rucni, 0, "amount", 500);
    expect(poSleve.estimatedPrice).toBe(2500);
    expect(poZmeneSlevy(poSleve, 0, null, 0).estimatedPrice).toBe(3000);
  });

  it("přidání opravy z ceníku přepočítá cenu i se slevou, dokud ji člověk nepřepsal", () => {
    const d = poZmeneSlevy({ estimatedPrice: 1000 }, 1000, "percentage", 10); // 900
    const vic = poZmeneOprav(d, 1000, 1500);
    expect(vic.estimatedPrice).toBe(1350);
    // Ručně přepsaná cena zůstává.
    const rucni = poRucniCene(vic, "1200");
    expect(poZmeneOprav(rucni, 1500, 2000).estimatedPrice).toBe(1200);
  });

  it("odebrání poslední opravy cenu vymaže", () => {
    const d = poZmeneOprav({ estimatedPrice: 900, discountType: "percentage", discountValue: 10 }, 1000, 0);
    expect(d.estimatedPrice).toBeUndefined();
  });

  it("prázdné pole ceny zruší i ruční základ", () => {
    expect(poRucniCene({ estimatedPrice: 5, cenaPredSlevou: 5 }, "")).toEqual({ estimatedPrice: undefined, cenaPredSlevou: undefined });
    expect(soucetOprav([{ price: 100 }, { price: null }, { price: 50 }])).toBe(150);
    expect(dopocitanaCena({ discountType: "amount", discountValue: 5000 }, 2000)).toBe(0);
  });
});
