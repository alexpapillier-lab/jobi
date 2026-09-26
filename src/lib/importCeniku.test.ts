import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import type { DevicesData } from "./devicesDb";
import { odhadniMapovaniCeniku, parsujCas, pripravCenik, zapisCenik, type KlientCeniku } from "./importCeniku";

const KATALOG: DevicesData = {
  brands: [{ id: "b-apple", name: "Apple", createdAt: "" }],
  categories: [{ id: "c-tel", brandId: "b-apple", name: "Telefony", createdAt: "" }],
  models: [
    { id: "m-ip13", categoryId: "c-tel", name: "iPhone 13", createdAt: "" },
    { id: "m-ip12", categoryId: "c-tel", name: "iPhone 12", createdAt: "" },
  ],
  repairs: [
    { id: "r-disp", modelIds: ["m-ip13"], name: "Výměna displeje", price: 3990, costs: 2100, estimatedTime: 60, details: "", createdAt: "" },
    { id: "r-bat", modelIds: ["m-ip13"], name: "Výměna baterie", price: 1490, estimatedTime: 30, details: "", createdAt: "" },
  ],
};

const CSV = [
  "Značka;Kategorie;Model;Oprava;Cena;Náklady;Čas",
  "apple;Telefony;iPhone 13;Výměna displeje;3990;2100;60 min",
  "Apple;Telefony;iPhone 12;Výměna displeje;3990;2100;1 h",
  "Apple;Telefony;iPhone 12;Výměna baterie;1290;;30",
  "Apple;Tablety;iPad Air;Výměna baterie;1290;;30",
  "Samsung;;Galaxy S23;Výměna displeje;4 990,00 Kč;3 000 Kč;2 - 3 dny",
  "Samsung;;Galaxy S23;Výměna displeje;5990;;",
  "Samsung;;;;;;",
  ";;Bez značky;Něco;100;;",
  "Xiaomi;;;Oprava bez modelu;100;;",
  "Apple;Telefony;iPhone 12;Čištění;abc1;;",
].join("\n");

describe("importCeniku", () => {
  it("odhadne sloupce podle hlavičky", () => {
    expect(odhadniMapovaniCeniku(["Značka", "Kategorie", "Model", "Oprava", "Cena", "Náklady", "Čas", "Popis", "Cokoliv"])).toEqual([
      "brand", "category", "model", "repair", "price", "costs", "time", "details", null,
    ]);
    expect(odhadniMapovaniCeniku(["Vyrobce", "Zarizeni", "Nazev", "Price", "Cost", "Duration"])).toEqual(["brand", "model", "repair", "price", "costs", "time"]);
  });

  it("čas v minutách, hodinách, dnech i rozsahu", () => {
    expect(parsujCas("60")).toBe(60);
    expect(parsujCas("60 min.")).toBe(60);
    expect(parsujCas("1,5 h")).toBe(90);
    expect(parsujCas("2 hod")).toBe(120);
    expect(parsujCas("3 dny")).toBe(4320);
    expect(parsujCas("2 - 3 dny")).toBe(4320);
    expect(parsujCas("")).toBeNull();
    expect(parsujCas("brzy")).toBeNaN();
  });

  it("plán: existující se nezakládá, stejná oprava se rozšíří o model, nová se seskupí přes modely", () => {
    const t = parseCsv(CSV);
    const m = odhadniMapovaniCeniku(t.hlavicka);
    const plan = pripravCenik(t, m, KATALOG);

    // Apple ani Telefony znovu nevznikají (bez ohledu na velikost písmen); Tablety a Samsung + výchozí kategorie ano.
    expect(plan.brands.map((b) => b.name)).toEqual(["Samsung", "Xiaomi"]);
    expect(plan.categories.map((c) => [c.name, c.brandId])).toEqual([["Tablety", "b-apple"], ["Ostatní", "novy:brand:samsung"]]);
    expect(plan.models.map((x) => x.name)).toEqual(["iPad Air", "Galaxy S23"]);

    // Displej u iPhone 13 už je → přeskočeno; u iPhone 12 stejná cena/čas → rozšíření existující opravy.
    expect(plan.preskoceno).toBe(2);
    expect(plan.rozsireni).toEqual([{ id: "r-disp", name: "Výměna displeje", modelIds: ["m-ip13", "m-ip12"] }]);

    // Baterie za 1290 je jiná než existující za 1490 → nová, sdílená iPhone 12 a iPad Air.
    // Galaxy displej: druhý řádek se stejným názvem u téhož modelu se přeskočí (i s jinou cenou).
    expect(plan.repairs.map((r) => [r.name, r.price, r.costs, r.estimatedTime, r.modelIds])).toEqual([
      ["Výměna baterie", 1290, null, 30, ["m-ip12", plan.models[0].docasneId]],
      ["Výměna displeje", 4990, 3000, 4320, [plan.models[1].docasneId]],
    ]);

    expect(plan.chyby).toEqual([
      { radek: 9, zprava: "chybí značka" },
      { radek: 10, zprava: "oprava „Oprava bez modelu“ nemá model" },
      { radek: 11, zprava: "nečitelná cena: abc1" },
    ]);
  });

  it("zápis doplní skutečná id po úrovních a rozšíří existující opravy", async () => {
    const vlozeno: Record<string, unknown[]> = {};
    const aktualizace: Array<[string, unknown]> = [];
    let citac = 0;
    const klient: KlientCeniku = {
      from: (tabulka) => ({
        insert: (radky) => ({
          select: async () => {
            vlozeno[tabulka] = radky;
            return { data: (radky as Array<Record<string, unknown>>).map((r) => ({ ...r, id: `${tabulka}-${++citac}` })), error: null };
          },
        }),
        update: (hodnoty) => ({ eq: async (_s, id) => { aktualizace.push([id, hodnoty]); return { error: null }; } }),
      }),
    };
    const t = parseCsv(CSV);
    const plan = pripravCenik(t, odhadniMapovaniCeniku(t.hlavicka), KATALOG);
    const postup: number[] = [];
    const v = await zapisCenik(klient, "svc", plan, (p) => postup.push(p));

    expect(v).toEqual({ znacek: 2, kategorii: 2, modelu: 2, oprav: 2, rozsireno: 1, chyby: [] });
    expect(postup).toEqual([25, 50, 75, 100]);
    expect(vlozeno.device_brands).toEqual([{ service_id: "svc", name: "Samsung" }, { service_id: "svc", name: "Xiaomi" }]);
    // Kategorie Ostatní míří na skutečné id Samsungu, model Galaxy na skutečné id kategorie.
    expect(vlozeno.device_categories).toEqual([
      { service_id: "svc", brand_id: "b-apple", name: "Tablety" },
      { service_id: "svc", brand_id: "device_brands-1", name: "Ostatní" },
    ]);
    expect(vlozeno.device_models).toEqual([
      { service_id: "svc", category_id: "device_categories-3", name: "iPad Air" },
      { service_id: "svc", category_id: "device_categories-4", name: "Galaxy S23" },
    ]);
    expect(vlozeno.repairs).toEqual([
      { service_id: "svc", name: "Výměna baterie", price: 1290, costs: null, estimated_time: 30, details: "", model_ids: ["m-ip12", "device_models-5"] },
      { service_id: "svc", name: "Výměna displeje", price: 4990, costs: 3000, estimated_time: 4320, details: "", model_ids: ["device_models-6"] },
    ]);
    expect(aktualizace).toEqual([["r-disp", { model_ids: ["m-ip13", "m-ip12"] }]]);
  });

  it("chyba u značek zastaví další úrovně", async () => {
    const klient: KlientCeniku = {
      from: () => ({
        insert: () => ({ select: async () => ({ data: null, error: { message: "RLS" } }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    };
    const t = parseCsv("Značka;Model;Oprava;Cena\nSony;Xperia;Displej;1000");
    const v = await zapisCenik(klient, "svc", pripravCenik(t, odhadniMapovaniCeniku(t.hlavicka), { brands: [], categories: [], models: [], repairs: [] }));
    expect(v).toEqual({ znacek: 0, kategorii: 0, modelu: 0, oprav: 0, rozsireno: 0, chyby: ["Značky: RLS"] });
  });
});
