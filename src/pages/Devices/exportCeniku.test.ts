import { describe, it, expect } from "vitest";
import { HLAVICKA_CENIKU, listCeniku, nazevSouboruCeniku, radkyCeniku } from "./exportCeniku";
import type { DevicesData } from "./types";

const t = "2026-01-01T00:00:00.000Z";

const data: DevicesData = {
  brands: [
    { id: "apple", name: "Apple", createdAt: t },
    { id: "dyson", name: "Dyson", createdAt: t },
  ],
  categories: [
    { id: "iphone", brandId: "apple", name: "iPhone", createdAt: t },
    { id: "vysavace", brandId: "dyson", name: "Vysavače", createdAt: t },
  ],
  models: [
    { id: "6s", categoryId: "iphone", name: "iPhone 6s", createdAt: t },
    { id: "7", categoryId: "iphone", name: "iPhone 7", createdAt: t },
    { id: "v11", categoryId: "vysavace", name: "V11", createdAt: t },
  ],
  repairs: [
    { id: "r-filtr", modelIds: ["v11"], name: "Výměna filtru", price: 490, estimatedTime: 20, details: "", createdAt: t, costs: 120, warrantyMonths: 6 },
    { id: "r-displej", modelIds: ["6s", "7"], name: "Výměna displeje", price: 1490.5, estimatedTime: 60, details: "Originální díl", createdAt: t, publicVisible: false },
    { id: "r-baterie", modelIds: ["7", "neexistuje"], name: "Baterie", price: 990, estimatedTime: 30, details: "", createdAt: t, costs: 0 },
  ],
};

describe("radkyCeniku", () => {
  it("řadí podle značky, kategorie a názvu a modely spojuje do jedné buňky", () => {
    const r = radkyCeniku(data);
    expect(r.map((x) => x.id)).toEqual(["r-baterie", "r-displej", "r-filtr"]);
    expect(r[1]).toMatchObject({ znacka: "Apple", kategorie: "iPhone", modely: "iPhone 6s, iPhone 7" });
  });

  it("neznámý model tiše vynechá", () => {
    expect(radkyCeniku(data)[0].modely).toBe("iPhone 7");
  });
});

describe("listCeniku", () => {
  it("má hlavičku a čísla jako čísla, náklady i marži jen když jsou známé", () => {
    const list = listCeniku(data);
    expect(list.hlavicka).toEqual([...HLAVICKA_CENIKU]);
    const [baterie, displej, filtr] = list.radky;
    // náklady 0 jsou známé náklady, ne chybějící
    expect(baterie).toEqual(["r-baterie", "Apple", "iPhone", "iPhone 7", "Baterie", 990, 0, 990, 30, null, null, "ano"]);
    expect(displej).toEqual(["r-displej", "Apple", "iPhone", "iPhone 6s, iPhone 7", "Výměna displeje", 1490.5, null, null, 60, null, "Originální díl", "ne"]);
    expect(filtr).toEqual(["r-filtr", "Dyson", "Vysavače", "V11", "Výměna filtru", 490, 120, 370, 20, 6, null, "ano"]);
  });

  it("šířky sloupců sedí na počet sloupců", () => {
    expect(listCeniku(data).sirky).toHaveLength(HLAVICKA_CENIKU.length);
  });
});

describe("nazevSouboruCeniku", () => {
  it("nese datum", () => {
    expect(nazevSouboruCeniku(new Date("2026-10-02T12:00:00Z"))).toBe("cenik-oprav-2026-10-02.xlsx");
  });
});
